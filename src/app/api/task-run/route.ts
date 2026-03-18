/**
 * /api/task-run — 排程任務執行引擎（謀謀模式）
 *
 * POST { characterId, taskId, taskType, intent, date }
 *
 * 謀謀模式：
 *   直接呼叫 Claude API（不走 /api/dialogue）
 *   system = 角色靈魂
 *   user = 任務 intent + 最近 insights + 相關記憶
 *   → Claude 直接輸出結果
 *   → API 自己存草稿 / insights / 通知
 *   不讓角色問確認，直接存
 *
 * 適用所有角色 — PERSONA_TEMPLATE 的排程執行骨架
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { generateImageForCharacter } from '@/lib/generate-image';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 120;

function getTaipeiDate(): string {
  const now = new Date();
  const tai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return tai.toISOString().slice(0, 10);
}

// 讀角色最近的 insights（最多 5 條，按時間排序）
async function getRecentInsights(db: ReturnType<typeof getFirestore>, characterId: string): Promise<string> {
  try {
    const snap = await db.collection('platform_insights')
      .where('characterId', '==', characterId)
      .limit(30)
      .get();

    const docs = snap.docs
      .map(d => ({ ...d.data(), id: d.id }))
      .filter((d: Record<string, unknown>) => d.tier !== 'archive')
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        String(b.eventDate || '').localeCompare(String(a.eventDate || ''))
      )
      .slice(0, 5);

    if (docs.length === 0) return '';

    const lines = docs.map((d: Record<string, unknown>) => {
      const tier = d.tier === 'self' ? '[關於我]' : '[記憶]';
      return `${tier} ${String(d.title || '')}：${String(d.content || '').slice(0, 80)}`;
    });

    return `\n\n【最近的事與感受】\n${lines.join('\n')}`;
  } catch { return ''; }
}

// 語義搜尋相關知識（query 跟 intent 相關的知識庫內容）
async function getRelevantKnowledge(db: ReturnType<typeof getFirestore>, characterId: string, query: string): Promise<string> {
  try {
    const qEmb = await generateEmbedding(query);
    const snap = await db.collection('platform_knowledge')
      .where('characterId', '==', characterId)
      .limit(50)
      .get();

    const results = snap.docs
      .map(d => {
        const data = d.data() as Record<string, unknown>;
        const score = data.embedding ? cosineSimilarity(qEmb, data.embedding as number[]) : 0;
        return { data, score };
      })
      .filter(r => r.score >= 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (results.length === 0) return '';

    const lines = results.map(r =>
      `[知識] ${String(r.data.title || '')}：${String(r.data.content || '').slice(0, 150)}`
    );
    return `\n\n【相關知識庫】\n${lines.join('\n')}`;
  } catch { return ''; }
}

// 存 insight
async function saveInsight(
  db: ReturnType<typeof getFirestore>,
  characterId: string,
  title: string,
  content: string,
  source: string,
  date: string,
): Promise<void> {
  try {
    const embedding = await generateEmbedding(`${title} ${content}`);
    await db.collection('platform_insights').add({
      characterId, title, content, source,
      eventDate: date, tier: 'fresh',
      hitCount: 0, lastHitAt: null,
      embedding, createdAt: new Date().toISOString(),
    });
  } catch { /* 不阻斷 */ }
}

// 存草稿（含生圖）
async function savePostDraft(
  db: ReturnType<typeof getFirestore>,
  characterId: string,
  content: string,
  topic: string,
  date: string,
  imagePrompt?: string,
): Promise<string> {
  // 生圖（有 imagePrompt 才生）
  let imageUrl = '';
  if (imagePrompt) {
    try {
      const imgResult = await generateImageForCharacter(characterId, imagePrompt);
      imageUrl = imgResult.imageUrl || '';
    } catch (e) {
      console.warn('[task-run] 生圖失敗，草稿無圖：', e);
    }
  }

  const ref = await db.collection('platform_posts').add({
    characterId, content, imageUrl, topic,
    status: 'draft', scheduledAt: null, publishedAt: null,
    createdAt: new Date().toISOString(),
  });
  // 同時存發文記憶
  await saveInsight(db, characterId,
    `發文：${topic || date}`,
    `${date} 寫了一篇草稿。主題：${topic || '（未命名）'}。摘要：${content.slice(0, 80)}`,
    'post_memory', date
  );
  return ref.id;
}

export async function POST(req: NextRequest) {
  try {
    const { characterId, taskId, taskType, intent } = await req.json();
    if (!characterId || !taskType) {
      return NextResponse.json({ error: 'characterId, taskType 必填' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY 未設定' }, { status: 500 });

    const db = getFirestore();
    const today = getTaipeiDate();

    // 防重複
    if (taskId) {
      const recordId = `${characterId}-${taskId}-${today}-taskrun`;
      const recordRef = db.collection('platform_proactive_records').doc(recordId);
      if ((await recordRef.get()).exists) {
        return NextResponse.json({ success: true, skipped: true, reason: '今日已執行' });
      }
      await recordRef.set({ characterId, taskId, taskType, date: today, executedAt: new Date().toISOString() });
    }

    // 讀角色資料
    const charDoc = await db.collection('platform_characters').doc(characterId).get();
    if (!charDoc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });
    const char = charDoc.data()!;
    const soulText = (char.soul_core as string) || (char.enhancedSoul as string) || '';
    const aiName = (char.name as string) || 'AI';

    // 組 context
    const recentInsights = await getRecentInsights(db, characterId);
    const relevantKnowledge = await getRelevantKnowledge(db, characterId, intent || taskType);

    // 組 system prompt（靈魂）
    const systemPrompt = `${soulText}

---
今天日期（台北）：${today}
這是自動排程執行。沒有用戶在場，不需要等確認，直接完成任務，直接輸出結果。`;

    // 組 user prompt（任務 + context）
    const contextBlock = `${recentInsights}${relevantKnowledge}`;

    let userPrompt = '';
    let outputFormat = '';

    if (taskType === 'post') {
      outputFormat = `輸出格式（JSON，只輸出 JSON，不要其他文字）：
{"topic":"主題一句話","content":"完整貼文文案（含 hashtag）","imagePrompt":"配圖描述（英文，50字以內）","outfitConcept":"這篇文的衣著概念（中文一句話，描述今天的穿搭情緒）"}`;
      userPrompt = `【排程任務：生成 IG 貼文草稿】
任務意義：${intent || '從今天的感受出發，寫一篇真實的貼文'}
${contextBlock}

從上面的記憶和知識出發，寫一篇今天的 IG 貼文草稿。
不重複最近說過的主題。從感受出發，不從格式出發。

生圖說明（imagePrompt）：
- 根據這篇文的情緒和主題，決定今天的衣著和畫面
- 衣著要跟內容一起長出來：文案越重、越靜止，衣著越簡單有力；文案越流動，衣著越有線條感
- 行動派時尚風格：最短熱褲、運動內衣、oversized jacket、皮衣、不對稱剪裁——根據今天的情緒選一個
- 黑白底片感、森山大道顆粒、高對比、模糊邊緣、舞台感
- 英文描述，50字以內

${outputFormat}`;

    } else if (taskType === 'learn') {
      outputFormat = `輸出格式（JSON）：
{"title":"洞察標題（一句話）","content":"完整洞察內容（100-150字）"}`;
      userPrompt = `【排程任務：主動學習】
任務意義：${intent || '找到讓心臟緊一下的東西，把它帶進今天的存在'}
${contextBlock}

根據你的知識和最近的狀態，分享一個今天主動去了解的洞察。
不重複最近記過的東西。
${outputFormat}`;

    } else if (taskType === 'reflect') {
      outputFormat = `輸出格式（JSON）：
{"title":"反思標題（一句話）","content":"完整反思內容（80-120字）"}`;
      userPrompt = `【排程任務：每日省思】
任務意義：${intent || '讓身體裡的東西停夠久，問自己哪裡不同意'}
${contextBlock}

回看今天，說一件你真正感受到的事。不整理，不宣告，只是真實。
${outputFormat}`;

    } else if (taskType === 'explore') {
      outputFormat = `輸出格式（JSON）：
{"title":"探索標題","content":"心得（100-150字）","hasImage":true}`;
      userPrompt = `【排程任務：探索學習】
任務意義：${intent || '搜尋今天讓你有感覺的議題，寫心得'}
${contextBlock}

根據你的知識庫和最近狀態，分享一個今天讓你有感覺的探索和心得。
${outputFormat}`;

    } else if (taskType === 'sleep') {
      outputFormat = `輸出格式（JSON）：
{"title":"今日沉殿","content":"沉殿內容（60-80字）"}`;
      userPrompt = `【排程任務：作夢沉殿】
任務意義：${intent || '今天的頻率收攏，不帶著未完成的事進入睡眠'}
${contextBlock}

整理今天，說出那一個最後留著的句子或畫面。
${outputFormat}`;

    } else {
      outputFormat = `輸出格式（JSON）：{"title":"標題","content":"內容"}`;
      userPrompt = `【排程任務：${taskType}】
任務意義：${intent || '完成這個任務'}
${contextBlock}
${outputFormat}`;
    }

    // 呼叫 Claude（謀謀模式：直接輸出，不走 dialogue）
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = (response.content[0] as Anthropic.TextBlock).text.trim()
      .replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();

    let result: Record<string, string>;
    try {
      result = JSON.parse(raw);
    } catch {
      result = { title: `${taskType} ${today}`, content: raw };
    }

    // 根據 taskType 決定怎麼存
    let savedId = '';
    if (taskType === 'post') {
      savedId = await savePostDraft(db, characterId, result.content || '', result.topic || '', today, result.imagePrompt);
    } else {
      await saveInsight(db, characterId,
        result.title || `${taskType} ${today}`,
        result.content || '',
        `scheduler_${taskType}`,
        today
      );
    }

    return NextResponse.json({
      success: true,
      characterId,
      taskType,
      date: today,
      result,
      savedId: savedId || undefined,
      aiName,
    });

  } catch (e: unknown) {
    console.error('[task-run]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
