/**
 * POST /api/voice-stream
 * Claude Streaming + TTS Pipeline
 *
 * 流程：
 * 1. Claude messages.stream() — token 邊生成邊收
 * 2. 累積到句子結尾（。！？\n）→ 立刻送 ElevenLabs TTS
 * 3. ElevenLabs stream 回來的 audio chunk → base64 → SSE 推給前端
 * 4. 前端 MediaSource 接收 → 第一句話生成完就播
 *
 * SSE 事件格式：
 * data: {"type":"text","content":"..."}       ← 文字句子
 * data: {"type":"audio","chunk":"base64..."}  ← 音訊 chunk
 * data: {"type":"done","fullText":"..."}      ← 結束
 * data: {"type":"error","message":"..."}      ← 錯誤
 */

import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from '@/lib/firebase-admin';
import { redis } from '@/lib/redis';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';

export const maxDuration = 120;

// ===== 中台用語 + 破音字（從 TTS route 搬來）=====
const ZH_TW_MAP: Record<string, string> = {
  '短視頻': '短影音', '視頻': '影片', '互聯網': '網際網路', '信息': '資訊',
  '軟件': '軟體', '硬件': '硬體', '網絡': '網路', '數據庫': '資料庫',
  '算法': '演算法', '概率': '機率', '編程': '程式設計', '源代碼': '原始碼',
  '代碼': '程式碼', '程序': '程式', '鼠標': '滑鼠', '打印機': '印表機',
  '打印': '列印', '內存': '記憶體', '硬盤': '硬碟', '屏幕': '螢幕',
  '文件夾': '資料夾', '文件': '檔案', '菜單': '選單', '界面': '介面',
  '用戶': '使用者', '服務器': '伺服器', '默認': '預設', '搜索': '搜尋',
  '緩存': '快取', '設置': '設定', '配置': '設定', '運行': '執行',
};
const PRONUNCIATION_MAP: Record<string, string> = {
  '顯著': '顯住', '著重': '注重', '執著': '執住', '重複': '蟲複',
  '重新': '蟲新', '音樂': '音約', '樂器': '約器', '銀行': '銀航',
  '成長': '成掌', '董事長': '董事掌', '調查': '掉查', '強調': '強掉',
  '效率': '效律', '機率': '機律', '覺得': '覺的', '記得': '記的',
  '了解': '料解', '曾經': '層經', '便宜': '便移', '數學': '樹學',
  '數字': '樹字', '數據': '樹據', '參與': '參預',
};

function preprocessTTS(text: string): string {
  let r = text;
  for (const k of Object.keys(ZH_TW_MAP).sort((a, b) => b.length - a.length))
    r = r.replaceAll(k, ZH_TW_MAP[k]);
  for (const k of Object.keys(PRONUNCIATION_MAP).sort((a, b) => b.length - a.length))
    r = r.replaceAll(k, PRONUNCIATION_MAP[k]);
  return r;
}

// ===== 句子切割 =====
function splitSentences(text: string): string[] {
  // 在句子結尾後切開，保留標點
  return text.split(/(?<=[。！？!?\n])\s*/).filter(s => s.trim().length > 0);
}

function isSentenceEnd(text: string): boolean {
  return /[。！？!?\n]/.test(text);
}

// ===== SSE helper =====
function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ===== 叫 ElevenLabs TTS，回傳 audio stream =====
async function fetchTTSStream(text: string, voiceId: string, apiKey: string): Promise<ReadableStream<Uint8Array> | null> {
  const processed = preprocessTTS(text.trim());
  if (!processed) return null;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: processed,
        model_id: 'eleven_flash_v2_5',
        voice_settings: { stability: 0.75, similarity_boost: 0.75, speed: 1.05 },
      }),
    }
  );
  if (!res.ok || !res.body) return null;
  return res.body;
}

// ===== 讀完整個 stream 拿 base64 =====
async function streamToBase64(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.length; }
  return Buffer.from(merged).toString('base64');
}

// ===== Main handler =====
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(sseEvent(data)));
      };

      try {
        const { characterId, userId, message, conversationId } = await req.json();

        const anthropicKey = process.env.ANTHROPIC_API_KEY!;
        const elevenKey = process.env.ELEVENLABS_API_KEY!;

        if (!characterId || !message) {
          send({ type: 'error', message: 'characterId 和 message 必填' });
          controller.close(); return;
        }

        const db = getFirestore();

        // 1. 讀角色資料（Redis cache 優先）
        let charData: Record<string, unknown> = {};
        const charCacheKey = `char:${characterId}`;
        try {
          const cached = await redis.get(charCacheKey);
          if (cached) { charData = JSON.parse(cached); }
        } catch (_e) {}

        if (!charData.aiName) {
          const charDoc = await db.collection('platform_characters').doc(characterId).get();
          if (!charDoc.exists) { send({ type: 'error', message: '角色不存在' }); controller.close(); return; }
          charData = charDoc.data()!;
          try { await redis.set(charCacheKey, JSON.stringify(charData), 60 * 10); } catch (_e) {}
        }

        const voiceId = (charData.voiceId as string) || '56hCnQE2rYMllQDw3m1o';
        const soulText = (charData.enhancedSoul as string) || (charData.soul as string) || '';

        // 2. 讀對話歷史（Redis cache）
        const convId = conversationId || `voice-${characterId}-${userId || 'anon'}-${Date.now()}`;
        let convData: Record<string, unknown> = { messages: [], summary: '' };
        const convCacheKey = `conv:${convId}`;
        try {
          const cached = await redis.get(convCacheKey);
          if (cached) { convData = JSON.parse(cached); }
          else {
            const convDoc = await db.collection('platform_conversations').doc(convId).get();
            if (convDoc.exists) convData = convDoc.data()!;
          }
        } catch (_e) {}

        const history = ((convData.messages as Array<{ role: string; content: string }>) || []).slice(-10);

        // 3. 語義搜尋知識庫（非同步，不擋主流程）
        let memoryContext = '';
        try {
          const embedding = await generateEmbedding(message);
          const insightsSnap = await db.collection('platform_insights')
            .where('characterId', '==', characterId).limit(30).get();
          type InsightDoc = { _id: string; embedding?: number[]; content?: string; [k: string]: unknown };
          const hits = (insightsSnap.docs
            .map(d => ({ ...d.data(), _id: d.id } as InsightDoc))
            .filter(d => d.embedding)
            .map(d => ({ ...d, score: cosineSimilarity(embedding, d.embedding as number[]) }))
            .filter(d => d.score > 0.7)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)) as Array<InsightDoc & { score: number }>;
          if (hits.length > 0) {
            memoryContext = '\n\n【相關記憶】\n' + hits.map(h => `- ${h.content ?? ''}`).join('\n');
          }
        } catch (_e) {}

        // 4. 組 systemPrompt（語音模式）
        const taipeiTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        const summaryBlock = convData.summary ? `\n\n對話摘要：${convData.summary}` : '';
        const systemPrompt = `${soulText}${summaryBlock}${memoryContext}

---
現在時間（台北）：${taipeiTime}

【語音對話天條】
你現在是語音模式。說話要像真人對話，不是在寫文章。
- 單次回應控制在 80 字以內，說完一個重點就停
- 不用條列式，說人話，像朋友在聊天
- 說完後可以自然問一個問題讓對話有來有往`;

        // 5. 組歷史 messages
        const messages: Anthropic.MessageParam[] = [
          ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user', content: message },
        ];

        // 6. Claude streaming
        const client = new Anthropic({ apiKey: anthropicKey });
        const claudeStream = await client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 600,
          system: systemPrompt,
          messages,
        });

        // 7. 累積句子，每句完整就送 TTS
        let buffer = '';
        let fullText = '';
        const ttsQueue: Promise<void>[] = [];
        let sentenceIndex = 0;

        const processSentence = async (sentence: string, idx: number) => {
          if (!sentence.trim()) return;
          send({ type: 'text', content: sentence, index: idx });

          try {
            const audioStream = await fetchTTSStream(sentence, voiceId, elevenKey);
            if (audioStream) {
              const base64 = await streamToBase64(audioStream);
              send({ type: 'audio', chunk: base64, index: idx });
            }
          } catch (_e) {
            console.error('TTS error for sentence:', sentence, _e);
          }
        };

        for await (const chunk of claudeStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            const token = chunk.delta.text;
            buffer += token;
            fullText += token;

            // 每次有句子結尾就切出來送
            if (isSentenceEnd(buffer)) {
              const sentences = splitSentences(buffer);
              // 最後一個可能不完整，留在 buffer
              const complete = sentences.slice(0, -1);
              const remainder = sentences[sentences.length - 1] || '';
              // 如果最後一個也是句子結尾，全部都完整
              const lastIsComplete = isSentenceEnd(remainder);
              const toProcess = lastIsComplete ? sentences : complete;
              buffer = lastIsComplete ? '' : remainder;

              for (const s of toProcess) {
                const idx = sentenceIndex++;
                ttsQueue.push(processSentence(s, idx));
              }
            }
          }
        }

        // 剩餘 buffer（沒有標點結尾的最後一句）
        if (buffer.trim()) {
          const idx = sentenceIndex++;
          ttsQueue.push(processSentence(buffer.trim(), idx));
        }

        // 等所有 TTS 完成
        await Promise.all(ttsQueue);

        // 8. 非同步存 Firestore + 更新 Redis
        void (async () => {
          try {
            const newMessages = [
              ...history,
              { role: 'user', content: message },
              { role: 'assistant', content: fullText },
            ];
            const newCount = ((convData.messageCount as number) || 0) + 2;
            const updatedConv = { ...convData, messages: newMessages, messageCount: newCount };

            const convRef = db.collection('platform_conversations').doc(convId);
            await convRef.set({
              characterId, userId: userId || 'voice',
              messages: newMessages, messageCount: newCount,
              updatedAt: new Date().toISOString(),
            }, { merge: true });

            await redis.set(convCacheKey, JSON.stringify(updatedConv), 60 * 30);
          } catch (e) { console.error('save error:', e); }
        })();

        send({ type: 'done', fullText, conversationId: convId });

      } catch (err) {
        console.error('voice-stream error:', err);
        controller.enqueue(encoder.encode(sseEvent({
          type: 'error',
          message: err instanceof Error ? err.message : '發生錯誤',
        })));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
