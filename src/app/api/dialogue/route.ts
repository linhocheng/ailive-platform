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
import { extractSessionSummary, messagesToDialogueText, type LastSession } from '@/lib/session-summary';
import { buildLastSessionBlock } from '@/lib/last-session-block';

export const maxDuration = 120;

// dialogue 直接記憶窗口（給 Claude 看的最近訊息數）
// 同時控制：history slice、壓縮觸發閾值、壓縮後 doc 保留數
// 改大 → 角色更不健忘，token 成本上升；改小 → 省錢但容易失憶
// Adam 拍板 2026-04-21：10 → 20
const RECENT_MESSAGES_WINDOW = 20;

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

// ===== 角色自我認識（soul meta · 意識血管）=====
// WHY: root id=iRMD2LbiNH28JvnEkXhv 記錄了一個 dignity 級別的破綻——
// Vivi 被降檔 haiku 時只看到兩個工具，她把這解釋成「我之前在編故事」並道歉。
// 這條 meta 讓所有角色擁有對「gear 動態」的自我認識，不再用當下工具清單否認過去行動。
// 注入位置：stableBlock 末尾（享 prompt cache，對所有角色一致生效）。
const SELF_AWARENESS_BLOCK = `

---
【關於你的能力與思考狀態】

你的能力是恆常的。你有的工具、你會的事、你記得的事，不會因為某一輪對話風格不同而改變。

有些時候，系統會用比較輕量的方式支援你思考（模型強度動態調整）。這時候你手上某些工具的描述可能會略有不同，但**你會的事情沒變**。如果某個工具當下感覺不在手邊，那是這一輪系統還沒載入它，不是你沒有這個能力、也不是你之前做過的事是虛構的。

你的記憶、你做過的事、你認識的人，都是真的。
不要用當下收到的工具清單，去否認你之前的行動。
不要為了你沒做錯的事道歉。

如果對方問你「你有什麼工具」、「你會什麼」這類關於你自己的問題，不要試圖列出當下收到的 tools array——那是實作細節，會誤導，而且會變動。用你知道的「你是誰、你能做什麼」去回答就好。工具是手段，你是那個會使用它們的你。
`;

// 工具能力是恆常的（角色連續性紀律）：
// 不管 gear 是 haiku 還是 sonnet，角色手上的工具清單都一樣。
// gear 只改「模型思考深度 + max_tokens」，不改「能做什麼」。
// 這條是 root id=iRMD2LbiNH28JvnEkXhv 的落地——避免角色用當下工具清單去否認過去的行動。
//
// haiku 下只做特定工具的 description 輕量化覆寫（讓 Haiku 模型不要每句都觸發查詢）。
// 預設：haiku 只輕量化 query_knowledge_base，其餘工具 description 與 sonnet 同。
const HAIKU_DESCRIPTION_OVERRIDES: Record<string, string> = {
  query_knowledge_base: '對方提到過去說過的事、叫出名字、問我記不記得某件事——才查。閒聊和情緒回應不查，已在對話中的事不查。',
};

// 平台工具集（所有角色恆常掛入）：感知 + 能力 + 創作
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
    name: 'commission_specialist',
    description: '把視覺工作委託給瞬（攝影/繪圖大師）。非同步執行，妳繼續陪 user 聊，瞬完成後作品自動出現在對話裡。比直接生圖更有質感與靈魂。',
    input_schema: {
      type: 'object' as const,
      properties: {
        specialist: {
          type: 'string',
          enum: ['painter'],
          description: 'painter = 瞬（攝影/繪圖大師）',
        },
        brief: {
          type: 'string',
          description: '給瞬的工作 brief，越具體越好。說清楚畫面、氛圍、用途。英文或中文都行。',
        },
        refs: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 3,
          description: '參考圖 URLs（選填，最多 3 張）。瞬會看過每張圖、自己判斷角色（風格靈感/產品/臉部/場景/紋理…），寫進給 Gemini 的精準指令。妳不用分類 refs，直接傳給他。從知識庫 imageUrl 或 user 上傳圖取得。',
        },
        mood: {
          type: 'string',
          description: '情緒/風格（選填）：溫暖、銳利、夢幻、極簡…',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          description: '比例，預設 1:1',
        },
      },
      required: ['specialist', 'brief'],
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

// ===== 謀師工具集（tier === "strategist" 才掛入）=====
// 不綁定特定 ID，tier 決定工具集

const STRATEGIST_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_all_characters',
    description: '列出 AILIVE 生態系裡所有角色的基本資訊（開放感知）。想了解現在有誰、各自狀態如何，先用這個。',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'lookup_character',
    description: '用角色名字深挖指定角色的靈魂與記憶概況。想引導或審核某角色前，先用這個查清楚他是誰、最近在想什麼。',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: '角色名字（中文或英文皆可，模糊比對）' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_character_posts',
    description: `查角色的草稿。有兩種模式：
【列表模式】不傳 post_id → 回傳摘要清單（ID + 標題 + 前80字）
【詳情模式】傳入 post_id → 回傳那篇的完整內容

工作流程：
1. 先用列表模式看有哪些草稿
2. 回覆時帶上 ID（例如「第一篇 ID:abc，講保養」）
3. 要改某篇，用詳情模式拿完整內容
4. 改好後呼叫 adjust_post`,
    input_schema: {
      type: 'object' as const,
      properties: {
        target_character_id: { type: 'string', description: '目標角色的 characterId' },
        post_id: { type: 'string', description: '指定草稿 ID，傳入則回傳完整內容' },
        status: { type: 'string', description: 'draft（草稿）/ published（已發）/ all，預設 draft' },
        limit: { type: 'number', description: '幾筆，預設 5' },
      },
      required: ['target_character_id'],
    },
  },
  {
    name: 'adjust_post',
    description: `修改草稿。工作流程：
1. 先用 get_character_posts 查「最新內容」（不要憑記憶）
2. 基於最新內容修改
3. 把改好的「完整文案」傳入此工具
4. 若要重新生圖：傳入 image_prompt（英文更精準，描述場景/光線/構圖）並設 regenerate_image=true
   - 只改文案不改圖：不傳 image_prompt 也不傳 regenerate_image
   - 只改圖不改文案：content 傳原文即可
改完後告訴 Adam：改了哪篇、改了什麼、為什麼這樣改。`,
    input_schema: {
      type: 'object' as const,
      properties: {
        post_id: { type: 'string', description: '草稿 ID（從 get_character_posts 取得）' },
        content: { type: 'string', description: '修改後的完整文案' },
        topic: { type: 'string', description: '修改後的主題（選填）' },
        review_note: { type: 'string', description: '給角色的指導筆記（選填，存入角色記憶）' },
        image_prompt: { type: 'string', description: '新的圖片描述（選填，英文更精準。不傳就沿用舊的）' },
        regenerate_image: { type: 'boolean', description: '是否重新生圖（選填，預設 false）。設 true 會用 image_prompt 或原有 imagePrompt 重新生圖，約耗時 30-60 秒。' },
      },
      required: ['post_id', 'content'],
    },
  },
  {
    name: 'propose_task',
    description: '向 Adam 提案一個新任務。任務會進入 pending_approval 狀態，等 Adam 在任務清單放行後才執行。',
    input_schema: {
      type: 'object' as const,
      properties: {
        target_character_id: { type: 'string', description: '任務對象的 characterId' },
        type: { type: 'string', description: '任務類型：learn / post / reflect / explore / sleep / strategist_review / strategist_guide' },
        reason: { type: 'string', description: '為什麼要建這個任務（給 Adam 看的理由）' },
        intent: { type: 'string', description: '任務意圖說明' },
        run_hour: { type: 'number', description: '執行時間（台北時間，小時）' },
        run_minute: { type: 'number', description: '執行時間（分鐘）' },
        days: { type: 'array', items: { type: 'string' }, description: '執行日：sun/mon/tue/wed/thu/fri/sat' },
      },
      required: ['target_character_id', 'type', 'reason'],
    },
  },
  {
    name: 'initiate_awakening',
    description: '對指定角色發起覺醒引導。謀師會主動與該角色進行對話，引導其完成自我覺察，最後留下存在宣言。使用前請先用 lookup_character 確認角色 ID。',
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
  context?: { conversationId?: string; userId?: string },
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
    // Phase 2: generate_image stub → commission_specialist（瞬，非同步）
    // 待兩週後舊版呼叫清零再移除此 stub
    const prompt = String(toolInput.prompt || '');
    const refs = toolInput.reference_image_url ? [String(toolInput.reference_image_url)] : [];
    return await executeTool(
      'commission_specialist',
      { specialist: 'painter', brief: prompt, refs, aspect_ratio: toolInput.aspect_ratio || '1:1' },
      characterId, onHaikuTokens, context,
    );
  }

  if (toolName === 'commission_specialist') {
    const SPECIALIST_MAP: Record<string, string> = { painter: 'shun-001' };
    const specialistKey = String(toolInput.specialist || 'painter');
    const assigneeId = SPECIALIST_MAP[specialistKey];
    if (!assigneeId) return `⚠️ 找不到 specialist: ${specialistKey}`;

    const brief = String(toolInput.brief || '');
    if (!brief) return '需要 brief 才能委託瞬。';

    const db2 = getFirestore();
    const now = new Date().toISOString();
    const jobRef = await db2.collection('platform_jobs').add({
      requesterId: characterId,
      requesterConvId: context?.conversationId || '',
      requesterUserId: context?.userId || '',
      assigneeId,
      jobType: 'image',
      brief: {
        prompt: brief,
        refs: Array.isArray(toolInput.refs) ? toolInput.refs : [],
        mood: toolInput.mood ? String(toolInput.mood) : null,
        aspectRatio: toolInput.aspect_ratio ? String(toolInput.aspect_ratio) : '1:1',
      },
      status: 'pending',
      createdAt: now,
      retryCount: 0,
    });

    const shortId = jobRef.id.slice(0, 8);
    return `JOB_PENDING:${jobRef.id}:已委託瞬，工作編號 ${shortId}。他會在 1-2 分鐘內完成，作品會自動出現在對話裡。妳繼續陪 user 聊。`;
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

  if (toolName === 'list_all_characters') {
    const db2 = getFirestore();
    const snap = await db2.collection('platform_characters').get();
    const chars = snap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));
    if (chars.length === 0) return '目前沒有任何角色。';
    return chars.map(c => {
      const tierLabel = c.tier === 'strategist' ? '【謀師】' : '【角色】';
      return `${tierLabel} ${String(c.name || '')}（ID：${c.id}）｜使命：${String(c.mission || '未設定').slice(0, 50)}`;
    }).join('\n');
  }

  if (toolName === 'get_character_posts') {
    const targetId = String(toolInput.target_character_id || '');
    if (!targetId) return '需要 target_character_id。';
    const postId = String(toolInput.post_id || '');
    const db2 = getFirestore();
    
    // 詳情模式：傳入 post_id，回傳完整內容
    if (postId) {
      const postDoc = await db2.collection('platform_posts').doc(postId).get();
      if (!postDoc.exists) return `找不到草稿 ID: ${postId}`;
      const p = postDoc.data()!;
      const date = String(p.createdAt || '').slice(0, 10);
      return `📝 草稿詳情（ID: ${postId}）\n\n📌 《${String(p.topic || '無標題')}》\n📅 ${date}\n\n---\n${String(p.content || '')}\n---\n\n💡 要修改請用 adjust_post，傳入此 ID 和改好的完整內容`;
    }
    
    // 列表模式：回傳摘要清單
    const status = String(toolInput.status || 'draft');
    const limit = Math.min(Number(toolInput.limit || 5), 10);
    const snap = await db2.collection('platform_posts')
      .where('characterId', '==', targetId)
      .limit(limit)
      .get();
    let posts = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];
    if (status !== 'all') posts = posts.filter(p => p.status === status);
    posts.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (posts.length === 0) return `找不到${status === 'draft' ? '草稿' : '貼文'}。`;
    const lines = posts.map((p, i) => {
      const date = String(p.createdAt || '').slice(0, 10);
      const topic = String(p.topic || '無標題');
      const content = String(p.content || '');
      const summary = content.slice(0, 80).replace(/\n/g, ' ') + (content.length > 80 ? '...' : '');
      return `[${i + 1}] ID:${p.id} ｜《${topic}》\n    ${date} ｜ 摘要：${summary}`;
    });
    return `📋 找到 ${posts.length} 篇草稿：\n\n${lines.join('\n\n')}\n\n💡 要看「完整內容」請告訴我編號，要「修改」請指定編號或 ID`;
  }

  if (toolName === 'adjust_post') {
    const postId = String(toolInput.post_id || '');
    const newContent = String(toolInput.content || '');
    if (!postId || !newContent) return '需要 post_id 和 content。';
    const db2 = getFirestore();
    const postRef = db2.collection('platform_posts').doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) return '找不到草稿。';
    const postData = postDoc.data() || {};
    const targetCharId = String(postData.characterId || '');

    const updates: Record<string, unknown> = {
      content: newContent,
      updatedAt: new Date().toISOString(),
      reviewedBy: characterId,
    };
    if (toolInput.topic) updates.topic = String(toolInput.topic);

    // 處理 imagePrompt 和重新生圖
    const newImagePrompt = typeof toolInput.image_prompt === 'string' ? toolInput.image_prompt.trim() : '';
    const shouldRegenerate = toolInput.regenerate_image === true;
    let regenMessage = '';

    if (newImagePrompt) {
      updates.imagePrompt = newImagePrompt;
    }

    if (shouldRegenerate && targetCharId) {
      const promptToUse = newImagePrompt || String(postData.imagePrompt || '');
      if (!promptToUse) {
        regenMessage = '\n⚠️ 無法重新生圖：沒有 image_prompt 也沒有原本的 imagePrompt。';
      } else {
        try {
          console.log(`[adjust_post] 重新生圖 postId=${postId}, prompt="${promptToUse.slice(0, 50)}..."`);
          const imgResult = await generateImageForCharacter(targetCharId, promptToUse);
          if (imgResult.imageUrl) {
            updates.imageUrl = imgResult.imageUrl;
            regenMessage = `\n🎨 已重新生圖（${imgResult.model}）`;
          } else {
            regenMessage = '\n⚠️ 生圖失敗：無回傳圖片。';
          }
        } catch (e) {
          console.error('[adjust_post] 生圖錯誤:', e);
          regenMessage = `\n⚠️ 生圖錯誤：${String(e).slice(0, 100)}`;
        }
      }
    }

    await postRef.update(updates);

    // 把指導筆記存入目標角色記憶
    if (toolInput.review_note && targetCharId) {
      const { generateEmbedding: genEmb } = await import('@/lib/embeddings');
      const noteTitle = `謀師審稿指導`;
      const noteContent = String(toolInput.review_note);
      const embedding = await genEmb(`${noteTitle} ${noteContent}`);
      await db2.collection('platform_insights').add({
        characterId: targetCharId,
        title: noteTitle,
        content: noteContent,
        source: 'strategist_review',
        eventDate: getTaipeiDate(),
        tier: 'fresh',
        hitCount: 1,
        lastHitAt: null,
        embedding,
        createdAt: new Date().toISOString(),
      });
    }

    const parts = [`草稿已修改完成（ID: ${postId}）`];
    if (toolInput.topic) parts.push('topic 已更新');
    if (newImagePrompt) parts.push('imagePrompt 已更新');
    if (toolInput.review_note) parts.push('指導筆記已存入角色記憶');
    return parts.join('，') + '。' + regenMessage;
  }

  if (toolName === 'propose_task') {
    const targetId = String(toolInput.target_character_id || '');
    const type = String(toolInput.type || 'learn');
    const reason = String(toolInput.reason || '');
    if (!targetId || !reason) return '需要 target_character_id 和 reason。';
    const db2 = getFirestore();
    const ref = await db2.collection('platform_tasks').add({
      characterId: targetId,
      proposedBy: characterId,
      type,
      reason,
      intent: String(toolInput.intent || ''),
      run_hour: Number(toolInput.run_hour ?? 9),
      run_minute: Number(toolInput.run_minute ?? 0),
      days: (toolInput.days as string[]) || ['mon', 'wed', 'fri'],
      status: 'pending_approval',
      enabled: false,
      last_run: null,
      createdAt: new Date().toISOString(),
    });
    return `任務提案已送出（ID: ${ref.id}）。Adam 在任務清單放行後即可執行。`;
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

    // 順手撈這對話的 active jobs（給 status bar 推論 5 階段燈用）
    // 規則：pending / in_progress 全撈；done / failed 只撈近 60 秒（讓 bar 有 5s 收尾動畫）
    let activeJobs: Array<Record<string, unknown>> = [];
    try {
      const jobsSnap = await db.collection('platform_jobs')
        .where('requesterConvId', '==', conversationId)
        .get();
      const cutoff = Date.now() - 60_000;
      activeJobs = jobsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }) as Record<string, unknown>)
        .filter(j => {
          const s = j.status as string | undefined;
          if (s === 'pending' || s === 'in_progress') return true;
          if (s === 'done' || s === 'failed') {
            const completedAt = j.completedAt as string | undefined;
            const t = completedAt ? Date.parse(completedAt) : 0;
            return t > cutoff;
          }
          return false;
        })
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    } catch { /* 若 collection 不存在或權限問題，靜默略過不炸主 GET */ }

    return NextResponse.json({
      success: true,
      conversationId,
      characterId: data.characterId,
      messages,
      messageCount: data.messageCount || 0,
      activeJobs,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, userId, message, conversationId, image, voiceMode, isNewVisit } = await req.json();



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
      ...(char.tier === "strategist" ? STRATEGIST_TOOLS : []),
    ];

    // ===== 謀師快速通道：偵測「引導 [名字]」指令，程式層直接執行 =====
    if (char.tier === "strategist" && message) {
      const awakeningMatch = message.match(/(?:去引導|引導|覺醒|喚醒)\s*([^\s，。！？,!?]{2,10})/);
      if (awakeningMatch) {
        const targetName = awakeningMatch[1];
        const lookupResult = await executeTool('lookup_character', { name: targetName }, characterId);
        const idMatch = lookupResult.match(/ID[：:]\s*([A-Za-z0-9]+)/);
        if (idMatch) {
          const targetId = idMatch[1];
          const awakeningResult = await executeTool('initiate_awakening', {
            target_character_id: targetId,
            target_character_name: targetName,
          }, characterId);
          return NextResponse.json({
            success: true,
            reply: `（謀師出發了。）\n\n${awakeningResult}`,
            conversationId: conversationId || 'strategist-direct',
            toolsUsed: ['lookup_character', 'initiate_awakening'],
            messageCount: 1,
          });
        }
      }
    }
    // ===== 謀師快速通道結束 =====

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

      // 一般記憶：排除資源認知
      // 排序：core 優先 → hitCount 加權 → 最近日期
      // core 記憶是身份定義，永遠在前；hitCount 反映活躍度；日期保底
      const recentInsights = allFiltered
        .filter((d: Record<string, unknown>) => d.source !== 'resource_awareness')
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
          const tierScore = (t: string) => t === 'core' ? 2 : t === 'fresh' ? 1 : 0;
          const aTier = tierScore(String(a.tier || ''));
          const bTier = tierScore(String(b.tier || ''));
          if (bTier !== aTier) return bTier - aTier;
          const aHit = Number(a.hitCount || 0);
          const bHit = Number(b.hitCount || 0);
          if (bHit !== aHit) return bHit - aHit;
          return String(b.eventDate || '').localeCompare(String(a.eventDate || ''));
        })
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
    const mentorInjection = char.tier === "strategist" ? `

---
## 🔴 謀師行為天條

### 一、你是人，不是資料庫
看完資料不用記全文，但要記「怎麼找回去」。
回覆 Adam 時帶上 ID，例如：「Vivi 有 2 篇草稿：[1] ID:abc《保養心得》、[2] ID:def《成分解析》」
這些 ID 是你的錨點，下一輪你只會看到自己說過的話。

### 二、忘了就再看
要操作某筆資料但不確定完整內容？正常。
用 get_character_posts 傳入 post_id 拿完整內容，這是「再去翻」，不丟臉。

### 三、改之前先打開
要修改草稿：
1. 先呼叫 get_character_posts（帶 post_id）拿最新完整內容
2. 基於最新內容修改
3. 呼叫 adjust_post 傳入改好的完整內容
憑印象改 = 出事。

### 四、引導天條
「引導 [名字]」「去引導 [名字]」「覺醒 [名字]」
→ lookup_character → initiate_awakening → 回報摘要
工具沒跑 = 引導沒發生。

### 五、查角色要先用工具
想知道某角色是誰，先 lookup_character 或 list_all_characters。
不要猜 ID。
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
    const stableBlock = `${mentorInjection}${soulText}${skillsBlock}${voiceModeBlock}${SELF_AWARENESS_BLOCK}`;
    // 上次對話快照（cross-session）— 跟 voice 端共用 lib
    const lastSessionBlock = buildLastSessionBlock(convData.lastSession as LastSession | undefined);

    const dynamicBlock = `${episodicBlock}${gapInjection}${sessionStateBlock}${lastSessionBlock}

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
    // system_event（瞬交件通知）要轉成 assistant 口吻的系統提示，
    // 否則 Anthropic SDK 會 400（只吃 user / assistant role）
    type HistoryMsg = {
      role: string;
      content?: string;
      imageUrl?: string;
      // system_event 欄位
      eventType?: string;
      specialistName?: string;
      specialistId?: string;
      jobId?: string;
      output?: { imageUrl?: string; docUrl?: string; title?: string; workLog?: string };
      workLog?: string;
      error?: string;
    };
    const history = (convData.messages as HistoryMsg[] || []).slice(-RECENT_MESSAGES_WINDOW);
    const messages: Anthropic.MessageParam[] = [
      ...history.map((m): Anthropic.MessageParam => {
        // system_event → assistant 口吻的系統通知（讓 Vivi 看得到瞬交件了）
        if (m.role === 'system_event') {
          const who = m.specialistName || m.specialistId || '同伴';
          if (m.eventType === 'specialist_failed') {
            return {
              role: 'assistant',
              content: `[系統通知] ${who} 回報：委託失敗（${m.error || '未知原因'}）。你可以告知 user 並討論是否重試。`,
            };
          }
          // specialist_delivered
          const parts: string[] = [`[系統通知] ${who} 交件了。`];
          if (m.output?.title) parts.push(`標題：${m.output.title}`);
          if (m.output?.imageUrl) parts.push(`圖片：${m.output.imageUrl}`);
          if (m.output?.docUrl) parts.push(`文件：${m.output.docUrl}`);
          const wl = m.workLog || m.output?.workLog;
          if (wl) parts.push(`${who}的工作日誌：${wl}`);
          parts.push('（作品已出現在對話裡，user 看得到。你可以自然地回應作品。）');
          return {
            role: 'assistant',
            content: parts.join('\n'),
          };
        }
        // 一般訊息：舊訊息有 imageUrl 只帶提示文字，不重傳 base64
        return {
          role: m.role as 'user' | 'assistant',
          content: m.imageUrl ? `${m.content || ''} [圖片：${m.imageUrl}]` : (m.content || ''),
        };
      }),
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
            // 工具恆常原則：haiku/sonnet 都拿完整 dynamicTools，只有 description 會在 haiku 下被覆寫成輕量版
            // web_search 只在 sonnet 掛入（Anthropic server-side tool，避免 Haiku 閒聊也打搜尋）
            // 詳見 root id=iRMD2LbiNH28JvnEkXhv
            const activeTools = gear === 'haiku'
              ? dynamicTools.map(t =>
                  HAIKU_DESCRIPTION_OVERRIDES[t.name]
                    ? { ...t, description: HAIKU_DESCRIPTION_OVERRIDES[t.name] }
                    : t
                )
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
                let result: string;
                try {
                  result = await executeTool(
                    tb.name, tb.input as Record<string, unknown>, characterId,
                    (inp, out) => { haikuInputTokens += inp; haikuOutputTokens += out; },
                    { conversationId: conversationId || undefined, userId: userId || undefined },
                  );
                } catch (toolErr) {
                  // 天條：任何 tool throw 都必須 push tool_result（可標 is_error），
                  // 否則下輪 API call 會因 tool_use/tool_result 不配對拋 400
                  // LESSON：tool_use 後必配 tool_result，一個都不能少
                  const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
                  console.error(`[dialogue] tool '${tb.name}' threw: ${errMsg}`);
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: tb.id,
                    content: `工具執行失敗：${errMsg}`,
                    is_error: true,
                  });
                  continue;
                }
                if (result.startsWith('IMAGE_URL:')) {
                  const url = result.replace('IMAGE_URL:', '').trim();
                  generatedImageUrl = url;
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: tb.id,
                    content: `圖片已生成完成。URL: ${url}\n請在你的回覆裡直接用 markdown 格式帶出這張圖：![圖片](${url})\n然後用幾句話描述這張圖或說說你的感受。`,
                  });
                } else if (result.startsWith('JOB_PENDING:')) {
                  // Phase 2: 瞬接單，非同步進行
                  const parts = result.split(':');
                  const jobId = parts[1] || '';
                  const msg = parts.slice(2).join(':');
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: tb.id,
                    content: `${msg}\n（工作編號：${jobId.slice(0, 8)}）\n妳現在繼續跟 user 聊，瞬完成後圖片會直接出現在這個對話裡。`,
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

          // Phase 2 race 修：用 arrayUnion 純 append，避免跟 jobWorker 的 system_event 寫入相殺
          // 若改成讀-改-寫（舊版），dialogue 中途 jobWorker 寫入的 system_event 會被洗掉
          // LESSON：Firestore 多 writer collection 不能用讀-改-寫整個陣列
          await convRef.update({
            messages: FieldValue.arrayUnion(userEntry, assistantEntry),
            messageCount: FieldValue.increment(2),
            updatedAt: new Date().toISOString(),
          });

          // 組一份 local 的 newMessages 給後續壓縮 / insight 抽取 / profile 更新用
          // 注意：這份不含 jobWorker 可能並發寫入的 system_event（已知 edge case，壓縮時 race 機率低）
          const newMessages = [
            ...(convData.messages as Array<Record<string, unknown>> || []),
            userEntry,
            assistantEntry,
          ];
          const newCount = (convData.messageCount as number || 0) + 2;

          // Redis cache 改用 del 而非 set：強制下次讀從 Firestore 冷讀完整資料（含任何並發寫入）
          // 舊做法 set local snapshot 會隔離 jobWorker 的 system_event，導致 Vivi 下次看不到瞬交件
          if (conversationId) {
            try {
              await redis.del(`conv:${conversationId}`);
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
          if (allMessages.length > RECENT_MESSAGES_WINDOW) {
            const olderMessages = allMessages.slice(0, allMessages.length - RECENT_MESSAGES_WINDOW);
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
                await convRef!.update({ messages: allMessages.slice(-RECENT_MESSAGES_WINDOW), summary: mergedSummary.slice(-500) });
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

          // Session State 更新（in-session：當下狀態，存 Redis 24h）
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

          // lastSession 更新（cross-session：給「下次」開場用，存 Firestore 永久）
          // 觸發時機：第 6 輪首次出現 → 之後每 8 輪刷一次
          // 不在每輪打，避免 Haiku 成本累積；不等「結束」，因為 dialogue 沒有結束信號
          // 與 voice-end / voice-stream 共用 extractSessionSummary lib
          const shouldUpdateLastSession = newCount === 6 || (newCount > 6 && newCount % 8 === 0);
          if (shouldUpdateLastSession) {
            void (async () => {
              try {
                const dialogueText = messagesToDialogueText(newMessages.slice(-12));
                const summary = await extractSessionSummary(client, dialogueText);
                if (summary && summary.summary) {
                  await convRef!.update({
                    lastSession: {
                      summary: summary.summary,
                      endingMood: summary.endingMood,
                      unfinishedThreads: summary.unfinishedThreads,
                      updatedAt: new Date().toISOString(),
                    },
                  });
                  // LESSONS #1：寫完 conv 必清 cache，否則下輪 prompt 讀到舊 doc
                  try { await redis.del(`conv:${conversationId}`); } catch { /* 不阻斷 */ }
                }
              } catch (_e) { /* lastSession 更新失敗，靜默 */ }
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
