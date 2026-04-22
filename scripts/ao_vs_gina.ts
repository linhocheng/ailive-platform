/**
 * 盤「奧」和「吉娜」兩個角色的全貌
 * 看哪邊有 Lumina、哪邊有 soul、兩邊有沒有串錯
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

  const IDS = {
    ao: 'pEWC5m2MOddyGe9uw0u0',
    gina: 'I9n2lotXIrME23TJNPsI',
  };

  for (const [label, charId] of Object.entries(IDS)) {
    console.log(`\n========== ${label.toUpperCase()} [${charId}] ==========`);

    // 1. character 主檔
    const doc = await db.collection('characters').doc(charId).get();
    if (!doc.exists) {
      console.log('  ⚠ 這個 characterId 不存在於 characters collection');
      continue;
    }
    const data = doc.data() || {};
    console.log('\n--- character 主檔 ---');
    console.log(`  name            : ${data.name || '(空)'}`);
    console.log(`  displayName     : ${data.displayName || '(空)'}`);
    console.log(`  tier            : ${data.tier || '(空)'}`);
    console.log(`  voiceId         : ${data.voiceId || '(空)'}`);
    console.log(`  status/archived : status=${data.status || '-'}, archived=${data.archived ?? '-'}, deleted=${data.deleted ?? '-'}`);
    console.log(`  createdAt       : ${data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt || '(空)'}`);
    console.log(`  updatedAt       : ${data.updatedAt?.toDate?.()?.toISOString?.() || data.updatedAt || '(空)'}`);
    console.log(`  soul_core       : ${typeof data.soul_core === 'string' ? `${data.soul_core.length} chars` : '(非字串/空)'}`);
    console.log(`  system_soul     : ${typeof data.system_soul === 'string' ? `${data.system_soul.length} chars` : '(非字串/空)'}`);
    console.log(`  enhancedSoul    : ${typeof data.enhancedSoul === 'string' ? `${data.enhancedSoul.length} chars` : '(非字串/空)'}`);

    // 額外：看 soul 前 200 字
    if (typeof data.soul_core === 'string' && data.soul_core.length > 0) {
      console.log(`  soul_core 摘 : "${data.soul_core.slice(0, 200).replace(/\n/g, ' ')}"`);
    }
    if (typeof data.system_soul === 'string' && data.system_soul.length > 0) {
      console.log(`  system_soul 摘: "${data.system_soul.slice(0, 200).replace(/\n/g, ' ')}"`);
    }

    // 2. platform_knowledge
    console.log('\n--- platform_knowledge ---');
    const kbSnap = await db.collection('platform_knowledge')
      .where('characterId', '==', charId)
      .get();
    console.log(`  總 knowledge 條目: ${kbSnap.size}`);
    const byCat: Record<string, number> = {};
    for (const k of kbSnap.docs) {
      const cat = (k.data().category as string) || '(no-cat)';
      byCat[cat] = (byCat[cat] || 0) + 1;
    }
    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    for (const [cat, n] of sorted) {
      console.log(`    ${cat.padEnd(20)} ${n} 條`);
    }

    // 3. platform_conversations
    console.log('\n--- platform_conversations ---');
    const convSnap = await db.collection('platform_conversations')
      .where('characterId', '==', charId)
      .limit(100)
      .get();
    console.log(`  conversations 數: ${convSnap.size}`);
    if (convSnap.size > 0) {
      const latestConvs = [];
      for (const c of convSnap.docs) {
        const cd = c.data();
        const updatedAt = cd.updatedAt?.toDate?.() || (cd.updatedAt ? new Date(cd.updatedAt) : null);
        const msgCount = (cd.messages as unknown[])?.length || 0;
        latestConvs.push({ id: c.id, updatedAt, msgCount });
      }
      latestConvs.sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0));
      for (const c of latestConvs.slice(0, 5)) {
        console.log(`    [${c.id.slice(-10)}]  msgs=${c.msgCount}  updatedAt=${c.updatedAt?.toISOString() || '-'}`);
      }
    }

    // 4. insights / memories（如果有獨立 collection）
    console.log('\n--- insights（character subcollection 或 platform_insights）---');
    try {
      const insightSnap = await db.collection('characters').doc(charId).collection('insights').get();
      console.log(`  characters/${charId}/insights: ${insightSnap.size} 條`);
    } catch { console.log('  (沒 subcollection insights)'); }
    try {
      const piSnap = await db.collection('platform_insights').where('characterId', '==', charId).get();
      console.log(`  platform_insights (where characterId): ${piSnap.size} 條`);
    } catch { console.log('  (platform_insights collection 不存在或沒資料)'); }
  }

  // 5. 互指：有沒有字串 'pEWC5m2MOddyGe9uw0u0' 或 'I9n2lotXIrME23TJNPsI' 出現在對方的 soul / knowledge / conv 裡
  console.log('\n\n========== 交叉檢查（有沒有互相引用）==========');
  for (const [labelA, idA] of Object.entries(IDS)) {
    const other = Object.entries(IDS).find(([l]) => l !== labelA);
    if (!other) continue;
    const [labelB, idB] = other;

    const charA = (await db.collection('characters').doc(idA).get()).data() || {};
    const soulText = `${charA.soul_core || ''}${charA.system_soul || ''}${charA.enhancedSoul || ''}`;
    if (soulText.includes(idB)) {
      console.log(`  ⚠ ${labelA.toUpperCase()} 的 soul 裡提到 ${labelB.toUpperCase()} 的 id`);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
