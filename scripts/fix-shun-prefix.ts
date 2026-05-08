/**
 * 改瞬 (shun-001) 的 visualIdentity.imagePromptPrefix
 * 拿掉 "dark background, chiaroscuro lighting"，光線/背景應由 brief 決定
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
// 手動讀 .env.local.fresh，不依賴 dotenv
const envText = readFileSync(resolve(__dirname, '../.env.local.fresh'), 'utf-8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) {
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

import { getFirestore } from '../src/lib/firebase-admin';

async function main() {
  const db = getFirestore();
  const docRef = db.collection('platform_characters').doc('shun-001');
  const before = (await docRef.get()).data()?.visualIdentity;
  console.log('before:', JSON.stringify(before, null, 2));

  const NEW_PREFIX = 'realistic photography, shallow depth of field';
  await docRef.update({ 'visualIdentity.imagePromptPrefix': NEW_PREFIX });

  const after = (await docRef.get()).data()?.visualIdentity;
  console.log('after:', JSON.stringify(after, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
