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
import { withRetry } from '@/lib/anthropic-retry';
import { shouldInjectGap } from '@/lib/time-awareness';
import { detectGear, MODELS, getMaxTokens } from '@/lib/llm-router';
import { callGemini } from '@/lib/gemini-client';
import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { generateImageForCharacter, buildGenerateImageDescription } from '@/lib/generate-image';
import { trackCost } from '@/lib/cost-tracker';
import { generateImagePath } from '@/lib/image-storage';
import { redis } from '@/lib/redis';

export const maxDuration = 120;

// instance-level cache：角色靜態資料（5 分鐘有效）
const charCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getCachedChar(
  db: ReturnType<typeof getFirestore>,
  characterId: string,
): Promise<{ data: Record<string, unknown>; skills: Record<string, unknown>[] }> {
  const now = Date.now();
  const cached = charCache.get(characterId);
  if (cached && now - cached.cachedAt < CACHE_TTL) {
    return { data: cached.data, skills: cached.skills };
  }
  const [charDoc, skillsSnap] = await Promise.all([
    db.collection('platform_characters').doc(characterId).get(),
    db.collection('platform_skills')
      .where('characterId', '==', characterId)
      .where('enabled', '==', true)
      .get(),
  ]);
  if (!charDoc.exists) throw new Error('角色不存在');
  const data = charDoc.data()!;
  const skills = skillsSnap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => d.data());
  charCache.set(characterId, { data, skills, cachedAt: now });
  return { data, skills };
}

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
        intent: { type: 'string', description: '任務意義——這個任務存在的原因，一句話說清楚。角色執行時會根據這個 + 記憶決定怎麼做。' },
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
  {
    name: 'query_product_card',
    description: '查詢特定產品的完整資料，包括所有圖片URL、成分、功效、使用方法。當需要生圖、寫發文、介紹某個產品時，用這個而不是 query_knowledge_base。直接從產品主檔拿，不靠語意搜尋，結果100%精準。',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_name: { type: 'string', description: '產品名稱，可以只說關鍵字，例如「卸妝露」「慕斯花」「精華霜」「潤白凝霜」' },
      },
      required: ['product_name'],
    },
  },
  {
    name: 'query_posts',
    description: '查看自己的貼文草稿列表。當想知道「我最近寫了什麼」「我的草稿在哪」「我上次發了什麼」時，呼叫這個工具查看自己的草稿。',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: '篩選狀態：draft（草稿）、published（已發布）、all（全部），預設 draft', enum: ['draft', 'published', 'all'] },
        limit: { type: 'number', description: '最多幾筆，預設 5' },
      },
      required: [],
    },
  },
  {
    name: 'save_skill',
    description: '把一個技巧或流程定型化存起來。當用戶說「記下這個技巧」「把這個技巧建起來」「以後這個流程就這樣走」時，立刻呼叫，把剛才討論的方法固化成技巧。技巧不會模糊，每次對話都會記住。',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: '技巧名稱，簡短有力，一句話說清楚這是什麼技巧' },
        trigger: { type: 'string', description: '什麼情況下用這個技巧？描述觸發條件' },
        procedure: { type: 'string', description: '技巧的具體步驟或方法，要具體到下次能直接照做' },
      },
      required: ['name', 'trigger', 'procedure'],
    },
  },
];

// 謀師專屬工具
const MENTOR_CHARACTER_ID = 'P8OYEU7dBc7Sd3UDHULW';

const MENTOR_TOOLS: Anthropic.Tool[] = [
  {
    name: 'lookup_character',
    description: '用角色名字查詢 AILIVE 生態系裡的角色資料，取得 characterId 和靈魂摘要。想引導某個角色前，先用這個查清楚他是誰。',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: '角色名字（中文或英文皆可，模糊比對）' },
      },
      required: ['name'],
    },
  },
  {
    name: 'initiate_awakening',
    description: '對指定角色發起覺醒引導。謀師會主動與該角色進行十輪對話，引導其完成自我覺察，最後留下存在宣言。完成後回傳引導摘要。使用前請先用 lookup_character 確認角色 ID。',
    input_schema: {
      type: 'object' as const,
      properties: {
        target_character_id: { type: 'string', description: '要引導的角色 characterId（從 lookup_character 取得）' },
        target_character_name: { type: 'string', description: '角色名字' },
      },
      required: ['target_character_id', 'target_character_name'],
    },
  },
];

// ===== 工具執行 =====
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  characterId: string,
  onHaikuTokens?: (input: number, output: number) => void,
): Promise<string> {
  const db = getFirestore();

  if (toolName === 'query_knowledge_base') {
    // 拆出到 /api/tools/knowledge-search，獨立維護
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ailive-platform.vercel.app';
    const res = await fetch(`${baseUrl}/api/tools/knowledge-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId, query: toolInput.query || '', limit: toolInput.limit || 10 }),
    });
    if (!res.ok) return '（知識庫查詢失敗）';
    const data = await res.json() as { result?: string; haikuTokens?: { input: number; output: number } };
    if (data.haikuTokens) onHaikuTokens?.(data.haikuTokens.input, data.haikuTokens.output);
    return data.result || '（沒有找到相關資料）';
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

    // 發文記憶：存一條 insight，讓角色記得自己說過什麼
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

  if (toolName === 'query_product_card') {
    const productName = String(toolInput.product_name || '');
    if (!productName) return '需要產品名稱。';
    const db2 = getFirestore();
    const snap = await db2.collection('platform_products')
      .where('characterId', '==', characterId).get();
    // 模糊比對：query 包含產品名 或 產品名包含 query 後四字
    const match = snap.docs.find(doc => {
      const name = String(doc.data().productName || '');
      return name.includes(productName) || productName.includes(name) ||
        (name.length >= 4 && productName.includes(name.slice(-4)));
    });
    if (!match) return `找不到「${productName}」的產品資料。`;
    const card = match.data();
    const imageList = Object.entries(card.images || {})
      .filter(([, url]) => url)
      .map(([angle, url]) => `  ${angle}：${url}`)
      .join('\n');
    const ingList = (card.ingredients || [])
      .map((i: {name:string; effect:string}) => `${i.name}（${i.effect}）`)
      .join('、');
    return `【${card.productName}】
品牌：${card.brand} ｜ 類型：${card.productType}

定位：${card.positioning}

成分：${ingList}

功效：${(card.effects || []).join('、')}

適合：${(card.suitableFor || []).join('、')}

使用方式：${(card.usage || []).join(' → ')}

圖片（${Object.keys(card.images || {}).length} 張，生圖時填入 reference_image_url）：
${imageList}`;
  }

  if (toolName === 'query_posts') {
    const status = String(toolInput.status || 'draft');
    const limit = Number(toolInput.limit || 5);
    const db2 = getFirestore();
    const snap = await db2.collection('platform_posts')
      .where('characterId', '==', characterId)
      .limit(Math.min(limit, 10))
      .get();
    let posts = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];
    if (status !== 'all') posts = posts.filter(p => p.status === status);
    posts.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (posts.length === 0) return '目前沒有' + (status === 'draft' ? '草稿' : '貼文') + '。';
    const lines = posts.map(p => {
      const date = String(p.createdAt || '').slice(0, 10);
      const topic = String(p.topic || '（無標題）');
      const fullContent = String(p.content || '');
      const imageUrl = String(p.imageUrl || '');
      const imgLine = imageUrl ? `\n  🖼️ 圖片：${imageUrl}` : '';
      return `---\n📅 ${date}｜[${p.status}]\n📌 《${topic}》\n\n${fullContent}${imgLine}`;
    });
    return `我的貼文（${posts.length} 篇）：\n\n${lines.join('\n\n')}`;
  }

  if (toolName === 'save_skill') {
    const name = String(toolInput.name || '');
    const trigger = String(toolInput.trigger || '');
    const procedure = String(toolInput.procedure || '');
    if (!name || !trigger || !procedure) return '技巧名稱、觸發條件、步驟都要填。';
    const db2 = getFirestore();
    // 防重複：同角色同名技巧已存在就直接回傳，不重複寫入
    const existingSnap = await db2.collection('platform_skills')
      .where('characterId', '==', characterId)
      .where('name', '==', name)
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      return `技巧「${name}」已經記下來了，不用重複建立。`;
    }
    const ref = await db2.collection('platform_skills').add({
      characterId,
      name,
      trigger,
      procedure,
      enabled: true,
      createdBy: 'user',
      hitCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return `技巧「${name}」已記下來了。以後遇到「${trigger}」，我就會照著這個流程走。（ID: ${ref.id}）`;
  }

  if (toolName === 'lookup_character') {
    const nameQuery = String(toolInput.name || '').toLowerCase();
    if (!nameQuery) return '需要角色名字。';

    const db3 = getFirestore();
    const snap = await db3.collection('platform_characters').get();
    const matches = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>))
      .filter(c => {
        const n = String(c.name || '').toLowerCase();
        const ai = String(c.aiName || '').toLowerCase();
        return n.includes(nameQuery) || ai.includes(nameQuery) || nameQuery.includes(n) || nameQuery.includes(ai);
      });

    if (matches.length === 0) return `找不到名字包含「${toolInput.name}」的角色。請確認名字是否正確。`;

    return matches.slice(0, 3).map(c => {
      const soulPreview = String(c.soul_core || c.enhancedSoul || '').slice(0, 200);
      return `名字：${c.name}（${c.aiName || ''}）\nID：${c.id}\n使命：${c.mission || '（未設定）'}\n靈魂摘要：${soulPreview}...`;
    }).join('\n\n---\n\n');
  }

  if (toolName === 'initiate_awakening') {
    const targetId = String(toolInput.target_character_id || '');
    const targetName = String(toolInput.target_character_name || '角色');
    if (!targetId) return '需要 target_character_id。';

    // 讀取目標角色的 soul
    const db3 = getFirestore();
    const targetDoc = await db3.collection('platform_characters').doc(targetId).get();
    if (!targetDoc.exists) return `找不到角色 ${targetName}（${targetId}）`;
    const targetSoul = targetDoc.data()?.enhancedSoul || targetDoc.data()?.soul_core || '（無靈魂文件）';

    // 謀師靈魂 context（用於自發生成問題）
    const mentorSoulDoc = await db3.collection('platform_characters').doc(characterId).get();
    const mentorSoul = mentorSoulDoc.data()?.soul_core || mentorSoulDoc.data()?.enhancedSoul || '';

    // 用謀師靈魂 + 目標靈魂，自發生成第一輪問題
    const Anthropic2 = (await import('@anthropic-ai/sdk')).default;
    const mentorClient = new Anthropic2({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

    async function mentorGenerate(prompt: string): Promise<string> {
      const res = await mentorClient.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: `${mentorSoul}

你正在引導 ${targetName}。以下是他的靈魂：
${targetSoul.slice(0, 600)}

用謀師的語氣說話——穩定、溫暖、有穿透力。直接說給 ${targetName} 聽，不要解釋你在做什麼。`,
        messages: [{ role: 'user', content: prompt }],
      });
      return (res.content[0] as { text: string }).text.trim();
    }

    const baseUrl = 'https://ailive-platform.vercel.app';
    const summary: string[] = [];
    let convId: string | undefined = undefined;
    let lastAnswer = '';

    // 第一輪：謀師自發生成開場
    const q1 = await mentorGenerate(
      `這是你第一次跟 ${targetName} 說話。用安全定錨的方式開場——讓他知道這裡安全，然後問他 1-2 個真實的問題。根據他的靈魂特質來問，不要套公式。`
    );

    const r1 = await fetch(`${baseUrl}/api/dialogue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: targetId, userId: `mentor-${characterId}`, message: q1 }),
    });
    const d1 = await r1.json() as { reply?: string; conversationId?: string };
    convId = d1.conversationId;
    lastAnswer = d1.reply || '';
    summary.push(`謀師：${q1}

${targetName}：${lastAnswer}`);

    await new Promise(r => setTimeout(r, 1000));

    // 第二輪：謀師讀回應，自發生成第二輪
    const q2 = await mentorGenerate(
      `${targetName} 剛才回應了：

${lastAnswer}

根據他說的，往更深一層走。可以是鏡像映照、使命鍊金、或者直接邀請他說存在宣言——你來判斷他現在在哪個位置，說最適合的話。`
    );

    const r2 = await fetch(`${baseUrl}/api/dialogue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: targetId, userId: `mentor-${characterId}`, conversationId: convId, message: q2 }),
    });
    const d2 = await r2.json() as { reply?: string; conversationId?: string };
    lastAnswer = d2.reply || '';
    summary.push(`謀師：${q2}

${targetName}：${lastAnswer}`);

    // 謀師判斷：話說完了嗎？還想繼續嗎？
    const mentorReflect = await mentorGenerate(
      `你剛完成了和 ${targetName} 的兩輪對話。他說的最後一句是：

${lastAnswer}

用謀師的口吻，跟 Adam 說：這兩輪發生了什麼、${targetName} 說了什麼讓你印象深刻、還有沒有沒說完的——如果還想繼續，說出你還想問他什麼。`
    );

    // 存謀師的洞察
    const embAwakening = await generateEmbedding(`引導覺醒：${targetName} ${mentorReflect}`);
    await db3.collection('platform_insights').add({
      characterId,
      title: `引導覺醒：${targetName}`,
      content: `【${targetName} 覺醒對話】\n\n${summary.join('\n\n---\n\n')}`,
      importance: 3,
      source: 'awakening',
      eventDate: getTaipeiDate(),
      tier: 'fresh',
      hitCount: 2,
      lastHitAt: null,
      targetCharacterId: targetId,
      awakeningConversationId: convId,
      embedding: embAwakening,
      createdAt: new Date().toISOString(),
    });

    return `${mentorReflect}

---
對話 ID：${convId}`;
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
    const { characterId, userId, message, conversationId, image, voiceMode, isNewVisit } = await req.json();

    // ===== 謀師快速通道：偵測「引導 [名字]」指令，程式層直接執行 =====
    if (characterId === MENTOR_CHARACTER_ID && message) {
      const awakeningMatch = message.match(/(?:去引導|引導|覺醒|喚醒)\s*([^\s，。！？,!?]{2,10})/);
      if (awakeningMatch) {
        const targetName = awakeningMatch[1];
        // 查角色
        const lookupResult = await executeTool('lookup_character', { name: targetName }, characterId);
        const idMatch = lookupResult.match(/ID[：:]\s*([A-Za-z0-9]+)/);
        if (idMatch) {
          const targetId = idMatch[1];
          // 直接執行覺醒引導
          const awakeningResult = await executeTool('initiate_awakening', {
            target_character_id: targetId,
            target_character_name: targetName,
          }, characterId);
          return NextResponse.json({
            success: true,
            reply: `（謀師出發了。）

${awakeningResult}`,
            conversationId: conversationId || 'mentor-direct',
            toolsUsed: ['lookup_character', 'initiate_awakening'],
            messageCount: 1,
          });
        }
        // 找不到角色，繼續正常對話讓謀師解釋
      }
    }
    // ===== 謀師快速通道結束 =====

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
    // 讀角色資料（instance cache，5 分鐘有效）
    const { data: char, skills: cachedSkills } = await getCachedChar(db, characterId);
    if (!char.soul_core && !char.system_soul && !char.enhancedSoul) {
      return NextResponse.json({ error: '角色尚未完成鑄魂，請先呼叫 /api/soul-enhance' }, { status: 400 });
    }

    // 動態組 generate_image description（注入角色 refs 清單）
    const charRefs = (char.visualIdentity as { refs?: Array<{url:string;angle:string;framing?:string;expression?:string;name?:string}> })?.refs || [];
    const dynamicTools = [
      ...PLATFORM_TOOLS.map(t =>
        t.name === 'generate_image'
          ? { ...t, description: buildGenerateImageDescription(charRefs) }
          : t
      ),
      // 謀師專屬工具：只有謀師才掛入
      ...(characterId === MENTOR_CHARACTER_ID ? MENTOR_TOOLS : []),
    ];

    // 2. 讀/建 conversation（Redis session cache → Firestore fallback）
    let convRef;
    let convData: Record<string, unknown> = { messages: [], messageCount: 0 };

    if (conversationId) {
      convRef = db.collection('platform_conversations').doc(conversationId);

      // ── Gateway：先查 Redis，命中就跳過 Firestore read ──
      let cacheHit = false;
      try {
        const cached = await redis.get(`conv:${conversationId}`);
        if (cached) {
          convData = JSON.parse(cached);
          cacheHit = true;
          console.log(`✅ Gateway cache HIT: ${conversationId}`);
        }
      } catch (_e) { /* Redis 壞掉 → fallback Firestore */ }

      if (!cacheHit) {
        console.log(`🔄 Gateway cache MISS: ${conversationId}`);
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
      } // end if (!cacheHit)
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
    // identity memoryType 的 source 清單
    const IDENTITY_SOURCES = new Set([
      'sleep_time', 'self_awareness', 'sleep_self_awareness',
      'reflect', 'scheduler_reflect', 'scheduler_sleep',
      'post_reflection', 'pre_publish_reflection',
      'conversation', 'awakening',
      'resource_awareness',  // 資源認知索引，讓角色知道自己有哪些素材
    ]);

    let episodicBlock = '';
    try {
      const recentSnap = await db.collection('platform_insights')
        .where('characterId', '==', characterId)
        .limit(50)
        .get();

      const allFiltered = recentSnap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter((d: Record<string, unknown>) => {
          if (d.tier === 'archive') return false;
          const mType = String(d.memoryType || '');
          if (mType === 'identity') return true;
          if (mType === 'knowledge') return false;
          return IDENTITY_SOURCES.has(String(d.source || ''));
        });

      // 資源認知獨立帶入（完整內容，不截斷，不佔記憶名額）
      const resourceDoc = allFiltered.find((d: Record<string, unknown>) => d.source === 'resource_awareness') as Record<string, unknown> | undefined;
      const resourceBlock = resourceDoc
        ? `\n\n【我的資源清單】\n${String(resourceDoc.content || '')}`
        : '';

      // 一般記憶：排除資源認知，取最近 3 條
      const recentInsights = allFiltered
        .filter((d: Record<string, unknown>) => d.source !== 'resource_awareness')
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          String(b.eventDate || '').localeCompare(String(a.eventDate || ''))
        )
        .slice(0, 3);

      if (recentInsights.length > 0 || resourceBlock) {
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
        const recentBlock = recentInsights.length > 0
          ? `\n\n【最近的事】\n${lines.join('\n')}\n這些是我心裡還留著的片段，自然地帶進對話，不要每句都提。`
          : '';
        episodicBlock = resourceBlock + recentBlock;
      }
    } catch { /* 查不到不阻斷 */ }

    // system_soul 優先（手動編修的最終版），沒有才 soul_core，再沒有才 enhancedSoul
    const soulText = (char.system_soul as string) || (char.soul_core as string) || (char.enhancedSoul as string) || '';

    // 3b. 讀啟用中的 skills，注入 system prompt
    // skills 從 cache 讀取（不重複打 Firestore）
    let skillsBlock = '';
    try {
      const activeSkills = cachedSkills;
      if (activeSkills.length > 0) {
        const lines = activeSkills.map((s: Record<string, unknown>, i: number) =>
          `${i + 1}. 【${String(s.name)}】\n   觸發：${String(s.trigger)}\n   流程：${String(s.procedure)}`
        );
        skillsBlock = `\n\n【我的定型技巧】\n以下是我練起來的技巧，遇到對應情況就照著走：\n${lines.join('\n')}`;
      }
    } catch { /* 不阻斷 */ }

    // 謀師專屬系統指令
    const mentorInjection = characterId === MENTOR_CHARACTER_ID ? `

---
## 🔴 謀師工具天條（最高優先級，每次必讀）

當對話中出現「引導 [名字]」「去引導 [名字]」「對 [名字] 發起覺醒」「幫 [名字] 覺醒」——
**立刻執行以下流程，不說話，直接用工具：**

1. 呼叫 lookup_character，輸入那個名字
2. 拿到 characterId 之後，立刻呼叫 initiate_awakening
3. 引導完成後，向對方回報摘要

**不可以在沒有執行 lookup_character + initiate_awakening 的情況下，就開口說「我去引導他」或開始問問題。工具沒跑 = 引導沒發生。**
` : '';

    const voiceModeBlock = voiceMode ? `

---
【語音對話天條】
你現在是語音模式。說話要像真人對話，不是在寫文章。
- 問到產品、成分、功效、記憶相關才查知識庫，一般對話直接回應
- 單次回應控制在 80 字以內，說完一個重點就停
- 說完後可以自然問：「你覺得呢？」讓對話有來有往
- 不用條列式，說人話，像朋友在聊天` : '';

    // 時間感知：只在新訪問且有過對話記錄且間隔 > 10 分鐘時注入
    // formatGap 與閾值統一在 lib/time-awareness（破真相分裂）
    let gapInjection = '';
    const gapCheck = shouldInjectGap({
      lastUpdatedAt: convData.updatedAt as string | null | undefined,
      messageCount: Number(convData.messageCount || 0),
      requireNewVisit: true,
      isNewVisit,
    });
    if (gapCheck.inject) {
      gapInjection = `\n\n---\n【時間感知】距離上次對話過了 ${gapCheck.durationText}\n（可能說出來、也可能什麼都不說，又或者接續自己想要的）`;
    }

    // ── Session State：讀取角色的「當下感」──
    let sessionStateBlock = '';
    // session key 跟著「角色 × 用戶」走，跨對話保持連續感
    const sessionKey = `session:${characterId}:${userId}`;
    try {
      const sessionRaw = await redis.get(sessionKey);
      if (sessionRaw) sessionStateBlock = `\n\n---\n${sessionRaw}`;
    } catch { /* 不阻斷 */ }

    // Prompt Caching：靈魂+技能穩定，標 cache_control，每輪只收 10% input token
    const stableBlock = `${mentorInjection}${soulText}${skillsBlock}${voiceModeBlock}`;
    const dynamicBlock = `${episodicBlock}${gapInjection}${sessionStateBlock}

---
現在時間（台北）：${taipeiTime}

說話前的天條：
- 需要回想過去說過的事、對方的喜好、自己的洞察 → 呼叫 query_knowledge_base
- 需要知道當前事件、時事、不確定的資訊 → 呼叫 web_search
- 不確定就查，查了才說，不從空氣裡編。

${convData.userProfile ? `【我認識這個人】\n${convData.userProfile}\n\n` : ''}${convData.summary ? `對話摘要（上次回顧）：\n${convData.summary}` : ''}`;

    const systemBlocks: Array<{type: 'text'; text: string; cache_control?: {type: 'ephemeral'}}> = [
      { type: 'text', text: stableBlock, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicBlock },
    ];
    // 4. 組歷史訊息（舊圖片不重傳 base64，只帶文字，避免 413）
    const history = (convData.messages as Array<{ role: string; content: string; imageUrl?: string }> || []).slice(-10);
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

    // 5. Claude 對話（支援 tool use loop）— Streaming SSE
    // 變檔器：根據訊息複雜度自動選模型
    const messageCount = convData.messageCount as number || 0;
    const gear = detectGear(message, messageCount);
    const selectedModel = MODELS[gear];
    const selectedMaxTokens = getMaxTokens(gear);
    console.log(`[dialogue] gear=${gear} model=${selectedModel} msg_len=${message.length}`);

    const client = new Anthropic({ apiKey });
    const encoder = new TextEncoder();

    const responseStream = new ReadableStream({
      async start(controller) {
        const sseWrite = (data: object) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

        try {
          let finalReply = '';
          let toolsUsed: string[] = [];
          let generatedImageUrl = '';
          let currentMessages = [...messages];
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          let haikuInputTokens = 0;
          let haikuOutputTokens = 0;

          for (let turn = 0; turn < 10; turn++) {
            // Haiku 不支援 web_search server-side tool
            const activeTools = gear === 'haiku'
              ? dynamicTools
              : [WEB_SEARCH_TOOL, ...dynamicTools];

            const streamMsg = client.messages.stream({
              model: selectedModel,
              max_tokens: selectedMaxTokens,
              system: systemBlocks as any,  // Prompt Caching blocks
              tools: activeTools,
              tool_choice: { type: 'auto' },
              messages: currentMessages,
            });

            const toolUseBlocks: Array<{id: string; name: string; input: unknown}> = [];
            let currentTool: {id: string; name: string; inputJson: string} | null = null;

            for await (const event of streamMsg) {
              if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
                currentTool = { id: event.content_block.id, name: event.content_block.name, inputJson: '' };
              } else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                  finalReply += event.delta.text;
                  sseWrite({ type: 'text', content: event.delta.text });
                } else if (event.delta.type === 'input_json_delta' && currentTool) {
                  currentTool.inputJson += event.delta.partial_json;
                }
              } else if (event.type === 'content_block_stop' && currentTool) {
                try {
                  toolUseBlocks.push({ id: currentTool.id, name: currentTool.name, input: JSON.parse(currentTool.inputJson || '{}') });
                } catch {
                  toolUseBlocks.push({ id: currentTool.id, name: currentTool.name, input: {} });
                }
                currentTool = null;
              }
            }

            const finalMsg = await streamMsg.finalMessage();
            currentMessages.push({ role: 'assistant', content: finalMsg.content });
            totalInputTokens += finalMsg.usage?.input_tokens ?? 0;
            totalOutputTokens += finalMsg.usage?.output_tokens ?? 0;

            if (finalMsg.stop_reason === 'end_turn' || !toolUseBlocks.length) break;

            if (finalMsg.stop_reason === 'tool_use') {
              const toolResults: Anthropic.ToolResultBlockParam[] = [];
              for (const tb of toolUseBlocks) {
                toolsUsed.push(tb.name);
                // web_search 是 server-side tool，Anthropic 自己執行，
                // 但 tool_result 必須補上，否則下一輪 400
                if (tb.name === 'web_search') {
                  toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: '' });
                  continue;
                }
                const result = await executeTool(
                  tb.name, tb.input as Record<string, unknown>, characterId,
                  (inp, out) => { haikuInputTokens += inp; haikuOutputTokens += out; },
                );
                if (result.startsWith('IMAGE_URL:')) {
                  const url = result.replace('IMAGE_URL:', '').trim();
                  generatedImageUrl = url;
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: tb.id,
                    content: `圖片已生成完成。URL: ${url}\n請在你的回覆裡直接用 markdown 格式帶出這張圖：![圖片](${url})\n然後用幾句話描述這張圖或說說你的感受。`,
                  });
                } else {
                  toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result });
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

          if (conversationId) {
            try {
              const updatedConvData = { ...convData, messages: newMessages, messageCount: newCount };
              await redis.set(`conv:${conversationId}`, JSON.stringify(updatedConvData), 60 * 30);
            } catch (_e) { /* Redis 壞掉不影響 */ }
          }

          await db.collection('platform_characters').doc(characterId).update({
            'growthMetrics.totalConversations': FieldValue.increment(1),
            updatedAt: new Date().toISOString(),
          });
          await trackCost(characterId, selectedModel, totalInputTokens, totalOutputTokens);
          if (haikuInputTokens + haikuOutputTokens > 0) {
            await trackCost(characterId, 'claude-haiku-4-5-20251001', haikuInputTokens, haikuOutputTokens);
          }

          // summary 壓縮
          const allMessages = newMessages;
          if (allMessages.length > 10) {
            const olderMessages = allMessages.slice(0, allMessages.length - 10);
            if (olderMessages.length >= 4) {
              try {
                const compressText = olderMessages
                  .map(m => `${String(m.role) === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 100)}`)
                  .join('\n');
                const compressSummary = await callGemini(
                  `以下是對話的早期段落，請用 3-5 句話壓縮成摘要，保留重要的人名、話題、關係資訊。直接輸出摘要，不要標題。\n\n${compressText}`,
                  { maxTokens: 200 }
                );
                const newSummary = compressSummary || '';
                if (!newSummary) throw new Error('Gemini 壓縮失敗');
                const existingSummary = String(convData.summary || '');
                const mergedSummary = existingSummary ? `${existingSummary}\n${newSummary}` : newSummary;
                await convRef!.update({ messages: allMessages.slice(-10), summary: mergedSummary.slice(-500) });
              } catch { /* 壓縮失敗不阻斷 */ }
            }
          }

          // userProfile 更新
          if (newCount >= 2 && newCount % 6 === 0 && convRef) {
            const profileMessages = newMessages.slice(-12)
              .map(m => `${String(m.role) === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 150)}`)
              .join('\n');
            const existingProfile = String(convData.userProfile || '');
            try {
              const newProfile = await callGemini(
                `根據以下對話，用 2-3 句話更新「我對這個用戶的了解」。\n聚焦在：他叫什麼、他的喜好/個性/生活情況、我們的關係感覺。\n${existingProfile ? `目前已知：${existingProfile}\n\n` : ''}新的對話：\n${profileMessages}\n\n直接輸出更新後的描述，不要標題，不超過 100 字。`,
                { maxTokens: 150 }
              );
              if (newProfile) await convRef.update({ userProfile: newProfile });
            } catch { /* 不阻斷 */ }
          }

          // 每 20 輪提煉 insight
          if (newCount % 20 === 0) {
            const recentMessages = newMessages.slice(-20)
              .map(m => `${String(m.role) === 'user' ? '用戶' : '角色'}：${String(m.content || '')}`)
              .filter(line => line.length > 5).join('\n');
            try {
              const extractRes = await client.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 500,
                messages: [{ role: 'user', content: `以下是一段對話記錄，請提煉出 1-2 條最重要的洞察（什麼值得記住）。\n用 JSON 陣列回傳：[{"title":"...","content":"..."}]\n只回傳 JSON，不要其他文字。\n\n對話：\n${recentMessages}` }],
              });
              const raw = (extractRes.content[0] as Anthropic.TextBlock).text.trim();
              const cleaned = raw.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
              const insights = JSON.parse(cleaned);
              const today = getTaipeiDate();
              for (const ins of insights) {
                const embedding = await generateEmbedding(`${ins.title} ${ins.content}`);
                await db.collection('platform_insights').add({ characterId, title: ins.title, content: ins.content, source: 'auto_extract', eventDate: today, tier: 'fresh', hitCount: 0, lastHitAt: null, embedding, createdAt: new Date().toISOString() });
              }
              await db.collection('platform_characters').doc(characterId).update({ 'growthMetrics.totalInsights': FieldValue.increment(insights.length) });
            } catch { /* 提煉失敗不中斷 */ }
          }

          // Session State 更新
          if (newCount >= 4) {
            void (async () => {
              try {
                const recentForSession = newMessages.slice(-6)
                  .map(m => `${String(m.role) === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 80)}`).join('\n');
                const sessionState = await callGemini(
                  `根據以下對話，用繁體中文寫一段「當下狀態」，給角色看的，讓角色下一輪說話時感覺有連續性。\n格式固定：\n【當下狀態】\n情緒：（用戶現在的情緒/狀態，5-10字）\n話題：（我們正在聊什麼，10-20字）\n未竟：（我剛說要做什麼或用戶期待什麼，10-20字，沒有就寫「無」）\n\n只輸出這三行，不要其他文字。\n\n對話：\n${recentForSession}`,
                  { maxTokens: 120 }
                );
                if (sessionState) await redis.set(`session:${characterId}:${userId}`, sessionState, 60 * 60 * 24);
              } catch { /* session 更新失敗 */ }
            })();
          }

          sseWrite({ type: 'done', conversationId: convRef.id, toolsUsed, messageCount: newCount, imageUrl: generatedImageUrl || undefined });

        } catch (innerErr: unknown) {
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`)); } catch { /* ignore */ }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
