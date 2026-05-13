#!/usr/bin/env node
// 驗證索（dQHkL6vvhmKlNho8dA1L）本身的輸出格式
// 假設：索的 system_soul 內含五層協議 + 📍🔍⚠️🔗 輸出格式
// 測試：給一個必須查的問題，看實際輸出是否符合協議
// 用法：node scripts/test-suo-discipline.mjs
import fs from 'fs';
import path from 'path';
import url from 'url';
import admin from 'firebase-admin';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env.production');

const envFile = fs.readFileSync(ENV_PATH, 'utf-8');
function pickRaw(key) {
  const m = envFile.match(new RegExp(`^${key}="([\\s\\S]*?)"\\s*$`, 'm'))
        || envFile.match(new RegExp(`^${key}=([^\\n]+)$`, 'm'));
  return m ? m[1] : undefined;
}
function pickScalar(key) {
  const raw = pickRaw(key);
  if (raw == null) return undefined;
  return raw.replace(/\\n/g, '').replace(/\\"/g, '"').trim();
}

const SA_JSON = pickRaw('FIREBASE_SERVICE_ACCOUNT_JSON');
const API_KEY = pickScalar('ANTHROPIC_API_KEY');
if (!SA_JSON || !API_KEY) throw new Error('missing env');

const sa = JSON.parse(SA_JSON);
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const SUO_ID = 'dQHkL6vvhmKlNho8dA1L';
const suo = (await db.collection('platform_characters').doc(SUO_ID).get()).data();
if (!suo) throw new Error('索 not found');

const soul = suo.system_soul || suo.soul_core;
console.log(`索 ID: ${SUO_ID}`);
console.log(`name: ${suo.name}  aiName: ${suo.aiName}`);
console.log(`role_type: ${suo.role_type}  tier: ${suo.tier}`);
console.log(`soul 來源: ${suo.system_soul ? 'system_soul' : 'soul_core'}`);
console.log(`soul 長度: ${soul.length} chars`);
console.log(`soul preview:\n${soul.slice(0, 300)}...\n`);

const anthropic = new Anthropic({ apiKey: API_KEY });

// 一個必須查的問題（劉潤實測同題）
const QUERY = '查詢需求：最近 NVDA 走勢怎麼樣？\n\n脈絡：用戶在跟劉潤聊 AI 風口，劉潤要從你這拿到最新股價數據和關鍵新聞，他會自己內化後說出來。給他事實，不要包裝成劉潤的口吻。';

console.log(`=== 派工內容 ===\n${QUERY}\n`);
console.log('=== 呼叫 claude-sonnet-4-6 + web_search（索的視角）===\n');

const t0 = Date.now();
const resp = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: soul,
  tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
  messages: [{ role: 'user', content: QUERY }],
});
const ms = Date.now() - t0;

console.log(`stop_reason: ${resp.stop_reason}  耗時: ${ms}ms\n`);

let searchQueries = [];
let finalText = '';
for (const [i, b] of resp.content.entries()) {
  console.log(`--- block ${i} (${b.type}) ---`);
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
    console.log(JSON.stringify(b).slice(0, 200));
  }
  console.log('');
}

console.log('=== 結構檢驗 ===');
const hasConclusion = /📍/.test(finalText);
const hasEvidence = /🔍/.test(finalText);
const hasUncertain = /⚠️/.test(finalText);
const hasExtend = /🔗/.test(finalText);
console.log(`📍 結論段: ${hasConclusion ? '✓' : '✗'}`);
console.log(`🔍 依據段: ${hasEvidence ? '✓' : '✗'}`);
console.log(`⚠️  不確定: ${hasUncertain ? '✓' : '✗'}`);
console.log(`🔗 延伸段: ${hasExtend ? '✓' : '✗'}`);
console.log(`搜尋次數: ${searchQueries.length}  query: ${JSON.stringify(searchQueries)}`);
console.log(`回應長度: ${finalText.length} chars`);
console.log(`\n=== usage ===`);
console.log(resp.usage);

process.exit(0);
