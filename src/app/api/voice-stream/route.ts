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
import { FieldValue } from 'firebase-admin/firestore';
import { trackCost } from '@/lib/cost-tracker';
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
  // ── 著 ──
  '顯著': '顯住', '著重': '注重', '執著': '執住',

  // ── 重 ──
  '重複': '蟲複', '重新': '蟲新', '重組': '蟲組', '重建': '蟲建',
  '重啟': '蟲啟', '重置': '蟲置',

  // ── 樂 ──
  '音樂': '音約', '樂器': '約器', '快樂': '快約', '娛樂': '娛約',
  '樂趣': '約趣',

  // ── 行 ──
  '銀行': '銀航', '行業': '航業', '同行': '同航', '行情': '航情',
  '進行': '進形', '旅行': '旅形', '流行': '流形', '行動': '形動',
  '行為': '形為', '可行': '可形',

  // ── 長 ──
  '成長': '成掌', '董事長': '董事掌', '生長': '生掌', '成長型': '成掌型',

  // ── 調 ──
  '調查': '掉查', '強調': '強掉', '調整': '掉整', '調節': '掉節',
  '調配': '掉配',

  // ── 率 ──
  '效率': '效律', '機率': '機律', '比率': '比律', '頻率': '頻律',
  '利率': '利律',

  // ── 刻 ──
  '時刻': '時克', '刻苦': '克苦', '深刻': '深克', '即刻': '即克',
  '立刻': '立克', '此刻': '此克', '片刻': '片克',

  // ── 露（美妝產品唸 lù）──
  '卸妝露': '卸妝陸', '精華露': '精華陸', '保濕露': '保濕陸',
  '爽膚露': '爽膚陸', '化妝露': '化妝陸', '防曬露': '防曬陸',
  '身體露': '身體陸', '護膚露': '護膚陸',

  // ── 發 ──
  '頭髮': '頭法', '毛髮': '毛法', '髮型': '法型', '護髮': '護法',
  '洗髮': '洗法', '染髮': '染法',

  // ── 累 ──
  '累積': '壘積', '積累': '積壘', '日積月累': '日積月壘',

  // ── 處 ──
  '處理': '楚理', '處置': '楚置', '處理器': '楚理器',

  // ── 應 ──
  '反應': '反印', '應用': '印用', '應變': '印變', '回應': '回印',
  '響應': '響印',

  // ── 其他 ──
  '覺得': '覺的', '記得': '記的', '了解': '料解', '曾經': '層經',
  '便宜': '便移', '數學': '樹學', '數字': '樹字', '數據': '樹據',
  '參與': '參預', '供應': '供印', '應該': '英該',
};

function preprocessTTS(text: string): string {
  let r = text;
  // 清掉 Markdown 符號，避免 ElevenLabs 唸出來
  r = r.replace(/\*\*(.+?)\*\*/g, '$1');   // **bold** → bold
  r = r.replace(/\*(.+?)\*/g, '$1');         // *italic* → italic
  r = r.replace(/^#{1,3}\s*/gm, '');          // # 標題符號
  r = r.replace(/^[-•·]\s*/gm, '');           // 列表符號
  r = r.replace(/`[^`]+`/g, '');              // `code` → 直接移除
  r = r.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [text](url) → text
  // 中台用語 + 破音字
  for (const k of Object.keys(ZH_TW_MAP).sort((a, b) => b.length - a.length))
    r = r.replaceAll(k, ZH_TW_MAP[k]);
  for (const k of Object.keys(PRONUNCIATION_MAP).sort((a, b) => b.length - a.length))
    r = r.replaceAll(k, PRONUNCIATION_MAP[k]);
  return r.trim();
}

// ===== 句子切割 =====
function splitSentences(text: string): string[] {
  // 句號/問號/驚嘆號/換行/逗號 都切
  return text.split(/(?<=[。！？!?\n，,])\s*/).filter(s => s.trim().length > 0);
}

function isSentenceEnd(text: string): boolean {
  return /[。！？!?\n，,]/.test(text);
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
        const soulText = (charData.system_soul as string) || (charData.soul_core as string) || (charData.enhancedSoul as string) || (charData.soul as string) || '';

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

        // 3. 組 systemPrompt（語音模式）
        const taipeiTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        const summaryBlock = convData.summary ? `\n\n對話摘要：${convData.summary}` : '';
        const systemPrompt = `${soulText}${summaryBlock}

---
現在時間（台北）：${taipeiTime}

【語音對話天條】
你現在是語音模式。說話要像真人對話，不是在寫文章。
- 說人話，像朋友在聊天，不要條列式、不要 Markdown 符號
- 說完一個完整的想法，可以延伸、可以深入，不要刻意截短
- 說完後自然問一個問題讓對話有來有往`;

        // 4. 工具定義
        const VOICE_TOOLS: Anthropic.Tool[] = [
          {
            name: 'query_knowledge_base',
            description: '查知識庫和記憶，找我記得什麼、知道什麼。說任何事之前先查。',
            input_schema: { type: 'object' as const, properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
          },
          {
            name: 'remember',
            description: '把重要資訊存入長期記憶。對方說了名字/目標/需求、我有了洞察，立即呼叫。',
            input_schema: { type: 'object' as const, properties: { title: { type: 'string' }, content: { type: 'string' }, importance: { type: 'number', description: '1-3，預設 2' } }, required: ['title', 'content'] },
          },
          {
            name: 'query_tasks',
            description: '查看自己的排程任務清單。',
            input_schema: { type: 'object' as const, properties: { enabled_only: { type: 'boolean' } } },
          },
          {
            name: 'update_task',
            description: '調整排程任務。先用 query_tasks 查到任務 ID 再來改。',
            input_schema: { type: 'object' as const, properties: { task_id: { type: 'string' }, enabled: { type: 'boolean' }, run_hour: { type: 'number' }, run_minute: { type: 'number' }, description: { type: 'string' }, intent: { type: 'string' } }, required: ['task_id'] },
          },
        ];
        const WEB_SEARCH = { type: 'web_search_20250305', name: 'web_search' } as unknown as Anthropic.Tool;

        // 5. 工具執行
        const execVoiceTool = async (toolName: string, toolInput: Record<string, unknown>): Promise<string> => {
          if (toolName === 'query_knowledge_base') {
            const query = String(toolInput.query || '');
            const limit = Number(toolInput.limit || 5);
            const THRESHOLD = 0.3;
            const [knowledgeSnap, insightSnap] = await Promise.all([
              db.collection('platform_knowledge').where('characterId', '==', characterId).limit(200).get(),
              db.collection('platform_insights').where('characterId', '==', characterId).limit(100).get(),
            ]);
            const knowledgeDocs: Record<string,unknown>[] = knowledgeSnap.docs.map(d => ({ _id: d.id, _type: 'knowledge', ...d.data() }));
            const insightDocs: Record<string,unknown>[]   = insightSnap.docs.map(d  => ({ _id: d.id, _type: 'insight',   ...d.data() }));
            let queryEmb: number[] | null = null;
            const productNames = Array.from(new Set(knowledgeDocs.map(d => String(d.title || '').split('—')[0].trim()).filter(n => n.length > 2)));
            const matchedProduct = productNames.find(p => query.includes(p) || (p.includes(' ') && query.includes(p.split(' ').slice(1).join(' '))));
            let knowledgeResults: Record<string, unknown>[] = [];
            if (matchedProduct) {
              const short = matchedProduct.includes(' ') ? matchedProduct.split(' ').slice(1).join(' ') : matchedProduct;
              knowledgeResults = knowledgeDocs.filter(d => { const t = String(d.title||''); return t.startsWith(matchedProduct)||t.startsWith(short); });
            } else {
              const withEmb = knowledgeDocs.filter(d => d.embedding && Array.isArray(d.embedding) && d.category !== 'image');
              if (withEmb.length > 0) {
                queryEmb = await generateEmbedding(query);
                knowledgeResults = withEmb.map(d => ({ ...d, _score: cosineSimilarity(queryEmb!, d.embedding as number[]) })).filter(d => (d._score as number) >= THRESHOLD).sort((a,b)=>(b._score as number)-(a._score as number)).slice(0, limit);
              }
            }
            const insightWithEmb = insightDocs.filter(d => d.embedding && Array.isArray(d.embedding));
            let insightResults: Record<string, unknown>[] = [];
            if (insightWithEmb.length > 0) {
              if (!queryEmb) queryEmb = await generateEmbedding(query);
              insightResults = insightWithEmb.map(d => ({ ...d, _score: cosineSimilarity(queryEmb!, d.embedding as number[]) })).filter(d => (d._score as number) >= THRESHOLD).sort((a,b)=>(b._score as number)-(a._score as number)).slice(0, 5);
            }
            const scored = [...knowledgeResults, ...insightResults];
            if (scored.length === 0) return '（沒有找到相關資料）';
            void Promise.all(scored.map(item => { const d = item as Record<string, unknown>; const col = d._type==='insight'?'platform_insights':'platform_knowledge'; if(!d._id) return; return db.collection(col).doc(d._id as string).update({ hitCount: FieldValue.increment(1), lastHitAt: new Date().toISOString() }).catch(()=>{}); }));
            return scored.map(item => { const d = item as Record<string, unknown>; const tag = d._type==='knowledge'?`[知識・${d.category||'一般'}]`:'[記憶]'; const body = String(d.content||d.summary||'').slice(0,200); return `${tag} ${d.title||''}：${body}`; }).join('\n\n');
          }
          if (toolName === 'remember') {
            const title = String(toolInput.title||''); const content = String(toolInput.content||''); const importance = Number(toolInput.importance??2);
            const embedding = await generateEmbedding(`${title} ${content}`);
            await db.collection('platform_insights').add({ characterId, title, content, importance, source: 'voice', tier: 'fresh', hitCount: importance>=3?2:0, lastHitAt: null, embedding, createdAt: new Date().toISOString() });
            await db.collection('platform_characters').doc(characterId).update({ 'growthMetrics.totalInsights': FieldValue.increment(1) });
            return `已記住：${title}`;
          }
          if (toolName === 'query_tasks') {
            const enabledOnly = toolInput.enabled_only !== false;
            const snap = await db.collection('platform_tasks').where('characterId','==',characterId).get();
            const tasks = snap.docs.map(d=>({id:d.id,...d.data()})) as Record<string,unknown>[];
            const filtered = enabledOnly ? tasks.filter(t=>t.enabled) : tasks;
            if (filtered.length===0) return '沒有排程任務。';
            const DL: Record<string,string> = {sun:'日',mon:'一',tue:'二',wed:'三',thu:'四',fri:'五',sat:'六'};
            return filtered.map(t=>`[ID:${t.id}] ${t.enabled?'✅':'⏸'} ${t.type} | ${String(t.run_hour??'?').padStart(2,'0')}:${String(t.run_minute??0).padStart(2,'0')} | 週${(t.days as string[]||[]).map(d=>DL[d]||d).join('')}${t.description?' | '+t.description:''}`).join('\n');
          }
          if (toolName === 'update_task') {
            const taskId = String(toolInput.task_id||''); if (!taskId) return '需要 task_id。';
            const updates: Record<string,unknown> = {};
            if (toolInput.enabled!==undefined) updates.enabled=Boolean(toolInput.enabled);
            if (toolInput.run_hour!==undefined) updates.run_hour=Number(toolInput.run_hour);
            if (toolInput.run_minute!==undefined) updates.run_minute=Number(toolInput.run_minute);
            if (toolInput.description!==undefined) updates.description=String(toolInput.description);
            if (toolInput.intent!==undefined) updates.intent=String(toolInput.intent);
            if (Object.keys(updates).length===0) return '沒有要修改的欄位。';
            await db.collection('platform_tasks').doc(taskId).update(updates);
            return `任務已更新：${JSON.stringify(updates)}`;
          }
          return '未知工具';
        };

        // 6. Tool-use loop（最多 3 輪）再進入 streaming
        const client = new Anthropic({ apiKey: anthropicKey });
        let loopMessages: Anthropic.MessageParam[] = [
          ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user', content: message },
        ];

        for (let turn = 0; turn < 3; turn++) {
          const toolChoice = turn === 0
            ? { type: 'tool' as const, name: 'query_knowledge_base' }
            : { type: 'auto' as const };
          const preRes = await client.messages.create({
            model: 'claude-sonnet-4-6', max_tokens: 800,
            system: systemPrompt, messages: loopMessages,
            tools: [WEB_SEARCH, ...VOICE_TOOLS], tool_choice: toolChoice,
          });
          if (preRes.stop_reason !== 'tool_use') {
            // 不需要工具了，把這輪文字加入歷史後進 streaming
            loopMessages.push({ role: 'assistant', content: preRes.content });
            break;
          }
          const toolBlocks = preRes.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[];
          const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
            toolBlocks.map(async b => ({
              type: 'tool_result' as const,
              tool_use_id: b.id,
              content: await execVoiceTool(b.name, b.input as Record<string, unknown>),
            }))
          );
          loopMessages = [...loopMessages, { role: 'assistant', content: preRes.content }, { role: 'user', content: toolResults }];
        }

        // 7. Claude streaming（帶工具結果的完整 context）
        const claudeStream = await client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          system: systemPrompt,
          messages: loopMessages,
        });

        // 7. 累積句子，每句完整就送 TTS
        let buffer = '';
        let fullText = '';
        const ttsQueue: Promise<void>[] = [];
        let sentenceIndex = 0;

        // 有序音訊緩衝：TTS 並行打，但按 idx 順序送出
        const audioBuffer = new Map<number, string>(); // idx → base64
        let nextToSend = 0;

        const flushOrdered = () => {
          while (audioBuffer.has(nextToSend)) {
            const chunk = audioBuffer.get(nextToSend)!;
            if (chunk) send({ type: 'audio', chunk, index: nextToSend });
            audioBuffer.delete(nextToSend);
            nextToSend++;
          }
        };

        const processSentence = async (sentence: string, idx: number) => {
          if (!sentence.trim()) {
            // 空句子也要佔位，讓後面的句子不卡
            audioBuffer.set(idx, '');
            flushOrdered();
            return;
          }
          send({ type: 'text', content: sentence, index: idx });

          try {
            const audioStream = await fetchTTSStream(sentence, voiceId, elevenKey);
            const base64 = audioStream ? await streamToBase64(audioStream) : '';
            audioBuffer.set(idx, base64);
          } catch (_e) {
            console.error('TTS error for sentence:', sentence, _e);
            audioBuffer.set(idx, ''); // 失敗也要佔位
          }
          flushOrdered();
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

        // 追蹤語音費用（Claude Sonnet streaming）
        try {
          const finalMsg = await claudeStream.finalMessage();
          await trackCost(characterId, 'claude-sonnet-4-6', finalMsg.usage?.input_tokens ?? 0, finalMsg.usage?.output_tokens ?? 0);
        } catch { /* 不阻斷 */ }

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
