/**
 * /api/knowledge-parse — 從 Firebase Storage 下載文件，解析存入知識庫 V2
 *
 * POST { storagePath, characterId, filename, category? }
 *
 * docx 流程（確定性解析，零 Haiku）：
 *   H1 → brand + productName
 *   H2 段落 → platform_knowledge（帶 productName）
 *   最後 table → 圖片（caption 從 <th> 同格抓）
 *   → platform_products（一筆完整產品主檔）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, getFirestore } from '@/lib/firebase-admin';
import mammoth from 'mammoth';

export const maxDuration = 120;

// ── 圖片 caption → images map key ──
function captionToKey(caption: string): string {
  if (caption.includes('全身')) return '模特兒全身';
  if (caption.includes('半身')) return '模特兒半身';
  if (caption.includes('大頭')) return '模特兒大頭';
  if (caption.includes('斜躺')) return '純產品斜躺';
  if (caption.includes('正面')) return '純產品正面';
  return caption.slice(-10);
}

// ── 上傳圖片 ──
async function uploadImageToStorage(base64Data: string, contentType: string, characterId: string, index: number): Promise<string> {
  const admin = getFirebaseAdmin();
  const bucket = admin.storage().bucket();
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const date = new Date().toISOString().slice(0, 10);
  const path = `knowledge-images/${characterId}/${date}/img_${index}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = Buffer.from(base64Data, 'base64');
  const file = bucket.file(path);
  await file.save(buf, { metadata: { contentType } });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${path}`;
}

// ── 儲存 knowledge ──
async function saveKnowledge(baseUrl: string, characterId: string, title: string, content: string, category: string, imageUrl?: string, productName?: string): Promise<string | null> {
  try {
    const body: Record<string, string> = { characterId, title, content, category };
    if (imageUrl) body.imageUrl = imageUrl;
    if (productName) body.productName = productName;
    const res = await fetch(`${baseUrl}/api/knowledge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    return data.id || null;
  } catch { return null; }
}

// ── 解析產品 HTML（確定性，零 Haiku）──
interface ProductData {
  brand: string; productName: string; productType: string; positioning: string;
  ingredients: Array<{ name: string; effect: string }>;
  effects: string[]; usage: string[]; suitableFor: string[]; cautions: string[];
  sections: Array<{ title: string; content: string }>;
}

function parseProductHtml(html: string): ProductData {
  const clean = html.replace(/<a[^>]*>|<\/a>/g, '').replace(/\n/g, ' ');

  // H1
  const h1Match = clean.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const h1Text = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';
  const spaceIdx = h1Text.indexOf(' ');
  const brand = spaceIdx > 0 ? h1Text.slice(0, spaceIdx).trim() : '';
  const productName = spaceIdx > 0 ? h1Text.slice(spaceIdx + 1).trim() : h1Text;

  // H2 段落
  const h2Splits = [...clean.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)];
  const sectionMap: Record<string, string> = {};
  const sections: Array<{ title: string; content: string }> = [];
  for (let i = 0; i < h2Splits.length; i++) {
    const title = h2Splits[i][1].replace(/<[^>]+>/g, '').trim();
    const start = (h2Splits[i].index ?? 0) + h2Splits[i][0].length;
    const end = i + 1 < h2Splits.length ? (h2Splits[i + 1].index ?? clean.length) : clean.length;
    const text = clean.slice(start, end).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    sectionMap[title] = text;
    if (text.length > 5 && productName) sections.push({ title: `${productName} — ${title}`, content: text });
  }

  // 成分 table
  const ingredients: Array<{ name: string; effect: string }> = [];
  const ingIdx = h2Splits.findIndex(m => m[1].replace(/<[^>]+>/g, '').trim() === '核心成分');
  if (ingIdx >= 0) {
    const secStart = (h2Splits[ingIdx].index ?? 0) + h2Splits[ingIdx][0].length;
    const secEnd = ingIdx + 1 < h2Splits.length ? (h2Splits[ingIdx + 1].index ?? clean.length) : clean.length;
    const rows = [...clean.slice(secStart, secEnd).matchAll(/<tr[^>]*>(.*?)<\/tr>/g)];
    for (const row of rows.slice(1)) {
      const cells = [...row[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)];
      if (cells.length >= 2) {
        const name = cells[0][1].replace(/<[^>]+>/g, '').trim();
        const effect = cells[1][1].replace(/<[^>]+>/g, '').trim();
        if (name && effect && name !== '成分') ingredients.push({ name, effect });
      }
    }
  }

  const toList = (t: string) => t.split(/\s{2,}/).map(s => s.trim()).filter(s => s.length > 2).slice(0, 20);
  return {
    brand, productName,
    productType: sectionMap['產品基本資訊']?.match(/產品類型\s*[：:]\s*([^\s]+)/)?.[1] || '',
    positioning: sectionMap['產品定位'] || '',
    ingredients,
    effects: toList(sectionMap['功效'] || ''),
    usage: toList(sectionMap['使用方式'] || ''),
    suitableFor: toList(sectionMap['適合對象'] || ''),
    cautions: toList(sectionMap['注意事項'] || ''),
    sections,
  };
}

// ── chunkMarkdown（非 docx）──
function cleanMarkdownContent(raw: string): string {
  return raw.split('\n').filter(line => !/^---+$/.test(line.trim()) && !/^\|[-\s|]+\|$/.test(line.trim()))
    .map(line => {
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
        return cells.length >= 2 ? cells.join('：') : cells[0] || '';
      }
      return line.replace(/\*\*/g, '');
    }).filter(line => line.trim().length > 0).join('\n').trim();
}

function chunkMarkdown(md: string, filename: string): Array<{ title: string; content: string }> {
  const lines = md.split('\n');
  const chunks: Array<{ title: string; content: string }> = [];
  let parentTitle = '', sectionTitle = '', currentContent: string[] = [];
  const flush = () => {
    const content = cleanMarkdownContent(currentContent.join('\n').trim());
    if (content.length > 20) {
      const title = parentTitle && sectionTitle ? `${parentTitle} — ${sectionTitle}` : parentTitle || sectionTitle || filename;
      chunks.push({ title, content });
    }
    currentContent = [];
  };
  for (const line of lines) {
    if (line.startsWith('# ')) { flush(); parentTitle = line.replace(/^#\s+/, '').trim(); sectionTitle = ''; }
    else if (line.startsWith('## ')) { flush(); sectionTitle = line.replace(/^##\s+/, '').trim(); }
    else { currentContent.push(line); }
  }
  flush();
  if (chunks.length === 0 && md.trim()) chunks.push({ title: filename, content: cleanMarkdownContent(md.trim()) });
  return chunks;
}

// ===== 主流程 =====
export async function POST(req: NextRequest) {
  try {
    const { storagePath, characterId, filename, category } = await req.json();
    if (!storagePath || !characterId || !filename) {
      return NextResponse.json({ error: 'storagePath, characterId, filename 必填' }, { status: 400 });
    }

    const ext = filename.split('.').pop()?.toLowerCase();
    const admin = getFirebaseAdmin();
    const bucket = admin.storage().bucket();
    const [buffer] = await bucket.file(storagePath).download();
    const baseUrl = req.nextUrl.origin;
    const db = getFirestore();

    const imageIds: string[] = [];
    let imageFailed = 0;
    const textIds: string[] = [];
    let textFailed = 0;
    let productCardId: string | null = null;

    if (ext === 'docx') {
      const htmlResult = await mammoth.convertToHtml({ buffer: Buffer.from(buffer) });
      const htmlStr = htmlResult.value;
      const product = parseProductHtml(htmlStr);

      // 圖片：最後的 table
      const imageMap: Record<string, string> = {};
      const tables = [...htmlStr.matchAll(/<table[^>]*>(.*?)<\/table>/g)];
      if (tables.length > 0) {
        const lastTable = tables[tables.length - 1][1];
        const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
        const imgSrcRegex = /src="data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)"/;
        let cellMatch; let imgIndex = 0;
        while ((cellMatch = cellRegex.exec(lastTable)) !== null) {
          const cellHtml = cellMatch[1];
          const imgMatch = imgSrcRegex.exec(cellHtml);
          if (!imgMatch) continue;
          imgIndex++;
          try {
            const contentType = imgMatch[1];
            const base64 = imgMatch[2];
            const caption = cellHtml.replace(imgSrcRegex, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const imageUrl = await uploadImageToStorage(base64, contentType, characterId, imgIndex);
            const title = caption || `${product.productName} — 圖片 ${imgIndex}`;
            const id = await saveKnowledge(baseUrl, characterId, title, `圖片網址：${imageUrl}`, 'image', imageUrl, product.productName);
            if (id) imageIds.push(id); else imageFailed++;
            imageMap[captionToKey(caption)] = imageUrl;
          } catch { imageFailed++; }
        }
      }

      // 文字段落
      for (const section of product.sections) {
        const id = await saveKnowledge(baseUrl, characterId, section.title, section.content, category || 'document', undefined, product.productName);
        if (id) textIds.push(id); else textFailed++;
      }

      // 產品主檔
      if (product.productName) {
        const existSnap = await db.collection('platform_products')
          .where('characterId', '==', characterId)
          .where('productName', '==', product.productName)
          .limit(1).get();
        if (!existSnap.empty) await existSnap.docs[0].ref.delete();

        const ref = await db.collection('platform_products').add({
          characterId, productName: product.productName, brand: product.brand,
          productType: product.productType, positioning: product.positioning,
          ingredients: product.ingredients, effects: product.effects,
          usage: product.usage, suitableFor: product.suitableFor, cautions: product.cautions,
          images: imageMap, knowledgeIds: [...textIds, ...imageIds],
          sourceFile: filename, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        productCardId = ref.id;
      }

    } else if (ext === 'md' || ext === 'txt') {
      const chunks = chunkMarkdown(Buffer.from(buffer).toString('utf-8'), filename);
      for (const chunk of chunks) {
        const id = await saveKnowledge(baseUrl, characterId, chunk.title, chunk.content, category || 'document');
        if (id) textIds.push(id); else textFailed++;
      }

    } else if (ext === 'pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(Buffer.from(buffer));
      const chunks = chunkMarkdown(data.text, filename);
      for (const chunk of chunks) {
        const id = await saveKnowledge(baseUrl, characterId, chunk.title, chunk.content, category || 'document');
        if (id) textIds.push(id); else textFailed++;
      }
    }

    await bucket.file(storagePath).delete().catch(() => {});

    return NextResponse.json({
      success: true, filename,
      productCard: productCardId ? { id: productCardId } : null,
      text: { chunks: textIds.length, failed: textFailed, ids: textIds },
      images: { chunks: imageIds.length, failed: imageFailed, ids: imageIds },
    });

  } catch (e: unknown) {
    console.error('[knowledge-parse]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
