/**
 * 補跑現有 realtime 對話的記憶提煉
 * 找所有 voice-* convId 且尚無 lastSession 的對話，逐一打 voice-end API
 *
 * 用法：
 *   npx ts-node --project tsconfig.scripts.json scripts/_backfill_realtime_insights.ts
 *   npx ts-node --project tsconfig.scripts.json scripts/_backfill_realtime_insights.ts --dry-run
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const isDryRun = process.argv.includes('--dry-run');
const API_URL = 'https://ailive-platform.vercel.app/api/voice-end';

// Firebase init
const env = readFileSync('.env.local.fresh', 'utf-8');
const saMatch = env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/);
if (!saMatch) throw new Error('找不到 FIREBASE_SERVICE_ACCOUNT_JSON');
const sa = JSON.parse(saMatch[1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

interface ConvSummary {
  convId: string;
  characterId: string;
  userId: string;
  messageCount: number;
  hasLastSession: boolean;
}

async function scanConvs(): Promise<ConvSummary[]> {
  const snap = await db.collection('platform_conversations').get();
  const results: ConvSummary[] = [];
  for (const doc of snap.docs) {
    if (!doc.id.startsWith('voice-')) continue;
    const data = doc.data();
    results.push({
      convId: doc.id,
      characterId: String(data.characterId || ''),
      userId: String(data.userId || ''),
      messageCount: (data.messages || []).length,
      hasLastSession: !!data.lastSession,
    });
  }
  return results;
}

async function triggerVoiceEnd(convId: string, characterId: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId, conversationId: convId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, msg: `HTTP ${res.status}: ${JSON.stringify(body)}` };
    const saved = (body as { saved?: number }).saved ?? '?';
    return { ok: true, msg: `insights 寫入 ${saved} 條` };
  } catch (e) {
    return { ok: false, msg: String(e) };
  }
}

(async () => {
  console.log(`\n🔍 掃描 platform_conversations …\n`);
  const all = await scanConvs();
  const pending = all.filter(c => !c.hasLastSession && c.messageCount >= 2);
  const skipped = all.filter(c => c.hasLastSession);
  const tooShort = all.filter(c => !c.hasLastSession && c.messageCount < 2);

  console.log(`  全部 voice-* conv：${all.length}`);
  console.log(`  已有 lastSession（跳過）：${skipped.length}`);
  console.log(`  訊息 < 2（太短跳過）：${tooShort.length}`);
  console.log(`  待補跑：${pending.length}\n`);

  if (pending.length === 0) {
    console.log('✅ 沒有需要補跑的對話。');
    process.exit(0);
  }

  if (isDryRun) {
    console.log('── DRY RUN，只列清單不實際寫入 ──\n');
    for (const c of pending) {
      console.log(`  ${c.convId}  characterId=${c.characterId}  userId=${c.userId}  messages=${c.messageCount}`);
    }
    process.exit(0);
  }

  console.log(`▶️  開始補跑（呼叫 ${API_URL}）…\n`);
  let successCount = 0;
  for (const c of pending) {
    process.stdout.write(`  ${c.convId} … `);
    const result = await triggerVoiceEnd(c.convId, c.characterId);
    if (result.ok) {
      successCount++;
      console.log(`✅ ${result.msg}`);
    } else {
      console.log(`❌ ${result.msg}`);
    }
    // 避免打太快，每筆間隔 2 秒
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n完成：${successCount}/${pending.length} 成功`);
  process.exit(0);
})();
