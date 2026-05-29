/**
 * 把 platform_knowledge（category=image）的圖片補回 platform_products.images
 * 用 captionToKey 邏輯對應語意 key
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import admin from 'firebase-admin';

const envContent = readFileSync(resolve(process.cwd(), '.env.local.fresh'), 'utf-8');
const envMap: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) { let v = m[2]; if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1); envMap[m[1]] = v; }
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(envMap.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
const db = admin.firestore();

const CHAR_ID = 'kTwsX44G0ImsApEACDuE';
const DRY_RUN = process.argv.includes('--dry-run');

function captionToKey(caption: string): string {
  if (caption.includes('全身')) return '模特兒全身';
  if (caption.includes('半身')) return '模特兒半身';
  if (caption.includes('大頭')) return '模特兒大頭';
  if (caption.includes('斜躺')) return '純產品斜躺';
  if (caption.includes('正面')) return '純產品正面';
  return caption.slice(-10);
}

// 從 title 找對應產品：優先 startsWith 最長前綴比對，避免模糊比對誤判
function findMatchingProduct(
  title: string,
  prodMap: Map<string, { ref: admin.firestore.DocumentReference; images: Record<string, string> }>
): { ref: admin.firestore.DocumentReference; images: Record<string, string> } | null {
  // 1. 先試「—」分割取前段 exact match
  const dashIdx = title.search(/[—\-–]/);
  if (dashIdx > 0) {
    const namePart = title.slice(0, dashIdx).trim();
    if (prodMap.has(namePart)) return prodMap.get(namePart)!;
  }
  // 2. startsWith 最長前綴（「產品名130g 圖類型」格式）
  let best: { ref: admin.firestore.DocumentReference; images: Record<string, string> } | null = null;
  let bestLen = 0;
  for (const [pName, pEntry] of prodMap.entries()) {
    if (title.startsWith(pName) && pName.length > bestLen) {
      best = pEntry; bestLen = pName.length;
    }
  }
  if (best) return best;
  // 3. 「與」分割取前段 startsWith
  const withIdx = title.indexOf('與');
  if (withIdx > 0) {
    const namePart = title.slice(0, withIdx).trim();
    for (const [pName, pEntry] of prodMap.entries()) {
      if (namePart.startsWith(pName) && pName.length >= 4) return pEntry;
    }
  }
  return null;
}

async function main() {
  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}backfill platform_products.images from platform_knowledge\n`);

  // 讀全部 image 條目
  const kbSnap = await db.collection('platform_knowledge')
    .where('characterId', '==', CHAR_ID)
    .where('category', '==', 'image')
    .get();

  // 讀全部產品
  const prodSnap = await db.collection('platform_products')
    .where('characterId', '==', CHAR_ID)
    .get();

  // 產品名 → doc ref + images map
  const prodMap = new Map<string, { ref: admin.firestore.DocumentReference; images: Record<string, string> }>();
  for (const d of prodSnap.docs) {
    const name = String(d.data().productName || '').trim();
    if (name) prodMap.set(name, { ref: d.ref, images: { ...d.data().images } });
  }

  let updated = 0, skipped = 0, noMatch = 0;

  for (const kd of kbSnap.docs) {
    const data = kd.data();
    const title = String(data.title || '');
    const imageUrl = String(data.imageUrl || data.url || '');
    if (!imageUrl) { skipped++; continue; }

    const key = captionToKey(title);
    const entry = findMatchingProduct(title, prodMap);

    if (!entry) {
      console.log(`  [無法比對] "${title}" → 找不到對應產品`);
      noMatch++;
      continue;
    }

    if (entry.images[key] === imageUrl) {
      skipped++;
      continue; // 已存在且一致
    }

    console.log(`  [補入] 產品: ${[...prodMap.entries()].find(([,v]) => v === entry)?.[0]} | key: ${key} | url: ...${imageUrl.slice(-40)}`);
    entry.images[key] = imageUrl;
    updated++;
  }

  if (updated === 0) {
    console.log('\n所有圖片已同步，無需更新。');
    return;
  }

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] 共 ${updated} 筆需要補入，加 --write 參數執行實際寫入`);
    return;
  }

  // 實際寫入
  const batch = db.batch();
  for (const [, entry] of prodMap.entries()) {
    batch.update(entry.ref, { images: entry.images, updatedAt: new Date().toISOString() });
  }
  await batch.commit();
  console.log(`\n✅ 補入完成：${updated} 筆新增，${skipped} 筆已存在跳過，${noMatch} 筆無法比對`);
}

main().catch(e => { console.error(e); process.exit(1); });
