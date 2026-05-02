import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

(async () => {
  const id = 'I9n2lotXIrME23TJNPsI';
  const doc = await db.collection('platform_characters').doc(id).get();
  if (!doc.exists) { console.log('not found'); process.exit(1); }
  const d = doc.data() as any;

  const fields = ['name', 'aiName', 'system_soul', 'soul_core', 'enhancedSoul', 'soul'];
  for (const f of fields) {
    const v = d[f];
    if (v === undefined || v === null) {
      console.log(`[${f}] (none)\n`);
    } else if (typeof v === 'string') {
      console.log(`[${f}] len=${v.length}`);
      console.log(v.slice(0, 800));
      console.log(v.length > 800 ? `...(truncated, total ${v.length})` : '');
      console.log('---');
    } else {
      console.log(`[${f}]`, JSON.stringify(v));
    }
  }

  // 找有沒有 "曜" "肢體" "動作" "微笑" 等線索
  const fullText = fields.map(f => String(d[f] || '')).join('\n');
  const probes = ['曜', '吉娜', '*', '（', '(', '肢體', '微笑', '點頭', '動作'];
  console.log('\n=== probes ===');
  for (const p of probes) {
    const matches = (fullText.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (matches > 0) console.log(`  "${p}" 出現 ${matches} 次`);
  }
  process.exit(0);
})();
