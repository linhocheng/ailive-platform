import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';

const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY || '';

async function fetchUnsplashImages(keywords: string[], count = 4): Promise<string[]> {
  const urls: string[] = [];
  for (const kw of keywords.slice(0, count)) {
    try {
      const res = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(kw)}&per_page=1&orientation=landscape`,
        { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }
      );
      const data = await res.json();
      const url = data.results?.[0]?.urls?.regular;
      if (url) urls.push(url);
    } catch {
      // skip failed image
    }
  }
  return urls;
}

const DESIGN_PROMPT = `你是世界頂級的視覺設計師，擅長製作媲美 Apple Keynote 和 Stripe Landing Page 質感的簡報。

請根據以下文件內容，生成一份完整的 HTML 簡報。

**設計規格（必須嚴格執行）：**
- 使用 reveal.js 4.x（CDN），全螢幕沉浸式體驗
- 字型：Google Fonts，標題用 Playfair Display 或 Noto Serif TC，內文用 Inter 或 Noto Sans TC
- 配色：深色主調（#0a0a0a 或 #0f172a 背景），金色或白色點綴，配合圖片氛圍
- 每張投影片都有清晰的視覺層次：大標題 / 小標 / 內文
- 圖片作為全版背景或半版視覺，加深色遮罩確保文字可讀
- 動畫：fade 或 slide，簡潔不花俏
- 必須是完整可獨立運行的 HTML（所有資源走 CDN，無外部依賴檔案）

**投影片結構（根據內容判斷張數，至少 5 張）：**
1. 封面：大標題 + 副標 + 一張全版背景圖
2. 核心內容每個主題 1 張
3. 關鍵數字/重點獨立一張（大字排版）
4. 結尾：行動號召或總結

**圖片使用：**
以下是可用的 Unsplash 圖片 URL，根據語境選用：
{{IMAGE_URLS}}

**輸出要求：**
只輸出完整 HTML，從 <!DOCTYPE html> 開始，到 </html> 結束。不要加任何說明文字。

---

文件內容：
{{CONTENT}}`;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const rawText = formData.get('text') as string | null;

    let content = '';

    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'docx') {
        const result = await mammoth.extractRawText({ buffer });
        content = result.value;
      } else {
        content = buffer.toString('utf-8');
      }
    } else if (rawText) {
      content = rawText;
    } else {
      return NextResponse.json({ error: '請上傳檔案或輸入文字' }, { status: 400 });
    }

    if (!content.trim()) {
      return NextResponse.json({ error: '檔案內容為空' }, { status: 400 });
    }

    // Step 1: ask Claude for image keywords
    const client = getAnthropicClient(process.env.ANTHROPIC_API_KEY || '');
    const kwRes = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `根據以下文件內容，給我 4 個英文 Unsplash 搜圖關鍵字（單詞或短語，以換行分隔，不要編號，不要解釋）：\n\n${content.slice(0, 800)}`,
      }],
    });
    const keywords = (kwRes.content[0] as { type: string; text: string }).text
      .split('\n')
      .map(k => k.trim())
      .filter(Boolean)
      .slice(0, 4);

    // Step 2: fetch Unsplash images
    const imageUrls = await fetchUnsplashImages(keywords);

    // Step 3: generate full HTML with Claude Sonnet
    const imageUrlsText = imageUrls.length > 0
      ? imageUrls.map((u, i) => `圖片${i + 1}：${u}`).join('\n')
      : '（無可用圖片，請用純色背景設計）';

    const prompt = DESIGN_PROMPT
      .replace('{{IMAGE_URLS}}', imageUrlsText)
      .replace('{{CONTENT}}', content.slice(0, 6000));

    const genRes = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    let html = (genRes.content[0] as { type: string; text: string }).text.trim();
    // strip markdown code fences if present
    if (html.startsWith('```')) {
      html = html.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    }

    return NextResponse.json({ html, imageUrls, keywords });
  } catch (err) {
    console.error('[design-x/generate]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
