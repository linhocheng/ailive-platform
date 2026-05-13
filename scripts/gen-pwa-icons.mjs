#!/usr/bin/env node
// 生 PWA icons：米白底（#F5F4F1）+ 深字（#1A1916）「築」
// 輸出：public/icon-192.png / icon-512.png / icon-512-maskable.png / apple-touch-icon.png
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const BG = '#F5F4F1';
const FG = '#1A1916';
const CHAR = '築';

function svg(size, opts = {}) {
  const { safeArea = 1.0, bgRadiusPct = 0 } = opts;
  // 安全區（maskable 需要把字壓到中央 80%）
  const fontSize = Math.round(size * 0.62 * safeArea);
  // 圓角（瀏覽器 mask 自己會切，這裡只給非 maskable 微圓角）
  const r = Math.round(size * bgRadiusPct);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BG}"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
    font-family="'PingFang TC','Noto Sans TC','Heiti TC','Microsoft JhengHei',sans-serif"
    font-weight="700" font-size="${fontSize}" fill="${FG}">${CHAR}</text>
</svg>`;
}

async function render(size, outName, opts = {}) {
  const out = path.join(PUBLIC, outName);
  await sharp(Buffer.from(svg(size, opts))).png().toFile(out);
  const stat = fs.statSync(out);
  console.log(`✓ ${outName}  ${size}x${size}  ${(stat.size/1024).toFixed(1)} KB`);
}

// 一般 icon（給 manifest 用）— 微圓角
await render(192, 'icon-192.png', { bgRadiusPct: 0.18 });
await render(512, 'icon-512.png', { bgRadiusPct: 0.18 });
// maskable — 字壓到中央 80%，背景滿出（瀏覽器會 mask 圓形/方形）
await render(512, 'icon-512-maskable.png', { safeArea: 0.8, bgRadiusPct: 0 });
// iOS — 系統會自動切圓角，不要自帶
await render(180, 'apple-touch-icon.png', { bgRadiusPct: 0 });
