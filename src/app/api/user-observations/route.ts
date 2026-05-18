/**
 * /api/user-observations — platform_user_observations CRUD
 *
 * GET  ?characterId=xxx&userId=yyy  → 讀取觀察
 * PATCH { characterId, userId, personality, preferences, inferredInterests, notes } → 更新
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadUserObservations, upsertUserObservations } from '@/lib/user-observations';

export async function GET(req: NextRequest) {
  try {
    const characterId = req.nextUrl.searchParams.get('characterId');
    const userId = req.nextUrl.searchParams.get('userId');
    if (!characterId || !userId) {
      return NextResponse.json({ error: 'characterId, userId 必填' }, { status: 400 });
    }
    const obs = await loadUserObservations(characterId, userId);
    return NextResponse.json({ observations: obs });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { characterId, userId, personality, preferences, inferredInterests, notes } = await req.json();
    if (!characterId || !userId) {
      return NextResponse.json({ error: 'characterId, userId 必填' }, { status: 400 });
    }
    await upsertUserObservations(characterId, userId, { personality, preferences, inferredInterests, notes });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
