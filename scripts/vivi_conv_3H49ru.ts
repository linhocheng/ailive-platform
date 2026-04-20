import { readFileSync } from 'fs';
import { resolve } from 'path';
import admin from 'firebase-admin';
import { detectGear } from '../src/lib/llm-router';

const envContent = readFileSync(resolve(process.cwd(), '.env.local.fresh'), 'utf-8');
const envMap: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) {
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    envMap[m[1]] = val;
  }
}

async function main() {
  const sa = JSON.parse(envMap.FIREBASE_SERVICE_ACCOUNT_JSON!);
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  const db = admin.firestore();

  const snap = await db.collection('platform_conversations')
    .where('characterId', '==', 'kTwsX44G0ImsApEACDuE')
    .limit(50)
    .get();

  for (const doc of snap.docs) {
    if (!doc.id.endsWith('3H49ru')) continue;

    console.log(`=== conversation ${doc.id} 全文 ===\n`);
    const data = doc.data();
    const msgs: Array<{ role: string; content: string; tool_use_name?: string; tool_uses?: unknown[] }> = data.messages || [];
    let userTurn = 0;
    for (const m of msgs) {
      if (m.role === 'user') {
        userTurn++;
        const gear = detectGear(typeof m.content === 'string' ? m.content : '', userTurn - 1);
        const tag = gear === 'haiku' ? '🔴 HAIKU（只有 2 工具）' : '🟢 SONNET（完整）';
        console.log(`\n[USER #${userTurn}] ${tag}`);
        console.log(`  "${typeof m.content === 'string' ? m.content : '[非文字]'}"`);
      } else if (m.role === 'assistant') {
        const text = typeof m.content === 'string' ? m.content.slice(0, 300) : '[非文字]';
        console.log(`[VIVI] ${text}`);
      }
    }
    break;
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
