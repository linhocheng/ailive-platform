/**
 * voice-cleanup — 即時語音通話結束 cleanup worker
 *
 * 觸發：Cloud Tasks（ailive-realtime-2026/ailive-cleanup queue）
 * 呼叫者：realtime_agent.py on_disconnected（enqueue < 1s，在 SIGUSR1 kill 之前）
 *
 * 做的事：
 *   1. save_conversation（messages merge + summary compression）
 *   2. extract_session_summary → lastSession 快照
 *   3. extract_and_save_insights（角色記憶提煉）
 *   4. reflectAndMarkFulfilled（承諾兌現標記）
 *   5. autoExtractUserProfile（用戶 profile 更新）
 *   6. cost tracking（LLM + TTS）
 *
 * Auth：X-Cleanup-Secret header（shared secret，存 Vercel env + Cloud Run Secret Manager）
 */

import { type NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '@/lib/firebase-admin';
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import { messagesToDialogueText, extractSessionSummary } from '@/lib/session-summary';
import { reflectAndMarkFulfilled } from '@/lib/promise-reflection';
import { autoExtractUserProfile } from '@/lib/user-profile-extractor';
import { trackCost, trackTTSCost } from '@/lib/cost-tracker';

export const maxDuration = 300;

interface TranscriptMessage {
  role: string;
  content: string;
  timestamp?: string;
}

interface CleanupPayload {
  convId: string;
  characterId: string;
  userId: string;
  transcript: TranscriptMessage[];
  costLlm: { input: number; output: number };
  costTtsChars: { count: number };
  enqueuedAt: string;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cleanup-secret');
  const expected = process.env.CLEANUP_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let convId: string;
  try {
    const body = (await req.json()) as { convId?: string };
    convId = body.convId || '';
    if (!convId) throw new Error('convId missing');
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const db = getFirestore();
  const stagingRef = db.collection('platform_cleanup_queue').doc(convId);
  const stagingDoc = await stagingRef.get();
  if (!stagingDoc.exists) {
    return NextResponse.json({ error: 'staging doc not found', convId }, { status: 404 });
  }

  const payload = stagingDoc.data() as CleanupPayload;
  const { characterId, userId, transcript, costLlm, costTtsChars } = payload;

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const client = getAnthropicClient(apiKey);
  const results: Record<string, unknown> = {};

  // 1. save_conversation + extract_session_summary
  try {
    const convRef = db.collection('platform_conversations').doc(convId);
    const convDoc = await convRef.get();
    const convData = (convDoc.exists ? convDoc.data() : {}) as Record<string, unknown>;
    const existingMessages = (convData.messages || []) as TranscriptMessage[];
    const existingSummary = String(convData.summary || '');
    const existingCount = Number(convData.messageCount || 0);

    const mergedMessages = [...existingMessages, ...transcript];
    const newCount = existingCount + transcript.length;

    let newSummary = existingSummary;
    let finalMessages = mergedMessages;

    if (mergedMessages.length > 10) {
      const olderMessages = mergedMessages.slice(0, mergedMessages.length - 10);
      if (olderMessages.length >= 4) {
        try {
          const compressText = olderMessages
            .map((m) => `${m.role === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 100)}`)
            .join('\n');
          const compressRes = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            messages: [{
              role: 'user',
              content: `以下是對話的早期段落，請壓縮成摘要。\n\n務必保留（漏寫即失憶）：\n- 用戶說過的具體事（人事時地物、數字、名稱、地點）\n- 用戶的處境與情緒（最近發生什麼、現在感覺怎樣）\n- 角色（你）做過的承諾、答應的事、約定的時間\n- 角色（你）問過但用戶還沒回答的問題\n- 未完成、待續的話題\n\n抽象的「兩人聊了商業策略」這種無細節句子算失敗。\n直接輸出摘要本體，不要標題、不要編號。\n\n${compressText}`,
            }],
          });
          const freshSummary = (compressRes.content[0] as Anthropic.TextBlock).text.trim();
          const merged = existingSummary ? `${existingSummary}\n${freshSummary}` : freshSummary;
          newSummary = merged.slice(-800);
          finalMessages = mergedMessages.slice(-10);
        } catch {
          finalMessages = mergedMessages.slice(-10);
        }
      } else {
        finalMessages = mergedMessages.slice(-10);
      }
    }

    const dialogueText = messagesToDialogueText(transcript);
    const lastSession = await extractSessionSummary(client, dialogueText);

    const savePayload: Record<string, unknown> = {
      characterId,
      userId: userId || 'anon',
      messages: finalMessages,
      messageCount: newCount,
      summary: newSummary,
      updatedAt: new Date().toISOString(),
    };
    if (lastSession) {
      savePayload.lastSession = { ...lastSession, updatedAt: new Date().toISOString() };
    }
    await convRef.set(savePayload, { merge: true });
    results.saveConversation = { appended: transcript.length, total: finalMessages.length, lastSession: !!lastSession };
  } catch (e) {
    console.error('[voice-cleanup] save_conversation failed:', e);
    results.saveConversation = { error: String(e) };
  }

  // 2. extract_and_save_insights
  try {
    if (transcript.length >= 2) {
      const dialogueText = transcript
        .slice(-20)
        .map((m) => `${m.role === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 150)}`)
        .join('\n');
      const insightRes = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `以下是一段即時語音對話記錄，請提煉出 1-2 條值得角色記住的洞察。\n重點：用戶說了什麼重要的事？角色感受到了什麼？這次對話有什麼值得記住的？\n\n用 JSON 陣列回傳：[{"title":"...","content":"...","importance":1-3}]\nimportance: 1=普通/2=重要/3=深刻\n只回傳 JSON，不要其他文字。\n\n對話：\n${dialogueText}`,
        }],
      });
      const raw = (insightRes.content[0] as Anthropic.TextBlock).text.trim();
      const cleaned = raw.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
      const insights = JSON.parse(cleaned) as Array<{ title: string; content: string; importance?: number }>;
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
      const saved: string[] = [];
      for (const ins of insights) {
        if (!ins.title || !ins.content) continue;
        const importance = Number(ins.importance || 2);
        const ref = await db.collection('platform_insights').add({
          characterId,
          ...(userId && !String(userId).startsWith('anon') ? { userId } : {}),
          title: ins.title,
          content: ins.content,
          importance,
          source: 'realtime_conversation',
          eventDate: today,
          tier: 'fresh',
          hitCount: importance >= 3 ? 2 : 0,
          lastHitAt: null,
          conversationId: convId,
          createdAt: new Date().toISOString(),
        });
        saved.push(ref.id);
      }
      if (saved.length > 0) {
        await db.collection('platform_characters').doc(characterId).update({
          'growthMetrics.totalInsights': FieldValue.increment(saved.length),
          updatedAt: new Date().toISOString(),
        });
      }
      results.insights = { saved: saved.length };
    }
  } catch (e) {
    console.error('[voice-cleanup] insights failed:', e);
    results.insights = { error: String(e) };
  }

  // 3. promise reflection
  if (userId) {
    try {
      const transcriptText = transcript
        .map((m) => `${m.role === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 300)}`)
        .join('\n');
      const refStats = await reflectAndMarkFulfilled({
        characterId,
        userId,
        transcript: transcriptText,
        anthropicApiKey: apiKey,
      });
      results.promiseReflection = refStats;
    } catch (e) {
      console.error('[voice-cleanup] promise-reflection failed:', e);
      results.promiseReflection = { error: String(e) };
    }
  }

  // 4. user profile extraction
  if (userId) {
    try {
      const transcriptText = transcript
        .slice(-20)
        .map((m) => `${m.role === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 150)}`)
        .join('\n');
      const profileStats = await autoExtractUserProfile(transcriptText, userId, characterId, apiKey);
      results.userProfile = profileStats;
    } catch (e) {
      console.error('[voice-cleanup] user-profile failed:', e);
      results.userProfile = { error: String(e) };
    }
  }

  // 5. cost tracking
  try {
    if (costLlm.input > 0 || costLlm.output > 0) {
      await trackCost(characterId, 'claude-haiku-4-5-20251001', costLlm.input, costLlm.output, 'voice-stream');
    }
    if (costTtsChars.count > 0) {
      await trackTTSCost(characterId, 'minimax', costTtsChars.count);
    }
    results.cost = { llm: costLlm, tts: costTtsChars };
  } catch (e) {
    console.error('[voice-cleanup] cost tracking failed:', e);
    results.cost = { error: String(e) };
  }

  await stagingRef.delete();
  console.log('[voice-cleanup] done', { convId, characterId, results });
  return NextResponse.json({ ok: true, convId, results });
}
