/**
 * Character Actions — 角色 × 用戶 維度的行動/承諾/事件記憶層
 *
 * 設計：擴用 platform_insights collection，不另開新表。
 *   - userId       有值 = (角色, 用戶) 維度的事
 *                  無值 = 角色維度的通用知識（既有行為）
 *   - actionType   分類標籤：promise / question / event / note / general
 *   - fulfilled    promise/question 才有意義；true = 已兌現
 *
 * 進路徑：每 20 輪 LLM 提煉時分流寫入。
 * 出路徑：voice-stream / dialogue 開頭預塞，且 query_knowledge_base 工具撈得到（filter 後）。
 */
import { getFirestore } from '@/lib/firebase-admin';
import { generateEmbedding } from '@/lib/embeddings';

export type ActionType = 'promise' | 'question' | 'event' | 'note' | 'general';

export interface CharacterAction {
  id?: string;
  characterId: string;
  userId: string;
  actionType: ActionType;
  title: string;
  content: string;
  fulfilled: boolean;
  fulfilledAt?: string | null;
  importance?: number;
  createdAt: string;
  source?: string;
  embedding?: number[];
}

const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  promise: '我答應過',
  question: '我問過',
  event: '他的事',
  note: '記住',
  general: '',
};

export async function getRecentUserActions(
  characterId: string,
  userId: string,
  opts: { unfulfilledOnly?: boolean; limit?: number } = {},
): Promise<CharacterAction[]> {
  const db = getFirestore();
  const limit = opts.limit ?? 5;
  let q: FirebaseFirestore.Query = db
    .collection('platform_insights')
    .where('characterId', '==', characterId)
    .where('userId', '==', userId);
  if (opts.unfulfilledOnly) {
    q = q.where('fulfilled', '==', false);
  }
  // 不 orderBy createdAt：避免要組合索引；改撈多一點後在 client 排序
  const snap = await q.limit(Math.max(limit * 3, 30)).get();
  const items: CharacterAction[] = snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      characterId: String(data.characterId),
      userId: String(data.userId),
      actionType: (data.actionType as ActionType) || 'general',
      title: String(data.title || ''),
      content: String(data.content || ''),
      fulfilled: Boolean(data.fulfilled),
      fulfilledAt: data.fulfilledAt ?? null,
      importance: typeof data.importance === 'number' ? data.importance : undefined,
      createdAt: String(data.createdAt || ''),
      source: data.source ? String(data.source) : undefined,
    };
  });
  items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return items.slice(0, limit);
}

export async function addUserAction(
  input: Omit<CharacterAction, 'id' | 'createdAt' | 'fulfilled' | 'embedding'> & { fulfilled?: boolean },
): Promise<string> {
  const db = getFirestore();
  const embedding = await generateEmbedding(`${input.title} ${input.content}`).catch(() => undefined);
  const doc = await db.collection('platform_insights').add({
    characterId: input.characterId,
    userId: input.userId,
    actionType: input.actionType,
    title: input.title,
    content: input.content,
    fulfilled: input.fulfilled ?? false,
    fulfilledAt: null,
    importance: input.importance ?? 1,
    source: input.source ?? 'auto',
    tier: 'fresh',
    hitCount: 0,
    lastHitAt: null,
    embedding,
    createdAt: new Date().toISOString(),
  });
  return doc.id;
}

export async function markFulfilled(actionId: string): Promise<void> {
  const db = getFirestore();
  await db.collection('platform_insights').doc(actionId).update({
    fulfilled: true,
    fulfilledAt: new Date().toISOString(),
  });
}

export function formatActionsBlock(actions: CharacterAction[]): string {
  if (actions.length === 0) return '';
  const lines = actions.map(a => {
    const label = ACTION_TYPE_LABEL[a.actionType] || '';
    const body = a.title || a.content;
    return label ? `- （${label}）${body}` : `- ${body}`;
  });
  return `\n\n【我對這位朋友說過 / 還沒兌現的事】\n${lines.join('\n')}`;
}
