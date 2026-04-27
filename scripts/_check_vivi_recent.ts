import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const saMatch = env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/);
if (!saMatch) { console.error('no SA'); process.exit(1); }
const sa = JSON.parse(saMatch[1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

(async () => {
  // 找 Vivi
  const charSnap = await db.collection('platform_characters').where('name', '==', 'Vivi').limit(1).get();
  if (charSnap.empty) {
    const fb = await db.collection('platform_characters').limit(30).get();
    console.log('Vivi 找不到，列出可選角色：');
    fb.forEach(d => console.log(' -', d.id, '/', d.data().name));
    process.exit(0);
  }
  const viviId = charSnap.docs[0].id;
  console.log('Vivi id:', viviId);

  // 撈她最近的 conversations（不能 orderBy avoid index，撈一批 client sort）
  const convSnap = await db.collection('platform_conversations')
    .where('characterId', '==', viviId)
    .limit(50)
    .get();
  const convs = convSnap.docs
    .map(d => ({ id: d.id, ...d.data() } as any))
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));

  for (let i = 0; i < Math.min(2, convs.length); i++) {
    const c = convs[i];
    console.log('═'.repeat(70));
    console.log(`#${i+1} convId:${c.id} userId:${c.userId} updatedAt:${c.updatedAt}`);
    const msgs = (c.messages || []).slice(-8);
    msgs.forEach((m: any, j: number) => {
      const ts = (m.timestamp || '').slice(11, 19);
      console.log(`  [${j}] ${ts} ${m.role}: ${String(m.content || '').slice(0, 200)}`);
      if (m.toolUses) console.log('       toolUses:', JSON.stringify(m.toolUses).slice(0, 200));
    });
  }
  process.exit(0);
})();
