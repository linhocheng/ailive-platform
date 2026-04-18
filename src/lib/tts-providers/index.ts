/**
 * TTS Provider 工廠
 *
 * 選擇順序：
 *   1. getTTSProvider(name) 顯式傳入（per-call / per-character）
 *   2. env TTS_PROVIDER
 *   3. 'elevenlabs'（預設）
 *
 * 單一 instance 仍 cache，但只 cache「預設 provider」。
 * 顯式傳入的不 cache，避免 per-character 切換污染。
 */
import type { TTSProvider } from './types';
import { ElevenLabsProvider } from './elevenlabs';
import { MinimaxProvider } from './minimax';

export type { TTSProvider, TTSRequest } from './types';
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
 * 嘗試從 primary provider 取得 TTS stream，失敗則自動 fallback。
 *
 * 「失敗」定義：
 *   - provider.synthesizeStream 回 null（API key 沒設、HTTP 非 200、空文字）
 *   - 拿到 stream 但第一個 chunk 是 0 bytes（MiniMax 靜默限流的症狀）
 *
 * 「成功」定義：
 *   - 拿到 stream 且第一個 chunk 有資料 → 立即回傳，不再重試
 *
 * 注意：fallback voice 必須由 caller 傳入（不同 provider 的 voiceId 格式不同）。
 *
 * @returns { stream, providerUsed } 或 null（兩邊都失敗）
 */
export async function synthesizeWithFallback(opts: {
  primary: { provider: TTSProvider; voiceId: string };
  fallback?: { provider: TTSProvider; voiceId: string };
  text: string;
  characterId?: string;
}): Promise<{ stream: ReadableStream<Uint8Array>; providerUsed: string } | null> {
  // 1. 試 primary
  const primaryResult = await tryProvider(opts.primary, opts.text, opts.characterId);
  if (primaryResult) {
    return { stream: primaryResult, providerUsed: opts.primary.provider.name };
  }

  // 2. 沒 fallback → 直接放棄
  if (!opts.fallback || !opts.fallback.voiceId) {
    console.warn(`[tts-fallback] primary=${opts.primary.provider.name} 失敗，無 fallback 可用`);
    return null;
  }

  // 3. 試 fallback
  console.warn(`[tts-fallback] primary=${opts.primary.provider.name} 失敗，切換 fallback=${opts.fallback.provider.name}`);
  const fallbackResult = await tryProvider(opts.fallback, opts.text, opts.characterId);
  if (fallbackResult) {
    return { stream: fallbackResult, providerUsed: opts.fallback.provider.name };
  }

  console.error(`[tts-fallback] 兩邊都失敗 primary=${opts.primary.provider.name} fallback=${opts.fallback.provider.name}`);
  return null;
}

/**
 * 試一個 provider，包裝「拿到 stream + 預讀第一個 chunk 確認非 0B」的邏輯。
 * 成功 → 回傳「重新組合過的 stream」（把預讀的 chunk 還回去 + 原 reader 剩餘的）
 * 失敗 → 回 null
 */
async function tryProvider(
  target: { provider: TTSProvider; voiceId: string },
  text: string,
  characterId?: string,
): Promise<ReadableStream<Uint8Array> | null> {
  let upstream: ReadableStream<Uint8Array> | null;
  try {
    upstream = await target.provider.synthesizeStream({ text, voiceId: target.voiceId, characterId });
  } catch (e) {
    console.error(`[tts-fallback] ${target.provider.name} throw:`, e);
    return null;
  }
  if (!upstream) return null;

  // 預讀第一個 chunk 驗證非 0B
  const reader = upstream.getReader();
  let firstChunk: Uint8Array | undefined;
  try {
    const { done, value } = await reader.read();
    if (done || !value || value.length === 0) {
      console.warn(`[tts-fallback] ${target.provider.name} 第一 chunk 是 0B 或 done，視為失敗`);
      try { reader.releaseLock(); } catch {}
      return null;
    }
    firstChunk = value;
  } catch (e) {
    console.error(`[tts-fallback] ${target.provider.name} 讀第一 chunk 失敗:`, e);
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
        console.error(`[tts-fallback] ${target.provider.name} 串流途中錯誤:`, e);
        controller.error(e);
      }
    },
  });
}
