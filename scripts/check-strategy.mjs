import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || `${process.env.HOME}/.ailive/keys/firebase-sa.json`;
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const charId = 'lf6X7h9ufqOaB8akUX2Z';
const snap = await db.collection('platform_jobs')
  .where('requesterId', '==', charId)
  .limit(200).get();

const items = [];
for (const doc of snap.docs) {
  const d = doc.data();
  if (d.jobType !== 'strategy') continue;
  items.push({ id: doc.id, ...d });
}
items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

console.log(`找到 ${items.length} 個 strategy job\n`);
for (const j of items.slice(0, 5)) {
  console.log('---');
  console.log('id:', j.id);
  console.log('status:', j.status);
  console.log('createdAt:', j.createdAt);
  console.log('completedAt:', j.completedAt);
  console.log('assigneeId:', j.assigneeId);
  console.log('brief.prompt:', String(j.brief?.prompt || '').slice(0, 80));
  console.log('docUrl:', j.result?.docUrl ? 'YES' : 'NO');
  console.log('htmlUrl:', j.htmlUrl ? 'YES' : 'NO');
  console.log('htmlGeneratedAt:', j.htmlGeneratedAt);
  console.log('htmlStartedAt:', j.htmlStartedAt);
  console.log('htmlError:', j.htmlError);
  console.log('htmlStatus:', j.htmlStatus);
  console.log('error:', j.error);
}
process.exit(0);
