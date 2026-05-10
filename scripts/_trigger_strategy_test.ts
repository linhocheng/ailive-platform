/**
 * 觸發奧寫一份策略書（手動測試用）
 * 模擬 dialogue/voice-stream 的 internal dispatch：
 *   create platform_jobs (status=processing) → fire /api/specialist/strategy → poll mdContent
 *
 * 用途：驗 Step 0（mdContent 落 Firestore）端到端
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
const workerSecret = env.match(/WORKER_SECRET=(.+)/)![1].replace(/^"|"$/g, '').trim();

admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const ASSIGNEE_ID = 'pEWC5m2MOddyGe9uw0u0';   // 奧
const BRIEF = process.argv[2] || 'AI 雲端客房策略';
const BASE_URL = 'https://ailive-platform.vercel.app';

(async () => {
  console.log(`[trigger] brief="${BRIEF}" assignee=${ASSIGNEE_ID}`);

  // 1. create platform_jobs doc
  const now = new Date().toISOString();
  const jobRef = await db.collection('platform_jobs').add({
    requesterId: '',
    requesterConvId: '',
    requesterUserId: '',
    assigneeId: ASSIGNEE_ID,
    jobType: 'strategy',
    brief: { prompt: BRIEF },
    status: 'processing',
    createdAt: now,
    retryCount: 0,
    source: 'manual-trigger',
  });
  console.log(`[trigger] jobId=${jobRef.id}`);

  // 2. fire-and-forget dispatch
  console.log('[trigger] dispatching to /api/specialist/strategy ...');
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/specialist/strategy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': workerSecret,
    },
    body: JSON.stringify({
      jobId: jobRef.id,
      assigneeId: ASSIGNEE_ID,
      brief: { prompt: BRIEF },
    }),
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[trigger] dispatch returned ${res.status} in ${elapsed}s`);
  const body = await res.text();
  console.log(`[trigger] body (first 500): ${body.slice(0, 500)}`);

  // 3. read back
  const finalDoc = await db.collection('platform_jobs').doc(jobRef.id).get();
  const finalData = finalDoc.data() as any;
  console.log('\n=== platform_jobs final state ===');
  console.log(`status: ${finalData.status}`);
  console.log(`mdChars: ${finalData.result?.mdChars || '(missing)'}`);
  console.log(`mdContent length: ${finalData.mdContent?.length || '(MISSING — Step 0 BROKEN)'}`);
  console.log(`docUrl: ${finalData.result?.docUrl || '(missing)'}`);
  console.log(`error: ${finalData.error || '(none)'}`);

  if (finalData.mdContent) {
    console.log('\n=== mdContent first 600 chars ===');
    console.log(finalData.mdContent.slice(0, 600));
    console.log('\n[trigger] ✓ Step 0 verified end-to-end');
  } else {
    console.log('\n[trigger] ✗ Step 0 FAILED — mdContent not in Firestore');
  }
  process.exit(0);
})().catch(e => { console.error('[trigger] ERROR:', e); process.exit(1); });
