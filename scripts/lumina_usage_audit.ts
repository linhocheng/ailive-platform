/**
 * 盤 Lumina 知識庫目前被哪些角色吃著
 * - platform_knowledge 裡 category=lumina 的條目分佈（by characterId）
 * - 每個 characterId 對應角色名 + tier
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import admin from 'firebase-admin';

const envContent = readFileSync(resolve(process.cwd(), '.env.local.fresh'), 'utf-8');
const envMap: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) {
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    envMap[m[1]] = val;
  }
}

async function main() {
  const sa = JSON.parse(envMap.FIREBASE_SERVICE_ACCOUNT_JSON!);
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  const db = admin.firestore();

  // 1. 掃 platform_knowledge 有 lumina 的條目
  console.log('=== 1. platform_knowledge 按 category 統計 ===');
  const kbSnap = await db.collection('platform_knowledge').get();
  const byCharCategory: Record<string, Record<string, number>> = {};
  let luminaTotal = 0;
  let hasLuminaInCat = false;
  let hasLuminaInTags = false;

  for (const doc of kbSnap.docs) {
    const data = doc.data();
    const charId = (data.characterId as string) || '(no-char)';
    const cat = (data.category as string) || '(no-cat)';
    const tags = (data.tags as string[]) || [];

    byCharCategory[charId] = byCharCategory[charId] || {};
    byCharCategory[charId][cat] = (byCharCategory[charId][cat] || 0) + 1;

    const isLumina =
      cat.toLowerCase().includes('lumina') ||
      tags.some(t => String(t).toLowerCase().includes('lumina'));
    if (isLumina) {
      luminaTotal++;
      if (cat.toLowerCase().includes('lumina')) hasLuminaInCat = true;
      if (tags.some(t => String(t).toLowerCase().includes('lumina'))) hasLuminaInTags = true;
    }
  }

  console.log(`platform_knowledge 總條目: ${kbSnap.size}`);
  console.log(`Lumina 相關（category 或 tags 含 lumina）: ${luminaTotal}`);
  console.log(`  來自 category: ${hasLuminaInCat ? '✓' : '✗'}`);
  console.log(`  來自 tags: ${hasLuminaInTags ? '✓' : '✗'}`);
  console.log();

  // 2. 按 characterId 列出有 lumina 的量
  console.log('=== 2. 各角色擁有的 Lumina 條目 ===');
  const luminaByChar: Record<string, number> = {};
  for (const doc of kbSnap.docs) {
    const data = doc.data();
    const charId = (data.characterId as string) || '(no-char)';
    const cat = (data.category as string) || '';
    const tags = (data.tags as string[]) || [];
    const isLumina =
      cat.toLowerCase().includes('lumina') ||
      tags.some(t => String(t).toLowerCase().includes('lumina'));
    if (isLumina) {
      luminaByChar[charId] = (luminaByChar[charId] || 0) + 1;
    }
  }

  // 對照角色名
  for (const [charId, count] of Object.entries(luminaByChar)) {
    try {
      const charDoc = await db.collection('characters').doc(charId).get();
      const charData = charDoc.data() || {};
      const name = charData.name || charData.displayName || '(未命名)';
      const tier = charData.tier || '(無 tier)';
      console.log(`  [${charId}]  ${name}  (tier=${tier})  →  ${count} 條 Lumina knowledge`);
    } catch {
      console.log(`  [${charId}]  (查不到角色)  →  ${count} 條 Lumina knowledge`);
    }
  }
  console.log();

  // 3. 檢查 skills / system_soul / soul_core 有沒有被 Lumina 污染（其他角色）
  console.log('=== 3. 其他角色的 soul / skills / system_soul 有沒有提到 Lumina？ ===');
  const charsSnap = await db.collection('characters').get();
  for (const doc of charsSnap.docs) {
    const data = doc.data();
    const name = data.name || data.displayName || '(未命名)';
    const tier = data.tier || '-';
    const checkFields: Record<string, unknown> = {
      soul_core: data.soul_core,
      system_soul: data.system_soul,
      enhancedSoul: data.enhancedSoul,
    };
    const hits: string[] = [];
    for (const [field, val] of Object.entries(checkFields)) {
      if (typeof val === 'string' && /lumina/i.test(val)) hits.push(field);
    }
    // skills
    try {
      const skillsSnap = await db.collection('characters').doc(doc.id).collection('skills').get();
      for (const s of skillsSnap.docs) {
        const sd = s.data();
        const allText = JSON.stringify(sd);
        if (/lumina/i.test(allText)) hits.push(`skill:${s.id}`);
      }
    } catch {}

    if (hits.length > 0) {
      console.log(`  ⚠ [${doc.id}]  ${name}  (tier=${tier})  →  ${hits.join(', ')}`);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
