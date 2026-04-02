/**
 * POST /api/stt
 * 語音轉文字 — Google Gemini Flash
 * Body: FormData { audio: File }
 * Return: { text: string }
 */
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return NextResponse.json({ error: 'GEMINI_API_KEY 未設定' }, { status: 500 });

    const formData = await req.formData();
    const audio = formData.get('audio') as File;
    if (!audio) return NextResponse.json({ error: 'audio 必填' }, { status: 400 });

    // 轉 base64
    const arrayBuffer = await audio.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    // 偵測 mime type
    const mimeType = audio.type || 'audio/webm';

    // 呼叫 Gemini
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64,
                },
              },
              {
                text: '請將這段音頻的內容完整轉錄成文字。只輸出轉錄的文字內容，不要加任何說明或標點修正。',
              },
            ],
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1000,
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Gemini STT 錯誤: ${err}` }, { status: 500 });
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message: string };
    };

    if (data.error) {
      return NextResponse.json({ error: data.error.message }, { status: 500 });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!text) return NextResponse.json({ error: '轉錄結果為空' }, { status: 500 });

    return NextResponse.json({ success: true, text });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
