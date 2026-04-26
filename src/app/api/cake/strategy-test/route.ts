/**
 * ⚠️ 此檔已升格為正式 specialist（2026-04-26）
 *
 * 正式版：/api/specialist/strategy
 * 差異：
 *   - 接 commission_specialist tool（dialogue / voice-stream）
 *   - 兩階段 Sonnet：caller 濃縮 brief → 奧寫長文
 *   - assigneeId 由 caller 傳入（B 後門：未來可換 strategist）
 *   - dashboard /[id]/strategies 顯示
 *
 * 本檔保留作 PoC 歷史參考，不要新功能進這裡。
 * 待刪日：strategist 跑 1 個月穩定後評估（最早 2026-05-26）。
 *
 * ───
 *
 * Cake 2: Strategy Test
 *
 * 目的：驗證 Phase 2 策略 specialist 的完整鏈路
 *   1. 取角色（奧）的靈魂
 *   2. Sonnet 4.6 一次大長文 generation（max_tokens=12000，目標輸出 5000 中文字）
 *   3. Markdown → docx 組裝（內化 SKILL.md best practices：Arial、明確 page size、proper headings/bullets）
 *   4. 上 Firebase Storage 取 public URL
 *   5. metrics 寫 platform_cake_logs
 *
 * Brief（Adam 提供）：
 *   「為一個 AI 陪伴系統寫一份產品策略規劃書，約 5000 字。
 *    這個系統的核心是『讓逝者以 AI 形式回來對話』。
 *    奧請用你的4A專業撰寫一份完整的策略規劃」
 *
 * 拆台：跑完移除整個 /api/cake/ 目錄
 *
 * @author 築 · 2026-04-21（Phase 2 PoC）
 */
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  PageOrientation, LevelFormat, TableOfContents,
} from 'docx';
import { getFirestore, getFirebaseAdmin } from '@/lib/firebase-admin';

export const maxDuration = 300;
export const runtime = 'nodejs';

const AO_ID = 'pEWC5m2MOddyGe9uw0u0';
const BRIEF = `為一個 AI 陪伴系統寫一份產品策略規劃書，約 5000 字。這個系統的核心是「讓逝者以 AI 形式回來對話」。奧請用你的4A專業撰寫一份完整的策略規劃。`;

const STRUCTURE_GUIDE = `
請用繁體中文輸出 markdown 格式的完整策略規劃書，目標約 5000 字。

格式要求（嚴格遵守，後處理會 parse）：
- 第一行：# 文件標題
- 章節標題：## 章節名（建議 6-10 個章節）
- 小節標題：### 小節名
- 段落：純文字段落，每段 2-5 句，避免一行流水帳
- 列點：用 "- " 開頭（無序）或 "1. " 開頭（有序）
- 不使用粗體、斜體、引用、表格、程式碼塊（純 markdown 章節結構即可）
- 不使用 emoji
- 段落之間空一行

請直接輸出 markdown 內容，不要包在 \`\`\` 代碼塊裡，不要前言不要後語，第一個字就是 #。
`;

interface ParsedBlock {
  type: 'h1' | 'h2' | 'h3' | 'paragraph' | 'bullet' | 'numbered';
  text?: string;
  items?: string[];
}

function parseMarkdownToBlocks(md: string): ParsedBlock[] {
  const lines = md.split('\n');
  const blocks: ParsedBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }
    if (trimmed.startsWith('# ')) { blocks.push({ type: 'h1', text: trimmed.slice(2).trim() }); i++; continue; }
    if (trimmed.startsWith('## ')) { blocks.push({ type: 'h2', text: trimmed.slice(3).trim() }); i++; continue; }
    if (trimmed.startsWith('### ')) { blocks.push({ type: 'h3', text: trimmed.slice(4).trim() }); i++; continue; }
    if (/^[-*]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'bullet', items });
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'numbered', items });
      continue;
    }
    blocks.push({ type: 'paragraph', text: trimmed });
    i++;
  }
  return blocks;
}

function buildDocx(blocks: ParsedBlock[]): Document {
  const children: Paragraph[] = [];

  // 目錄（放最前面）— 章節超過 3 個才加
  const sectionCount = blocks.filter(b => b.type === 'h2').length;
  if (sectionCount >= 3) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: '目錄' })],
      }),
      new Paragraph({
        children: [new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' })],
      }),
      new Paragraph({ children: [new TextRun('')] }),
    );
  }

  for (const b of blocks) {
    if (b.type === 'h1') {
      children.push(new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: b.text || '' })],
      }));
      children.push(new Paragraph({ children: [new TextRun('')] }));
    } else if (b.type === 'h2') {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: b.text || '' })],
      }));
    } else if (b.type === 'h3') {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: b.text || '' })],
      }));
    } else if (b.type === 'paragraph') {
      children.push(new Paragraph({
        children: [new TextRun({ text: b.text || '' })],
        spacing: { line: 360, after: 120 }, // 1.5 行距
      }));
    } else if (b.type === 'bullet') {
      for (const item of (b.items || [])) {
        children.push(new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          children: [new TextRun({ text: item })],
        }));
      }
    } else if (b.type === 'numbered') {
      for (const item of (b.items || [])) {
        children.push(new Paragraph({
          numbering: { reference: 'numbers', level: 0 },
          children: [new TextRun({ text: item })],
        }));
      }
    }
  }

  return new Document({
    creator: '奧 (via 築 Cake 2)',
    title: '策略規劃書',
    styles: {
      default: {
        document: { run: { font: '微軟正黑體', size: 22 } }, // 11pt
      },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 40, bold: true, font: '微軟正黑體' },
          paragraph: { spacing: { before: 240, after: 360 }, alignment: AlignmentType.CENTER } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 30, bold: true, font: '微軟正黑體' },
          paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, font: '微軟正黑體' },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: 'numbers',
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    features: { updateFields: true }, // 開啟後 Word 開檔時會問是否更新目錄
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT }, // A4
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });
}

export async function POST() {
  const t0 = Date.now();
  const metrics: Record<string, unknown> = { cake: 'strategy', startedAt: new Date().toISOString() };

  try {
    // 1. 讀奧
    const tReadStart = Date.now();
    const db = getFirestore();
    const aoDoc = await db.collection('platform_characters').doc(AO_ID).get();
    if (!aoDoc.exists) throw new Error('奧不存在');
    const ao = aoDoc.data()!;
    const systemSoul: string = String(ao.system_soul || '');
    const soulCore: string = String(ao.soul_core || '');
    const aoSoul = `${systemSoul}\n\n${soulCore}`.trim();
    metrics.ao_soul_chars = aoSoul.length;
    metrics.t_read_soul_ms = Date.now() - tReadStart;

    // 2. Sonnet 4.6 一次大長文 generation
    const apiKey = (process.env.ANTHROPIC_API_KEY || '').replace(/^"|"$/g, '');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
    const anthropic = new Anthropic({ apiKey });

    const tLLMStart = Date.now();
    const sysPrompt = `${aoSoul}\n\n---\n\n${STRUCTURE_GUIDE}`;
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 12000,
      system: sysPrompt,
      messages: [{ role: 'user', content: BRIEF }],
    });
    metrics.t_llm_ms = Date.now() - tLLMStart;
    metrics.input_tokens = res.usage.input_tokens;
    metrics.output_tokens = res.usage.output_tokens;
    metrics.stop_reason = res.stop_reason;

    const md = (res.content[0] as { type: string; text: string }).text;
    metrics.md_chars = md.length;
    metrics.md_chars_no_whitespace = md.replace(/\s/g, '').length;

    // 3. 解析 markdown → docx
    const tDocxStart = Date.now();
    const blocks = parseMarkdownToBlocks(md);
    metrics.block_count = blocks.length;
    metrics.h2_count = blocks.filter(b => b.type === 'h2').length;
    const doc = buildDocx(blocks);
    const buffer = await Packer.toBuffer(doc);
    metrics.docx_bytes = buffer.byteLength;
    metrics.t_docx_ms = Date.now() - tDocxStart;

    // 4. 上 Firebase Storage
    const tStorageStart = Date.now();
    const admin2 = getFirebaseAdmin();
    const bucket = admin2.storage().bucket();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = `platform-cake-docs/strategy-${stamp}.docx`;
    const file = bucket.file(filePath);
    await file.save(buffer, {
      metadata: {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentDisposition: `attachment; filename="strategy-${stamp}.docx"`,
      },
    });
    await file.makePublic();
    const docUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    metrics.t_storage_ms = Date.now() - tStorageStart;
    metrics.doc_url = docUrl;

    // 5. 寫 platform_cake_logs
    metrics.t_total_ms = Date.now() - t0;
    metrics.completedAt = new Date().toISOString();
    metrics.md_sample = md.slice(0, 500);
    await db.collection('platform_cake_logs').add(metrics);

    return NextResponse.json({
      success: true,
      docUrl,
      metrics: {
        t_total_ms: metrics.t_total_ms,
        t_llm_ms: metrics.t_llm_ms,
        t_docx_ms: metrics.t_docx_ms,
        t_storage_ms: metrics.t_storage_ms,
        md_chars: metrics.md_chars,
        md_chars_no_whitespace: metrics.md_chars_no_whitespace,
        input_tokens: metrics.input_tokens,
        output_tokens: metrics.output_tokens,
        stop_reason: metrics.stop_reason,
        block_count: metrics.block_count,
        h2_count: metrics.h2_count,
        docx_bytes: metrics.docx_bytes,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    metrics.error = msg;
    metrics.t_total_ms = Date.now() - t0;
    try {
      const db = getFirestore();
      await db.collection('platform_cake_logs').add(metrics);
    } catch {}
    return NextResponse.json({ success: false, error: msg, metrics }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    info: 'Cake 2: Strategy Test endpoint',
    usage: 'POST 觸發。預估 2-3 分鐘。',
    brief: BRIEF,
  });
}
