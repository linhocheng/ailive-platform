/**
 * User Profile — 全局用戶基本事實（跨角色共用）
 *
 * collection: platform_user_profiles/{userId}
 *
 * 性質：用戶**明確說過**的事實（name/birthday/age/occupation/interests）。
 * 不是角色觀察 — 觀察走 user-observations.ts（per-character）。
 *
 * 寫入路徑：tool update_user_profile（角色聽到用戶明說時呼叫）
 *           + session-end reflection（從 transcript 抽出明說事實）
 *
 * 讀路徑：dialogue / voice-stream / agent system prompt 注入「【關於這位朋友】」
 */
import { getFirestore } from '@/lib/firebase-admin';

export interface UserProfile {
  userId: string;
  name?: string | null;
  birthday?: string | null;        // 'YYYY-MM-DD'
  age?: number | null;
  occupation?: string | null;
  interests?: string[];
  extraInfo?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION = 'platform_user_profiles';

export async function loadUserProfile(userId: string): Promise<UserProfile | null> {
  if (!userId) return null;
  const db = getFirestore();
  const doc = await db.collection(COLLECTION).doc(userId).get();
  if (!doc.exists) return null;
  const d = doc.data() as Record<string, unknown> | undefined;
  if (!d) return null;
  return {
    userId,
    name: (d.name as string) ?? null,
    birthday: (d.birthday as string) ?? null,
    age: (d.age as number) ?? null,
    occupation: (d.occupation as string) ?? null,
    interests: Array.isArray(d.interests) ? (d.interests as string[]) : [],
    extraInfo: (d.extraInfo as string) ?? null,
    createdAt: d.createdAt as string | undefined,
    updatedAt: d.updatedAt as string | undefined,
  };
}

/**
 * Partial update — 只更新有提供的欄位，不洗掉沒提供的。
 * interests 是 array — 給「整組覆寫」語義（caller 決定 merge 還是 replace）。
 */
export async function upsertUserProfile(
  userId: string,
  partial: Partial<Omit<UserProfile, 'userId' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  if (!userId) throw new Error('upsertUserProfile: userId required');
  const db = getFirestore();
  const ref = db.collection(COLLECTION).doc(userId);
  const now = new Date().toISOString();

  // 過濾 undefined（避免覆寫成 undefined）
  const payload: Record<string, unknown> = { userId, updatedAt: now };
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) payload[k] = v;
  }
  // 第一次寫時補 createdAt
  const existing = await ref.get();
  if (!existing.exists) payload.createdAt = now;

  await ref.set(payload, { merge: true });
}

/**
 * 給 system prompt 用 — 把 profile 組成「【關於這位朋友】」block。
 * 沒任何欄位時回 ''（不浪費 token）。
 */
export function formatProfileBlock(profile: UserProfile | null): string {
  if (!profile) return '';
  const lines: string[] = [];
  if (profile.name) lines.push(`- 名字：${profile.name}`);
  if (profile.birthday) lines.push(`- 生日：${profile.birthday}`);
  // age 優先用儲存值，沒則嘗試從 birthday 算
  const age = profile.age ?? deriveAge(profile.birthday);
  if (age) lines.push(`- 年齡：${age} 歲`);
  if (profile.occupation) lines.push(`- 職業：${profile.occupation}`);
  if (profile.interests && profile.interests.length > 0) {
    lines.push(`- 興趣：${profile.interests.slice(0, 5).join('、')}`);
  }
  if (profile.extraInfo) lines.push(`- 其他：${profile.extraInfo}`);

  if (lines.length === 0) return '';
  return `\n\n【關於這位朋友（用戶親口說過的事實）】\n${lines.join('\n')}`;
}

function deriveAge(birthday?: string | null): number | null {
  if (!birthday) return null;
  try {
    const bd = new Date(birthday);
    if (isNaN(bd.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - bd.getFullYear();
    const m = now.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) age -= 1;
    return age >= 0 && age < 150 ? age : null;
  } catch {
    return null;
  }
}
