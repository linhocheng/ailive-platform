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
  // 1) full visualIdentity dump
  const charDoc = await db.collection('platform_characters').doc(CHAR_ID).get();
  const charData = charDoc.data() || {};
  console.log('=== character visualIdentity ===');
  console.log(JSON.stringify(charData.visualIdentity, null, 2));
  console.log('\nfields on character (top-level keys related to visual):');
  Object.keys(charData).filter(k => /visual|image|avatar|sheet|portrait/i.test(k)).forEach(k => {
    console.log('  -', k, '=', JSON.stringify((charData as any)[k]).slice(0, 300));
  });

  // 2) check the conversation doc itself
  console.log('\n=== conversation doc ===');
  const convDoc = await db.collection('platform_conversations').doc(CONV_ID).get();
  if (!convDoc.exists) {
    console.log('  conv NOT FOUND. Try search platform_jobs by other recent fields.');
  } else {
    const c = convDoc.data() as any;
    console.log('  characterId:', c.characterId);
    console.log('  userId     :', c.userId);
    console.log('  updatedAt  :', c.updatedAt);
    const msgs = c.messages || [];
    console.log('  msg count  :', msgs.length);
    // show last few messages with toolUses
    msgs.slice(-12).forEach((m: any, j: number) => {
      const head = `  [${msgs.length - 12 + j}] ${m.role}: ${String(m.content || '').slice(0, 120)}`;
      console.log(head);
      if (m.toolUses) {
        m.toolUses.forEach((t: any) => {
          console.log('       tool:', t.name, '| input:', JSON.stringify(t.input).slice(0, 300));
        });
      }
      if (m.toolResults) {
        m.toolResults.forEach((t: any) => {
          console.log('       result:', JSON.stringify(t).slice(0, 200));
        });
      }
    });
  }

  // 3) most recent platform_jobs in last hour, look for ones referencing Vivi or this conv
  console.log('\n=== recent platform_jobs (last 50, scan for Vivi / matching conv) ===');
  const recent = await db.collection('platform_jobs').limit(200).get();
  const list = recent.docs.map(d => ({ id: d.id, ...d.data() } as any))
    .sort((a, b) => {
      const av = a.createdAt?.toMillis ? a.createdAt.toMillis() : (typeof a.createdAt === 'string' ? Date.parse(a.createdAt) : 0);
      const bv = b.createdAt?.toMillis ? b.createdAt.toMillis() : (typeof b.createdAt === 'string' ? Date.parse(b.createdAt) : 0);
      return bv - av;
    });
  console.log('top 15 newest jobs:');
  list.slice(0, 15).forEach(j => {
    console.log('  -', j.id, '| requesterConvId=', j.requesterConvId, '| requesterCharId=', j.requesterCharId, '| status=', j.status, '| createdAt=', j.createdAt);
  });

  // Find any job that mentions CONV_ID or CHAR_ID in any field
  console.log('\nscanning for CONV_ID or CHAR_ID match anywhere...');
  list.forEach(j => {
    const blob = JSON.stringify(j);
    if (blob.includes(CONV_ID) || blob.includes(CHAR_ID)) {
      console.log('  HIT:', j.id, 'createdAt=', j.createdAt, 'status=', j.status);
      console.log('       brief.refs=', JSON.stringify(j?.brief?.refs));
      console.log('       requesterConvId=', j.requesterConvId, 'requesterCharId=', j.requesterCharId);
    }
  });

  process.exit(0);
})();
