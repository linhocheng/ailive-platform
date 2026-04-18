/**
 * /api/memory-cleanup — 記憶清理工具
 *
 * POST { characterId, dryRun? }
 *
 * 對現有 core 記憶執行清理：
 * 1. knowledge 類 core → 降回 fresh（知識不應在 core）
 * 2. identity 類 core，補算 rootRelevance，< 0.5 → 降回 fresh
 * 3. 無 embedding 的 core → 降回 fresh（無法計算，保守處理）
 *
 * dryRun=true：只回報不執行
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { cosineSimilarity, generateEmbedding } from '@/lib/embeddings';

const CORE_THRESHOLD = 0.5;

function getMemoryType(source: string): 'identity' | 'knowledge' {
  const identitySources = new Set([
    'sleep_time','self_awareness','sleep_self_awareness',
    'reflect','scheduler_reflect','scheduler_sleep',
    'post_reflection','pre_publish_reflection','post_memory',
    'conversation','awakening','resource_awareness',
    'strategist_review',
  ]);
  return identitySources.has(source) ? 'identity' : 'knowledge';
}

export async function POST(req: NextRequest) {
  try {
    const { characterId, dryRun = true } = await req.json();
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const db = getFirestore();

    // 讀角色靈魂做 rootAnchor
    const charDoc = await db.collection('platform_characters').doc(characterId).get();
    if (!charDoc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });
    const char = charDoc.data()!;

    // rootAnchor 只用 soul_core——衡量「跟角色身份的相關度」
    let rootAnchorEmbeddings: number[][] = [];
    const soulText = String(char.soul_core || char.system_soul || char.enhancedSoul || '').slice(0, 600);
    if (soulText) rootAnchorEmbeddings = [await generateEmbedding(soulText)];

    function calcRootRelevance(emb: number[]): number {
      if (rootAnchorEmbeddings.length === 0) return 1;
      return Math.max(...rootAnchorEmbeddings.map(a => cosineSimilarity(emb, a)));
    }

    // 讀所有 core 記憶
    const snap = await db.collection('platform_insights')
      .where('characterId', '==', characterId)
      .where('tier', '==', 'core')
      .get();

    const results: Array<{id: string; title: string; action: string; reason: string; rootRelevance?: number}> = [];

    for (const doc of snap.docs) {
      const ins = { id: doc.id, ...doc.data() } as Record<string, unknown>;
      const memType = getMemoryType(String(ins.source || ''));
      const title = String(ins.title || '');
      const insEmb = ins.embedding && Array.isArray(ins.embedding) ? ins.embedding as number[] : null;

      if (memType === 'knowledge') {
        // knowledge 類不應在 core
        if (!dryRun) await doc.ref.update({ tier: 'fresh', memoryType: 'knowledge' });
        results.push({ id: doc.id, title, action: 'core→fresh', reason: 'knowledge 類不應在 core' });

      } else if (!insEmb) {
        // 無 embedding，無法計算，保守降回 fresh
        if (!dryRun) await doc.ref.update({ tier: 'fresh', memoryType: memType });
        results.push({ id: doc.id, title, action: 'core→fresh', reason: '無 embedding，無法驗根' });

      } else {
        const rootRelevance = calcRootRelevance(insEmb);
        if (rootRelevance < CORE_THRESHOLD) {
          if (!dryRun) await doc.ref.update({ tier: 'fresh', memoryType: memType, rootRelevance });
          results.push({ id: doc.id, title, action: 'core→fresh', reason: `rootRelevance=${rootRelevance.toFixed(3)} < ${CORE_THRESHOLD}`, rootRelevance });
        } else {
          // 保留，補寫 rootRelevance
          if (!dryRun) await doc.ref.update({ memoryType: memType, rootRelevance });
          results.push({ id: doc.id, title, action: 'keep', reason: `rootRelevance=${rootRelevance.toFixed(3)} ✅`, rootRelevance });
        }
      }
    }

    const demoted = results.filter(r => r.action === 'core→fresh');
    const kept = results.filter(r => r.action === 'keep');

    return NextResponse.json({
      success: true,
      dryRun,
      summary: { total: results.length, demoted: demoted.length, kept: kept.length },
      demoted,
      kept,
    });

  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
