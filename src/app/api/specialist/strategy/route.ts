/**
 * /api/specialist/strategy
 *
 * 策略書 specialist endpoint。由 Firebase Function worker 呼叫（與 image worker 對稱）。
 *
 * 流程：
 * 1. 驗證 x-worker-secret
 * 2. 讀 assignee（預設奧）soul + caller soul（如有）
 * 3. 階段 1（caller 在場時）：caller soul + recentMessages + 用戶原始 brief → Sonnet 4.6 濃縮成 200-400 字 strategy brief
 * 4. 階段 2：assignee soul + STRUCTURE_GUIDE + refined brief → Sonnet 4.6 max_tokens=12000 寫 5000 字 markdown
 * 5. parseMarkdownToBlocks + buildDocx → Firebase Storage（公開 URL）
 * 6. 回傳 { docUrl, docTitle, filename, briefRefined, mdChars, stopReason, stage1Tokens, stage2Tokens }
 *
 * B 後門：assigneeId 由 caller 傳入，不寫死奧。SPECIALIST_MAP 可後續加新 strategist。
 *
 * 預估：90-180 秒 / 約 $0.05-0.08（含 Sonnet 兩階段）
 *
 * @author 築 · 2026-04-26 · Strategist Phase 1
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  PageOrientation, LevelFormat, TableOfContents,
} from 'docx';
import { getFirestore, getFirebaseAdmin } from '@/lib/firebase-admin';

export const maxDuration = 300;
export const runtime = 'nodejs';

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

function buildDocx(blocks: ParsedBlock[], docTitle: string, creator: string): Document {
  const children: Paragraph[] = [];

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
        spacing: { line: 360, after: 120 },
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
    creator,
    title: docTitle,
    styles: {
      default: {
        document: { run: { font: '微軟正黑體', size: 22 } },
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
    features: { updateFields: true },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });
}

export async function POST(req: NextRequest) {
  // 1. 驗證 worker secret
  const secret = req.headers.get('x-worker-secret') || '';
  const expectedSecret = (process.env.WORKER_SECRET || '').replace(/^"|"$/g, '').trim();
  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json() as {
    jobId: string;
    assigneeId: string;
    brief: { prompt: string };
    context?: {
      callerCharacterId?: string;
      callerCharacterName?: string;
      recentMessages?: Array<{ role: string; content: string }>;
    };
  };

  const { jobId, assigneeId, brief } = body;
  if (!brief?.prompt) return NextResponse.json({ error: 'brief.prompt 必填' }, { status: 400 });
  if (!assigneeId) return NextResponse.json({ error: 'assigneeId 必填' }, { status: 400 });

  try {
    const db = getFirestore();

    // 2. 解析 context — 優先 body.context；否則用 jobId 從 platform_jobs 撈 requester info
    //   (worker forward body 可能不完整，自己讀 jobs 最穩)
    let callerCharacterId = body.context?.callerCharacterId || '';
    let callerName = body.context?.callerCharacterName || '';
    let recentMessages = body.context?.recentMessages || [];
    let requesterConvId = '';
    if (jobId && (!callerCharacterId || recentMessages.length === 0)) {
      const jobDoc = await db.collection('platform_jobs').doc(jobId).get();
      if (jobDoc.exists) {
        const jobData = jobDoc.data()!;
        if (!callerCharacterId) callerCharacterId = String(jobData.requesterId || '');
        requesterConvId = String(jobData.requesterConvId || '');
        // jobs.context.recentMessages（如果 caller 寫了）
        const jobCtxMsgs = jobData?.context?.recentMessages;
        if (Array.isArray(jobCtxMsgs) && recentMessages.length === 0) {
          recentMessages = jobCtxMsgs;
        }
      }
    }

    // 3. 讀 assignee soul
    const assigneeDoc = await db.collection('platform_characters').doc(assigneeId).get();
    if (!assigneeDoc.exists) throw new Error(`assignee ${assigneeId} 不存在`);
    const assignee = assigneeDoc.data()!;
    const assigneeSoul = `${String(assignee.system_soul || '')}\n\n${String(assignee.soul_core || '')}`.trim();
    const assigneeName = String(assignee.name || 'Specialist');

    // 讀 caller soul + name
    let callerSoul = '';
    if (callerCharacterId) {
      const callerDoc = await db.collection('platform_characters').doc(callerCharacterId).get();
      if (callerDoc.exists) {
        const caller = callerDoc.data()!;
        callerSoul = `${String(caller.system_soul || '')}\n\n${String(caller.soul_core || '')}`.trim();
        if (!callerName) callerName = String(caller.name || '');
      }
    }

    // recentMessages 還是空 → 用 conversationId 從 platform_conversations 撈最近 8 條
    if (recentMessages.length === 0 && requesterConvId) {
      const convDoc = await db.collection('platform_conversations').doc(requesterConvId).get();
      if (convDoc.exists) {
        const convData = convDoc.data();
        const allMsgs = Array.isArray(convData?.messages) ? convData.messages : [];
        recentMessages = allMsgs.slice(-8).map((m: Record<string, unknown>) => ({
          role: String(m.role || 'user'),
          content: String(m.content || '').slice(0, 800),
        }));
      }
    }

    const apiKey = (process.env.ANTHROPIC_API_KEY || '').replace(/^"|"$/g, '');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
    const anthropic = getAnthropicClient(apiKey);

    // 4. 階段 1：caller 把對話脈絡濃縮成 brief
    let refinedBrief = brief.prompt;
    let stage1Tokens = { input: 0, output: 0 };
    if (callerSoul) {
      const recentText = recentMessages
        .map(m => `${m.role === 'user' ? '用戶' : (callerName || '我')}：${m.content}`)
        .join('\n');

      const refineSystem = `${callerSoul}

---

你是 ${callerName || '當前角色'}。剛才用戶跟你聊到要委託 ${assigneeName} 寫一份策略書／規劃書。
請把以下對話脈絡與用戶請求濃縮成一份 200-400 字的 brief，給 ${assigneeName} 看，包含：
- 用戶的處境與背景
- 用戶的目標與期望
- 受眾或場域（若有提及）
- 任何特殊要求（風格、字數、結構偏好、產業細節）

寫給 ${assigneeName} 看。第三人稱描述用戶，不要替 ${assigneeName} 動筆寫策略書內容。直接輸出 brief，不要前言、不要標題、不要 markdown。`;

      const refineUser = recentText
        ? `對話脈絡：\n${recentText}\n\n用戶最新請求：${brief.prompt}`
        : `用戶請求：${brief.prompt}`;

      const refineRes = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: refineSystem,
        messages: [{ role: 'user', content: refineUser }],
      });
      refinedBrief = (refineRes.content[0] as { text: string }).text.trim();
      stage1Tokens = {
        input: refineRes.usage.input_tokens,
        output: refineRes.usage.output_tokens,
      };
    }

    // 5. 階段 2：assignee（奧）寫 5000 字 markdown
    const writeSystem = `${assigneeSoul}\n\n---\n\n${STRUCTURE_GUIDE}`;
    const writeRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 12000,
      system: writeSystem,
      messages: [{ role: 'user', content: refinedBrief }],
    });
    const md = (writeRes.content[0] as { type: string; text: string }).text;
    const stopReason = writeRes.stop_reason;
    const stage2Tokens = {
      input: writeRes.usage.input_tokens,
      output: writeRes.usage.output_tokens,
    };

    // 6. markdown → docx
    const blocks = parseMarkdownToBlocks(md);
    const titleBlock = blocks.find(b => b.type === 'h1');
    const docTitle = titleBlock?.text || '策略規劃書';
    const creator = `${assigneeName}（via AILIVE Strategist）`;
    const doc = buildDocx(blocks, docTitle, creator);
    const buffer = await Packer.toBuffer(doc);

    // 7. 上 Firebase Storage（公開 URL）
    const admin2 = getFirebaseAdmin();
    const bucket = admin2.storage().bucket();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const briefSnippet = brief.prompt
      .slice(0, 10)
      .replace(/[\\/:*?"<>|\s]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const callerPart = callerName ? `${callerName}-` : '';
    const filename = `${callerPart}${briefSnippet || 'strategy'}-${date}.docx`;
    const filePath = `platform-specialist-docs/${assigneeId}/${jobId || date}-${filename}`;
    const file = bucket.file(filePath);
    await file.save(buffer, {
      metadata: {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
    await file.makePublic();
    const docUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

    console.log(`[specialist/strategy] job=${jobId?.slice(0, 8)} caller=${callerName || '-'} assignee=${assigneeName} chars=${md.length} stop=${stopReason} url=${docUrl.slice(-50)}`);

    // 8. 寫回 platform_jobs（成功）— internal dispatch 模式：worker 不處理 strategy，由我們自己更新
    if (jobId) {
      try {
        await db.collection('platform_jobs').doc(jobId).update({
          status: 'done',
          result: { docUrl, docTitle, filename, mdChars: md.length, stopReason },
          completedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[specialist/strategy] write back jobs failed:', e);
      }
    }

    return NextResponse.json({
      docUrl,
      docTitle,
      filename,
      briefRefined: refinedBrief,
      mdChars: md.length,
      stopReason,
      stage1Tokens,
      stage2Tokens,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[specialist/strategy] error: ${msg}`);
    // 寫回 platform_jobs（失敗）
    if (jobId) {
      try {
        const db2 = getFirestore();
        await db2.collection('platform_jobs').doc(jobId).update({
          status: 'failed',
          error: msg,
          completedAt: new Date().toISOString(),
        });
      } catch {}
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
