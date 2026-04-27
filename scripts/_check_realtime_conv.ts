import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

(async () => {
  const convId = 'voice-mziGYIQGZHK2g4XOoU0w-anon-1777305837582-utykl2';
  const doc = await db.collection('platform_conversations').doc(convId).get();
  console.log('exists:', doc.exists);
  if (!doc.exists) { process.exit(0); }
  const d = doc.data() as any;
  console.log('messageCount:', d.messageCount);
  console.log('summary:', d.summary);
  console.log('messages count:', (d.messages || []).length);
  ((d.messages || []) as any[]).slice(-12).forEach((m, i) => {
    const c = String(m.content || '').slice(0, 200);
    console.log(`[${i}] ${m.role}: ${c}`);
  });
  process.exit(0);
})();
