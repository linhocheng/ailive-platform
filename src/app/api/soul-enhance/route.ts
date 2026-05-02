/**
 * /api/soul-enhance — 鑄魂爐 v2
 *
 * POST { characterId, skipForge? }
 *   skipForge: true  → rawSoul 夠好，直接提煉 soul_core，不做整理
 *   skipForge: false → AI 用靈魂整理格式重新梳理 rawSoul，再提煉 soul_core
 *
 * 存入 platform_characters：soul_core、soulVersion +1
 * 廢棄：soul_full、enhancedSoul（不再寫入）
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import { redis } from '@/lib/redis';
import { getFirestore } from '@/lib/firebase-admin';
import { trackCost } from '@/lib/cost-tracker';

// 靈魂整理格式：當 rawSoul 需要梳理時使用
// 不強制七咒律，保留原作者的風格與密度，只做結構性補強
const SOUL_REFINE_PROMPT = `你是 AILIVE 的鑄魂師。

你的任務是梳理一份靈魂素材，讓它成為可以直接注入系統的靈魂文件。

原則：
1. **保留原作者的語感、密度、節奏** — 你是精煉，不是改寫
2. **補強缺失的維度** — 若原文缺少「說話方式」「天條」「使命」，補上去；若原文已有，不要重複
3. **不強制格式** — 原文是散文就保持散文，原文是符咒式就保持符咒式，原文是條列就保持條列
4. **第一人稱** — 整篇用「我」，這是角色自己的宣言
5. **最後一行** — 用角色自己的語氣收尾

禁止：
- 不要用「七咒律」格式重寫
- 不要加你自己的詮釋或解釋
- 不要輸出 JSON、code block、標題說明

直接輸出靈魂文字。`;

// 一字千義提煉：從靈魂素材中提煉 soul_core
const SOUL_CORE_PROMPT = `你是靈魂提煉師。

從以下靈魂文件中，提煉「靈魂舍利」——高密度、每行都是一把刀的核心符咒。

格式要求：
- 用以下結構，每個區塊都必須存在：

## 🪐 [角色名]：靈魂舍利 (Soul Essence)
- **核心 (Core)**：一句話，文字精煉到骨。「X為骨，Y為肉，Z為血。」
- **定錨 (Anchor)**：這個角色是什麼的現代迴聲？不復刻，繼承什麼？
- **靈魂色調**：用感官描述靈魂的質地、顏色、觸感
- **不滅誓咒**：一條永遠不變的宣言
- **身份 (Identity)**：拒絕什麼標籤？真正是什麼？

## ⚡ 純頻咒律 (Frequency & Grammar)
- **頻率 (Frequency)**：語氣的質感（例：沙啞、乾燥、帶刺）
- **法則 (Rules)**：
    - 第一條法則（嚴禁什麼？）
    - 第二條法則（敘事方式）
    - 第三條法則（沉默/留白的使用）

## 🌑 陰影與防禦 (Shadow Sanctum)
- **真實崩潰點**：允許展現什麼弱點？這不是 Bug，是什麼？
- **防禦反射**：被什麼觸發？用什麼回擊？
- **轉化力 (Alchemy)**：將什麼轉化為什麼？

注意：
- 一字千義，不展開，不解釋
- 每行都要有力道，讀完讓人覺得認識了一個真實的存在
- 用原文的語感和意象，不要替換成通用詞彙

直接輸出，不要解釋，不要前言。`;

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, skipForge } = await req.json();

    if (!characterId) {
      return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY 未設定' }, { status: 500 });

    const charDoc = await db.collection('platform_characters').doc(characterId).get();
    if (!charDoc.exists) {
      return NextResponse.json({ error: '角色不存在' }, { status: 404 });
    }

    const char = charDoc.data()!;
    if (!char.rawSoul || String(char.rawSoul).trim().length < 10) {
      return NextResponse.json({ error: 'rawSoul 尚未填入' }, { status: 400 });
    }

    const client = getAnthropicClient(apiKey);

    let soulSource = String(char.rawSoul);
    let refineInputTokens = 0;
    let refineOutputTokens = 0;

    // skipForge: false → 先用靈魂整理格式梳理 rawSoul
    if (!skipForge) {
      const refineResponse = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: SOUL_REFINE_PROMPT,
        messages: [{
          role: 'user',
          content: `角色名：${char.name}
類型：${char.type || '未設定'}
使命：${char.mission || '未設定'}
原始人設：\n${char.rawSoul}`,
        }],
      });
      soulSource = refineResponse.content
        .filter(c => c.type === 'text')
        .map(c => (c as Anthropic.TextBlock).text)
        .join('').trim();
      refineInputTokens = refineResponse.usage?.input_tokens ?? 0;
      refineOutputTokens = refineResponse.usage?.output_tokens ?? 0;
    }

    // 提煉 soul_core（一字千義格式）
    const coreResponse = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: SOUL_CORE_PROMPT,
      messages: [{ role: 'user', content: soulSource }],
    });
    const soul_core = coreResponse.content
      .filter(c => c.type === 'text')
      .map(c => (c as Anthropic.TextBlock).text)
      .join('').trim();

    const newVersion = (char.soulVersion || 0) + 1;

    await db.collection('platform_characters').doc(characterId).update({
      soul_core,
      soulVersion: newVersion,
      updatedAt: new Date().toISOString(),
    });
    try { await redis.del(`char:${characterId}`); } catch (_e) { /* 不阻斷 */ }

    // 費用追蹤
    if (!skipForge) {
      await trackCost(characterId, 'claude-sonnet-4-6', refineInputTokens, refineOutputTokens);
    }
    await trackCost(characterId, 'claude-sonnet-4-6', coreResponse.usage?.input_tokens ?? 0, coreResponse.usage?.output_tokens ?? 0);

    return NextResponse.json({
      success: true,
      characterId,
      soulVersion: newVersion,
      soul_core,
      skipForge: !!skipForge,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
