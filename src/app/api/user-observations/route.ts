/**
 * /api/user-observations — platform_user_observations CRUD
 *
 * GET  ?characterId=xxx&listUsers=1  → 列出該角色所有有資料的 userId
 * GET  ?characterId=xxx&userId=yyy   → 讀取觀察
 * PATCH { characterId, userId, personality, preferences, inferredInterests, notes } → 更新
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { loadUserObservations, upsertUserObservations } from '@/lib/user-observations';
import { hasOperatorAccess } from '@/lib/char-access';

export async function GET(req: NextRequest) {
  try {
    if (!hasOperatorAccess(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const characterId = req.nextUrl.searchParams.get('characterId');
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    // listUsers：列出所有有 user_observations 的 userId
    if (req.nextUrl.searchParams.get('listUsers') === '1') {
      const db = getFirestore();
      const snap = await db.collection('platform_user_observations')
        .where('characterId', '==', characterId)
        .get();
      const users = snap.docs.map(d => {
        const data = d.data();
        const raw = data.updatedAt;
        const updatedAt: string | undefined =
          raw && typeof raw === 'object' && 'toDate' in raw
            ? (raw as { toDate(): Date }).toDate().toISOString()
            : typeof raw === 'string' ? raw : undefined;
        return { userId: data.userId as string, updatedAt };
      }).filter(u => u.userId);
      return NextResponse.json({ users });
    }

    const userId = req.nextUrl.searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'userId 必填' }, { status: 400 });
    const obs = await loadUserObservations(characterId, userId);
    return NextResponse.json({ observations: obs });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!hasOperatorAccess(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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
