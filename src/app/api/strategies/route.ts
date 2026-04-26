/**
 * /api/strategies — 策略書檔案夾（角色維度）
 *
 * GET ?characterId=xxx → 撈該角色委派出的 strategy jobs（全狀態：pending/done/failed）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

interface StrategyRec {
  jobId: string;
  status: string;
  brief: string;
  docUrl?: string;
  docTitle?: string;
  filename?: string;
  assigneeId?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export async function GET(req: NextRequest) {
  try {
    const db = getFirestore();
    const characterId = req.nextUrl.searchParams.get('characterId');
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const snap = await db.collection('platform_jobs')
      .where('requesterId', '==', characterId)
      .limit(200)
      .get();

    const items: StrategyRec[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.jobType !== 'strategy') continue;
      const result = d.result as Record<string, unknown> | undefined;
      items.push({
        jobId: doc.id,
        status: String(d.status || 'pending'),
        brief: String((d.brief as Record<string, unknown>)?.prompt || ''),
        docUrl: result?.docUrl ? String(result.docUrl) : undefined,
        docTitle: result?.docTitle ? String(result.docTitle) : undefined,
        filename: result?.filename ? String(result.filename) : undefined,
        assigneeId: d.assigneeId ? String(d.assigneeId) : undefined,
        createdAt: String(d.createdAt || ''),
        completedAt: d.completedAt ? String(d.completedAt) : undefined,
        error: d.error ? String(d.error) : undefined,
      });
    }

    items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return NextResponse.json({ strategies: items });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/strategies]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
