/**
 * /api/knowledge-image — 直接上傳圖片到知識庫
 *
 * POST { characterId, title, base64, mimeType }
 * → 存 Firebase Storage，makePublic，建 knowledge entry（category=image）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { characterId, title, base64, mimeType } = await req.json();
    if (!characterId || !base64) {
      return NextResponse.json({ error: 'characterId, base64 必填' }, { status: 400 });
    }

    const admin = getFirebaseAdmin();
    const bucket = admin.storage().bucket();
    const ext = (mimeType || 'image/jpeg').includes('png') ? 'png' : mimeType?.includes('webp') ? 'webp' : 'jpg';
    const date = new Date().toISOString().slice(0, 10);
    const rand = Math.random().toString(36).slice(2, 8);
    const path = `knowledge-images/${characterId}/${date}/img_${rand}.${ext}`;

    const buf = Buffer.from(base64, 'base64');
    const file = bucket.file(path);
    await file.save(buf, { metadata: { contentType: mimeType || 'image/jpeg' } });
    await file.makePublic();
    const imageUrl = `https://storage.googleapis.com/${bucket.name}/${path}`;

    const baseUrl = req.nextUrl.origin;
    const res = await fetch(`${baseUrl}/api/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId, title: title || '圖片', content: `圖片網址：${imageUrl}`, category: 'image', imageUrl }),
    });
    const data = await res.json();

    return NextResponse.json({ success: true, id: data.id, imageUrl });
  } catch (e: unknown) {
    console.error('[knowledge-image]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
