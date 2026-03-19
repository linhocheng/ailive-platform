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
import mammoth from 'mammoth';

export const maxDuration = 120;

// ===== 文字分塊 =====
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
async function describeImage(client: Anthropic, base64Data: string, contentType: string): Promise<string> {
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
    return (res.content[0] as Anthropic.TextBlock).text.trim();
  } catch {
    return '圖片內容無法識別';
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

    if (ext === 'docx') {
      // 純文字
      const rawResult = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      text = rawResult.value;

      // 抽圖片 — 獨立建檔
      let imgIndex = 0;
      await mammoth.convertToHtml(
        { buffer: Buffer.from(buffer) },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            imgIndex++;
            try {
              const base64 = await image.readAsBase64String();
              const ct = image.contentType || 'image/png';
              const [imageUrl, description] = await Promise.all([
                uploadImageToStorage(base64, ct, characterId, imgIndex),
                describeImage(client, base64, ct),
              ]);
              const id = await saveKnowledge(
                baseUrl, characterId,
                `${filename} — 圖片 ${imgIndex}`,
                `${description}\n\n圖片網址：${imageUrl}`,
                'image', imageUrl,
              );
              if (id) imageIds.push(id);
              else imageFailed++;
            } catch { imageFailed++; }
            return { src: '' };
          }),
        }
      );

    } else if (ext === 'pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(Buffer.from(buffer));
      text = data.text;
    } else {
      return NextResponse.json({ error: '只支援 .pdf 和 .docx' }, { status: 400 });
    }

    // 文字分塊存入
    const textIds: string[] = [];
    let textFailed = 0;
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
