/**
 * ElevenLabs Provider
 *
 * 把既有 fetchTTSStream() 的邏輯封進 provider 介面。
 * 輸出：audio/mpeg (MP3) bytes stream
 */
import type { TTSProvider, TTSRequest } from './types';

// ElevenLabs per-voice 參數（原 voice-settings.ts 的邏輯）
interface ElevenLabsSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

const DEFAULT_SETTINGS: ElevenLabsSettings = {
  stability: 0.85,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: false,
  speed: 1.0,
};

const PER_VOICE_OVERRIDES: Record<string, Partial<ElevenLabsSettings>> = {
  // 馬雲：高表現力聲音 → 拉到 0.92 壓穩
  'xDoFg8lWm2wU9izkHz6D': { stability: 0.92 },
};

function getSettings(voiceId: string): ElevenLabsSettings {
  return { ...DEFAULT_SETTINGS, ...(PER_VOICE_OVERRIDES[voiceId] || {}) };
}

export class ElevenLabsProvider implements TTSProvider {
  name = 'elevenlabs' as const;

  async synthesizeStream(req: TTSRequest): Promise<ReadableStream<Uint8Array> | null> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.warn('[ElevenLabsProvider] ELEVENLABS_API_KEY 未設定');
      return null;
    }
    if (!req.text.trim()) return null;

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${req.voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: req.text,
          model_id: 'eleven_flash_v2_5',
          voice_settings: getSettings(req.voiceId),
        }),
      }
    );

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      console.error(`[ElevenLabsProvider] API ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }
    return res.body;
  }
}
