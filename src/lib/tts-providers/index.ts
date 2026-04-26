/**
 * TTS Provider 工廠 + 安全合成 helper
 *
 * 選擇順序：
 *   1. getTTSProvider(name) 顯式傳入（per-call / per-character）
 *   2. env TTS_PROVIDER
 *   3. 'elevenlabs'（預設）
 *
 * 單一 instance 仍 cache，但只 cache「預設 provider」。
 * 顯式傳入的不 cache，避免 per-character 切換污染。
 *
 * Cross-provider fallback 已廢除（2026-04-23 voice-stream 關閉，2026-04-26 砍 dead code）。
 * 理由：聲音是角色身份，跨 provider 切換 = 換人說話 > 偶缺一句。
 */
import type { TTSProvider, TTSVoiceSettings } from './types';
import { ElevenLabsProvider } from './elevenlabs';
import { MinimaxProvider } from './minimax';

export type { TTSProvider, TTSRequest, TTSVoiceSettings } from './types';
export { ElevenLabsProvider, MinimaxProvider };

export type TTSProviderName = 'elevenlabs' | 'minimax';

const instances: Partial<Record<TTSProviderName, TTSProvider>> = {};

function instantiate(name: TTSProviderName): TTSProvider {
  if (instances[name]) return instances[name]!;
  const provider: TTSProvider = name === 'minimax' ? new MinimaxProvider() : new ElevenLabsProvider();
  instances[name] = provider;
  return provider;
}

function normalize(name: string | undefined | null): TTSProviderName {
  const n = (name || '').toLowerCase();
  return n === 'minimax' ? 'minimax' : 'elevenlabs';
}

export function getTTSProvider(name?: string | null): TTSProvider {
  const resolved: TTSProviderName = name
    ? normalize(name)
    : normalize(process.env.TTS_PROVIDER);
  return instantiate(resolved);
}

/**
 * 單一 provider 合成，含 0B 預讀 guard。失敗回 null（caller 自行決定靜音 / 跳句）。
 *
 * 「失敗」定義：
 *   - provider.synthesizeStream 回 null（API key 沒設、HTTP 非 200、空文字）
 *   - 拿到 stream 但第一個 chunk 是 0 bytes（MiniMax 靜默限流的症狀）
 *   - 讀第一個 chunk 時 throw
 *
 * 「成功」定義：
 *   - 拿到 stream 且第一個 chunk 有資料 → 把 firstChunk 跟剩餘 stream 重新組合回傳
 */
export async function synthesizeStreamSafe(opts: {
  provider: TTSProvider;
  voiceId: string;
  text: string;
  settings?: TTSVoiceSettings;
  characterId?: string;
}): Promise<ReadableStream<Uint8Array> | null> {
  let upstream: ReadableStream<Uint8Array> | null;
  try {
    upstream = await opts.provider.synthesizeStream({
      text: opts.text,
      voiceId: opts.voiceId,
      characterId: opts.characterId,
      settings: opts.settings,
    });
  } catch (e) {
    console.error(`[tts] ${opts.provider.name} throw:`, e);
    return null;
  }
  if (!upstream) return null;

  // 預讀第一個 chunk 驗證非 0B
  const reader = upstream.getReader();
  let firstChunk: Uint8Array | undefined;
  try {
    const { done, value } = await reader.read();
    if (done || !value || value.length === 0) {
      console.warn(`[tts] ${opts.provider.name} 第一 chunk 是 0B 或 done，視為失敗`);
      try { reader.releaseLock(); } catch {}
      return null;
    }
    firstChunk = value;
  } catch (e) {
    console.error(`[tts] ${opts.provider.name} 讀第一 chunk 失敗:`, e);
    try { reader.releaseLock(); } catch {}
    return null;
  }

  // 成功 — 把 firstChunk 跟剩餘 stream 重新組合
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      if (firstChunk) controller.enqueue(firstChunk);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
        controller.close();
      } catch (e) {
        console.error(`[tts] ${opts.provider.name} 串流途中錯誤:`, e);
        controller.error(e);
      }
    },
  });
}
