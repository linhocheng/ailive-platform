/**
 * User Observations — 角色對用戶的觀察（per (角色, 用戶) 對）
 *
 * collection: platform_user_observations/{characterId}_{userId}
 *
 * 性質：角色**主觀觀察**（personality/preferences/inferredInterests）。
 * 不分享給其他角色（吉娜眼中的 Adam ≠ 聖嚴眼中的 Adam）。
 *
 * 寫入路徑：tool record_user_observation（角色從對話推論時呼叫）
 *           + session-end reflection（從 transcript 抽出觀察）
 *
 * 讀路徑：三邊 system prompt 注入「【我（角色名）對這位朋友的觀察】」
 */
import { getFirestore } from '@/lib/firebase-admin';

export interface UserObservations {
  characterId: string;
  userId: string;
  personality?: string | null;
  preferences?: string[];
  inferredInterests?: string[];
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION = 'platform_user_observations';

function docId(characterId: string, userId: string): string {
  return `${characterId}_${userId}`;
}

export async function loadUserObservations(
  characterId: string,
  userId: string,
): Promise<UserObservations | null> {
  if (!characterId || !userId) return null;
  const db = getFirestore();
  const doc = await db.collection(COLLECTION).doc(docId(characterId, userId)).get();
  if (!doc.exists) return null;
  const d = doc.data() as Record<string, unknown> | undefined;
  if (!d) return null;
  return {
    characterId,
    userId,
    personality: (d.personality as string) ?? null,
    preferences: Array.isArray(d.preferences) ? (d.preferences as string[]) : [],
    inferredInterests: Array.isArray(d.inferredInterests) ? (d.inferredInterests as string[]) : [],
    notes: (d.notes as string) ?? null,
    createdAt: d.createdAt as string | undefined,
    updatedAt: d.updatedAt as string | undefined,
  };
}

export async function upsertUserObservations(
  characterId: string,
  userId: string,
  partial: Partial<Omit<UserObservations, 'characterId' | 'userId' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  if (!characterId || !userId) throw new Error('upsertUserObservations: ids required');
  const db = getFirestore();
  const ref = db.collection(COLLECTION).doc(docId(characterId, userId));
  const now = new Date().toISOString();

  const payload: Record<string, unknown> = { characterId, userId, updatedAt: now };
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) payload[k] = v;
  }
  const existing = await ref.get();
  if (!existing.exists) payload.createdAt = now;

  await ref.set(payload, { merge: true });
}

/**
 * 給 system prompt 用 — 把觀察組成「【我對這位朋友的觀察】」block。
 * charName 用於 block 標題（讓 LLM 知道這是「自己的」觀察）。
 */
export function formatObservationsBlock(
  obs: UserObservations | null,
  charName: string = '我',
): string {
  if (!obs) return '';
  const lines: string[] = [];
  if (obs.personality) lines.push(`- 個性印象：${obs.personality}`);
  if (obs.preferences && obs.preferences.length > 0) {
    lines.push(`- 偏好：${obs.preferences.slice(0, 5).join('、')}`);
  }
  if (obs.inferredInterests && obs.inferredInterests.length > 0) {
    lines.push(`- 推測興趣：${obs.inferredInterests.slice(0, 5).join('、')}`);
  }
  if (obs.notes) lines.push(`- 其他：${obs.notes}`);

  if (lines.length === 0) return '';
  const title = charName === '我' ? '我對這位朋友的觀察' : `${charName}對這位朋友的觀察`;
  return `\n\n【${title}（不是用戶親口說的，是我自己感受到的）】\n${lines.join('\n')}`;
}
