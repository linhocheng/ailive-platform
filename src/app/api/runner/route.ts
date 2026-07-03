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
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
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



async function runLearnTask(
  _characterId: string,
  _char: Record<string, unknown>,
  _client: unknown,
  _dateStr: string,
): Promise<string> {
  // learn 任務由 task-run 接管，runner 略過
  return 'learn 任務由 task-run 接管，runner 略過';
}

async function runSleepTask(characterId: string, _char: Record<string, unknown>, db: ReturnType<typeof getFirestore>) {
  // 邏輯全在 @/lib/sleep-engine（與 /api/sleep 共用，收斂點）。
  // 2026-07-03 前這裡是一份舊版複製體（hitCount>=5 舊升級規則、無 rootRelevance、
  // 純 cosine 0.88 硬刪）——每小時排程跑舊腦，手動打 /api/sleep 才是新腦。已根治。
  const { runSleepEngine } = await import('@/lib/sleep-engine');
  const { summary } = await runSleepEngine(db, characterId, { dryRun: false });
  return `sleep完成：升級${summary.upgraded}條，合併${summary.merged}條，archive${summary.archived}條${summary.selfReflection ? '，自我洞察已寫入' : ''}`;
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
