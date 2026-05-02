/**
 * 時間規則 block — 三模式（dialogue / voice-stream / realtime agent）共用
 *
 * 江彬實證：把「當前時間 + 相對時間判斷規則」明文寫進 prompt，
 * 角色說「剛才」「昨天」「上次」的準度比只塞 timestamp 高很多。
 *
 * 真相分裂預防：TS 端只有這一份；Python agent 邏輯與此對齊
 *（見 agent/firestore_loader.py 的 build_system_prompt 時間 block）。
 */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

/**
 * 回傳當前台北時間 + 相對時間判斷規則的 prompt block。
 *
 * 範例輸出：
 *   【當前時間】2026年04月28日 星期一 14:30（台北時間）
 *
 *   請依對話紀錄的時間戳判斷時間遠近：
 *   - 同一天內（幾分鐘到幾小時前）的事用「剛才」「剛剛」
 *   - 昨天發生的用「昨天」
 *   ...
 */
export function buildTimeRulesBlock(now: Date = new Date()): string {
  // 取台北時區的 Date parts（toLocaleString 不夠精準，用 formatToParts）
  const fmt = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');

  // weekday 在 zh-TW 是「週一」「週二」這種，我們要「星期一」格式（對齊 agent Python）
  // 直接用 Date 的 getDay() 但要對齊台北時區 — 用 ISO 字串解析比較穩
  const taipeiIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const weekdayIdx = new Date(`${taipeiIso}T00:00:00+08:00`).getUTCDay();
  const weekdayLabel = `星期${WEEKDAYS[weekdayIdx]}`;

  const timeStr = `${year}年${month}月${day}日 ${weekdayLabel} ${hour}:${minute}`;

  return [
    `【當前時間】${timeStr}（台北時間）`,
    '',
    '請依對話紀錄的時間戳判斷時間遠近：',
    '- 同一天內（幾分鐘到幾小時前）的事用「剛才」「剛剛」',
    '- 昨天發生的用「昨天」',
    '- 超過兩天才用「前幾天」「上次」',
    '- 絕對不要把幾分鐘前的事說成「上次」「之前」',
  ].join('\n');
}
