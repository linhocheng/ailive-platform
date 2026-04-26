import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const saMatch = env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/);
if (!saMatch) { console.error('找不到 FIREBASE_SERVICE_ACCOUNT_JSON'); process.exit(1); }
const sa = JSON.parse(saMatch[1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('platform_jobs').orderBy('createdAt', 'desc').limit(5).get();
  snap.forEach(d => {
    const x = d.data() as any;
    console.log('─'.repeat(70));
    console.log('id:', d.id);
    console.log('status:', x.status, ' createdAt:', x.createdAt?.toDate?.().toISOString?.());
    console.log('error:', x.error);
    console.log('brief:', JSON.stringify(x.input?.brief ?? x.brief ?? null, null, 2));
  });
  process.exit(0);
})();
