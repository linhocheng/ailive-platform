/**
 * GET /api/promises
 *
 * Query:
 *   characterId    必填 — 角色 id
 *   userId         選填 — 不帶則回該角色所有用戶
 *   status         unfulfilled | fulfilled | all（預設 unfulfilled）
 *   limit          預設 20
 *
 * 回傳：
 *   {
 *     promises: CharacterAction[],
 *     stats: { total, unfulfilled, fulfilledToday, byActionType: {...} }
 *   }
 *
 * 純 API，無 UI（紅線：UI 留白給 Adam Phase 6）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

type Status = 'unfulfilled' | 'fulfilled' | 'all';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const characterId = url.searchParams.get('characterId');
    const userId = url.searchParams.get('userId') || '';
    const status = (url.searchParams.get('status') || 'unfulfilled') as Status;
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100);

    if (!characterId) {
      return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });
    }
    if (!['unfulfilled', 'fulfilled', 'all'].includes(status)) {
      return NextResponse.json({ error: 'status 必為 unfulfilled / fulfilled / all' }, { status: 400 });
    }

    const db = getFirestore();
    let q: FirebaseFirestore.Query = db
      .collection('platform_insights')
      .where('characterId', '==', characterId);
    if (userId) q = q.where('userId', '==', userId);

    // actionType 過濾：只撈有 actionType 的（character-actions）
    // 用 client filter 避免複合索引
    const snap = await q.limit(500).get();

    const today = new Date().toISOString().slice(0, 10);
    let total = 0, unfulfilled = 0, fulfilledToday = 0;
    const byActionType: Record<string, number> = {};

    const promises = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>))
      .filter(a => {
        // 必須是 character-action（有 actionType + userId）
        if (!a.actionType || !a.userId) return false;
        if (a.isRelevant === false) return false;
        return true;
      });

    for (const a of promises) {
      total += 1;
      if (!a.fulfilled) unfulfilled += 1;
      const fAt = String(a.fulfilledAt || '');
      if (fAt && fAt.slice(0, 10) === today) fulfilledToday += 1;
      const at = String(a.actionType || 'general');
      byActionType[at] = (byActionType[at] || 0) + 1;
    }

    let filtered = promises;
    if (status === 'unfulfilled') {
      filtered = promises.filter(a => !a.fulfilled);
    } else if (status === 'fulfilled') {
      filtered = promises.filter(a => a.fulfilled);
    }

    filtered.sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    );
    filtered = filtered.slice(0, limit);

    return NextResponse.json({
      promises: filtered.map(a => ({
        id: a.id,
        characterId: a.characterId,
        userId: a.userId,
        actionType: a.actionType,
        title: a.title,
        content: a.content,
        fulfilled: !!a.fulfilled,
        fulfilledAt: a.fulfilledAt ?? null,
        fulfilledBy: a.fulfilledBy ?? null,
        isRelevant: a.isRelevant === false ? false : true,
        importance: a.importance ?? 1,
        createdAt: a.createdAt,
        source: a.source ?? null,
      })),
      stats: { total, unfulfilled, fulfilledToday, byActionType },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
