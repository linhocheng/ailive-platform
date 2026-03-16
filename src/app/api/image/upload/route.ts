/**
 * /api/image/upload — 上傳 ref 圖到 Firebase Storage
 * POST { base64, contentType, characterId, filename }
 * → 存到 platform-refs/[characterId]/[filename]
 * → 回傳永久 URL
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { base64, contentType = 'image/jpeg', characterId, filename } = await req.json();

    if (!base64 || !characterId || !filename) {
      return NextResponse.json({ error: 'base64, characterId, filename 必填' }, { status: 400 });
    }

    const admin = getFirebaseAdmin();
    const bucket = admin.storage().bucket();

    if (!bucket.name || bucket.name === 'undefined') {
      return NextResponse.json({ error: 'Storage bucket 未設定' }, { status: 500 });
    }

    const filePath = `platform-refs/${characterId}/${filename}`;
    const buffer = Buffer.from(base64, 'base64');
    const file = bucket.file(filePath);
    await file.save(new Uint8Array(buffer), { metadata: { contentType } });
    await file.makePublic();

    const url = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    return NextResponse.json({ success: true, url });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
