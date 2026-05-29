import { readFileSync } from 'fs';
import { resolve } from 'path';
import admin from 'firebase-admin';

const envPath = resolve(process.cwd(), '.env.local.fresh');
const envContent = readFileSync(envPath, 'utf-8');
const envMap: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) {
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    envMap[m[1]] = val;
  }
}

async function main() {
  const sa = JSON.parse(envMap.FIREBASE_SERVICE_ACCOUNT_JSON!);
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  const db = admin.firestore();

  const CHAR_ID = 'kTwsX44G0ImsApEACDuE'; // Vivi

  const snap = await db.collection('platform_products')
    .where('characterId', '==', CHAR_ID)
    .get();

  console.log(`\nVivi 知識庫產品數：${snap.size}\n`);
  console.log('='.repeat(60));

  let totalImages = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const name = data.name || data.productName || doc.id;
    const images: Record<string, string> = data.images || {};
    const keys = Object.keys(images);

    console.log(`\n【${name}】(${doc.id})`);
    console.log(`  圖片數：${keys.length}`);
    if (keys.length === 0) {
      console.log('  (無圖片)');
    } else {
      for (const key of keys) {
        const url = images[key];
        console.log(`  - ${key}: ${url ? url.slice(-60) : '(空 URL)'}`);
        totalImages++;
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`總計：${snap.size} 個產品，${totalImages} 張圖片\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
