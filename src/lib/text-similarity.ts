/**
 * 記憶去重判準 — sleep route 與 runner 的 sleep task 共用（收斂點，改這裡兩邊同時生效）
 *
 * 雙門檻：cosine >= 0.9 AND CJK bigram 重疊率 >= 0.5，同時成立才算重複。
 * 為什麼不能只看 cosine：同一對人的長篇敘事記憶 embedding 天生擠在一起，
 * ailiveX 實測純 cosine 0.92 仍把完全不同的事件判成重複（大誤殺）。
 * 真重複的特徵是「逐字級相似」，所以詞彙重疊是必要條件。
 */

export const DEDUP_COSINE_THRESHOLD = 0.9;
export const DEDUP_OVERLAP_THRESHOLD = 0.5;

// CJK bigram 重疊率 = 兩段文字的二字組交集 ÷ 較短者的二字組數
export function cjkBigramOverlap(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const chars = Array.from(s).filter(c => /[一-鿿\w]/.test(c)).join('');
    const set = new Set<string>();
    for (let i = 0; i < chars.length - 1; i++) set.add(chars.slice(i, i + 2));
    return set;
  };
  const ga = grams(a), gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  const [small, large] = ga.size <= gb.size ? [ga, gb] : [gb, ga];
  let hit = 0;
  for (const g of small) if (large.has(g)) hit++;
  return hit / small.size;
}

// 雙門檻判重：cosine 先算好傳進來（呼叫端已有 embedding），文字這裡算
export function isDuplicateMemory(cosine: number, textA: string, textB: string): boolean {
  if (cosine < DEDUP_COSINE_THRESHOLD) return false;
  return cjkBigramOverlap(textA, textB) >= DEDUP_OVERLAP_THRESHOLD;
}
