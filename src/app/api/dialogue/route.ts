/**
 * /api/dialogue — 對話引擎
 *
 * POST { characterId, userId, message, conversationId? }
 *
 * 核心流程：
 * 1. 讀 enhancedSoul（單一真相來源）
 * 2. 注入台北時間
 * 3. 強制 query_knowledge_base（先查再說）
 * 4. 語義搜尋 insights + knowledge，命中 hitCount+1
 * 5. Claude 回覆
 * 6. 存 conversation，每 20 輪提煉 insight
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';

export const maxDuration = 60;

// ===== 台北時間 =====
function getTaipeiTime(): string {
  return new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long',
  });
}

function getTaipeiDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }); // YYYY-MM-DD
}

// ===== 工具定義 =====
const PLATFORM_TOOLS: Anthropic.Tool[] = [
  {
    name: 'query_knowledge_base',
    description: '說話前必須先呼叫這個工具。查知識庫和記憶，找我記得什麼、知道什麼。想說任何事之前，先查，查了才說。',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '想查什麼（自然語言）' },
        limit: { type: 'number', description: '幾條，預設 5' },
      },
      required: ['query'],
    },
  },
  {
    name: 'remember',
    description: '把重要資訊存入長期記憶。對方說了名字/目標/需求、我有了新洞察、下次需要記住的事 — 立即呼叫。',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: '一句話標題' },
        content: { type: 'string', description: '完整細節' },
      },
      required: ['title', 'content'],
    },
  },
];

// ===== 工具執行 =====
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  characterId: string,
): Promise<string> {
  const db = getFirestore();

  if (toolName === 'query_knowledge_base') {
    const query = String(toolInput.query || '');
    const limit = Number(toolInput.limit || 5);

    const [knowledgeSnap, insightSnap] = await Promise.all([
      db.collection('platform_knowledge').where('characterId', '==', characterId).limit(100).get(),
      db.collection('platform_insights').where('characterId', '==', characterId).limit(100).get(),
    ]);

    const allDocs: Record<string, unknown>[] = [
      ...knowledgeSnap.docs.map(d => ({ _id: d.id, _type: 'knowledge', ...d.data() })),
      ...insightSnap.docs.map(d => ({ _id: d.id, _type: 'insight', ...d.data() })),
    ];

    const withEmb = allDocs.filter(d => d.embedding && Array.isArray(d.embedding));
    if (withEmb.length === 0) return '（記憶庫目前是空的）';

    const qEmb = await generateEmbedding(query);
    const scored = withEmb
      .map(d => ({ d, score: cosineSimilarity(qEmb, d.embedding as number[]) }))
      .filter(s => s.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (scored.length === 0) return '（沒有找到相關記憶）';

    // hitCount +1
    const batch = db.batch();
    scored.forEach(({ d }) => {
      if (d._type === 'insight' && d._id) {
        batch.update(db.collection('platform_insights').doc(d._id as string), {
          hitCount: FieldValue.increment(1),
          lastHitAt: new Date().toISOString(),
        });
      }
    });
    await batch.commit();

    return scored.map(({ d, score }) => {
      const timeLabel = (() => {
        if (!d.eventDate) return '';
        const diffDays = Math.floor((Date.now() - new Date(d.eventDate as string).getTime()) / 86400000);
        if (diffDays === 0) return '（今天）';
        if (diffDays === 1) return '（昨天）';
        if (diffDays <= 7) return `（${diffDays}天前）`;
        return `（${d.eventDate}）`;
      })();
      const tag = d._type === 'knowledge' ? `[知識・${d.category || '一般'}]` : `[記憶${timeLabel}]`;
      return `${tag} ${d.title || ''}：${String(d.content || '').slice(0, 150)} (相似度${(score * 100).toFixed(0)}%)`;
    }).join('\n\n');
  }

  if (toolName === 'remember') {
    const title = String(toolInput.title || '');
    const content = String(toolInput.content || '');
    const embedding = await generateEmbedding(`${title} ${content}`);
    const today = getTaipeiDate();

    const db2 = getFirestore();
    await db2.collection('platform_insights').add({
      characterId,
      title,
      content,
      source: 'conversation',
      eventDate: today,
      tier: 'fresh',
      hitCount: 0,
      lastHitAt: null,
      embedding,
      createdAt: new Date().toISOString(),
    });

    return `已記住：${title}`;
  }

  return '工具執行失敗';
}

// ===== 主對話 =====
export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, userId, message, conversationId } = await req.json();

    if (!characterId || !message) {
      return NextResponse.json({ error: 'characterId, message 必填' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY 未設定' }, { status: 500 });

    // 1. 讀角色
    const charDoc = await db.collection('platform_characters').doc(characterId).get();
    if (!charDoc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });
    const char = charDoc.data()!;

    if (!char.enhancedSoul) {
      return NextResponse.json({ error: '角色尚未完成鑄魂，請先呼叫 /api/soul-enhance' }, { status: 400 });
    }

    // 2. 讀/建 conversation
    let convRef;
    let convData: Record<string, unknown> = { messages: [], messageCount: 0 };

    if (conversationId) {
      convRef = db.collection('platform_conversations').doc(conversationId);
      const convDoc = await convRef.get();
      if (convDoc.exists) convData = convDoc.data()!;
    } else {
      convRef = db.collection('platform_conversations').doc();
      await convRef.set({
        characterId,
        userId: userId || 'anonymous',
        messages: [],
        summary: '',
        messageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // 3. 組 system prompt
    const taipeiTime = getTaipeiTime();
    const systemPrompt = `${char.enhancedSoul}

---
現在時間（台北）：${taipeiTime}

說話前的天條：先呼叫 query_knowledge_base 查記憶，查了才說，不從空氣裡編。

${convData.summary ? `對話摘要（上次回顧）：\n${convData.summary}` : ''}`;

    // 4. 組歷史訊息
    const history = (convData.messages as Array<{ role: string; content: string }> || []).slice(-20);
    const messages: Anthropic.MessageParam[] = [
      ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: message },
    ];

    // 5. Claude 對話（支援 tool use loop）
    const client = new Anthropic({ apiKey });
    let finalReply = '';
    let toolsUsed: string[] = [];
    let currentMessages = [...messages];

    for (let turn = 0; turn < 10; turn++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: systemPrompt,
        tools: PLATFORM_TOOLS,
        tool_choice: turn === 0 ? { type: 'any' } : { type: 'auto' }, // 第一輪強制用工具
        messages: currentMessages,
      });

      currentMessages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        finalReply = response.content
          .filter(b => b.type === 'text')
          .map(b => (b as Anthropic.TextBlock).text)
          .join('');
        break;
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            toolsUsed.push(block.name);
            const result = await executeTool(block.name, block.input as Record<string, unknown>, characterId);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          }
        }
        currentMessages.push({ role: 'user', content: toolResults });
      }
    }

    if (!finalReply) {
      finalReply = currentMessages
        .filter(m => m.role === 'assistant')
        .flatMap(m => Array.isArray(m.content) ? m.content : [])
        .filter((b): b is Anthropic.TextBlock => (b as Anthropic.ContentBlock).type === 'text')
        .map(b => b.text)
        .join('') || '（無回覆）';
    }

    // 6. 存訊息
    const newMessages = [
      ...(convData.messages as Array<{ role: string; content: string }> || []),
      { role: 'user', content: message, timestamp: new Date().toISOString() },
      { role: 'assistant', content: finalReply, timestamp: new Date().toISOString() },
    ];

    const newCount = (convData.messageCount as number || 0) + 2;
    await convRef.update({
      messages: newMessages,
      messageCount: newCount,
      updatedAt: new Date().toISOString(),
    });

    // 7. 更新 growthMetrics
    await db.collection('platform_characters').doc(characterId).update({
      'growthMetrics.totalConversations': FieldValue.increment(1),
      updatedAt: new Date().toISOString(),
    });

    // 8. 每 20 輪提煉 insight
    if (newCount % 20 === 0) {
      const recentMessages = newMessages.slice(-20)
        .map(m => `${m.role === 'user' ? '用戶' : '角色'}：${m.content}`)
        .join('\n');

      const extractRes = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `以下是一段對話記錄，請提煉出 1-2 條最重要的洞察（什麼值得記住）。
用 JSON 陣列回傳：[{"title":"...","content":"..."}]
只回傳 JSON，不要其他文字。

對話：
${recentMessages}`,
        }],
      });

      try {
        const raw = (extractRes.content[0] as Anthropic.TextBlock).text.trim();
        const insights = JSON.parse(raw);
        const today = getTaipeiDate();
        for (const ins of insights) {
          const embedding = await generateEmbedding(`${ins.title} ${ins.content}`);
          await db.collection('platform_insights').add({
            characterId,
            title: ins.title,
            content: ins.content,
            source: 'auto_extract',
            eventDate: today,
            tier: 'fresh',
            hitCount: 0,
            lastHitAt: null,
            embedding,
            createdAt: new Date().toISOString(),
          });
        }
        await db.collection('platform_characters').doc(characterId).update({
          'growthMetrics.totalInsights': FieldValue.increment(insights.length),
        });
      } catch { /* 提煉失敗不中斷 */ }
    }

    return NextResponse.json({
      success: true,
      reply: finalReply,
      conversationId: convRef.id,
      toolsUsed,
      messageCount: newCount,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
