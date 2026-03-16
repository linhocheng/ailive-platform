/**
 * /api/image/generate — 生圖 API（HTTP 入口）
 * 邏輯集中在 /lib/generate-image.ts，避免 server-to-server 呼叫問題
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateImageForCharacter } from '@/lib/generate-image';

export async function POST(req: NextRequest) {
  try {
    const { characterId, prompt } = await req.json();
    if (!characterId || !prompt) {
      return NextResponse.json({ error: 'characterId, prompt 必填' }, { status: 400 });
    }
    const result = await generateImageForCharacter(characterId, prompt);
    return NextResponse.json({ success: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
