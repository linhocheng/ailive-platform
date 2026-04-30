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
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import { getFirestore } from '@/lib/firebase-admin';
import { trackCost } from '@/lib/cost-tracker';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';

export const maxDuration = 60;


function stripJson(s: string): string {
  return s.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
}


// source → memoryType 映射
function getMemoryType(source: string): 'identity' | 'knowledge' {
  const identitySources = new Set([
    'sleep_time', 'self_awareness', 'sleep_self_awareness',
    'reflect', 'scheduler_reflect', 'scheduler_sleep',
    'post_reflection', 'post_memory', 'pre_publish_reflection',
    'conversation', 'awakening',
  ]);
  return identitySources.has(source) ? 'identity' : 'knowledge';
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
    const blocked: string[] = []; // rootRelevance 太低，升 core 被擋
    const now = Date.now();

    // 建立 rootAnchor：用於計算 rootRelevance（防漂移保護）
    // 只用 soul_core 文字——rootAnchor 衡量「跟角色身份的相關度」
    // 產品知識已在 platform_knowledge 獨立保存，不應干擾身份記憶的篩選
    let rootAnchorEmbeddings: number[][] = [];
    try {
      const soulText = String(char.soul_core || char.system_soul || char.enhancedSoul || '').slice(0, 600);
      if (soulText) {
        const soulEmb = await generateEmbedding(soulText);
        rootAnchorEmbeddings = [soulEmb];
      }
    } catch { /* rootAnchor 建立失敗不阻斷，只是不做保護 */ }

    function calcRootRelevance(insightEmb: number[]): number {
      if (rootAnchorEmbeddings.length === 0) return 1; // 無 anchor = 不擋
      return Math.max(...rootAnchorEmbeddings.map(a => cosineSimilarity(insightEmb, a)));
    }

    // 1. 升降級（設計規則 2026-04-14 重設計版）
    //
    // 核心原則：
    //   - rootRelevance 決定是否能升 core（身份相關度）
    //   - hitCount 只影響對話注入時的排序，不再是升格門檻
    //   - knowledge 類永遠不升 core（知識是工具，不是身份）
    //
    // identity 記憶：
    //   fresh → core    : rootRelevance >= 0.5（與靈魂高度相關）
    //   fresh → archive : createdAt 超過 30 天且 hitCount = 0
    //   core  → archive : lastHitAt 超過 60 天無新命中
    //
    // knowledge 記憶：
    //   fresh → archive : createdAt 超過 7 天且 hitCount = 0
    //   （永遠不升 core，hitCount 影響對話注入排序）
    //
    // self → 不參與升降，永久保留
    for (const ins of insights) {
      const hitCount = (ins.hitCount as number) || 0;
      const tier = ins.tier as string;
      const createdAt = ins.createdAt ? new Date(ins.createdAt as string).getTime() : now;
      const lastHitAt = ins.lastHitAt ? new Date(ins.lastHitAt as string).getTime() : createdAt;
      const ageDays = (now - createdAt) / 86400000;
      const daysSinceHit = (now - lastHitAt) / 86400000;

      if (tier === 'self' || tier === 'archive') continue;

      const memType = getMemoryType(String(ins.source || ''));

      // 補 memoryType（舊資料沒有這個欄位）
      if (!ins.memoryType && !dryRun) {
        await db.collection('platform_insights').doc(ins.id as string).update({ memoryType: memType });
      }

      if (memType === 'identity') {
        // ── identity：rootRelevance >= 0.5 才升 core ──
        const coreDecayDays = 60;
        const freshDecayDays = 30;
        const CORE_THRESHOLD = 0.5;

        if (tier === 'fresh') {
          const insEmb = ins.embedding && Array.isArray(ins.embedding) ? ins.embedding as number[] : null;
          const rootRelevance = insEmb ? calcRootRelevance(insEmb) : 0;
          // 補寫 rootRelevance
          if (!dryRun && rootRelevance !== ins.rootRelevance) {
            await db.collection('platform_insights').doc(ins.id as string).update({ rootRelevance, memoryType: memType });
          }
          if (rootRelevance >= CORE_THRESHOLD) {
            if (!dryRun) await db.collection('platform_insights').doc(ins.id as string).update({
              tier: 'core', memoryType: memType, rootRelevance,
            });
            upgraded.push(ins.title as string);
          } else if (hitCount === 0 && ageDays > freshDecayDays) {
            if (!dryRun) await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'archive' });
            archived.push(ins.title as string);
          }
        } else if (tier === 'core' && daysSinceHit > coreDecayDays) {
          if (!dryRun) await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'archive' });
          archived.push(ins.title as string);
        }

      } else {
        // ── knowledge：永遠不升 core，快速衰退 ──
        const freshDecayDays = 7;
        if (tier === 'fresh' && hitCount === 0 && ageDays > freshDecayDays) {
          if (!dryRun) await db.collection('platform_insights').doc(ins.id as string).update({ tier: 'archive' });
          archived.push(ins.title as string);
        }
        // knowledge 被手動升成 core 的，重新計算 rootRelevance 並降回 fresh
        if (tier === 'core') {
          const insEmb = ins.embedding && Array.isArray(ins.embedding) ? ins.embedding as number[] : null;
          const rootRelevance = insEmb ? calcRootRelevance(insEmb) : 0;
          if (!dryRun) await db.collection('platform_insights').doc(ins.id as string).update({
            tier: 'fresh', memoryType: memType, rootRelevance,
          });
          archived.push(`[knowledge→fresh] ${String(ins.title || '')}`);
        }
      }
    }

    // 2. 合併相似（cosine > 0.88）
    const withEmb = insights.filter(i => i.embedding && Array.isArray(i.embedding) && i.tier !== 'archive');
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
    const client = getAnthropicClient(apiKey);
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

        await trackCost(characterId, 'claude-haiku-4-5-20251001', awarenessRes.usage?.input_tokens ?? 0, awarenessRes.usage?.output_tokens ?? 0);
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

      await trackCost(characterId, 'claude-haiku-4-5-20251001', propRes.usage?.input_tokens ?? 0, propRes.usage?.output_tokens ?? 0);
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

    // 5. knowledge 去重 — 停用
    // 知識庫條目是人工整理的獨立資料（產品成分、定位、圖片等），
    // 不適用語意去重。高相似度不代表重複，而是同產品的不同面向。
    // 去重只對 insights（對話記憶）有意義，不對 platform_knowledge 執行。
    const kMerged: string[] = [];


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

    // 記憶健康報告
    const healthReport = {
      totalInsights: insights.length,
      byTier: {
        self: insights.filter(i => i.tier === 'self').length,
        core: insights.filter(i => i.tier === 'core').length + upgraded.length,
        fresh: insights.filter(i => i.tier === 'fresh').length - upgraded.length - blocked.length,
        archive: insights.filter(i => i.tier === 'archive').length + archived.length,
      },
      byMemoryType: {
        identity: insights.filter(i => {
          const mType = String(i.memoryType || '');
          if (mType === 'identity') return true;
          if (mType === 'knowledge') return false;
          const IDENTITY_SOURCES = new Set(['sleep_time','self_awareness','sleep_self_awareness','reflect','scheduler_reflect','scheduler_sleep','post_reflection', 'post_memory','pre_publish_reflection','conversation','awakening']);
          return IDENTITY_SOURCES.has(String(i.source || ''));
        }).length,
        knowledge: insights.filter(i => {
          const mType = String(i.memoryType || '');
          if (mType === 'knowledge') return true;
          if (mType === 'identity') return false;
          const IDENTITY_SOURCES = new Set(['sleep_time','self_awareness','sleep_self_awareness','reflect','scheduler_reflect','scheduler_sleep','post_reflection', 'post_memory','pre_publish_reflection','conversation','awakening']);
          return !IDENTITY_SOURCES.has(String(i.source || ''));
        }).length,
      },
      rootAnchorSource: rootAnchorEmbeddings.length > 0
        ? (await db.collection('platform_knowledge').where('characterId','==',characterId).limit(1).get()).empty
          ? 'soul_core'
          : 'knowledge_base'
        : 'none',
      blockedFromCore: blocked.length,
      blockedNames: blocked,
    };

    return NextResponse.json({
      success: true,
      dryRun: !!dryRun,
      summary: {
        totalInsights: insights.length,
        merged: merged.length,
        upgraded: upgraded.length,
        archived: archived.length,
        blocked: blocked.length,
        selfReflection: selfReflection.slice(0, 100),
        proposalCreated,
        coreCount,
        knowledgeMerged: kMerged.length,
        skillsMerged: skillsMerged.length,
        skillsFixed: skillsFixed.length,
        skillsFixedNames: skillsFixed,
      },
      healthReport,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
