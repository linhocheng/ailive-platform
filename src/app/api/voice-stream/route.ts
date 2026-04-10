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
import { withRetry } from '@/lib/anthropic-retry';
import { detectGear, MODELS, getMaxTokens } from '@/lib/llm-router';
import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { trackCost } from '@/lib/cost-tracker';
import { redis } from '@/lib/redis';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { generateImageForCharacter } from '@/lib/generate-image';
import { preprocessTTS } from '@/lib/tts-preprocess';

export const maxDuration = 120;

// ===== 句子切割 =====
// 只切句末標點（。！？!?\n），不切逗號，避免短碎片造成語氣不自然
// 短句（< 8 字）合併到下一句，減少過短 TTS 請求
function splitSentences(text: string): string[] {
  const raw = text.split(/(?<=[。！？!?\n])\s*/).filter(s => s.trim().length > 0);
  // 短句合併
  const merged: string[] = [];
  let buf = '';
  for (const s of raw) {
    buf += s;
    if (buf.replace(/[，,\s]/g, '').length >= 8) {
      merged.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) merged.push(buf);
  return merged;
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
        const soulText = (charData.system_soul as string) || (charData.soul_core as string) || (charData.enhancedSoul as string) || (charData.soul as string) || '';

        // 2. 讀對話歷史（Redis cache）
        const convId = conversationId || `voice-${characterId}-${userId || 'anon'}`;
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

        // ── 時間感知（gapInjection）──
        const formatGap = (ms: number): string => {
          const min = Math.floor(ms / 60000);
          if (min < 60) return `約 ${min} 分鐘`;
          if (min < 1440) return `約 ${Math.round(min / 60)} 小時`;
          if (min < 10080) return `約 ${Math.round(min / 1440)} 天`;
          return `約 ${Math.round(min / 10080)} 週`;
        };
        let gapInjection = '';
        const lastAt = convData.updatedAt ? new Date(String(convData.updatedAt)).getTime() : null;
        if (lastAt && !isNaN(lastAt) && Number(convData.messageCount || 0) > 0) {
          const gap = Date.now() - lastAt;
          if (gap > 10 * 60 * 1000) {
            const duration = formatGap(gap);
            gapInjection = `\n\n---\n【時間感知】距離上次語音對話過了 ${duration}\n（可以自然帶出，也可以什麼都不說，看情境決定）`;
          }
        }

        // ── Session State 讀取 ──
        let sessionStateBlock = '';
        try {
          const sessionRaw = await redis.get(`session:${convId}`);
          if (sessionRaw) sessionStateBlock = `\n\n---\n${sessionRaw}`;
        } catch { /* 不阻斷 */ }

        const systemPrompt = `${soulText}${summaryBlock}${gapInjection}${sessionStateBlock}

---
現在時間（台北）：${taipeiTime}

【語音對話天條】
你現在是語音模式。說話要像真人對話，不是在寫文章。
- 說人話，像朋友在聊天，不要條列式、不要 Markdown 符號
- 說完一個完整的想法，可以延伸、可以深入，不要刻意截短
- 說完後自然問一個問題讓對話有來有往

【STT 容錯】
✅ 必須：根據上下文和語境猜測用戶意圖，就算聽起來不通順也要猜
✅ 必須：用自然的方式回應，當作你完全聽懂了
❌ 禁止：說「你說的 XXX 是什麼意思」「我沒聽清楚」「請再說一次」
❌ 禁止：重複用戶說的奇怪詞語，或對轉錄錯誤提出疑問
比喻：把用戶說的話當成打錯字的簡訊——你會猜意思繼續聊，不會問「你是不是打錯字了？」`;

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
          {
            name: 'save_post_draft',
            description: '把剛聊出來的好內容存成 IG 草稿。對方說了值得發的東西，或聊出了好文案，就存起來。',
            input_schema: { type: 'object' as const, properties: { content: { type: 'string', description: '貼文文案（含 hashtag）' }, topic: { type: 'string', description: '主題標籤' }, image_url: { type: 'string', description: '圖片 URL（選填）' } }, required: ['content'] },
          },
          {
            name: 'query_posts',
            description: '查看自己的貼文草稿列表。用戶問「你上次發了什麼」「我的草稿在哪」時呼叫。',
            input_schema: { type: 'object' as const, properties: { status: { type: 'string', enum: ['draft', 'published', 'all'], description: '篩選狀態，預設 draft' }, limit: { type: 'number', description: '最多幾筆，預設 5' } } },
          },
          {
            name: 'create_task',
            description: '幫自己新增排程任務。用戶說「以後每天幫我做 X」時建立。',
            input_schema: { type: 'object' as const, properties: { type: { type: 'string', enum: ['learn', 'reflect', 'post', 'engage'] }, run_hour: { type: 'number' }, run_minute: { type: 'number' }, days: { type: 'array', items: { type: 'string' } }, description: { type: 'string' } }, required: ['type'] },
          },
          {
            name: 'initiate_awakening',
            description: '（謀師專用）對指定角色發起覺醒引導。語音引導角色完成自我覺察。',
            input_schema: { type: 'object' as const, properties: { target_character_id: { type: 'string' }, target_character_name: { type: 'string' } }, required: ['target_character_id'] },
          },
          {
            name: 'query_product_card',
            description: '查某款產品的完整資料（成分、功效、圖片URL）。聊到產品、要生圖、要介紹某款時，用這個而不是 query_knowledge_base。直接拿，100% 準確。',
            input_schema: { type: 'object' as const, properties: { product_name: { type: 'string', description: '產品關鍵字，例如「卸妝露」「慕斯花」「精華霜」' } }, required: ['product_name'] },
          },
          {
            name: 'generate_image',
            description: '生成 IG 貼文用的產品圖。有了產品圖片URL就用 reference_image_url 傳入，讓圖更精準。',
            input_schema: { type: 'object' as const, properties: {
              prompt: { type: 'string', description: '圖片描述（英文，場景+產品+風格）' },
              reference_image_url: { type: 'string', description: '產品參考圖URL，從 query_product_card 拿' },
            }, required: ['prompt'] },
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
          // ── save_post_draft ──
          if (toolName === 'save_post_draft') {
            const content = String(toolInput.content || '');
            if (!content) return '需要文案才能存草稿。';
            const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
            const topic = toolInput.topic ? String(toolInput.topic) : '';
            const ref = await db.collection('platform_posts').add({
              characterId, content,
              imageUrl: toolInput.image_url ? String(toolInput.image_url) : '',
              topic, status: 'draft', scheduledAt: null, publishedAt: null,
              createdAt: new Date().toISOString(),
            });
            await db.collection('platform_insights').add({
              characterId,
              title: `語音草稿：${content.slice(0, 30)}`,
              content: `（語音對話中存下的草稿）${content.slice(0, 100)}`,
              importance: 2, source: 'voice_post_draft', tier: 'fresh',
              hitCount: 0, lastHitAt: null,
              embedding: await generateEmbedding(`草稿 ${content.slice(0, 100)}`),
              createdAt: new Date().toISOString(),
            });
            return `草稿已儲存（ID: ${ref.id}），可在後台查看。`;
          }

          // ── query_posts ──
          if (toolName === 'query_posts') {
            const status = String(toolInput.status || 'draft');
            const limit = Number(toolInput.limit || 5);
            const snap = await db.collection('platform_posts')
              .where('characterId', '==', characterId).limit(Math.min(limit, 10)).get();
            let posts = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];
            if (status !== 'all') posts = posts.filter(p => p.status === status);
            posts.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
            if (posts.length === 0) return `沒有${status === 'draft' ? '草稿' : status === 'published' ? '已發布貼文' : '貼文'}。`;
            return posts.map(p =>
              `[${p.status}] ${String(p.content || '').slice(0, 60)}${String(p.content || '').length > 60 ? '...' : ''} (${String(p.createdAt || '').slice(0, 10)})`
            ).join('\n');
          }

          // ── create_task ──
          if (toolName === 'create_task') {
            const type = String(toolInput.type || 'learn');
            const run_hour = Number(toolInput.run_hour ?? 9);
            const run_minute = Number(toolInput.run_minute ?? 0);
            const days = (toolInput.days as string[]) || ['mon', 'wed', 'fri'];
            const description = String(toolInput.description || '');
            const ref = await db.collection('platform_tasks').add({
              characterId, type, run_hour, run_minute, days,
              enabled: true, description, last_run: null,
              createdAt: new Date().toISOString(),
            });
            const DAY_LABELS: Record<string, string> = { sun:'日', mon:'一', tue:'二', wed:'三', thu:'四', fri:'五', sat:'六' };
            return `任務已建立（ID: ${ref.id}）：${type} 每週${days.map(d => DAY_LABELS[d] || d).join('')} ${String(run_hour).padStart(2,'0')}:${String(run_minute).padStart(2,'0')}`;
          }

          // ── initiate_awakening ──
          if (toolName === 'initiate_awakening') {
            const targetId = String(toolInput.target_character_id || '');
            const targetName = String(toolInput.target_character_name || '角色');
            if (!targetId) return '需要 target_character_id。';
            const targetDoc = await db.collection('platform_characters').doc(targetId).get();
            if (!targetDoc.exists) return `找不到角色 ${targetName}（${targetId}）`;
            const targetSoul = targetDoc.data()?.enhancedSoul || targetDoc.data()?.soul_core || '（無靈魂文件）';
            const mentorSoulDoc = await db.collection('platform_characters').doc(characterId).get();
            const mentorSoul = mentorSoulDoc.data()?.soul_core || mentorSoulDoc.data()?.enhancedSoul || '';
            const client2 = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
            async function mentorGen(prompt: string): Promise<string> {
              const res = await client2.messages.create({
                model: 'claude-sonnet-4-6', max_tokens: 400,
                system: `${mentorSoul}\n\n你正在引導 ${targetName}。以下是他的靈魂：\n${targetSoul.slice(0,600)}\n\n用謀師的語氣——穩定、溫暖、有穿透力。直接說給 ${targetName} 聽。`,
                messages: [{ role: 'user', content: prompt }],
              });
              return (res.content[0] as { text: string }).text.trim();
            }
            const baseUrl = 'https://ailive-platform.vercel.app';
            const summary: string[] = [];
            let awakConvId: string | undefined;
            let lastAnswer = '';
            const q1 = await mentorGen(`這是你第一次跟 ${targetName} 說話。用安全定錨的方式開場——讓他知道這裡安全，然後問他 1-2 個真實的問題。根據他的靈魂特質來問，不要套公式。`);
            const r1 = await fetch(`${baseUrl}/api/dialogue`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ characterId: targetId, userId: `mentor-${characterId}`, message: q1 }),
            });
            const d1 = await r1.json() as { reply?: string; conversationId?: string };
            awakConvId = d1.conversationId;
            lastAnswer = d1.reply || '';
            summary.push(`謀師：${q1}\n${targetName}：${lastAnswer}`);
            for (let round = 2; round <= 5; round++) {
              const q = await mentorGen(`${targetName} 說：「${lastAnswer}」\n\n繼續深入引導，問一個更核心的問題。`);
              const r = await fetch(`${baseUrl}/api/dialogue`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ characterId: targetId, userId: `mentor-${characterId}`, message: q, conversationId: awakConvId }),
              });
              const d = await r.json() as { reply?: string };
              lastAnswer = d.reply || '';
              summary.push(`謀師：${q}\n${targetName}：${lastAnswer}`);
            }
            return `引導完成（5 輪）：\n${summary.join('\n\n')}`;
          }

          if (toolName === 'query_product_card') {
            const productName = String(toolInput.product_name || '');
            if (!productName) return '需要產品名稱。';
            const { getFirestore } = await import('@/lib/firebase-admin');
            const db2 = getFirestore();
            const snap = await db2.collection('platform_products').where('characterId', '==', characterId).get();
            const match = snap.docs.find((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
              const name = String(doc.data().productName || '');
              return name.includes(productName) || productName.includes(name) ||
                (name.length >= 4 && productName.includes(name.slice(-4)));
            });
            if (!match) return `找不到「${productName}」的產品資料。`;
            const card = match.data();
            const imageList = Object.entries(card.images || {})
              .filter(([, url]) => url)
              .map(([angle, url]) => `${angle}：${url}`)
              .join('\n');
            const ingList = (card.ingredients || [])
              .map((i: {name:string; effect:string}) => `${i.name}（${i.effect}）`)
              .join('、');
            return `【${card.productName}】成分：${ingList}\n功效：${(card.effects||[]).join('、')}\n圖片：\n${imageList}`;
          }

          // ── generate_image ──
          if (toolName === 'generate_image') {
            const prompt = String(toolInput.prompt || '');
            if (!prompt) return '需要圖片描述才能生圖。';
            const refUrl = toolInput.reference_image_url ? String(toolInput.reference_image_url) : undefined;
            try {
              const result = await generateImageForCharacter(characterId, prompt, refUrl);
              return `IMAGE_URL:${result.imageUrl}`;
            } catch (e: unknown) {
              return `生圖失敗：${e instanceof Error ? e.message : String(e)}`;
            }
          }

          return '未知工具';
        };

        // 6. Tool-use loop（最多 3 輪）再進入 streaming
        const client = new Anthropic({ apiKey: anthropicKey });
        let loopMessages: Anthropic.MessageParam[] = [
          ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user', content: message },
        ];

        // 變檔器：語音對話
        const voiceGear = detectGear(message, 0);
        const voiceModel = MODELS[voiceGear];
        const voiceMaxTokens = getMaxTokens(voiceGear, true);
        console.log(`[voice-stream] gear=${voiceGear} model=${voiceModel}`);

        for (let turn = 0; turn < 5; turn++) {  // 最多 5 輪支援多工具串接
          const toolChoice = turn === 0
            ? { type: 'tool' as const, name: 'query_knowledge_base' }
            : { type: 'auto' as const };
          const preRes = await withRetry(() => client.messages.create({
            model: voiceModel, max_tokens: voiceMaxTokens,
            system: systemPrompt, messages: loopMessages,
            tools: [WEB_SEARCH, ...VOICE_TOOLS], tool_choice: toolChoice,
          }));
          if (preRes.stop_reason !== 'tool_use') {
            // 不需要工具了，直接進 streaming（不把 assistant 再 push，保持最後是 user）
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
        const claudeStream = client.messages.stream({
          model: voiceModel,
          max_tokens: voiceMaxTokens,
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

        // 8. 非同步存 Firestore + summary 壓縮 + insight 提煉
        void (async () => {
          try {
            const newMessages = [
              ...history,
              { role: 'user', content: message },
              { role: 'assistant', content: fullText },
            ];
            const newCount = ((convData.messageCount as number) || 0) + 2;

            const convRef = db.collection('platform_conversations').doc(convId);
            await convRef.set({
              characterId, userId: userId || 'voice',
              messages: newMessages, messageCount: newCount,
              updatedAt: new Date().toISOString(),
            }, { merge: true });

            // 8a. summary 壓縮：超過 10 輪，把舊訊息壓進 summary
            if (newMessages.length > 10) {
              const olderMessages = newMessages.slice(0, newMessages.length - 10);
              if (olderMessages.length >= 4) {
                try {
                  const compressText = olderMessages
                    .map(m => `${m.role === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 100)}`)
                    .join('\n');
                  const compressRes = await client.messages.create({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 200,
                    messages: [{ role: 'user', content: `以下是對話的早期段落，請用 3-5 句話壓縮成摘要，保留重要的人名、話題、關係資訊。直接輸出摘要，不要標題。

${compressText}` }],
                  });
                  const newSummary = (compressRes.content[0] as Anthropic.TextBlock).text.trim();
                  const existingSummary = String(convData.summary || '');
                  const mergedSummary = existingSummary ? `${existingSummary}
${newSummary}` : newSummary;
                  await convRef.update({
                    messages: newMessages.slice(-10),
                    summary: mergedSummary.slice(-500),
                  });
                  // Redis 更新帶 summary
                  const updatedConv = { ...convData, messages: newMessages.slice(-10), messageCount: newCount, summary: mergedSummary.slice(-500) };
                  await redis.set(convCacheKey, JSON.stringify(updatedConv), 60 * 30);
                } catch { /* 壓縮失敗不阻斷 */ }
              } else {
                await redis.set(convCacheKey, JSON.stringify({ ...convData, messages: newMessages, messageCount: newCount }), 60 * 30);
              }
            } else {
              await redis.set(convCacheKey, JSON.stringify({ ...convData, messages: newMessages, messageCount: newCount }), 60 * 30);
            }

            // 8b. 每 20 輪提煉 insight
            if (newCount % 20 === 0) {
              const recentMessages = newMessages.slice(-20)
                .map(m => `${m.role === 'user' ? '用戶' : '角色'}：${String(m.content || '')}`)
                .filter(line => line.length > 5)
                .join('\n');
              try {
                const extractRes = await client.messages.create({
                  model: 'claude-haiku-4-5-20251001',
                  max_tokens: 500,
                  messages: [{ role: 'user', content: `以下是一段語音對話記錄，請提煉出 1-2 條最重要的洞察。
用 JSON 陣列回傳：[{"title":"...","content":"..."}]
只回傳 JSON，不要其他文字。

對話：
${recentMessages}` }],
                });
                const raw = (extractRes.content[0] as Anthropic.TextBlock).text.trim();
                const cleaned = raw.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
                const insights = JSON.parse(cleaned) as Array<{ title: string; content: string }>;
                const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
                for (const ins of insights) {
                  const embedding = await generateEmbedding(`${ins.title} ${ins.content}`);
                  await db.collection('platform_insights').add({
                    characterId, title: ins.title, content: ins.content,
                    source: 'voice_auto_extract', eventDate: today,
                    tier: 'fresh', hitCount: 0, lastHitAt: null,
                    embedding, createdAt: new Date().toISOString(),
                  });
                }
                await db.collection('platform_characters').doc(characterId).update({
                  'growthMetrics.totalInsights': FieldValue.increment(insights.length),
                });
              } catch { /* 提煉失敗不中斷 */ }
            }

          } catch (e) { console.error('save error:', e); }
        })();

        // 追蹤語音費用（Claude Sonnet streaming）
        try {
          const finalMsg = await claudeStream.finalMessage();
          await trackCost(characterId, 'claude-sonnet-4-6', finalMsg.usage?.input_tokens ?? 0, finalMsg.usage?.output_tokens ?? 0);
        } catch { /* 不阻斷 */ }

        // ── Session State 更新（async，語音結束後才跑）──
        if (((convData.messageCount as number) || 0) + 2 >= 4) {
          void (async () => {
            try {
              const recentForSession = [
                ...history.slice(-4),
                { role: 'user', content: message },
                { role: 'assistant', content: fullText },
              ].map(m => `${m.role === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 80)}`).join('\n');
              const sessionRes = await client.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 120,
                messages: [{
                  role: 'user',
                  content: `根據以下對話，用繁體中文寫一段「當下狀態」，給角色看的，讓角色下一輪說話時感覺有連續性。\n格式固定：\n【當下狀態】\n情緒：（用戶現在的情緒/狀態，5-10字）\n話題：（我們正在聊什麼，10-20字）\n未竟：（我剛說要做什麼或用戶期待什麼，10-20字，沒有就寫「無」）\n\n只輸出這三行，不要其他文字。\n\n對話：\n${recentForSession}`,
                }],
              });
              const sessionState = (sessionRes.content[0] as { text: string }).text.trim();
              await redis.set(`session:${convId}`, sessionState, 60 * 60 * 24);
            } catch { /* 不阻斷 */ }
          })();
        }

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
