/**
 * Dark Premium — strategy HTML 第三個風格池
 * 高端深色：近黑底、暖白字、冷鉑金 accent、無裝飾、強字重對比。
 * 適用：融資計劃、競爭情報、高管簡報、BD 提案。
 * 使用 component-spec 模式（省 ~90% prompt tokens）。
 */

export const mode = 'spec' as const;

export const philosophyMd = `# Visual Philosophy: Dark Premium（高端深色）

這份策略書的視覺語言來自一個信念：**最有說服力的東西，從來不喧鬧**。頂級投行的簡報、高端顧問公司的交件，都是深色底、精準的字重對比、極少的裝飾——不是因為懶，是因為這個語言本身就在說「我們對自己的內容有絕對的信心，不需要包裝」。

色彩：近黑（#0F0F0F）為底，暖白（#F0EDE8）為主文字，冷鉑金（#C8BFB0）為唯一強調色。鉑金不是金色——金色是炫耀，鉑金是克制的貴重。禁止暖金色、禁止任何漸層、禁止紫色、禁止亮色 accent。

排版：全左對齊，標題不置中。字重只用 200（極細，用於章節序號、副標）和 900（極粗，用於主標、數字）兩階，製造最大對比。字型使用 Plus Jakarta Sans + Noto Sans TC，與 swiss-grid 共用字型堆疊確保一致性。

間距哲學：大量留白，讓每個資訊呼吸。不塞滿，不急著說完所有事。章節之間有明確視覺斷點。
`;

export const componentCss = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200;0,300;0,400;0,700;0,800;0,900;1,300&family=Noto+Sans+TC:wght@200;300;400;700;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --black:#0F0F0F;--surface:#191919;--surface2:#242424;
  --white:#F0EDE8;--mid:#8A847C;--dim:#3A3A3A;
  --platinum:#C8BFB0;
  --sans:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;
  --sans-zh:'Noto Sans TC',var(--sans);
  --base:clamp(15px,1.15vw,17px);
  --leading:1.8;
  --measure:66ch;
  --gap:clamp(2.5rem,5vw,5rem);
}
html{font-size:var(--base);color:var(--white);background:var(--black);-webkit-font-smoothing:antialiased}
body{font-family:var(--sans-zh);line-height:var(--leading);overflow-x:hidden}
a{color:inherit;text-decoration:none}

/* ── Cover ──────────────────────────────── */
.dp-cover{
  min-height:100svh;display:grid;grid-template-rows:auto 1fr auto;
  padding:clamp(2.5rem,6vw,6rem);border-bottom:1px solid var(--dim);
}
.dp-cover__eyebrow{font-weight:200;font-size:clamp(11px,1.2vw,13px);letter-spacing:.3em;text-transform:uppercase;color:var(--platinum)}
.dp-cover__title{font-weight:900;font-size:clamp(2.6rem,8vw,7rem);line-height:1;max-width:16ch;align-self:end;color:var(--white)}
.dp-cover__sub{font-weight:200;font-size:clamp(1rem,2vw,1.35rem);color:var(--mid);margin-top:2rem;max-width:52ch}
.dp-cover__meta{display:flex;gap:3rem;font-size:.75rem;font-weight:200;color:var(--mid);letter-spacing:.08em;border-top:1px solid var(--dim);padding-top:1.5rem;margin-top:var(--gap)}

/* ── TOC ────────────────────────────────── */
.dp-toc{padding:var(--gap) clamp(2.5rem,6vw,6rem);border-bottom:1px solid var(--dim)}
.dp-toc__label{font-size:.7rem;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--platinum);margin-bottom:2.5rem}
.dp-toc__list{list-style:none}
.dp-toc__item{display:grid;grid-template-columns:3rem 1fr auto;align-items:baseline;padding:1rem 0;border-top:1px solid var(--dim);font-weight:300}
.dp-toc__idx{font-weight:200;font-size:.8rem;color:var(--platinum)}
.dp-toc__name{font-size:.95rem;color:var(--white)}
.dp-toc__dots{border-bottom:1px dotted var(--dim);margin:0 1rem;align-self:center;height:1px;flex:1}

/* ── Chapter rule ───────────────────────── */
.dp-chapter{
  padding:var(--gap) clamp(2.5rem,6vw,6rem);
  background:var(--surface);border-top:1px solid var(--platinum);border-bottom:1px solid var(--dim);
}
.dp-chapter__num{font-weight:200;font-size:clamp(70px,11vw,140px);line-height:.85;color:var(--dim);font-variant-numeric:tabular-nums;margin-bottom:1rem}
.dp-chapter__title{font-weight:900;font-size:clamp(1.8rem,4vw,3.2rem);line-height:1.05;max-width:20ch;color:var(--white)}
.dp-chapter__sub{font-weight:200;font-size:1rem;color:var(--mid);margin-top:1rem;max-width:45ch}

/* ── Body ───────────────────────────────── */
.dp-body{padding:var(--gap) clamp(2.5rem,6vw,6rem) calc(var(--gap)*1.2);max-width:calc(var(--measure) + 10rem)}
.dp-body h3{font-weight:700;font-size:1.05rem;color:var(--platinum);letter-spacing:.04em;margin-bottom:.75rem;margin-top:2.5rem;text-transform:uppercase}
.dp-body p{font-weight:300;max-width:var(--measure);margin-bottom:1.2em;color:#D8D4CE}
.dp-body ul{padding-left:1.5rem;margin-bottom:1.2em}
.dp-body li{font-weight:300;margin-bottom:.4em;color:#D8D4CE}

/* ── Pull quote ─────────────────────────── */
.dp-pull{
  padding:var(--gap) clamp(2.5rem,6vw,6rem);
  border-top:1px solid var(--platinum);border-bottom:1px solid var(--dim);
  font-weight:900;font-size:clamp(1.4rem,3vw,2.4rem);line-height:1.2;max-width:30ch;
  color:var(--white);
}

/* ── Stats ──────────────────────────────── */
.dp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0;border-top:1px solid var(--dim);border-bottom:1px solid var(--dim);background:var(--surface)}
.dp-stat{padding:clamp(2rem,3.5vw,3rem) clamp(2.5rem,6vw,6rem);border-right:1px solid var(--dim)}
.dp-stat:last-child{border-right:none}
.dp-stat__num{font-weight:900;font-size:clamp(2.8rem,7vw,5.5rem);line-height:1;color:var(--platinum)}
.dp-stat__label{font-weight:200;font-size:.8rem;color:var(--mid);margin-top:.75rem;letter-spacing:.06em;text-transform:uppercase}

/* ── Two columns ────────────────────────── */
.dp-col2{display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--dim);background:var(--surface)}
.dp-col2__cell{padding:clamp(2rem,3.5vw,3rem) clamp(2.5rem,6vw,6rem);border-right:1px solid var(--dim)}
.dp-col2__cell:last-child{border-right:none}
.dp-col2__label{font-weight:700;font-size:.7rem;letter-spacing:.25em;text-transform:uppercase;color:var(--platinum);margin-bottom:1.2rem}
.dp-col2__body{font-weight:300;font-size:.95rem;line-height:1.7;color:#D8D4CE}

/* ── Timeline ───────────────────────────── */
.dp-timeline{padding:var(--gap) clamp(2.5rem,6vw,6rem);border-top:1px solid var(--dim)}
.dp-phase{display:grid;grid-template-columns:5rem 1fr;gap:2rem;padding:1.5rem 0;border-bottom:1px solid var(--dim)}
.dp-phase__num{font-weight:900;font-size:1.2rem;color:var(--platinum)}
.dp-phase__title{font-weight:700;font-size:.95rem;color:var(--white);margin-bottom:.5rem;letter-spacing:.03em}
.dp-phase__desc{font-weight:200;font-size:.875rem;color:var(--mid);line-height:1.65}

/* ── Closing ────────────────────────────── */
.dp-coda{
  min-height:55svh;display:grid;align-content:center;
  padding:clamp(3rem,8vw,8rem) clamp(2.5rem,6vw,6rem);
  border-top:1px solid var(--platinum);
}
.dp-coda__label{font-size:.7rem;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--platinum);margin-bottom:2.5rem}
.dp-coda__text{font-weight:900;font-size:clamp(2rem,5.5vw,4.5rem);line-height:1.05;max-width:18ch;color:var(--white);margin-bottom:2rem}
.dp-coda__sub{font-weight:200;font-size:1rem;color:var(--mid);max-width:48ch}

/* ── Footer ─────────────────────────────── */
.dp-foot{padding:2rem clamp(2.5rem,6vw,6rem);border-top:1px solid var(--dim);display:flex;justify-content:space-between;align-items:center;font-size:.7rem;font-weight:200;color:var(--mid);letter-spacing:.06em}

/* ── Reveal ─────────────────────────────── */
[data-reveal]{opacity:0;transform:translateY(12px);transition:opacity .5s ease,transform .5s ease}
[data-reveal].in{opacity:1;transform:none}

@media(max-width:700px){
  .dp-col2{grid-template-columns:1fr}
  .dp-col2__cell{border-right:none;border-bottom:1px solid var(--dim)}
  .dp-chapter{grid-template-columns:1fr}
}
@media print{
  [data-reveal]{opacity:1;transform:none}
  body{background:#fff;color:#000}
}
</style>`;

export const componentSpec = `## Component Dictionary（Dark Premium）

### 必出區塊（缺一 QA 失敗）
- 'dp-cover' — 封面。含 'dp-cover__eyebrow'（文件類型）、'dp-cover__title'（h1，極粗大）、'dp-cover__sub'（副標題，極細）、'dp-cover__meta'（作者/日期）
- 'dp-toc' — 目錄。含 'dp-toc__label'（CONTENTS）、'dp-toc__list' 內多個 'dp-toc__item'（'dp-toc__idx' 序號 + 'dp-toc__name' 章名）
- 'dp-coda' — 結尾。含 'dp-coda__label'、'dp-coda__text'（核心句，極粗）、'dp-coda__sub'
- 'dp-foot' — 版尾，html 最後元素

### 章節分隔（每章第一個）
- 'dp-chapter' — 章節封面，深色底鉑金頂線。含 'dp-chapter__num'（01/02/03，極細超大）、'dp-chapter__title'（極粗）、'dp-chapter__sub'（可選，極細說明）

### 正文容器
- 'dp-body' — 段落容器。h3 用鉑金色全大寫，p/li 用暖白淡色

### 強調組件（每章至少一個）
- 'dp-pull' — 金句，頂線鉑金，大字重白色。全篇最多 2 個
- 'dp-stats' — 數字網格深色底。含多個 'dp-stat'（'dp-stat__num' 鉑金大數 + 'dp-stat__label' 全大寫說明）
- 'dp-col2' — 兩欄對比深色底。含兩個 'dp-col2__cell'（'dp-col2__label' + 'dp-col2__body'）
- 'dp-timeline' — 時間軸。含多個 'dp-phase'（'dp-phase__num' 鉑金 + 'dp-phase__title' + 'dp-phase__desc'）

### 動畫
- data-reveal 屬性 — 加在需要 scroll reveal 的元素上

### Dark-Premium 章節節奏（依序）
每章節奏：dp-chapter → dp-body（導入）→ 強調組件 → dp-body（展開）→ [可選第二強調]

選強調組件規則：
- 有數字指標 → dp-stats
- 兩件事對比（現況 vs 目標 / 威脅 vs 機會）→ dp-col2
- 核心論點金句 → dp-pull（優先放章末）
- 有時程/分階段 → dp-timeline

dp-chapter 序號必須與 dp-toc idx 一一對齊。
`;

export const componentSkeleton = `<!-- ═══ Dark Premium 一章完整骨架 ═══ -->

<!-- 1. 章節封面：深色底，頂鉑金線，序號極細超大，標題極粗 -->
<section class="dp-chapter" data-reveal>
  <div class="dp-chapter__num">01</div>
  <h2 class="dp-chapter__title">章節標題</h2>
  <p class="dp-chapter__sub">一句話說明這章要解決的問題</p>
</section>

<!-- 2. 導入段：帶入背景，提出問題 -->
<section class="dp-body" data-reveal>
  <h3>BACKGROUND</h3>
  <p>導入段落，說明現況與挑戰。字色偏暗白，h3 全大寫鉑金。</p>
  <h3>CORE CHALLENGE</h3>
  <p>核心問題所在，引出後面的數字或對比。</p>
</section>

<!-- 3. 強調組件（此例用 dp-stats；視內容換 dp-col2 / dp-pull / dp-timeline）-->
<div class="dp-stats" data-reveal>
  <div class="dp-stat">
    <div class="dp-stat__num">$2.4B</div>
    <div class="dp-stat__label">MARKET SIZE</div>
  </div>
  <div class="dp-stat">
    <div class="dp-stat__num">34%</div>
    <div class="dp-stat__label">YOY GROWTH</div>
  </div>
  <div class="dp-stat">
    <div class="dp-stat__num">18mo</div>
    <div class="dp-stat__label">WINDOW</div>
  </div>
</div>

<!-- 4. 展開段：深化論點 -->
<section class="dp-body" data-reveal>
  <h3>STRATEGIC IMPLICATION</h3>
  <p>把上方數字的意涵展開，說明為什麼這對本策略至關重要。</p>
  <ul>
    <li>關鍵點一</li>
    <li>關鍵點二</li>
  </ul>
</section>

<!-- 5. 可選：章末金句（全篇最多 2 個）-->
<blockquote class="dp-pull" data-reveal>
  這章最有力的一個論點，不超過 25 字，像判斷不像描述。
</blockquote>

<!-- ═══ 下一章從新的 dp-chapter 開始 ═══ -->`;
