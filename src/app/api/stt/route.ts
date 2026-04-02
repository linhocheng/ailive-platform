/**
 * POST /api/stt
 * 語音轉文字 — OpenAI Whisper
 * Body: FormData { audio: File }
 * Return: { text: string }
 */
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY; // 用 OpenAI key，這裡要另外拿
    const openaiKey = process.env.OPENAI_API_KEY;

    const formData = await req.formData();
    const audio = formData.get('audio') as File;
    if (!audio) return NextResponse.json({ error: 'audio 必填' }, { status: 400 });

    // 送 Whisper
    const whisperForm = new FormData();
    whisperForm.append('file', audio, audio.name || 'audio.webm');
    whisperForm.append('model', 'whisper-1');
    whisperForm.append('language', 'zh');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: whisperForm,
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Whisper 錯誤: ${err}` }, { status: 500 });
    }

    const data = await res.json() as { text: string };
    return NextResponse.json({ success: true, text: data.text });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
