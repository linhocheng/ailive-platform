/**
 * Swiss Grid — strategy HTML 第二個風格池
 * 瑞士國際字體設計風格：強網格、黑白對比、單一重點色（瑞士紅）、無裝飾。
 * 使用 component-spec 模式（非 reference HTML），prompt token 比 eastern-blank 省 ~90%。
 */

export const mode = 'spec' as const;

export const philosophyMd = String.raw`# Visual Philosophy: Swiss Grid（瑞士國際排版）

視覺語言來自 1950 年代瑞士設計師的信念：**網格即秩序，留白即呼吸，字型即表情**。沒有裝飾，沒有插圖，沒有漸層。一切靠字重對比（200 極細 vs 900 極粗）和網格分欄構成節奏。

色彩：黑（#0D0D0D）+ 白（#F5F2ED）+ 瑞士紅（#E01A24）。紅色只作強調，面積不超過 5%。禁止金色、禁止任何漸層、禁止紫色。

排版：全頁左對齊，標題不置中。字體使用 Helvetica Neue（via Google: Plus Jakarta Sans 作 fallback）+ Noto Sans TC（中文）。字重只用 200 / 400 / 700 / 900 四階，不用其他。

網格：12 欄基準。章節序號（01 / 02 / 03）用極細 200 重、巨大字號（clamp(80px, 12vw, 160px)）作版面錨點，內文縮排避開序號。

禁止：裝飾橫線、底色塊、icon 群、漸層背景、陰影、任何 border-radius > 4px（僅 tag/badge 用）。
`;

export const componentCss = String.raw`<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200;0,300;0,400;0,700;0,800;0,900;1,300&family=Noto+Sans+TC:wght@200;300;400;700;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --black:#0D0D0D;--white:#F5F2ED;--mid:#6B6B6B;--light:#D6D2CC;
  --red:#E01A24;
  --sans:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;
  --sans-zh:'Noto Sans TC',var(--sans);
  --base:clamp(15px,1.15vw,17px);
  --leading:1.75;
  --measure:68ch;
  --gap:clamp(2rem,4vw,4rem);
}
html{font-size:var(--base);color:var(--black);background:var(--white);-webkit-font-smoothing:antialiased}
body{font-family:var(--sans-zh);line-height:var(--leading);overflow-x:hidden}
a{color:inherit;text-decoration:none}

/* ── Cover ─────────────────────────────── */
.sg-cover{
  min-height:100svh;display:grid;grid-template-rows:auto 1fr auto;
  padding:clamp(2rem,5vw,5rem);border-bottom:2px solid var(--black);
}
.sg-cover__num{font-family:var(--sans);font-weight:900;font-size:clamp(14px,1.5vw,18px);letter-spacing:.2em;color:var(--mid);text-transform:uppercase}
.sg-cover__title{font-family:var(--sans-zh);font-weight:900;font-size:clamp(2.4rem,7vw,6rem);line-height:1.05;max-width:var(--measure);align-self:end}
.sg-cover__sub{font-weight:200;font-size:clamp(1rem,2vw,1.4rem);color:var(--mid);margin-top:1.5rem;max-width:55ch}
.sg-cover__meta{display:flex;gap:2rem;font-size:.8rem;font-weight:300;color:var(--mid);letter-spacing:.05em;border-top:1px solid var(--light);padding-top:1.5rem;margin-top:var(--gap)}

/* ── TOC ────────────────────────────────── */
.sg-toc{padding:var(--gap) clamp(2rem,5vw,5rem);border-bottom:2px solid var(--black)}
.sg-toc__label{font-size:.75rem;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:var(--red);margin-bottom:2rem}
.sg-toc__list{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0}
.sg-toc__item{display:flex;align-items:baseline;gap:1rem;padding:.8rem 0;border-top:1px solid var(--light);font-weight:400}
.sg-toc__idx{font-weight:900;font-size:.85rem;color:var(--red);min-width:2.5rem}
.sg-toc__name{font-size:.95rem}

/* ── Chapter rule ───────────────────────── */
.sg-rule{
  padding:var(--gap) clamp(2rem,5vw,5rem);
  display:grid;grid-template-columns:1fr auto;align-items:end;gap:2rem;
  border-top:2px solid var(--black);border-bottom:1px solid var(--light);
  background:var(--black);color:var(--white);
}
.sg-rule__num{font-weight:200;font-size:clamp(80px,12vw,160px);line-height:.85;color:var(--white);opacity:.15;font-variant-numeric:tabular-nums}
.sg-rule__title{font-weight:900;font-size:clamp(1.6rem,3.5vw,2.8rem);line-height:1.1;max-width:18ch;text-align:right}

/* ── Body block ─────────────────────────── */
.sg-body{padding:var(--gap) clamp(2rem,5vw,5rem) calc(var(--gap)*1.5);max-width:calc(var(--measure) + 10rem)}
.sg-body h3{font-weight:700;font-size:1.2rem;margin-bottom:.75rem;margin-top:2.5rem}
.sg-body p{font-weight:300;max-width:var(--measure);margin-bottom:1.2em}
.sg-body ul{padding-left:1.5rem;margin-bottom:1.2em}
.sg-body li{font-weight:300;margin-bottom:.4em}

/* ── Pull quote ─────────────────────────── */
.sg-pull{
  padding:var(--gap) clamp(2rem,5vw,5rem);
  border-left:4px solid var(--red);margin:0 clamp(2rem,5vw,5rem);
  font-weight:700;font-size:clamp(1.2rem,2.5vw,1.8rem);line-height:1.35;max-width:45ch;
}

/* ── Stat grid ──────────────────────────── */
.sg-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0;border-top:2px solid var(--black);border-bottom:1px solid var(--light);margin:0 clamp(2rem,5vw,5rem)}
.sg-stat{padding:clamp(1.5rem,3vw,2.5rem);border-right:1px solid var(--light)}
.sg-stat:last-child{border-right:none}
.sg-stat__num{font-weight:900;font-size:clamp(2.5rem,6vw,5rem);line-height:1;color:var(--red)}
.sg-stat__label{font-weight:200;font-size:.85rem;color:var(--mid);margin-top:.5rem;letter-spacing:.05em}

/* ── Two columns ────────────────────────── */
.sg-col2{display:grid;grid-template-columns:1fr 1fr;gap:2px;border-top:1px solid var(--light);margin:0 clamp(2rem,5vw,5rem)}
.sg-col2__cell{padding:clamp(1.5rem,3vw,2.5rem);border-right:1px solid var(--light)}
.sg-col2__cell:last-child{border-right:none}
.sg-col2__label{font-weight:700;font-size:.75rem;letter-spacing:.2em;text-transform:uppercase;color:var(--red);margin-bottom:1rem}
.sg-col2__body{font-weight:300;font-size:.95rem;line-height:1.65}

/* ── Timeline ───────────────────────────── */
.sg-timeline{padding:var(--gap) clamp(2rem,5vw,5rem);border-top:1px solid var(--light)}
.sg-phase{display:grid;grid-template-columns:80px 1fr;gap:1.5rem;padding:1.5rem 0;border-bottom:1px solid var(--light)}
.sg-phase__num{font-weight:900;font-size:1.5rem;color:var(--red)}
.sg-phase__title{font-weight:700;font-size:1rem;margin-bottom:.5rem}
.sg-phase__desc{font-weight:300;font-size:.9rem;color:var(--mid)}

/* ── Closing section ────────────────────── */
.sg-coda{
  min-height:60svh;display:grid;align-content:center;
  padding:clamp(3rem,8vw,8rem) clamp(2rem,5vw,5rem);
  background:var(--black);color:var(--white);
  border-top:2px solid var(--red);
}
.sg-coda__label{font-size:.75rem;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:var(--red);margin-bottom:2rem}
.sg-coda__text{font-weight:900;font-size:clamp(1.8rem,5vw,4rem);line-height:1.1;max-width:20ch;margin-bottom:2rem}
.sg-coda__sub{font-weight:200;font-size:1rem;color:#aaa;max-width:50ch}

/* ── Footer / Colophon ──────────────────── */
.sg-footer{padding:2rem clamp(2rem,5vw,5rem);border-top:1px solid var(--light);display:flex;justify-content:space-between;align-items:center;font-size:.75rem;font-weight:300;color:var(--mid)}

/* ── Reveal animation ───────────────────── */
[data-reveal]{opacity:0;transform:translateY(16px);transition:opacity .5s ease,transform .5s ease}
[data-reveal].in{opacity:1;transform:none}

@media(max-width:700px){
  .sg-col2{grid-template-columns:1fr}
  .sg-col2__cell{border-right:none;border-bottom:1px solid var(--light)}
  .sg-rule{grid-template-columns:1fr}
  .sg-rule__title{text-align:left}
}
@media print{
  [data-reveal]{opacity:1;transform:none}
  .sg-cover{min-height:auto;page-break-after:always}
}
</style>`;

export const componentSpec = `## Component Dictionary（用於生成 HTML 的結構說明）

### 必出區塊（缺一 QA 失敗）
- 'sg-cover' — 封面，第一個 section。含 'sg-cover__num'（文件標籤）、'sg-cover__title'（h1）、'sg-cover__sub'（副標題）、'sg-cover__meta'（作者/日期）
- 'sg-toc' — 目錄，封面後第二個。含 'sg-toc__label'（CONTENTS）、'sg-toc__list' 內多個 'sg-toc__item'（'sg-toc__idx' 序號 + 'sg-toc__name' 章名）
- 'sg-coda' — 結尾 section。含 'sg-coda__label'、'sg-coda__text'（核心句，大字重）、'sg-coda__sub'
- 'sg-footer' — 版尾，html 最後元素

### 章節分隔（每章第一個）
- 'sg-rule' — 黑底白字章節封面。含 'sg-rule__num'（01/02/03，font-weight:200，超大）、'sg-rule__title'（右對齊，font-weight:900）

### 正文容器
- 'sg-body' — 段落容器。內用 h3 / p / ul

### 強調組件（每章至少一個，不重複連用）
- 'sg-pull' — 金句，左紅線大字。全篇最多 2 個
- 'sg-stats' — 數字網格。含多個 'sg-stat'（'sg-stat__num' 大數 + 'sg-stat__label' 說明）
- 'sg-col2' — 兩欄對比。含兩個 'sg-col2__cell'（'sg-col2__label' + 'sg-col2__body'）
- 'sg-timeline' — 時間軸。含多個 'sg-phase'（'sg-phase__num' + 'sg-phase__title' + 'sg-phase__desc'）

### 動畫
- data-reveal 屬性 — 加在需要 scroll reveal 的元素上

### Swiss-Grid 章節節奏（依序）
每章必須按這個節奏展開，不可連續兩個 sg-body 沒有強調組件穿插：
  sg-rule → sg-body（導入段）→ 強調組件 → sg-body（展開段）→ [可選第二強調組件]

選強調組件的規則：
- 有 3 個以上數字統計 → sg-stats
- 兩件事對比（vs / 避免-瞄準）→ sg-col2
- 需要一句話概括整章核心 → sg-pull（優先放章末）
- 有時間順序 / 分階段 → sg-timeline

sg-rule 的序號必須與 sg-toc 的 idx 對齊。
`;

export const componentSkeleton = `<!-- ═══ Swiss-Grid 一章完整骨架（請依此節奏生成每章）═══ -->

<!-- 1. 章節封面：黑底，序號極細大字 + 章名右對齊粗體 -->
<section class="sg-rule" data-reveal>
  <div class="sg-rule__num">01</div>
  <h2 class="sg-rule__title">章節標題<br>第二行</h2>
</section>

<!-- 2. 導入段：帶入背景與核心論點 -->
<section class="sg-body" data-reveal>
  <h3>小節標題</h3>
  <p>導入段落，說明這章為什麼重要，引出後面的數字或對比。</p>
  <h3>第二小節</h3>
  <p>繼續展開，段落之間保持呼吸感，不要塞太滿。</p>
</section>

<!-- 3. 強調組件（此例用 sg-stats；視內容換成 sg-col2 / sg-pull / sg-timeline）-->
<div class="sg-stats" data-reveal>
  <div class="sg-stat">
    <div class="sg-stat__num">88%</div>
    <div class="sg-stat__label">指標說明</div>
  </div>
  <div class="sg-stat">
    <div class="sg-stat__num">3x</div>
    <div class="sg-stat__label">第二指標</div>
  </div>
  <div class="sg-stat">
    <div class="sg-stat__num">18mo</div>
    <div class="sg-stat__label">第三指標</div>
  </div>
</div>

<!-- 4. 展開段：深化論點，接住數字的意涵 -->
<section class="sg-body" data-reveal>
  <h3>深化說明</h3>
  <p>把上方數字的意涵說清楚，或展開三個子項目。</p>
  <ul>
    <li>項目一：說明</li>
    <li>項目二：說明</li>
    <li>項目三：說明</li>
  </ul>
</section>

<!-- 5. 可選：章末金句收尾（全篇最多 2 個 sg-pull）-->
<blockquote class="sg-pull" data-reveal>
  這章的核心主張，一句話，不超過 30 字。
</blockquote>

<!-- ═══ 下一章從新的 sg-rule 開始 ═══ -->`;
