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

  const CHAR_ID = 'I9n2lotXIrME23TJNPsI';

  // 她的 character 主檔
  const charDoc = await db.collection('characters').doc(CHAR_ID).get();
  const char = charDoc.data() || {};
  console.log('=== 她的基本資料 ===');
  console.log(`characterId: ${CHAR_ID}`);
  console.log(`name: ${char.name || '(空)'}`);
  console.log(`displayName: ${char.displayName || '(空)'}`);
  console.log(`tier: ${char.tier || '(空)'}`);
  console.log(`voiceId: ${char.voiceId || '(空)'}`);
  console.log(`soul_core 長度: ${(char.soul_core as string)?.length || 0} chars`);
  console.log(`system_soul 長度: ${(char.system_soul as string)?.length || 0} chars`);
  console.log(`enhancedSoul 長度: ${(char.enhancedSoul as string)?.length || 0} chars`);
  console.log();

  // 她的 platform_knowledge 按 category 分
  console.log('=== 她擁有的 knowledge 按 category 分佈 ===');
  const kbSnap = await db.collection('platform_knowledge')
    .where('characterId', '==', CHAR_ID)
    .get();
  const byCat: Record<string, number> = {};
  for (const doc of kbSnap.docs) {
    const cat = (doc.data().category as string) || '(no-cat)';
    byCat[cat] = (byCat[cat] || 0) + 1;
  }
  console.log(`總條目: ${kbSnap.size}`);
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  for (const [cat, n] of sorted) {
    const pct = (n / kbSnap.size * 100).toFixed(1);
    console.log(`  ${cat.padEnd(20)} ${n} 條 (${pct}%)`);
  }
  console.log();

  // 她的 soul 裡有沒有提到 Lumina？
  console.log('=== 她的 soul 欄位有沒有提到 Lumina ===');
  for (const field of ['soul_core', 'system_soul', 'enhancedSoul']) {
    const v = char[field];
    if (typeof v === 'string') {
      const hit = /lumina/i.test(v);
      console.log(`  ${field}: ${hit ? '⚠ 有提到 Lumina' : '✓ 乾淨（未提 Lumina）'}`);
    } else {
      console.log(`  ${field}: (不是字串或空)`);
    }
  }
  console.log();

  // 她的對話歷史最近幾輪關鍵詞
  console.log('=== 她最近 5 個 conversations 最新訊息 ===');
  const convSnap = await db.collection('platform_conversations')
    .where('characterId', '==', CHAR_ID)
    .limit(5)
    .get();
  for (const doc of convSnap.docs) {
    const data = doc.data();
    const msgs = (data.messages as Array<{role:string; content:string}>) || [];
    const last = msgs[msgs.length - 1];
    if (last && typeof last.content === 'string') {
      console.log(`  [${doc.id.slice(-6)}] (${last.role}) "${last.content.slice(0, 100)}"`);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
