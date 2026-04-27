import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

(async () => {
  const doc = await db.collection('platform_conversations')
    .doc('voice-3FAIl35ShNIhtle3Twkb-voice-3FAIl35ShNIhtle3Twkb').get();
  if (!doc.exists) { console.log('conv 不存在'); process.exit(1); }
  const data = doc.data() as any;
  console.log('馬雲 voice conv. updatedAt:', data.updatedAt, 'msgCount:', (data.messages||[]).length);
  const msgs = (data.messages || []).slice(-12);
  msgs.forEach((m: any, i: number) => {
    const ts = (m.timestamp || '').slice(11, 19);
    const c = String(m.content || '').slice(0, 400);
    console.log(`[${i}] ${ts} ${m.role}: ${c}`);
  });
  process.exit(0);
})();
