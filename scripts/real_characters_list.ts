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

  // 查對的 collection：platform_characters
  const snap = await db.collection('platform_characters').get();
  console.log(`=== platform_characters 總數: ${snap.size} ===\n`);

  type Row = {
    id: string;
    name: string;
    tier: string;
    archived: boolean;
    deleted: boolean;
    hasSoul: boolean;
    hasSystemSoul: boolean;
    hasEnhanced: boolean;
    voiceId: string;
    createdAt: string;
  };
  const rows: Row[] = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    rows.push({
      id: doc.id,
      name: String(d.name || d.displayName || '(無名)'),
      tier: String(d.tier || '-'),
      archived: !!d.archived,
      deleted: !!d.deleted,
      hasSoul: typeof d.soul_core === 'string' && d.soul_core.length > 0,
      hasSystemSoul: typeof d.system_soul === 'string' && d.system_soul.length > 0,
      hasEnhanced: typeof d.enhancedSoul === 'string' && d.enhancedSoul.length > 0,
      voiceId: String(d.voiceId || '-'),
      createdAt: d.createdAt?.toDate?.()?.toISOString?.().slice(0, 10) || (typeof d.createdAt === 'string' ? d.createdAt.slice(0, 10) : '-'),
    });
  }

  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  console.log('名字'.padEnd(14), 'tier'.padEnd(12), 'soul sys enh', 'status'.padEnd(10), 'voice'.padEnd(12), 'created', '   ID');
  console.log('─'.repeat(110));
  for (const r of rows) {
    const soul = r.hasSoul ? '✓' : '✗';
    const sys = r.hasSystemSoul ? '✓' : '✗';
    const enh = r.hasEnhanced ? '✓' : '✗';
    const status = r.deleted ? 'DELETED' : (r.archived ? 'archived' : 'active');
    console.log(
      `${r.name.padEnd(14)} ${r.tier.padEnd(12)} ${soul}    ${sys}   ${enh}     ${status.padEnd(10)} ${r.voiceId.slice(0, 10).padEnd(12)} ${r.createdAt}  ${r.id}`
    );
  }

  // 分類給 Adam 看
  console.log('\n=== 分類 ===');
  const active = rows.filter(r => !r.archived && !r.deleted);
  const archived = rows.filter(r => r.archived);
  const deleted = rows.filter(r => r.deleted);
  const noSoul = rows.filter(r => !r.hasSoul && !r.hasSystemSoul && !r.hasEnhanced);

  console.log(`active: ${active.length}`);
  active.forEach(r => console.log(`  ${r.name.padEnd(14)} [${r.id}]`));
  if (archived.length) {
    console.log(`\narchived: ${archived.length}`);
    archived.forEach(r => console.log(`  ${r.name.padEnd(14)} [${r.id}]`));
  }
  if (deleted.length) {
    console.log(`\ndeleted flag: ${deleted.length}`);
    deleted.forEach(r => console.log(`  ${r.name.padEnd(14)} [${r.id}]`));
  }
  console.log(`\n⚠ 三個 soul 欄全空（主檔存在但沒靈魂）: ${noSoul.length}`);
  noSoul.forEach(r => console.log(`  ${r.name.padEnd(14)} [${r.id}]  archived=${r.archived}`));

  // 特別檢查我前兩輪查的那兩個
  console.log('\n=== 昨日提到的那兩個 ID 到底存不存在？ ===');
  for (const [label, id] of Object.entries({ 奧: 'pEWC5m2MOddyGe9uw0u0', 吉娜: 'I9n2lotXIrME23TJNPsI' })) {
    const doc = await db.collection('platform_characters').doc(id).get();
    if (doc.exists) {
      const d = doc.data() || {};
      console.log(`  ${label} [${id}] ✓ 存在`);
      console.log(`    name=${d.name || '(空)'}  archived=${!!d.archived}  deleted=${!!d.deleted}`);
      console.log(`    soul_core=${typeof d.soul_core === 'string' ? d.soul_core.length + ' chars' : '(空)'}`);
      console.log(`    system_soul=${typeof d.system_soul === 'string' ? d.system_soul.length + ' chars' : '(空)'}`);
    } else {
      console.log(`  ${label} [${id}] ✗ 不存在於 platform_characters`);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
