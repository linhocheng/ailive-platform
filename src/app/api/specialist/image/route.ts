/**
 * /api/specialist/image
 *
 * 瞬的出圖 endpoint。由 Firebase Function worker 呼叫。
 *
 * 流程（C 方案 · 瞬自己看圖決定角色）：
 * 1. 驗證 x-worker-secret
 * 2. 讀瞬的 soul（system_soul + soul_core）
 * 3. 若有 refs：並行下載成 base64（容錯，全失敗才拋錯）
 * 4. 用 Sonnet 4.6 + 瞬的 soul 動腦
 *    - 有 refs：multimodal call，讓瞬自己看圖判斷每張的角色
 *    - 無 refs：純文字模式
 *    → 輸出 Gemini 用的英文 PROMPT + 繁體中文 WORKLOG
 * 5. 呼叫 Gemini 生圖
 *    - 有 refs：generateWithGeminiRefs（按順序塞 refs，不加 face-lock）
 *    - 無 refs：generateWithGemini 純文字模式
 * 6. 回傳 { imageUrl, workLog, geminiPrompt, usage, refsInfo }
 *
 * 成本：
 *   - 無 refs：~$0.048/張（Sonnet 動腦 ~$0.009 + Gemini ~$0.039）
 *   - 有 refs：每多 1 張 Sonnet input 約 +$0.005（Gemini 入圖幾乎免費）
 *   - Prompt caching：瞬 soul + 指令每次固定，cache read 只收 10% input
 *
 * @author 築 · Phase 2 · C 方案
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from '@/lib/firebase-admin';
import {
  generateWithGemini,
  generateWithGeminiRefs,
  downloadRefsBase64,
} from '@/lib/gemini-imagen';

export const maxDuration = 300;
export const runtime = 'nodejs';

const SHUN_ID = 'shun-001';
const REFS_MAX = 3; // 超過靜默截斷 + log warning

export async function POST(req: NextRequest) {
  // 1. 驗證 worker secret
  const secret = req.headers.get('x-worker-secret') || '';
  const expectedSecret = (process.env.WORKER_SECRET || '').replace(/^"|"$/g, '').trim();
  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json() as {
    jobId: string;
    assigneeId: string;
    brief: { prompt: string; refs?: string[]; mood?: string | null; aspectRatio?: string };
  };

  const { jobId, brief } = body;
  if (!brief?.prompt) {
    return NextResponse.json({ error: 'brief.prompt 必填' }, { status: 400 });
  }

  try {
    // 2. 讀瞬的 soul
    const db = getFirestore();
    const shunDoc = await db.collection('platform_characters').doc(SHUN_ID).get();
    const shun = shunDoc.data();
    const systemSoul = String(shun?.system_soul || '');
    const soulCore = String(shun?.soul_core || '');
    const shunSoul = `${systemSoul}\n\n${soulCore}`.trim();
    const imagePromptPrefix = String(shun?.visualIdentity?.imagePromptPrefix || '');

    // 3. 處理 refs（若有）— 並行下載 base64，容錯
    const requestedRefs = Array.isArray(brief.refs) ? brief.refs.filter(Boolean) : [];
    const cappedRefs = requestedRefs.slice(0, REFS_MAX);
    if (requestedRefs.length > REFS_MAX) {
      console.log(`[specialist/image] job=${jobId?.slice(0, 8)} refs 超過 ${REFS_MAX} 張，截斷 ${requestedRefs.length} → ${REFS_MAX}`);
    }

    let refsSuccessful: Awaited<ReturnType<typeof downloadRefsBase64>>['successful'] = [];
    let refsFailed: string[] = [];
    if (cappedRefs.length > 0) {
      const r = await downloadRefsBase64(cappedRefs);
      refsSuccessful = r.successful;
      refsFailed = r.failed;
      // Q3 = C：全失敗才 throw，有一張成功就做
      if (refsSuccessful.length === 0 && cappedRefs.length > 0) {
        throw new Error(`所有參考圖下載失敗（${cappedRefs.length} 張）：${refsFailed.map(u => u.slice(-40)).join(', ')}`);
      }
      if (refsFailed.length > 0) {
        console.log(`[specialist/image] job=${jobId?.slice(0, 8)} refs 部分失敗 ${refsFailed.length}/${cappedRefs.length}，繼續`);
      }
    }

    const hasRefs = refsSuccessful.length > 0;

    // 4. Sonnet 4.6 + 瞬的 soul：brief → Gemini prompt + workLog
    const apiKey = (process.env.ANTHROPIC_API_KEY || '').replace(/^"|"$/g, '');
    const anthropic = new Anthropic({ apiKey });

    // 基礎指令
    const baseInstructions = `你現在收到一個出圖委託。你的任務：
1. 把 brief 轉成適合 Gemini image model 的英文 prompt（詳細、精準，包含光線/構圖/氛圍/技術細節）
2. 寫一段工作日誌（繁體中文，2-4 句），說明你的光影決策`;

    // refs 專屬指令（動態 inject）
    const refsInstructions = hasRefs ? `

你會看到 user 附上的 ${refsSuccessful.length} 張參考圖（順序與下面 image 區塊一致）。每張圖你要自己判斷它的角色，例如：
- 風格靈感（整體氛圍、光線、色調、質感）
- 要實際畫進圖裡的物件/產品
- 要保留的人臉特徵
- 要複製的場景/構圖
- 要對照的紋理
- 其他

把你的判斷直接寫進 PROMPT 英文指令裡，明確告訴 Gemini 每張圖的用途。
範例寫法：
"The first image is style inspiration — replicate its color palette and lighting atmosphere. The second image is the product to feature centrally — replicate its exact bottle shape, label, and color..."

不要在 WORKLOG 裡重述 refs 分工；WORKLOG 只說你的光影決策。` : '';

    const sysPrompt = `${shunSoul}

---

${baseInstructions}${refsInstructions}

輸出格式（嚴格遵守，不要加其他內容）：
PROMPT: <英文 prompt，一行>
WORKLOG: <工作日誌，繁體中文，2-4 句>`;

    // user content：有 refs 則 multimodal（images + text），無則純文字
    const userTextParts = [`Brief: ${brief.prompt}`];
    if (brief.mood) userTextParts.push(`氛圍: ${brief.mood}`);
    if (brief.aspectRatio) userTextParts.push(`比例: ${brief.aspectRatio}`);
    const userText = userTextParts.join('\n');

    const userContent: Anthropic.MessageParam['content'] = hasRefs
      ? [
          ...refsSuccessful.map((ref): Anthropic.ImageBlockParam => {
            // Anthropic media_type 白名單
            const mt = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(ref.mimeType)
              ? ref.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
              : 'image/jpeg';
            return {
              type: 'image',
              source: { type: 'base64', media_type: mt, data: ref.data },
            };
          }),
          { type: 'text', text: userText },
        ]
      : userText;

    // Prompt Caching：瞬 soul + 指令每次固定，標 cache_control
    const llmRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        { type: 'text', text: sysPrompt, cache_control: { type: 'ephemeral' } },
      ] as unknown as string, // SDK 型別尚未覆蓋 SystemBlock[]，對齊 dialogue/voice-stream 既有寫法
      messages: [{ role: 'user', content: userContent }],
    });

    const llmText = (llmRes.content[0] as { text: string }).text;
    const promptMatch = llmText.match(/PROMPT:\s*(.+)/);
    const worklogMatch = llmText.match(/WORKLOG:\s*([\s\S]+)/);

    const geminiPrompt = promptMatch
      ? `${imagePromptPrefix ? imagePromptPrefix + ', ' : ''}${promptMatch[1].trim()}`
      : `${imagePromptPrefix ? imagePromptPrefix + ', ' : ''}${brief.prompt}`;
    const workLog = worklogMatch ? worklogMatch[1].trim() : '完成。';

    // 5. 生圖
    const storagePath = `platform-specialist-images/${SHUN_ID}`;
    const imgResult = hasRefs
      ? await generateWithGeminiRefs(geminiPrompt, refsSuccessful, storagePath)
      : await generateWithGemini(geminiPrompt, null, storagePath);

    console.log(`[specialist/image] job=${jobId?.slice(0, 8)} refs=${refsSuccessful.length}/${cappedRefs.length} url=${imgResult.imageUrl.slice(-30)}`);

    return NextResponse.json({
      imageUrl: imgResult.imageUrl,
      workLog,
      geminiPrompt,
      inputTokens: llmRes.usage.input_tokens,
      outputTokens: llmRes.usage.output_tokens,
      refsUsed: refsSuccessful.length,
      refsFailed: refsFailed.length,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[specialist/image] error: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
