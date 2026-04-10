/**
 * POST /api/tts
 * 文字轉語音 — ElevenLabs flash_v2_5 (streaming)
 * Body: { text: string, voiceId?: string, gender?: 'female' | 'male' }
 * Return: audio/mpeg stream（邊生成邊送，前端收到就播）
 */
import { NextRequest, NextResponse } from 'next/server';
import { preprocessTTS } from '@/lib/tts-preprocess';

export const maxDuration = 30;

const VOICE_FEMALE = '56hCnQE2rYMllQDw3m1o';
const VOICE_MALE   = '3D8gZpoA8QiwNEOs2oE7';


export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY 未設定' }, { status: 500 });

    const { text, voiceId, gender } = await req.json();
    if (!text) return NextResponse.json({ error: 'text 必填' }, { status: 400 });

    const processedText = preprocessTTS(text);
    const selectedVoice = voiceId || (gender === 'male' ? VOICE_MALE : VOICE_FEMALE);

    // ✅ 換成 /stream 端點 — ElevenLabs 邊生成邊送 chunks
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: processedText,
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

    // ✅ 直接 pipe stream — 不等 arrayBuffer()，收到 chunk 就送出去
    return new NextResponse(res.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no', // 告訴 proxy 不要緩衝
      },
    });

  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
