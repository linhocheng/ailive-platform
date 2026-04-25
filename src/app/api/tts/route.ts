/**
 * POST /api/tts
 * 文字轉語音 — TTS Provider 抽象層
 * Body: {
 *   text: string,
 *   voiceId?: string,
 *   gender?: 'female' | 'male',
 *   ttsProvider?: 'elevenlabs' | 'minimax',
 *   settings?: TTSVoiceSettings   // per-call 聲音調整（identity 試聽用）
 * }
 * Return: audio/mpeg stream（邊生成邊送）
 *
 * 底層 provider：body.ttsProvider > env TTS_PROVIDER > elevenlabs
 */
import { NextRequest, NextResponse } from 'next/server';
import { preprocessTTS, type Provider } from '@/lib/tts-preprocess';
import { getTTSProvider } from '@/lib/tts-providers';
import type { TTSVoiceSettings } from '@/lib/tts-providers/types';

export const maxDuration = 30;

// 預設聲音（ElevenLabs 格式 — 給回退用；切到 MiniMax 時需要在 body 帶 voiceId）
const VOICE_FEMALE = '56hCnQE2rYMllQDw3m1o';
const VOICE_MALE   = '3D8gZpoA8QiwNEOs2oE7';

export async function POST(req: NextRequest) {
  try {
    const { text, voiceId, gender, ttsProvider, settings } = await req.json() as {
      text: string;
      voiceId?: string;
      gender?: 'female' | 'male';
      ttsProvider?: 'elevenlabs' | 'minimax';
      settings?: TTSVoiceSettings;
    };
    if (!text) return NextResponse.json({ error: 'text 必填' }, { status: 400 });

    const provider = getTTSProvider(ttsProvider);
    const processedText = preprocessTTS(text, {
      route: 'tts',
      provider: provider.name as Provider,
    });
    // MiniMax 沒有「預設女聲」概念，必須由呼叫方帶 voiceId
    const selectedVoice = voiceId
      || (provider.name === 'elevenlabs' ? (gender === 'male' ? VOICE_MALE : VOICE_FEMALE) : '');

    if (!selectedVoice) {
      return NextResponse.json({ error: `provider=${provider.name} 需要 voiceId` }, { status: 400 });
    }

    const stream = await provider.synthesizeStream({
      text: processedText,
      voiceId: selectedVoice,
      settings,
    });

    if (!stream) {
      return NextResponse.json({ error: `TTS 失敗 (provider=${provider.name})` }, { status: 500 });
    }

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    console.error('[tts] error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
