/**
 * platform_characters — 角色主檔
 * GET  /api/characters           → 列出所有角色
 * POST /api/characters           → 建立新角色
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin';

const COLLECTION = 'platform_characters';

export async function GET() {
  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const snap = await db.collection(COLLECTION).get();

    const characters = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: d.data().updatedAt?.toDate?.()?.toISOString() || null,
    }));
    characters.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

    return NextResponse.json({ success: true, characters, count: characters.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const body = await req.json();

    const {
      name,
      type = 'vtuber',   // vtuber | brand_editor
      rawSoul = '',
      mission = '',
    } = body;

    if (!name) {
      return NextResponse.json({ error: 'name 必填' }, { status: 400 });
    }

    const now = new Date();
    const data = {
      name,
      type,
      rawSoul,
      enhancedSoul: '',
      soulVersion: 0,
      mission,
      visualIdentity: {
        characterSheet: '',
        imagePromptPrefix: '',
        styleGuide: '',
        fixedElements: [],
        negativePrompt: 'different face, inconsistent features',
      },
      lineChannelToken: '',
      lineChannelSecret: '',
      lineWebhookUrl: '',
      igAccessToken: '',
      igUserId: '',
      growthMetrics: {
        totalConversations: 0,
        totalInsights: 0,
        totalPosts: 0,
        soulVersion: 0,
        lastGrowthEvent: null,
      },
      costMetrics: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUSD: 0,
      },
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    const ref = await db.collection(COLLECTION).add(data);

    // 自動填入 lineWebhookUrl（建立後才知道 id）
    const webhookUrl = `https://ailive-platform.vercel.app/api/line-webhook/${ref.id}`;
    await ref.update({ lineWebhookUrl: webhookUrl });

    // ===== 自動建立預設任務組（每個新角色都有）=====
    // description 是 description-driven 的靈魂，讓角色帶著自己的意識執行，不跑空白模板
    const DEFAULT_TASKS = [
      {
        type: 'sleep',
        run_hour: 2,
        run_minute: 0,
        days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        enabled: true,
        description: `每天深夜，整理今天的記憶。合併重複的洞察，讓重要的事浮上來，讓沒被用到的慢慢沉下去。這是你的自我管理，不需要表演。`,
      },
    ];

    const taskBatch = db.batch();
    for (const task of DEFAULT_TASKS) {
      const taskRef = db.collection('platform_tasks').doc();
      taskBatch.set(taskRef, {
        characterId: ref.id,
        ...task,
        last_run: null,
        createdAt: new Date().toISOString(),
      });
    }
    await taskBatch.commit();

    // 角色建立後立刻觸發一次 sleep 初始化（建立記憶基線）
    try {
      const sleepUrl = `https://ailive-platform.vercel.app/api/sleep`;
      await fetch(sleepUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: ref.id }),
      });
    } catch { /* 不阻斷建立流程 */ }

    return NextResponse.json({
      success: true,
      id: ref.id,
      lineWebhookUrl: webhookUrl,
      message: `角色「${name}」建立成功`,
      defaultTasksCreated: DEFAULT_TASKS.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
