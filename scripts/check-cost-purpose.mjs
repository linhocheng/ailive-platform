import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const since = new Date(Date.now() - 24*3600*1000);
const snap = await db.collection('zhu_vitals_cost').where('timestamp', '>=', since).get();
const byProj = {};
let latestTs = null;
for (const d of snap.docs) {
  const x = d.data();
  const key = `${x.project}|${x.purpose}`;
  byProj[key] = (byProj[key]||0) + 1;
  if (!latestTs || x.timestamp.toDate() > latestTs) latestTs = x.timestamp.toDate();
}
console.log(`24h 內 ${snap.size} 筆 cost record\n最新: ${latestTs?.toISOString()}\n`);
console.log('project | purpose | count');
console.log('---');
for (const [k,v] of Object.entries(byProj).sort()) console.log(`${k}  ${v}`);
process.exit(0);
