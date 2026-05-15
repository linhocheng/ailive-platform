import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local.fresh', 'utf-8');
const saMatch = env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/);
if (!saMatch) { console.error('no SA'); process.exit(1); }
const sa = JSON.parse(saMatch[1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const CONV_ID = 'v0wje7Zazj6KU6nQfm5P';
const CHAR_ID = 'kTwsX44G0ImsApEACDuE';

(async () => {
  // 1) character.visualIdentity.characterSheet
  const charDoc = await db.collection('platform_characters').doc(CHAR_ID).get();
  const charData = charDoc.data() || {};
  const sheet = charData?.visualIdentity?.characterSheet ?? null;
  console.log('=== Character ===');
  console.log('  id      :', CHAR_ID);
  console.log('  name    :', charData.name);
  console.log('  visualIdentity.characterSheet:', sheet);

  // 2) platform_jobs where requesterConvId == CONV_ID, order by createdAt desc, limit 1
  let snap;
  try {
    snap = await db.collection('platform_jobs')
      .where('requesterConvId', '==', CONV_ID)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
  } catch (e: any) {
    console.warn('(orderBy createdAt failed, fallback to client-sort)', e?.message);
    snap = await db.collection('platform_jobs')
      .where('requesterConvId', '==', CONV_ID)
      .limit(20)
      .get();
  }

  const jobs = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as any))
    .sort((a, b) => {
      const av = a.createdAt?.toMillis ? a.createdAt.toMillis() : (typeof a.createdAt === 'string' ? Date.parse(a.createdAt) : 0);
      const bv = b.createdAt?.toMillis ? b.createdAt.toMillis() : (typeof b.createdAt === 'string' ? Date.parse(b.createdAt) : 0);
      return bv - av;
    });

  console.log('\n=== platform_jobs match (requesterConvId=' + CONV_ID + ') ===');
  console.log('count:', jobs.length);
  if (!jobs.length) {
    console.log('NO MATCH. Try recent platform_jobs (any requester) for diagnostics:');
    const fallback = await db.collection('platform_jobs').limit(10).get();
    fallback.forEach(d => {
      const dat = d.data() as any;
      console.log('  -', d.id, '| requesterConvId=', dat.requesterConvId, '| status=', dat.status, '| createdAt=', dat.createdAt);
    });
    process.exit(0);
  }

  const job = jobs[0];
  console.log('\n--- LATEST JOB ---');
  console.log('id      :', job.id);
  console.log('status  :', job.status);
  console.log('output.imageUrl:', job?.output?.imageUrl);

  const refs: any[] = job?.brief?.refs || [];
  console.log('\nbrief.refs (count =', refs.length, '):');
  refs.forEach((r, i) => console.log(`  [${i}]`, JSON.stringify(r)));

  console.log('\n=== FULL DOC ===');
  console.log(JSON.stringify(job, (k, v) => {
    if (v && typeof v === 'object' && typeof v.toMillis === 'function') return v.toDate().toISOString();
    return v;
  }, 2));

  // verdict
  console.log('\n=== VERDICT ===');
  console.log('refs.length =', refs.length, '(expected 2)');
  if (refs.length >= 1) {
    const first = typeof refs[0] === 'string' ? refs[0] : (refs[0]?.url || refs[0]?.imageUrl || JSON.stringify(refs[0]));
    console.log('refs[0]      =', first);
    console.log('characterSheet match?', first === sheet ? 'YES' : 'NO');
  }
  process.exit(0);
})();
