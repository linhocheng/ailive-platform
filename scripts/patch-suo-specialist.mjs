#!/usr/bin/env node
// 把索（dQHkL6vvhmKlNho8dA1L）從一般角色升級成 specialist：
// - role_type: 'specialist'
// - tier: 'specialist'
// - aiName: 'Suǒ'（如果空著）
// - specialist_config: { accepts_jobs, worker_concurrency, worker_model, worker_tool }
//
// 用法：node scripts/patch-suo-specialist.mjs [--apply]
//   不帶 --apply：dry-run，只印 before/diff，不寫
//   帶 --apply：實際寫入
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

const APPLY = process.argv.includes('--apply');
const DOC_ID = 'dQHkL6vvhmKlNho8dA1L';
const ref = db.collection('platform_characters').doc(DOC_ID);
const snap = await ref.get();
if (!snap.exists) {
  console.error(`✗ ${DOC_ID} 不存在`);
  process.exit(1);
}
const before = snap.data();

console.log('=== BEFORE ===');
console.log(`id: ${DOC_ID}`);
console.log(`name: ${before.name}`);
console.log(`aiName: ${before.aiName ?? '(空)'}`);
console.log(`role_type: ${before.role_type ?? '(空)'}`);
console.log(`tier: ${before.tier ?? '(空)'}`);
console.log(`status: ${before.status}`);
console.log(`mission: ${before.mission?.slice(0, 80) ?? '(空)'}${(before.mission || '').length > 80 ? '...' : ''}`);
console.log(`system_soul: ${(before.system_soul || '').length} chars`);
console.log(`soul_core: ${(before.soul_core || '').length} chars`);
console.log(`specialist_config:`, before.specialist_config ?? '(空)');

const patch = {};
if (before.role_type !== 'specialist') patch.role_type = 'specialist';
if (before.tier !== 'specialist') patch.tier = 'specialist';
if (!before.aiName) patch.aiName = 'Suǒ';
const newSC = {
  accepts_jobs: ['research'],
  worker_concurrency: 3,
  worker_model: 'claude-sonnet-4-6',
  worker_tool: 'web_search_20250305',
};
const cur = before.specialist_config || {};
const sameSC = JSON.stringify(cur) === JSON.stringify(newSC);
if (!sameSC) patch.specialist_config = newSC;

console.log('\n=== DIFF（要寫的欄位）===');
if (Object.keys(patch).length === 0) {
  console.log('(沒有 diff，無需更新)');
  process.exit(0);
}
for (const [k, v] of Object.entries(patch)) {
  const oldV = before[k];
  console.log(`  ${k}:`);
  console.log(`    舊: ${typeof oldV === 'object' ? JSON.stringify(oldV) : oldV ?? '(空)'}`);
  console.log(`    新: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
}

if (!APPLY) {
  console.log('\n=== DRY RUN ===');
  console.log('沒有真的寫入。確認後加 --apply 再跑一次。');
  process.exit(0);
}

patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
await ref.update(patch);

const snap2 = await ref.get();
const after = snap2.data();
console.log('\n=== AFTER ===');
console.log(`role_type: ${after.role_type}`);
console.log(`tier: ${after.tier}`);
console.log(`aiName: ${after.aiName}`);
console.log(`specialist_config:`, after.specialist_config);
console.log('\n✓ 已寫入');
process.exit(0);
