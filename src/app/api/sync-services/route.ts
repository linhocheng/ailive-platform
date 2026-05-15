import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin';

const CRON_SECRET = process.env.CRON_SECRET;

function parseRedisInfo(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;
    result[trimmed.slice(0, idx)] = trimmed.slice(idx + 1).trim();
  }
  return result;
}

async function fetchUpstashMetrics(): Promise<{ usage: string | null }> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return { usage: null };

  const res = await fetch(`${url}/info`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if (!res.ok) return { usage: null };

  const json = await res.json() as { result?: string };
  if (!json.result) return { usage: null };

  const info = parseRedisInfo(json.result);
  const keys = info['total_keys'] ?? info['db_size'] ?? '?';
  const dataSize = info['total_data_size_human'] ?? '?';
  const cmds = info['total_commands_processed'] ?? '?';
  return { usage: `${keys} keys · ${dataSize} · ${cmds} cmds total` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTTSUsage(db: any): Promise<{
  elevenlabs: { chars: number; cost_usd: number } | null;
  minimax: { chars: number; cost_usd: number } | null;
}> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const snap = await db
    .collection('zhu_vitals_cost')
    .where('project', '==', 'ailive-platform')
    .where('timestamp', '>=', since)
    .get();

  const agg: Record<string, { chars: number; cost_usd: number }> = {};
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.type !== 'tts') continue;
    const provider = (d.tts_provider as string) ?? 'unknown';
    if (!agg[provider]) agg[provider] = { chars: 0, cost_usd: 0 };
    agg[provider].chars += (d.tts_characters as number) ?? 0;
    agg[provider].cost_usd += (d.cost_usd_est as number) ?? 0;
  }

  return {
    elevenlabs: agg['elevenlabs'] ?? null,
    minimax: agg['minimax'] ?? null
  };
}

export async function GET(req: Request) {
  // Verify cron request
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const now = new Date();

  const [upstash, ttsUsage] = await Promise.all([
    fetchUpstashMetrics(),
    fetchTTSUsage(db)
  ]);

  const updates: Array<{ id: string; usage: string | null; balance: number | null }> = [];

  // Upstash
  updates.push({
    id: 'upstash-redis',
    usage: upstash.usage,
    balance: null
  });

  // ElevenLabs — usage from our own tracking
  if (ttsUsage.elevenlabs) {
    const { chars, cost_usd } = ttsUsage.elevenlabs;
    updates.push({
      id: 'elevenlabs',
      usage: `${(chars / 1000).toFixed(1)}K chars · $${cost_usd.toFixed(3)} (30d)`,
      balance: null
    });
  }

  // MiniMax — usage from our own tracking
  if (ttsUsage.minimax) {
    const { chars, cost_usd } = ttsUsage.minimax;
    updates.push({
      id: 'minimax',
      usage: `${(chars / 1000).toFixed(1)}K chars · $${cost_usd.toFixed(3)} (30d)`,
      balance: null
    });
  }

  const batch = db.batch();
  for (const { id, usage, balance } of updates) {
    const ref = db.collection('zhu_services').doc(id);
    batch.update(ref, {
      usage,
      ...(balance !== null ? { balance } : {}),
      last_fetched: now,
      updated_at: now
    });
  }
  await batch.commit();

  return NextResponse.json({
    ok: true,
    updated: updates.map((u) => u.id),
    timestamp: now.toISOString()
  });
}
