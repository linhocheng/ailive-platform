/**
 * /api/client-auth/[id] — 客戶端密碼驗證（server 端，取代瀏覽器裸比對）
 *
 * POST { password }
 * → 角色沒設 clientPassword：回 { ok:true, open:true }（選一：開放，不發 cookie）
 * → 密碼對：種 httpOnly cli_<id> cookie，之後寫入 API 認得
 * → 密碼錯：401
 *
 * 為什麼存在：clientPassword 不再隨 GET 外洩，瀏覽器無法自己比對，必須走 server。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { timingSafeEqual } from '@/lib/char-access';

const MAX_AGE = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let body: { password?: string };
    try { body = await req.json(); } catch { body = {}; }

    const db = getFirestore();
    const doc = await db.collection('platform_characters').doc(id).get();
    if (!doc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });

    const clientPassword = String(doc.data()?.clientPassword || '');
    if (!clientPassword) {
      // 選一：沒設密碼 → 開放
      return NextResponse.json({ ok: true, open: true });
    }

    const supplied = String(body?.password ?? '');
    if (!supplied || !timingSafeEqual(supplied, clientPassword)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(`cli_${id}`, clientPassword, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: MAX_AGE,
    });
    return res;
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
