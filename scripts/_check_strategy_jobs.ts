import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

(async () => {
  // 1. 確認奧角色 doc 是否存在於該 ID
  const aoDoc = await db.collection('platform_characters').doc('pEWC5m2MOddyGe9uw0u0').get();
  console.log('奧 doc 存在?', aoDoc.exists);
  if (aoDoc.exists) console.log('奧.name:', aoDoc.data()?.name);
  else {
    // 找叫「奧」的角色
    const search = await db.collection('platform_characters').where('name', '==', '奧').limit(3).get();
    console.log('找叫「奧」的角色：');
    search.forEach(d => console.log(' -', d.id, '/', d.data().name));
  }
  console.log('─'.repeat(60));

  // 2. 撈所有 jobType='strategy' 的 jobs
  const stratSnap = await db.collection('platform_jobs').where('jobType', '==', 'strategy').limit(20).get();
  console.log(`jobType='strategy' 共 ${stratSnap.size} 條`);
  stratSnap.forEach(d => {
    const x = d.data() as any;
    console.log(' -', d.id, '| status:', x.status, '| createdAt:', x.createdAt, '| requesterId:', x.requesterId);
  });
  console.log('─'.repeat(60));

  // 3. 最近 10 條 platform_jobs（按 createdAt 字串倒序）
  const recentSnap = await db.collection('platform_jobs')
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();
  console.log(`最近 10 條 platform_jobs:`);
  recentSnap.forEach(d => {
    const x = d.data() as any;
    console.log(' -', d.id, '| type:', x.jobType, '| status:', x.status, '| created:', x.createdAt, '| req:', x.requesterId, '| src:', x.source);
  });

  process.exit(0);
})();
