/**
 * 委託 5 階段推論（純函式，前端用）
 *
 * 資料來源：platform_jobs doc 的 status/startedAt/completedAt/output + conversation messages
 *
 * 5 階段：
 *   1. 委託成立  — job doc 建立（createdAt 存在即達成）
 *   2. 工接了    — jobWorker atomic claim（status 脫離 pending）
 *   3. 手在動    — specialist 在處理中（status=in_progress，推論靠時間 proxy）
 *   4. 作品落袋  — output.imageUrl / docUrl 寫回（status=done）
 *   5. 對話收到  — messages 裡有對應 jobId 的 system_event
 *
 * 失敗規則：stage 停在「最後一個達成的 +1」並染紅
 *
 * @author 築 · Phase 2 · 推論式 5 階段（A 方案）
 */

export interface ActiveJob {
  id: string;
  assigneeId: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  brief?: { prompt?: string; mood?: string | null; refs?: string[]; aspectRatio?: string };
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  output?: { imageUrl?: string; docUrl?: string; workLog?: string };
  error?: string;
  retryCount?: number;
  jobType?: string;
}

export type LampState = 'empty' | 'active' | 'done' | 'failed';

export interface StageDerivation {
  lamps: [LampState, LampState, LampState, LampState, LampState];
  overall: 'idle' | 'pending' | 'running' | 'done' | 'failed';
  reachedStage: number;
}

// in_progress 超過 3s 才算「手真的在動」（Sonnet 翻 prompt 通常 1-2s 起跳）
const STAGE3_PROXY_MS = 3_000;

// strategy 走 internal dispatch 用 'processing'；painter 經 worker 用 'in_progress'。視為同義。
const isRunningLike = (s?: string): boolean => s === 'in_progress' || s === 'processing';

export function deriveStages(
  job: ActiveJob,
  seenBySystemEvent: boolean,
): StageDerivation {
  const lamps: LampState[] = ['empty', 'empty', 'empty', 'empty', 'empty'];
  let reached = 0;

  // stage 1: job 存在
  if (job.createdAt) { lamps[0] = 'done'; reached = 1; }

  // stage 2: status 脫離 pending
  if (job.startedAt || (job.status && job.status !== 'pending')) {
    lamps[1] = 'done';
    reached = 2;
  }

  // stage 3: startedAt 夠久或已結束（done/failed）
  if (job.startedAt) {
    const elapsed = Date.now() - Date.parse(job.startedAt);
    if (job.status === 'done' || job.status === 'failed') {
      lamps[2] = 'done'; reached = 3;
    } else if (elapsed >= STAGE3_PROXY_MS) {
      lamps[2] = 'done'; reached = 3;
    } else {
      lamps[2] = 'active';
    }
  }

  // stage 4: output 寫回 or status=done
  const hasOutput = !!(job.output?.imageUrl || job.output?.docUrl);
  if (hasOutput || job.status === 'done') { lamps[3] = 'done'; reached = 4; }

  // stage 5: conversation 真的收到
  if (seenBySystemEvent) { lamps[4] = 'done'; reached = 5; }

  // 失敗處理
  if (job.status === 'failed') {
    const failIdx = Math.min(reached, 4);
    lamps[failIdx] = 'failed';
    for (let i = failIdx + 1; i < 5; i++) lamps[i] = 'empty';
    return {
      lamps: lamps as StageDerivation['lamps'],
      overall: 'failed',
      reachedStage: reached,
    };
  }

  // 正在走的下一顆變 active
  if (job.status === 'pending' || isRunningLike(job.status)) {
    const nextIdx = reached;
    if (nextIdx < 5 && lamps[nextIdx] === 'empty') {
      lamps[nextIdx] = 'active';
    }
  }

  const overall: StageDerivation['overall'] =
    job.status === 'done' ? 'done'
    : isRunningLike(job.status) ? 'running'
    : job.status === 'pending' ? 'pending'
    : 'idle';

  return {
    lamps: lamps as StageDerivation['lamps'],
    overall,
    reachedStage: reached,
  };
}

export function jobLabel(job: ActiveJob, maxLen = 10): string {
  const raw = (job.brief?.prompt || '').trim();
  if (!raw) return '未命名委託';
  const chars = Array.from(raw);
  if (chars.length <= maxLen) return raw;
  return chars.slice(0, maxLen).join('') + '…';
}

export function jobElapsed(job: ActiveJob): string {
  const start = job.createdAt ? Date.parse(job.createdAt) : Date.now();
  const end = job.completedAt ? Date.parse(job.completedAt) : Date.now();
  const diffMs = Math.max(0, end - start);
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function isJobSeenInMessages(
  jobId: string,
  messages: Array<{ role?: string; eventType?: string; jobId?: string }>,
): boolean {
  return messages.some(
    m => m.role === 'system_event' && m.jobId === jobId,
  );
}

export function deriveMiniLight(
  jobs: ActiveJob[],
  messages: Array<{ role?: string; eventType?: string; jobId?: string }>,
): 'idle' | 'pending' | 'running' | 'done' | 'failed' {
  if (!jobs.length) return 'idle';
  const anyFailed = jobs.some(j => j.status === 'failed');
  if (anyFailed) return 'failed';
  const anyRunning = jobs.some(j => isRunningLike(j.status));
  if (anyRunning) return 'running';
  const anyPending = jobs.some(j => j.status === 'pending');
  if (anyPending) return 'pending';
  const anyDoneRecent = jobs.some(j => {
    if (j.status !== 'done') return false;
    const t = j.completedAt ? Date.parse(j.completedAt) : 0;
    return Date.now() - t < 60_000;
  });
  if (anyDoneRecent) return 'done';
  // 留意：messages 目前未使用，保留參數為未來彈性（例：只有 polling 到 event 才算真 done）
  void messages;
  return 'idle';
}
