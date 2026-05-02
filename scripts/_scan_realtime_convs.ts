import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local.fresh', 'utf-8');
const sa = JSON.parse(env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/)![1].replace(/^"|"$/g, ''));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const TARGETS: Array<{ name: string; id: string }> = [
  { name: '吉娜',   id: 'I9n2lotXIrME23TJNPsI' },
  { name: '聖嚴',   id: 'mziGYIQGZHK2g4XOoU0w' },
];

(async () => {
  for (const t of TARGETS) {
    console.log(`\n=== ${t.name} (${t.id}) ===`);

    // 撈所有 conv
    const snap = await db.collection('platform_conversations')
      .where('characterId', '==', t.id)
      .get();

    // voice-* 前綴 = 按鈕語音 + 即時語音共用 conv
    const voiceConvs = snap.docs.filter(d => d.id.startsWith('voice-'));
    const otherConvs = snap.docs.filter(d => !d.id.startsWith('voice-'));
    console.log(`總 conv 數：${snap.size}（voice-*: ${voiceConvs.length}, 其他: ${otherConvs.length}）`);

    // 列出 voice convs（這是即時語音會用的）
    for (const d of voiceConvs) {
      const data = d.data() as any;
      const updatedAt = data.updatedAt || '';
      const messageCount = data.messageCount ?? (data.messages || []).length;
      const summaryLen = (data.summary || '').length;
      const lastSession = data.lastSession || null;
      const messages = (data.messages || []) as Array<{ role: string; content: string; timestamp?: number | string }>;

      console.log(`\n  conv: ${d.id}`);
      console.log(`    updatedAt: ${typeof updatedAt === 'string' ? updatedAt : String(updatedAt)}`);
      console.log(`    messageCount: ${messageCount}, messages array len: ${messages.length}`);
      console.log(`    summary chars: ${summaryLen}${summaryLen > 0 ? ' → ' + String(data.summary).slice(0, 120) + '...' : ''}`);
      if (lastSession) {
        console.log(`    lastSession: summary="${lastSession.summary || ''}" mood=${lastSession.endingMood || ''} threads=${(lastSession.unfinishedThreads || []).length}`);
      } else {
        console.log(`    lastSession: (無)`);
      }
      // 最後 3 句話 sample
      console.log(`    最後 3 句：`);
      for (const m of messages.slice(-3)) {
        const role = m.role === 'user' ? '用戶' : '角色';
        const content = String(m.content || '').slice(0, 80);
        console.log(`      [${role}] ${content}`);
      }
    }

    // platform_insights 該角色 actions（character-actions）
    const insightsSnap = await db.collection('platform_insights')
      .where('characterId', '==', t.id)
      .get();
    const allInsights = insightsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const actions = allInsights.filter(i => i.userId && i.actionType);
    const userInfo = allInsights.filter(i => i.source === 'user_info');
    const generalInsights = allInsights.filter(i => !i.userId);

    console.log(`\n  platform_insights 統計：`);
    console.log(`    總筆數：${allInsights.length}`);
    console.log(`    character-actions（有 userId+actionType）：${actions.length}`);
    if (actions.length > 0) {
      const byType = actions.reduce((acc, a) => { acc[a.actionType] = (acc[a.actionType] || 0) + 1; return acc; }, {} as Record<string, number>);
      const fulfilled = actions.filter(a => a.fulfilled).length;
      console.log(`      types: ${JSON.stringify(byType)}, fulfilled: ${fulfilled}/${actions.length}`);
    }
    console.log(`    user_info（要 migrate 的舊資料）：${userInfo.length}`);
    console.log(`    一般 insights（沒 userId 的角色通用）：${generalInsights.length}`);

    // platform_user_profiles & observations（B3 新表，這次掃也看一下）
    const profilesSnap = await db.collection('platform_user_profiles')
      .limit(10).get();
    const obsSnap = await db.collection('platform_user_observations')
      .where('characterId', '==', t.id)
      .get();
    console.log(`\n  B3 新表狀態：`);
    console.log(`    platform_user_profiles 全表：${profilesSnap.size}（不分角色）`);
    console.log(`    platform_user_observations 該角色：${obsSnap.size}`);
  }

  process.exit(0);
})();
