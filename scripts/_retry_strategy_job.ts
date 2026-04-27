/**
 * 重派一條 failed strategy job（手動修復用）
 *  把 jobs status 改回 processing + 清 error，再 fire fetch /api/specialist/strategy
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
const workerSecretMatch = env.match(/WORKER_SECRET=(.+)/);
const workerSecret = workerSecretMatch ? workerSecretMatch[1].replace(/^"|"$/g, '').trim() : '';
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const JOB_ID = process.argv[2];
if (!JOB_ID) { console.error('usage: tsx _retry_strategy_job.ts <jobId>'); process.exit(1); }

(async () => {
  const ref = db.collection('platform_jobs').doc(JOB_ID);
  const doc = await ref.get();
  if (!doc.exists) { console.error('job not found:', JOB_ID); process.exit(1); }
  const data = doc.data() as any;
  if (data.jobType !== 'strategy') { console.error('not a strategy job:', data.jobType); process.exit(1); }

  console.log('reset status processing + clear error...');
  await ref.update({ status: 'processing', error: admin.firestore.FieldValue.delete(), startedAt: new Date().toISOString() });

  console.log('dispatching to /api/specialist/strategy ...');
  const res = await fetch('https://ailive-platform.vercel.app/api/specialist/strategy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-worker-secret': workerSecret },
    body: JSON.stringify({
      jobId: JOB_ID,
      assigneeId: data.assigneeId,
      brief: data.brief,
    }),
  });
  console.log('status:', res.status);
  const body = await res.text();
  console.log('body (first 600):', body.slice(0, 600));
  process.exit(0);
})();
