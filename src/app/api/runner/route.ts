/**
 * /api/runner — Vercel Cron 觸發點
 *
 * POST（由 Vercel Cron 每小時呼叫）
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

  // 讀今天的 insights
  const snap = await db.collection('platform_insights')
    .where('characterId', '==', characterId)
    .where('eventDate', '==', dateStr)
    .limit(10)
    .get();

  const todayInsights = snap.docs.map(d => d.data().title).join('、');

  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `你是 ${char.name}。今天是 ${dateStr}。
今天的洞察：${todayInsights || '（今天還沒有記錄）'}
使命：${char.mission || ''}

用你自己的語氣寫一段今日省思（80-120字，第一人稱）。
格式：{"title":"今日省思標題","content":"省思內容"}
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
    tier: 'fresh',
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

  // 關鍵設計：有 postId → 直接發佈（不重新生成）
  const postId = task.postConfig as string | undefined;
  if (postId) {
    const postDoc = await db.collection('platform_posts').doc(postId).get();
    if (postDoc.exists && postDoc.data()?.status === 'scheduled') {
      // 有 IG token 就發，沒有就標記 published（待接 IG）
      await db.collection('platform_posts').doc(postId).update({
        status: 'published',
        publishedAt: new Date().toISOString(),
      });
      return `published post ${postId}`;
    }
  }

  // 沒有 postId → 生成草稿，等 Adam 審核
  const insightSnap = await db.collection('platform_insights')
    .where('characterId', '==', characterId)
    .limit(5)
    .get();

  const recentInsights = insightSnap.docs
    .map(d => d.data())
    .sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0))
    .slice(0, 3)
    .map(d => d.content)
    .join('\n');

  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `你是 ${char.name}，要寫一篇 IG 貼文草稿。
使命：${char.mission || ''}
靈魂片段：${(char.enhancedSoul as string || '').slice(0, 200)}
近期洞察：${recentInsights || '暫無'}
今天日期：${dateStr}

寫一篇 120-160 字的 IG 貼文（含 hashtag，符合你的說話方式）。
格式：{"topic":"主題","content":"完整貼文內容"}
只回 JSON。`,
    }],
  });

  const raw = stripJson((res.content[0] as Anthropic.TextBlock).text.trim());
  const post = JSON.parse(raw);

  const postRef = await db.collection('platform_posts').add({
    characterId,
    content: post.content,
    imageUrl: '',
    topic: post.topic,
    status: 'draft',
    scheduledAt: null,
    publishedAt: null,
    createdAt: new Date().toISOString(),
  });

  // 更新 growthMetrics
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.collection('platform_characters').doc(characterId).update({
    'growthMetrics.totalPosts': FieldValue.increment(1),
  });

  return `draft created: ${postRef.id}`;
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
