/**
 * /api/sleep — 夢境引擎（薄殼）
 *
 * POST { characterId, dryRun? }
 *
 * 邏輯全在 @/lib/sleep-engine（與 runner 的 sleep task 共用，收斂點）。
 * 這裡只做 HTTP 進出：參數驗證 → 引擎 → JSON 回應。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { runSleepEngine } from '@/lib/sleep-engine';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { characterId, dryRun } = await req.json();
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const db = getFirestore();
    const { summary, healthReport } = await runSleepEngine(db, characterId, { dryRun: !!dryRun });

    return NextResponse.json({ success: true, dryRun: !!dryRun, summary, healthReport });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === '角色不存在' ? 404 : msg === 'ANTHROPIC_API_KEY 未設定' ? 500 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
