/**
 * /api/knowledge-upload — 文件上傳解析入知識庫 V2
 *
 * POST multipart/form-data
 *   file: .docx / .pdf / .md / .txt
 *   characterId: string
 *   category: string（選填，預設 'document'）
 *
 * docx 流程（新範本，確定性解析，零 Haiku）：
 *   H1 → brand + productName
 *   H2 段落 → 直接 map 到 platform_products 各欄位
 *   最後 table → 圖片（caption 在同 <th>/<td> 格，直接用，不猜）
 *   產出：
 *     platform_products（一筆完整產品主檔）
 *     platform_knowledge × N（每 H2 一條，帶 productName）
 *     platform_knowledge × M（每張圖一條，帶 productName + imageUrl）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, getFirestore } from '@/lib/firebase-admin';

export const maxDuration = 120;

export const config = {
  api: { bodyParser: false, responseLimit: '20mb' },
};

// ── 圖片 caption → images map key ──
function captionToKey(caption: string): string {
  const c = caption;
  if (c.includes('全身')) return '模特兒全身';
  if (c.includes('半身')) return '模特兒半身';
  if (c.includes('大頭')) return '模特兒大頭';
  if (c.includes('斜躺')) return '純產品斜躺';
  if (c.includes('正面')) return '純產品正面';
  return caption.slice(-10);
}

// ── 上傳圖片到 Firebase Storage ──
async function uploadImageToStorage(
  base64Data: string,
  contentType: string,
  characterId: string,
  index: number,
): Promise<string> {
  const admin = getFirebaseAdmin();
  const bucket = admin.storage().bucket();
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const date = new Date().toISOString().slice(0, 10);
  const path = `knowledge-images/${characterId}/${date}/img_${index}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buffer = Buffer.from(base64Data, 'base64');
  const file = bucket.file(path);
  await file.save(buffer, { metadata: { contentType } });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${path}`;
}

// ── 儲存 knowledge 條目 ──
async function saveKnowledge(
  baseUrl: string,
  characterId: string,
  title: string,
  content: string,
  category: string,
  imageUrl?: string,
  productName?: string,
): Promise<string | null> {
  try {
    const body: Record<string, string> = { characterId, title, content, category };
    if (imageUrl) body.imageUrl = imageUrl;
    if (productName) body.productName = productName;
    const res = await fetch(`${baseUrl}/api/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data.id || null;
  } catch { return null; }
}

// ── 從 HTML 解析產品文件（確定性，零 Haiku）──
interface ProductData {
  brand: string;
  productName: string;
  productType: string;
  positioning: string;
  ingredients: Array<{ name: string; effect: string }>;
  effects: string[];
  usage: string[];
  suitableFor: string[];
  cautions: string[];
  sections: Array<{ title: string; content: string }>;
}

function parseProductHtml(html: string): ProductData {
  // 去除 anchor tags，壓扁換行（讓 regex 不需要 s flag）
  const clean = html.replace(/<a[^>]*>|<\/a>/g, '').replace(/\n/g, ' ');

  // H1 → brand + productName
  const h1Match = clean.match(/<h1[^>]*>([^<]*(?:<(?!\/h1>)[^<]*)*)<\/h1>/);
  const h1Text = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';
  // "AVIVA 完美淨顏慕絲花" → brand:"AVIVA", productName:"完美淨顏慕絲花"
  const spaceIdx = h1Text.indexOf(' ');
  const brand = spaceIdx > 0 ? h1Text.slice(0, spaceIdx).trim() : '';
  const productName = spaceIdx > 0 ? h1Text.slice(spaceIdx + 1).trim() : h1Text;

  // H2 段落切片
  const h2Splits = [...clean.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)];
  const sectionMap: Record<string, string> = {};
  const sections: Array<{ title: string; content: string }> = [];
  for (let i = 0; i < h2Splits.length; i++) {
    const title = h2Splits[i][1].replace(/<[^>]+>/g, '').trim();
    const start = h2Splits[i].index! + h2Splits[i][0].length;
    const end = i + 1 < h2Splits.length ? h2Splits[i + 1].index! : clean.length;
    const contentHtml = clean.slice(start, end);
    const text = contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    sectionMap[title] = text;
    if (text.length > 5) sections.push({ title: `${productName} — ${title}`, content: text });
  }

  // 成分 table 結構化解析（核心成分 H2 下的 table）
  const ingredients: Array<{ name: string; effect: string }> = [];
  const ingSection = h2Splits.find(m => m[1].replace(/<[^>]+>/g, '').trim() === '核心成分');
  if (ingSection) {
    const secStart = ingSection.index! + ingSection[0].length;
    const secIdx = h2Splits.indexOf(ingSection);
    const secEnd = secIdx + 1 < h2Splits.length ? h2Splits[secIdx + 1].index! : clean.length;
    const secHtml = clean.slice(secStart, secEnd);
    const rows = [...secHtml.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)];
    for (const row of rows.slice(1)) { // skip header row
      const cells = [...row[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)];
      if (cells.length >= 2) {
        const name = cells[0][1].replace(/<[^>]+>/g, '').trim();
        const effect = cells[1][1].replace(/<[^>]+>/g, '').trim();
        if (name && effect && name !== '成分') ingredients.push({ name, effect });
      }
    }
  }

  // ul/ol 列表解析
  const toList = (sectionText: string): string[] =>
    sectionText.split(/\s{2,}/).map(s => s.trim()).filter(s => s.length > 2).slice(0, 20);

  return {
    brand,
    productName,
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

// ── chunkMarkdown（非 docx 用）──
function chunkMarkdown(md: string, filename: string): Array<{ title: string; content: string }> {
  const lines = md.split('\n');
  const chunks: Array<{ title: string; content: string }> = [];
  let parentTitle = '';
  let sectionTitle = '';
  let currentContent: string[] = [];
  const flush = () => {
    const c = currentContent.join('\n').trim();
    if (c.length > 20) {
      const title = parentTitle && sectionTitle
        ? `${parentTitle} — ${sectionTitle}`
        : parentTitle || sectionTitle || filename;
      chunks.push({ title, content: c });
    }
    currentContent = [];
  };
  for (const line of lines) {
    if (line.startsWith('# ')) { flush(); parentTitle = line.replace(/^#\s+/, '').trim(); sectionTitle = ''; }
    else if (line.startsWith('## ')) { flush(); sectionTitle = line.replace(/^##\s+/, '').trim(); }
    else { currentContent.push(line); }
  }
  flush();
  if (chunks.length === 0 && md.trim().length > 0) chunks.push({ title: filename, content: md.trim() });
  return chunks;
}

// ===== 主流程 =====

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const characterId = formData.get('characterId') as string;
    const category = (formData.get('category') as string) || 'document';

    if (!file || !characterId) {
      return NextResponse.json({ error: 'file 和 characterId 必填' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx', 'md', 'txt'].includes(ext || '')) {
      return NextResponse.json({ error: '只支援 .pdf、.docx、.md、.txt' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const baseUrl = req.nextUrl.origin;
    const db = getFirestore();

    const imageIds: string[] = [];
    let imageFailed = 0;
    const textIds: string[] = [];
    let textFailed = 0;
    let productCardId: string | null = null;

    if (ext === 'docx') {
      // ===== DOCX V2：確定性解析，產出產品主檔 =====
      const mammoth = await import('mammoth');

      // convertToHtml with base64 images
      // convertToHtml 預設就把圖片 inline 為 base64 data URI
      const htmlResult = await mammoth.convertToHtml({ buffer });
      const htmlStr = htmlResult.value;

      // 解析產品結構
      const product = parseProductHtml(htmlStr);

      // ── 圖片：從最後的 table 抽 caption + base64 ──
      const imageMap: Record<string, string> = {};
      const tables = [...htmlStr.matchAll(/<table[^>]*>(.*?)<\/table>/g)];
      if (tables.length > 0) {
        const lastTableHtml = tables[tables.length - 1][1];
        const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
        const imgSrcRegex = /src="data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)"/;
        const textRegex = /<[^>]+>/g;
        let cellMatch;
        let imgIndex = 0;
        while ((cellMatch = cellRegex.exec(lastTableHtml)) !== null) {
          const cellHtml = cellMatch[1];
          const imgMatch = imgSrcRegex.exec(cellHtml);
          if (!imgMatch) continue;
          imgIndex++;
          try {
            const contentType = imgMatch[1];
            const base64 = imgMatch[2];
            const rawText = cellHtml.replace(imgSrcRegex, '').replace(textRegex, ' ').replace(/\s+/g, ' ').trim();
            const caption = rawText.replace(/\s*\u00a0\s*/g, ' ').trim();
            const imageUrl = await uploadImageToStorage(base64, contentType, characterId, imgIndex);
            const title = caption || `${product.productName} — 圖片 ${imgIndex}`;
            const id = await saveKnowledge(baseUrl, characterId, title, `圖片網址：${imageUrl}`, 'image', imageUrl, product.productName);
            if (id) imageIds.push(id);
            else imageFailed++;
            // images map（供產品主檔用）
            const key = captionToKey(caption);
            imageMap[key] = imageUrl;
          } catch { imageFailed++; }
        }
      }

      // ── 文字段落存 knowledge（每個 H2 一條，帶 productName）──
      for (const section of product.sections) {
        const id = await saveKnowledge(baseUrl, characterId, section.title, section.content, category, undefined, product.productName);
        if (id) textIds.push(id);
        else textFailed++;
      }

      // ── 產品主檔存 platform_products ──
      if (product.productName) {
        // 先刪舊的（重複上傳時更新）
        const existSnap = await db.collection('platform_products')
          .where('characterId', '==', characterId)
          .where('productName', '==', product.productName)
          .limit(1).get();
        if (!existSnap.empty) await existSnap.docs[0].ref.delete();

        const ref = await db.collection('platform_products').add({
          characterId,
          productName: product.productName,
          brand: product.brand,
          productType: product.productType,
          positioning: product.positioning,
          ingredients: product.ingredients,
          effects: product.effects,
          usage: product.usage,
          suitableFor: product.suitableFor,
          cautions: product.cautions,
          images: imageMap,
          knowledgeIds: [...textIds, ...imageIds],
          sourceFile: file.name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        productCardId = ref.id;
      }

    } else if (ext === 'md' || ext === 'txt') {
      const markdown = buffer.toString('utf-8');
      const chunks = chunkMarkdown(markdown, file.name);
      for (const chunk of chunks) {
        const id = await saveKnowledge(baseUrl, characterId, chunk.title, chunk.content, category);
        if (id) textIds.push(id); else textFailed++;
      }

    } else {
      // PDF
      const pdfParse = await import('pdf-parse');
      const pdfParser = (pdfParse as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default || pdfParse;
      const data = await pdfParser(buffer);
      const chunks = chunkMarkdown(data.text, file.name);
      for (const chunk of chunks) {
        const id = await saveKnowledge(baseUrl, characterId, chunk.title, chunk.content, category);
        if (id) textIds.push(id); else textFailed++;
      }
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      format: ext,
      productCard: productCardId ? { id: productCardId } : null,
      text: { chunks: textIds.length, failed: textFailed, ids: textIds },
      images: { chunks: imageIds.length, failed: imageFailed, ids: imageIds },
    });

  } catch (e: unknown) {
    console.error('[knowledge-upload]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
