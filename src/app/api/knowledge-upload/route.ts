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
 *   圖片  → 上傳 Firebase Storage（永久 URL）+ Claude Haiku 描述
 *           → 圖片獨立存成 knowledge 條目（category='image'）
 *   文字  → 按 H1/H2 分塊 → 批次存 platform_knowledge
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getFirebaseAdmin } from '@/lib/firebase-admin';

export const maxDuration = 120;

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

/**
 * 上傳圖片 base64 到 Firebase Storage → 永久 URL
 */
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

/**
 * Claude Haiku 描述圖片（繁中）
 */
async function describeImage(
  client: Anthropic,
  base64Data: string,
  contentType: string,
): Promise<string> {
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
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
            text: '請用繁體中文詳細描述這張圖片的內容，包括：產品外觀、文字、顏色、圖表數據、圖示等所有重要資訊。150字以內。',
          },
        ],
      }],
    });
    return (res.content[0] as Anthropic.TextBlock).text.trim();
  } catch {
    return '圖片內容無法識別';
  }
}

/**
 * 儲存一筆 knowledge 條目（呼叫 /api/knowledge POST）
 */
async function saveKnowledge(
  baseUrl: string,
  characterId: string,
  title: string,
  content: string,
  category: string,
  imageUrl?: string,
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
    const baseUrl = req.nextUrl.origin;

    let markdown = '';
    const imageIds: string[] = [];
    let imageFailed = 0;

    if (ext === 'docx') {
      // ===== DOCX：文字 + 圖片獨立建檔 =====
      const mammoth = await import('mammoth');
      let imgIndex = 0;

      // 先拿純文字
      const rawResult = await mammoth.extractRawText({ buffer });
      markdown = rawResult.value;

      // 再跑一次專門抽圖片
      await mammoth.convertToHtml(
        { buffer },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            imgIndex++;
            try {
              const base64 = await image.readAsBase64String();
              const ct = image.contentType || 'image/png';

              // 並行：上傳圖片 + Haiku 描述
              const [imageUrl, description] = await Promise.all([
                uploadImageToStorage(base64, ct, characterId, imgIndex),
                describeImage(client, base64, ct),
              ]);

              // 圖片獨立存成 knowledge 條目
              const title = `${file.name} — 圖片 ${imgIndex}`;
              const content = `${description}\n\n圖片網址：${imageUrl}`;
              const id = await saveKnowledge(baseUrl, characterId, title, content, 'image', imageUrl);
              if (id) imageIds.push(id);
              else imageFailed++;
            } catch {
              imageFailed++;
            }
            return { src: '' };
          }),
        }
      );

    } else {
      // ===== PDF：pdf-parse（純文字）=====
      const pdfParse = await import('pdf-parse');
      const pdfParser = (pdfParse as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default || pdfParse;
      const data = await pdfParser(buffer);
      markdown = data.text;
    }

    // ===== 文字分塊存知識庫 =====
    const textIds: string[] = [];
    let textFailed = 0;

    if (markdown.trim()) {
      const chunks = chunkMarkdown(markdown, file.name);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const id = await saveKnowledge(
          baseUrl,
          characterId,
          chunk.title || `${file.name} — 段落 ${i + 1}`,
          chunk.content,
          category,
        );
        if (id) textIds.push(id);
        else textFailed++;
      }
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      format: ext,
      text: { chunks: textIds.length, failed: textFailed, ids: textIds },
      images: { chunks: imageIds.length, failed: imageFailed, ids: imageIds },
    });

  } catch (e: unknown) {
    console.error('[knowledge-upload]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
