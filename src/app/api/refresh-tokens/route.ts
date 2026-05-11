/**
 * POST /api/refresh-tokens
 * 刷新 lucymo0306 的 IG + Threads long-lived token（Meta 60天一次）
 * 由 VM cron 每 30 天呼叫，token 永遠不過期
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const maxDuration = 30;

const CHAR_ID = 'kTwsX44G0ImsApEACDuE';

async function refreshIgToken(token: string) {
  const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return { token: data.access_token, expiresIn: data.expires_in };
}

async function refreshThreadsToken(token: string) {
  const r = await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${token}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return { token: data.access_token, expiresIn: data.expires_in };
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-worker-secret');
  if (secret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirestore();
  const doc = await db.collection('platform_characters').doc(CHAR_ID).get();
  const data = doc.data()!;
  const now = new Date().toISOString();
  const results: Record<string, string> = {};

  // ── IG ──
  try {
    const { token, expiresIn } = await refreshIgToken(data.igAccessToken);
    await db.collection('platform_characters').doc(CHAR_ID).update({
      igAccessToken: token,
      igTokenUpdatedAt: now,
      igTokenExpiresIn: expiresIn,
    });
    results.ig = `ok (expires_in=${expiresIn}s)`;
  } catch (e) {
    results.ig = `FAILED: ${e}`;
  }

  // ── Threads ──
  try {
    const { token, expiresIn } = await refreshThreadsToken(data.threadsAccessToken);
    await db.collection('platform_characters').doc(CHAR_ID).update({
      threadsAccessToken: token,
      threadsTokenUpdatedAt: now,
      threadsTokenExpiresIn: expiresIn,
    });
    results.threads = `ok (expires_in=${expiresIn}s)`;
  } catch (e) {
    results.threads = `FAILED: ${e}`;
  }

  return NextResponse.json({ success: true, results, refreshedAt: now });
}
