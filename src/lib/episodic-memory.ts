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

const IDENTITY_SOURCES = new Set([
  'sleep_time', 'self_awareness', 'sleep_self_awareness',
  'reflect', 'scheduler_reflect', 'scheduler_sleep',
  'post_reflection', 'pre_publish_reflection',
  'conversation', 'awakening',
  'resource_awareness',
]);

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

    const allFiltered = recentSnap.docs
      .map(d => ({ ...d.data(), id: d.id } as Record<string, unknown>))
      .filter((d: Record<string, unknown>) => {
        // Cross-user leak 防護：
        // 1. 帶不同 userId 的 → 跳過
        if (d.userId && d.userId !== userId) return false;
        // 2. identity 記憶（角色自知）→ 全局可見，但要非 archive
        if (d.tier === 'archive') return false;
        const mType = String(d.memoryType || '');
        if (mType === 'identity') return true;
        // 3. 非 identity 且 userId=None：只有當前 userId 也為空時才帶入
        //    避免 sleep_time/self_awareness 裡的他人名字（Polina/小艺）污染其他用戶
        if (!d.userId && userId) return false;
        if (mType === 'knowledge') return false;
        return IDENTITY_SOURCES.has(String(d.source || ''));
      });

    // 資源認知獨立帶入（完整內容，不截斷，不佔記憶名額）
    const resourceDoc = allFiltered.find(
      (d: Record<string, unknown>) => d.source === 'resource_awareness'
    ) as Record<string, unknown> | undefined;
    const resourceBlock = resourceDoc
      ? `\n\n【我的資源清單】\n${String(resourceDoc.content || '')}`
      : '';

    // 一般記憶：排除資源認知
    const candidates = allFiltered.filter(
      (d: Record<string, unknown>) => d.source !== 'resource_awareness',
    );

    // 有 query → semantic search（embedding 相似度排序）；無 query → hitCount 排序
    let recentInsights: Record<string, unknown>[];
    if (query && query.trim()) {
      const withEmb = candidates.filter(
        (d: Record<string, unknown>) => d.embedding && Array.isArray(d.embedding),
      );
      if (withEmb.length > 0) {
        try {
          const queryEmb = await generateEmbedding(query);
          recentInsights = withEmb
            .map(d => ({ ...d, _score: cosineSimilarity(queryEmb, d.embedding as number[]) }))
            .filter(d => (d._score as number) >= 0.25)
            .sort((a, b) => (b._score as number) - (a._score as number))
            .slice(0, 3);
        } catch {
          recentInsights = candidates
            .sort((a, b) => Number(b.hitCount || 0) - Number(a.hitCount || 0))
            .slice(0, 3);
        }
      } else {
        recentInsights = candidates
          .sort((a, b) => Number(b.hitCount || 0) - Number(a.hitCount || 0))
          .slice(0, 3);
      }
    } else {
      recentInsights = candidates
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
          const tierScore = (t: string) => t === 'core' ? 2 : t === 'fresh' ? 1 : 0;
          const aTier = tierScore(String(a.tier || ''));
          const bTier = tierScore(String(b.tier || ''));
          if (bTier !== aTier) return bTier - aTier;
          const aHit = Number(a.hitCount || 0);
          const bHit = Number(b.hitCount || 0);
          if (bHit !== aHit) return bHit - aHit;
          return String(b.eventDate || '').localeCompare(String(a.eventDate || ''));
        })
        .slice(0, 3);
    }

    if (recentInsights.length === 0 && !resourceBlock) return '';

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
