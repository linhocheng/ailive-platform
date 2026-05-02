/**
 * Migration：platform_insights where source='user_info' → platform_user_profiles
 *
 * 策略：
 *  - 把 title + content 串成 extraInfo（自由文本兜底）
 *  - 同 userId 多筆會 append（保留時序）
 *  - 原 doc 標 migrated=true（保留證據，不刪）
 *  - LLM 之後 session-end reflection 會慢慢分流到 name/birthday/occupation 結構化欄位
 *
 * 用法：
 *   DRY_RUN：npx tsx scripts/migrate_user_info_to_profile.ts
 *   實跑：   npx tsx scripts/migrate_user_info_to_profile.ts --apply
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');

(async () => {
  console.log(`=== Migration: platform_insights[source=user_info] → platform_user_profiles ===`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN（加 --apply 才實寫）'}\n`);

  // 撈所有 source=user_info（沒 migrated=true 的）
  const snap = await db.collection('platform_insights')
    .where('source', '==', 'user_info')
    .get();

  console.log(`找到 ${snap.size} 筆 source=user_info insight`);

  // 按 userId 分組（沒 userId 跳過）
  const byUser = new Map<string, Array<{ id: string; title: string; content: string; createdAt?: string; migrated?: boolean }>>();
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.migrated === true) continue; // 跳過已遷
    const uid = String(data.userId || '');
    if (!uid) continue; // 沒 userId 的丟掉
    const arr = byUser.get(uid) || [];
    arr.push({
      id: d.id,
      title: String(data.title || ''),
      content: String(data.content || ''),
      createdAt: data.createdAt as string | undefined,
    });
    byUser.set(uid, arr);
  }

  console.log(`涉及 ${byUser.size} 個 userId\n`);

  let totalWritten = 0;
  let totalMarked = 0;

  for (const [userId, items] of byUser.entries()) {
    items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const lines = items.map(i => `[${(i.createdAt || '').slice(0, 10)}] ${i.title}：${i.content}`.slice(0, 200));
    const merged = lines.join('\n').slice(-2000); // cap 2000 chars

    console.log(`--- userId=${userId} (${items.length} items) ---`);
    console.log(merged.slice(0, 200) + (merged.length > 200 ? '...' : ''));

    if (APPLY) {
      // upsert profile
      const ref = db.collection('platform_user_profiles').doc(userId);
      const existing = await ref.get();
      const now = new Date().toISOString();
      const payload: Record<string, unknown> = {
        userId,
        extraInfo: merged,
        updatedAt: now,
      };
      if (!existing.exists) payload.createdAt = now;
      await ref.set(payload, { merge: true });
      totalWritten += 1;

      // 標原 insights migrated=true
      const batch = db.batch();
      for (const it of items) {
        batch.update(db.collection('platform_insights').doc(it.id), { migrated: true });
        totalMarked += 1;
      }
      await batch.commit();
    }
    console.log('');
  }

  console.log(`=== 完成 ===`);
  console.log(`profiles 寫入：${totalWritten}`);
  console.log(`insights 標 migrated：${totalMarked}`);
  if (!APPLY) console.log(`\n（DRY-RUN，沒實寫。確認 OK 後加 --apply 重跑）`);
  process.exit(0);
})();
