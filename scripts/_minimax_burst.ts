/**
 * MiniMax 壓力測試 + 0B 診斷
 *
 * 目的：故意觸發 burst limit，抓 0B 時的完整 SSE 內容
 *
 * 做法：
 *   1. 連發 30 次同一長句，不 sleep
 *   2. 失敗時印完整 response headers + 所有 SSE events 的原始 JSON
 *   3. 統計 0B 在第幾次開始出現、有無恢復
 */
import { readFileSync } from 'fs';
import { sify } from 'chinese-conv';

const ENV_FILES = ['.env.local', '.env.local.fresh', '.env.vercel.production'];
let env = '';
for (const f of ENV_FILES) {
  try { env += '\n' + readFileSync(f, 'utf-8'); } catch {}
}
function pick(key: string): string {
  const m = env.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m ? m[1].replace(/^"|"$/g, '').trim() : '';
}
const API_KEY = pick('MINIMAX_API_KEY');
const GROUP_ID = pick('MINIMAX_GROUP_ID');
if (!API_KEY || !GROUP_ID) { console.error('缺 key'); process.exit(1); }

const VOICE = 'moss_audio_34337f32-3bf1-11f1-b03a-429e918b7c64';
const TEXT = '我想跟你說一個很長的故事，從前從前有一個小女孩住在森林邊緣的小屋裡，她每天都會去森林裡採蘑菇回家給媽媽煮湯喝。';

type Detail = {
  idx: number;
  ok: boolean;
  http: number;
  totalBytes: number;
  ttfbMs: number;
  totalMs: number;
  headers: Record<string, string>;
  sseEvents: string[];  // 完整 SSE events 原始 JSON（0B 時才記）
};

async function callOnce(idx: number, dumpAll: boolean): Promise<Detail> {
  const url = `https://api.minimax.io/v1/t2a_v2?GroupId=${encodeURIComponent(GROUP_ID)}`;
  const body = {
    model: 'speech-02-turbo',
    text: sify(TEXT),
    stream: true,
    stream_options: { exclude_aggregated_audio: true },
    language_boost: null,
    voice_setting: { voice_id: VOICE, speed: 1.2, vol: 1.0, pitch: 0, emotion: 'neutral' },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
  };

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });

  const detail: Detail = { idx, ok: false, http: res.status, totalBytes: 0, ttfbMs: 0, totalMs: 0, headers, sseEvents: [] };

  if (!res.ok || !res.body) {
    detail.totalMs = Date.now() - t0;
    detail.sseEvents.push(`(no body) ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return detail;
  }

  // 如果 content-type 不是 event-stream，整包當 JSON 讀（MiniMax 限流時會走這路）
  const ct = headers['content-type'] || '';
  if (!ct.includes('event-stream')) {
    const text = await res.text();
    detail.totalMs = Date.now() - t0;
    detail.sseEvents.push(`[non-SSE ${ct}] ${text}`);
    return detail;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sepIdx: number;
    while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
      const ev = buf.slice(0, sepIdx);
      buf = buf.slice(sepIdx + 2);
      const dataLine = ev.split('\n').find(l => l.startsWith('data:'));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json || json === '[DONE]') continue;

      // 記錄 SSE event（除了 audio hex 太長，壓縮成 summary）
      try {
        const parsed = JSON.parse(json);
        const hex: string = parsed?.data?.audio;
        const status: number = parsed?.data?.status;
        if (hex && status === 1) {
          const bytes = hex.length / 2;
          detail.totalBytes += bytes;
          if (!detail.ttfbMs) detail.ttfbMs = Date.now() - t0;
          if (dumpAll) detail.sseEvents.push(`[audio chunk ${bytes}B, status=${status}]`);
        } else {
          // 非 audio 的 event — 完整記下
          detail.sseEvents.push(JSON.stringify(parsed));
        }
      } catch {
        detail.sseEvents.push(`(parse fail) ${json.slice(0, 200)}`);
      }
    }
  }

  detail.totalMs = Date.now() - t0;
  detail.ok = detail.totalBytes > 0;
  return detail;
}

function shortHeaders(h: Record<string, string>): string {
  // 只留可能跟限流相關的
  const keys = Object.keys(h).filter(k => /rate|limit|retry|request-id|x-/i.test(k));
  return keys.map(k => `${k}=${h[k]}`).join(' | ');
}

async function main() {
  const N = 30;
  console.log(`壓力測試：連發 ${N} 次 (不 sleep)，voice=${VOICE.slice(0, 20)}...`);
  console.log(`文本長度：${TEXT.length} 字\n`);

  const details: Detail[] = [];
  const t0 = Date.now();

  for (let i = 0; i < N; i++) {
    const d = await callOnce(i + 1, false);
    details.push(d);
    const tag = d.ok ? 'OK' : (d.http !== 200 ? `HTTP${d.http}` : '0B');
    const hdrs = shortHeaders(d.headers);
    console.log(`#${String(i + 1).padStart(2)} ${tag.padEnd(4)} ttfb=${d.ttfbMs}ms total=${d.totalMs}ms bytes=${d.totalBytes}${hdrs ? '  [' + hdrs + ']' : ''}`);
    if (!d.ok) {
      for (const ev of d.sseEvents.slice(0, 5)) {
        console.log(`     ↳ ${ev}`);
      }
    }
  }

  const elapsed = Date.now() - t0;
  const ok = details.filter(d => d.ok).length;
  console.log(`\n總耗時 ${elapsed}ms，平均間隔 ${(elapsed / N).toFixed(0)}ms`);
  console.log(`${ok}/${N} OK (${(ok / N * 100).toFixed(0)}%)`);

  // 第一個 0B 出現位置
  const firstFail = details.findIndex(d => !d.ok);
  if (firstFail >= 0) {
    console.log(`\n首次失敗在第 ${firstFail + 1} 次`);
    console.log(`失敗 SSE events：`);
    console.log(JSON.stringify(details[firstFail].sseEvents, null, 2));
    console.log(`\n完整 headers：`);
    console.log(JSON.stringify(details[firstFail].headers, null, 2));
  }

  // 有無恢復？
  const okAfterFail: number[] = [];
  let seenFail = false;
  for (let i = 0; i < details.length; i++) {
    if (!details[i].ok) seenFail = true;
    else if (seenFail) okAfterFail.push(i + 1);
  }
  if (okAfterFail.length) {
    console.log(`\n失敗後恢復成功的位置：${okAfterFail.join(', ')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
