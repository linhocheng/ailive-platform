/**
 * /api/longform
 *
 * 長文場域：召喚角色，展開無限制長文生成。
 * - 走 bridge（Max 吃到飽）
 * - streaming SSE，不會被 5 分鐘 timeout 砍
 * - max_tokens: 16000
 * - 載入角色靈魂（system_soul → soul_core → enhancedSoul）
 * - 無工具、無 history，純生成
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, AnthropicBridge } from '@/lib/anthropic-via-bridge';
import { getFirestore } from '@/lib/firebase-admin';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 300;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    characterId: string;
    prompt: string;
    userId?: string;
    maxTokens?: number;
  };

  const { characterId, prompt, maxTokens = 16000 } = body;
  if (!characterId || !prompt) {
    return NextResponse.json({ error: 'characterId 和 prompt 必填' }, { status: 400 });
  }

  const db = getFirestore();
  const charDoc = await db.collection('platform_characters').doc(characterId).get();
  if (!charDoc.exists) {
    return NextResponse.json({ error: '角色不存在' }, { status: 404 });
  }

  const char = charDoc.data()!;
  const soulText = (char.system_soul as string)
    || (char.soul_core as string)
    || (char.enhancedSoul as string)
    || '';

  const apiKey = (process.env.ANTHROPIC_API_KEY || '').replace(/^"|"$/g, '');
  const anthropic = getAnthropicClient(apiKey);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const msgArgs = {
          model: 'claude-sonnet-4-6' as const,
          max_tokens: maxTokens,
          system: soulText || `你是 ${char.name}。`,
          messages: [{ role: 'user' as const, content: prompt }],
        };

        let totalText = '';

        if (anthropic instanceof AnthropicBridge) {
          // Bridge 不支援 stream，用 create 拿完整結果後逐段推
          const res = await anthropic.messages.create(msgArgs);
          const text = (res.content[0] as { text: string }).text;
          // 每 200 字一段送出，讓前端感受到流動
          const chunkSize = 200;
          for (let i = 0; i < text.length; i += chunkSize) {
            send({ type: 'text', content: text.slice(i, i + chunkSize) });
          }
          totalText = text;
        } else {
          // Native SDK：真正 streaming
          const nativeClient = anthropic as Anthropic;
          const llmStream = nativeClient.messages.stream(msgArgs);
          for await (const chunk of llmStream) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
              const text = chunk.delta.text;
              totalText += text;
              send({ type: 'text', content: text });
            }
          }
        }

        send({ type: 'done', totalChars: totalText.length });
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
