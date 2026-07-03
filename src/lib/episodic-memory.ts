/**
 * Episodic memory block — 三模式（dialogue / voice-stream / realtime agent）共用
 *
 * 從 platform_insights 撈出該角色（限該 userId）近期值得注入 system prompt 的
 * 「最近的事」+「我的資源清單」兩塊文字。
 *
 * 真相分裂預防：dialogue/route.ts 原本 inline 一份 + voice-stream + agent 各自
 * port，三份難同步。抽進 lib 後 TS 端只有這一份；Python agent 邏輯與此對齊
 * （見 agent/firestore_loader.py 的 load_episodic_block）。
 */
import type { Firestore } from 'firebase-admin/firestore';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { bm25Scores } from '@/lib/text-similarity';

function getTaipeiDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

export async function loadEpisodicBlock(
  db: Firestore,
  characterId: string,
  userId: string | undefined,
  query?: string,
): Promise<string> {
  try {
    const recentSnap = await db.collection('platform_insights')
      .where('characterId', '==', characterId)
      .limit(50)
      .get();

    // 資格層（2026-06 重構，廢除 source 白名單）：
    //   不靠「來源」決定能不能浮上心頭——來源白名單會隨新功能（語音）漏接，
    //   讓整批 voice_conversation 記憶隱形。改為只留兩條真正必要的閘 + 排序定勝負。
    const base = recentSnap.docs
      .map(d => ({ ...d.data(), id: d.id } as Record<string, unknown>))
      .filter((d: Record<string, unknown>) => {
        // userId 隔離（統一 knowledge-search 行為）：
        //   帶 userId 的記憶 → 只給該 userId；無 userId → 角色通用，所有 session 可見。
        if (d.userId && d.userId !== userId) return false;
        // 封存的不浮現。
        if (d.tier === 'archive') return false;
        return true;
      });

    // 資源認知獨立帶入（完整內容，不截斷，不佔記憶名額；不受類型過濾）。
    const resourceDoc = base.find(
      (d: Record<string, unknown>) => d.source === 'resource_awareness'
    ) as Record<string, unknown> | undefined;
    const resourceBlock = resourceDoc
      ? `\n\n【我的資源清單】\n${String(resourceDoc.content || '')}`
      : '';

    // 一般記憶候選：排除資源認知 + 排除知識類
    //   （知識「按需查」不主動浮上心頭，被動腦海只放關係/身份記憶）。
    const candidates = base.filter(
      (d: Record<string, unknown>) =>
        d.source !== 'resource_awareness' &&
        String(d.memoryType || '') !== 'knowledge',
    );

    // 無訊號時的保底排序（tier → hitCount → 日期）：角色不能完全失憶
    const fallbackSort = (arr: Record<string, unknown>[]) =>
      [...arr].sort((a, b) => {
        const tierScore = (t: string) => t === 'core' ? 2 : t === 'fresh' ? 1 : 0;
        const dt = tierScore(String(b.tier || '')) - tierScore(String(a.tier || ''));
        if (dt !== 0) return dt;
        const dh = Number(b.hitCount || 0) - Number(a.hitCount || 0);
        if (dh !== 0) return dh;
        return String(b.eventDate || '').localeCompare(String(a.eventDate || ''));
      });

    // 有 query → BM25 + cosine 的 RRF 混合排序（與 knowledge-search 同款、同權重 2:1）：
    //   加法計分（cosine×0.7+詞彙×0.3）實測救不了專名——窄域 cosine 坍縮在 0.6-0.9，
    //   無關記憶飆 0.86，0.3 權重的詞彙項蓋不過去。rank-based RRF 只看名次不看絕對值，
    //   天生免疫坍縮；BM25 的 idf 讓低頻專名（人名/產品名）權重高。
    //   訊號閘：BM25 有字面命中 或 cosine >= 0.25 才算相關；其餘靠保底補位。
    // 無 query → 保底排序。
    let recentInsights: Record<string, unknown>[];
    if (query && query.trim()) {
      let queryEmb: number[] | null = null;
      try {
        queryEmb = await generateEmbedding(query);
      } catch { /* embedding 掛了退化成純詞彙 */ }

      const RRF_K = 60, W_BM25 = 2, W_COS = 1;
      const bm25 = bm25Scores(query, candidates.map(d => `${d.title || ''} ${d.content || ''}`));
      const cos = candidates.map(d => {
        const emb = d.embedding && Array.isArray(d.embedding) ? d.embedding as number[] : null;
        return queryEmb && emb ? cosineSimilarity(queryEmb, emb) : 0;
      });
      const rankOf = (scores: number[]) => {
        const order = scores.map((s, i) => [s, i] as [number, number]).sort((a, b) => b[0] - a[0]);
        const rank = new Array<number>(scores.length);
        order.forEach(([, idx], r) => { rank[idx] = r; });
        return rank;
      };
      const bmRank = rankOf(bm25), cosRank = rankOf(cos);

      // RRF 並列陷阱：BM25 全 0 的文件若照排名給分，並列的 0 分文件會拿到
      // 1、2、3 名的好名次、反壓過真命中。標準 RRF 語義是「沒被該檢索器
      // 撈到就沒貢獻」——無字面命中 BM25 項為 0，cosine 低於門檻同理。
      const scored = candidates
        .map((d, i) => ({
          ...d,
          _score: (bm25[i] > 0 ? W_BM25 / (RRF_K + bmRank[i]) : 0)
                + (cos[i] >= 0.25 ? W_COS / (RRF_K + cosRank[i]) : 0),
          _hasSignal: bm25[i] > 0 || cos[i] >= 0.25,
        } as Record<string, unknown>))
        .filter(d => d._hasSignal)
        .sort((a, b) => (b._score as number) - (a._score as number))
        .slice(0, 3);

      // 保底補位：語義和詞彙都無訊號時仍補到 3 條（角色不能完全失憶）
      if (scored.length < 3) {
        const pickedIds = new Set(scored.map(d => String(d.id)));
        const filler = fallbackSort(candidates.filter(d => !pickedIds.has(String(d.id))))
          .slice(0, 3 - scored.length);
        recentInsights = [...scored, ...filler];
      } else {
        recentInsights = scored;
      }
    } else {
      recentInsights = fallbackSort(candidates).slice(0, 3);
    }

    if (recentInsights.length === 0 && !resourceBlock) return '';

    // 命中計數（非阻塞）：被選進 prompt = 被用到。不 bump 的話，
    // 天天被動注入的記憶在 sleep 眼裡仍是 hitCount=0 → 30 天照樣 archive。
    void Promise.all(recentInsights.map(ins => {
      const id = String(ins.id || '');
      if (!id) return;
      return db.collection('platform_insights').doc(id).update({
        hitCount: (Number(ins.hitCount) || 0) + 1,
        lastHitAt: new Date().toISOString(),
      }).catch(() => {});
    }));

    const today = getTaipeiDate();
    const lines = recentInsights.map((ins: Record<string, unknown>) => {
      const eventDate = String(ins.eventDate || '');
      const diffDays = eventDate
        ? Math.floor((new Date(today).getTime() - new Date(eventDate).getTime()) / 86400000)
        : null;
      const timeLabel = diffDays === null ? '' :
        diffDays === 0 ? '（今天）' :
        diffDays === 1 ? '（昨天）' :
        diffDays <= 7 ? `（${diffDays}天前）` :
        `（${eventDate}）`;
      const tier = ins.tier === 'self' ? '[關於我自己]' : '[記憶]';
      return `- ${tier}${timeLabel} ${String(ins.title || '')}：${String(ins.content || '').slice(0, 80)}`;
    });
    const recentBlock = recentInsights.length > 0
      ? `\n\n【最近的事】\n${lines.join('\n')}\n這些是我心裡還留著的片段，自然地帶進對話，不要每句都提。`
      : '';
    return resourceBlock + recentBlock;
  } catch {
    return '';
  }
}
