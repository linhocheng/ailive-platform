/**
 * /api/knowledge-image — 直接上傳圖片到知識庫
 *
 * POST { characterId, title, base64, mimeType }
 * → 存 Firebase Storage，makePublic，建 knowledge entry（category=image）
 * → 若 title 能比對到產品，同步更新 platform_products.images（captionToKey）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, getFirestore } from '@/lib/firebase-admin';

export const maxDuration = 30;

function captionToKey(caption: string): string {
  if (caption.includes('全身')) return '模特兒全身';
  if (caption.includes('半身')) return '模特兒半身';
  if (caption.includes('大頭')) return '模特兒大頭';
  if (caption.includes('斜躺')) return '純產品斜躺';
  if (caption.includes('正面')) return '純產品正面';
  return caption.slice(-10);
}

// 從 title 找對應產品（startsWith 最長前綴優先，避免誤判）
async function syncToProduct(characterId: string, title: string, imageUrl: string) {
  const db = getFirestore();
  const snap = await db.collection('platform_products').where('characterId', '==', characterId).get();
  if (snap.empty) return;

  // 1. 「產品名 — 圖類型」：dash 前取名
  let matched: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  const dashIdx = title.search(/[—\-–]/);
  if (dashIdx > 0) {
    const namePart = title.slice(0, dashIdx).trim();
    matched = snap.docs.find(d => String(d.data().productName || '') === namePart) ?? null;
    if (!matched) {
      matched = snap.docs.find(d => {
        const pn = String(d.data().productName || '');
        return namePart.startsWith(pn) && pn.length >= 4;
      }) ?? null;
    }
  }

  // 2. startsWith 最長前綴（「產品名130g 圖類型」格式）
  if (!matched) {
    let bestLen = 0;
    for (const d of snap.docs) {
      const pn = String(d.data().productName || '');
      if (title.startsWith(pn) && pn.length > bestLen) {
        matched = d; bestLen = pn.length;
      }
    }
  }

  // 3. 「產品名 與 模特兒...」
  if (!matched) {
    const withIdx = title.indexOf('與');
    if (withIdx > 0) {
      const namePart = title.slice(0, withIdx).trim();
      matched = snap.docs.find(d => {
        const pn = String(d.data().productName || '');
        return namePart.startsWith(pn) && pn.length >= 4;
      }) ?? null;
    }
  }

  if (!matched) return; // 找不到對應產品，不強制同步

  const key = captionToKey(title);
  const existing = matched.data().images?.[key];
  if (existing === imageUrl) return; // 已存在且一致

  await matched.ref.update({
    [`images.${key}`]: imageUrl,
    updatedAt: new Date().toISOString(),
  });
  console.log(`[knowledge-image] synced to product "${matched.data().productName}" images.${key}`);
}

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
    const effectiveTitle = title || '圖片';

    const [res] = await Promise.all([
      fetch(`${baseUrl}/api/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, title: effectiveTitle, content: `圖片網址：${imageUrl}`, category: 'image', imageUrl }),
      }),
      syncToProduct(characterId, effectiveTitle, imageUrl).catch(e =>
        console.warn('[knowledge-image] syncToProduct failed (non-fatal):', e)
      ),
    ]);
    const data = await res.json();

    return NextResponse.json({ success: true, id: data.id, imageUrl });
  } catch (e: unknown) {
    console.error('[knowledge-image]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
