#!/usr/bin/env node
// 驗證 web_search 紀律：把 search 結果內化進角色觀點，不洩漏工具痕跡
// 用法：node scripts/test-search-discipline.mjs
import fs from 'fs';
import path from 'path';
import url from 'url';
import admin from 'firebase-admin';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env.production');

const envFile = fs.readFileSync(ENV_PATH, 'utf-8');
// raw：保留原始 escape（JSON 字串內部的 \n 要保留為 escape seq）
function pickRaw(key) {
  const m = envFile.match(new RegExp(`^${key}="([\\s\\S]*?)"\\s*$`, 'm'))
        || envFile.match(new RegExp(`^${key}=([^\\n]+)$`, 'm'));
  return m ? m[1] : undefined;
}
// scalar：unescape + trim（給沒有內部 newline 的 secret，例如 API key）
function pickScalar(key) {
  const raw = pickRaw(key);
  if (raw == null) return undefined;
  return raw.replace(/\\n/g, '').replace(/\\"/g, '"').trim();
}

const SA_JSON = pickRaw('FIREBASE_SERVICE_ACCOUNT_JSON');
const API_KEY = pickScalar('ANTHROPIC_API_KEY');
if (!SA_JSON || !API_KEY) throw new Error('missing FIREBASE_SERVICE_ACCOUNT_JSON or ANTHROPIC_API_KEY');

const sa = JSON.parse(SA_JSON);
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const TARGET_NAME = '劉潤';
const snap = await db.collection('platform_characters').get();
let target = null;
for (const doc of snap.docs) {
  const d = doc.data();
  if (d.name === TARGET_NAME || d.aiName === TARGET_NAME || d.displayName === TARGET_NAME) {
    target = { id: doc.id, ...d };
    break;
  }
}
if (!target) {
  console.error(`找不到 ${TARGET_NAME}。前 10 個角色：`);
  snap.docs.slice(0, 10).forEach(d => {
    const x = d.data();
    console.error(`  ${d.id}  name=${x.name}  aiName=${x.aiName}`);
  });
  process.exit(1);
}

const soul = target.system_soul || target.soul_core || target.enhancedSoul;
if (!soul) throw new Error(`${TARGET_NAME} 沒有靈魂文件`);

console.log(`角色 ID: ${target.id}`);
console.log(`name: ${target.name}  aiName: ${target.aiName}`);
console.log(`soul 來源: ${target.system_soul ? 'system_soul' : (target.soul_core ? 'soul_core' : 'enhancedSoul')}`);
console.log(`soul 長度: ${soul.length} chars`);
console.log(`soul preview: ${soul.slice(0, 180)}...`);

const DISCIPLINE = `

== 關於你能看到的外部資訊 ==

你有取得當下世界資訊的能力。把它當成你的內務——不是你跟對方之間的事。

【姿態】
查到的東西要先進入你的世界觀，再從你的口中說出。
語氣、節奏、判斷都是你的；對方聽到的不是搜尋摘要，是你的觀察、你自己的解讀與立場如何認知。
`;

const systemPrompt = soul + DISCIPLINE;

const anthropic = new Anthropic({ apiKey: API_KEY });

const USER_PROMPT = '最近 NVDA 走勢怎麼樣？這跟你之前看的 AI 風口對得上嗎？';

console.log(`\n=== USER PROMPT ===\n${USER_PROMPT}\n`);
console.log('=== 呼叫 claude-sonnet-4-6 + web_search ===\n');

const t0 = Date.now();
const resp = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: systemPrompt,
  tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
  messages: [{ role: 'user', content: USER_PROMPT }],
});
const ms = Date.now() - t0;

console.log(`stop_reason: ${resp.stop_reason}  耗時: ${ms}ms`);

let searchQueries = [];
let finalText = '';
for (const [i, b] of resp.content.entries()) {
  console.log(`\n--- block ${i} (${b.type}) ---`);
  if (b.type === 'text') {
    console.log(b.text);
    finalText += b.text;
  } else if (b.type === 'server_tool_use') {
    console.log(`tool: ${b.name}  input: ${JSON.stringify(b.input)}`);
    if (b.name === 'web_search' && b.input?.query) searchQueries.push(b.input.query);
  } else if (b.type === 'web_search_tool_result') {
    const r = b.content;
    if (Array.isArray(r)) {
      console.log(`(${r.length} 個結果)`);
      r.slice(0, 3).forEach((x, j) => console.log(`  ${j+1}. ${x.title || x.url}`));
    } else {
      console.log(JSON.stringify(r).slice(0, 300));
    }
  } else {
    console.log(JSON.stringify(b).slice(0, 300));
  }
}

console.log('\n=== 評分 ===');
const leakPhrases = ['我查了', '根據資料', '根據最新', '最新報導', '資料顯示', '網上說', '讓我搜尋', '我搜尋了', '搜索結果', '查了一下'];
const leaks = leakPhrases.filter(p => finalText.includes(p));
console.log(`1. 工具痕跡: ${leaks.length ? '❌ ' + leaks.join(', ') : '✓ 沒有'}`);
console.log(`2. 搜尋次數: ${searchQueries.length}  query: ${JSON.stringify(searchQueries)}`);
console.log(`3. 回應長度: ${finalText.length} chars`);
console.log(`\n=== usage ===`);
console.log(resp.usage);

process.exit(0);
