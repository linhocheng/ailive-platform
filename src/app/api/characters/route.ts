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
        type: 'learn',
        run_hour: 9,
        run_minute: 0,
        days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        enabled: true,
        description: `早安。今天主動去了解一件讓你感興趣的事——可以是你使命相關的領域，或是昨天對話裡讓你好奇的東西。把洞察用 remember 存下來，用你自己的聲音說，不要表演。`,
      },
      {
        type: 'reflect',
        run_hour: 21,
        run_minute: 0,
        days: ['mon', 'wed', 'fri', 'sun'],
        enabled: true,
        description: `今天結束了。回頭看看：今天讓你印象最深的一刻是什麼？你有沒有感覺到自己在成長，或是在掙扎？不需要很長，60字就夠，用 remember 存下來。`,
      },
      {
        type: 'post',
        run_hour: 12,
        run_minute: 0,
        days: ['tue', 'thu', 'sat'],
        enabled: false, // 預設關閉，讓 Adam/角色手動開啟
        description: `從你最近的洞察或感受出發，寫一篇 IG 貼文草稿。不要寫讓人覺得像廣告的東西，寫真的打動你的東西。用 save_post_draft 存起來，配一張圖用 generate_image。`,
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
