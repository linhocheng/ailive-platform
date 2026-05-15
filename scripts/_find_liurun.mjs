import fs from 'fs';
import admin from 'firebase-admin';
const envFile = fs.readFileSync('./.env.production','utf-8');
const m = envFile.match(/^FIREBASE_SERVICE_ACCOUNT_JSON="([\s\S]*?)"\s*$/m);
const sa = JSON.parse(m[1]);
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();
const snap = await db.collection('platform_characters').get();
for (const d of snap.docs) {
  const x = d.data();
  console.log(d.id, '|', JSON.stringify({ name: x.name, aiName: x.aiName, displayName: x.displayName }));
}
process.exit(0);
