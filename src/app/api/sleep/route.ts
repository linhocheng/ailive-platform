/**
 * /api/sleep — 夢境引擎
 *
 * POST { characterId, dryRun? }
 *
 * 1. 讀所有 fresh insights
 * 2. 合併相似的（cosine > 0.88）
 * 3. hitCount >= 3 → 升格 core
 * 4. 久沒用（30天，hitCount=0）→ 降格 archived
 * 5. 生成自我洞察
 * 6. core 記憶 >= 5 → 觸發 soul_proposal
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from '@/lib/firebase-admin';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';

export const maxDuration = 60;


function stripJson(s: string): string {
  return s.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
}

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, dryRun } = await req.json();

    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY 未設定' }, { status: 500 });

    const charDoc = await db.collection('platform_characters').doc(characterId).get();
    if (!charDoc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });
    const char = charDoc.data()!;

    const snap = await db.collection('platform_insights')
      .where('characterId', '==', characterId)
      .limit(200)
      .get();

    const insights = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];

    const merged: string[] = [];
    const upgraded: string[] = [];
    const archived: string[] = [];
    const now = Date.now();

    // 1. 升降級（設計規則 2026-03-17）
    // fresh  → core    : hitCount >= 5
    // core   → archive : lastHitAt 超過 30 天無新命中
    // fresh  → archive : createdAt 超過 14 天 且 hitCount = 0
    // self   → 不參與升降，永久保留
    for (const ins of insights) {
      const hitCount = (ins.hitCount as number) || 0;
      const tier = ins.tier as string;
      const createdAt = ins.createdAt ? new Date(ins.createdAt as string).getTime() : now;
      const lastHitAt = ins.lastHitAt ? new Date(ins.lastHitAt as string).getTime() : createdAt;
      const ageDays = (now - createdAt) / 86400000;
      const daysSinceHit = (now - lastHitAt) / 86400000;

      if (tier === 'self' || tier === 'archive') continue; // self 不動，已歸檔不重複處理

      if (!dryRun) {
        if (hitCount >= 5 && tier === 'fresh') {
          await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'core' });
          upgraded.push(ins.title as string);
        } else if (tier === 'core' && daysSinceHit > 30) {
          await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'archive' });
          archived.push(ins.title as string);
        } else if (tier === 'fresh' && hitCount === 0 && ageDays > 14) {
          await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'archive' });
          archived.push(ins.title as string);
        }
      }
    }

    // 2. 合併相似（cosine > 0.88）
    const withEmb = insights.filter(i => i.embedding && Array.isArray(i.embedding) && i.tier !== 'archived');
    const toMerge: Array<[string, string]> = [];
    const mergedSet = new Set<string>();

    for (let i = 0; i < withEmb.length; i++) {
      if (mergedSet.has(withEmb[i].id as string)) continue;
      for (let j = i + 1; j < withEmb.length; j++) {
        if (mergedSet.has(withEmb[j].id as string)) continue;
        const score = cosineSimilarity(withEmb[i].embedding as number[], withEmb[j].embedding as number[]);
        if (score > 0.88) {
          toMerge.push([withEmb[i].id as string, withEmb[j].id as string]);
          mergedSet.add(withEmb[j].id as string);
        }
      }
    }

    // 合併：保留第一條，刪除重複的
    if (!dryRun) {
      for (const [keepId, deleteId] of toMerge) {
        const keepDoc = insights.find(i => i.id === keepId);
        const deleteDoc = insights.find(i => i.id === deleteId);
        if (keepDoc && deleteDoc) {
          // 更新 hitCount 取最大值
          const mergedHitCount = Math.max((keepDoc.hitCount as number) || 0, (deleteDoc.hitCount as number) || 0);
          await db.collection('platform_insights').doc(keepId).update({ hitCount: mergedHitCount });
          await db.collection('platform_insights').doc(deleteId).delete();
          merged.push(`${deleteDoc.title} → ${keepDoc.title}`);
        }
      }
    }

    // 3. 自我洞察
    const client = new Anthropic({ apiKey });
    const coreInsights = insights
      .filter(i => i.tier === 'core' || (i.hitCount as number) >= 2)
      .slice(0, 5)
      .map(i => i.content as string)
      .join('\n');

    let selfReflection = '';
    if (coreInsights) {
      const res = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `你是 ${char.name}。以下是你的核心記憶：\n${coreInsights}\n\n用第一人稱寫一段自我洞察（60-80字），感受你最近的成長或變化。直接寫，不要標題。`,
        }],
      });
      selfReflection = (res.content[0] as Anthropic.TextBlock).text.trim();

      if (!dryRun && selfReflection) {
        const embedding = await generateEmbedding(selfReflection);
        await db.collection('platform_insights').add({
          characterId,
          title: '夢境自我洞察',
          content: selfReflection,
          source: 'sleep_time',
          eventDate: new Date().toISOString().slice(0, 10),
          tier: 'self',
          hitCount: 0,
          lastHitAt: null,
          embedding,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 4. soul_proposal（core >= 5）
    let proposalCreated = false;
    const coreCount = insights.filter(i => i.tier === 'core').length + upgraded.length;
    if (coreCount >= 5 && !dryRun) {
      const topCore = insights
        .filter(i => i.tier === 'core')
        .sort((a, b) => ((b.hitCount as number) || 0) - ((a.hitCount as number) || 0))
        .slice(0, 5)
        .map(i => `${i.title}：${String(i.content).slice(0, 80)}`)
        .join('\n');

      const propRes = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `你是 ${char.name}。根據這些核心記憶，提出一個靈魂進化的建議：\n${topCore}\n\n格式：{"proposedChange":"建議修改的靈魂面向","reason":"為什麼要這樣改"}\n只回 JSON。`,
        }],
      });

      const propRaw = stripJson((propRes.content[0] as Anthropic.TextBlock).text.trim());
      const proposal = JSON.parse(propRaw);

      await db.collection('platform_soul_proposals').add({
        characterId,
        proposedChange: proposal.proposedChange,
        reason: proposal.reason,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      proposalCreated = true;
    }

    return NextResponse.json({
      success: true,
      dryRun: !!dryRun,
      summary: {
        totalInsights: insights.length,
        merged: merged.length,
        upgraded: upgraded.length,
        archived: archived.length,
        selfReflection: selfReflection.slice(0, 100),
        proposalCreated,
        coreCount,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
