/**
 * char-access — 角色寫入權限守門
 *
 * 兩種放行身分：
 * 1. operator：帶 ailive-auth cookie（= AILIVE_PASSWORD），後台全站身分，可改任何角色
 * 2. client：帶 cli_<id> cookie（= 該角色 clientPassword），只能改自己那隻
 *
 * 「選一」政策：角色沒設 clientPassword → 維持開放（不回歸），有設才真的鎖。
 *
 * 用法：mutation route 在動手前先 `if (!(await assertCharAccess(req, id))) return 401`。
 */
import { NextRequest } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * 是否為 operator（後台全站密碼）。
 * AILIVE_PASSWORD 未設 → 跟 middleware 一致，視為 gate 關閉、全放行。
 */
export function hasOperatorAccess(req: NextRequest): boolean {
  const expected = process.env.AILIVE_PASSWORD;
  if (!expected) return true;
  const cookie = req.cookies.get('ailive-auth')?.value || '';
  return timingSafeEqual(cookie, expected);
}

/**
 * 判斷 req 能否寫入 characterId。
 * @param knownClientPassword 呼叫端若已讀到角色 doc，可帶進來省一次 Firestore read。
 *        undefined = 未知（會自己 fetch）；'' / null = 已知沒設密碼。
 */
export async function assertCharAccess(
  req: NextRequest,
  characterId: string,
  knownClientPassword?: string | null,
): Promise<boolean> {
  if (hasOperatorAccess(req)) return true;

  let clientPassword = knownClientPassword;
  if (clientPassword === undefined) {
    const db = getFirestore();
    const doc = await db.collection('platform_characters').doc(characterId).get();
    clientPassword = doc.exists ? String(doc.data()?.clientPassword || '') : '';
  }
  // 選一：沒設密碼 → 開放
  if (!clientPassword) return true;

  const cli = req.cookies.get(`cli_${characterId}`)?.value || '';
  return timingSafeEqual(cli, String(clientPassword));
}
