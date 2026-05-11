import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

const CONFIG_DOC = 'platform_config/scheduler';

const DEFAULT_CONFIG = {
  ig: { enabled: true, postsPerDay: 8 },
  articles: { enabled: false, postsPerDay: 2 },
};

function normalize(raw: Record<string, unknown> | undefined) {
  return {
    ig: {
      ...DEFAULT_CONFIG.ig,
      ...((raw?.ig as object) ?? {}),
    },
    articles: {
      ...DEFAULT_CONFIG.articles,
      ...((raw?.articles as object) ?? {}),
    },
    updatedAt: (raw?.updatedAt as string) ?? null,
  };
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-worker-secret');
  const isWorker = secret === process.env.WORKER_SECRET;
  const isAdmin = req.headers.get('x-admin-key') === process.env.ADMIN_KEY;
  if (!isWorker && !isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirestore();
  const doc = await db.doc(CONFIG_DOC).get();
  return NextResponse.json(normalize(doc.exists ? doc.data() : undefined));
}

export async function PATCH(req: NextRequest) {
  const isAdmin = req.headers.get('x-admin-key') === process.env.ADMIN_KEY;
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const db = getFirestore();

  // Always write both channels so the document is always complete
  const existing = await db.doc(CONFIG_DOC).get();
  const current = normalize(existing.exists ? existing.data() : undefined);
  const merged = {
    ig: { ...current.ig, ...(body.ig ?? {}) },
    articles: { ...current.articles, ...(body.articles ?? {}) },
    updatedAt: new Date().toISOString(),
  };

  await db.doc(CONFIG_DOC).set(merged);
  return NextResponse.json(merged);
}
