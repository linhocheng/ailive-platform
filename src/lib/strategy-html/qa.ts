/**
 * 七題自查：HTML 出爐後在落 Storage 前最後一道關
 * 不過則回 { ok:false, reasons } 由 worker 決定 retry 或 fallback
 */
export interface QAResult {
  ok: boolean;
  reasons: string[];
  metrics: {
    bytes: number;
    docHasDoctype: boolean;
    hasHero: boolean;
    hasToc: boolean;
    hasEnd: boolean;
    sectionDivCount: number;
    blockCount: number;
    forbiddenHits: string[];
  };
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /font-family:\s*['"]?Inter['"]?/i, label: 'Inter font' },
  { pattern: /font-family:\s*['"]?Roboto['"]?/i, label: 'Roboto font' },
  { pattern: /font-family:\s*['"]?Arial['"]?/i, label: 'Arial font' },
  { pattern: /font-family:\s*['"]?Space Grotesk['"]?/i, label: 'Space Grotesk font' },
  { pattern: /#FFD700|#FFC107|#DAA520|#B8860B/i, label: 'gold color' },
  { pattern: /linear-gradient\([^)]*purple/i, label: 'purple gradient' },
  { pattern: /linear-gradient\([^)]*#[89]\w{4}[^)]*#fff/i, label: 'purple-on-white gradient' },
];

export function qaHtml(html: string): QAResult {
  const reasons: string[] = [];
  const forbiddenHits: string[] = [];

  const docHasDoctype = /^\s*<!doctype html>/i.test(html);
  if (!docHasDoctype) reasons.push('missing <!doctype html>');

  const hasHtmlClose = /<\/html>\s*$/i.test(html.trim());
  if (!hasHtmlClose) reasons.push('missing </html> close');

  const hasHero = /class="hero"|class='hero'/.test(html);
  if (!hasHero) reasons.push('missing .hero section');

  const hasToc = /class="toc"|class='toc'/.test(html);
  if (!hasToc) reasons.push('missing .toc section');

  const hasEnd = /class="end"|class='end'/.test(html);
  if (!hasEnd) reasons.push('missing .end section');

  const sectionDivCount = (html.match(/class="section-div"|class='section-div'/g) || []).length;
  if (sectionDivCount < 1) reasons.push('no .section-div found (need ≥1)');

  const blockCount = (html.match(/class="block"|class='block'/g) || []).length;
  if (blockCount < 2) reasons.push(`only ${blockCount} .block (need ≥2)`);

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    if (pattern.test(html)) {
      forbiddenHits.push(label);
      reasons.push(`forbidden: ${label}`);
    }
  }

  // Code-block fence accidentally left
  if (/```html/.test(html) || /```\s*$/.test(html.trim())) {
    reasons.push('contains markdown code fence (should be raw HTML)');
  }

  return {
    ok: reasons.length === 0,
    reasons,
    metrics: {
      bytes: html.length,
      docHasDoctype,
      hasHero,
      hasToc,
      hasEnd,
      sectionDivCount,
      blockCount,
      forbiddenHits,
    },
  };
}
