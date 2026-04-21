/**
 * POST /api/voice-end
 * 語音對話結束 — 強制沉澱記憶
 * Body: { characterId: string, conversationId: string }
 * 不等 20 輪，立刻提煉這次對話的 insight
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateEmbedding } from '@/lib/embeddings';
import { redis } from '@/lib/redis';
import { extractSessionSummary } from '@/lib/session-summary';

export const maxDuration = 60;

function getTaipeiDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, conversationId } = await req.json();
    if (!characterId || !conversationId) {
      return NextResponse.json({ error: 'characterId, conversationId 必填' }, { status: 400 });
    }

    // 讀對話記錄
    const convDoc = await db.collection('platform_conversations').doc(conversationId).get();
    if (!convDoc.exists) {
      return NextResponse.json({ error: '找不到對話記錄' }, { status: 404 });
    }

    const messages = (convDoc.data()?.messages || []) as Array<{ role: string; content: string }>;
    if (messages.length < 2) {
      return NextResponse.json({ success: true, message: '對話太短，跳過沉澱', insights: [] });
    }

    // 組對話文字
    const dialogueText = messages
      .slice(-20) // 最近 20 條
      .map(m => `${m.role === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 150)}`)
      .join('\n');

    // 用 Haiku 抽 insights（這支 API 專用）
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const extractRes = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `以下是一段語音對話記錄，請提煉出 1-3 條值得角色記住的洞察。
重點：用戶說了什麼重要的事？角色感受到了什麼？這次對話有什麼值得記住的？

用 JSON 陣列回傳：[{"title":"...","content":"...","importance":1-3}]
importance: 1=普通/2=重要/3=深刻
只回傳 JSON，不要其他文字。

對話：
${dialogueText}`,
      }],
    });

    const raw = (extractRes.content[0] as Anthropic.TextBlock).text.trim();
    const cleaned = raw.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
    const insights = JSON.parse(cleaned) as Array<{ title: string; content: string; importance: number }>;

    // sessionSummary 改用共用 lib 萃取（並行打，省時間）
    const sessionSummary = await extractSessionSummary(client, dialogueText);

    const today = getTaipeiDate();
    const saved: string[] = [];

    for (const ins of insights) {
      const embedding = await generateEmbedding(`${ins.title} ${ins.content}`);
      const ref = await db.collection('platform_insights').add({
        characterId,
        title: ins.title,
        content: ins.content,
        importance: ins.importance ?? 2,
        source: 'voice_conversation',
        eventDate: today,
        tier: 'fresh',
        hitCount: ins.importance >= 3 ? 2 : 0,
        lastHitAt: null,
        conversationId,
        embedding,
        createdAt: new Date().toISOString(),
      });
      saved.push(ref.id);
    }

    // 更新 growthMetrics
    if (saved.length > 0) {
      await db.collection('platform_characters').doc(characterId).update({
        'growthMetrics.totalInsights': FieldValue.increment(saved.length),
        updatedAt: new Date().toISOString(),
      });
    }

    // ── A 線：寫 lastSession 到對話 doc，給下次通話 Smart Greeting ──
    // 不管 insights 多少條，只要 sessionSummary 解析到就寫
    if (sessionSummary && sessionSummary.summary) {
      await db.collection('platform_conversations').doc(conversationId).update({
        lastSession: {
          summary: sessionSummary.summary,
          endingMood: sessionSummary.endingMood || 'neutral',
          unfinishedThreads: sessionSummary.unfinishedThreads || [],
          disconnectReason: 'user_hangup', // 未來前端可傳入更細的值
          updatedAt: new Date().toISOString(),
        },
      });
      // 清對話 cache，下次 voice-stream 才讀得到新 lastSession（LESSONS 第 1 條）
      try { await redis.del(`conv:${conversationId}`); } catch (_e) { /* 不阻斷 */ }
    }

    return NextResponse.json({
      success: true,
      insights,
      sessionSummary,
      saved: saved.length,
      message: `已沉澱 ${saved.length} 條記憶${sessionSummary ? '、寫入 lastSession' : ''}`,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
