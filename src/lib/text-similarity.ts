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

// ── BM25（CJK bigram 斷詞）——knowledge-search 與 episodic 檢索共用 ──
// 為什麼需要它：text-embedding-004 在窄域（同品牌內容）cosine 全坍縮在 0.6-0.9，
// 失去鑑別力；BM25 走字面匹配繞過坍縮，idf 讓「雪玉如初」這種低頻專名權重高。

// 中文字元 bigram 斷詞（零依賴）：只留 CJK + 英數，滑動取 2-gram
export function bigramTokens(text: string): string[] {
  const chars = Array.from(text).filter(c => /[一-鿿\w]/.test(c));
  const s = chars.join('');
  const grams: string[] = [];
  for (let i = 0; i < s.length - 1; i++) grams.push(s.slice(i, i + 2));
  return grams;
}

// 對候選文本算 BM25，回傳與輸入對齊的分數陣列。query 時在記憶體建，零索引。
export function bm25Scores(query: string, docTexts: string[]): number[] {
  const k1 = 1.5, b = 0.75;
  const docToks = docTexts.map(t => bigramTokens(t));
  const N = docTexts.length || 1;
  const avgdl = docToks.reduce((s, t) => s + t.length, 0) / N;
  const df = new Map<string, number>();
  for (const toks of docToks) for (const g of new Set(toks)) df.set(g, (df.get(g) || 0) + 1);
  const idf = (g: string) => Math.log((N - (df.get(g) || 0) + 0.5) / ((df.get(g) || 0) + 0.5) + 1);
  const qToks = [...new Set(bigramTokens(query))];
  return docToks.map(toks => {
    const tf = new Map<string, number>();
    for (const g of toks) tf.set(g, (tf.get(g) || 0) + 1);
    const dl = toks.length;
    let s = 0;
    for (const g of qToks) {
      const f = tf.get(g) || 0;
      if (f === 0) continue;
      s += idf(g) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / avgdl));
    }
    return s;
  });
}
