import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

(async () => {
  const all = await db.collection('platform_characters').limit(50).get();
  const targets = all.docs.filter(d => {
    const n = String(d.data().name || '');
    return n.includes('憲福') || n.includes('馬雲');
  });
  for (const c of targets) {
    const cid = c.id;
    const cname = c.data().name;
    console.log('═'.repeat(72));
    console.log('角色:', cname, cid);
    const convSnap = await db.collection('platform_conversations')
      .where('characterId', '==', cid).limit(20).get();
    const convs = convSnap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    if (convs.length === 0) { console.log('  （沒有 conv）'); continue; }
    const latest = convs[0];
    console.log(`  conv: ${latest.id}  updatedAt=${latest.updatedAt}  user=${latest.userId}`);
    const msgs = (latest.messages || []).slice(-25);
    msgs.forEach((m: any, i: number) => {
      const ts = (m.timestamp || '').slice(11, 19);
      const role = m.role;
      const content = String(m.content || '').slice(0, 350);
      console.log(`    [${i}] ${ts} ${role}: ${content}`);
      if (m.toolUses && m.toolUses.length) console.log(`         [toolUses] ${JSON.stringify(m.toolUses).slice(0, 300)}`);
      if (m.toolName) console.log(`         [toolName=${m.toolName}]`);
    });
  }

  // 也撈最近寫進來的所有 strategy jobs (不限角色)，看 deploy 後有沒有任何新派工
  console.log('═'.repeat(72));
  console.log('=== platform_jobs jobType=strategy（按 createdAt desc 取 5）===');
  const stratSnap = await db.collection('platform_jobs')
    .where('jobType', '==', 'strategy').limit(20).get();
  const strats = stratSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 5);
  strats.forEach(s => {
    console.log(` - ${s.id} | status:${s.status} | created:${s.createdAt} | req:${s.requesterId} | src:${s.source} | brief:${String((s.brief?.prompt || '')).slice(0,60)}`);
  });
  process.exit(0);
})();
