/**
 * /api/knowledge-upload-url — 生成 Firebase Storage signed upload URL
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { randomUUID } from 'crypto';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { filename, contentType, characterId } = await req.json();

    if (!filename || !characterId) {
      return NextResponse.json({ error: 'filename, characterId 必填' }, { status: 400 });
    }

    const ext = filename.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx'].includes(ext || '')) {
      return NextResponse.json({ error: '只支援 .pdf 和 .docx' }, { status: 400 });
    }

    const admin = getFirebaseAdmin();
    const bucket = admin.storage().bucket();
    const storagePath = `knowledge-uploads/${characterId}/${randomUUID()}.${ext}`;
    const file = bucket.file(storagePath);

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType: contentType || 'application/octet-stream',
    });

    return NextResponse.json({ uploadUrl, storagePath });
  } catch (e: unknown) {
    console.error('[knowledge-upload-url]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
