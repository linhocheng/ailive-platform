import fs from 'fs';
import admin from 'firebase-admin';
const envFile = fs.readFileSync('./.env.production','utf-8');
const m = envFile.match(/^FIREBASE_SERVICE_ACCOUNT_JSON="([\s\S]*?)"\s*$/m);
if (!m) { console.error('no FIREBASE_SERVICE_ACCOUNT_JSON'); process.exit(1); }
const sa = JSON.parse(m[1]);
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();
const ID = '6jE3lmuaPlNyrvWZeh33';

const cdoc = await db.collection('platform_characters').doc(ID).get();
if (!cdoc.exists) { console.log('character not found'); process.exit(0); }
const c = cdoc.data();
console.log('=== character ===');
console.log('name:', c.name, '| tier:', c.tier || '(none)', '| status:', c.status, '| type:', c.type);
console.log('updatedAt:', c.updatedAt);

const t = await db.collection('platform_tasks').where('characterId', '==', ID).get();
console.log(`\n=== tasks (${t.size}) ===`);
for (const d of t.docs) {
  const x = d.data();
  console.log(`- ${d.id.slice(0,8)} type=${x.type} enabled=${x.enabled} status=${x.status||'(none)'} last_run=${x.last_run||'never'} ${String(x.run_hour||0).padStart(2,'0')}:${String(x.run_minute||0).padStart(2,'0')}`);
  if (x.intent) console.log(`   intent: ${x.intent.slice(0, 80)}`);
  if (x.reason) console.log(`   reason: ${x.reason.slice(0, 80)}`);
}
process.exit(0);
