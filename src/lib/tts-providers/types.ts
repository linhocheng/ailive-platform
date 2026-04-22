/**
 * TTS Provider 介面
 *
 * 所有 provider 都必須實作這個介面。
 * 輸出統一為 MP3 bytes 的 ReadableStream<Uint8Array>，
 * 前端消費方不需要關心底層是 ElevenLabs 還是 MiniMax。
 */

// ── Per-call 聲音調整（來自角色 ttsSettings）────────────────
// 不同 provider 接受不同欄位，合併進一個 loose 型別，provider 內部挑自己認得的。
export interface TTSVoiceSettings {
  // ── 共用 ──
  speed?: number;              // 0.5 ~ 2.0（兩家都支援）
  // ── ElevenLabs ──
  stability?: number;          // 0 ~ 1（預設 0.85）
  similarity_boost?: number;   // 0 ~ 1（預設 0.75）
  style?: number;              // 0 ~ 1（預設 0.0）
  use_speaker_boost?: boolean;
  // ── MiniMax ──
  pitch?: number;              // -12 ~ 12（預設 0）
  // MiniMax 官方支援 7 種 emotion
  emotion?: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';
  vol?: number;                // 0.1 ~ 10（預設 1.0）
}

export interface TTSRequest {
  text: string;                    // 已經 preprocessed 的文字
  voiceId: string;                 // provider-specific voice id
  characterId?: string;            // 給 per-voice override 用
  settings?: TTSVoiceSettings;     // 角色 ttsSettings 覆蓋（優先於 PER_VOICE_OVERRIDES）
}

export interface TTSProvider {
  name: 'elevenlabs' | 'minimax';

  /**
   * 回傳 MP3 bytes 的 ReadableStream
   * - 沒有 API key / text 為空 / 呼叫失敗時回 null
   * - 上游 stream 消耗完畢代表 audio 結束
   */
  synthesizeStream(req: TTSRequest): Promise<ReadableStream<Uint8Array> | null>;
}
