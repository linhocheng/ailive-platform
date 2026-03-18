/**
 * /api/knowledge-parse — 從 Firebase Storage 下載文件，解析存入知識庫
 *
 * POST { storagePath, characterId, filename, category? }
 * → { success, saved, failed, totalChunks }
 *
 * 解析方式（純 Node.js，Vercel 相容）：
 *   .docx → mammoth（extractRawText）
 *   .pdf  → pdf-parse
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import mammoth from 'mammoth';
// @ts-expect-error pdf-parse 無型別宣告
import pdfParse from 'pdf-parse';

export const maxDuration = 120;

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
    // 偵測標題行（全大寫短行、或 markdown # 開頭）
    if (line.startsWith('# ') || line.startsWith('## ')) {
      flush();
      currentTitle = line.replace(/^#+\s+/, '').trim();
    } else if (line.trim().length > 0 && line.trim().length < 60 && line === line.toUpperCase() && /[A-Z\u4e00-\u9fff]/.test(line)) {
      // 全大寫短行視為標題
      flush();
      currentTitle = line.trim();
    } else {
      currentContent.push(line);
      // 每 800 字自動切塊（避免 embedding 超長）
      if (currentContent.join('\n').length > 800) {
        flush();
      }
    }
  }
  flush();

  if (chunks.length === 0 && text.trim().length > 0) {
    // 整份文件當一個 chunk（超長則切段）
    const words = text.trim();
    for (let i = 0; i < words.length; i += 800) {
      chunks.push({ title: `${filename} — 段落 ${chunks.length + 1}`, content: words.slice(i, i + 800) });
    }
  }

  return chunks;
}

export async function POST(req: NextRequest) {
  try {
    const { storagePath, characterId, filename, category } = await req.json();

    if (!storagePath || !characterId || !filename) {
      return NextResponse.json({ error: 'storagePath, characterId, filename 必填' }, { status: 400 });
    }

    const ext = filename.split('.').pop()?.toLowerCase();

    // 從 Firebase Storage 下載文件
    const admin = getFirebaseAdmin();
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [buffer] = await file.download();

    // 解析文字
    let text = '';
    if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      text = result.value;
    } else if (ext === 'pdf') {
      const data = await pdfParse(Buffer.from(buffer));
      text = data.text;
    } else {
      return NextResponse.json({ error: '只支援 .pdf 和 .docx' }, { status: 400 });
    }

    if (!text.trim()) {
      return NextResponse.json({ error: '文件解析後內容為空' }, { status: 400 });
    }

    // 分塊
    const chunks = chunkText(text, filename);
    if (chunks.length === 0) {
      return NextResponse.json({ error: '找不到有效內容' }, { status: 400 });
    }

    // 批次存入知識庫
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
            title: chunk.title,
            content: chunk.content,
            category: category || 'document',
          }),
        });
        const data = await res.json();
        if (data.id) ids.push(data.id);
        else failed.push(i);
      } catch {
        failed.push(i);
      }
    }

    // 清理 Storage 暫存文件
    await file.delete().catch(() => {});

    return NextResponse.json({
      success: true,
      filename,
      totalChunks: chunks.length,
      saved: ids.length,
      failed: failed.length,
      ids,
    });

  } catch (e: unknown) {
    console.error('[knowledge-parse]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
