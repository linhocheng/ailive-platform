/**
 * 七題自查：HTML 出爐後在落 Storage 前最後一道關
 * 支援多個 philosophy（eastern-blank / swiss-grid）
 */
import type { PhilosophyKey } from './prompt';

export interface QAResult {
  ok: boolean;
  reasons: string[];
  metrics: {
    bytes: number;
    docHasDoctype: boolean;
    hasHtmlClose: boolean;
    requiredHits: Record<string, boolean>;
    forbiddenHits: string[];
  };
}

const COMMON_FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /#FFD700|#FFC107|#DAA520|#B8860B/i, label: 'gold color' },
  { pattern: /linear-gradient\([^)]*purple/i, label: 'purple gradient' },
  { pattern: /linear-gradient\([^)]*#[89]\w{4}[^)]*#fff/i, label: 'purple-on-white gradient' },
];

const EASTERN_BLANK_FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /font-family:\s*['"]?Inter['"]?/i, label: 'Inter font' },
  { pattern: /font-family:\s*['"]?Roboto['"]?/i, label: 'Roboto font' },
  { pattern: /font-family:\s*['"]?Arial['"]?/i, label: 'Arial font' },
  { pattern: /font-family:\s*['"]?Space Grotesk['"]?/i, label: 'Space Grotesk font' },
];

const SWISS_GRID_FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
  // swiss-grid uses Plus Jakarta Sans (sans-serif) — forbid eastern-specific fonts instead
  { pattern: /font-family:\s*['"]?Cormorant/i, label: 'Cormorant font (eastern-blank only)' },
  // no gradients in background (CSS token check)
  { pattern: /background\s*:\s*linear-gradient/i, label: 'gradient background' },
  // no text-align center on headings
  { pattern: /<h[12][^>]*style="[^"]*text-align\s*:\s*center/i, label: 'centered heading' },
];

type RequiredCheck = { label: string; pattern: RegExp; minCount?: number };

const EASTERN_BLANK_REQUIRED: RequiredCheck[] = [
  { label: '.hero', pattern: /class="hero"|class='hero'/ },
  { label: '.toc', pattern: /class="toc"|class='toc'/ },
  { label: '.end', pattern: /class="end"|class='end'/ },
  { label: '.section-div (≥1)', pattern: /class="section-div"|class='section-div'/, minCount: 1 },
  { label: '.block (≥2)', pattern: /class="block"|class='block'/, minCount: 2 },
];

const SWISS_GRID_REQUIRED: RequiredCheck[] = [
  { label: '.sg-cover', pattern: /class="sg-cover"|class='sg-cover'/ },
  { label: '.sg-toc', pattern: /class="sg-toc"|class='sg-toc'/ },
  { label: '.sg-coda', pattern: /class="sg-coda"|class='sg-coda'/ },
  { label: '.sg-footer', pattern: /class="sg-footer"|class='sg-footer'/ },
  { label: '.sg-rule (≥2)', pattern: /class="sg-rule"|class='sg-rule'/, minCount: 2 },
  { label: '.sg-body (≥2)', pattern: /class="sg-body"|class='sg-body'/, minCount: 2 },
];

const DARK_PREMIUM_REQUIRED: RequiredCheck[] = [
  { label: '.dp-cover', pattern: /class="dp-cover"|class='dp-cover'/ },
  { label: '.dp-toc', pattern: /class="dp-toc"|class='dp-toc'/ },
  { label: '.dp-coda', pattern: /class="dp-coda"|class='dp-coda'/ },
  { label: '.dp-foot', pattern: /class="dp-foot"|class='dp-foot'/ },
  { label: '.dp-chapter (≥2)', pattern: /class="dp-chapter"|class='dp-chapter'/, minCount: 2 },
  { label: '.dp-body (≥2)', pattern: /class="dp-body"|class='dp-body'/, minCount: 2 },
];

const DARK_PREMIUM_FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /#FFD700|#FFC107|#DAA520|#B8860B|#F0B429/i, label: 'warm gold color (use platinum #C8BFB0 instead)' },
  { pattern: /background\s*:\s*linear-gradient/i, label: 'gradient background' },
  { pattern: /color\s*:\s*#(?!0F0F0F|191919|242424|F0EDE8|C8BFB0|8A847C|3A3A3A|D8D4CE)[0-9a-f]{6}/i, label: 'off-palette color' },
];

export function qaHtml(html: string, philosophy: PhilosophyKey = 'eastern-blank'): QAResult {
  const reasons: string[] = [];
  const forbiddenHits: string[] = [];
  const requiredHits: Record<string, boolean> = {};

  const docHasDoctype = /^\s*<!doctype html>/i.test(html);
  if (!docHasDoctype) reasons.push('missing <!doctype html>');

  const hasHtmlClose = /<\/html>\s*$/i.test(html.trim());
  if (!hasHtmlClose) reasons.push('missing </html> close');

  // Code-block fence accidentally left
  if (/```html/.test(html) || /```\s*$/.test(html.trim())) {
    reasons.push('contains markdown code fence (should be raw HTML)');
  }

  // Required sections
  const requiredChecks =
    philosophy === 'swiss-grid' ? SWISS_GRID_REQUIRED :
    philosophy === 'dark-premium' ? DARK_PREMIUM_REQUIRED :
    EASTERN_BLANK_REQUIRED;
  for (const check of requiredChecks) {
    const matches = html.match(new RegExp(check.pattern.source, 'g')) || [];
    const count = matches.length;
    const minCount = check.minCount ?? 1;
    const ok = count >= minCount;
    requiredHits[check.label] = ok;
    if (!ok) reasons.push(`missing ${check.label} (found ${count}, need ≥${minCount})`);
  }

  // Forbidden patterns
  const forbiddenChecks = [
    ...COMMON_FORBIDDEN,
    ...(philosophy === 'swiss-grid' ? SWISS_GRID_FORBIDDEN :
        philosophy === 'dark-premium' ? DARK_PREMIUM_FORBIDDEN :
        EASTERN_BLANK_FORBIDDEN),
  ];
  for (const { pattern, label } of forbiddenChecks) {
    if (pattern.test(html)) {
      forbiddenHits.push(label);
      reasons.push(`forbidden: ${label}`);
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    metrics: {
      bytes: html.length,
      docHasDoctype,
      hasHtmlClose,
      requiredHits,
      forbiddenHits,
    },
  };
}
