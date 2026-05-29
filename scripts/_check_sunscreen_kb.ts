import { readFileSync } from 'fs';
import { resolve } from 'path';
import admin from 'firebase-admin';

const envContent = readFileSync(resolve(process.cwd(), '.env.local.fresh'), 'utf-8');
const envMap: Record<string,string> = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) { let v = m[2]; if (v.startsWith('"')&&v.endsWith('"')) v=v.slice(1,-1); envMap[m[1]]=v; }
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(envMap.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
const db = admin.firestore();
const CHAR_ID = 'kTwsX44G0ImsApEACDuE';

async function main() {
  const snap = await db.collection('platform_knowledge')
    .where('characterId', '==', CHAR_ID)
    .where('category', '==', 'image')
    .get();
  console.log(`platform_knowledge image 條目: ${snap.size} 筆\n`);
  for (const d of snap.docs) {
    const data = d.data();
    const allUrls = [data.imageUrl, data.url, data.content].filter(Boolean).map(String);
    console.log(`title: ${data.title}`);
    console.log(`  productId: ${data.productId || '(無)'}`);
    console.log(`  url/imageUrl: ${allUrls.join(' | ') || '(無)'}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
