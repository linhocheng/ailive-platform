/**
 * POST /api/dialogue-end
 * 文字對話結束沉澱 — 由前端在以下任一條件觸發：
 *   1. visibilitychange（切分頁/最小化）
 *   2. beforeunload（關閉視窗）→ sendBeacon
 *   3. 閒置超過 10 分鐘
 *
 * 冪等鎖：conv doc 寫入 dialogueEndAt，同一 convId 只跑一次。
 * 補強（v2）：對齊 voice-end，短對話不再漏寫 insight + lastSession。
 *   - messages < 20 → 補跑 Haiku insight 提煉
 *   - conv 無 lastSession → 補跑 extractSessionSummary
 *   - always → promise-reflection
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateEmbedding } from '@/lib/embeddings';
import { redis } from '@/lib/redis';
import { extractSessionSummary } from '@/lib/session-summary';
import { reflectAndMarkFulfilled } from '@/lib/promise-reflection';
import { autoExtractUserProfile } from '@/lib/user-profile-extractor';

export const maxDuration = 60;

function getTaipeiDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { characterId, conversationId, userId } = body as Record<string, string>;

    if (!characterId || !conversationId) {
      return NextResponse.json({ error: 'characterId, conversationId 必填' }, { status: 400 });
    }

    const db = getFirestore();
    const convRef = db.collection('platform_conversations').doc(conversationId);
    const convDoc = await convRef.get();
    if (!convDoc.exists) {
      return NextResponse.json({ success: true, skipped: 'conv not found' });
    }

    // 冪等鎖：已跑過就直接回傳
    if (convDoc.data()?.dialogueEndAt) {
      return NextResponse.json({ success: true, skipped: 'already reflected' });
    }

    // 寫入鎖（先佔位，防並發重複執行）
    await convRef.update({ dialogueEndAt: FieldValue.serverTimestamp() });

    const messages = (convDoc.data()?.messages || []) as Array<{ role: string; content: string }>;
    const hasExistingLastSession = !!convDoc.data()?.lastSession?.summary;

    if (messages.length < 2) {
      return NextResponse.json({ success: true, skipped: '對話太短，跳過沉澱' });
    }

    const dialogueText = messages
      .slice(-20)
      .map(m => `${m.role === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 150)}`)
      .join('\n');

    const client = getAnthropicClient(process.env.ANTHROPIC_API_KEY || '');
    const today = getTaipeiDate();
    const savedInsights: string[] = [];
    let sessionSummary = null;

    // ── 補跑 insight 提煉（只在未達 auto_extract 門檻時）──
    if (messages.length < 20) {
      try {
        const extractRes = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: `以下是一段文字對話記錄，請提煉出 1-2 條值得角色記住的洞察。
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

        for (const ins of insights) {
          const embedding = await generateEmbedding(`${ins.title} ${ins.content}`);
          const ref = await db.collection('platform_insights').add({
            characterId,
            ...(userId && !String(userId).startsWith('anon') ? { userId } : {}),
            title: ins.title,
            content: ins.content,
            importance: ins.importance ?? 2,
            source: 'dialogue_end',
            eventDate: today,
            tier: 'fresh',
            hitCount: ins.importance >= 3 ? 2 : 0,
            lastHitAt: null,
            conversationId,
            embedding,
            createdAt: new Date().toISOString(),
          });
          savedInsights.push(ref.id);
        }

        if (savedInsights.length > 0) {
          await db.collection('platform_characters').doc(characterId).update({
            'growthMetrics.totalInsights': FieldValue.increment(savedInsights.length),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.warn('dialogue-end insight extraction failed:', e);
      }
    }

    // ── 補跑 lastSession（只在對話中途未寫時）──
    if (!hasExistingLastSession) {
      try {
        sessionSummary = await extractSessionSummary(client, dialogueText);
        if (sessionSummary?.summary) {
          await convRef.update({
            lastSession: {
              summary: sessionSummary.summary,
              endingMood: sessionSummary.endingMood || 'neutral',
              unfinishedThreads: sessionSummary.unfinishedThreads || [],
              updatedAt: new Date().toISOString(),
            },
          });
          try { await redis.del(`conv:${conversationId}`); } catch { /* 不阻斷 */ }
        }
      } catch (e) {
        console.warn('dialogue-end lastSession extraction failed:', e);
      }
    }

    // ── promise-reflection ──
    let reflectionStats = null;
    if (userId) {
      try {
        reflectionStats = await reflectAndMarkFulfilled({
          characterId,
          userId,
          transcript: dialogueText,
          anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
        });
      } catch (e) {
        console.warn('dialogue-end reflectAndMarkFulfilled failed:', e);
      }
    }

    // ── user profile 自動提取 ──
    let profileResult = null;
    if (userId) {
      try {
        profileResult = await autoExtractUserProfile(dialogueText, userId, characterId, process.env.ANTHROPIC_API_KEY || '');
      } catch (e) {
        console.warn('dialogue-end autoExtractUserProfile failed:', e);
      }
    }

    return NextResponse.json({
      success: true,
      insights: savedInsights.length,
      sessionSummary: sessionSummary ? true : hasExistingLastSession ? 'already_existed' : false,
      reflectionStats,
      profileResult,
      message: [
        savedInsights.length > 0 ? `沉澱 ${savedInsights.length} 條記憶` : null,
        sessionSummary?.summary ? '寫入 lastSession' : null,
        reflectionStats?.marked ? `標 ${reflectionStats.marked} 條已兌現` : null,
      ].filter(Boolean).join('、') || '完成（無新內容）',
    });
  } catch (e) {
    console.error('dialogue-end error:', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
