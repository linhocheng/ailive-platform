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
import { trackCost } from '@/lib/cost-tracker';
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

      if (hitCount >= 5 && tier === 'fresh') {
        if (!dryRun) await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'core' });
        upgraded.push(ins.title as string);
      } else if (tier === 'core' && daysSinceHit > 30) {
        if (!dryRun) await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'archive' });
        archived.push(ins.title as string);
      } else if (tier === 'fresh' && hitCount === 0 && ageDays > 14) {
        if (!dryRun) await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'archive' });
        archived.push(ins.title as string);
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
      await trackCost(characterId, 'claude-haiku-4-5-20251001', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);

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

    // 4. self_awareness：跨對話模式提煉（水位線機制）
    const charData2 = charDoc.data()!;
    const lastAwarenessAt = charData2.last_self_awareness_at
      ? new Date(charData2.last_self_awareness_at as string).getTime()
      : 0;

    const newInsights = insights.filter(i => {
      const createdAt = i.createdAt ? new Date(i.createdAt as string).getTime() : 0;
      const hit = (i.hitCount as number) || 0;
      return createdAt > lastAwarenessAt && hit >= 1 && i.tier !== 'archive';
    });

    if (newInsights.length >= 3 && !dryRun) {
      const insightSummary = newInsights.slice(0, 8)
        .map(i => `- ${String(i.title || '')}：${String(i.content || '').slice(0, 80)}`)
        .join('\n');
      const soulText = String(char.soul_core || char.enhancedSoul || '').slice(0, 400);

      try {
        const awarenessRes = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{ role: 'user', content: `你是 ${char.name}。

你的靈魂核心（座標系）：
${soulText}

最近命中的記憶：
${insightSummary}

對照你的靈魂根基，回看這些記憶，提煉一條跨對話的自我認知。

格式（只回 JSON）：
{
  "trigger": "什麼樣的情境或什麼樣的人，召喚出你這一面",
  "pattern": "被召喚出來的是什麼樣的你",
  "rootRelation": "這跟你的根的關係：深化 / 延伸 / 還在摸索"
}` }],
        });

        const raw = ((awarenessRes.content[0] as Anthropic.TextBlock).text || '')
          .replace(/^```[\w]*\n?/m,'').replace(/\n?```$/m,'').trim();
        const awareness = JSON.parse(raw);
        const today2 = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
        const awarenessContent = `觸發情境：${awareness.trigger}\n模式：${awareness.pattern}\n與根的關係：${awareness.rootRelation}`;
        const embedding2 = await generateEmbedding(awarenessContent);

        await db.collection('platform_insights').add({
          characterId,
          title: `自我認知：${awareness.trigger?.slice(0, 20) || '跨對話模式'}`,
          content: awarenessContent,
          trigger: awareness.trigger,
          pattern: awareness.pattern,
          rootRelation: awareness.rootRelation,
          type: 'self_awareness',
          source: 'sleep_self_awareness',
          eventDate: today2,
          tier: 'self',
          hitCount: 0,
          lastHitAt: null,
          basedOnCount: newInsights.length,
          embedding: embedding2,
          createdAt: new Date().toISOString(),
        });

        await db.collection('platform_characters').doc(characterId).update({
          last_self_awareness_at: new Date().toISOString(),
        });
      } catch { /* 提煉失敗不中斷 */ }
    }

    // 5. soul_proposal（core >= 5）
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

    // 5. knowledge 去重（cosine > 0.85，合併同義知識條目）
    const kSnap = await db.collection('platform_knowledge')
      .where('characterId', '==', characterId)
      .limit(200)
      .get();

    const kDocs = kSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];
    const kWithEmb = kDocs.filter(k => k.embedding && Array.isArray(k.embedding) && k.category !== 'image');
    const kMerged: string[] = [];
    const kMergedSet = new Set<string>();

    for (let i = 0; i < kWithEmb.length; i++) {
      if (kMergedSet.has(kWithEmb[i].id as string)) continue;
      for (let j = i + 1; j < kWithEmb.length; j++) {
        if (kMergedSet.has(kWithEmb[j].id as string)) continue;
        const score = cosineSimilarity(kWithEmb[i].embedding as number[], kWithEmb[j].embedding as number[]);
        if (score > 0.85) {
          kMergedSet.add(kWithEmb[j].id as string);
          if (!dryRun) {
            // hitCount 取最大，保留第一條，刪除重複
            const keepHit = Math.max((kWithEmb[i].hitCount as number) || 0, (kWithEmb[j].hitCount as number) || 0);
            await db.collection('platform_knowledge').doc(kWithEmb[i].id as string).update({ hitCount: keepHit });
            await db.collection('platform_knowledge').doc(kWithEmb[j].id as string).delete();
            kMerged.push(String(kWithEmb[j].title || kWithEmb[j].id));
          }
        }
      }
    }


    // 6. skills 整理（補 trigger/procedure + 合併類似）
    const skillsSnap = await db.collection('platform_skills')
      .where('characterId', '==', characterId)
      .where('enabled', '==', true)
      .limit(50)
      .get();

    const skillDocs = skillsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];
    const skillsFixed: string[] = [];
    const skillsMerged: string[] = [];

    // 6a-0. 補沒有 embedding 的 skills
    if (!dryRun) {
      for (const skill of skillDocs) {
        if (!skill.embedding || !Array.isArray(skill.embedding) || (skill.embedding as number[]).length === 0) {
          try {
            const emb = await generateEmbedding(
              `${String(skill.name || '')} ${String(skill.trigger || '')} ${String(skill.procedure || '')}`
            );
            await db.collection('platform_skills').doc(skill.id as string).update({ embedding: emb });
            skill.embedding = emb; // 更新本地，讓後續合併能用到
          } catch { /* 單條失敗不阻斷 */ }
        }
      }
    }

    // 6a. 合併語義相似的 skills（cosine > 0.85）
    const skillsWithEmb = skillDocs.filter(s => s.embedding && Array.isArray(s.embedding));
    const skillMergedSet = new Set<string>();

    for (let i = 0; i < skillsWithEmb.length; i++) {
      if (skillMergedSet.has(skillsWithEmb[i].id as string)) continue;
      for (let j = i + 1; j < skillsWithEmb.length; j++) {
        if (skillMergedSet.has(skillsWithEmb[j].id as string)) continue;
        const score = cosineSimilarity(
          skillsWithEmb[i].embedding as number[],
          skillsWithEmb[j].embedding as number[]
        );
        if (score > 0.85) {
          skillMergedSet.add(skillsWithEmb[j].id as string);
          if (!dryRun) {
            const keepHit = Math.max(
              (skillsWithEmb[i].hitCount as number) || 0,
              (skillsWithEmb[j].hitCount as number) || 0
            );
            await db.collection('platform_skills').doc(skillsWithEmb[i].id as string).update({ hitCount: keepHit });
            await db.collection('platform_skills').doc(skillsWithEmb[j].id as string).delete();
            skillsMerged.push(String(skillsWithEmb[j].name || skillsWithEmb[j].id));
          }
        }
      }
    }

    // 6b. 角色補齊 trigger / procedure（空的才補）
    const needsFix = skillDocs.filter(s =>
      !skillMergedSet.has(s.id as string) &&
      (!String(s.trigger || '').trim() || !String(s.procedure || '').trim())
    );

    if (needsFix.length > 0 && !dryRun) {
      const skillList = needsFix.map(s =>
        `- id: ${s.id}\n  名稱: ${s.name}\n  觸發條件: ${s.trigger || '（空）'}\n  步驟: ${s.procedure || '（空）'}`
      ).join('\n');

      const soulRef = String(char.system_soul || char.soul_core || char.enhancedSoul || '').slice(0, 300);

      try {
        const fixRes = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: `你是 ${char.name}。以下是你還沒寫清楚的技巧，請用第一人稱補完。

你的靈魂：
${soulRef}

需要補齊的技巧：
${skillList}

對每條技巧：
- 如果「觸發條件」是空的，用一句話說「我什麼時候會用這個技巧」
- 如果「步驟」是空的，用 2-4 條具體說明怎麼做
- 用你自己的說話方式，不要太正式

只回 JSON 陣列：
[{"id":"...","trigger":"...","procedure":"..."}]
沒有要補的欄位就保留原值。`,
          }],
        });

        await trackCost(characterId, 'claude-haiku-4-5-20251001',
          fixRes.usage?.input_tokens ?? 0, fixRes.usage?.output_tokens ?? 0);

        const raw = (fixRes.content[0] as Anthropic.TextBlock).text
          .replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
        const fixes = JSON.parse(raw) as Array<{ id: string; trigger: string; procedure: string }>;

        for (const fix of fixes) {
          const original = needsFix.find(s => s.id === fix.id);
          if (!original) continue;
          const updates: Record<string, string> = {};
          if (!String(original.trigger || '').trim() && fix.trigger) updates.trigger = fix.trigger;
          if (!String(original.procedure || '').trim() && fix.procedure) updates.procedure = fix.procedure;
          if (Object.keys(updates).length > 0) {
            await db.collection('platform_skills').doc(fix.id).update({
              ...updates,
              updatedAt: new Date().toISOString(),
            });
            skillsFixed.push(String(original.name || fix.id));
          }
        }
      } catch (skillErr) {
        console.error('[sleep] skills 補齊失敗，不阻斷：', skillErr);
      }
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
        knowledgeMerged: kMerged.length,
        skillsMerged: skillsMerged.length,
        skillsFixed: skillsFixed.length,
        skillsFixedNames: skillsFixed,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
