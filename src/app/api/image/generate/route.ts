/**
 * /api/image/generate — 生圖 API（獨立 route，maxDuration=300）
 *
 * POST { characterId, prompt, overrideRefUrl? }
 *
 * 獨立 route 的目的：多圖下載 + Gemini 生圖可能需要 120s+
 * dialogue route 只有 120s，這裡設 300s 才夠
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateImageForCharacter } from '@/lib/generate-image';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { characterId, prompt, overrideRefUrl } = await req.json();
    if (!characterId || !prompt) {
      return NextResponse.json({ error: 'characterId, prompt 必填' }, { status: 400 });
    }
    const result = await generateImageForCharacter(characterId, prompt, overrideRefUrl);
    return NextResponse.json({ success: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
