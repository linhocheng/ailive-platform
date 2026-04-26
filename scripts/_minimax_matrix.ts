/**
 * MiniMax 0B matrix 診斷 — 分離變數找真正根因
 *
 * 固定同一個長文本，變動三軸：
 *   voice:  克隆音（吉娜 moss_audio_）vs 官方 voice（female-tianmei）
 *   model:  speech-02-turbo vs speech-2.6-hd
 *   stream: true vs false
 *
 * 2×2×2 = 8 組，每組 5 次，總 40 次呼叫。
 *
 * 目的：證實或推翻「克隆音是 0B 真因」的假設。
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
if (!API_KEY || !GROUP_ID) { console.error('缺 MINIMAX_API_KEY / GROUP_ID'); process.exit(1); }

const CLONE_VOICE = 'moss_audio_34337f32-3bf1-11f1-b03a-429e918b7c64'; // 吉娜
const OFFICIAL_VOICE = 'female-tianmei';                                  // MiniMax 官方 voice

// 固定長句（先前 100% 0B 那句）
const LONG_TEXT = '我想跟你說一個很長的故事，從前從前有一個小女孩住在森林邊緣的小屋裡，她每天都會去森林裡採蘑菇回家給媽媽煮湯喝，這天她遇到了一隻會說話的兔子。';

type Config = { voice: string; model: string; stream: boolean; label: string };
const MATRIX: Config[] = [
  { voice: CLONE_VOICE,    model: 'speech-02-turbo',  stream: true,  label: 'CLONE·turbo·STREAM' },
  { voice: CLONE_VOICE,    model: 'speech-02-turbo',  stream: false, label: 'CLONE·turbo·NO-STREAM' },
  { voice: CLONE_VOICE,    model: 'speech-2.6-hd',    stream: true,  label: 'CLONE·hd·STREAM' },
  { voice: CLONE_VOICE,    model: 'speech-2.6-hd',    stream: false, label: 'CLONE·hd·NO-STREAM' },
  { voice: OFFICIAL_VOICE, model: 'speech-02-turbo',  stream: true,  label: 'OFFICIAL·turbo·STREAM' },
  { voice: OFFICIAL_VOICE, model: 'speech-02-turbo',  stream: false, label: 'OFFICIAL·turbo·NO-STREAM' },
  { voice: OFFICIAL_VOICE, model: 'speech-2.6-hd',    stream: true,  label: 'OFFICIAL·hd·STREAM' },
  { voice: OFFICIAL_VOICE, model: 'speech-2.6-hd',    stream: false, label: 'OFFICIAL·hd·NO-STREAM' },
];

const REPEATS = 5;
const INTERVAL_MS = 300;  // 壓力測試：把間隔降到 300ms，驗證「頻率是根因」假設

type Result = { label: string; ok: boolean; http: number; totalBytes: number; ttfbMs: number; note?: string };

async function callStream(cfg: Config, text: string): Promise<Result> {
  const url = `https://api.minimax.io/v1/t2a_v2?GroupId=${encodeURIComponent(GROUP_ID)}`;
  const body = {
    model: cfg.model,
    text: sify(text),
    stream: true,
    stream_options: { exclude_aggregated_audio: true },
    language_boost: null,
    voice_setting: { voice_id: cfg.voice, speed: 1.2, vol: 1.0, pitch: 0, emotion: 'neutral' },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
  };
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    return { label: cfg.label, ok: false, http: res.status, totalBytes: 0, ttfbMs: Date.now() - t0, note: (await res.text().catch(() => '')).slice(0, 100) };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', totalBytes = 0, ttfbMs = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sepIdx: number;
    while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
      const ev = buf.slice(0, sepIdx); buf = buf.slice(sepIdx + 2);
      const dataLine = ev.split('\n').find(l => l.startsWith('data:'));
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
          if (!ttfbMs) ttfbMs = Date.now() - t0;
        }
      } catch {}
    }
  }
  return { label: cfg.label, ok: totalBytes > 0, http: 200, totalBytes, ttfbMs };
}

async function callNoStream(cfg: Config, text: string): Promise<Result> {
  const url = `https://api.minimax.io/v1/t2a_v2?GroupId=${encodeURIComponent(GROUP_ID)}`;
  const body = {
    model: cfg.model,
    text: sify(text),
    stream: false,
    language_boost: null,
    voice_setting: { voice_id: cfg.voice, speed: 1.2, vol: 1.0, pitch: 0, emotion: 'neutral' },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
  };
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ttfbMs = Date.now() - t0;
  if (!res.ok) {
    return { label: cfg.label, ok: false, http: res.status, totalBytes: 0, ttfbMs, note: (await res.text().catch(() => '')).slice(0, 100) };
  }
  try {
    const json: any = await res.json();
    const hex: string = json?.data?.audio;
    const bytes = hex ? hex.length / 2 : 0;
    const base = json?.base_resp;
    const note = bytes === 0 && base ? `base_resp: ${JSON.stringify(base).slice(0, 120)}` : undefined;
    return { label: cfg.label, ok: bytes > 0, http: 200, totalBytes: bytes, ttfbMs, note };
  } catch (e: any) {
    return { label: cfg.label, ok: false, http: 200, totalBytes: 0, ttfbMs, note: `parse error: ${e.message}` };
  }
}

async function callOnce(cfg: Config, text: string): Promise<Result> {
  return cfg.stream ? callStream(cfg, text) : callNoStream(cfg, text);
}

async function main() {
  console.log(`Matrix 診斷：${MATRIX.length} configs × ${REPEATS} reps = ${MATRIX.length * REPEATS} 次\n`);
  console.log(`文本長度：${LONG_TEXT.length} 字`);
  console.log(`文本：${LONG_TEXT}\n`);
  console.log('─'.repeat(70));

  const all: (Result & { cfg: Config })[] = [];
  for (const cfg of MATRIX) {
    console.log(`\n▶ ${cfg.label}`);
    for (let r = 0; r < REPEATS; r++) {
      const res = await callOnce(cfg, LONG_TEXT);
      all.push({ ...res, cfg });
      const tag = res.ok ? 'OK' : (res.http !== 200 ? `HTTP${res.http}` : '0B');
      console.log(`  #${r + 1} ${tag.padEnd(4)} ttfb=${res.ttfbMs}ms bytes=${res.totalBytes}${res.note ? ' ← ' + res.note : ''}`);
      await new Promise(rv => setTimeout(rv, INTERVAL_MS));
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('總結（OK / 總數）');
  console.log('='.repeat(70));
  for (const cfg of MATRIX) {
    const group = all.filter(x => x.label === cfg.label);
    const ok = group.filter(x => x.ok).length;
    const pct = ((ok / group.length) * 100).toFixed(0);
    const bar = '█'.repeat(ok) + '░'.repeat(group.length - ok);
    console.log(`  ${cfg.label.padEnd(32)} ${bar} ${ok}/${group.length} (${pct}%)`);
  }

  // 按軸聚合
  console.log('\n按軸聚合：');
  const byAxis = (fn: (r: Result & { cfg: Config }) => string) => {
    const buckets = new Map<string, number[]>();
    for (const r of all) {
      const k = fn(r);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(r.ok ? 1 : 0);
    }
    for (const [k, arr] of buckets) {
      const ok = arr.filter(x => x).length;
      console.log(`    ${k}: ${ok}/${arr.length} (${((ok / arr.length) * 100).toFixed(0)}%)`);
    }
  };
  console.log('  voice：');  byAxis(r => r.cfg.voice === CLONE_VOICE ? '克隆音' : '官方音');
  console.log('  model：');  byAxis(r => r.cfg.model);
  console.log('  stream：'); byAxis(r => r.cfg.stream ? 'stream' : 'no-stream');
}

main().catch(e => { console.error(e); process.exit(1); });
