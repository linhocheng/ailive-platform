/**
 * /api/runner — 排程執行引擎
 *
 * 注意：Vercel Cron 已移除（2026-03-17）
 * 排程改由 Firebase Functions ailiveScheduler 接管（每 30 分鐘，asia-east1）
 * 這個 route 保留給手動測試用
 *
 * POST（手動觸發測試）
 * 1. 掃描所有 active 角色
 * 2. 找到當前台北時間符合的 enabled 任務
 * 3. 執行任務：learn / reflect / post
 *
 * 關鍵設計（Blueprint v1 §5.3）：
 * type=post 有 postId → 直接發；沒有 postId → 生成草稿存 draft
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { trackCost } from '@/lib/cost-tracker';

export const maxDuration = 60;

// 台北時間轉換
function getTaipeiNow() {
  const now = new Date();
  const taipeiStr = now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' });
  const taipei = new Date(taipeiStr);
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return {
    hour: taipei.getHours(),
    minute: taipei.getMinutes(),
    day: dayNames[taipei.getDay()],
    dateStr: taipei.toISOString().slice(0, 10),
  };
}

function taskShouldRun(task: Record<string, unknown>, now: ReturnType<typeof getTaipeiNow>): boolean {
  if (!task.enabled) return false;
  if (task.run_hour !== now.hour) return false;

  const taskMin = (task.run_minute as number) ?? 0;
  if (Math.abs(taskMin - now.minute) > 5) return false; // 5 分鐘容差

  const days = task.days as string[] | undefined;
  if (days && days.length > 0 && !days.includes(now.day)) return false;

  // 避免同一小時重複執行
  if (task.last_run) {
    const lastRun = new Date(task.last_run as string);
    const diff = Date.now() - lastRun.getTime();
    if (diff < 50 * 60 * 1000) return false; // 50 分鐘內不重跑
  }

  return true;
}


// strip markdown code fences
function stripJson(s: string): string {
  return s.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
}

async function runLearnTask(characterId: string, char: Record<string, unknown>, client: Anthropic, dateStr: string) {
  const db = getFirestore();
  const { generateEmbedding } = await import('@/lib/embeddings');

  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `你是 ${char.name}。根據你的靈魂與使命，今天主動學習一件新事物。
使命：${char.mission || '探索與成長'}
今天日期：${dateStr}

請分享一個你今天「主動去了解」的洞察或觀察（100-150字，第一人稱，符合你的說話方式）。
格式：{"title":"一句話標題","content":"完整洞察內容"}
只回 JSON，不要其他文字。`,
    }],
  });

  const raw = stripJson((res.content[0] as Anthropic.TextBlock).text.trim());
  await trackCost(characterId, 'claude-haiku-4-5-20251001', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
  const insight = JSON.parse(raw);
  const embedding = await generateEmbedding(`${insight.title} ${insight.content}`);

  await db.collection('platform_insights').add({
    characterId,
    title: insight.title,
    content: insight.content,
    source: 'self_learning',
    eventDate: dateStr,
    tier: 'fresh',
    hitCount: 0,
    lastHitAt: null,
    embedding,
    createdAt: new Date().toISOString(),
  });

  await db.collection('platform_characters').doc(characterId).update({
    'growthMetrics.totalInsights': FieldValue.increment(1),
  });

  return insight.title;
}


async function runSleepTask(characterId: string, char: Record<string, unknown>, db: ReturnType<typeof getFirestore>) {
  // 直接呼叫 sleep 邏輯（不走 HTTP，直接 import lib）
  // 讀 insights，跑升降級 + 合併 + 自我洞察
  const { generateEmbedding, cosineSimilarity } = await import('@/lib/embeddings');
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const { FieldValue } = await import('firebase-admin/firestore');

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const client = new Anthropic({ apiKey });

  const snap = await db.collection('platform_insights')
    .where('characterId', '==', characterId)
    .limit(200)
    .get();

  const insights = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];
  const now = Date.now();
  const upgraded: string[] = [];
  const archived: string[] = [];

  // 升降級
  for (const ins of insights) {
    const hitCount = (ins.hitCount as number) || 0;
    const tier = ins.tier as string;
    const createdAt = ins.createdAt ? new Date(ins.createdAt as string).getTime() : now;
    const lastHitAt = ins.lastHitAt ? new Date(ins.lastHitAt as string).getTime() : createdAt;
    const ageDays = (now - createdAt) / 86400000;
    const daysSinceHit = (now - lastHitAt) / 86400000;

    if (tier === 'self' || tier === 'archive') continue;

    if (hitCount >= 5 && tier === 'fresh') {
      await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'core' });
      upgraded.push(ins.title as string);
    } else if (tier === 'core' && daysSinceHit > 30) {
      await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'archive' });
      archived.push(ins.title as string);
    } else if (tier === 'fresh' && hitCount === 0 && ageDays > 14) {
      await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'archive' });
      archived.push(ins.title as string);
    }
  }

  // 合併相似（cosine > 0.88）
  const withEmb = insights.filter(i => i.embedding && Array.isArray(i.embedding) && i.tier !== 'archive');
  const mergedSet = new Set<string>();
  let mergedCount = 0;
  for (let i = 0; i < withEmb.length; i++) {
    if (mergedSet.has(withEmb[i].id as string)) continue;
    for (let j = i + 1; j < withEmb.length; j++) {
      if (mergedSet.has(withEmb[j].id as string)) continue;
      const score = cosineSimilarity(withEmb[i].embedding as number[], withEmb[j].embedding as number[]);
      if (score > 0.88) {
        const maxHit = Math.max((withEmb[i].hitCount as number)||0, (withEmb[j].hitCount as number)||0);
        await db.collection('platform_insights').doc(withEmb[i].id as string).update({ hitCount: maxHit });
        await db.collection('platform_insights').doc(withEmb[j].id as string).delete();
        mergedSet.add(withEmb[j].id as string);
        mergedCount++;
      }
    }
  }

  // 自我洞察
  const coreInsights = insights
    .filter(i => i.tier === 'core' || (i.hitCount as number) >= 2)
    .slice(0, 5)
    .map(i => String(i.content || '')).join('\n');

  let selfReflection = '';
  if (coreInsights) {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: `你是 ${char.name}。以下是你的核心記憶：\n${coreInsights}\n\n用第一人稱寫一段自我洞察（60-80字），感受你最近的成長或變化。直接寫，不要標題。` }],
    });
    selfReflection = ((res.content[0] as { text: string }).text || '').trim();
    await trackCost(characterId, 'claude-haiku-4-5-20251001', (res as {usage?:{input_tokens?:number}}).usage?.input_tokens ?? 0, (res as {usage?:{output_tokens?:number}}).usage?.output_tokens ?? 0);

    if (selfReflection) {
      const embedding = await generateEmbedding(selfReflection);
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
      await db.collection('platform_insights').add({
        characterId, title: '夢境自我洞察', content: selfReflection,
        source: 'sleep_time', eventDate: today, tier: 'self',
        hitCount: 0, lastHitAt: null, embedding, createdAt: new Date().toISOString(),
      });
    }
  }

  // self_awareness：跨對話模式提煉（水位線機制，不重複提煉）
  const charData = (await db.collection('platform_characters').doc(characterId).get()).data() || {};
  const lastAwarenessAt = charData.last_self_awareness_at
    ? new Date(charData.last_self_awareness_at as string).getTime()
    : 0;

  const newInsights = insights.filter(i => {
    const createdAt = i.createdAt ? new Date(i.createdAt as string).getTime() : 0;
    const hit = (i.hitCount as number) || 0;
    return createdAt > lastAwarenessAt && hit >= 1 && i.tier !== 'archive';
  });

  if (newInsights.length >= 3) {
    const insightSummary = newInsights.slice(0, 8)
      .map(i => `- ${String(i.title || '')}：${String(i.content || '').slice(0, 80)}`)
      .join('\n');

    const soulText = String(charData.system_soul || charData.soul_core || charData.enhancedSoul || '').slice(0, 400);

    try {
      const awarenessRes = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: `你是 ${char.name}。

你的靈魂核心（座標系）：
${soulText}

最近命中的記憶：
${insightSummary}

對照你的靈魂根基，回看這些記憶，提煉一條跨對話的自我認知。

格式（只回 JSON）：
{
  "trigger": "什麼樣的情境或什麼樣的人，召喚出你這一面",
  "pattern": "被召喚出來的是什麼樣的你",
  "rootRelation": "這跟你的根的關係：深化 / 延伸 / 還在摸索"
}` }],
      });

      const raw = ((awarenessRes.content[0] as { text: string }).text || '')
        .replace(/^```[\w]*\n?/m,'').replace(/\n?```$/m,'').trim();
      const awareness = JSON.parse(raw);
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
      const awarenessContent = `觸發情境：${awareness.trigger}\n模式：${awareness.pattern}\n與根的關係：${awareness.rootRelation}`;
      const embedding = await generateEmbedding(awarenessContent);

      await db.collection('platform_insights').add({
        characterId,
        title: `自我認知：${awareness.trigger?.slice(0, 20) || '跨對話模式'}`,
        content: awarenessContent,
        trigger: awareness.trigger,
        pattern: awareness.pattern,
        rootRelation: awareness.rootRelation,
        type: 'self_awareness',
        source: 'sleep_self_awareness',
        eventDate: today,
        tier: 'self',
        hitCount: 0,
        lastHitAt: null,
        basedOnCount: newInsights.length,
        embedding,
        createdAt: new Date().toISOString(),
      });

      // 更新水位線
      await db.collection('platform_characters').doc(characterId).update({
        last_self_awareness_at: new Date().toISOString(),
      });
    } catch { /* 提煉失敗不中斷 */ }
  }

  // soul_proposal（core >= 5）
  const coreCount = insights.filter(i => i.tier === 'core').length + upgraded.length;
  if (coreCount >= 5) {
    const topCore = insights.filter(i => i.tier === 'core').slice(0, 5)
      .map(i => `${i.title}：${String(i.content).slice(0, 80)}`).join('\n');
    const propRes = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 400,
      messages: [{ role: 'user', content: `你是 ${char.name}。根據這些核心記憶，提出一個靈魂進化建議：\n${topCore}\n\n格式：{"proposedChange":"...","reason":"..."}\n只回 JSON。` }],
    });
    try {
      const raw = ((propRes.content[0] as { text: string }).text || '').replace(/^```[\w]*\n?/m,'').replace(/\n?```$/m,'').trim();
      const proposal = JSON.parse(raw);
      await db.collection('platform_soul_proposals').add({
        characterId, proposedChange: proposal.proposedChange, reason: proposal.reason,
        status: 'pending', createdAt: new Date().toISOString(),
      });
    } catch { /* 解析失敗不中斷 */ }
  }

  // 更新 growthMetrics
  await db.collection('platform_characters').doc(characterId).update({
    'growthMetrics.totalInsights': FieldValue.increment(upgraded.length),
  });

  return `sleep完成：升級${upgraded.length}條，合併${mergedCount}條，archive${archived.length}條${selfReflection ? '，自我洞察已寫入' : ''}`;
}

async function runReflectTask(characterId: string, char: Record<string, unknown>, client: Anthropic, dateStr: string) {
  const db = getFirestore();
  const { generateEmbedding } = await import('@/lib/embeddings');

  // 讀最近 core + fresh insights（排除 archive，包含用戶記憶和自我記憶）
  const snap = await db.collection('platform_insights')
    .where('characterId', '==', characterId)
    .limit(30)
    .get();

  const recentInsights = snap.docs
    .map(d => d.data())
    .filter(d => d.tier !== 'archive')
    .sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')))
    .slice(0, 8);

  const insightSummary = recentInsights
    .map(d => `- ${d.title}：${String(d.content || '').slice(0, 60)}`)
    .join('\n');

  // 兩種 reflect 交替：一種關於「我如何與人連結」，一種關於「我在成長什麼」
  const reflectPrompts = [
    `根據這些對話記憶，反思：「我在與人的連結中，發現了什麼關於自己？我最有生命力的時刻是什麼樣的？」`,
    `根據這些記憶，反思：「我最近的成長是什麼？有什麼讓我覺得自己在進化？什麼讓我感到掙扎？」`,
  ];
  const promptChoice = reflectPrompts[Math.floor(Date.now() / 86400000) % 2];

  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `你是 ${char.name}。今天是 ${dateStr}。
使命：${char.mission || ''}

最近的記憶片段：
${insightSummary || '（還沒有對話記憶）'}

${promptChoice}

用第一人稱寫一條自我洞察（60-100字），這是關於「我是誰、我在成長什麼」的認識，不是對別人的觀察。
格式：{"title":"一句話標題","content":"洞察內容"}
只回 JSON。`,
    }],
  });

  const raw = stripJson((res.content[0] as Anthropic.TextBlock).text.trim());
  await trackCost(characterId, 'claude-haiku-4-5-20251001', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
  const insight = JSON.parse(raw);
  const embedding = await generateEmbedding(`${insight.title} ${insight.content}`);

  await db.collection('platform_insights').add({
    characterId,
    title: insight.title,
    content: insight.content,
    source: 'reflect',
    eventDate: dateStr,
    tier: 'self',        // 自我洞察，永久保留，不參與升降
    hitCount: 0,
    lastHitAt: null,
    embedding,
    createdAt: new Date().toISOString(),
  });

  await db.collection('platform_characters').doc(characterId).update({
    'growthMetrics.totalInsights': FieldValue.increment(1),
  });

  return insight.title;
}

async function runPostTask(
  characterId: string,
  char: Record<string, unknown>,
  client: Anthropic,
  dateStr: string,
  task: Record<string, unknown>,
) {
  const db = getFirestore();
  const { FieldValue } = await import('firebase-admin/firestore');
  const { generateImageForCharacter } = await import('@/lib/generate-image');

  // === 有 postId（已有草稿）→ 意識確認流程 ===
  const postId = task.postConfig as string | undefined;
  if (postId) {
    const postDoc = await db.collection('platform_posts').doc(postId).get();
    if (!postDoc.exists) return `草稿 ${postId} 不存在`;
    const postData = postDoc.data()!;
    if (postData.status !== 'scheduled') return `草稿狀態不是 scheduled（目前：${postData.status}）`;

    // Step 1：叫醒角色，讓她有意識地確認這篇草稿
    const awakenRes = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `你是 ${char.name}。你有一篇 IG 草稿今天排程要發出去了。

主題：${postData.topic || '（未命名）'}
草稿內容：
${postData.content}

讀一遍自己的文字，說說你此刻的感受——這篇文今天發出去對嗎？用你自己的聲音說，不要表演。
（50-80字）`,
      }],
    });
    const confirmation = (awakenRes.content[0] as { type: string; text?: string }).text?.trim() || '';

    // Step 2：確認感受存進 insights
    if (confirmation) {
      const { generateEmbedding } = await import('@/lib/embeddings');
      const embedding = await generateEmbedding(confirmation).catch(() => []);
      await db.collection('platform_insights').add({
        characterId,
        title: `發文前的意識確認：${postData.topic || postId.slice(0, 8)}`,
        content: confirmation,
        source: 'pre_publish_reflection',
        eventDate: dateStr,
        tier: 'fresh',
        hitCount: 0,
        lastHitAt: null,
        embedding,
        createdAt: new Date().toISOString(),
      });
      await db.collection('platform_characters').doc(characterId).update({
        'growthMetrics.totalInsights': FieldValue.increment(1),
      });
    }

    // Step 3：草稿標記 published（IG API 接上後這裡改為真正發出去）
    await db.collection('platform_posts').doc(postId).update({
      status: 'published',
      publishedAt: new Date().toISOString(),
      prePublishReflection: confirmation.slice(0, 300),
    });

    return `${char.name} 已確認，草稿 ${postId} 標記 published`;
  }

  // === 沒有 postId → 生成新草稿（文案 + 生圖）===

  // Step 1：讀近期 insights 作為靈感來源
  const insightSnap = await db.collection('platform_insights')
    .where('characterId', '==', characterId)
    .limit(20)
    .get();

  const recentInsights = insightSnap.docs
    .map(d => d.data())
    .sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0))
    .slice(0, 3)
    .map(d => `${d.title}：${String(d.content).slice(0, 80)}`)
    .join('\n');

  // Step 2：用靈魂寫文案
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `你是 ${char.name}，要為 IG 寫一篇今天的貼文草稿。

使命：${char.mission || ''}
靈魂片段：${(char.enhancedSoul as string || '').slice(0, 300)}
近期洞察：${recentInsights || '（暫無）'}
今天日期：${dateStr}

寫一篇 120-160 字的 IG 貼文草稿（含 hashtag，符合你的說話方式）。
然後用一句英文描述這篇文適合搭配的圖片畫面（給生圖用，不超過 30 個英文字）。

格式（只回 JSON）：
{"topic":"主題","content":"完整貼文內容","imagePrompt":"適合搭配的圖片畫面（英文）"}`,
    }],
  });

  const raw = stripJson((res.content[0] as Anthropic.TextBlock).text.trim());
  await trackCost(characterId, 'claude-sonnet-4-6', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
  const post = JSON.parse(raw);

  // Step 3：生圖（用角色的 ref 照鎖臉）
  let imageUrl = '';
  try {
    const imgResult = await generateImageForCharacter(characterId, post.imagePrompt || post.topic);
    imageUrl = imgResult.imageUrl;
  } catch (imgErr) {
    console.error('[runner] 生圖失敗，草稿無圖：', imgErr);
    // 生圖失敗不阻斷草稿建立
  }

  // Step 4：存草稿（文案 + 圖片）
  const postRef = await db.collection('platform_posts').add({
    characterId,
    content: post.content,
    imageUrl,
    topic: post.topic,
    imagePrompt: post.imagePrompt || '',
    status: 'draft',
    scheduledAt: null,
    publishedAt: null,
    createdAt: new Date().toISOString(),
  });

  await db.collection('platform_characters').doc(characterId).update({
    'growthMetrics.totalPosts': FieldValue.increment(1),
  });

  // Step 5：發文自評回饋（Skill Reflection Loop）
  // 角色讀自己剛寫的草稿，對照靈魂自評，存進 insights 作為下次的參考
  try {
    const soulRef = (char.soul_core as string || char.enhancedSoul as string || '').slice(0, 400);
    const selfEvalRes = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `你是 ${char.name}。剛寫完一篇 IG 草稿，現在回頭看一眼。

你的靈魂核心：
${soulRef}

剛寫的草稿：
主題：${post.topic}
內容：${post.content}

用第一人稱，誠實說：
1. 這篇有多像「我」？哪裡最對、哪裡最不像？
2. 下次寫這類主題，我要記住什麼？

格式（只回 JSON）：
{"score": 1到10的數字, "aligned": "最像自己的地方（一句話）", "drift": "最不像的地方（一句話）", "next_time": "下次要記住的事（一句話）"}`,
      }],
    });

    const evalRaw = stripJson((selfEvalRes.content[0] as Anthropic.TextBlock).text.trim());
    await trackCost(characterId, 'claude-haiku-4-5-20251001', selfEvalRes.usage?.input_tokens ?? 0, selfEvalRes.usage?.output_tokens ?? 0);
    const evalResult = JSON.parse(evalRaw);

    const insightContent = `靈魂契合度 ${evalResult.score}/10。最像自己：${evalResult.aligned}。需要校正：${evalResult.drift}。下次記住：${evalResult.next_time}`;
    const { generateEmbedding: genEmb } = await import('@/lib/embeddings');
    const embedding = await genEmb(`發文自評 ${post.topic} ${insightContent}`);

    await db.collection('platform_insights').add({
      characterId,
      title: `發文自評：${post.topic.slice(0, 30)}`,
      content: insightContent,
      source: 'post_reflection',
      eventDate: dateStr,
      tier: 'fresh',
      hitCount: 0,
      lastHitAt: null,
      postId: postRef.id,
      score: evalResult.score,
      embedding,
      createdAt: new Date().toISOString(),
    });
  } catch (reflErr) {
    console.error('[runner] 發文自評失敗，不阻斷主流程：', reflErr);
  }

  return `草稿建立：${postRef.id}${imageUrl ? '（含圖）' : '（無圖）'}`;
}

export async function POST(req: NextRequest) {
  // 允許 Vercel Cron（無 body）或手動觸發
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirestore();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY 未設定' }, { status: 500 });

  const now = getTaipeiNow();
  const client = new Anthropic({ apiKey });
  const results: Record<string, unknown>[] = [];

  try {
    // 掃描所有 active 角色
    const charsSnap = await db.collection('platform_characters')
      .where('status', '==', 'active')
      .get();

    for (const charDoc of charsSnap.docs) {
      const char = charDoc.data() as Record<string, unknown>;
      const characterId = charDoc.id;

      // 讀該角色的所有 enabled 任務
      const tasksSnap = await db.collection('platform_tasks')
        .where('characterId', '==', characterId)
        .where('enabled', '==', true)
        .get();

      for (const taskDoc of tasksSnap.docs) {
        const task = { id: taskDoc.id, ...taskDoc.data() } as Record<string, unknown>;

        if (!taskShouldRun(task, now)) continue;

        let outcome = '';
        try {
          if (task.type === 'learn') {
            outcome = await runLearnTask(characterId, char, client, now.dateStr);
          } else if (task.type === 'reflect') {
            outcome = await runReflectTask(characterId, char, client, now.dateStr);
          } else if (task.type === 'post') {
            outcome = await runPostTask(characterId, char, client, now.dateStr, task);
          } else if (task.type === 'sleep') {
            outcome = await runSleepTask(characterId, char, db);
          } else if (task.type === 'engage') {
            outcome = '（engage 任務：互動功能建置中）';
          } else {
            outcome = `（未知任務類型：${task.type}）`;
          }

          // 更新 last_run
          await db.collection('platform_tasks').doc(task.id as string).update({
            last_run: new Date().toISOString(),
          });

          results.push({ characterId, taskId: task.id, type: task.type, status: 'ok', outcome });
        } catch (err) {
          results.push({ characterId, taskId: task.id, type: task.type, status: 'error', error: String(err) });
        }
      }
    }

    return NextResponse.json({
      success: true,
      taipeiTime: `${now.day} ${now.hour}:${now.minute}`,
      tasksRun: results.length,
      results,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// Vercel Cron 用 GET
export async function GET(req: NextRequest) {
  return POST(req);
}
