import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

(async () => {
  const all = await db.collection('platform_characters').limit(60).get();
  const targets = all.docs.filter(d => String(d.data().name || '').includes('吉娜'));
  console.log('找到吉娜角色數:', targets.length);
  for (const c of targets) {
    const d = c.data() as any;
    console.log('═'.repeat(60));
    console.log('id:', c.id);
    console.log('name:', d.name);
    console.log('ttsProvider:', d.ttsProvider);
    console.log('voiceId:', d.voiceId);
    console.log('voiceIdMinimax:', d.voiceIdMinimax);
    console.log('voiceIdElevenlabs:', d.voiceIdElevenlabs);
    console.log('ttsSettings:', JSON.stringify(d.ttsSettings, null, 2));
  }
  process.exit(0);
})();
