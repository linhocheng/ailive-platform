import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

(async () => {
  const all = await db.collection('platform_characters').limit(60).get();
  const targets = all.docs.filter(d => String(d.data().name || '').includes('聖嚴'));
  console.log('找到聖嚴角色數:', targets.length);
  for (const c of targets) {
    const d = c.data() as any;
    console.log('═'.repeat(72));
    console.log('id:', c.id);
    console.log('name:', d.name);
    console.log('ttsProvider:', d.ttsProvider);
    console.log('voiceId:', d.voiceId);
    console.log('ttsSettings:', JSON.stringify(d.ttsSettings, null, 2));
    // 撈最近 conv
    const convSnap = await db.collection('platform_conversations')
      .where('characterId', '==', c.id).limit(15).get();
    const convs = convSnap.docs.map(x => ({ id: x.id, ...(x.data() as any) }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    if (convs.length === 0) { console.log('（沒有 conv）'); continue; }
    const latest = convs[0];
    console.log('--- 最新 conv:', latest.id, 'updatedAt:', latest.updatedAt, '---');
    const msgs = (latest.messages || []).slice(-10);
    msgs.forEach((m: any, i: number) => {
      const ts = (m.timestamp || '').slice(11, 19);
      const role = m.role;
      const content = String(m.content || '');
      console.log(`[${i}] ${ts} ${role} (${content.length}字):`);
      console.log('    ' + content.slice(0, 600).replace(/\n/g, '\n    '));
    });
  }
  process.exit(0);
})();
