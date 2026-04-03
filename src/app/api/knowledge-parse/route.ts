/**
 * /api/knowledge-parse — 從 Firebase Storage 下載文件，解析存入知識庫
 *
 * POST { storagePath, characterId, filename, category? }
 * → { success, text: { chunks, failed }, images: { chunks, failed } }
 *
 * .docx → mammoth 抽文字 + 圖片各自獨立建檔
 * .pdf  → pdf-parse（純文字）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import Anthropic from '@anthropic-ai/sdk';
import { trackCost } from '@/lib/cost-tracker';
import mammoth from 'mammoth';

export const maxDuration = 120;

// ===== 文字分塊 =====

// ===== Markdown 分塊（按 # / ## 切，適合結構化 md 檔）=====
// H1 = 產品名稱（parentTitle），H2 = 段落名稱
// title 格式：「產品名稱 — 段落名稱」，讓每條知識都知道自己屬於哪個產品
function cleanMarkdownContent(raw: string): string {
  return raw
    .split('\n')
    .filter(line => {
      // 移除純分隔線 --- 和表格分隔行 |---|
      if (/^---+$/.test(line.trim())) return false;
      if (/^\|[-\s|]+\|$/.test(line.trim())) return false;
      return true;
    })
    .map(line => {
      // 表格資料行 | A | B | → A：B（保留語意，去掉語法）
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
        if (cells.length >= 2) return cells.join('：');
        if (cells.length === 1) return cells[0];
        return '';
      }
      // 移除 ** 粗體標記，保留內容
      return line.replace(/\*\*/g, '');
    })
    .filter(line => line.trim().length > 0)
    .join('\n')
    .trim();
}

function chunkMarkdown(md: string, filename: string): Array<{ title: string; content: string }> {
  const lines = md.split('\n');
  const chunks: Array<{ title: string; content: string }> = [];
  let parentTitle = '';  // H1 = 產品名稱
  let sectionTitle = ''; // H2 = 段落名稱
  let currentContent: string[] = [];

  const flush = () => {
    const raw = currentContent.join('\n').trim();
    const cleaned = cleanMarkdownContent(raw);
    if (cleaned.length > 20) {
      const title = parentTitle && sectionTitle
        ? `${parentTitle} — ${sectionTitle}`
        : parentTitle || sectionTitle || filename;
      chunks.push({ title, content: cleaned });
    }
    currentContent = [];
  };

  for (const line of lines) {
    if (line.startsWith('# ')) {
      flush();
      parentTitle = line.replace(/^#\s+/, '').trim();
      sectionTitle = '';
    } else if (line.startsWith('## ')) {
      flush();
      sectionTitle = line.replace(/^##\s+/, '').trim();
    } else {
      currentContent.push(line);
    }
  }
  flush();

  if (chunks.length === 0 && md.trim().length > 0) {
    chunks.push({ title: filename, content: cleanMarkdownContent(md.trim()) });
  }

  return chunks;
}

function chunkText(text: string, filename: string): Array<{ title: string; content: string }> {
  const lines = text.split('\n');
  const chunks: Array<{ title: string; content: string }> = [];
  let currentTitle = '';
  let currentContent: string[] = [];
  let chunkIndex = 0;

  const flush = () => {
    const content = currentContent.join('\n').trim();
    if (content.length > 30) {
      chunks.push({ title: currentTitle || `${filename} — 段落 ${++chunkIndex}`, content });
    }
    currentContent = [];
  };

  for (const line of lines) {
    if (line.startsWith('# ') || line.startsWith('## ')) {
      flush();
      currentTitle = line.replace(/^#+\s+/, '').trim();
    } else if (line.trim().length > 0 && line.trim().length < 60 && line === line.toUpperCase() && /[A-Z\u4e00-\u9fff]/.test(line)) {
      flush();
      currentTitle = line.trim();
    } else {
      currentContent.push(line);
      if (currentContent.join('\n').length > 800) flush();
    }
  }
  flush();

  if (chunks.length === 0 && text.trim().length > 0) {
    const words = text.trim();
    for (let i = 0; i < words.length; i += 800) {
      chunks.push({ title: `${filename} — 段落 ${chunks.length + 1}`, content: words.slice(i, i + 800) });
    }
  }

  return chunks;
}

// ===== 圖片上傳 Firebase Storage =====
async function uploadImageToStorage(
  base64Data: string,
  contentType: string,
  characterId: string,
  index: number,
): Promise<string> {
  const admin = getFirebaseAdmin();
  const bucket = admin.storage().bucket();
  const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : contentType.includes('webp') ? 'webp' : 'jpg';
  const date = new Date().toISOString().slice(0, 10);
  const path = `knowledge-images/${characterId}/${date}/img_${index}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buffer = Buffer.from(base64Data, 'base64');
  const file = bucket.file(path);
  await file.save(buffer, { metadata: { contentType } });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${path}`;
}

// ===== Haiku 描述圖片 =====
async function describeImage(client: Anthropic, base64Data: string, contentType: string): Promise<{ description: string; inputTokens: number; outputTokens: number }> {
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: contentType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64Data } },
          { type: 'text', text: '這張圖片是什麼產品？只輸出商品名稱，不超過20字，不要其他說明。' },
        ],
      }],
    });
    return {
      description: (res.content[0] as Anthropic.TextBlock).text.trim(),
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    };
  } catch {
    return { description: '圖片內容無法識別', inputTokens: 0, outputTokens: 0 };
  }
}

// ===== 儲存 knowledge 條目 =====
async function saveKnowledge(
  baseUrl: string, characterId: string, title: string,
  content: string, category: string, imageUrl?: string,
): Promise<string | null> {
  try {
    const body: Record<string, string> = { characterId, title, content, category };
    if (imageUrl) body.imageUrl = imageUrl;
    const res = await fetch(`${baseUrl}/api/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.id || null;
  } catch {
    return null;
  }
}

// ===== 主流程 =====
export async function POST(req: NextRequest) {
  try {
    const { storagePath, characterId, filename, category } = await req.json();
    if (!storagePath || !characterId || !filename) {
      return NextResponse.json({ error: 'storagePath, characterId, filename 必填' }, { status: 400 });
    }

    const ext = filename.split('.').pop()?.toLowerCase();
    const admin = getFirebaseAdmin();
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [buffer] = await file.download();
    const baseUrl = req.nextUrl.origin;
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    const client = new Anthropic({ apiKey });

    let text = '';
    const imageIds: string[] = [];
    let imageFailed = 0;
    const textIds: string[] = [];
    let textFailed = 0;

    if (ext === 'docx') {
      // 純文字
      const rawResult = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      text = rawResult.value;

      // 抽圖片：mammoth 轉 HTML，按 <th>/<td> 同格抽圖說 + base64
      // 圖說和圖片在同一格，對應絕對準確
      const htmlResult = await mammoth.convertToHtml({ buffer: Buffer.from(buffer) });
      const htmlStr = htmlResult.value;

      const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      const imgSrcRegex = /src="data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)"/;
      const tagRegex = /<[^>]+>/g;

      let cellMatch;
      let imgIndex = 0;
      while ((cellMatch = cellRegex.exec(htmlStr)) !== null) {
        const cellHtml = cellMatch[1];
        const imgMatch = imgSrcRegex.exec(cellHtml);
        if (!imgMatch) continue;

        imgIndex++;
        try {
          const contentType = imgMatch[1];
          const base64 = imgMatch[2];

          // 抽圖說：移除 HTML 標籤和圖片 src
          const rawText = cellHtml.replace(imgSrcRegex, '').replace(tagRegex, ' ').replace(/\s+/g, ' ').trim();
          const caption = rawText.replace(/ /g, ' ').trim();

          const imageUrl = await uploadImageToStorage(base64, contentType, characterId, imgIndex);

          const title = caption || `${filename} — 圖片 ${imgIndex}`;
          const id = await saveKnowledge(
            baseUrl, characterId,
            title,
            `圖片網址：${imageUrl}`,
            'image', imageUrl,
          );
          if (id) imageIds.push(id);
          else imageFailed++;
        } catch { imageFailed++; }
      }

    } else if (ext === 'pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(Buffer.from(buffer));
      text = data.text;
    } else if (ext === 'md' || ext === 'txt') {
      // Markdown / 純文字：直接讀取，用 chunkMarkdown 分塊（不走 chunkText）
      const mdText = Buffer.from(buffer).toString('utf-8');
      const mdChunks = chunkMarkdown(mdText, filename);
      for (let i = 0; i < mdChunks.length; i++) {
        const id = await saveKnowledge(baseUrl, characterId, mdChunks[i].title || `${filename} — 段落 ${i + 1}`, mdChunks[i].content, category || 'document');
        if (id) textIds.push(id);
        else textFailed++;
      }
      // 跳過後面的 chunkText 流程
      await file.delete().catch(() => {});
      return NextResponse.json({
        success: true,
        filename,
        text: { chunks: textIds.length, failed: textFailed, ids: textIds },
        images: { chunks: imageIds.length, failed: imageFailed, ids: imageIds },
      });
    } else {
      return NextResponse.json({ error: '只支援 .pdf、.docx、.md、.txt' }, { status: 400 });
    }

    // 文字分塊存入（pdf / docx 走這裡，md/txt 已在上面 return）
    if (text.trim()) {
      const chunks = chunkText(text, filename);
      for (let i = 0; i < chunks.length; i++) {
        const id = await saveKnowledge(baseUrl, characterId, chunks[i].title, chunks[i].content, category || 'document');
        if (id) textIds.push(id);
        else textFailed++;
      }
    }

    await file.delete().catch(() => {});

    return NextResponse.json({
      success: true,
      filename,
      text: { chunks: textIds.length, failed: textFailed, ids: textIds },
      images: { chunks: imageIds.length, failed: imageFailed, ids: imageIds },
    });

  } catch (e: unknown) {
    console.error('[knowledge-parse]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
