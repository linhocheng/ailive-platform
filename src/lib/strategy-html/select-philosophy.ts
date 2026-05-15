/**
 * selectPhilosophy — 根據文件內容自動選設計風格
 *
 * 用 Haiku 做輕量分類（< 1K tokens），不依賴角色設定。
 * 規則：文件內容決定風格，角色不綁定風格。
 */
import type { PhilosophyKey } from './prompt';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function selectPhilosophy(
  brief: string,
  docTitle: string,
  mdContent: string,
  anthropic: any,
): Promise<PhilosophyKey> {
  const preview = mdContent.slice(0, 600);
  const prompt = `你是設計風格分類器。根據以下策略書資訊，選出最適合的設計風格。

策略書標題：${docTitle}
委託摘要：${brief.slice(0, 200)}
內容預覽（前 600 字）：
${preview}

三種設計風格：
- dark-premium：適合融資計劃、競爭情報、高管簡報、BD 提案、投資人報告、財務規劃。關鍵詞：融資/投資/競爭/財務/BD/估值/股權/併購/高管/董事會
- eastern-blank：適合品牌策略、文化主張、靈性/身心/療癒、東方美學、社群創作、人文主題。關鍵詞：品牌/文化/靈性/身心/療癒/東方/社群/創作/藝術/人文
- swiss-grid：適合市場分析、產品策略、UIUX、商業規劃、技術路線圖、運營策略、一般策略書。（預設選項）

只輸出一個值，不加任何解釋：dark-premium 或 eastern-blank 或 swiss-grid`;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (res.content[0]?.text || '').trim().toLowerCase();
    if (raw.includes('dark-premium')) return 'dark-premium';
    if (raw.includes('eastern-blank')) return 'eastern-blank';
    return 'swiss-grid';
  } catch (e) {
    console.warn('[selectPhilosophy] classification failed, defaulting to swiss-grid:', e);
    return 'swiss-grid';
  }
}
