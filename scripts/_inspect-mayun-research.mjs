// 撈剛剛馬雲撥號那次 5 個 research jobs 的詳細
import fs from 'fs';
import admin from 'firebase-admin';
const envFile = fs.readFileSync('./.env.production','utf-8');
const m = envFile.match(/^FIREBASE_SERVICE_ACCOUNT_JSON="([\s\S]*?)"\s*$/m);
const sa = JSON.parse(m[1]);
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const MAYUN = '3FAIl35ShNIhtle3Twkb';

// 最近 10 個馬雲的 research jobs
const snap = await db.collection('platform_research_jobs')
  .where('character_id', '==', MAYUN)
  .get();
const docs = snap.docs.sort((a, b) => (b.data().created_at || '').localeCompare(a.data().created_at || '')).slice(0, 10);

console.log(`找到 ${snap.size} 個 jobs (顯示最新 10)\n`);
for (const d of docs) {
  const x = d.data();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`id: ${d.id.slice(0, 8)}  status: ${x.status}  consumed: ${x.consumed}`);
  console.log(`created: ${x.created_at}  source: ${x.source}`);
  console.log(`session: ${x.session_id}`);
  console.log(`Q: ${x.question}`);
  console.log(`Ctx: ${x.context}`);
  if (x.result?.raw) console.log(`Result preview: ${x.result.raw.slice(0, 200)}...`);
  if (x.error) console.log(`Error: ${x.error}`);
  console.log('');
}
process.exit(0);
