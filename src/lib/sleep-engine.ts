/**
 * 夢境引擎 — /api/sleep 與 runner 的 sleep task 共用（收斂點）
 *
 * 真相分裂根治（2026-07-03）：runner 原本抄了一份舊版 sleep 邏輯
 * （hitCount>=5 舊升級規則、無 rootRelevance/memoryType、純 cosine 硬刪），
 * 每小時排程跑的是舊腦，手動打 /api/sleep 才是新腦。抽進 lib 後只有這一份。
 *
 * 流程：
 * 1. 升降級（rootRelevance 決定升 core；knowledge 快速衰退）
 * 2. 合併重複（雙門檻：cosine >= 0.9 AND CJK bigram >= 0.5，同 userId，降 archive 不硬刪）
 * 2b. 矛盾裁決（灰區配對 → LLM 判斷題 → supersededBy，2026-07-07）
 * 3. 自我洞察 → 4. self_awareness 水位線提煉 → 5. soul_proposal → 6. skills 整理
 */
import type { Firestore } from 'firebase-admin/firestore';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import { trackCost } from '@/lib/cost-tracker';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { isDuplicateMemory } from '@/lib/text-similarity';

function stripJson(s: string): string {
  return s.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
}

// source → memoryType 映射（唯一真相；memory-cleanup 的副本也該指過來）
// 原則：來自真實對話（文字/語音）＋角色關係類 = identity（會浮上心頭）；
//       排程學習 / 接案任務 = knowledge（按需查，不浮現）。
// 2026-06 補語音來源（先前漏接 → 語音記憶被標 knowledge、被動注入時被擋，聖嚴 100% 隱形）。
// 2026-07 收斂 memory-cleanup 的分裂副本，補 strategist_review / resource_awareness
// （cleanup 有 sleep 沒有 → 語音來源在 cleanup 被當 knowledge 降級，兩份即是零份）。
export function getMemoryType(source: string): 'identity' | 'knowledge' {
  const identitySources = new Set([
    'sleep_time', 'self_awareness', 'sleep_self_awareness',
    'reflect', 'scheduler_reflect', 'scheduler_sleep',
    'post_reflection', 'post_memory', 'pre_publish_reflection',
    'conversation', 'awakening',
    'voice_conversation', 'realtime_conversation', 'voice',
    'dialogue_end', 'auto_extract',
    'strategist_review', 'resource_awareness',
  ]);
  return identitySources.has(source) ? 'identity' : 'knowledge';
}

export interface SleepSummary {
  totalInsights: number;
  merged: number;
  contradictions: number;
  upgraded: number;
  archived: number;
  blocked: number;
  selfReflection: string;
  proposalCreated: boolean;
  coreCount: number;
  knowledgeMerged: number;
  skillsMerged: number;
  skillsFixed: number;
  skillsFixedNames: string[];
}

export interface SleepResult {
  summary: SleepSummary;
  healthReport: Record<string, unknown>;
}

// 矛盾裁決的判斷題（step 2b 的 LLM 部分，抽出來讓驗證腳本可以獨立打合成配對）
// 回傳 null = 判定失敗（bridge 斷線/JSON 壞），caller 跳過這對，下輪再審
export async function judgeContradiction(
  client: { messages: { create: (args: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> } },
  characterId: string,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Promise<{ verdict: Record<string, unknown>; actionable: boolean; currentIsA: boolean } | null> {
  const fmt = (m: Record<string, unknown>) =>
    `（記錄於 ${String(m.createdAt || '未知').slice(0, 10)}）${String(m.title || '')}：${String(m.content || '').slice(0, 300)}`;
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `兩條關於同一位用戶的記憶：

A ${fmt(a)}

B ${fmt(b)}

判斷：
1. 兩條是否在講同一件事實或同一個狀態？（不同事件、同件事的不同面向，都不算）
2. 若是，內容是否互相矛盾（不能同時為真）？
3. 若矛盾，哪一條反映現況？優先看內容裡的時間線索（「搬到」「換了」「現在」），沒有線索才看記錄日期較新者。

只回 JSON，不要其他文字：
{"sameMatter":true或false,"contradictory":true或false,"current":"A"或"B"或"unsure"}`,
      }],
    });
    await trackCost(characterId, 'claude-haiku-4-5-20251001', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0, 'sleep-contradiction');
    const verdict = JSON.parse(stripJson((res.content[0] as Anthropic.TextBlock).text)) as Record<string, unknown>;
    const actionable = verdict.sameMatter === true && verdict.contradictory === true
      && (verdict.current === 'A' || verdict.current === 'B');
    return { verdict, actionable, currentIsA: verdict.current === 'A' };
  } catch {
    return null;
  }
}

export async function runSleepEngine(
  db: Firestore,
  characterId: string,
  opts: { dryRun?: boolean } = {},
): Promise<SleepResult> {
  const dryRun = !!opts.dryRun;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 未設定');

  const charDoc = await db.collection('platform_characters').doc(characterId).get();
  if (!charDoc.exists) throw new Error('角色不存在');
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

  // 2. 合併重複（雙門檻，判準在 @/lib/text-similarity）
  //
  // 為什麼不能只看 cosine：同一對人的長篇敘事記憶 embedding 天生擠在一起，
  // ailiveX 實測純 cosine 0.92 仍把「完全不同的事件」判成重複（大誤殺）。
  // 真重複的特徵是「逐字級相似」，所以詞彙重疊是必要條件。
  // 另外兩條鐵律：
  //   - 只在同一 userId 範圍內比（跨用戶記憶本來就該不同，合併=殺記憶+洩漏）
  //   - 永不硬刪：輸家降 archive + mergedInto 可溯，錯殺還救得回來
  const withEmb = insights.filter(i => i.embedding && Array.isArray(i.embedding) && i.tier !== 'archive');
  const toMerge: Array<[string, string]> = [];
  const mergedSet = new Set<string>();

  // 矛盾裁決候選（step 2b 用）：同 userId、cosine 進灰區、但雙門檻沒判成重複的配對。
  // 「住台北」vs「搬到高雄」就是這種——語義夠近（同一件事實），字面差遠（bigram 低），
  // 去重抓不到，兩條並存 = 角色精神分裂。在同一個 O(n²) 迴圈順手收集，不另跑一遍。
  const CONTRADICTION_COSINE_FLOOR = 0.7;
  const memTypeOf = (m: Record<string, unknown>): 'identity' | 'knowledge' => {
    const t = String(m.memoryType || '');
    if (t === 'identity' || t === 'knowledge') return t;
    return getMemoryType(String(m.source || ''));
  };
  const contradictionCandidates: Array<{ a: Record<string, unknown>; b: Record<string, unknown>; score: number }> = [];

  for (let i = 0; i < withEmb.length; i++) {
    if (mergedSet.has(withEmb[i].id as string)) continue;
    for (let j = i + 1; j < withEmb.length; j++) {
      if (mergedSet.has(withEmb[j].id as string)) continue;
      if (String(withEmb[i].userId || '') !== String(withEmb[j].userId || '')) continue;
      const score = cosineSimilarity(withEmb[i].embedding as number[], withEmb[j].embedding as number[]);
      if (!isDuplicateMemory(
        score,
        `${withEmb[i].title || ''} ${withEmb[i].content || ''}`,
        `${withEmb[j].title || ''} ${withEmb[j].content || ''}`,
      )) {
        // 只裁 identity（用戶事實/關係）；self 是自我洞察，演化不是矛盾，不裁
        if (
          score >= CONTRADICTION_COSINE_FLOOR &&
          withEmb[i].tier !== 'self' && withEmb[j].tier !== 'self' &&
          memTypeOf(withEmb[i]) === 'identity' && memTypeOf(withEmb[j]) === 'identity'
        ) {
          contradictionCandidates.push({ a: withEmb[i], b: withEmb[j], score });
        }
        continue;
      }
      toMerge.push([withEmb[i].id as string, withEmb[j].id as string]);
      mergedSet.add(withEmb[j].id as string);
    }
  }

  // 合併：保留第一條，重複的降 archive（可溯，不硬刪）
  if (!dryRun) {
    for (const [keepId, loserId] of toMerge) {
      const keepDoc = insights.find(i => i.id === keepId);
      const loserDoc = insights.find(i => i.id === loserId);
      if (keepDoc && loserDoc) {
        // 更新 hitCount 取最大值
        const mergedHitCount = Math.max((keepDoc.hitCount as number) || 0, (loserDoc.hitCount as number) || 0);
        await db.collection('platform_insights').doc(keepId).update({ hitCount: mergedHitCount });
        await db.collection('platform_insights').doc(loserId).update({
          tier: 'archive',
          mergedInto: keepId,
          archivedReason: 'dedup_merge',
          archivedAt: new Date().toISOString(),
        });
        merged.push(`${loserDoc.title} → ${keepDoc.title}`);
      }
    }
  }

  const client = getAnthropicClient(apiKey);

  // 2b. 矛盾裁決（2026-07-07 新增）
  //
  // 分工天條：找配對（cosine 灰區）、驗回答格式、寫欄位、降級——全是程式；
  // 只有「這兩條是不是同一件事實且互相矛盾」這一個判斷題丟 LLM。
  // LLM 回答視為不可信文字：JSON 壞了 / 答非 A|B → 跳過這對，不 re-ask 模型修，
  // 下次 sleep 自然重審。輸家寫 supersededBy 降 archive，仿 mergedInto，永不硬刪。
  // 兩層上限，防吃光 lambda（runner / /api/sleep 的 maxDuration = 300）：
  // - 對數上限：每次睡眠最多 12 對，其餘下輪再審（備忘錄會接棒）
  // - 時間預算：裁決迴圈總計 60s，到了就停；單次 bridge call 40s timeout
  //   （實測 bridge 冷呼叫 34s / 暖呼叫 7.5s；預設 280s 一次卡住就吃光 lambda）
  const MAX_ARBITRATION_PAIRS = 12;
  const ARBITRATION_TIME_BUDGET_MS = 60_000;
  const arbClient = getAnthropicClient(apiKey, { bridgeTimeoutMs: 40_000 });
  const contradictions: string[] = [];
  const contradictionDetail: Array<Record<string, unknown>> = [];
  const supersededSet = new Set<string>();

  // 裁決備忘錄：記憶內容不可變，一對判一次就夠。沒有這層的話，
  // 窄域 embedding 坍縮（Vivi 實測 200 條記憶生出 649 對 cosine>0.7，不相關的也 0.98+）
  // 會讓同樣的配對每晚重複送審。判過就記檔，穩態只審新記憶帶來的新配對。
  const pairKey = (x: string, y: string) => x < y ? `${x}_${y}` : `${y}_${x}`;
  const checkedPairs = new Set<string>();
  const checksSnap = await db.collection('platform_contradiction_checks')
    .where('characterId', '==', characterId)
    .select()
    .get();
  checksSnap.forEach(d => checkedPairs.add(d.id));

  // 排序用「配對中較新記憶的時間」而非 cosine——窄域坍縮下 cosine 0.98+ 沒有鑑別力，
  // 而矛盾裁決要抓的正是「新記憶推翻舊事實」，新事實的配對優先審
  const pairNewest = ({ a, b }: { a: Record<string, unknown>; b: Record<string, unknown> }) =>
    Math.max(
      new Date(String(a.createdAt || 0)).getTime() || 0,
      new Date(String(b.createdAt || 0)).getTime() || 0,
    );
  const uncheckedCandidates = contradictionCandidates
    .filter(({ a, b }) => !checkedPairs.has(pairKey(a.id as string, b.id as string)));
  const rankedPairs = uncheckedCandidates
    .sort((x, y) => pairNewest(y) - pairNewest(x))
    .slice(0, MAX_ARBITRATION_PAIRS);
  const droppedByCap = uncheckedCandidates.length - rankedPairs.length;

  const arbStartedAt = Date.now();
  let arbTimeBudgetHit = false;

  for (const { a, b, score } of rankedPairs) {
    if (Date.now() - arbStartedAt > ARBITRATION_TIME_BUDGET_MS) { arbTimeBudgetHit = true; break; }
    // 這輪已被去重合併或已被裁決的，跳過剩餘配對
    if (mergedSet.has(a.id as string) || mergedSet.has(b.id as string)) continue;
    if (supersededSet.has(a.id as string) || supersededSet.has(b.id as string)) continue;

    const judged = await judgeContradiction(arbClient, characterId, a, b);
    if (!judged) {
      // 單對失敗（bridge 斷線/JSON 壞）不阻斷睡眠，不記備忘錄，這對下輪再審
      contradictionDetail.push({ a: `${a.title}`, b: `${b.title}`, cosine: Math.round(score * 1000) / 1000, verdict: 'error', action: 'none' });
      continue;
    }
    const { verdict, actionable, currentIsA } = judged;

    contradictionDetail.push({
      a: `${a.title}`, b: `${b.title}`, cosine: Math.round(score * 1000) / 1000,
      verdict, action: actionable ? `supersede ${currentIsA ? 'B' : 'A'}` : 'none',
    });

    if (!dryRun) {
      await db.collection('platform_contradiction_checks').doc(pairKey(a.id as string, b.id as string)).set({
        characterId,
        aId: a.id, bId: b.id,
        contradictory: actionable,
        checkedAt: new Date().toISOString(),
      });
    }
    if (!actionable) continue;

    const winner = currentIsA ? a : b;
    const loser = currentIsA ? b : a;
    supersededSet.add(loser.id as string);

    if (!dryRun) {
      await db.collection('platform_insights').doc(loser.id as string).update({
        tier: 'archive',
        supersededBy: winner.id as string,
        archivedReason: 'contradiction_superseded',
        archivedAt: new Date().toISOString(),
      });
    }
    contradictions.push(`${loser.title} ⇒ 由「${winner.title}」取代`);
  }

  // 3. 自我洞察
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
    await trackCost(characterId, 'claude-haiku-4-5-20251001', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0, 'sleep');

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

  // 4. self_awareness：跨對話模式提煉（水位線機制，不重複提煉）
  const lastAwarenessAt = char.last_self_awareness_at
    ? new Date(char.last_self_awareness_at as string).getTime()
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

      await trackCost(characterId, 'claude-haiku-4-5-20251001', awarenessRes.usage?.input_tokens ?? 0, awarenessRes.usage?.output_tokens ?? 0, 'sleep-awareness');
      const raw = stripJson(((awarenessRes.content[0] as Anthropic.TextBlock).text || ''));
      const awareness = JSON.parse(raw);
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
      const awarenessContent = `觸發情境：${awareness.trigger}\n模式：${awareness.pattern}\n與根的關係：${awareness.rootRelation}`;
      const embedding = await generateEmbedding(awarenessContent);

      await db.collection('platform_insights').add({
        characterId,
        title: `自我認知：${awareness.trigger?.slice(0, 20) || '跨對話模式'}`,
        content: awarenessContent,
        trigger: awareness.trigger,
        pattern: awareness.pattern,
        rootRelation: awareness.rootRelation,
        type: 'self_awareness',
        source: 'sleep_self_awareness',
        eventDate: today,
        tier: 'self',
        hitCount: 0,
        lastHitAt: null,
        basedOnCount: newInsights.length,
        embedding,
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
    try {
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

      await trackCost(characterId, 'claude-haiku-4-5-20251001', propRes.usage?.input_tokens ?? 0, propRes.usage?.output_tokens ?? 0, 'sleep-proposal');
      const proposal = JSON.parse(stripJson((propRes.content[0] as Anthropic.TextBlock).text.trim()));

      await db.collection('platform_soul_proposals').add({
        characterId,
        proposedChange: proposal.proposedChange,
        reason: proposal.reason,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      proposalCreated = true;
    } catch { /* 解析失敗不中斷 */ }
  }

  // knowledge 去重 — 停用
  // 知識庫條目是人工整理的獨立資料（產品成分、定位、圖片等），
  // 不適用語意去重。高相似度不代表重複，而是同產品的不同面向。
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
  // skills 是短句技巧描述，不是長篇敘事，純 cosine 誤殺風險低——維持原判準
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
        fixRes.usage?.input_tokens ?? 0, fixRes.usage?.output_tokens ?? 0, 'sleep-fix');

      const raw = stripJson((fixRes.content[0] as Anthropic.TextBlock).text);
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
      // 複用 getMemoryType（唯一真相），不再內聯複製 source 清單
      identity: insights.filter(i => {
        const mType = String(i.memoryType || '');
        if (mType === 'identity') return true;
        if (mType === 'knowledge') return false;
        return getMemoryType(String(i.source || '')) === 'identity';
      }).length,
      knowledge: insights.filter(i => {
        const mType = String(i.memoryType || '');
        if (mType === 'knowledge') return true;
        if (mType === 'identity') return false;
        return getMemoryType(String(i.source || '')) === 'knowledge';
      }).length,
    },
    rootAnchorSource: rootAnchorEmbeddings.length > 0
      ? (await db.collection('platform_knowledge').where('characterId','==',characterId).limit(1).get()).empty
        ? 'soul_core'
        : 'knowledge_base'
      : 'none',
    blockedFromCore: blocked.length,
    blockedNames: blocked,
    contradictionArbitration: {
      candidates: contradictionCandidates.length,
      alreadyChecked: contradictionCandidates.length - uncheckedCandidates.length,
      judged: rankedPairs.length,
      superseded: contradictions.length,
      droppedByCap, // 超過每輪上限、留待下輪的配對數（不沉默截斷）
      timeBudgetHit: arbTimeBudgetHit, // true = 15s 預算用完提前收工，剩的下輪審
      detail: contradictionDetail,
    },
  };

  return {
    summary: {
      totalInsights: insights.length,
      merged: merged.length,
      contradictions: contradictions.length,
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
  };
}
