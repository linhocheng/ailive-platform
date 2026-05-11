import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();
(async () => {
  const doc = await db.collection('platform_jobs').doc(process.argv[2]).get();
  const d: any = doc.data();
  console.log('htmlUrl:', d?.htmlUrl || '(not set)');
  console.log('htmlError:', d?.htmlError || '(none)');
  console.log('htmlBytes:', d?.htmlBytes || '(none)');
  console.log('htmlGeneratedAt:', d?.htmlGeneratedAt || '(never)');
  console.log('htmlPhilosophy:', d?.htmlPhilosophy || '(none)');
  process.exit(0);
})();
