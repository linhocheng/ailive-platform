#!/usr/bin/env node
// Rollback：把索從 specialist 還原成普通角色（刪除 role_type/tier/specialist_config/aiName）
// 用法：node scripts/rollback-suo-specialist.mjs [--apply]
//   不帶 --apply：dry-run
//   帶 --apply：實際刪除
import fs from 'fs';
import path from 'path';
import url from 'url';
import admin from 'firebase-admin';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env.production');
const envFile = fs.readFileSync(ENV_PATH, 'utf-8');
const m = envFile.match(/^FIREBASE_SERVICE_ACCOUNT_JSON="([\s\S]*?)"\s*$/m);
const sa = JSON.parse(m[1]);
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const DOC_ID = 'dQHkL6vvhmKlNho8dA1L';
const ref = db.collection('platform_characters').doc(DOC_ID);
const snap = await ref.get();
const before = snap.data();

console.log('=== 索目前狀態 ===');
console.log(`role_type: ${before.role_type}`);
console.log(`tier: ${before.tier}`);
console.log(`aiName: ${before.aiName}`);
console.log(`specialist_config:`, before.specialist_config);

const patch = {
  role_type: admin.firestore.FieldValue.delete(),
  tier: admin.firestore.FieldValue.delete(),
  aiName: admin.firestore.FieldValue.delete(),
  specialist_config: admin.firestore.FieldValue.delete(),
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
};

console.log('\n=== 將執行 ===');
console.log('刪除 role_type / tier / aiName / specialist_config');

if (!APPLY) {
  console.log('\n=== DRY RUN ===  加 --apply 才實際執行');
  process.exit(0);
}

await ref.update(patch);
const after = (await ref.get()).data();
console.log('\n=== AFTER ===');
console.log(`role_type: ${after.role_type ?? '(已刪)'}`);
console.log(`tier: ${after.tier ?? '(已刪)'}`);
console.log(`aiName: ${after.aiName ?? '(已刪)'}`);
console.log(`specialist_config: ${after.specialist_config ?? '(已刪)'}`);
console.log('\n✓ 索已還原為普通角色狀態');
process.exit(0);
