import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

(async () => {
  const id = 'I9n2lotXIrME23TJNPsI';
  const doc = await db.collection('platform_characters').doc(id).get();
  const d = doc.data() as any;
  console.log('=== system_soul 完整 ===\n');
  console.log(d.system_soul);
  process.exit(0);
})();
