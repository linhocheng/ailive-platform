import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

(async () => {
  // 找憲福角色（可能是「憲福」「謝文憲」「憲哥」之類）
  const all = await db.collection('platform_characters').limit(50).get();
  const candidates = all.docs.filter(d => {
    const n = String(d.data().name || '');
    return n.includes('憲') || n.toLowerCase().includes('xianfu') || n.toLowerCase().includes('xianhu');
  });
  console.log('=== 候選角色（含「憲」字） ===');
  candidates.forEach(d => console.log(' -', d.id, '/', d.data().name, '/ tier:', d.data().tier));
  console.log('（共', all.docs.length, '個角色掃描）');

  if (candidates.length === 0) {
    console.log('沒找到帶「憲」字的角色，列前 30 個 name 給看：');
    all.docs.slice(0, 30).forEach(d => console.log(' -', d.id, '/', d.data().name));
    process.exit(0);
  }

  // 撈每個候選的最近 1 條 conv
  for (const c of candidates) {
    const cid = c.id;
    const cname = c.data().name;
    console.log('═'.repeat(70));
    console.log('角色:', cname, cid);
    const convSnap = await db.collection('platform_conversations')
      .where('characterId', '==', cid).limit(20).get();
    const convs = convSnap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    if (convs.length === 0) { console.log('  （沒有 conversations）'); continue; }
    const latest = convs[0];
    console.log(`  最近 conv: ${latest.id} updatedAt=${latest.updatedAt} userId=${latest.userId}`);
    const msgs = (latest.messages || []).slice(-12);
    msgs.forEach((m: any, i: number) => {
      const ts = (m.timestamp || '').slice(11, 19);
      const role = m.role;
      const content = String(m.content || '').slice(0, 250);
      console.log(`    [${i}] ${ts} ${role}: ${content}`);
      if (m.toolUses && m.toolUses.length) console.log(`         toolUses: ${JSON.stringify(m.toolUses).slice(0, 250)}`);
    });
  }
  process.exit(0);
})();
