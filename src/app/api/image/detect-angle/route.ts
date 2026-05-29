/**
 * /api/image/detect-angle — 看身份照判角度，回填 visualIdentity.refs
 *
 * POST { characterId, url }
 * → Gemini vision 分類 angle/framing/expression
 * → 讀最新 refs，找 url 那筆，merge 回填
 * → 寫 Firestore + del redis cache（避免讀到舊版）
 *
 * 為什麼要這條：客戶端上傳身份照時 angle:''，generate-image 的 selectBestRef
 * 按 angle 評分永遠 0 分 → 那張照片除非被設成主圖否則永不被選。這條把 angle
 * 欄位的「產生器」補上，讓多角度真的能被選用。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { redis } from '@/lib/redis';
import { classifyRefImage } from '@/lib/gemini-client';
import { assertCharAccess } from '@/lib/char-access';

export const maxDuration = 30;

interface RefImage {
  url: string;
  angle: string;
  framing?: string;
  expression?: string;
  name?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { characterId, url } = await req.json();
    if (!characterId || !url) {
      return NextResponse.json({ error: 'characterId, url 必填' }, { status: 400 });
    }

    // 先讀 doc + 驗權限，未授權不浪費 Gemini call
    const db = getFirestore();
    const docRef = db.collection('platform_characters').doc(characterId);
    const doc = await docRef.get();
    if (!doc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });

    const clientPassword = String(doc.data()?.clientPassword || '');
    if (!(await assertCharAccess(req, characterId, clientPassword))) {
      return NextResponse.json({ error: '無權限' }, { status: 401 });
    }

    const cls = await classifyRefImage(url);
    if (!cls) {
      return NextResponse.json({ success: false, reason: 'classify_failed' });
    }

    const vi = (doc.data()?.visualIdentity || {}) as { refs?: RefImage[] };
    const refs = vi.refs || [];
    const idx = refs.findIndex(r => r.url === url);
    if (idx < 0) {
      // ref 已被刪或還沒寫進來 → 不報錯，回偵測值讓呼叫端決定
      return NextResponse.json({ success: false, reason: 'ref_not_found', detected: cls });
    }

    refs[idx] = { ...refs[idx], angle: cls.angle, framing: cls.framing, expression: cls.expression };

    await docRef.update({
      'visualIdentity.refs': refs,
      updatedAt: new Date().toISOString(),
    });
    try { await redis.del(`char:${characterId}`); } catch { /* 不阻斷 */ }

    return NextResponse.json({ success: true, detected: cls });
  } catch (e: unknown) {
    console.error('[detect-angle]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
