/**
 * Eastern Negative Space — strategy HTML 第一個風格池
 * Source: /tmp/zhu-pptx-test/{PHILOSOPHY.md, strategy.html}
 * Inlined as ts module so Vercel lambda bundle ships them without fs/tracing config.
 */

export const philosophyMd = String.raw`# Visual Philosophy: 東方間白（Eastern Negative Space）

這份簡報的視覺語言來自一個悖論：**宮廟最熱鬧的時刻，靠的是天井那塊安靜的天**。台灣宮廟建築裡，藻井、天井、廊道都不是裝飾，是讓眼睛能呼吸的「間白」。沒有間白，香爐的煙就無處去；沒有靜默，神明的回應就聽不見。這份策略書講的是用現代語言詮釋東方靈性，視覺要對上這個命題——不是把宮廟的硃砂紅貼上去就完事，而是用空間留白本身去傳達「這個品牌不喧鬧」。

色彩採取 **減法主義**。主色定一個：**廟柱硃砂**（#B8252B，不是亮紅、是被歲月燒過的深紅）。襯色一個：**草紙黃**（#F4EBD0，是經卷與符紙未拆封時的那種黃）。深色一個：**夜廟青墨**（#1B2832，不是純黑，是廟頂瓦片在月光下的灰藍黑）。其他全部用煙灰過渡。**不放金色**——金色一出現就立刻變成廉價靈性飾品店的調性，這是這份品牌最該避開的陷阱。

排版上採取 **不對稱配重**。標題向左貼齊，永遠不置中（置中是企業簡報的反射動作，這份不是企業簡報）。每一頁的視覺重心放在左下或右上，留出對角線的呼吸區。內文段落只用兩個字級：標題 32pt、內文 16pt，中間沒有過渡尺寸；過渡靠空間距離不靠字級漸變。**絕對禁止在標題下方放裝飾橫線、底色塊、icon 群——那是 AI 投影片的通用指紋**。需要分隔時用 1.5 倍行距的純空白。

設計命題只有一個：**讓每一張投影片像一頁宣紙，不是像一張 PPT**。讀者翻過時應該感覺到這份策略書不是急著告訴你什麼，而是把空間讓給你想。每一張視覺元素 ≤ 3 個（標題、內容、可選的一個強調符號），多了就拿掉。typography 是主角，色彩是襯底，留白是結構。
`;

export const referenceHtml = String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>東方靈性數位媒體 — 市場行銷策略書</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,500;0,700;1,400;1,500&family=Noto+Sans+TC:wght@200;400;500&family=Noto+Serif+TC:wght@200;300;500;700;900&display=swap" rel="stylesheet">
<style>
  /* ==========================================================
     東方間白 · Eastern Negative Space
     editorial long-scroll, not a deck, not a webpage — a 宣紙卷
     ========================================================== */

  :root{
    --vermillion: #B8252B;       /* 廟柱硃砂 */
    --paper:      #F4EBD0;       /* 草紙黃 */
    --ink:        #1B2832;       /* 夜廟青墨 */
    --ash:        #6B6258;       /* 香灰 */
    --paper-deep: #E8DDB8;       /* 紙的陰影 */
    --hairline:   rgba(27,40,50,.18);
    --serif: "Noto Serif TC", "Source Han Serif TC", "PingFang TC", serif;
    --sans:  "Noto Sans TC", "PingFang TC", sans-serif;
    --en:    "Cormorant Garamond", "EB Garamond", "Times New Roman", serif;
  }

  *,*::before,*::after{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{
    font-family: var(--serif);
    color: var(--ink);
    background: var(--paper);
    background-image:
      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.10  0 0 0 0 0.16  0 0 0 0 0.20  0 0 0 0.05 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    background-size: 320px 320px;
    line-height: 1.85;
    font-feature-settings: "palt";
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  ::selection{ background: var(--vermillion); color: var(--paper); }

  /* layout shell — 12-col asymmetric grid, generous gutters */
  .page{
    max-width: 1280px;
    margin: 0 auto;
    padding: 0 6vw;
  }
  .grid{
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 28px;
  }

  /* ──────────────── corner runner — vertical title strip ──────────────── */
  .runner{
    position: fixed; top: 0; left: 0; height: 100vh;
    width: 56px;
    display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    padding: 28px 0;
    border-right: 1px solid var(--hairline);
    background: rgba(244,235,208,.55);
    backdrop-filter: blur(2px);
    z-index: 50;
    font-family: var(--sans);
    font-size: 11px; letter-spacing: .35em; color: var(--ash);
  }
  .runner .v{
    writing-mode: vertical-rl;
    text-orientation: mixed;
    letter-spacing: .8em;
  }
  .runner .stamp{
    width: 28px; height: 28px;
    border: 1px solid var(--vermillion);
    color: var(--vermillion);
    font-family: var(--en);
    font-style: italic;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px;
  }

  body{ padding-left: 56px; }

  /* ──────────────── hero / cover ──────────────── */
  .hero{
    min-height: 100vh;
    display: grid;
    grid-template-columns: 1fr;
    align-items: end;
    padding: 0 6vw 8vh;
    position: relative;
  }
  .hero::before{
    content: "";
    position: absolute; top: 0; right: 0;
    width: 38vw; height: 100vh;
    background:
      linear-gradient(180deg, transparent 0%, rgba(184,37,43,.08) 35%, transparent 100%);
    pointer-events: none;
  }
  .hero-meta{
    display: flex; gap: 28px;
    font-family: var(--sans);
    font-size: 12px; letter-spacing: .35em; color: var(--ash);
    margin-bottom: 10vh;
    padding-top: 8vh;
  }
  .hero-meta span{ position: relative; padding-right: 28px; }
  .hero-meta span::after{
    content: ""; position: absolute; right: 0; top: 50%;
    width: 14px; height: 1px; background: var(--ash);
  }
  .hero-meta span:last-child::after{ display: none; }

  .hero h1{
    font-family: var(--serif);
    font-weight: 900;
    font-size: clamp(56px, 9.5vw, 168px);
    line-height: .95;
    letter-spacing: .02em;
    margin: 0 0 24px;
    color: var(--ink);
  }
  .hero h1 em{
    font-family: var(--en);
    font-style: italic;
    font-weight: 500;
    color: var(--vermillion);
    font-size: .55em;
    letter-spacing: .02em;
    margin-left: .3em;
    vertical-align: .2em;
  }
  .hero .sub{
    font-size: clamp(18px, 1.6vw, 26px);
    color: var(--ash);
    max-width: 720px;
    margin: 0 0 80px;
    font-weight: 300;
    letter-spacing: .04em;
  }
  .hero .tag{
    font-family: var(--serif);
    font-weight: 200;
    font-size: clamp(20px, 2.2vw, 32px);
    color: var(--ink);
    border-top: 1px solid var(--ink);
    padding-top: 32px;
    max-width: 760px;
    line-height: 1.5;
  }
  .hero .footer{
    margin-top: 80px;
    font-family: var(--sans);
    font-size: 11px; letter-spacing: .25em; color: var(--ash);
    display: flex; justify-content: space-between; align-items: baseline;
    border-top: 1px solid var(--hairline);
    padding-top: 20px;
  }
  .hero .footer .right{
    font-family: var(--en);
    font-style: italic;
    letter-spacing: .05em;
    font-size: 16px;
    color: var(--vermillion);
  }

  /* ──────────────── TOC ──────────────── */
  .toc{
    padding: 18vh 6vw;
    border-top: 1px solid var(--hairline);
  }
  .toc-head{
    display: grid; grid-template-columns: 1fr 2fr;
    gap: 60px;
    margin-bottom: 80px;
  }
  .toc-head .label{
    font-family: var(--en); font-style: italic;
    font-size: 18px; color: var(--vermillion);
    letter-spacing: .05em;
  }
  .toc-head h2{
    font-family: var(--serif); font-weight: 700;
    font-size: clamp(40px, 5vw, 72px);
    line-height: 1.05; margin: 0;
    letter-spacing: .04em;
  }
  .toc-list{
    list-style: none; margin: 0; padding: 0;
    border-top: 1px solid var(--ink);
  }
  .toc-list li{
    display: grid;
    grid-template-columns: 80px 1fr 200px 60px;
    gap: 32px;
    align-items: baseline;
    padding: 28px 0;
    border-bottom: 1px solid var(--hairline);
    font-size: 16px;
    transition: background .25s ease;
  }
  .toc-list li:hover{ background: rgba(184,37,43,.04); }
  .toc-list .num{
    font-family: var(--en); font-style: italic;
    font-size: 28px; color: var(--vermillion);
    letter-spacing: .03em;
  }
  .toc-list .ch{
    font-family: var(--serif); font-weight: 500;
    font-size: 24px; letter-spacing: .12em;
  }
  .toc-list .en{
    font-family: var(--en); font-style: italic;
    font-size: 18px; color: var(--ash);
    letter-spacing: .08em;
  }
  .toc-list .arrow{
    font-family: var(--en); color: var(--ink);
    text-align: right; font-size: 18px;
  }

  /* ──────────────── section divider — full bleed dark ──────────────── */
  .section-div{
    background: var(--ink);
    color: var(--paper);
    padding: 22vh 6vw;
    margin: 14vh 0 0;
    position: relative;
    overflow: hidden;
  }
  .section-div::before{
    content: attr(data-no);
    position: absolute;
    top: 8vh; right: 6vw;
    font-family: var(--en);
    font-style: italic;
    font-weight: 300;
    font-size: clamp(140px, 22vw, 360px);
    line-height: 1;
    color: rgba(244,235,208,.06);
    pointer-events: none;
    user-select: none;
  }
  .section-div .kicker{
    font-family: var(--sans);
    font-size: 12px; letter-spacing: .5em;
    color: var(--vermillion);
    margin-bottom: 40px;
    text-transform: uppercase;
  }
  .section-div h3{
    font-family: var(--serif); font-weight: 700;
    font-size: clamp(48px, 7vw, 108px);
    line-height: 1.05;
    letter-spacing: .04em;
    margin: 0 0 32px;
    max-width: 16ch;
  }
  .section-div .sub{
    font-family: var(--serif);
    font-weight: 200;
    font-size: clamp(18px, 1.8vw, 26px);
    color: rgba(244,235,208,.7);
    max-width: 36ch;
    line-height: 1.6;
    border-left: 2px solid var(--vermillion);
    padding-left: 24px;
  }

  /* ──────────────── content blocks ──────────────── */
  .block{
    padding: 18vh 6vw;
    border-top: 1px solid var(--hairline);
  }
  .block .eyebrow{
    font-family: var(--en); font-style: italic;
    font-size: 16px; color: var(--vermillion);
    margin-bottom: 16px; letter-spacing: .05em;
  }
  .block h4{
    font-family: var(--serif); font-weight: 700;
    font-size: clamp(36px, 4.8vw, 64px);
    line-height: 1.1; letter-spacing: .04em;
    margin: 0 0 16px;
  }
  .block .lead{
    font-family: var(--serif); font-weight: 300;
    font-size: clamp(17px, 1.5vw, 22px);
    color: var(--ash);
    max-width: 60ch;
    margin: 0 0 80px;
    line-height: 1.7;
  }

  /* two-stat */
  .two-stat{
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 80px; margin-top: 40px;
  }
  .stat{
    border-top: 1px solid var(--ink);
    padding-top: 32px;
  }
  .stat .label{
    font-family: var(--sans);
    font-size: 13px; letter-spacing: .3em;
    color: var(--ash);
    margin-bottom: 24px;
  }
  .stat .num{
    font-family: var(--serif); font-weight: 900;
    font-size: clamp(72px, 10vw, 168px);
    line-height: .9;
    color: var(--vermillion);
    letter-spacing: -.01em;
    margin-bottom: 8px;
  }
  .stat .unit{
    font-family: var(--en); font-style: italic;
    font-size: 18px; color: var(--ash);
    margin-bottom: 28px; letter-spacing: .04em;
  }
  .stat .note{
    font-size: 15px; color: var(--ink);
    line-height: 1.7;
    border-top: 1px solid var(--hairline);
    padding-top: 20px;
    max-width: 30ch;
  }
  .punch{
    margin-top: 100px;
    padding: 48px 0 0;
    border-top: 2px solid var(--ink);
    font-family: var(--serif); font-weight: 500;
    font-size: clamp(22px, 2.4vw, 36px);
    line-height: 1.5;
    max-width: 50ch;
    letter-spacing: .02em;
  }
  .punch::before{
    content: "—";
    color: var(--vermillion);
    margin-right: 16px;
  }

  /* three-column competitor */
  .three-col{
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 48px; margin-top: 40px;
  }
  .col{
    border-top: 1px solid var(--ink);
    padding-top: 32px;
  }
  .col .tag{
    font-family: var(--en); font-style: italic;
    font-size: 14px; color: var(--vermillion);
    letter-spacing: .08em;
    margin-bottom: 20px;
  }
  .col .name{
    font-family: var(--serif); font-weight: 700;
    font-size: 28px;
    line-height: 1.2; margin-bottom: 32px;
    letter-spacing: .04em;
  }
  .col dl{ margin: 0; }
  .col dt{
    font-family: var(--sans);
    font-size: 11px; letter-spacing: .3em;
    color: var(--ash);
    margin-bottom: 6px;
    margin-top: 24px;
  }
  .col dd{
    margin: 0;
    font-size: 15px; line-height: 1.7;
  }
  .col dd.weak{ color: var(--vermillion); }
  .insight{
    margin-top: 100px;
    padding: 48px 0 0;
    border-top: 1px solid var(--ink);
    font-family: var(--serif); font-weight: 300;
    font-size: clamp(18px, 1.8vw, 24px);
    line-height: 1.7; max-width: 60ch;
  }

  /* quote-blank — the dramatic emptiness */
  .blank{
    background: var(--paper);
    padding: 30vh 6vw 24vh;
    text-align: left;
    position: relative;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }
  .blank .kicker{
    font-family: var(--sans);
    font-size: 12px; letter-spacing: .5em;
    color: var(--vermillion);
    margin-bottom: 40px;
  }
  .blank .quote{
    font-family: var(--serif); font-weight: 200;
    font-size: clamp(56px, 11vw, 200px);
    line-height: 1; letter-spacing: .04em;
    margin: 0 0 60px;
  }
  .blank .quote .accent{ color: var(--vermillion); }
  .blank .after{
    max-width: 50ch;
    font-family: var(--serif); font-weight: 300;
    font-size: clamp(16px, 1.4vw, 19px);
    color: var(--ash);
    line-height: 1.85;
    border-left: 2px solid var(--vermillion);
    padding-left: 24px;
  }

  /* manifesto — the core claim */
  .manifesto{
    padding: 22vh 6vw;
    background:
      radial-gradient(circle at 20% 30%, rgba(184,37,43,.06), transparent 60%),
      var(--paper);
  }
  .manifesto .kicker{
    font-family: var(--sans);
    font-size: 12px; letter-spacing: .5em;
    color: var(--vermillion);
    margin-bottom: 60px;
  }
  .manifesto .claim{
    font-family: var(--serif); font-weight: 700;
    font-size: clamp(40px, 6.5vw, 96px);
    line-height: 1.2;
    letter-spacing: .03em;
    margin: 0 0 80px;
    max-width: 22ch;
  }
  .manifesto .claim em{
    color: var(--vermillion);
    font-style: normal;
  }
  .manifesto .explain{
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 48px;
    max-width: 1000px;
  }
  .manifesto .explain p{
    margin: 0;
    font-family: var(--serif);
    font-size: 17px; line-height: 1.85;
    color: var(--ink);
  }
  .manifesto .explain p:nth-child(3),
  .manifesto .explain p:nth-child(4){
    font-weight: 500;
    color: var(--vermillion);
  }

  /* comparison — wrong vs right */
  .compare{
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 80px; margin-top: 40px;
  }
  .compare .wrong-col h5,
  .compare .right-col h5{
    font-family: var(--sans);
    font-size: 12px; letter-spacing: .4em;
    margin: 0 0 32px;
  }
  .compare .wrong-col h5{ color: var(--ash); }
  .compare .right-col h5{ color: var(--vermillion); }
  .wrong-list{ list-style: none; margin: 0; padding: 0; }
  .wrong-list li{
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: 24px;
    padding: 20px 0;
    border-bottom: 1px solid var(--hairline);
    align-items: baseline;
    text-decoration: line-through;
    text-decoration-color: rgba(184,37,43,.5);
    text-decoration-thickness: 1px;
  }
  .wrong-list li .n{
    font-family: var(--serif); font-weight: 700;
    font-size: 22px; letter-spacing: .1em;
    text-decoration: none;
  }
  .wrong-list li .d{
    font-size: 14px; color: var(--ash);
    text-decoration: none;
  }
  .right-col .target{
    font-family: var(--serif); font-weight: 300;
    font-size: clamp(18px, 1.6vw, 22px);
    line-height: 1.85;
    border-top: 2px solid var(--vermillion);
    padding-top: 28px;
  }

  /* platform grid */
  .platforms{
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0;
    margin-top: 40px;
    border-top: 1px solid var(--ink);
    border-left: 1px solid var(--ink);
  }
  .pf{
    padding: 40px 36px;
    border-right: 1px solid var(--ink);
    border-bottom: 1px solid var(--ink);
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 24px;
    align-items: start;
  }
  .pf .name{
    font-family: var(--en); font-style: italic;
    font-weight: 500;
    font-size: 24px;
    color: var(--vermillion);
    letter-spacing: .03em;
  }
  .pf .role{
    font-family: var(--sans);
    font-size: 11px; letter-spacing: .3em;
    color: var(--ash);
    margin-bottom: 12px;
  }
  .pf .fn{
    font-size: 15px; line-height: 1.7;
  }

  /* three-bullet — KOL */
  .bullets{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 48px;
    margin-top: 40px;
  }
  .bullet{
    border-top: 1px solid var(--ink);
    padding-top: 32px;
  }
  .bullet .no{
    font-family: var(--en); font-style: italic;
    font-size: 56px; color: var(--vermillion);
    line-height: 1; margin-bottom: 24px;
    letter-spacing: -.02em;
  }
  .bullet .name{
    font-family: var(--serif); font-weight: 700;
    font-size: 22px; letter-spacing: .04em;
    line-height: 1.3; margin-bottom: 20px;
  }
  .bullet .desc{
    font-size: 15px; line-height: 1.85;
    color: var(--ink);
  }

  /* roadmap */
  .roadmap{
    margin-top: 40px;
    border-top: 2px solid var(--ink);
  }
  .phase{
    display: grid;
    grid-template-columns: 180px 1fr 2fr;
    gap: 60px;
    padding: 56px 0;
    border-bottom: 1px solid var(--hairline);
    align-items: baseline;
  }
  .phase .q{
    font-family: var(--en); font-style: italic;
    font-weight: 500;
    font-size: clamp(48px, 6vw, 80px);
    color: var(--vermillion);
    letter-spacing: .02em;
    line-height: 1;
  }
  .phase .pname{
    font-family: var(--serif); font-weight: 700;
    font-size: clamp(24px, 2.6vw, 36px);
    letter-spacing: .04em;
    line-height: 1.2;
  }
  .phase .pdesc{
    font-size: 16px; line-height: 1.85;
    color: var(--ink);
  }
  .footnote{
    margin-top: 60px;
    font-family: var(--serif); font-weight: 300;
    font-style: italic;
    font-size: 16px; color: var(--ash);
    line-height: 1.7;
    max-width: 50ch;
  }

  /* end */
  .end{
    background: var(--ink);
    color: var(--paper);
    padding: 28vh 6vw;
    margin-top: 14vh;
    position: relative;
  }
  .end .kicker{
    font-family: var(--sans);
    font-size: 12px; letter-spacing: .5em;
    color: var(--vermillion);
    margin-bottom: 60px;
  }
  .end h6{
    font-family: var(--serif); font-weight: 700;
    font-size: clamp(48px, 7vw, 112px);
    line-height: 1.05;
    letter-spacing: .04em;
    margin: 0 0 80px;
    max-width: 18ch;
  }
  .end .tail{
    font-family: var(--serif); font-weight: 300;
    font-size: clamp(18px, 1.8vw, 24px);
    color: rgba(244,235,208,.7);
    line-height: 1.85;
    max-width: 60ch;
    border-left: 2px solid var(--vermillion);
    padding-left: 24px;
    margin-bottom: 80px;
  }
  .end .sign{
    font-family: var(--en); font-style: italic;
    font-size: 28px;
    color: var(--vermillion);
    letter-spacing: .04em;
  }

  /* page colophon */
  .colophon{
    background: var(--paper);
    padding: 8vh 6vw 6vh;
    border-top: 1px solid var(--hairline);
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 60px;
    font-family: var(--sans);
    font-size: 11px; letter-spacing: .25em;
    color: var(--ash);
  }
  .colophon strong{
    font-family: var(--en); font-style: italic;
    color: var(--vermillion);
    font-weight: 500;
    font-size: 13px;
    letter-spacing: .05em;
    display: block; margin-bottom: 12px;
  }

  /* scroll reveal — minimal, only on body sections */
  [data-reveal]{
    opacity: 0;
    transform: translateY(24px);
    transition: opacity .9s ease, transform .9s ease;
  }
  [data-reveal].in{
    opacity: 1;
    transform: none;
  }

  /* responsive ─ collapse to single column */
  @media (max-width: 880px){
    body{ padding-left: 0; }
    .runner{ display: none; }
    .grid, .two-stat, .three-col, .platforms, .bullets, .compare, .manifesto .explain{
      grid-template-columns: 1fr !important;
      gap: 32px !important;
    }
    .platforms{ border-left: none; }
    .pf{ grid-template-columns: 1fr; gap: 8px; }
    .toc-list li{ grid-template-columns: 60px 1fr; gap: 16px; }
    .toc-list .en, .toc-list .arrow{ display: none; }
    .phase{ grid-template-columns: 1fr; gap: 16px; padding: 32px 0; }
    .toc-head{ grid-template-columns: 1fr; gap: 24px; }
    .hero-meta{ flex-wrap: wrap; gap: 12px; }
  }

  /* print */
  @media print{
    .runner{ display: none; }
    body{ padding-left: 0; background: var(--paper); }
    .section-div, .end{ break-before: page; }
    .block, .blank, .manifesto, .toc{ break-inside: avoid; }
  }
</style>
</head>
<body>

<!-- vertical runner -->
<aside class="runner" aria-hidden="true">
  <span class="v">東方靈性數位媒體 · 2026</span>
  <div class="stamp">奧</div>
</aside>

<!-- ============ HERO ============ -->
<section class="hero">
  <div>
    <div class="hero-meta">
      <span>STRATEGY BOOK</span>
      <span>NO.001 / 2026</span>
      <span>菲爾·奈特 ✕ 奧</span>
    </div>
    <h1>東方<br>靈性<br>數位媒體<em>Eastern Spiritual Digital</em></h1>
    <p class="sub">市場行銷策略書　·　第一本不挑邊站的東方靈性媒體計劃</p>
    <p class="tag">「你不需要放棄任何一個自己，<br>才能找到方向。」</p>
    <div class="footer">
      <span>菲爾·奈特　委派　·　奧　撰稿　·　2026.05.04</span>
      <span class="right">vol. 01</span>
    </div>
  </div>
</section>

<!-- ============ TOC ============ -->
<section class="toc" id="toc">
  <div class="toc-head">
    <div class="label">— Contents</div>
    <h2>策略地圖</h2>
  </div>
  <ol class="toc-list" data-reveal>
    <li><span class="num">01</span><span class="ch">市場環境</span><span class="en">Market Landscape</span><span class="arrow">→</span></li>
    <li><span class="num">02</span><span class="ch">品牌定位</span><span class="en">Brand Position</span><span class="arrow">→</span></li>
    <li><span class="num">03</span><span class="ch">數位行銷</span><span class="en">Digital Channel</span><span class="arrow">→</span></li>
    <li><span class="num">04</span><span class="ch">用戶旅程</span><span class="en">User Journey</span><span class="arrow">→</span></li>
    <li><span class="num">05</span><span class="ch">預算配置</span><span class="en">Budget Frame</span><span class="arrow">→</span></li>
    <li><span class="num">06</span><span class="ch">首年路線</span><span class="en">Year-One Roadmap</span><span class="arrow">→</span></li>
  </ol>
</section>

<!-- ============ PART 01 ============ -->
<section class="section-div" data-no="01">
  <div class="kicker">PART 01</div>
  <h3>市場環境</h3>
  <p class="sub">兩個市場、一個消費者，目前沒有共同的媒體</p>
</section>

<!-- two stats -->
<section class="block" data-reveal>
  <div class="eyebrow">— Stat 01</div>
  <h4>靈性人口的兩條河</h4>
  <p class="lead">舊與新平行流動，但從未匯流。傳統宮廟與現代占卜兩個市場彼此不知道對方存在，卻共享同一個 25–45 歲的城市消費者。</p>

  <div class="two-stat">
    <div class="stat">
      <div class="label">傳統靈性 · 宮廟</div>
      <div class="num">300<span style="font-family:var(--en);font-style:italic;font-size:.4em;color:var(--ash);margin-left:.15em;">億</span></div>
      <div class="unit">NT$ / year</div>
      <div class="note">全台 1.5 萬座寺廟　·　香客逾 1 億人次 / 年</div>
    </div>
    <div class="stat">
      <div class="label">現代靈性 · 冥想・占卜</div>
      <div class="num">200<span style="font-family:var(--en);font-style:italic;font-size:.4em;color:var(--ash);margin-left:.15em;">萬+</span></div>
      <div class="unit">followers, aggregated</div>
      <div class="note">塔羅占卜帳號逾 300 個　·　成長類課程客單 3–15K</div>
    </div>
  </div>

  <div class="punch">這兩個市場有一個共同的消費者，但他們目前沒有一個共同的媒體。</div>
</section>

<!-- competitor three col -->
<section class="block" data-reveal>
  <div class="eyebrow">— Stat 02</div>
  <h4>競爭地形</h4>
  <p class="lead">三類競品都有缺角。沒有任何一個競爭者同時擁有現代靈性語言的親近感，以及台灣宮廟文化的在地深度。</p>

  <div class="three-col">
    <div class="col">
      <div class="tag">第一類 · TYPE A</div>
      <div class="name">西方靈性創作者</div>
      <dl>
        <dt>STRENGTH</dt><dd>觸及年輕族群強</dd>
        <dt>WEAKNESS</dt><dd class="weak">高度同質、缺文化根基</dd>
      </dl>
    </div>
    <div class="col">
      <div class="tag">第二類 · TYPE B</div>
      <div class="name">宮廟數位化嘗試</div>
      <dl>
        <dt>STRENGTH</dt><dd>線下資產龐大</dd>
        <dt>WEAKNESS</dt><dd class="weak">無現代品牌意識</dd>
      </dl>
    </div>
    <div class="col">
      <div class="tag">第三類 · TYPE C</div>
      <div class="name">泛健康生活媒體</div>
      <dl>
        <dt>STRENGTH</dt><dd>佔據既有流量</dd>
        <dt>WEAKNESS</dt><dd class="weak">沒立場、不深度</dd>
      </dl>
    </div>
  </div>

  <div class="insight">沒有任何一個競爭者同時擁有現代靈性語言的親近感，以及台灣宮廟文化的在地深度。</div>
</section>

<!-- blank space — the empty position -->
<section class="blank" data-reveal>
  <div class="kicker">市場結論 · CONCLUSION</div>
  <p class="quote">這個位置，<br><span class="accent">是空的。</span></p>
  <p class="after">整個台灣靈性消費市場，沒有任何一個品牌站在「現代語言 × 在地文化」的交叉點上。這不是擠進已飽和的市場，是走進一塊還沒有人標記的土地。</p>
</section>

<!-- ============ PART 02 ============ -->
<section class="section-div" data-no="02">
  <div class="kicker">PART 02</div>
  <h3>品牌定位</h3>
  <p class="sub">不選邊站，是這個品牌的力量</p>
</section>

<!-- manifesto -->
<section class="manifesto" data-reveal>
  <div class="kicker">核心主張 · CORE CLAIM</div>
  <h5 class="claim" style="font-family:var(--serif);">你不需要<em>放棄任何一個自己</em>，<br>才能找到方向。</h5>
  <div class="explain">
    <p>目標受眾夾在兩個自我中間：一個是受過現代教育、用西方靈性工具的都市人；</p>
    <p>另一個是除夕夜跟著家人去廟裡拜拜、心裡其實很認真的那個自己。</p>
    <p>這個品牌說：<br>這兩個你是同一個你。</p>
    <p>這個組合是你的力量，<br>不是你的矛盾。</p>
  </div>
</section>

<!-- voice comparison -->
<section class="block" data-reveal>
  <div class="eyebrow">— Brand Voice</div>
  <h4>品牌聲音的四個禁區</h4>
  <p class="lead">這四種語調最容易讓品牌變得平庸。它們都是「正確的」，但任何一條都會把品牌拉向已被佔據的位置。</p>

  <div class="compare">
    <div class="wrong-col">
      <h5>避開 · AVOID</h5>
      <ul class="wrong-list">
        <li><span class="n">傳教式</span><span class="d">高高在上，讓人感到被說教</span></li>
        <li><span class="n">療癒式</span><span class="d">過度溫柔，缺乏力量</span></li>
        <li><span class="n">神秘式</span><span class="d">故意製造距離感</span></li>
        <li><span class="n">學術式</span><span class="d">正確但沒有溫度</span></li>
      </ul>
    </div>
    <div class="right-col">
      <h5>瞄準 · TARGET</h5>
      <p class="target">像一個你信任的朋友——他剛好既研究過榮格的原型理論，也在北港朝天宮跟進香隊伍走過一整個晚上。</p>
    </div>
  </div>
</section>

<!-- ============ PART 03 ============ -->
<section class="section-div" data-no="03">
  <div class="kicker">PART 03</div>
  <h3>數位行銷</h3>
  <p class="sub">五個平台、五種角色，組成完整品牌體驗</p>
</section>

<!-- platforms grid -->
<section class="block" data-reveal>
  <div class="eyebrow">— Platform Mix</div>
  <h4>平台分工</h4>
  <p class="lead">不是同一套內容複製貼上。每個平台有自己的角色與節奏，加總起來才是品牌。</p>

  <div class="platforms">
    <div class="pf">
      <div class="name">Instagram</div>
      <div><div class="role">視覺門面</div><div class="fn">Reels 短影音 + 輪播知識卡，做情感共鳴主場</div></div>
    </div>
    <div class="pf">
      <div class="name">TikTok</div>
      <div><div class="role">新受眾加速器</div><div class="fn">命理 / 靈性題材有機傳播強，推 30–60 秒短片</div></div>
    </div>
    <div class="pf">
      <div class="name">YouTube</div>
      <div><div class="role">深度信任 + 長尾搜尋</div><div class="fn">宮廟紀錄片、長冥想引導、20–30 分鐘訪談</div></div>
    </div>
    <div class="pf">
      <div class="name">Facebook</div>
      <div><div class="role">30+ 族群社團</div><div class="fn">東方靈性生活交流社團，深度討論場域</div></div>
    </div>
    <div class="pf" style="grid-column: 1 / -1;">
      <div class="name">Podcast</div>
      <div><div class="role">通勤陪伴</div><div class="fn">週更節目，建立長期人格信任</div></div>
    </div>
  </div>
</section>

<!-- KOL bullets -->
<section class="block" data-reveal>
  <div class="eyebrow">— KOL Strategy</div>
  <h4>KOL 不追求大網紅</h4>
  <p class="lead">深入三個微型生態圈，重疊度高、成本低，是這個品牌與大水晶療癒帳號競爭的非對稱武器。</p>

  <div class="bullets">
    <div class="bullet">
      <div class="no">01</div>
      <div class="name">宮廟文化記錄者</div>
      <div class="desc">5K–30K 粉，攝影師 / 文字工作者 / 廟會紀錄者，信任度極高。</div>
    </div>
    <div class="bullet">
      <div class="no">02</div>
      <div class="name">身心靈美容師社群</div>
      <div class="desc">兼做水晶 / 精油 / 脈輪療癒，與客戶有深度個人關係。</div>
    </div>
    <div class="bullet">
      <div class="no">03</div>
      <div class="name">心靈書寫創作者</div>
      <div class="desc">Threads / IG 上的長文寫手，受眾與品牌目標重合度最高。</div>
    </div>
  </div>
</section>

<!-- roadmap -->
<section class="block" data-reveal>
  <div class="eyebrow">— Year One Roadmap</div>
  <h4>首年三階段</h4>
  <p class="lead">從 0 到一個具體的收入規模。每階段不超前、不延後——靈性品牌的信任是線性累積的，不能用流量公式跳級。</p>

  <div class="roadmap">
    <div class="phase">
      <div class="q">Q1</div>
      <div class="pname">建立認同</div>
      <div class="pdesc">純內容、不變現。建立「現代語言詮釋東方靈性」的品牌識別，讓第一波受眾認得這個聲音。</div>
    </div>
    <div class="phase">
      <div class="q">Q2</div>
      <div class="pname">啟動社群</div>
      <div class="pdesc">FB 社團 + IG 直播，把單向追蹤者轉成參與式社群。社群密度比社群人數重要。</div>
    </div>
    <div class="phase">
      <div class="q">Q3 — Q4</div>
      <div class="pname">啟動變現</div>
      <div class="pdesc">課程 + 訂閱 + 線下小型聚會，建立可持續收入結構。線下聚會是品牌信任的最終驗證點。</div>
    </div>
  </div>

  <p class="footnote">每階段不超前、不延後——靈性品牌的信任是線性累積的，不能用流量公式跳級。</p>
</section>

<!-- ============ END ============ -->
<section class="end" data-reveal>
  <div class="kicker">策略不是文字遊戲 · CLOSING</div>
  <h6>是資源分配的<br>決策地圖</h6>
  <p class="tail">每一個建議後面都有數字，每一個數字後面都有具體的行動，每一個行動都有一個可以被追蹤的結果。</p>
  <div class="sign">— 奧</div>
</section>

<!-- colophon -->
<footer class="colophon">
  <div>
    <strong>Strategy Book Vol. 01</strong>
    東方靈性數位媒體　·　市場行銷策略書
  </div>
  <div style="text-align:right;">
    <strong>Designed in 東方間白</strong>
    Eastern Negative Space　·　2026.05
  </div>
</footer>

<script>
  // minimal scroll reveal — IntersectionObserver only, no libs
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
  document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));
</script>

</body>
</html>
`;
