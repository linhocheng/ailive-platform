/**
 * voice-settings — ElevenLabs TTS 參數策略
 *
 * 背景：Flash v2.5 + 中文 + 中等 stability (0.75) 會在情緒詞/標點密集處
 * 出現「大呼小叫、尖叫」的不穩症狀。不同聲音本質上的穩定度也不同
 * （「高表現力」類聲音特別容易失控）。
 *
 * 策略：
 *   - 全域提高 stability、降速、明確關閉 speaker_boost 和 style
 *   - per-voice 對已知不穩的聲音再加強
 */

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

// 全域基準：穩定優先，避免爆音
const DEFAULT_SETTINGS: VoiceSettings = {
  stability: 0.85,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: false,
  speed: 1.0,
};

// 個別聲音的特殊處理（已知不穩 → 再壓穩）
const PER_VOICE_OVERRIDES: Record<string, Partial<VoiceSettings>> = {
  // 馬雲：高表現力聲音，會尖叫 → stability 拉到 0.92
  'xDoFg8lWm2wU9izkHz6D': { stability: 0.92 },
};

export function getVoiceSettings(voiceId: string): VoiceSettings {
  const override = PER_VOICE_OVERRIDES[voiceId] || {};
  return { ...DEFAULT_SETTINGS, ...override };
}
