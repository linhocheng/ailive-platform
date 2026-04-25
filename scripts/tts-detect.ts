/**
 * tts-detect.ts — TTS 高風險字偵測 CLI
 *
 * 用法：
 *   npx tsx scripts/tts-detect.ts <file>          # 讀檔
 *   echo "今天去銀行" | npx tsx scripts/tts-detect.ts   # 讀 stdin
 *   npx tsx scripts/tts-detect.ts "今天去銀行"       # 直接吃文字
 *
 * 輸出兩段：
 *   HITS  — 字典規則命中（被替換的詞）
 *   WARNS — 含 CHAR_ALERT 高風險字但無規則覆蓋（可能是新案例）
 */
import { readFileSync, existsSync } from 'fs';
import { PRONUNCIATION_MAP, ZH_TW_MAP, type RuleEntry } from '../src/lib/tts-preprocess';

// 高風險單字警示集（來自 jianbin CHAR_ALERT + ailive PRONUNCIATION_MAP 各組首字聯集）
const CHAR_ALERT = [
  '著', '重', '樂', '行', '長', '調', '率', '刻', '露', '髮',
  '累', '處', '應', '數', '降', '說', '切', '差', '還', '量',
  '脈', '薦', '校', '覺', '儀', '影', '得', '當', '發', '了',
  '曾', '與', '便', '頸', '殼', '執', '催', '員', '瞭',
];

function loadInput(): string {
  const arg = process.argv[2];
  if (!arg || arg === '-') {
    // stdin
    try {
      return readFileSync(0, 'utf-8');
    } catch {
      console.error('用法：tts-detect <file | text> 或從 stdin 餵入');
      process.exit(1);
    }
  }
  if (existsSync(arg)) return readFileSync(arg, 'utf-8');
  return arg; // 當作字面文字
}

type Occurrence = { line: number; col: number; ctx: string };

function findAll(text: string, keyword: string): Occurrence[] {
  const lines = text.split('\n');
  const out: Occurrence[] = [];
  for (let i = 0; i < lines.length; i++) {
    let idx = 0;
    while ((idx = lines[i].indexOf(keyword, idx)) !== -1) {
      out.push({
        line: i + 1,
        col: idx + 1,
        ctx: lines[i].slice(Math.max(0, idx - 5), idx + keyword.length + 5),
      });
      idx += keyword.length;
    }
  }
  return out;
}

type CoveredRange = { line: number; start: number; end: number };
function isCovered(o: Occurrence, ranges: CoveredRange[]): boolean {
  return ranges.some(m => m.line === o.line && o.col >= m.start && o.col < m.end);
}

function main() {
  const text = loadInput();
  const allKeys = [...Object.keys(ZH_TW_MAP), ...Object.keys(PRONUNCIATION_MAP)];
  const covered: CoveredRange[] = [];

  console.log('=== HITS（字典規則命中）===');
  let hitCount = 0;
  for (const k of allKeys.sort((a, b) => b.length - a.length)) {
    const occ = findAll(text, k);
    if (occ.length === 0) continue;
    const entry: RuleEntry = (PRONUNCIATION_MAP[k] || ZH_TW_MAP[k]);
    for (const o of occ) {
      if (isCovered(o, covered)) continue;
      console.log(`[HIT] ${k} → ${entry.replacement}  L${o.line}C${o.col}  「${o.ctx}」  (${entry.reason})`);
      covered.push({ line: o.line, start: o.col, end: o.col + k.length });
      hitCount++;
    }
  }
  if (hitCount === 0) console.log('(無命中)');

  console.log('\n=== WARNS（高風險字無規則覆蓋）===');
  let warnCount = 0;
  for (const ch of CHAR_ALERT) {
    const occ = findAll(text, ch);
    for (const o of occ) {
      if (isCovered(o, covered)) continue;
      console.log(`[WARN] 「${ch}」  L${o.line}C${o.col}  「${o.ctx}」`);
      warnCount++;
    }
  }
  if (warnCount === 0) console.log('(全部高風險字都有規則覆蓋)');

  console.log(`\n總計: ${hitCount} HIT, ${warnCount} WARN`);
}

main();
