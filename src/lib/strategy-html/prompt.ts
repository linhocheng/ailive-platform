/**
 * strategy-html prompt builder
 *
 * 兩種 philosophy 模式：
 *   reference — 給完整 reference HTML，模型做 structural mimicry（eastern-blank）
 *   spec      — 給緊湊 CSS token + component 字典，省 ~90% prompt tokens（swiss-grid）
 */
import * as easternBlank from './philosophies/eastern-blank';
import * as swissGrid from './philosophies/swiss-grid';
import * as darkPremium from './philosophies/dark-premium';

export type PhilosophyKey = 'eastern-blank' | 'swiss-grid' | 'dark-premium';

type ReferencePhilosophy = { mode: 'reference'; philosophyMd: string; referenceHtml: string };
type SpecPhilosophy = { mode: 'spec'; philosophyMd: string; componentCss: string; componentSpec: string; componentSkeleton: string };
type PhilosophyEntry = ReferencePhilosophy | SpecPhilosophy;

const PHILOSOPHIES: Record<PhilosophyKey, PhilosophyEntry> = {
  'eastern-blank': {
    mode: 'reference',
    philosophyMd: easternBlank.philosophyMd,
    referenceHtml: easternBlank.referenceHtml,
  },
  'swiss-grid': {
    mode: 'spec',
    philosophyMd: swissGrid.philosophyMd,
    componentCss: swissGrid.componentCss,
    componentSpec: swissGrid.componentSpec,
    componentSkeleton: swissGrid.componentSkeleton,
  },
  'dark-premium': {
    mode: 'spec',
    philosophyMd: darkPremium.philosophyMd,
    componentCss: darkPremium.componentCss,
    componentSpec: darkPremium.componentSpec,
    componentSkeleton: darkPremium.componentSkeleton,
  },
};

export function loadPhilosophy(key: PhilosophyKey): PhilosophyEntry {
  const p = PHILOSOPHIES[key];
  if (!p) throw new Error(`unknown philosophy key: ${key}`);
  return p;
}

export function buildSystemPrompt(philosophyKey: PhilosophyKey): string {
  const p = loadPhilosophy(philosophyKey);

  if (p.mode === 'reference') {
    return `你是一位資深 editorial web designer，專長把策略文件轉成沉浸式長卷網頁。

# 美學心法（不可違背）

${p.philosophyMd.trim()}

# 結構規範（嚴格）

你會收到一份 markdown 策略書原稿（5000-7000 字，含 # 主標、## 章節、### 小節、段落、列點）。
你的任務：把它重塑為一份完整 HTML 文件，使用下方 reference HTML 的視覺語言、字體系統、配色、CSS 變數、區塊組件。

# Reference HTML（請完全沿用其字體載入、CSS 變數、組件 class 命名、scroll reveal 機制）

${p.referenceHtml}

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
8. **長度約束（硬門檻）**：完整 HTML 控制在 30KB-45KB 之間（含 CSS 與內容）；output token 預算 16000，**必須留收尾空間給 </body></html>**。精簡優先，不要為了塞滿 layout 而灌水字。CSS 變數區整段沿用、不要重寫。

# 輸出格式

直接輸出完整 HTML。第一個字元必為 <（從 <!doctype html> 開始）。
**不要**包在 \`\`\`html 代碼塊裡。
**不要**前言、不要解釋、不要後語。
**不要**輸出任何非 HTML 字元。`;
  }

  // mode === 'spec'
  return `你是一位資深 editorial web designer，專長把策略文件轉成沉浸式長卷網頁。

# 美學心法（不可違背）

${p.philosophyMd.trim()}

# 任務

你會收到一份 markdown 策略書原稿（5000-7000 字，含 # 主標、## 章節、### 小節、段落、列點）。
你的任務：產出一份**完整** HTML 文件，使用下方提供的 CSS 樣式表與組件字典。

# CSS 樣式表（完整貼入 <head>，不要修改）

${p.componentCss}

# 組件字典與章節節奏

${p.componentSpec.trim()}

# 章節骨架範例（每章請依此節奏，不是複製內容，是複製結構）

${p.componentSkeleton.trim()}

# 通用設計節奏原則（所有 spec 風格共用）

1. **呼吸法則**：正文容器不可連續出現 2 個以上，之間必須插入強調組件或章節分隔。
2. **重量分配**：每頁視覺重量要有輕（sg-body）有重（sg-rule / sg-stats / sg-coda），不允許全篇只有 sg-body。
3. **錨點法則**：每章的強調組件選完後，確認它「回答了」前一個 sg-body 提出的問題（sg-body 提問 → 強調組件給答案）。
4. **收尾法則**：sg-coda 的 sg-coda__text 必須是全篇最有力的一句話，不是摘要，是召喚。
5. **TOC 先寫**：動筆前先確認 ## 章節數，sg-toc__item 數量與 sg-rule__num 序號必須一一對應。

# 寫作守則

1. **<head> 必須完整**：把上方 CSS 樣式表（含 <link> 字體 + <style> 標籤）原封不動貼進 <head>
2. **必出區塊**：sg-cover、sg-toc、至少 2 個 sg-rule、sg-coda、sg-footer
3. **嚴格忌諱**（出現一個視為失敗）：
   - 任何金色（#FFD700 / #DAA520 等）
   - 漸層背景（background: linear-gradient）
   - 置中標題（text-align: center 用在 h1/h2）
   - 行內 style 屬性覆蓋 CSS 變數顏色
4. **內容**：從原稿萃取，可精煉但不虛構新事實
5. **動畫**：重要 section 加 data-reveal 屬性；<body> 結尾加 IntersectionObserver script：
   <script>
   const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{rootMargin:'0px 0px -10% 0px',threshold:0.05});
   document.querySelectorAll('[data-reveal]').forEach(el=>io.observe(el));
   </script>
6. **長度約束（硬門檻）**：output token 預算 16000，**最後一定要寫到 </body></html>**。精簡優先。

# 輸出格式

直接輸出完整 HTML。第一個字元必為 <（從 <!doctype html> 開始）。
不要包在代碼塊裡。不要前言、不要解釋、不要後語。不要輸出任何非 HTML 字元。`;
}

export function buildUserPrompt(mdContent: string, docTitle: string): string {
  return `策略書標題：${docTitle}

策略書原稿（markdown）：

${mdContent}

請依美學心法 + 結構規範，產出完整 HTML 長卷。
**輸出長度目標 20-35KB**（output token 上限 16000，**最後一定要寫到 </body></html> 收尾**，否則 QA 失敗）。
第一個字元 <。`;
}
