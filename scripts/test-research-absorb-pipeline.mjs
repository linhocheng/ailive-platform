#!/usr/bin/env node
// 模擬完整 dispatch_research pipeline，驗證吸收後沒有 leak
// 1. 劉潤的 system_soul 為 absorb call 的 system
// 2. 索的 system_soul 為 research call 的 system
// 3. 跑完之後檢查最終文字有無「索」「查了」「資料顯示」等 leak phrase
// 用法：node scripts/test-research-absorb-pipeline.mjs
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
  return raw == null ? undefined : raw.replace(/\\n/g, '').replace(/\\"/g, '"').trim();
}
const SA_JSON = pickRaw('FIREBASE_SERVICE_ACCOUNT_JSON');
const API_KEY = pickScalar('ANTHROPIC_API_KEY');
const sa = JSON.parse(SA_JSON);
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const SUO_ID = 'dQHkL6vvhmKlNho8dA1L';
const TARGET_NAME = '馬雲';
const QUESTION = '最近 NVDA 走勢怎麼樣？這跟我們聊的 AI 浪潮對得上嗎？';
const CONTEXT = '用戶在跟馬雲聊 AI 浪潮，要從最新股價/業績/競爭格局判斷浪潮是不是還對';

const ABSORB_DISCIPLINE = `

== 關於剛剛這條資訊 ==
把它當成你的內務——你想了一下，現在要對用戶說。
查到的事先進入你的世界觀，再從你口中說出。語氣、節奏、判斷都是你的；
對方聽到的不是搜尋摘要、不是助理回報，是你的觀察、你的解讀、你的立場。
不要說「我查了」「我朋友幫我」「資料顯示」「根據最新」——這些痕跡都是漏氣。
用一句到三句話自然接話。`;

// 撈兩個角色
const suoDoc = await db.collection('platform_characters').doc(SUO_ID).get();
const suo = suoDoc.data();
const suoSoul = suo.system_soul || suo.soul_core;

const snap = await db.collection('platform_characters').get();
let target = null;
for (const d of snap.docs) {
  const x = d.data();
  if (x.name === TARGET_NAME || x.aiName === TARGET_NAME) { target = { id: d.id, ...x }; break; }
}
if (!target) throw new Error(`找不到 ${TARGET_NAME}`);
const liurunSoul = target.system_soul || target.soul_core;

console.log(`索 (${SUO_ID}) soul: ${suoSoul.length} chars`);
console.log(`${TARGET_NAME} (${target.id}) soul: ${liurunSoul.length} chars`);
console.log(`問題: ${QUESTION}\n`);

const anthropic = new Anthropic({ apiKey: API_KEY });

// ── STAGE 1: 索查詢 ──
console.log('=== STAGE 1: 索查詢 (web_search) ===');
const t1 = Date.now();
const suoResp = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: suoSoul,
  tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
  messages: [{ role: 'user', content: `查詢需求:${QUESTION}\n\n脈絡:${CONTEXT}` }],
});
const suoText = suoResp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
const suoMs = Date.now() - t1;
console.log(`耗時 ${suoMs}ms, ${suoText.length} chars`);
console.log(`索輸出前 500 字: ${suoText.slice(0, 500)}...\n`);

// ── STAGE 2: 劉潤吸收 ──
console.log('=== STAGE 2: 劉潤吸收 (含紀律段) ===');
const t2 = Date.now();
const absorbResp = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: liurunSoul + ABSORB_DISCIPLINE,
  messages: [{
    role: 'user',
    content: `剛剛你想了一下「${QUESTION}」這件事。你內心整理到的資訊是:\n\n${suoText}\n\n現在自然接話告訴用戶。`,
  }],
});
const absorbedText = absorbResp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
const absorbMs = Date.now() - t2;
console.log(`耗時 ${absorbMs}ms, ${absorbedText.length} chars`);
console.log(`\n--- 劉潤實際說出來的話 ---\n${absorbedText}\n`);

// ── 漏氣檢驗 ──
const leakPhrases = [
  '索', '我查了', '查了一下', '根據資料', '根據最新', '最新報導',
  '資料顯示', '網上說', '搜尋', '查詢', '我朋友', '助理', '報告顯示',
  '查到', '剛剛查', '剛查',
];
const leaks = leakPhrases.filter(p => absorbedText.includes(p));

// 馬雲味道（粗篩 marker）
const markersList = ['你看', '所以', '商業', '本質', '其實', '我跟你說', '阿里', '生意', '機會', '我覺得'];
const markers = markersList.filter(m => absorbedText.includes(m));

console.log('=== 紀律檢驗 ===');
console.log(`1. 漏氣痕跡: ${leaks.length ? '❌ ' + leaks.join(', ') : '✓ 乾淨'}`);
console.log(`2. ${TARGET_NAME}味道: ${markers.length}/${markersList.length} ${JSON.stringify(markers)}`);
console.log(`3. 總耗時: ${suoMs + absorbMs}ms (索 ${suoMs} + 吸收 ${absorbMs})`);
console.log(`4. 索輸出: ${suoText.length} → 吸收後: ${absorbedText.length} chars (壓縮 ${((1 - absorbedText.length/suoText.length)*100).toFixed(0)}%)`);

console.log('\n=== usage ===');
console.log(`索: ${JSON.stringify(suoResp.usage)}`);
console.log(`吸收: ${JSON.stringify(absorbResp.usage)}`);

process.exit(0);
