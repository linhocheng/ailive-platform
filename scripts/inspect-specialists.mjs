#!/usr/bin/env node
// 撈瞬（painter, shun-001）跟奧（strategist, pEWC5m2MOddyGe9uw0u0）完整 doc
// 比對跟一般角色（劉潤 Wjv0vpnzmqDQYRB1HzXS）的欄位差異
import fs from 'fs';
import path from 'path';
import url from 'url';
import admin from 'firebase-admin';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env.production');
const envFile = fs.readFileSync(ENV_PATH, 'utf-8');
function pickRaw(key) {
  const m = envFile.match(new RegExp(`^${key}="([\\s\\S]*?)"\\s*$`, 'm'))
        || envFile.match(new RegExp(`^${key}=([^\\n]+)$`, 'm'));
  return m ? m[1] : undefined;
}
const sa = JSON.parse(pickRaw('FIREBASE_SERVICE_ACCOUNT_JSON'));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const TARGETS = [
  { label: '瞬（painter）', id: 'shun-001' },
  { label: '奧（strategist）', id: 'pEWC5m2MOddyGe9uw0u0' },
  { label: '劉潤（對照組-一般角色）', id: 'Wjv0vpnzmqDQYRB1HzXS' },
];

const docs = {};
for (const t of TARGETS) {
  const snap = await db.collection('platform_characters').doc(t.id).get();
  if (!snap.exists) {
    console.log(`✗ ${t.label} (${t.id}) 不存在`);
    continue;
  }
  docs[t.id] = { label: t.label, data: snap.data() };
}

console.log('\n=== 欄位對照 ===\n');
const allKeys = new Set();
Object.values(docs).forEach(d => Object.keys(d.data).forEach(k => allKeys.add(k)));
const keys = [...allKeys].sort();

const ids = Object.keys(docs);
const labels = ids.map(id => docs[id].label);
console.log('欄位'.padEnd(28), labels.map(l => l.slice(0, 18).padEnd(20)).join(''));
console.log('-'.repeat(28 + 20 * ids.length));
for (const k of keys) {
  const cells = ids.map(id => {
    const v = docs[id].data[k];
    if (v == null) return '—'.padEnd(20);
    const t = typeof v;
    if (t === 'string') return `str(${v.length})`.padEnd(20);
    if (t === 'object' && Array.isArray(v)) return `arr(${v.length})`.padEnd(20);
    if (t === 'object') return `obj(${Object.keys(v).length})`.padEnd(20);
    if (t === 'boolean') return `bool(${v})`.padEnd(20);
    return String(v).slice(0, 18).padEnd(20);
  });
  console.log(k.padEnd(28), cells.join(''));
}

console.log('\n=== specialist 特殊欄位 dump（瞬 + 奧）===\n');
// 列出在 specialist 有、劉潤沒有 的欄位
const liurun = docs['Wjv0vpnzmqDQYRB1HzXS']?.data || {};
const specialistOnly = keys.filter(k => {
  const inSpec = (docs['shun-001']?.data[k] != null) || (docs['pEWC5m2MOddyGe9uw0u0']?.data[k] != null);
  const inLiu = liurun[k] != null;
  return inSpec && !inLiu;
});
console.log('specialist 獨有欄位:', specialistOnly.length ? specialistOnly : '(無)');

for (const id of ['shun-001', 'pEWC5m2MOddyGe9uw0u0']) {
  if (!docs[id]) continue;
  console.log(`\n--- ${docs[id].label} (${id}) 完整 dump ---`);
  for (const k of keys) {
    const v = docs[id].data[k];
    if (v == null) continue;
    if (typeof v === 'string' && v.length > 400) {
      console.log(`  ${k}: [${v.length} chars]`);
      console.log(`    HEAD: ${v.slice(0, 300).replace(/\n/g, '↵')}`);
      console.log(`    TAIL: ${v.slice(-200).replace(/\n/g, '↵')}`);
    } else if (typeof v === 'object') {
      console.log(`  ${k}:`, JSON.stringify(v, null, 2).split('\n').map(l => '    ' + l).join('\n').trim());
    } else {
      console.log(`  ${k}:`, v);
    }
  }
}

process.exit(0);
