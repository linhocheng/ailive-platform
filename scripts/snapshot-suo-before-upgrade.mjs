#!/usr/bin/env node
// Dump 索 doc 現狀為 JSON snapshot，給之後 rollback 用
// 用法：node scripts/snapshot-suo-before-upgrade.mjs
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

const DOC_ID = 'dQHkL6vvhmKlNho8dA1L';
const snap = await db.collection('platform_characters').doc(DOC_ID).get();
if (!snap.exists) throw new Error(`${DOC_ID} 不存在`);
const data = snap.data();

// 保留現狀（已升級 specialist 之後）+ 也記下升級前推測的「未設」狀態
const snapshot = {
  capturedAt: new Date().toISOString(),
  docId: DOC_ID,
  current: data,
  rollbackFields: {
    role_type: admin.firestore.FieldValue.delete(),
    tier: admin.firestore.FieldValue.delete(),
    aiName: admin.firestore.FieldValue.delete(),
    specialist_config: admin.firestore.FieldValue.delete(),
  },
};

const outPath = path.join(__dirname, '..', 'scripts', 'suo-snapshot.json');
const safe = JSON.parse(JSON.stringify(snapshot, (k, v) => {
  if (v && typeof v === 'object' && v._methodName) return `__FIELD_VALUE__${v._methodName}`;
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
  return v;
}));
fs.writeFileSync(outPath, JSON.stringify(safe, null, 2), 'utf-8');

console.log(`✓ 索 snapshot 已寫: ${outPath}`);
console.log(`   role_type: ${data.role_type}  tier: ${data.tier}  aiName: ${data.aiName}`);
console.log(`   specialist_config:`, data.specialist_config);
process.exit(0);
