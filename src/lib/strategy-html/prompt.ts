/**
 * strategy-html prompt builder
 *
 * 從 mdContent + 風格 PHILOSOPHY + reference HTML 組出 bridge call 的 system / user。
 * 核心信念：給完整 reference HTML 比給 abstract guidance 穩——模型擅長 structural mimicry。
 */
import * as easternBlank from './philosophies/eastern-blank';

export type PhilosophyKey = 'eastern-blank';

const PHILOSOPHIES: Record<PhilosophyKey, { md: string; html: string }> = {
  'eastern-blank': {
    md: easternBlank.philosophyMd,
    html: easternBlank.referenceHtml,
  },
};

export function loadPhilosophy(key: PhilosophyKey) {
  const p = PHILOSOPHIES[key];
  if (!p) throw new Error(`unknown philosophy key: ${key}`);
  return p;
}

export function buildSystemPrompt(philosophyKey: PhilosophyKey): string {
  const { md, html } = loadPhilosophy(philosophyKey);

  return `你是一位資深 editorial web designer，專長把策略文件轉成沉浸式長卷網頁。

# 美學心法（不可違背）

${md.trim()}

# 結構規範（嚴格）

你會收到一份 markdown 策略書原稿（5000-7000 字，含 # 主標、## 章節、### 小節、段落、列點）。
你的任務：把它重塑為一份完整 HTML 文件，使用下方 reference HTML 的視覺語言、字體系統、配色、CSS 變數、區塊組件。

# Reference HTML（請完全沿用其字體載入、CSS 變數、組件 class 命名、scroll reveal 機制）

${html}

# 寫作守則

1. **完全沿用** reference 的 :root CSS 變數（廟柱硃砂 / 草紙黃 / 夜廟青墨 / 字體 stack）、SVG 噪點背景、fixed runner、IntersectionObserver
2. **重塑內容**：原稿的 ## 章節變成 section divider（夜廟青墨整片），### 小節變成 .block，段落視內容性質選對應 layout：
   - 兩個並列數字 / 對照 → .two-stat
   - 三個並列項目 → .three-col 或 .bullets
   - 戲劇性結論 → .blank（巨大留白 + 大字級）
   - 核心主張 → .manifesto
   - 對照（避免 vs 瞄準）→ .compare
   - 多平台 / 多項目 grid → .platforms
   - 階段性 roadmap → .roadmap + .phase
   - 收尾 → .end（夜廟青墨）
3. **必出區塊**：.hero（封面）、.toc（目錄）、至少 1 個 .section-div、.end、.colophon
4. **TOC 必對齊**：目錄項目數 = 文章 ## 章節數，不多不少
5. **嚴格忌諱**（出現一個視為失敗）：
   - 任何金色（#FFD700 / #DAA520 等暖金色）
   - 標題下方裝飾橫線、底色塊、icon 群
   - Inter / Roboto / Arial / Space Grotesk 字體
   - 紫白漸層
   - 中央對稱的 hero（必左貼齊）
6. **內容處理**：
   - 標題、章節名、小節名、所有段落 → 全部從原稿萃取，可改寫成更精煉版本但不可虛構新事實
   - 列點可重組成 .bullets / .three-col
   - 數字統計突出視覺：.stat .num 用 clamp() 大字級
7. **Cormorant Garamond italic** 用於英文小標、章節序號（PART 01 / Q1）、引號裝飾
8. **長度約束**：完整 HTML 8K-15K tokens，不要超過 reference HTML 兩倍長度

# 輸出格式

直接輸出完整 HTML。第一個字元必為 <（從 <!doctype html> 開始）。
**不要**包在 \`\`\`html 代碼塊裡。
**不要**前言、不要解釋、不要後語。
**不要**輸出任何非 HTML 字元。`;
}

export function buildUserPrompt(mdContent: string, docTitle: string): string {
  return `策略書標題：${docTitle}

策略書原稿（markdown）：

${mdContent}

請依美學心法 + 結構規範，產出完整 HTML 長卷。第一個字元 <。`;
}
