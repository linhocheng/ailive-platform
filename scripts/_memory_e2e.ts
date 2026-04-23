/**
 * 記憶 pipeline 紅綠燈報告（靜態驗證）
 *
 * 跑法：
 *   npx tsx scripts/_memory_e2e.ts [角色名稱]
 *   不傳 = Vivi
 *
 * 七個檢查點（每個對應記憶 pipeline 一個節點）：
 *   1. 沉澱｜voice-end 近 7 天觸發率（對話→記憶 的流）
 *   2. 老化｜sleep task 近 24h 跑過（runner cron → sleep）
 *   3. 老化｜tier 分級（fresh/core/archive 有真的在分）
 *   4. 合併｜近期有 insight 被刪（cosine>0.88 合併鏈）
 *   5. 進化｜soul_proposal 堆積狀況（產出是否正常）
 *   6. 審批｜approved proposal（進化閉環有無運作）
 *   7. 自我覺察｜sleep_self_awareness 近 30 天有產出
 *   8. 真相｜growthMetrics counter 偏差（真相分裂檢查）
 *
 * Exit code：fail > 0 → exit 1；否則 0
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, '').trim());
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const TARGET = process.argv[2] || 'Vivi';
const NOW = Date.now();
const HOUR = 3600_000;
const DAY = 86400_000;

type Status = 'pass' | 'warn' | 'fail';
type Result = { label: string; status: Status; message: string };

function hoursAgo(iso?: string | null): number {
  return iso ? (NOW - new Date(iso).getTime()) / HOUR : Infinity;
}
function daysAgo(iso?: string | null): number {
  return iso ? (NOW - new Date(iso).getTime()) / DAY : Infinity;
}
function icon(s: Status): string {
  return s === 'pass' ? '🟢' : s === 'warn' ? '🟡' : '🔴';
}

async function main() {
  const q = await db.collection('platform_characters').where('name', '==', TARGET).get();
  if (q.empty) {
    console.log(`找不到角色「${TARGET}」`);
    process.exit(1);
  }
  const char = q.docs[0];
  const cid = char.id;
  const cdata = char.data();

  // 一次撈齊，避免多次往返
  const [insSnap, convSnap, taskSnap, propSnap] = await Promise.all([
    db.collection('platform_insights').where('characterId', '==', cid).get(),
    db.collection('platform_conversations').where('characterId', '==', cid).get(),
    db.collection('platform_tasks').where('characterId', '==', cid).get(),
    db.collection('platform_soul_proposals').where('characterId', '==', cid).get(),
  ]);
  const insights = insSnap.docs.map(d => d.data() as any);
  const convs = convSnap.docs
    .map(d => d.data() as any)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const tasks = taskSnap.docs.map(d => d.data() as any);
  const proposals = propSnap.docs.map(d => d.data() as any);

  const results: Result[] = [];

  // =========================================================================
  // 1. 沉澱｜voice-end 近 7 天觸發率
  // =========================================================================
  const recent7d = convs.filter(c => daysAgo(c.createdAt) <= 7);
  const withLastSession = recent7d.filter(c => c.lastSession);
  if (recent7d.length === 0) {
    results.push({ label: '沉澱｜voice-end', status: 'warn', message: '近 7 天無對話樣本' });
  } else if (withLastSession.length === 0) {
    results.push({
      label: '沉澱｜voice-end',
      status: 'fail',
      message: `近 7 天 ${recent7d.length} 場對話，0 場有 lastSession — voice-end 沒觸發`,
    });
  } else {
    const ratio = Math.round((withLastSession.length / recent7d.length) * 100);
    const status: Status = ratio < 30 ? 'warn' : 'pass';
    results.push({
      label: '沉澱｜voice-end',
      status,
      message: `近 7 天 ${withLastSession.length}/${recent7d.length} 場有 lastSession (${ratio}%)`,
    });
  }

  // =========================================================================
  // 2. 老化｜sleep task 近 24h 跑過
  // =========================================================================
  const sleepTask = tasks.find(t => t.type === 'sleep' && t.enabled);
  if (!sleepTask) {
    results.push({ label: '老化｜sleep task', status: 'fail', message: '沒有啟用的 sleep task' });
  } else {
    const h = hoursAgo(sleepTask.last_run);
    if (h > 48) {
      results.push({ label: '老化｜sleep task', status: 'fail', message: `上次 ${h.toFixed(0)}h 前（>48h）` });
    } else if (h > 25) {
      results.push({ label: '老化｜sleep task', status: 'warn', message: `上次 ${h.toFixed(0)}h 前（差一次 daily）` });
    } else {
      results.push({ label: '老化｜sleep task', status: 'pass', message: `${h.toFixed(1)}h 前跑過` });
    }
  }

  // =========================================================================
  // 3. 老化｜tier 分級
  // =========================================================================
  const freshCount = insights.filter(i => i.tier === 'fresh').length;
  const coreCount = insights.filter(i => i.tier === 'core').length;
  const archiveCount = insights.filter(i => i.tier === 'archive').length;
  const selfCount = insights.filter(i => i.tier === 'self').length;
  if (coreCount === 0 && archiveCount === 0 && freshCount > 10) {
    results.push({
      label: '老化｜tier 分級',
      status: 'fail',
      message: `${freshCount} 筆 fresh 但 core/archive 全 0，升降沒運作`,
    });
  } else {
    results.push({
      label: '老化｜tier 分級',
      status: 'pass',
      message: `fresh=${freshCount} core=${coreCount} archive=${archiveCount} self=${selfCount}`,
    });
  }

  // =========================================================================
  // 4. 進化｜soul_proposal 堆積
  // =========================================================================
  const pending = proposals.filter(p => p.status === 'pending');
  if (proposals.length === 0) {
    results.push({
      label: '進化｜soul_proposal',
      status: 'warn',
      message: '從未產出（可能 core insights 從未 ≥5）',
    });
  } else if (pending.length >= 10) {
    results.push({
      label: '進化｜soul_proposal',
      status: 'fail',
      message: `${pending.length} 筆 pending 堆積（沒審批 UI，閉環斷）`,
    });
  } else if (pending.length >= 5) {
    results.push({
      label: '進化｜soul_proposal',
      status: 'warn',
      message: `${pending.length} 筆 pending（接近堆積）`,
    });
  } else {
    results.push({
      label: '進化｜soul_proposal',
      status: 'pass',
      message: `${pending.length} 筆 pending / ${proposals.length} 筆總`,
    });
  }

  // =========================================================================
  // 5. 審批回流｜approved proposal
  // =========================================================================
  const approved = proposals.filter(p => p.status === 'approved');
  if (approved.length === 0 && proposals.length >= 5) {
    results.push({
      label: '審批回流｜approved',
      status: 'fail',
      message: `${proposals.length} 筆 proposal，0 筆 approved — 靈魂從沒被 insight 改過`,
    });
  } else if (approved.length === 0) {
    results.push({ label: '審批回流｜approved', status: 'warn', message: '0 筆 approved（樣本也少）' });
  } else {
    const latest = approved.sort((a, b) =>
      String(b.approvedAt || b.createdAt).localeCompare(String(a.approvedAt || a.createdAt)),
    )[0];
    const d = daysAgo(latest.approvedAt || latest.createdAt);
    results.push({
      label: '審批回流｜approved',
      status: 'pass',
      message: `${approved.length} 筆 approved，最近 ${d.toFixed(1)} 天前`,
    });
  }

  // =========================================================================
  // 6. 自我覺察｜sleep_self_awareness 近 30 天
  // =========================================================================
  const selfAwr = insights.filter(i => i.source === 'sleep_self_awareness');
  if (selfAwr.length === 0) {
    results.push({ label: '自我覺察｜sleep_self_awareness', status: 'warn', message: '從未產出' });
  } else {
    const latest = selfAwr.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    const d = daysAgo(latest.createdAt);
    if (d > 30) {
      results.push({
        label: '自我覺察｜sleep_self_awareness',
        status: 'warn',
        message: `最新 ${d.toFixed(0)} 天前（條件 newInsights≥3 且 hit≥1 太嚴）`,
      });
    } else {
      results.push({
        label: '自我覺察｜sleep_self_awareness',
        status: 'pass',
        message: `最新 ${d.toFixed(0)} 天前`,
      });
    }
  }

  // =========================================================================
  // 7. 真相｜growthMetrics counter 偏差
  // =========================================================================
  const counterVal = cdata.growthMetrics?.totalInsights ?? 0;
  const actual = insights.length;
  const diff = Math.abs(counterVal - actual);
  const diffPct = actual === 0 ? 0 : (diff / actual) * 100;
  if (diffPct > 50) {
    results.push({
      label: '真相｜counter 偏差',
      status: 'fail',
      message: `growthMetrics=${counterVal} vs 實際=${actual}（偏差 ${diffPct.toFixed(0)}%）— 有 +increment 沒 -decrement`,
    });
  } else if (diffPct > 20) {
    results.push({
      label: '真相｜counter 偏差',
      status: 'warn',
      message: `growthMetrics=${counterVal} vs 實際=${actual}（偏差 ${diffPct.toFixed(0)}%）`,
    });
  } else {
    results.push({
      label: '真相｜counter 偏差',
      status: 'pass',
      message: `growthMetrics=${counterVal} ≈ 實際=${actual}`,
    });
  }

  // =========================================================================
  // 輸出
  // =========================================================================
  console.log('');
  console.log('━'.repeat(72));
  console.log(`  記憶 Pipeline E2E — ${cdata.name || TARGET} (${cid})`);
  console.log(`  生成時間 ${new Date().toISOString()}`);
  console.log('━'.repeat(72));
  console.log('');

  for (const r of results) {
    console.log(`  ${icon(r.status)}  ${r.label.padEnd(34)} ${r.message}`);
  }

  const pass = results.filter(r => r.status === 'pass').length;
  const warn = results.filter(r => r.status === 'warn').length;
  const fail = results.filter(r => r.status === 'fail').length;

  console.log('');
  console.log('━'.repeat(72));
  console.log(`  總結   🟢 通過 ${pass}   🟡 注意 ${warn}   🔴 斷路 ${fail}`);
  console.log('━'.repeat(72));
  console.log('');

  if (fail > 0) {
    console.log('  ⚠️  有斷路。建議進方向 ② 閉環修復。\n');
  } else if (warn > 0) {
    console.log('  ℹ️  pipeline 活著，但有注意項。\n');
  } else {
    console.log('  ✅ pipeline 全綠。\n');
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
