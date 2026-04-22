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

  const targets = {
    '奧': 'pEWC5m2MOddyGe9uw0u0',
    '吉娜': 'I9n2lotXIrME23TJNPsI',
  };

  // 列出所有 top-level collections，看哪些有 characterId 欄位
  const allCollections = await db.listCollections();
  console.log('=== 所有 top-level collections ===');
  for (const c of allCollections) console.log(`  ${c.id}`);

  console.log('\n=== 掃遍這些 collection，找 characterId 是奧或吉娜的殘留 ===');
  for (const [name, charId] of Object.entries(targets)) {
    console.log(`\n--- ${name} [${charId}] ---`);
    let total = 0;
    for (const c of allCollections) {
      try {
        const snap = await c.where('characterId', '==', charId).limit(1000).get();
        if (snap.size > 0) {
          console.log(`  ${c.id}: ${snap.size} 筆`);
          total += snap.size;
        }
      } catch { /* 有些 collection 可能不支援 where */ }
    }
    console.log(`  → 殘留總計: ${total} 筆（散落在以上 collection）`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
