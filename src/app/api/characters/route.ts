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

    return NextResponse.json({
      success: true,
      id: ref.id,
      lineWebhookUrl: webhookUrl,
      message: `角色「${name}」建立成功`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
