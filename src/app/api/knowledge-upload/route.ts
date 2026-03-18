/**
 * /api/knowledge-upload — 文件上傳解析入知識庫
 *
 * POST multipart/form-data
 *   file: .docx 或 .pdf
 *   characterId: string
 *   category: string（選填，預設 'document'）
 *
 * 流程：
 *   .docx → mammoth（文字 + 圖片 base64）
 *   .pdf  → pdf-parse（文字）
 *   圖片  → Claude Haiku 描述成繁中文字
 *   文字  → 按 H1/H2 分塊 → 批次存 platform_knowledge
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 120;

// 解除 Vercel 4.5MB 預設限制，允許最大 20MB 文件
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '20mb',
  },
};

// ===== 工具函式 =====

function chunkMarkdown(md: string, filename: string): Array<{ title: string; content: string }> {
  const lines = md.split('\n');
  const chunks: Array<{ title: string; content: string }> = [];
  let currentTitle = '';
  let currentContent: string[] = [];

  const flush = () => {
    const content = currentContent.join('\n').trim();
    if (content.length > 20) chunks.push({ title: currentTitle, content });
    currentContent = [];
  };

  for (const line of lines) {
    if (line.startsWith('# ') || line.startsWith('## ')) {
      flush();
      currentTitle = line.replace(/^#+\s+/, '').trim();
    } else {
      currentContent.push(line);
    }
  }
  flush();

  if (chunks.length === 0 && md.trim().length > 0) {
    chunks.push({ title: filename, content: md.trim() });
  }

  return chunks;
}

async function describeImage(
  client: Anthropic,
  base64Data: string,
  contentType: string
): Promise<string> {
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: contentType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: base64Data,
            },
          },
          {
            type: 'text',
            text: '請用繁體中文描述這張圖片的內容，包括文字、圖表、圖示等重要資訊。100字以內。',
          },
        ],
      }],
    });
    const desc = (res.content[0] as Anthropic.TextBlock).text.trim();
    return `\n[圖片說明：${desc}]\n`;
  } catch (e) {
    return '\n[圖片：無法描述]\n';
  }
}

// ===== 主流程 =====

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const characterId = formData.get('characterId') as string;
    const category = (formData.get('category') as string) || 'document';

    if (!file || !characterId) {
      return NextResponse.json({ error: 'file 和 characterId 必填' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx'].includes(ext || '')) {
      return NextResponse.json({ error: '只支援 .pdf 和 .docx' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    const client = new Anthropic({ apiKey });
    const buffer = Buffer.from(await file.arrayBuffer());
    let markdown = '';

    if (ext === 'docx') {
      // ===== DOCX：mammoth + 圖片 Claude 描述 =====
      const mammoth = await import('mammoth');
      const imageDescriptions: string[] = [];

      const result = await mammoth.convertToHtml(
        { buffer },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            const base64 = await image.readAsBase64String();
            const ct = image.contentType || 'image/png';
            const desc = await describeImage(client, base64, ct);
            imageDescriptions.push(desc);
            // 在 HTML 裡插入佔位文字（後面從 rawText 重組）
            return { src: '' }; // 圖不顯示，內容在 rawText 裡補
          }),
        }
      );

      // 同時拿純文字（不含圖片）
      const rawResult = await mammoth.extractRawText({ buffer });
      let rawText = rawResult.value;

      // 把圖片描述插在文字末尾（簡化處理，不精確定位）
      if (imageDescriptions.length > 0) {
        rawText += '\n\n## 文件圖片內容\n' + imageDescriptions.join('\n');
      }

      markdown = rawText;

    } else {
      // ===== PDF：pdf-parse（純文字）=====
      const pdfParse = await import('pdf-parse');
      const pdfParser = (pdfParse as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default || pdfParse;
      const data = await pdfParser(buffer);
      markdown = data.text;
    }

    if (!markdown.trim()) {
      return NextResponse.json({ error: '文件解析後內容為空' }, { status: 400 });
    }

    // 分塊
    const chunks = chunkMarkdown(markdown, file.name);
    if (chunks.length === 0) {
      return NextResponse.json({ error: '找不到有效內容' }, { status: 400 });
    }

    // 批次存進知識庫
    const baseUrl = req.nextUrl.origin;
    const ids: string[] = [];
    const failed: number[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const res = await fetch(`${baseUrl}/api/knowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characterId,
            title: chunk.title || `${file.name} — 段落 ${i + 1}`,
            content: chunk.content,
            category,
          }),
        });
        const data = await res.json();
        if (data.id) ids.push(data.id);
        else failed.push(i);
      } catch {
        failed.push(i);
      }
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      format: ext,
      totalChunks: chunks.length,
      saved: ids.length,
      failed: failed.length,
      ids,
    });

  } catch (e: unknown) {
    console.error('[knowledge-upload]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
