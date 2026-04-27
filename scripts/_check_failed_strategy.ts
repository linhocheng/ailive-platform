import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

(async () => {
  const doc = await db.collection('platform_jobs').doc('mEAxbhWMeDVm9QblRnEZ').get();
  const x = doc.data() as any;
  console.log('FULL JOB DOC:');
  console.log(JSON.stringify(x, null, 2));
  process.exit(0);
})();
