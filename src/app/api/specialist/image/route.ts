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
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
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
    brief: { prompt: string; refs?: string[]; sceneRefUrl?: string | null; mood?: string | null; aspectRatio?: string };
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

    // 3.1 過濾非 http(s) URL — LLM 多輪迭代會把完整 URL 簡寫成 "img_3" 之類代號，直接丟掉不讓下載器炸
    const validRefs = cappedRefs.filter(u => /^https?:\/\//i.test(u));
    const skippedRefs = cappedRefs.filter(u => !/^https?:\/\//i.test(u));
    if (skippedRefs.length > 0) {
      console.log(`[specialist/image] job=${jobId?.slice(0, 8)} 跳過 ${skippedRefs.length} 張非 URL refs（LLM 可能用了代號/簡寫）: ${skippedRefs.join(', ')}`);
    }

    let refsSuccessful: Awaited<ReturnType<typeof downloadRefsBase64>>['successful'] = [];
    let refsFailed: string[] = [];
    if (validRefs.length > 0) {
      const r = await downloadRefsBase64(validRefs);
      refsSuccessful = r.successful;
      refsFailed = r.failed;
      // Q3 = C：有效 refs 全失敗才 throw；完全沒有效 refs（全被 filter）則視同空、繼續
      if (refsSuccessful.length === 0) {
        throw new Error(`所有參考圖下載失敗（${validRefs.length} 張）：${refsFailed.map(u => u.slice(-40)).join(', ')}`);
      }
      if (refsFailed.length > 0) {
        console.log(`[specialist/image] job=${jobId?.slice(0, 8)} refs 部分失敗 ${refsFailed.length}/${validRefs.length}，繼續`);
      }
    } else if (cappedRefs.length > 0) {
      console.log(`[specialist/image] job=${jobId?.slice(0, 8)} 所有 refs 都是無效格式（非 URL），視同沒 refs 繼續`);
    }

    const hasRefs = refsSuccessful.length > 0;

    // 3.2 場景靈感圖（sceneRefUrl）—— 用戶傳的參考圖，下載後排在所有 refs 之後
    let sceneRefData: Awaited<ReturnType<typeof downloadRefsBase64>>['successful'][0] | null = null;
    const sceneRefUrl = typeof brief.sceneRefUrl === 'string' && /^https?:\/\//i.test(brief.sceneRefUrl)
      ? brief.sceneRefUrl : null;
    if (sceneRefUrl) {
      const r = await downloadRefsBase64([sceneRefUrl]);
      sceneRefData = r.successful[0] ?? null;
      if (!sceneRefData) console.log(`[specialist/image] job=${jobId?.slice(0, 8)} sceneRef 下載失敗，繼續`);
    }

    const hasAnyImages = hasRefs || !!sceneRefData;

    // 4. Sonnet 4.6 + 瞬的 soul：brief → Gemini prompt + workLog
    const apiKey = (process.env.ANTHROPIC_API_KEY || '').replace(/^"|"$/g, '');
    const anthropic = getAnthropicClient(apiKey);

    // 基礎指令
    const baseInstructions = `你現在收到一個出圖委託。你的任務：
1. 把 brief 轉成適合 Gemini image model 的英文 prompt（詳細、精準，包含光線/構圖/氛圍/技術細節）
2. 寫一段工作日誌（繁體中文，2-4 句），說明你的光影決策`;

    // refs 使用規則（固定，不需要判斷）
    const refsInstructions = hasAnyImages ? `

參考圖使用規則（固定，照順序套用，不需要判斷）：
${hasRefs && refsSuccessful.length >= 1 ? `- 第 1 張（身份錨點）：保留圖中人物的臉部特徵與整體辨識度。服裝、造型、妝容可依場景設定自由變換。` : ''}
${hasRefs && refsSuccessful.length >= 2 ? `- 第 2 張（產品參考）：保留產品外觀細節（形狀、顏色、包裝、標籤文字），不得更動。` : ''}
${sceneRefData ? `- 最後一張（場景靈感）：複製這張圖的場景構圖、光線、氛圍。不複製圖中任何人物的臉。` : ''}

把以上規則直接反映在 PROMPT 英文指令裡，明確告訴 Gemini 每張圖的用途與處理方式。
WORKLOG 只說你的光影決策，不重述分工。` : '';

    const sysPrompt = `${shunSoul}

---

${baseInstructions}${refsInstructions}

輸出格式（嚴格遵守，不要加其他內容）：
PROMPT: <英文 prompt，一行>
WORKLOG: <工作日誌，繁體中文，2-4 句>`;

    // user content：有圖則 multimodal（refs → sceneRef → text），無則純文字
    const userTextParts = [`Brief: ${brief.prompt}`];
    if (brief.mood) userTextParts.push(`氛圍: ${brief.mood}`);
    if (brief.aspectRatio) userTextParts.push(`比例: ${brief.aspectRatio}`);
    const userText = userTextParts.join('\n');

    // 所有圖片：refs（身份+產品）在前，sceneRef 在後
    const allImageBlocks: Anthropic.ImageBlockParam[] = [
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
    ];
    // sceneRef 排最後（讓 Shun 知道最後那張是場景靈感）
    if (sceneRefData) {
      const mt = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(sceneRefData.mimeType)
        ? sceneRefData.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
        : 'image/jpeg';
      allImageBlocks.push({ type: 'image', source: { type: 'base64', media_type: mt, data: sceneRefData.data } });
    }

    const userContent: Anthropic.MessageParam['content'] = hasAnyImages
      ? [...allImageBlocks, { type: 'text', text: userText }]
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

    // 5. 生圖：refs + sceneRef 全部一起送進 Gemini
    const storagePath = `platform-specialist-images/${SHUN_ID}`;
    const allGeminiRefs = sceneRefData ? [...refsSuccessful, sceneRefData] : refsSuccessful;
    const imgResult = allGeminiRefs.length > 0
      ? await generateWithGeminiRefs(geminiPrompt, allGeminiRefs, storagePath)
      : await generateWithGemini(geminiPrompt, null, storagePath);

    console.log(`[specialist/image] job=${jobId?.slice(0, 8)} refs=${refsSuccessful.length}/${cappedRefs.length} sceneRef=${!!sceneRefData} url=${imgResult.imageUrl.slice(-30)}`);

    // 5.1 寫除錯資訊回 platform_jobs.output（dot notation 不影響 worker 寫的 imageUrl/workLog）
    // 後台對賬：brief.prompt → geminiPrompt → 真實送進 Gemini 的字串
    if (jobId) {
      try {
        await db.collection('platform_jobs').doc(jobId).update({
          'output.geminiPrompt': geminiPrompt,
          'output.imagePromptPrefix': imagePromptPrefix,
          'output.refsUsed': refsSuccessful.map(r => r.sourceUrl),
          'output.sceneRefUsed': sceneRefUrl ?? null,
        });
      } catch (e) {
        console.warn('[specialist/image] write debug fields failed:', e);
      }
    }

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
