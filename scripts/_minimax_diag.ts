/**
 * MiniMax 0B 根因診斷
 *
 * 用吉娜的 voice_id（克隆音）直接打 MiniMax API，
 * 多種文字 × 多次重複 × 不同間隔，統計 0B 出現條件。
 *
 * 跑法：npx tsx scripts/_minimax_diag.ts
 *
 * env：MINIMAX_API_KEY / MINIMAX_GROUP_ID（從 .env.local.fresh 讀）
 */
import { readFileSync } from 'fs';
import { sify } from 'chinese-conv';

// 從多個可能來源讀 env（本地、Vercel pull 結果）
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
const VOICE_ID = 'moss_audio_34337f32-3bf1-11f1-b03a-429e918b7c64'; // 吉娜

if (!API_KEY || !GROUP_ID) {
  console.error('缺 MINIMAX_API_KEY 或 MINIMAX_GROUP_ID');
  process.exit(1);
}

type Result = {
  label: string;
  text: string;
  ok: boolean;        // HTTP 200 且 first chunk > 0
  http: number;
  firstChunkSize: number;
  totalBytes: number;
  ttfbMs: number;     // time to first byte
  totalMs: number;
  note?: string;
};

async function callOnce(text: string, label: string): Promise<Result> {
  const url = `https://api.minimax.io/v1/t2a_v2?GroupId=${encodeURIComponent(GROUP_ID)}`;
  const body = {
    model: 'speech-02-turbo',
    text: sify(text),
    stream: true,
    stream_options: { exclude_aggregated_audio: true },
    language_boost: null,
    voice_setting: {
      voice_id: VOICE_ID,
      speed: 1.2,
      vol: 1.0,
      pitch: 0,
      emotion: 'neutral',
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  };

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => '');
    return {
      label, text, ok: false, http: res.status, firstChunkSize: 0, totalBytes: 0,
      ttfbMs: Date.now() - t0, totalMs: Date.now() - t0, note: err.slice(0, 120),
    };
  }

  // 讀 SSE，解 audio hex，統計
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let firstChunkSize = 0;
  let totalBytes = 0;
  let ttfbMs = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
        const ev = buf.slice(0, sepIdx);
        buf = buf.slice(sepIdx + 2);
        const dataLine = ev.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json || json === '[DONE]') continue;
        try {
          const parsed = JSON.parse(json);
          const hex: string = parsed?.data?.audio;
          const status: number = parsed?.data?.status;
          if (hex && status === 1) {
            const bytes = hex.length / 2;
            totalBytes += bytes;
            if (firstChunkSize === 0) {
              firstChunkSize = bytes;
              ttfbMs = Date.now() - t0;
            }
          }
        } catch {}
      }
    }
  } catch (e: any) {
    return {
      label, text, ok: false, http: res.status, firstChunkSize, totalBytes,
      ttfbMs, totalMs: Date.now() - t0, note: `stream error: ${e.message}`,
    };
  }

  return {
    label, text, ok: firstChunkSize > 0,
    http: res.status, firstChunkSize, totalBytes,
    ttfbMs, totalMs: Date.now() - t0,
  };
}

const CASES: Array<{ label: string; text: string }> = [
  { label: 'A-極短',   text: '好。' },
  { label: 'B-短句',   text: '嗯，我知道了。' },
  { label: 'C-中句',   text: '今天天氣不錯，我們去散步吧。' },
  { label: 'D-長句',   text: '我想跟你說一個很長的故事，從前從前有一個小女孩住在森林邊緣的小屋裡，她每天都會去森林裡採蘑菇回家給媽媽煮湯喝，這天她遇到了一隻會說話的兔子。' },
  { label: 'E-英文混中', text: '那個 API endpoint 的 response 時間有點長。' },
  { label: 'F-標點密',  text: '啊！真的嗎？太好了！我超開心的！！！' },
  { label: 'G-全英',    text: 'Hello, how are you doing today?' },
];

const REPEATS = 5;          // 每個 case 打幾次
const INTERVAL_MS = 300;    // 每次之間的間隔（比 provider 內部 500ms 短，模擬實際壓力）

async function main() {
  console.log(`開始診斷：${CASES.length} cases × ${REPEATS} reps = ${CASES.length * REPEATS} 次呼叫\n`);
  console.log(`voice_id: ${VOICE_ID}`);
  console.log(`interval: ${INTERVAL_MS}ms\n`);

  const all: Result[] = [];
  for (const c of CASES) {
    for (let r = 0; r < REPEATS; r++) {
      const res = await callOnce(c.text, c.label);
      all.push(res);
      const tag = res.ok ? 'OK ' : (res.http !== 200 ? `HTTP${res.http}` : '0B ');
      console.log(`[${c.label}#${r + 1}] ${tag} ttfb=${res.ttfbMs}ms total=${res.totalMs}ms firstChunk=${res.firstChunkSize}B bytes=${res.totalBytes}${res.note ? ' ← ' + res.note : ''}`);
      await new Promise(rv => setTimeout(rv, INTERVAL_MS));
    }
    console.log();
  }

  // 統計
  console.log('='.repeat(60));
  console.log('總結');
  console.log('='.repeat(60));
  const total = all.length;
  const ok = all.filter(x => x.ok).length;
  const zeroB = all.filter(x => x.http === 200 && !x.ok).length;
  const httpErr = all.filter(x => x.http !== 200).length;
  console.log(`總數 ${total}  成功 ${ok}  0B ${zeroB}  HTTP錯 ${httpErr}`);
  console.log(`0B 率 ${(zeroB / total * 100).toFixed(1)}%\n`);

  // 按 case 拆
  for (const c of CASES) {
    const group = all.filter(x => x.label === c.label);
    const gOk = group.filter(x => x.ok).length;
    const gZB = group.filter(x => x.http === 200 && !x.ok).length;
    const avgTtfb = group.filter(x => x.ok).reduce((s, x) => s + x.ttfbMs, 0) / (gOk || 1);
    console.log(`[${c.label}] ${gOk}/${group.length} OK, ${gZB} 0B, avg TTFB=${avgTtfb.toFixed(0)}ms`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
