/**
 * POST /api/tts
 * 文字轉語音 — ElevenLabs flash_v2_5
 * Body: { text: string, voiceId?: string, gender?: 'female' | 'male' }
 * Return: audio/mpeg stream
 */
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

const VOICE_FEMALE = '56hCnQE2rYMllQDw3m1o';
const VOICE_MALE   = '3D8gZpoA8QiwNEOs2oE7';

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY 未設定' }, { status: 500 });

    const { text, voiceId, gender } = await req.json();
    if (!text) return NextResponse.json({ error: 'text 必填' }, { status: 400 });

    // 選聲音：優先用角色設定的 voiceId，其次按 gender，預設女聲
    const selectedVoice = voiceId || (gender === 'male' ? VOICE_MALE : VOICE_FEMALE);

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_flash_v2_5',
          voice_settings: {
            stability: 0.75,
            similarity_boost: 0.75,
            speed: 1.05,
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `ElevenLabs 錯誤: ${err}` }, { status: 500 });
    }

    const audioBuffer = await res.arrayBuffer();
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
