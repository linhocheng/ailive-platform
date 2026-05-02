/**
 * LLM Router — 變檔器
 *
 * 規則引擎判斷對話複雜度，自動選模型。
 * 零 AI 呼叫，本地執行，0ms 延遲，$0 成本。
 *
 * 一檔（Haiku）：閒聊、問候、情緒陪伴
 * 二檔（Sonnet）：產品知識、工具呼叫、創作、推理
 *
 * 未來加 Gemini 只改這一個檔案。
 */

export type ModelGear = 'haiku' | 'sonnet';

export const MODELS: Record<ModelGear, string> = {
  haiku:  'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
};

// Sonnet 觸發條件（命中任何一條 → 升檔）
const SONNET_PATTERNS = [
  // 任務型
  /寫|發文|草稿|生圖|幫我|幫忙|協助|處理|完成|製作|建立|新增|修改|更新/,
  // 查詢型
  /查|搜尋|找|告訴我|介紹|說明|解釋|分析|比較|推薦|建議/,
  // 記憶型
  /記住|記得|存起來|記錄/,
  // 排程型
  /排程|任務|幾點|幾號|幾月|計畫|安排/,
  // 產品型（AVIVA 產品關鍵字）
  /卸妝|保濕|精華|慕斯|化妝水|凝霜|防曬|面膜|成分|功效|適合|使用/,
  // 推理型
  /為什麼|怎麼|如何|哪個|哪種|多少|什麼時候|有沒有|可不可以|會不會/,
  // 圖片型
  /圖片|照片|URL|url|連結|看圖|生圖/,
];

// 強制 Haiku 的模式（命中 → 不管其他條件都用 Haiku）
const HAIKU_FORCE_PATTERNS = [
  /^(嗨|hi|hello|你好|哈囉|早|晚安|再見|掰掰|謝謝|感謝|好的|ok|OK|了解|知道了)[。！？…!?]*$/i,
];

// 強制 Sonnet 的關鍵字（天條）：使用者明確表示要認真處理 → 一律 Sonnet
// 這是「顯式意圖通道」——不靠 patterns 猜，讓 Adam 自己決定。
// 「認真」是唯一的天條關鍵字，簡單、不歧義、口語自然。
const SONNET_FORCE_PATTERNS = [
  /認真/,
];

/**
 * 偵測對話複雜度，回傳建議模型
 * @param message 用戶訊息
 * @param conversationTurns 目前對話輪數（新對話較保守）
 */
// Max 吃到飽後無需變檔，統一 Sonnet
export function detectGear(
  _message: string,
  _conversationTurns = 0,
): ModelGear {
  return 'sonnet';
}

/**
 * 取得對應的 max_tokens
 * 兩檔/兩種場景統一 8192：與江彬端對齊（不對 token 設硬限制）。
 * 模型自然會在合適位置收尾，靠變檔器與 system prompt 控制長度感。
 */
export function getMaxTokens(_gear: ModelGear, _isVoice = false): number {
  return 8192;
}
