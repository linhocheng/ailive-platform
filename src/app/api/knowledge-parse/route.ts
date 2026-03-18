/**
 * /api/knowledge-parse — 從 Firebase Storage 下載文件，解析存入知識庫
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { writeFile, unlink } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);
export const maxDuration = 120;

function chunkMarkdown(md: string): Array<{ title: string; content: string }> {
  const lines = md.split('\n');
  const chunks: Array<{ title: string; content: string }> = [];
  let currentTitle = '';
  let currentContent: string[] = [];

  const flush = () => {
    const content = currentContent.join('\n').trim();
    if (content.length > 20) {
      chunks.push({ title: currentTitle, content });
    }
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
    chunks.push({ title: '', content: md.trim() });
  }
  return chunks;
}

export async function POST(req: NextRequest) {
  const tmpId = randomUUID();
  let filePath = '';

  try {
    const { storagePath, characterId, filename, category } = await req.json();

    if (!storagePath || !characterId || !filename) {
      return NextResponse.json({ error: 'storagePath, characterId, filename 必填' }, { status: 400 });
    }

    const ext = filename.split('.').pop()?.toLowerCase();
    filePath = join('/tmp', `knowledge-${tmpId}.${ext}`);

    // 從 Firebase Storage 下載
    const admin = getFirebaseAdmin();
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [buffer] = await file.download();
    await writeFile(filePath, buffer);

    // markitdown 解析
    const { stdout, stderr } = await execAsync(
      `python3 -c "from markitdown import MarkItDown; md = MarkItDown(); r = md.convert('${filePath}'); print(r.text_content)"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (stderr && !stdout) {
      return NextResponse.json({ error: `解析失敗：${stderr.slice(0, 200)}` }, { status: 500 });
    }

    const markdown = stdout.trim();
    if (!markdown) {
      return NextResponse.json({ error: '文件解析後內容為空' }, { status: 400 });
    }

    const chunks = chunkMarkdown(markdown);
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
            title: chunk.title || `${filename} — 段落 ${i + 1}`,
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
  } finally {
    if (filePath) await unlink(filePath).catch(() => {});
  }
}
