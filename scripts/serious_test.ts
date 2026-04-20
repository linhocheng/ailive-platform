import { detectGear } from '../src/lib/llm-router';

const tests = [
  // 天條：有「認真」一定 Sonnet
  { text: '認真', expect: 'sonnet' },
  { text: '這個要認真想一下', expect: 'sonnet' },
  { text: '認真幫我寫', expect: 'sonnet' },
  { text: '嗨（認真）', expect: 'sonnet' },                  // 打敗 HAIKU_FORCE
  { text: '來篇 IG 要認真', expect: 'sonnet' },              // 打敗原本漏判
  { text: '認真地發個文', expect: 'sonnet' },
  { text: '請認真', expect: 'sonnet' },

  // 不含「認真」 → 走原本邏輯
  { text: '嗨', expect: 'haiku' },                          // HAIKU_FORCE
  { text: '幫我寫一篇', expect: 'sonnet' },                 // SONNET_PATTERNS
  { text: '來篇 IG', expect: 'haiku' },                     // 原本漏判（確認天條外不變）
  { text: '發個文', expect: 'haiku' },                      // 同上
  { text: '今天好累', expect: 'haiku' },                    // 無特殊
];

let pass = 0, fail = 0;
for (const t of tests) {
  const actual = detectGear(t.text, 5);
  const ok = actual === t.expect;
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} expect=${t.expect}\tactual=${actual}\t"${t.text}"`);
}
console.log(`\n${pass}/${tests.length} 通過，${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
