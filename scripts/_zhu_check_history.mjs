import fs from 'fs';
import admin from 'firebase-admin';
const envFile = fs.readFileSync('./.env.production','utf-8');
const m = envFile.match(/^FIREBASE_SERVICE_ACCOUNT_JSON="([\s\S]*?)"\s*$/m);
const sa = JSON.parse(m[1]);
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();
const ID = '6jE3lmuaPlNyrvWZeh33';

// 1. 最近 platform_proactive_records — 看王彩雲手動/排程觸發歷史
const r = await db.collection('platform_proactive_records')
  .where('characterId', '==', ID).get();
const recs = r.docs.map(d => ({id:d.id, ...d.data()}))
  .sort((a,b)=>String(b.executedAt||'').localeCompare(String(a.executedAt||'')))
  .slice(0,15);
console.log(`=== platform_proactive_records (${r.size} 筆，顯示最新 15) ===`);
for(const x of recs){
  console.log(`  ${x.executedAt||'?'} ${x.taskType} status=${x.status} ${x.id}`);
}

// 2. bridge_fallbacks 看 30 分鐘內 fallback
console.log(`\n=== bridge_fallbacks 最近 30min ===`);
const fb = await db.collection('bridge_fallbacks').orderBy('timestamp','desc').limit(20).get();
const cutoff = Date.now() - 30*60*1000;
let cnt=0;
for(const d of fb.docs){
  const x = d.data();
  const ts = x.timestamp?.toMillis ? x.timestamp.toMillis() : 0;
  if(ts<cutoff) break;
  cnt++;
  console.log(`  +${new Date(ts).toISOString()} ${x.model} dur=${x.durationMs}ms err=${(x.error||'').slice(0,80)}`);
}
if(!cnt) console.log('  (無)');

// 3. 王彩雲今天的 platform_posts draft
const ps = await db.collection('platform_posts').where('characterId','==',ID).get();
const today = '2026-05-13';
const drafts = ps.docs.map(d=>({id:d.id,...d.data()}))
  .filter(p=>String(p.createdAt||'').startsWith(today))
  .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
console.log(`\n=== 王彩雲今天 platform_posts (${drafts.length}) ===`);
for(const p of drafts){
  console.log(`  ${p.createdAt} status=${p.status} topic=${(p.topic||'').slice(0,30)} img=${p.imageUrl?'Y':'N'}`);
}

// 4. 王彩雲今天的 insights
const ins = await db.collection('platform_insights').where('characterId','==',ID).get();
const todayIns = ins.docs.map(d=>({id:d.id,...d.data()}))
  .filter(p=>String(p.createdAt||'').startsWith(today))
  .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
console.log(`\n=== 王彩雲今天 platform_insights (${todayIns.length}) ===`);
for(const p of todayIns){
  console.log(`  ${p.createdAt} src=${p.source} title=${(p.title||'').slice(0,40)}`);
}

process.exit(0);
