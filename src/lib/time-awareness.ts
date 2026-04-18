/**
 * 時間感知工具 — 跨對話的久別重逢感
 *
 * 設計：
 *   - formatGap：把毫秒間隔轉成人話描述（分鐘/小時/天/週）
 *   - shouldInjectGap：判斷是否該注入時間感知 prompt
 *   - 各 route 自己決定注入字串的具體內容（譬如 dialogue vs voice 的提示語不同）
 *
 * 為什麼抽出來：
 *   2026-04-19 chat 築發現 dialogue 用 Math.round、voice-stream 用 Math.floor，
 *   兩處差 1 分鐘的小漂移。獨孤九劍破索式：兩份即是零份。統一用 Math.round。
 *
 * 為什麼閾值寫死在這裡：
 *   現階段只有兩處用，調的話一處改全處生效。
 *   未來若進中台（YuqiCity 那種 admin config）再抽到 DB。
 */

export const NEW_VISIT_THRESHOLD_MS = 10 * 60 * 1000; // 10 分鐘

/**
 * 把毫秒間隔轉成人話。
 * 4 個檔位：分鐘 / 小時 / 天 / 週。
 * 統一用 Math.round（四捨五入），不用 floor。
 */
export function formatGap(ms: number): string {
  const min = ms / 60000;
  if (min < 60)    return `約 ${Math.round(min)} 分鐘`;
  if (min < 1440)  return `約 ${Math.round(min / 60)} 小時`;
  if (min < 10080) return `約 ${Math.round(min / 1440)} 天`;
  return `約 ${Math.round(min / 10080)} 週`;
}

/**
 * 判斷是否該注入時間感知，並回傳人話描述。
 *
 * @param opts.lastUpdatedAt - 上次對話 updatedAt (ISO string 或 null)
 * @param opts.messageCount  - 之前的訊息數
 * @param opts.requireNewVisit - 是否要求 isNewVisit=true 才觸發
 *                                dialogue 傳 true（同 session 多輪不重複觸發）
 *                                voice 傳 false（每次語音都當新訪問）
 * @param opts.isNewVisit    - requireNewVisit=true 時才看
 * @returns { inject: false } 或 { inject: true, durationText: '約 3 小時' }
 */
export function shouldInjectGap(opts: {
  lastUpdatedAt: string | null | undefined;
  messageCount: number;
  requireNewVisit: boolean;
  isNewVisit?: boolean;
}): { inject: false } | { inject: true; durationText: string } {
  if (opts.requireNewVisit && !opts.isNewVisit) return { inject: false };
  if (!opts.messageCount || opts.messageCount <= 0) return { inject: false };
  if (!opts.lastUpdatedAt) return { inject: false };

  const lastAt = new Date(String(opts.lastUpdatedAt)).getTime();
  if (isNaN(lastAt)) return { inject: false };

  const gap = Date.now() - lastAt;
  if (gap <= NEW_VISIT_THRESHOLD_MS) return { inject: false };

  return { inject: true, durationText: formatGap(gap) };
}
