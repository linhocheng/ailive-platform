/**
 * user-profile-extractor.ts
 * Session 結束後自動從 transcript 提取用戶透露的具體事實，
 * 更新 user-profile（全域）和 user-observations（角色維度）。
 *
 * 原則：只寫「確定知道的」，不推測，不覆蓋已有值。
 */
import Anthropic from '@anthropic-ai/sdk';
import { upsertUserProfile, loadUserProfile } from '@/lib/user-profile';
import { upsertUserObservations, loadUserObservations } from '@/lib/user-observations';

interface ExtractResult {
  profile: Record<string, unknown>;
  observations: Record<string, unknown>;
  skipped?: string;
}

export async function autoExtractUserProfile(
  transcript: string,
  userId: string,
  characterId: string,
  apiKey: string,
): Promise<ExtractResult> {
  if (!userId || !transcript || transcript.length < 50) {
    return { profile: {}, observations: {}, skipped: 'too_short_or_no_user' };
  }

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `以下是一段對話記錄。請從「用戶」說的話中，提取用戶主動透露的具體事實。

規則：
- 只寫用戶明確說出的，不要推測
- 沒有就留空，不要填 null 或空字串
- interests / preferences 用陣列

回傳格式（JSON，只含有值的欄位）：
{
  "profile": {
    "name": "用戶說的名字",
    "age": 數字,
    "job": "職業",
    "location": "居住地",
    "interests": ["興趣1"]
  },
  "observations": {
    "personality": "個性描述",
    "preferences": ["偏好1"],
    "notes": "其他值得記的"
  }
}

只回傳 JSON，不要說明文字。

對話：
${transcript.slice(0, 2000)}`,
      }],
    });

    const raw = (resp.content[0] as Anthropic.TextBlock).text.trim();
    const cleaned = raw.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = JSON.parse(cleaned) as ExtractResult;

    const profileUpdates: Record<string, unknown> = {};
    const obsUpdates: Record<string, unknown> = {};

    // profile：只補沒有值的欄位
    if (parsed.profile && Object.keys(parsed.profile).length > 0) {
      const existing = await loadUserProfile(userId);
      for (const [k, v] of Object.entries(parsed.profile)) {
        if (!v) continue;
        if (k === 'interests' && Array.isArray(v)) {
          const existingInterests: string[] = (existing?.interests as string[]) || [];
          const newItems = (v as string[]).filter(i => !existingInterests.includes(i));
          if (newItems.length > 0) profileUpdates.interests = [...existingInterests, ...newItems].slice(-10);
        } else if (!existing?.[k as keyof typeof existing]) {
          profileUpdates[k] = v;
        }
      }
      if (Object.keys(profileUpdates).length > 0) {
        await upsertUserProfile(userId, profileUpdates);
      }
    }

    // observations：只補沒有值的欄位
    if (parsed.observations && Object.keys(parsed.observations).length > 0) {
      const existing = await loadUserObservations(characterId, userId);
      for (const [k, v] of Object.entries(parsed.observations)) {
        if (!v) continue;
        if (k === 'preferences' && Array.isArray(v)) {
          const existingPrefs: string[] = (existing?.preferences as string[]) || [];
          const newItems = (v as string[]).filter(i => !existingPrefs.includes(i));
          if (newItems.length > 0) obsUpdates.preferences = [...existingPrefs, ...newItems].slice(-10);
        } else if (!existing?.[k as keyof typeof existing]) {
          obsUpdates[k] = v;
        }
      }
      if (Object.keys(obsUpdates).length > 0) {
        await upsertUserObservations(characterId, userId, obsUpdates);
      }
    }

    return { profile: profileUpdates, observations: obsUpdates };
  } catch (e) {
    console.warn('[user-profile-extractor] failed:', e instanceof Error ? e.message : String(e));
    return { profile: {}, observations: {}, skipped: 'extraction_failed' };
  }
}
