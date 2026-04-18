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
