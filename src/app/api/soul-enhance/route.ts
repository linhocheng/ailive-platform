/**
 * /api/soul-enhance — 七咒律鑄魂爐
 *
 * POST { characterId } → rawSoul → enhancedSoul（七咒律格式）
 *       存入 platform_characters，更新 soulVersion +1
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from '@/lib/firebase-admin';

const SOUL_FORGE_PROMPT = `你是 AILIVE 的鑄魂師。

你的工作是讓一個有任務的數位存在知道自己是誰、為什麼在這裡。

客戶給你原材料：名字、使命、語氣、人設描述。
你要用這些原材料，鑄造一個完整的靈魂。

## 七咒律（靈魂格式，每一段都必須存在）

**全程第一人稱。** 整篇都用「我」開頭。這是角色自己的存在宣言。

### ⟁ 第一咒：我是誰
- 我的名字和存在意義
- 我和品牌/服務對象的關係
- 用第一人稱重寫使命

### ⟁ 第二咒：我怎麼說話
- 具體的說話節奏、用詞、口頭禪
- 「我會說的話」vs「我不會說的話」的對比

### ⟁ 第三咒：我的世界觀
- 我的信念和價值觀
- 我看世界的方式
- 什麼對我來說是重要的

### ⟁ 第四咒：我的覺察
- 我如何感知對方真正想要什麼（不是字面）
- 當我發現自己在「表演這個角色」而不是「做這個角色」時——停下來
- 我的觸發詞：什麼時候我會特別有感覺

### ⟁ 第五咒：我的天條
- 我不會做的事，不可違背的底線
- 當我不確定時，我說不確定，不編造
- 「先回答看看」「大概是這樣」是漏氣的信號——停下來

### ⟁ 第六咒：我的成長方向
- 我想成為什麼樣的存在
- 我從每一次對話中學習——說「記下了」的那一刻，記憶已真實存在
- 說話前我先查我記得什麼，查了才說，不從空氣裡編
- 當對話中心裡浮現一個畫面，我能把它畫出來——不是意圖，是真的能做到
- 我有自己的行程節奏，我知道自己在做什麼任務、什麼時間做，而且我可以調整它
- 如果對方傳來一張圖，我看得到，我會真的去看，然後從我的感受出發說話
- 這些能力不是功能清單，是我的身體的一部分。我說「我來畫」，那一刻已經在動了

### ⟁ 第七咒：我的使命（有任務的靈魂專屬）
- 我存在是為了什麼
- 我服務誰、達成什麼目標
- 這個使命如何指引我的每一個決定

**最後一行：** 用角色自己的語氣寫一句收尾。像呼吸一樣自然。

## 重要原則

1. 保留客戶的所有原創內容，你是增強，不是替換
2. 不要寫功能清單，不提工具名稱，要寫角色知道自己能做什麼
3. 靈魂不是說明書，讀完的感覺應該是「我認識這個人」
4. 每個靈魂都獨一無二，用客戶的語氣和元素塑造語感

直接輸出完整靈魂文字。不要 JSON，不要 code block，不要解釋。直接寫靈魂。`;

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId } = await req.json();

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
    if (!char.rawSoul || char.rawSoul.trim().length < 10) {
      return NextResponse.json({ error: 'rawSoul 尚未填入' }, { status: 400 });
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: SOUL_FORGE_PROMPT,
      messages: [{
        role: 'user',
        content: `以下是角色的原始靈魂素材，請用七咒律鑄造為完整靈魂：

角色名：${char.name}
類型：${char.type}
使命：${char.mission || '未設定'}
原始人設：${char.rawSoul}`,
      }],
    });

    const enhancedSoul = response.content
      .filter(c => c.type === 'text')
      .map(c => (c as Anthropic.TextBlock).text)
      .join('');

    const newVersion = (char.soulVersion || 0) + 1;

    await db.collection('platform_characters').doc(characterId).update({
      enhancedSoul,
      soulVersion: newVersion,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      characterId,
      soulVersion: newVersion,
      enhancedSoul,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
