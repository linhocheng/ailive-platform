/**
 * MiniMax Provider
 *
 * MiniMax T2A v2 API：
 *   POST https://api.minimax.io/v1/t2a_v2?GroupId={GROUP_ID}
 *   Header: Authorization: Bearer {API_KEY}
 *
 * Streaming response 是 SSE：
 *   data: {"data":{"audio":"<hex>","status":1},...}
 *   data: {"data":{"audio":"<hex_full>","status":2},...}   <- 最後一筆
 *
 * 我們用 stream_options.exclude_aggregated_audio = true
 * 避免最後一筆重送完整音訊。
 *
 * 輸出：統一為 MP3 bytes 的 ReadableStream<Uint8Array>
 * （因為 body.audio_setting.format = 'mp3'）
 *
 * 這樣前端 MSE (audio/mpeg) 不用改。
 */
import type { TTSProvider, TTSRequest } from './types';
import { sify } from 'chinese-conv';

interface MinimaxVoiceSettings {
  voice_id: string;
  speed: number;
  vol: number;
  pitch: number;
  emotion?: string;  // happy/sad/angry/fearful/disgusted/surprised/neutral/calm/fluent
}

interface MinimaxSettings {
  model: string;
  voice: MinimaxVoiceSettings;
}

// 全域預設：走 turbo 省錢 + 中性語氣
const DEFAULT_SETTINGS: Omit<MinimaxSettings, 'voice'> & { voice: Omit<MinimaxVoiceSettings, 'voice_id'> } = {
  model: 'speech-02-turbo',   // 可改 speech-2.6-hd 取更穩更貴
  voice: {
    speed: 1.0,
    vol: 1.0,
    pitch: 0,
    emotion: 'neutral',
  },
};

// Per-voice override（未來依需求擴充）
const PER_VOICE_OVERRIDES: Record<string, Partial<MinimaxSettings>> = {
  // e.g. 'moss_audio_xxx': { model: 'speech-2.6-hd', voice: { ..., emotion: 'calm' } }
};

function buildSettings(voiceId: string): MinimaxSettings {
  const override = PER_VOICE_OVERRIDES[voiceId] || {};
  return {
    model: override.model || DEFAULT_SETTINGS.model,
    voice: {
      voice_id: voiceId,
      speed: override.voice?.speed ?? DEFAULT_SETTINGS.voice.speed,
      vol: override.voice?.vol ?? DEFAULT_SETTINGS.voice.vol,
      pitch: override.voice?.pitch ?? DEFAULT_SETTINGS.voice.pitch,
      emotion: override.voice?.emotion ?? DEFAULT_SETTINGS.voice.emotion,
    },
  };
}

// hex string → Uint8Array
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * 把 MiniMax 的 SSE stream 轉成純 MP3 bytes stream。
 * 逐 chunk 讀取 → parse `data:` 行 → JSON → hex decode → enqueue bytes
 */
function sseToMp3Stream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;

          buffer += decoder.decode(value, { stream: true });

          // SSE 用 \n\n 分隔 event
          let sepIdx: number;
          while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
            const event = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);

            // 只看 data: 行
            const dataLine = event.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;

            const jsonText = dataLine.slice(5).trim();
            if (!jsonText || jsonText === '[DONE]') continue;

            try {
              const parsed = JSON.parse(jsonText);
              const audioHex: string = parsed?.data?.audio;
              const status: number = parsed?.data?.status;

              if (audioHex && status === 1) {
                controller.enqueue(hexToBytes(audioHex));
              }
              // status === 2 是 final summary（已用 exclude_aggregated_audio 排除，但保險跳過）
            } catch (e) {
              console.warn('[MinimaxProvider] SSE parse error:', e);
            }
          }
        }
      } catch (e) {
        console.error('[MinimaxProvider] stream read error:', e);
        controller.error(e);
        return;
      } finally {
        controller.close();
      }
    },
  });
}

export class MinimaxProvider implements TTSProvider {
  name = 'minimax' as const;

  async synthesizeStream(req: TTSRequest): Promise<ReadableStream<Uint8Array> | null> {
    const apiKey = process.env.MINIMAX_API_KEY;
    const groupId = process.env.MINIMAX_GROUP_ID;

    if (!apiKey || !groupId) {
      console.warn('[MinimaxProvider] MINIMAX_API_KEY / MINIMAX_GROUP_ID 未設定');
      return null;
    }
    if (!req.text.trim()) return null;

    const settings = buildSettings(req.voiceId);

    const url = `https://api.minimax.io/v1/t2a_v2?GroupId=${encodeURIComponent(groupId)}`;
    // 繁→簡轉換：MiniMax 訓練語料以簡體為主，送簡體進去發音穩定度較高
    // 字級對應，不轉詞彙（譬如「專案」不會變「項目」）— 只解決發音，不改用語
    const textForMinimax = sify(req.text);

    const body = {
      model: settings.model,
      text: textForMinimax,
      stream: true,
      stream_options: { exclude_aggregated_audio: true },
      language_boost: 'auto',
      voice_setting: settings.voice,
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',     // 讓前端 MSE audio/mpeg 不用動
        channel: 1,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      console.error(`[MinimaxProvider] API ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    return sseToMp3Stream(res.body);
  }
}
