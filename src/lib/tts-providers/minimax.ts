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

// ===== 模組級 throttle：防 MiniMax RPM 靜默限流 =====
// YuqiCity 血換數據：0.2s 間隔會 71% 空回應、0.5s 穩定
// 我們選 throttle-by-interval 而非 Semaphore(1)，因為 voice-stream 多句並行
// 嚴格序列化會把首字延遲變 N 倍。間隔保證足以避開 RPM 爆點
// Promise chain 確保 throttle 本身是串行的（避免 race condition）
// 注意：這是單 lambda instance 保護，跨 instance 的全域 RPM 要 Redis-based
const MINIMAX_MIN_INTERVAL_MS = 500;
let minimaxLastCallAt = 0;
let minimaxThrottleGate: Promise<void> = Promise.resolve();

function throttleMinimax(): Promise<void> {
  const myTurn = minimaxThrottleGate.then(async () => {
    const elapsed = Date.now() - minimaxLastCallAt;
    if (elapsed < MINIMAX_MIN_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MINIMAX_MIN_INTERVAL_MS - elapsed));
    }
    minimaxLastCallAt = Date.now();
  });
  minimaxThrottleGate = myTurn.catch(() => {}); // 防止 chain 壞掉
  return myTurn;
}

// ===== 0B retry：讀第一個 chunk，空的話重組一個 null 訊號 =====
// MiniMax 靜默限流 = HTTP 200 + SSE body 無 audio chunk → 輸出 stream 0 bytes
// 修法：讀第一個 chunk 判斷，空就 retry 一次
async function peekFirstChunk(upstream: ReadableStream<Uint8Array>): Promise<{
  firstChunk: Uint8Array | null;
  rebuiltStream: ReadableStream<Uint8Array> | null;
}> {
  const reader = upstream.getReader();
  let firstChunk: Uint8Array | null = null;
  try {
    const { done, value } = await reader.read();
    if (done || !value || value.length === 0) {
      try { reader.releaseLock(); } catch {}
      return { firstChunk: null, rebuiltStream: null };
    }
    firstChunk = value;
  } catch {
    try { reader.releaseLock(); } catch {}
    return { firstChunk: null, rebuiltStream: null };
  }

  // 組新 stream：先塞 firstChunk，之後把 reader 剩下 pull 出來
  const rebuiltStream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (firstChunk) controller.enqueue(firstChunk);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { controller.close(); try { reader.releaseLock(); } catch {} return; }
        if (value) controller.enqueue(value);
      } catch (e) {
        controller.error(e);
        try { reader.releaseLock(); } catch {}
      }
    },
    cancel() { try { reader.releaseLock(); } catch {} },
  });
  return { firstChunk, rebuiltStream };
}

interface MinimaxVoiceSettings {
  voice_id: string;
  speed: number;
  vol: number;
  pitch: number;
  emotion?: string;  // happy/sad/angry/fearful/disgusted/surprised/neutral
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

// 提取 req.settings（loose 型別）中 MiniMax 認得的欄位
function extractMinimaxSettings(
  s?: import('./types').TTSVoiceSettings,
): Partial<MinimaxVoiceSettings> | undefined {
  if (!s) return undefined;
  const out: Partial<MinimaxVoiceSettings> = {};
  if (typeof s.speed === 'number') out.speed = s.speed;
  if (typeof s.vol === 'number') out.vol = s.vol;
  if (typeof s.pitch === 'number') out.pitch = s.pitch;
  if (typeof s.emotion === 'string') out.emotion = s.emotion;
  return Object.keys(out).length ? out : undefined;
}

function buildSettings(voiceId: string, runtimeOverride?: Partial<MinimaxVoiceSettings>): MinimaxSettings {
  // 優先級：runtime (角色 ttsSettings) > PER_VOICE_OVERRIDES (code hardcode) > DEFAULT
  const hardcode = PER_VOICE_OVERRIDES[voiceId] || {};
  return {
    model: hardcode.model || DEFAULT_SETTINGS.model,
    voice: {
      voice_id: voiceId,
      speed: runtimeOverride?.speed ?? hardcode.voice?.speed ?? DEFAULT_SETTINGS.voice.speed,
      vol: runtimeOverride?.vol ?? hardcode.voice?.vol ?? DEFAULT_SETTINGS.voice.vol,
      pitch: runtimeOverride?.pitch ?? hardcode.voice?.pitch ?? DEFAULT_SETTINGS.voice.pitch,
      emotion: runtimeOverride?.emotion ?? hardcode.voice?.emotion ?? DEFAULT_SETTINGS.voice.emotion,
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

  // 單次原始呼叫（不含 throttle / retry 邏輯）
  private async rawCall(req: TTSRequest, apiKey: string, groupId: string): Promise<ReadableStream<Uint8Array> | null> {
    const settings = buildSettings(req.voiceId, extractMinimaxSettings(req.settings));
    const url = `https://api.minimax.io/v1/t2a_v2?GroupId=${encodeURIComponent(groupId)}`;
    // 繁→簡轉換：MiniMax 訓練語料以簡體為主，送簡體進去發音穩定度較高
    // 字級對應，不轉詞彙（譬如「專案」不會變「項目」）— 只解決發音，不改用語
    const textForMinimax = sify(req.text);

    const body = {
      model: settings.model,
      text: textForMinimax,
      stream: true,
      stream_options: { exclude_aggregated_audio: true },
      // language_boost 官方 40 個選項只有 Chinese / Chinese,Yue，沒有台灣國語
      // 用 'auto' 會偵測成 Chinese → 推到最純陸腔模板（加劇陸腔）
      // 用 null = 不觸發任何語言強化，讓 voice 本身的錄音底去決定口音
      language_boost: null,
      voice_setting: settings.voice,
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
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

    // 2026-04-23 新增：限流 / 其他錯誤時 MiniMax 回 HTTP 200 + JSON body（不是 SSE）
    //   例：{"base_resp":{"status_code":1002,"status_msg":"rate limit exceeded(RPM)"}}
    //   之前 SSE parser 看不懂 JSON → totalBytes=0 → 整個錯誤訊息被吞
    //   現在明確判 content-type，印真實 status_code 到 log
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('event-stream')) {
      const text = await res.text().catch(() => '');
      try {
        const j = JSON.parse(text);
        const code = j?.base_resp?.status_code;
        const msg = j?.base_resp?.status_msg;
        console.error(`[MinimaxProvider] rejected code=${code} msg="${msg}" (HTTP ${res.status}, ct=${contentType})`);
      } catch {
        console.error(`[MinimaxProvider] non-SSE body (HTTP ${res.status}, ct=${contentType}): ${text.slice(0, 200)}`);
      }
      return null;
    }
    return sseToMp3Stream(res.body);
  }

  async synthesizeStream(req: TTSRequest): Promise<ReadableStream<Uint8Array> | null> {
    const apiKey = process.env.MINIMAX_API_KEY;
    const groupId = process.env.MINIMAX_GROUP_ID;

    if (!apiKey || !groupId) {
      console.warn('[MinimaxProvider] MINIMAX_API_KEY / MINIMAX_GROUP_ID 未設定');
      return null;
    }
    if (!req.text.trim()) return null;

    // 2026-04-23 砍掉 0B retry：實證 0B 真因是 RPM 限流（status_code 1002）。
    //   60s 窗口內 immediate retry 必然再撞，只浪費一次配額。
    //   真正的修法是拉 throttle 或升級 MiniMax RPM 配額。
    await throttleMinimax();

    const rawStream = await this.rawCall(req, apiKey, groupId);
    if (!rawStream) return null; // rawCall 已印錯誤原因（HTTP / base_resp status_code）

    // 讀第一個 MP3 chunk 確認 SSE 真的帶 audio（罕見：SSE 成立但只有 status 2 summary）
    const { firstChunk, rebuiltStream } = await peekFirstChunk(rawStream);
    if (firstChunk && firstChunk.length > 0 && rebuiltStream) {
      return rebuiltStream;
    }
    console.warn('[MinimaxProvider] SSE ok but empty audio');
    return null;
  }
}
