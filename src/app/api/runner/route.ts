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
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import { redis } from '@/lib/redis';
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

async function runLearnTask(
  _characterId: string,
  _char: Record<string, unknown>,
  _client: unknown,
  _dateStr: string,
): Promise<string> {
  // learn 任務由 task-run 接管，runner 略過
  return 'learn 任務由 task-run 接管，runner 略過';
}

async function runSleepTask(characterId: string, char: Record<string, unknown>, db: ReturnType<typeof getFirestore>) {
  // 直接呼叫 sleep 邏輯（不走 HTTP，直接 import lib）
  // 讀 insights，跑升降級 + 合併 + 自我洞察
  const { generateEmbedding, cosineSimilarity } = await import('@/lib/embeddings');
  const { FieldValue } = await import('firebase-admin/firestore');

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const client = getAnthropicClient(apiKey);

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

async function runReflectTask(
  _characterId: string,
  _char: Record<string, unknown>,
  _client: unknown,
  _dateStr: string,
): Promise<string> {
  // reflect 任務由 task-run 接管，runner 略過
  return 'reflect 任務由 task-run 接管，runner 略過';
}

async function runPostTask(
  _characterId: string,
  _char: Record<string, unknown>,
  _client: unknown,
  _dateStr: string,
  _task: Record<string, unknown>,
): Promise<string> {
  // post 任務已由 task-run 接管（ailiveScheduler → /api/task-run）
  // runner 不再執行 post 邏輯，防止重複生稿
  return 'post 任務由 task-run 接管，runner 略過';
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
  const client = getAnthropicClient(apiKey);
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

        // 與 task-run 共用防重複記錄，避免兩套系統同一天重複執行
        const recordId = `${characterId}-${task.id as string}-${now.dateStr}-taskrun`;
        const recordRef = db.collection('platform_proactive_records').doc(recordId);
        if ((await recordRef.get()).exists) {
          results.push({ characterId, taskId: task.id, type: task.type, status: 'skipped', reason: 'task-run 已執行' });
          continue;
        }
        await recordRef.set({
          characterId, taskId: task.id, taskType: task.type,
          date: now.dateStr, executedAt: new Date().toISOString(), source: 'runner',
        });

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
