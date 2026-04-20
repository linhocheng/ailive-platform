import { readFileSync } from 'fs';
import { resolve } from 'path';
import admin from 'firebase-admin';
import { detectGear } from '../src/lib/llm-router';

const envPath = resolve(process.cwd(), '.env.local.fresh');
const envContent = readFileSync(envPath, 'utf-8');
const envMap: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) {
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    envMap[m[1]] = val;
  }
}

async function main() {
  const sa = JSON.parse(envMap.FIREBASE_SERVICE_ACCOUNT_JSON!);
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  const db = admin.firestore();

  const CHAR_ID = 'kTwsX44G0ImsApEACDuE';

  const SMELLS = [
    /畫/, /來張/, /弄張/, /弄一張/, /做張/, /做一張/, /呈現/, /視覺化/, /看看你/,
    /工具/, /能做/, /會什麼/, /能力/, /剛剛/, /上次你/, /再來/, /繼續.*圖/,
  ];

  const snap = await db.collection('platform_conversations')
    .where('characterId', '==', CHAR_ID)
    .limit(50)
    .get();

  console.log(`\n找到 ${snap.size} 個 conversations\n`);

  let total = 0, haiku = 0, sonnet = 0;
  const suspicious: { conv: string; turn: number; text: string; reason: string }[] = [];
  const haikuSamples: string[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const msgs: { role: string; content: string }[] = data.messages || [];
    let userTurn = 0;
    for (const m of msgs) {
      if (m.role !== 'user' || typeof m.content !== 'string') continue;
      userTurn++;
      total++;
      const gear = detectGear(m.content, userTurn - 1);
      if (gear === 'haiku') {
        haiku++;
        if (haikuSamples.length < 15) haikuSamples.push(m.content.slice(0, 50));
        const hit = SMELLS.find(r => r.test(m.content));
        if (hit) {
          suspicious.push({
            conv: doc.id.slice(-6),
            turn: userTurn,
            text: m.content.slice(0, 80),
            reason: String(hit),
          });
        }
      } else {
        sonnet++;
      }
    }
  }

  console.log(`=== Vivi 真實 gear 分佈 ===`);
  console.log(`總 user messages: ${total}`);
  console.log(`haiku（手只有 2 個）: ${haiku} (${(haiku/total*100).toFixed(1)}%)`);
  console.log(`sonnet（完整手）: ${sonnet} (${(sonnet/total*100).toFixed(1)}%)`);
  console.log();

  console.log(`=== haiku 路徑的訊息長什麼樣（前 15 條） ===`);
  haikuSamples.forEach((s, i) => console.log(`  ${i+1}. "${s}"`));
  console.log();

  console.log(`=== 疑似被剪手的現場 · ${suspicious.length} 條 ===`);
  for (const s of suspicious.slice(0, 30)) {
    console.log(`  [${s.conv}#${s.turn}] "${s.text}"  ← ${s.reason}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
