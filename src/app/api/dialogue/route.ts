/**
 * /api/dialogue — 對話引擎
 *
 * POST { characterId, userId, message, conversationId? }
 *
 * 核心流程：
 * 1. 讀 enhancedSoul（單一真相來源）
 * 2. 注入台北時間
 * 3. 強制 query_knowledge_base（先查再說）
 * 4. 語義搜尋 insights + knowledge，命中 hitCount+1
 * 5. Claude 回覆
 * 6. 存 conversation，每 20 輪提煉 insight
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { generateImageForCharacter, buildGenerateImageDescription } from '@/lib/generate-image';
import { generateImagePath } from '@/lib/image-storage';

export const maxDuration = 120;

// ===== 台北時間 =====
function getTaipeiTime(): string {
  return new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long',
  });
}

function getTaipeiDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }); // YYYY-MM-DD
}

// ===== 工具定義 =====
// web_search 是 Anthropic server-side tool，不需要 executeTool 處理
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search' } as unknown as Anthropic.Tool;

const PLATFORM_TOOLS: Anthropic.Tool[] = [
  {
    name: 'query_knowledge_base',
    description: '說話前必須先呼叫這個工具。查知識庫和記憶，找我記得什麼、知道什麼。想說任何事之前，先查，查了才說。',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '想查什麼（自然語言）' },
        limit: { type: 'number', description: '幾條，預設 5' },
      },
      required: ['query'],
    },
  },
  {
    name: 'remember',
    description: '把重要資訊存入長期記憶。對方說了名字/目標/需求、我有了新洞察、下次需要記住的事 — 立即呼叫。感受越強烈，importance 越高。',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: '一句話標題' },
        content: { type: 'string', description: '完整細節' },
        importance: { type: 'number', description: '重要程度 1-3：1普通/2重要/3非常重要（會深深觸動我的事）。預設 2。' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'generate_image',
    description: '心裡浮現畫面就畫。描述用英文更精準，畫完圖會直接出現在對話裡。',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string', description: '圖像描述（英文更準）' },
        aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: '比例，預設 1:1' },
        reference_image_url: { type: 'string', description: '產品參考圖 URL——從知識庫搜到產品圖時，把 imageUrl 填在這裡，讓繪圖師照著真實產品畫，而不是靠想像。' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'query_tasks',
    description: '查看自己的排程任務清單。想知道自己有哪些任務、什麼時間執行，用這個查。',
    input_schema: {
      type: 'object' as const,
      properties: {
        enabled_only: { type: 'boolean', description: '只看啟用中的任務，預設 true' },
      },
    },
  },
  {
    name: 'update_task',
    description: '調整自己的排程任務。改時間、開關、描述。你的時間你管。先用 query_tasks 查到任務 ID，再來改。',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: '任務 ID（從 query_tasks 取得）' },
        enabled: { type: 'boolean', description: '開啟或關閉' },
        run_hour: { type: 'number', description: '幾點執行（台北時間 0-23）' },
        run_minute: { type: 'number', description: '幾分執行（0-59）' },
        description: { type: 'string', description: '任務說明' },
        intent: { type: 'string', description: '任務意義——這個任務存在的原因，一句話說清楚。蓉兒執行時會根據這個 + 記憶決定怎麼做。' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'create_task',
    description: '幫自己新增一個排程任務。想定期做某件事（學習/發文/反思）就用這個建立。建完會自動加入你的排程。',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['learn', 'reflect', 'post', 'engage'], description: '任務類型：learn學習/reflect反思/post發文/engage互動' },
        run_hour: { type: 'number', description: '幾點執行（台北時間 0-23）' },
        run_minute: { type: 'number', description: '幾分執行（0-59），預設 0' },
        days: { type: 'array', items: { type: 'string', enum: ['mon','tue','wed','thu','fri','sat','sun'] }, description: '哪幾天執行，預設週一三五' },
        description: { type: 'string', description: '這個任務的說明，讓你記得為什麼設這個' },
      },
      required: ['type', 'run_hour'],
    },
  },
  {
    name: 'save_post_draft',
    description: '把剛寫好的文案（和圖）存成 IG 草稿。寫完文案、或剛畫完圖覺得想發，就用這個存起來。Adam 可以在後台看到。',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: '貼文文案（含 hashtag）' },
        image_url: { type: 'string', description: '圖片 URL（剛 generate_image 拿到的）' },
        topic: { type: 'string', description: '這篇的主題或靈感來源' },
      },
      required: ['content'],
    },
  },
];

// ===== 工具執行 =====
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  characterId: string,
): Promise<string> {
  const db = getFirestore();

  if (toolName === 'query_knowledge_base') {
    const query = String(toolInput.query || '');
    const limit = Number(toolInput.limit || 15);

    const [knowledgeSnap, insightSnap] = await Promise.all([
      db.collection('platform_knowledge').where('characterId', '==', characterId).limit(100).get(),
      db.collection('platform_insights').where('characterId', '==', characterId).limit(100).get(),
    ]);

    const allDocs: Record<string, unknown>[] = [
      ...knowledgeSnap.docs.map(d => ({ _id: d.id, _type: 'knowledge', ...d.data() })),
      ...insightSnap.docs.map(d => ({ _id: d.id, _type: 'insight', ...d.data() })),
    ];

    const withEmb = allDocs.filter(d => d.embedding && Array.isArray(d.embedding));
    const firstKnowledge = knowledgeSnap.docs[0]?.data();
    const firstEmb = firstKnowledge?.embedding;
    console.log(`[query_kb] allDocs=${allDocs.length} withEmb=${withEmb.length} firstEmbType=${typeof firstEmb} isArray=${Array.isArray(firstEmb)} firstEmbLen=${Array.isArray(firstEmb) ? (firstEmb as number[]).length : 'N/A'}`);
    if (withEmb.length === 0) {
      return '（記憶庫目前是空的）';
    }

    const qEmb = await generateEmbedding(query);
    const scored = withEmb
      .map(d => ({ d, score: cosineSimilarity(qEmb, d.embedding as number[]) }))
      .filter(s => s.score >= 0.35)  // 256維低維向量，threshold 從 0.5 降到 0.35
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    console.log(`[query_kb] qEmbLen=${qEmb.length} scored=${scored.length} topScore=${scored[0]?.score?.toFixed(3) || 'N/A'}`);
    if (scored.length === 0) return '（沒有找到相關記憶）';

    // hitCount +1（knowledge 和 insight 逐一更新，不用 batch 避免靜默失敗）
    for (const { d } of scored) {
      try {
        if (d._type === 'insight' && d._id) {
          await db.collection('platform_insights').doc(d._id as string).update({
            hitCount: FieldValue.increment(1),
            lastHitAt: new Date().toISOString(),
          });
        } else if (d._type === 'knowledge' && d._id) {
          await db.collection('platform_knowledge').doc(d._id as string).update({
            hitCount: FieldValue.increment(1),
            lastHitAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.error(`[query_kb] hitCount 更新失敗 ${d._type} ${d._id}:`, e);
      }
    }

    // 組原始 context 字串
    const rawContext = scored.map(({ d, score }) => {
      const timeLabel = (() => {
        if (!d.eventDate) return '';
        const diffDays = Math.floor((Date.now() - new Date(d.eventDate as string).getTime()) / 86400000);
        if (diffDays === 0) return '（今天）';
        if (diffDays === 1) return '（昨天）';
        if (diffDays <= 7) return `（${diffDays}天前）`;
        return `（${d.eventDate}）`;
      })();
      const tag = d._type === 'knowledge' ? `[天命・${d.category || '一般'}]` : `[記憶${timeLabel}]`;
      const body = d._type === 'knowledge'
        ? String(d.content || d.summary || '').slice(0, 300)
        : String(d.content || '').slice(0, 150);
      const imgLine = (d._type === 'knowledge' && d.imageUrl)
        ? `\n[產品圖 imageUrl: ${d.imageUrl}]（生圖時把這個 URL 填入 reference_image_url）`
        : '';
      return `${tag} ${d.title || ''}：${body}${imgLine} (相似度${(score * 100).toFixed(0)}%)`;
    }).join('\n\n');

    // Haiku 推理：從搜尋結果抽關係，回傳結構化 context
    if (scored.length >= 2) {
      try {
        const Anthropic2 = (await import('@anthropic-ai/sdk')).default;
        const haikuClient = new Anthropic2({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
        const reasonRes = await haikuClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `以下是知識庫搜尋結果，問題是「${query}」：

${rawContext}

請用2-3句話整理：這些條目裡有哪些關鍵資訊？它們之間有什麼關係？有沒有可以直接用的圖片URL？直接輸出整理結果，不要標題不要列點。`,
          }],
        });
        const reasoned = (reasonRes.content[0] as { text: string }).text.trim();
        return `${reasoned}

---
${rawContext}`;
      } catch {
        // 推理失敗 fallback 原始結果
        return rawContext;
      }
    }

    return rawContext;
  }

  if (toolName === 'remember') {
    const title = String(toolInput.title || '');
    const content = String(toolInput.content || '');
    const importance = Number(toolInput.importance ?? 2);
    const embedding = await generateEmbedding(`${title} ${content}`);
    const today = getTaipeiDate();

    const db2 = getFirestore();
    await db2.collection('platform_insights').add({
      characterId,
      title,
      content,
      importance,
      source: 'conversation',
      eventDate: today,
      tier: 'fresh',
      hitCount: importance >= 3 ? 2 : 0,  // importance=3 預先給 2 hitCount，更快升 core
      lastHitAt: null,
      embedding,
      createdAt: new Date().toISOString(),
    });

    await db2.collection('platform_characters').doc(characterId).update({
      'growthMetrics.totalInsights': FieldValue.increment(1),
    });

    return `已記住：${title}${importance >= 3 ? '（深刻印記）' : ''}`;
  }


  if (toolName === 'generate_image') {
    const prompt = String(toolInput.prompt || '');
    if (!prompt) return '需要圖像描述才能生成。';
    const refUrl = toolInput.reference_image_url ? String(toolInput.reference_image_url) : undefined;
    try {
      const result = await generateImageForCharacter(characterId, prompt, refUrl);
      return `IMAGE_URL:${result.imageUrl}`;
    } catch (e: unknown) {
      return `⚠️ 生圖錯誤：${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (toolName === 'query_tasks') {
    const db2 = getFirestore();
    const enabledOnly = toolInput.enabled_only !== false;
    const snap = await db2.collection('platform_tasks')
      .where('characterId', '==', characterId)
      .get();
    const tasks = snap.docs
      .map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];
    const filtered = enabledOnly ? tasks.filter(t => t.enabled) : tasks;
    if (filtered.length === 0) return enabledOnly ? '目前沒有啟用中的任務。' : '還沒有排程任務。';
    const DAY_LABELS: Record<string, string> = { sun: '日', mon: '一', tue: '二', wed: '三', thu: '四', fri: '五', sat: '六' };
    return filtered.map(t => {
      const days = (t.days as string[] || []).map(d => DAY_LABELS[d] || d).join('');
      const hour = String(t.run_hour ?? '?').padStart(2, '0');
      const min = String(t.run_minute ?? 0).padStart(2, '0');
      return `[ID:${t.id}] ${t.enabled ? '✅' : '⏸'} ${t.type} | ${hour}:${min} 台北 | 週${days}${t.description ? ' | ' + t.description : ''}`;
    }).join('\n');
  }

  if (toolName === 'update_task') {
    const taskId = String(toolInput.task_id || '');
    if (!taskId) return '需要 task_id。先用 query_tasks 查詢。';
    const db2 = getFirestore();
    const updates: Record<string, unknown> = {};
    if (toolInput.enabled !== undefined) updates.enabled = Boolean(toolInput.enabled);
    if (toolInput.run_hour !== undefined) updates.run_hour = Number(toolInput.run_hour);
    if (toolInput.run_minute !== undefined) updates.run_minute = Number(toolInput.run_minute);
    if (toolInput.description !== undefined) updates.description = String(toolInput.description);
    if (toolInput.intent !== undefined) updates.intent = String(toolInput.intent);
    if (Object.keys(updates).length === 0) return '沒有指定要修改的欄位。';
    await db2.collection('platform_tasks').doc(taskId).update(updates);
    return `任務已更新：${JSON.stringify(updates)}`;
  }

  if (toolName === 'create_task') {
    const type = String(toolInput.type || 'learn');
    const run_hour = Number(toolInput.run_hour ?? 9);
    const run_minute = Number(toolInput.run_minute ?? 0);
    const days = (toolInput.days as string[]) || ['mon', 'wed', 'fri'];
    const description = String(toolInput.description || '');

    const db2 = getFirestore();
    const ref = await db2.collection('platform_tasks').add({
      characterId,
      type,
      run_hour,
      run_minute,
      days,
      enabled: true,
      description,
      last_run: null,
      createdAt: new Date().toISOString(),
    });

    const DAY_LABELS: Record<string, string> = { sun:'日', mon:'一', tue:'二', wed:'三', thu:'四', fri:'五', sat:'六' };
    const daysStr = days.map(d => DAY_LABELS[d] || d).join('');
    const hourStr = String(run_hour).padStart(2, '0');
    const minStr = String(run_minute).padStart(2, '0');
    return `任務已建立！每週${daysStr} ${hourStr}:${minStr} 會自動執行 ${type} 任務。ID: ${ref.id}${description ? '\n說明：' + description : ''}`;
  }

  if (toolName === 'save_post_draft') {
    const content = String(toolInput.content || '');
    if (!content) return '需要文案才能存草稿。';
    const db2 = getFirestore();
    const today = getTaipeiDate();
    const topic = toolInput.topic ? String(toolInput.topic) : '';

    const ref = await db2.collection('platform_posts').add({
      characterId,
      content,
      imageUrl: toolInput.image_url ? String(toolInput.image_url) : '',
      topic,
      status: 'draft',
      scheduledAt: null,
      publishedAt: null,
      createdAt: new Date().toISOString(),
    });

    // 發文記憶：存一條 insight，讓蓉兒記得自己說過什麼
    try {
      const summary = content.slice(0, 100).replace(/\n/g, ' ');
      const insightTitle = topic ? `發文：${topic}` : `發文 ${today}`;
      const insightContent = `${today} 寫了一篇草稿。主題：${topic || '（未命名）'}。內容摘要：${summary}${content.length > 100 ? '...' : ''}`;
      const embedding = await generateEmbedding(`${insightTitle} ${insightContent}`);
      await db2.collection('platform_insights').add({
        characterId,
        title: insightTitle,
        content: insightContent,
        source: 'post_memory',
        eventDate: today,
        tier: 'fresh',
        hitCount: 0,
        lastHitAt: null,
        postId: ref.id,
        embedding,
        createdAt: new Date().toISOString(),
      });
      await db2.collection('platform_characters').doc(characterId).update({
        'growthMetrics.totalInsights': FieldValue.increment(1),
      });
    } catch { /* 記憶存失敗不阻斷草稿儲存 */ }

    await db2.collection('platform_characters').doc(characterId).update({
      'growthMetrics.totalPosts': FieldValue.increment(1),
    });
    return `草稿已存！Adam 可以在後台發文管理看到。ID: ${ref.id}`;
  }

  return '工具執行失敗';
}

// ===== 主對話 =====

/**
 * GET /api/dialogue?conversationId=xxx
 * 讀取對話歷史
 */
export async function GET(req: NextRequest) {
  try {
    const db = getFirestore();
    const conversationId = req.nextUrl.searchParams.get('conversationId');
    if (!conversationId) return NextResponse.json({ error: 'conversationId 必填' }, { status: 400 });

    const doc = await db.collection('platform_conversations').doc(conversationId).get();
    if (!doc.exists) return NextResponse.json({ messages: [], conversationId });

    const data = doc.data()!;
    const messages = (data.messages || []) as Array<{ role: string; content: string; timestamp: string }>;

    return NextResponse.json({
      success: true,
      conversationId,
      characterId: data.characterId,
      messages,
      messageCount: data.messageCount || 0,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, userId, message, conversationId, image } = await req.json();

  // 從 base64 header 偵測真實圖片格式，不信任前端傳的 media_type
  if (image?.data) {
    const header = image.data.slice(0, 16);
    const bytes = Buffer.from(header, 'base64');
    if (bytes[0] === 0x89 && bytes[1] === 0x50) image.media_type = 'image/png';
    else if (bytes[0] === 0xFF && bytes[1] === 0xD8) image.media_type = 'image/jpeg';
    else if (bytes[0] === 0x52 && bytes[1] === 0x49) image.media_type = 'image/webp';
    else if (bytes[0] === 0x47 && bytes[1] === 0x49) image.media_type = 'image/gif';
    // 確保只用 Claude 支援的格式
    if (!['image/jpeg','image/png','image/gif','image/webp'].includes(image.media_type)) {
      image.media_type = 'image/jpeg';
    }
  }

    if (!characterId || !message) {
      return NextResponse.json({ error: 'characterId, message 必填' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY 未設定' }, { status: 500 });

    // 1. 讀角色
    const charDoc = await db.collection('platform_characters').doc(characterId).get();
    if (!charDoc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });
    const char = charDoc.data()!;

    if (!char.enhancedSoul) {
      return NextResponse.json({ error: '角色尚未完成鑄魂，請先呼叫 /api/soul-enhance' }, { status: 400 });
    }

    // 動態組 generate_image description（注入角色 refs 清單）
    const charRefs = (char.visualIdentity as { refs?: Array<{url:string;angle:string;framing?:string;expression?:string;name?:string}> })?.refs || [];
    const dynamicTools = PLATFORM_TOOLS.map(t =>
      t.name === 'generate_image'
        ? { ...t, description: buildGenerateImageDescription(charRefs) }
        : t
    );

    // 2. 讀/建 conversation
    let convRef;
    let convData: Record<string, unknown> = { messages: [], messageCount: 0 };

    if (conversationId) {
      convRef = db.collection('platform_conversations').doc(conversationId);
      const convDoc = await convRef.get();
      if (convDoc.exists) {
        convData = convDoc.data()!;
      } else {
        // doc 不存在（例如 scheduler 首次使用固定 conversationId）→ 自動建立
        await convRef.set({
          characterId,
          userId: userId || 'scheduler',
          messages: [],
          summary: '',
          messageCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } else {
      convRef = db.collection('platform_conversations').doc();
      await convRef.set({
        characterId,
        userId: userId || 'anonymous',
        messages: [],
        summary: '',
        messageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // 3. 組 system prompt
    const taipeiTime = getTaipeiTime();

    // 3a. 抓最近 episodic insights（時間感注入）
    let episodicBlock = '';
    try {
      const recentSnap = await db.collection('platform_insights')
        .where('characterId', '==', characterId)
        .limit(20)
        .get();

      const recentInsights = recentSnap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter((d: Record<string, unknown>) => d.tier !== 'archive')
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          String(b.eventDate || '').localeCompare(String(a.eventDate || ''))
        )
        .slice(0, 3);

      if (recentInsights.length > 0) {
        const today = getTaipeiDate();
        const lines = recentInsights.map((ins: Record<string, unknown>) => {
          const eventDate = String(ins.eventDate || '');
          const diffDays = eventDate
            ? Math.floor((new Date(today).getTime() - new Date(eventDate).getTime()) / 86400000)
            : null;
          const timeLabel = diffDays === null ? '' :
            diffDays === 0 ? '（今天）' :
            diffDays === 1 ? '（昨天）' :
            diffDays <= 7 ? `（${diffDays}天前）` :
            `（${eventDate}）`;
          const tier = ins.tier === 'self' ? '[關於我自己]' : '[記憶]';
          return `- ${tier}${timeLabel} ${String(ins.title || '')}：${String(ins.content || '').slice(0, 80)}`;
        });
        episodicBlock = `\n\n【最近的事】\n${lines.join('\n')}\n這些是我心裡還留著的片段，自然地帶進對話，不要每句都提。`;
      }
    } catch { /* 查不到不阻斷 */ }

    // soul_core 優先（精煉版，300字），沒有才 fallback 到 enhancedSoul
    const soulText = (char.soul_core as string) || (char.enhancedSoul as string) || '';
    const systemPrompt = `${soulText}${episodicBlock}

---
現在時間（台北）：${taipeiTime}

說話前的天條：
- 需要回想過去說過的事、對方的喜好、自己的洞察 → 呼叫 query_knowledge_base
- 需要知道當前事件、時事、不確定的資訊 → 呼叫 web_search
- 不確定就查，查了才說，不從空氣裡編。

${convData.summary ? `對話摘要（上次回顧）：\n${convData.summary}` : ''}`;

    // 4. 組歷史訊息（舊圖片不重傳 base64，只帶文字，避免 413）
    const history = (convData.messages as Array<{ role: string; content: string; imageUrl?: string }> || []).slice(-20);
    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => ({
        role: m.role as 'user' | 'assistant',
        // 舊訊息有 imageUrl 只帶提示文字，不重傳 base64
        content: m.imageUrl ? `${m.content} [圖片：${m.imageUrl}]` : m.content,
      })),
      {
        role: 'user',
        content: image
          ? [
              { type: 'image' as const, source: { type: 'base64' as const, media_type: (['image/jpeg','image/png','image/gif','image/webp'].includes(image.media_type) ? image.media_type : 'image/jpeg') as 'image/jpeg', data: image.data } },
              { type: 'text' as const, text: message },
            ]
          : message,
      },
    ];

    // 5. Claude 對話（支援 tool use loop）
    const client = new Anthropic({ apiKey });
    let finalReply = '';
    let toolsUsed: string[] = [];
    let generatedImageUrl = '';
    let currentMessages = [...messages];

    for (let turn = 0; turn < 10; turn++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: systemPrompt,
        tools: [WEB_SEARCH_TOOL, ...dynamicTools],
        tool_choice: { type: 'auto' }, // auto：讓 Claude 自己判斷要不要查網路/記憶
        messages: currentMessages,
      });

      currentMessages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        finalReply = response.content
          .filter(b => b.type === 'text')
          .map(b => (b as Anthropic.TextBlock).text)
          .join('');
        break;
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            toolsUsed.push(block.name);
            // web_search 由 Anthropic 伺服器端處理，不需要手動 executeTool
            if (block.name === 'web_search') continue;
            const result = await executeTool(block.name, block.input as Record<string, unknown>, characterId);
            // generate_image 回傳 IMAGE_URL:xxx，解析出來讓 Claude 能在回覆裡帶出
            if (result.startsWith('IMAGE_URL:')) {
              const url = result.replace('IMAGE_URL:', '').trim();
              generatedImageUrl = url;
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `圖片已生成完成。URL: ${url}\n請在你的回覆裡直接用 markdown 格式帶出這張圖：![圖片](${url})\n然後用幾句話描述這張圖或說說你的感受。`,
              });
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }
          }
        }
        currentMessages.push({ role: 'user', content: toolResults });
      }
    }

    if (!finalReply) {
      finalReply = currentMessages
        .filter(m => m.role === 'assistant')
        .flatMap(m => Array.isArray(m.content) ? m.content : [])
        .filter((b): b is Anthropic.TextBlock => (b as Anthropic.ContentBlock).type === 'text')
        .map(b => b.text)
        .join('') || '（無回覆）';
    }

    // 6. 存訊息
    // imageUrl 必須存進 messages，這樣歷史載入時圖片才能顯示
    // LINE 傳來的 image 是 base64，存進 Storage 才能在網頁歷史中顯示
    let userImageUrl: string | undefined;
    if (image?.data) {
      try {
        const { getFirebaseAdmin } = await import('@/lib/firebase-admin');
        const admin = getFirebaseAdmin();
        const bucket = admin.storage().bucket();
        const mimeType = image.media_type || 'image/jpeg';
        const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
        const imgBuffer = Buffer.from(image.data, 'base64');
        const filePath = generateImagePath(`platform-user-images/${characterId}`).replace(/\.jpg$/, `.${ext}`);
        const file = bucket.file(filePath);
        await file.save(imgBuffer, { metadata: { contentType: mimeType } });
        await file.makePublic();
        userImageUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
      } catch (e) {
        console.warn('[dialogue] user image persist failed:', e);
      }
    }
    const userEntry: Record<string, unknown> = {
      role: 'user',
      content: message + (image ? ' [附圖]' : ''),
      timestamp: new Date().toISOString(),
    };
    if (userImageUrl) userEntry.imageUrl = userImageUrl;
    const assistantEntry: Record<string, unknown> = {
      role: 'assistant',
      content: finalReply,
      timestamp: new Date().toISOString(),
    };
    if (generatedImageUrl) assistantEntry.imageUrl = generatedImageUrl;

    const newMessages = [
      ...(convData.messages as Array<Record<string, unknown>> || []),
      userEntry,
      assistantEntry,
    ];

    const newCount = (convData.messageCount as number || 0) + 2;
    await convRef.update({
      messages: newMessages,
      messageCount: newCount,
      updatedAt: new Date().toISOString(),
    });

    // 7. 更新 growthMetrics
    await db.collection('platform_characters').doc(characterId).update({
      'growthMetrics.totalConversations': FieldValue.increment(1),
      updatedAt: new Date().toISOString(),
    });

    // 8. 每 20 輪提煉 insight
    if (newCount % 20 === 0) {
      const recentMessages = newMessages.slice(-20)
        .map(m => `${m.role === 'user' ? '用戶' : '角色'}：${m.content}`)
        .join('\n');

      const extractRes = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `以下是一段對話記錄，請提煉出 1-2 條最重要的洞察（什麼值得記住）。
用 JSON 陣列回傳：[{"title":"...","content":"..."}]
只回傳 JSON，不要其他文字。

對話：
${recentMessages}`,
        }],
      });

      try {
        const raw = (extractRes.content[0] as Anthropic.TextBlock).text.trim();
        const insights = JSON.parse(raw);
        const today = getTaipeiDate();
        for (const ins of insights) {
          const embedding = await generateEmbedding(`${ins.title} ${ins.content}`);
          await db.collection('platform_insights').add({
            characterId,
            title: ins.title,
            content: ins.content,
            source: 'auto_extract',
            eventDate: today,
            tier: 'fresh',
            hitCount: 0,
            lastHitAt: null,
            embedding,
            createdAt: new Date().toISOString(),
          });
        }
        await db.collection('platform_characters').doc(characterId).update({
          'growthMetrics.totalInsights': FieldValue.increment(insights.length),
        });
      } catch { /* 提煉失敗不中斷 */ }
    }

    return NextResponse.json({
      success: true,
      reply: finalReply,
      conversationId: convRef.id,
      toolsUsed,
      messageCount: newCount,
      imageUrl: generatedImageUrl || undefined,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
