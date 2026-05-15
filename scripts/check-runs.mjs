import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const since = new Date(Date.now() - 1800*1000);
const snap = await db.collection('zhu_vitals_runs')
  .where('started_at', '>=', since)
  .where('worker_id', '==', 'molowe-cron')
  .orderBy('started_at', 'desc')
  .limit(10).get();
for (const d of snap.docs) {
  const x = d.data();
  console.log(`${x.started_at.toDate().toISOString()} status=${x.status} elapsed=${x.elapsed_ms}ms`);
}
process.exit(0);
