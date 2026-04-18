/**
 * TTS Provider 介面
 *
 * 所有 provider 都必須實作這個介面。
 * 輸出統一為 MP3 bytes 的 ReadableStream<Uint8Array>，
 * 前端消費方不需要關心底層是 ElevenLabs 還是 MiniMax。
 */
export interface TTSRequest {
  text: string;              // 已經 preprocessed 的文字
  voiceId: string;           // provider-specific voice id
  characterId?: string;      // 給 per-voice override 用
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
