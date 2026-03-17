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

  return insight.title;
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
