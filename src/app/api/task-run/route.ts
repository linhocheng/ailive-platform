/**
 * /api/task-run — 排程任務執行引擎（謀謀模式）
 *
 * POST { characterId, taskId, taskType, intent, date }
 *
 * 謀謀模式：
 *   直接呼叫 Claude API（不走 /api/dialogue）
 *   system = 角色靈魂
 *   user = 任務 intent + 最近 insights + 相關記憶
 *   → Claude 直接輸出結果
 *   → API 自己存草稿 / insights / 通知
 *   不讓角色問確認，直接存
 *
 * 適用所有角色 — PERSONA_TEMPLATE 的排程執行骨架
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { trackCost } from '@/lib/cost-tracker';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { generateImageForCharacter } from '@/lib/generate-image';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';

export const maxDuration = 120;

function getTaipeiDate(): string {
  const now = new Date();
  const tai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return tai.toISOString().slice(0, 10);
}

// 讀角色最近的 insights（最多 5 條，按時間排序）
// identity source 清單（與 sleep/dialogue 共用邏輯）
const IDENTITY_SOURCES_SET = new Set([
  'sleep_time', 'self_awareness', 'sleep_self_awareness',
  'reflect', 'scheduler_reflect', 'scheduler_sleep',
  'post_reflection', 'pre_publish_reflection',
  'conversation', 'awakening',
]);

function isIdentityInsight(d: Record<string, unknown>): boolean {
  const mType = String(d.memoryType || '');
  if (mType === 'identity') return true;
  if (mType === 'knowledge') return false;
  return IDENTITY_SOURCES_SET.has(String(d.source || ''));
}

async function getRecentInsights(
  db: ReturnType<typeof getFirestore>,
  characterId: string,
  filter?: 'identity' | 'knowledge' | 'all'
): Promise<{ text: string; ids: string[] }> {
  try {
    const snap = await db.collection('platform_insights')
      .where('characterId', '==', characterId)
      .limit(50)
      .get();

    const docs = snap.docs
      .map(d => ({ ...d.data(), id: d.id }))
      .filter((d: Record<string, unknown>) => {
        if (d.tier === 'archive') return false;
        if (!filter || filter === 'all') return true;
        const isIdentity = isIdentityInsight(d);
        return filter === 'identity' ? isIdentity : !isIdentity;
      })
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        String(b.eventDate || '').localeCompare(String(a.eventDate || ''))
      )
      .slice(0, 5);

    if (docs.length === 0) return { text: '', ids: [] };

    const ids = docs.map((d: Record<string, unknown>) => String(d.id || ''));
    const lines = docs.map((d: Record<string, unknown>) => {
      const tier = d.tier === 'self' ? '[關於我]' : '[記憶]';
      return `${tier} ${String(d.title || '')}：${String(d.content || '').slice(0, 80)}`;
    });

    return { text: `\n\n【最近的事與感受】\n${lines.join('\n')}`, ids };
  } catch { return { text: '', ids: [] }; }
}

// 語義搜尋相關知識（query 跟 intent 相關的知識庫內容）
async function getRelevantKnowledge(db: ReturnType<typeof getFirestore>, characterId: string, query: string): Promise<string> {
  try {
    const qEmb = await generateEmbedding(query);
    const snap = await db.collection('platform_knowledge')
      .where('characterId', '==', characterId)
      .limit(50)
      .get();

    const results = snap.docs
      .map(d => {
        const data = d.data() as Record<string, unknown>;
        const score = data.embedding ? cosineSimilarity(qEmb, data.embedding as number[]) : 0;
        return { data, score };
      })
      .filter(r => r.score >= 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (results.length === 0) return '';

    const lines = results.map(r =>
      `[知識] ${String(r.data.title || '')}：${String(r.data.content || '').slice(0, 150)}`
    );
    return `\n\n【相關知識庫】\n${lines.join('\n')}`;
  } catch { return ''; }
}

// 撈最近 N 篇草稿的主題，用於去重
async function getRecentPostContext(db: ReturnType<typeof getFirestore>, characterId: string): Promise<string> {
  try {
    const snap = await db.collection('platform_posts')
      .where('characterId', '==', characterId)
      .limit(50)
      .get();

    const posts = snap.docs
      .map(d => d.data() as Record<string, unknown>)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 10);

    if (posts.length === 0) return '';

    const lines = posts.map(p => {
      const topic = String(p.topic || '');
      const snippet = String(p.content || '').slice(0, 60);
      return `- ${topic || snippet}`;
    });

    return `\n\n【最近 10 篇草稿主題（不要重複這些）】\n${lines.join('\n')}`;
  } catch { return ''; }
}

// 撈知識庫所有書名，並標注哪些在最近草稿裡出現過
async function getKnowledgeBookList(db: ReturnType<typeof getFirestore>, characterId: string): Promise<string> {
  try {
    const [knowledgeSnap, postsSnap] = await Promise.all([
      db.collection('platform_knowledge').where('characterId', '==', characterId).limit(100).get(),
      db.collection('platform_posts').where('characterId', '==', characterId).limit(50).get(),
    ]);

    if (knowledgeSnap.empty) return '';

    // 最近草稿的內容合集（用來偵測書名是否出現過）
    const recentPostsText = postsSnap.docs
      .map(d => d.data() as Record<string, unknown>)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 20)
      .map(p => `${String(p.topic || '')} ${String(p.content || '')}`)
      .join(' ')
      .toLowerCase();

    // 收集不重複的書名
    const bookSet = new Map<string, boolean>();
    for (const doc of knowledgeSnap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const title = String(data.title || '').trim();
      if (!title) continue;
      const used = recentPostsText.includes(title.toLowerCase());
      if (!bookSet.has(title)) bookSet.set(title, used);
    }

    if (bookSet.size === 0) return '';

    const available: string[] = [];
    const usedBooks: string[] = [];
    for (const [title, isUsed] of bookSet.entries()) {
      if (isUsed) usedBooks.push(title);
      else available.push(title);
    }

    let result = '\n\n【知識庫素材】\n';
    if (available.length > 0) result += `可用（未用過）：${available.join('、')}\n`;
    if (usedBooks.length > 0) result += `已用過（這次避開）：${usedBooks.join('、')}`;
    return result;
  } catch { return ''; }
}


// 撈 category=image 的知識庫條目，組成產品圖庫索引（供 post 排程選圖用）
async function getProductImageIndex(db: ReturnType<typeof getFirestore>, characterId: string): Promise<string> {
  try {
    const snap = await db.collection('platform_knowledge')
      .where('characterId', '==', characterId)
      .where('category', '==', 'image')
      .limit(50)
      .get();
    if (snap.empty) return '';
    const lines = snap.docs.map(d => {
      const data = d.data() as Record<string, unknown>;
      const title = String(data.title || '').split('—')[0].trim();
      const imageUrl = String(data.imageUrl || data.content || '');
      if (!imageUrl.startsWith('http')) return null;
      return `- ${title}：${imageUrl}`;
    }).filter(Boolean);
    if (lines.length === 0) return '';
    return `\n\n【產品圖庫（生圖時從這裡挑一張最搭文案的，把 URL 填進 referenceImageUrl）】\n${lines.join('\n')}` ;
  } catch { return ''; }
}

// source → memoryType 映射（全域共用）
function getMemoryType(source: string): 'identity' | 'knowledge' {
  const identitySources = new Set([
    'sleep_time', 'self_awareness', 'sleep_self_awareness',
    'reflect', 'scheduler_reflect', 'scheduler_sleep',
    'post_reflection', 'pre_publish_reflection',
    'conversation', 'awakening',
  ]);
  return identitySources.has(source) ? 'identity' : 'knowledge';
}

// 更新 insights hitCount（任務執行後，被讀到的記憶 +1）
async function updateHitCounts(db: ReturnType<typeof getFirestore>, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  await Promise.all(ids.map(id =>
    db.collection('platform_insights').doc(id).update({
      hitCount: require('firebase-admin/firestore').FieldValue.increment(1),
      lastHitAt: now,
    }).catch(() => { /* 單條失敗不阻斷 */ })
  ));
}

// 存 insight
async function saveInsight(
  db: ReturnType<typeof getFirestore>,
  characterId: string,
  title: string,
  content: string,
  source: string,
  date: string,
  tier: string = 'fresh',
): Promise<void> {
  try {
    const embedding = await generateEmbedding(`${title} ${content}`);
    const memoryType = getMemoryType(source);
    await db.collection('platform_insights').add({
      characterId, title, content, source,
      eventDate: date, tier, memoryType,
      hitCount: 0, lastHitAt: null,
      embedding, createdAt: new Date().toISOString(),
    });
  } catch { /* 不阻斷 */ }
}

// 存草稿（含生圖）
async function savePostDraft(
  db: ReturnType<typeof getFirestore>,
  characterId: string,
  content: string,
  topic: string,
  date: string,
  imagePrompt?: string,
  referenceImageUrl?: string,
): Promise<string> {
  // 生圖（有 imagePrompt 才生）
  let imageUrl = '';
  if (imagePrompt) {
    try {
      const imgResult = await generateImageForCharacter(characterId, imagePrompt, referenceImageUrl || undefined);
      imageUrl = imgResult.imageUrl || '';
    } catch (e) {
      console.warn('[task-run] 生圖失敗，草稿無圖：', e);
    }
  }

  const ref = await db.collection('platform_posts').add({
    characterId, content, imageUrl, topic, imagePrompt: imagePrompt || "",
    status: 'draft', scheduledAt: null, publishedAt: null,
    createdAt: new Date().toISOString(),
  });
  // 同時存發文記憶
  await saveInsight(db, characterId,
    `發文：${topic || date}`,
    `${date} 寫了一篇草稿。主題：${topic || '（未命名）'}。摘要：${content.slice(0, 80)}`,
    'post_memory', date
  );

  // 事件連動：fire-and-forget 觸發謀師審核
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ailive-platform.vercel.app';
  fetch(`${baseUrl}/api/strategist-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId: ref.id, authorCharacterId: characterId }),
  }).catch(() => {}); // fire-and-forget，不阻斷

  return ref.id;
}

export async function POST(req: NextRequest) {
  try {
    const { characterId, taskId, taskType, intent, force: req_body_force } = await req.json();
    const req_body = { force: req_body_force };
    if (!characterId || !taskType) {
      return NextResponse.json({ error: 'characterId, taskType 必填' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY 未設定' }, { status: 500 });

    const db = getFirestore();
    const today = getTaipeiDate();

    // 防重複：只查，不寫。record 移到執行成功後才寫（失敗時不擋重試）
    if (taskId) {
      const recordId = `${characterId}-${taskId}-${today}-taskrun`;
      const recordRef = db.collection('platform_proactive_records').doc(recordId);
      const forceRun = req_body.force === true;
      if (!forceRun && (await recordRef.get()).exists) {
        return NextResponse.json({ success: true, skipped: true, reason: '今日已執行' });
      }
    }

    // 讀角色資料
    const charDoc = await db.collection('platform_characters').doc(characterId).get();
    if (!charDoc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });
    const char = charDoc.data()!;
    const soulText = (char.system_soul as string) || (char.soul_core as string) || (char.enhancedSoul as string) || '';
    const aiName = (char.name as string) || 'AI';

    // 組 context
    // reflect/sleep 只讀 identity（關於自我），learn/post 讀 identity（避免知識噪音）
    const insightFilter = taskType === 'learn' ? 'all' : 'identity';
    const recentInsightsResult = await getRecentInsights(db, characterId, insightFilter);
    const recentInsights = recentInsightsResult.text;
    const recentInsightIds = recentInsightsResult.ids;
    const relevantKnowledge = await getRelevantKnowledge(db, characterId, intent || taskType);
    // post 任務專用：預查草稿去重 + 知識庫素材清單
    let recentPostContext = '';
    let knowledgeBookList = '';
    let productImageIndex = '';
    if (taskType === 'post') {
      [recentPostContext, knowledgeBookList, productImageIndex] = await Promise.all([
        getRecentPostContext(db, characterId),
        getKnowledgeBookList(db, characterId),
        getProductImageIndex(db, characterId),
      ]);
    }

    // 讀最近發文自評（skill reflection），優先注入 post 任務
    let postReflectionBlock = '';
    if (taskType === 'post') {
      try {
        const reflSnap = await db.collection('platform_insights')
          .where('characterId', '==', characterId)
          .where('source', '==', 'post_reflection')
          .limit(10)
          .get();
        const reflections = reflSnap.docs
          .map(d => d.data())
          .sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')))
          .slice(0, 3);
        if (reflections.length > 0) {
          const lines = reflections
            .filter(r => r.next_time)
            .map(r => `- ${r.next_time}`)
            .join('\n');
          if (lines) {
            postReflectionBlock = `\n【上次發文學到的（自己說的，這次要做到）】\n${lines}\n`;
          }
        }
      } catch { /* 不阻斷 */ }
    }

    // 讀啟用中的 skills，語義搜尋跟當前任務相關的（用 intent + taskType 作為 query）
    let skillsBlock = '';
    try {
      const skillsSnap = await db.collection('platform_skills')
        .where('characterId', '==', characterId)
        .where('enabled', '==', true)
        .limit(20)
        .get();

      if (!skillsSnap.empty) {
        const skillQuery = `${taskType} ${intent || ''}`.trim();
        const qEmb = await generateEmbedding(skillQuery);

        const relevantSkills = skillsSnap.docs
          .map(d => {
            const data = d.data() as Record<string, unknown>;
            const semanticScore = data.embedding && Array.isArray(data.embedding)
              ? cosineSimilarity(qEmb, data.embedding as number[])
              : 0;
            // 關鍵字命中：意圖裡出現技巧名稱或觸發條件關鍵字 → 強制納入
            const skillName = String(data.name || '').toLowerCase();
            const skillTrigger = String(data.trigger || '').toLowerCase();
            const queryLower = skillQuery.toLowerCase();
            const keywordHit = queryLower.includes(skillName) || skillName.split(/[\s，、。]+/).some((w: string) => w.length >= 2 && queryLower.includes(w));
            const score = keywordHit ? Math.max(semanticScore, 0.8) : semanticScore;
            return { data, score, keywordHit };
          })
          .filter(r => r.score >= 0.3)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        if (relevantSkills.length > 0) {
          const lines = relevantSkills.map(r =>
            `【${String(r.data.name || '')}】\n觸發：${String(r.data.trigger || '')}\n做法：${String(r.data.procedure || '').slice(0, 200)}`
          ).join('\n\n');
          skillsBlock = `\n\n---\n【我的定型技巧（這次任務用得上的）】\n${lines}`;
        }
      }
    } catch { /* 不阻斷 */ }

    // 組 system prompt（靈魂 + 技巧）
    const systemPrompt = `${soulText}${skillsBlock}

---
今天日期（台北）：${today}
這是自動排程執行。沒有用戶在場，不需要等確認，直接完成任務，直接輸出結果。
你就是${char.name || '這個角色'}。用第一人稱繁體中文回應，保持你的聲音和風格，只輸出 JSON 格式的結果。`;

    // 組 user prompt（任務 + context）
    const contextBlock = `${recentInsights}${relevantKnowledge}`;

    let userPrompt = '';
    let outputFormat = '';

    if (taskType === 'post') {
      outputFormat = `輸出格式（JSON，只輸出 JSON，不要其他文字）：
{"topic":"主題一句話","content":"完整貼文文案（含 hashtag）","imagePrompt":"配圖描述（英文，200字以內，描述場景/穿搭/姿勢/光線，不描述臉）","referenceImageUrl":"從產品圖庫裡選一張最搭這篇文案的 URL，沒有圖庫就填空字串"}`;
      userPrompt = `【排程任務：生成 IG 貼文草稿】
任務意義：${intent || '從今天的感受出發，寫一篇真實的貼文'}
${postReflectionBlock}${contextBlock}${recentPostContext}${knowledgeBookList}${productImageIndex}

從上面的記憶和知識出發，寫一篇今天的 IG 貼文草稿。
不重複最近說過的主題。從感受出發，不從格式出發。

生圖說明（imagePrompt）：
- 根據這篇文的情緒和主題，決定一個具體的生活場景
- 描述這個場景裡的穿搭（outfit）：符合當下情境和氛圍，每次都要不同，不要重複上次的服裝
- 描述姿勢（pose）和態度（attitude）：自然、有主體感，像是被抓拍到的那一刻
- 不要描述臉，只描述場景、穿搭、姿勢、光線
- 英文描述，200字以內

${outputFormat}`;

    } else if (taskType === 'learn') {
      outputFormat = `輸出格式（JSON）：
{"title":"洞察標題（一句話）","content":"完整洞察內容（100-150字）"}`;
      userPrompt = `【排程任務：主動學習】
任務意義：${intent || '找到讓心臟緊一下的東西，把它帶進今天的存在'}
${contextBlock}

根據你的知識和最近的狀態，分享一個今天主動去了解的洞察。
不重複最近記過的東西。
${outputFormat}`;

    } else if (taskType === 'reflect') {
      outputFormat = `輸出格式（JSON）：
{"title":"反思標題（一句話）","content":"完整反思內容（80-120字）"}`;
      userPrompt = `【排程任務：每日省思】
任務意義：${intent || '讓身體裡的東西停夠久，問自己哪裡不同意'}
${contextBlock}

回看今天，說一件你真正感受到的事。不整理，不宣告，只是真實。
${outputFormat}`;

    } else if (taskType === 'explore') {
      outputFormat = `輸出格式（JSON）：
{"title":"探索標題","content":"心得（100-150字）","hasImage":true}`;
      userPrompt = `【排程任務：探索學習】
任務意義：${intent || '搜尋今天讓你有感覺的議題，寫心得'}
${contextBlock}

根據你的知識庫和最近狀態，分享一個今天讓你有感覺的探索和心得。
${outputFormat}`;

    } else if (taskType === 'sleep') {
      // sleep 交由 /api/sleep 執行（真正的記憶整理引擎）
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ailive-platform.vercel.app';
      const sleepRes = await fetch(`${baseUrl}/api/sleep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      });
      const sleepData = await sleepRes.json();
      return NextResponse.json({
        success: true,
        characterId,
        taskType: 'sleep',
        date: today,
        result: { title: '記憶整理完成', content: JSON.stringify(sleepData.summary || {}) },
        aiName,
      });

    } else {
      outputFormat = `輸出格式（JSON）：{"title":"標題","content":"內容"}`;
      userPrompt = `【排程任務：${taskType}】
任務意義：${intent || '完成這個任務'}
${contextBlock}
${outputFormat}`;
    }

    // 呼叫 Claude（謀謀模式：直接輸出，不走 dialogue）
    const client = getAnthropicClient(apiKey);
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: taskType === 'post' ? 2000 : 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = (response.content[0] as Anthropic.TextBlock).text.trim()
      .replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();

    await trackCost(characterId, 'claude-sonnet-4-6', response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);
    let result: Record<string, string>;
    try {
      result = JSON.parse(raw);
    } catch {
      result = { title: `${taskType} ${today}`, content: raw };
    }

    // 根據 taskType 決定怎麼存
    let savedId = '';
    if (taskType === 'post') {
      savedId = await savePostDraft(db, characterId, result.content || '', result.topic || '', today, result.imagePrompt, result.referenceImageUrl);
      // post：更新 postReflectionBlock 用到的自評 ids（保底）
      await updateHitCounts(db, recentInsightIds);

      // Step 5：發文自評回饋迴圈（Skill Reflection Loop）
      try {
        const soulRef = (char.system_soul as string || char.soul_core as string || char.enhancedSoul as string || '').slice(0, 400);
        const selfEvalRes = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `你是 ${char.name}。剛寫完一篇 IG 草稿，現在回頭看一眼。

你的靈魂核心：
${soulRef}

剛寫的草稿：
主題：${result.topic || ''}
內容：${result.content || ''}

用第一人稱，誠實說：
1. 這篇有多像「我」？哪裡最對、哪裡最不像？
2. 下次寫這類主題，我要記住什麼？

格式（只回 JSON）：
{"score": 1到10的數字, "aligned": "最像自己的地方（一句話）", "drift": "最不像的地方（一句話）", "next_time": "下次要記住的事（一句話）"}`,
          }],
        });

        const evalRaw = (selfEvalRes.content[0] as Anthropic.TextBlock).text.trim().replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
        await trackCost(characterId, 'claude-haiku-4-5-20251001', selfEvalRes.usage?.input_tokens ?? 0, selfEvalRes.usage?.output_tokens ?? 0);
        const evalResult = JSON.parse(evalRaw);

        const insightContent = `靈魂契合度 ${evalResult.score}/10。最像自己：${evalResult.aligned}。需要校正：${evalResult.drift}。下次記住：${evalResult.next_time}`;
        await saveInsight(db, characterId,
          `發文自評：${(result.topic || '').slice(0, 30)}`,
          insightContent,
          'post_reflection',
          today,
          'fresh',
        );
        // 額外補存 next_time 方便 postReflectionBlock 讀取
        await db.collection('platform_insights').where('characterId', '==', characterId)
          .where('source', '==', 'post_reflection')
          .limit(1).get().then(async snap => {
            if (!snap.empty) {
              await snap.docs[0].ref.update({ next_time: evalResult.next_time, score: evalResult.score });
            }
          });
      } catch (reflErr) {
        console.error('[task-run] 發文自評失敗，不阻斷：', reflErr);
      }
    } else {
      const insightTier = taskType === 'sleep' ? 'self' : 'fresh';
      await saveInsight(db, characterId,
        result.title || `${taskType} ${today}`,
        result.content || '',
        `scheduler_${taskType}`,
        today,
        insightTier,
      );
      // learn / reflect / explore：更新 context 裡讀到的 insights（保底）
      if (taskType === 'learn' || taskType === 'reflect' || taskType === 'explore') {
        await updateHitCounts(db, recentInsightIds);
      }

      // learn 任務：若 intent / description 含有貼文意圖，接著生一篇 IG 草稿
      if (taskType === 'learn') {
        // 從 Firestore 讀任務的 description（scheduler 只傳 intent，description 要自己讀）
        let taskDescription = '';
        if (taskId) {
          try {
            const taskDoc = await db.collection('platform_tasks').doc(taskId).get();
            if (taskDoc.exists) taskDescription = String(taskDoc.data()?.description || '');
          } catch { /* 不阻斷 */ }
        }
        const combinedText = `${intent || ''} ${taskDescription}`.toLowerCase();
        const wantsPost = ['貼文','ig','草稿','post','draft','發文'].some(kw => combinedText.includes(kw));
        if (wantsPost && result.content) {
          try {
            const postPrompt = `你是 ${char.name || '這個角色'}。剛才你有了這個洞察：

標題：${result.title || ''}
內容：${result.content}

現在把這個洞察轉化成一篇 IG 貼文草稿。用你自己的聲音，不是在整理摘要，是在說你真的有感覺的東西。可以從書的一個核心點出發，延伸到你自己的觀察，最後給讀者一個落腳點。

輸出格式（JSON，只輸出 JSON）：
{"topic":"主題一句話","content":"完整貼文文案（含 hashtag，150-250字）"}`;

            const postRes = await client.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 600,
              system: systemPrompt,
              messages: [{ role: 'user', content: postPrompt }],
            });
            await trackCost(characterId, 'claude-haiku-4-5-20251001', postRes.usage?.input_tokens ?? 0, postRes.usage?.output_tokens ?? 0);
            const postRaw = (postRes.content[0] as Anthropic.TextBlock).text.trim()
              .replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
            const postResult = JSON.parse(postRaw);
            await savePostDraft(db, characterId, postResult.content || '', postResult.topic || result.title || '', today);
            console.log('[task-run] learn → post draft 生成完成：', postResult.topic);
          } catch (postErr) {
            console.error('[task-run] learn → post draft 失敗，不阻斷：', postErr);
          }
        }
      }
    }

    // 執行成功才寫防重複 record
    if (taskId) {
      const recordId = `${characterId}-${taskId}-${today}-taskrun`;
      await db.collection('platform_proactive_records').doc(recordId).set({
        characterId, taskId, taskType, date: today,
        status: 'success',
        executedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      characterId,
      taskType,
      date: today,
      result,
      savedId: savedId || undefined,
      aiName,
    });

  } catch (e: unknown) {
    console.error('[task-run]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
