/**
 * tts-preprocess/core.ts
 * 兩家 TTS provider 共用：型別、helper、清理函式、中台用語字典
 */

// ===== 規則 metadata 型別 =====
export type Strategy = 'phonetic' | 'semantic';
export type Provider = 'elevenlabs' | 'minimax' | 'all';

export type RuleEntry = {
  replacement: string;
  strategy: Strategy;
  reason: string;        // 為何替換
  provider: Provider;    // 預設 'all'
  addedAt: string;       // YYYY-MM-DD
  notes?: string;
};

// preprocessTTS 第二參：log context（純 metadata，不影響行為）
export type PreprocessLogContext = {
  route?: 'tts' | 'voice-stream' | string;
  provider?: Provider;
  characterId?: string;
};

export type Hit = {
  original: string;
  replacement: string;
  strategy: Strategy;
  map: 'zh_tw' | 'pronunciation';
};

// ===== rule helper（縮短條目寫法）=====
export function p(replacement: string, reason: string, addedAt = '2026-04-05', notes?: string): RuleEntry {
  return { replacement, strategy: 'phonetic', reason, provider: 'all', addedAt, ...(notes ? { notes } : {}) };
}
export function s(replacement: string, reason = '中台用語→繁台用語', addedAt = '2026-04-05'): RuleEntry {
  return { replacement, strategy: 'semantic', reason, provider: 'all', addedAt };
}

// ===== 中台用語字典（兩家 provider 共用）=====
export const ZH_TW_MAP: Record<string, RuleEntry> = {
  // 影音
  '短視頻': s('短影音'), '視頻': s('影片'),
  // 網路
  '互聯網': s('網際網路'), '信息': s('資訊'), '網絡': s('網路'), '在線': s('線上'),
  '博客': s('部落格'), '超鏈接': s('超連結'), '鏈接': s('連結'),
  '搜索引擎': s('搜尋引擎'), '搜索': s('搜尋'),
  // 軟硬體
  '軟件': s('軟體'), '硬件': s('硬體'), '數據庫': s('資料庫'), '算法': s('演算法'),
  '概率': s('機率'), '編程': s('程式設計'), '源代碼': s('原始碼'), '代碼': s('程式碼'),
  '程序': s('程式'), '開源': s('開放原始碼'), '模塊': s('模組'), '組件': s('元件'),
  '插件': s('外掛程式'), '擴展': s('擴充功能'),
  // 硬體周邊
  '鼠標': s('滑鼠'), '打印機': s('印表機'), '打印': s('列印'), '內存': s('記憶體'),
  '硬盤': s('硬碟'), '光盤': s('光碟'), '屏幕': s('螢幕'), '端口': s('連接埠'),
  '帶寬': s('頻寬'), '內置': s('內建'), '外置': s('外接'),
  // 系統操作
  '文件夾': s('資料夾'), '文件': s('檔案'), '菜單': s('選單'), '界面': s('介面'),
  '用戶': s('使用者'), '服務器': s('伺服器'), '默認': s('預設'), '兼容': s('相容'),
  '字符': s('字元'), '緩存': s('快取'), '設置': s('設定'), '配置': s('設定'),
  '運行': s('執行'), '卸載': s('解除安裝'), '重啟': s('重新啟動'),
  '窗口': s('視窗'), '標簽': s('分頁'), '書簽': s('書籤'), '收藏': s('我的最愛'),
  '歷史記錄': s('瀏覽記錄'), '快捷鍵': s('快速鍵'),
  '保存': s('儲存'), '另存為': s('另存新檔'), '粘貼': s('貼上'),
  '復制': s('複製'), '剪切': s('剪下'),
  // 行動/社群
  '移動端': s('行動裝置'), '手機端': s('手機版'),
  '支持': s('支援'), '反饋': s('回饋'), '激活': s('啟用'),
  '登錄': s('登入'), '退出': s('登出'),
  // 數位/媒體
  '數碼': s('數位'), '模擬': s('類比'), '分辨率': s('解析度'),
  '幀率': s('影格率'), '碼率': s('位元率'),
  // 資安
  '殺毒': s('防毒'), '黑客': s('駭客'), '賬號': s('帳號'), '賬戶': s('帳戶'),
  // 網路協定
  '協議': s('通訊協定'),
  // 文字
  '文本': s('文字'), '優化': s('最佳化'), '性能': s('效能'),
};

// ===== 非規則的清理（思考標籤、Markdown、URL）— 兩家共用 =====
export function stripCleanup(text: string): string {
  let r = text;
  // LLM 思考洩漏清除（放最前面：思考內容可能含 markdown，要先刪才不會誤處理）
  r = r.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');  // Anthropic/Claude 風格
  r = r.replace(/<think>[\s\S]*?<\/think>/gi, '');         // DeepSeek 風格
  r = r.replace(/（\s*(?:思考|thinking)[：:][\s\S]*?）/gi, ''); // 全形括號
  r = r.replace(/\(\s*(?:思考|thinking)[：:][\s\S]*?\)/gi, ''); // 半形括號
  // Markdown
  r = r.replace(/\*\*(.+?)\*\*/g, '$1');
  r = r.replace(/\*(.+?)\*/g, '$1');
  r = r.replace(/^#{1,3}\s*/gm, '');
  r = r.replace(/^[-•·]\s*/gm, '');
  r = r.replace(/`[^`]+`/g, '');
  r = r.replace(/!\[(?:圖片|image|img|photo)?\]\([^)]+\)/gi, '');  // ![圖片](url) → 刪除
  r = r.replace(/!\[([^\]]*?)\]\([^)]+\)/g, '$1');   // ![alt](url) → alt
  r = r.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');      // [text](url) → text
  // URL
  r = r.replace(/https?:\/\/[^\s，。！？、）)]+/g, '');
  r = r.replace(/IMAGE_URL:[^\s]+/g, '');
  return r;
}
