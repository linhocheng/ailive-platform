import { NextRequest } from 'next/server';
import mammoth from 'mammoth';
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import { hasOperatorAccess } from '@/lib/char-access';

const enc = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const DESIGN_PROMPT = `You are a world-class visual designer. Transform the provided content into a stunning standalone HTML presentation.

STANDARD: Match the visual quality of Stripe, Linear, Apple Keynote dark theme. No images — compensate with exceptional typography, geometry, and spacing.

━━━ DESIGN SYSTEM ━━━

Use these CSS variables throughout:
:root {
  --bg: #0C0C0C;
  --surface: #141414;
  --surface-2: #1C1C1C;
  --border: rgba(255,255,255,0.08);
  --text-1: #F5F5F3;
  --text-2: rgba(245,245,243,0.55);
  --text-3: rgba(245,245,243,0.28);
  --accent: #E8C547;
  --accent-dim: rgba(232,197,71,0.10);
}

Fonts via @import:
https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@300;400;500&display=swap
- Display/titles: Syne
- Everything else: Inter

━━━ TYPOGRAPHY SCALE ━━━
- Display: clamp(56px, 8vw, 104px), Syne 800, letter-spacing -3px, line-height 0.93
- H1: clamp(32px, 5vw, 60px), Syne 700, letter-spacing -2px, line-height 1.05
- Lead: clamp(15px, 1.8vw, 19px), Inter 300, var(--text-2), line-height 1.65
- Body: 16px, Inter 400, var(--text-1), line-height 1.7
- Label: 12px, Inter 500, var(--text-3), letter-spacing 2px, text-transform uppercase

━━━ FIVE SLIDE TEMPLATES — use variety ━━━

[HERO] Opening slide
- Full-screen dark bg with faint radial accent glow (top-right, opacity 4%)
- Thin 60px accent line above display title
- Display-size title (Syne 800)
- Lead subtitle below
- Slide counter bottom-right in Label style

[STATEMENT] Bold single claim
- Centered display text — one sentence, fills the screen
- Optional giant quotation mark: font-size 200px, Syne, color var(--accent), opacity 8%, positioned top-left
- Nothing else (except slide counter)

[SPLIT] Title + content
- Left column (38% width): H1 title in Syne, vertically centered
- Vertical divider (1px, var(--border))
- Right column (56% width): content as items, each with 2px left border in var(--accent), pl-16px

[NUMBER] Key metric
- Center stage: a number in 96–140px Syne 800, color var(--accent)
- Short descriptor in Label style below
- Background decoration: hollow circle (200px, border 1px var(--border), opacity 30%), positioned behind

[CLOSE] Final slide
- Echoes HERO visual language
- H1 closing statement
- Optional 1–2 lines in Lead as parting thought
- Same accent glow but softer

━━━ DECORATION (no images) ━━━
- Radial gradients: radial-gradient(circle at 80% 20%, rgba(232,197,71,0.05), transparent 60%)
- Thin geometric lines: 1px strokes, var(--border) or var(--accent) at low opacity
- Hollow shapes: large circles/arcs via border only (no fill), opacity 5–10%
- Grain texture: optional subtle noise via SVG filter or CSS

━━━ NAVIGATION ━━━
Build slide system in vanilla JS (NO external libraries):
- All slides use class "slide", hidden with display:none
- Only active slide shown with display:flex
- Progress dots at bottom center
- Keyboard: → or Space = next, ← = prev
- Active dot: 8px, var(--accent); inactive: 5px, var(--border)

━━━ TRANSITIONS ━━━
Slide enter: opacity 0 → 1, translateY(12px) → 0, duration 0.45s, ease

━━━ LAYOUT ━━━
Each slide: 100vw × 100vh, overflow hidden, display flex, padding 80px (desktop) / 48px (mobile)
Responsive: @media (max-width: 768px) — scale down font sizes, adjust padding

━━━ CONSTRAINTS ━━━
- 6–10 slides total
- Fully self-contained HTML — only Google Fonts CDN external
- Output ONLY the HTML: start <!DOCTYPE html>, end </html>
- No markdown, no explanation

━━━ CONTENT ━━━
{{CONTENT}}`;

export async function POST(req: NextRequest) {
  if (!hasOperatorAccess(req)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const rawText = formData.get('text') as string | null;

        controller.enqueue(sse('progress', { stage: 'reading' }));

        let content = '';
        if (file) {
          const buffer = Buffer.from(await file.arrayBuffer());
          const ext = file.name.split('.').pop()?.toLowerCase();
          content = ext === 'docx'
            ? (await mammoth.extractRawText({ buffer })).value
            : buffer.toString('utf-8');
        } else if (rawText) {
          content = rawText;
        } else {
          controller.enqueue(sse('error', { message: '請上傳檔案或輸入文字' }));
          controller.close();
          return;
        }

        if (!content.trim()) {
          controller.enqueue(sse('error', { message: '內容為空' }));
          controller.close();
          return;
        }

        controller.enqueue(sse('progress', { stage: 'keywords' }));

        const client = getAnthropicClient(process.env.ANTHROPIC_API_KEY || '');

        // Quick outline via Haiku (fast, fits in Cloudflare timeout)
        const outlineRes = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `用一句話說明這份文件的核心主題，再列出 6-8 個投影片標題（每行一個，不要編號）：\n\n${content.slice(0, 1200)}`,
          }],
        });
        const outline = (outlineRes.content[0] as { type: string; text: string }).text;

        controller.enqueue(sse('progress', { stage: 'designing' }));

        // Sonnet HTML generation — max_tokens capped at 6000 to stay within Cloudflare 100s proxy timeout
        // TODO: raise when bridge adds streaming or Cloudflare timeout is extended
        const prompt = DESIGN_PROMPT.replace('{{CONTENT}}', content.slice(0, 6000));

        const genRes = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 6000,
          system: `You are generating a premium HTML presentation. Structure reference:\n${outline}`,
          messages: [{ role: 'user', content: prompt }],
        });

        let html = (genRes.content[0] as { type: string; text: string }).text.trim();
        if (html.startsWith('```')) {
          html = html.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
        }

        controller.enqueue(sse('done', { html }));
      } catch (err) {
        console.error('[design-x/generate]', err);
        controller.enqueue(sse('error', { message: String(err) }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
