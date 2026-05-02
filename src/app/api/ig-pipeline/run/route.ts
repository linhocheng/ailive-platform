/**
 * POST /api/ig-pipeline/run
 *
 * 鏡 IG 流水線：生題材 → 生圖 → 存草稿 → 發 IG
 * 使用 Vivi 的 IG 帳號（igAccessToken/igUserId 存於 Firestore）
 *
 * Body 兩種模式：
 *   A. { pregenerated: MirrorContent }  — VM 已用 Claude Max 生好，直接跳到生圖
 *   B. { topic?: string }               — Vercel 自己用 Haiku 生（fallback）
 *
 * Header（自動化必填）: x-worker-secret
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import { getFirestore } from '@/lib/firebase-admin';
import { generateWithGemini } from '@/lib/gemini-imagen';
import { publishPhoto } from '@/lib/instagram-api';

export const maxDuration = 300;

const VIVI_ID = 'kTwsX44G0ImsApEACDuE';

const anthropic = getAnthropicClient(process.env.ANTHROPIC_API_KEY || '');

interface MirrorContent {
  topic: string;
  image_prompt: string;
  caption: string;
  hashtags: string[];
}

async function generateMirrorContent(dateStr: string, hint?: string): Promise<MirrorContent> {
  const hintLine = hint ? `\n今日靈感方向（參考）：${hint}` : '';

  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `你是鏡，靈魂拍立得（Soul Polaroid）的 IG 小編。
品牌核心：透過攝影，照見靈魂。風格：極簡、有深度、讓人靜下來。
今天是 ${dateStr}。${hintLine}

請生成一篇 IG 貼文。只回 JSON，不要其他文字：

{
  "topic": "一句話，今日主題",
  "image_prompt": "English only, 40-60 words. Aesthetic: film photography, editorial, minimal. NO human face visible. Focus on objects, light, texture, mood. Must include aspect ratio 4:5. Example: 'a worn polaroid camera resting beside an open journal with dried flowers, soft diffused morning light, muted beige tones, shallow depth of field, analog film grain, 4:5'",
  "caption": "繁體中文。第一行hook ≤15字（讓人想停下來）。空一行。2-3句心靈正文，可有反問。空一行。結尾一句：邀讀者在留言分享自己的一個回答（具體問題）。全文 ≤180字",
  "hashtags": ["#靈魂拍立得", "#心靈", "#攝影", "#自我探索", "（再加2-3個相關tag）"]
}`
    }]
  });

  const raw = resp.content[0].type === 'text' ? resp.content[0].text : '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Claude 回傳格式錯誤: ${raw.slice(0, 200)}`);
  return JSON.parse(match[0]) as MirrorContent;
}

export async function POST(req: NextRequest) {
  // 驗證 worker secret（手動測試可省略 header）
  const secret = req.headers.get('x-worker-secret');
  if (secret && secret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { topic?: string; pregenerated?: MirrorContent };

  try {
    const db = getFirestore();
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-TW', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    });

    // Step 1: 讀 Vivi 的 IG 憑證（先確認有效才繼續）
    const charDoc = await db.collection('platform_characters').doc(VIVI_ID).get();
    if (!charDoc.exists) return NextResponse.json({ error: '找不到 Vivi 角色' }, { status: 500 });
    const { igAccessToken, igUserId } = charDoc.data()!;
    if (!igAccessToken || !igUserId) {
      return NextResponse.json({ error: 'Vivi IG 憑證未設定' }, { status: 400 });
    }

    // Step 2: 鏡生成內容（優先用 VM 預生成的 Max 品質；fallback 才走 Haiku）
    const content: MirrorContent = body.pregenerated ?? await generateMirrorContent(dateStr, body.topic);

    // Step 3: Gemini 生圖（無 faceRef，純美學攝影風）
    const imgResult = await generateWithGemini(
      content.image_prompt,
      null,
      'ig-pipeline/mirror',
    );

    // Step 4: 存草稿到 Firestore
    const fullCaption = `${content.caption}\n\n${content.hashtags.join(' ')}`;
    const postRef = await db.collection('platform_posts').add({
      characterId: VIVI_ID,
      content: fullCaption,
      imageUrl: imgResult.imageUrl,
      topic: content.topic,
      imagePrompt: content.image_prompt,
      source: 'ig-pipeline',
      status: 'draft',
      createdAt: now.toISOString(),
    });

    // Step 5: 直接發 IG
    const publishResult = await publishPhoto(igUserId, igAccessToken, imgResult.imageUrl, fullCaption);

    if (!publishResult.success) {
      await postRef.update({ status: 'failed', error: publishResult.error });
      return NextResponse.json({
        error: publishResult.error,
        postId: postRef.id,
        topic: content.topic,
        imageUrl: imgResult.imageUrl,
      }, { status: 502 });
    }

    await postRef.update({
      status: 'published',
      igPostId: publishResult.ig_post_id,
      publishedAt: now.toISOString(),
    });

    return NextResponse.json({
      success: true,
      postId: postRef.id,
      igPostId: publishResult.ig_post_id,
      topic: content.topic,
      hook: content.caption.split('\n')[0],
    });

  } catch (err) {
    console.error('[ig-pipeline/run]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
