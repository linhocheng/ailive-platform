# TTS 前處理系統 工作排程計畫表

**起草**：2026-04-25 · 築（Code）
**範圍**：`src/lib/tts-preprocess.ts` + 兩條 TTS 出口（`/api/tts`、`voice-stream`）
**驅動 deadline**：MiniMax 切換在排程上，現有字典套到 MiniMax 會有失誤模式不匹配的風險
**總工時估**：1.5 - 2 個工作天（不含 MiniMax 試聽校對的 Adam 工時）

---

## 階段總覽

| 階段 | 主軸 | 工時 | 阻擋 deploy？ |
|------|------|------|--------------|
| Phase 1 · 補基礎結構 | metadata、log、test、detect 工具 | 0.5-1 天 | ❌（不改行為） |
| Phase 2 · Provider 分層 | core/elevenlabs/minimax 拆字典 | 0.5 天 + 校對 | ✅（切 MiniMax 前必做） |

**總策略**：Phase 1 全部完成後一次 deploy（不改行為，純基礎設施），Phase 2 分兩次（拆字典是無痛 deploy；MiniMax 校對結果一次切換）。

---

## Phase 1 · 補基礎結構（不改行為）

### Task 1.1 · 字典 schema 升級為 RuleEntry

**動什麼**：`PRONUNCIATION_MAP` 與 `ZH_TW_MAP` 從 `Record<string, string>` 升級為 `Record<string, RuleEntry>`：

```ts
type Strategy = 'phonetic' | 'semantic';
type Provider = 'elevenlabs' | 'minimax' | 'all';

type RuleEntry = {
  replacement: string;
  strategy: Strategy;
  reason: string;        // 為何替換（行→航 / 影→因避雷）
  provider: Provider;    // 預設 'all'
  addedAt: string;       // YYYY-MM-DD
  notes?: string;        // 例外案例、Adam 拍板紀錄
};
```

**驗收**：
- `tsc -b` 過
- `preprocessTTS` 行為不變（既有測試輸入輸出全一致）

**估時**：0.5 hr

---

### Task 1.2 · 遷移既有 ~200 條規則加 metadata

**動什麼**：依 `tts-preprocess.ts` 既有注釋分組（「── 重 ──」「── 影 ──」等）把每條規則包上 `RuleEntry`：
- `strategy`：全部標 `phonetic`（除非從注釋看得出 semantic）
- `reason`：從注釋分組推斷（例「重複→蟲複」reason = "重→蟲（避 chóng/zhòng）"）
- `provider`：先全標 `'all'`
- `addedAt`：用 git blame 抓近似日期，無法確認的標 `'2026-04-25'`（遷移日）

**驗收**：
- 每條規則都有完整 metadata
- 無遺漏（用 `Object.keys` 比對遷移前後數量一致）

**估時**：1 hr（純機械遷移，可用 codemod）

---

### Task 1.3 · 加命中 logging

**動什麼**：`preprocessTTS` 命中規則時 emit：

```ts
console.log('[TTS-fix]', {
  route: 'tts' | 'voice-stream',
  provider: 'elevenlabs' | 'minimax',
  characterId?: string,
  hits: [{ original: '影帝', replacement: '贏帝', strategy: 'phonetic' }],
  inputLen: 120,
});
```

**驗收**：
- 進 Vercel logs，搜 `[TTS-fix]` 看得到
- 沒命中時不 log（避免噪音）

**估時**：0.5 hr

---

### Task 1.4 · detect CLI（找高風險字）

**動什麼**：`scripts/tts-detect.ts`，接 stdin 或檔案路徑，掃文本：

```bash
npm run tts:detect -- "今天去銀行領錢，老本行還是這個"
# 輸出：
# [HIT] 銀行 → 銀航  (line 1, col 5)
# [HIT] 老本行 → 老本杭 (line 1, col 11)
# [WARN] 含高風險字「行」但有 2 處未匹配規則：「不行了」「行為」
```

`CHAR_ALERT` 列表起頭：`重 行 得 當 發 長 影 累 樂 還 覺 應 處 數 量 量 著 切 差 量`（從兩邊字典取聯集）。

**驗收**：
- `npm run tts:detect -- <file>` 可跑
- 對既有 `PRONUNCIATION_MAP` 列出所有命中、外加 CHAR_ALERT 中未匹配的位置
- 用一段測試文本驗證輸出符合預期

**估時**：1 hr

---

### Task 1.5 · unit test 覆蓋

**動什麼**：`src/lib/__tests__/tts-preprocess.test.ts`：
- 每條 PRONUNCIATION_MAP 規則一組 input/expected
- 每條 ZH_TW_MAP 一組
- 衝突 regression（短詞蓋長詞前綴）：`重新 / 重來 / 重要` 三詞順序測試
- Markdown 清除：`**bold**`、`[link](url)`、`<thinking>...</thinking>`
- URL 刪除

跑法：用 vitest（Next.js 標準）或 jest，按 package.json 既有設定。

**驗收**：
- 全綠
- 加一條會撞舊規則的新規則時，test 會立刻失敗

**估時**：1.5 hr（包含校對遷移後的 metadata 是否影響行為）

---

### Task 1.6 · build script 串測試

**動什麼**：`package.json` 的 `build` 改為 `npm test && next build`，或在 `vercel.json` 加 prebuild hook。

**驗收**：
- 本地 `npm run build` 會先跑 test
- Vercel 部署若 test 失敗，build 紅燈

**估時**：0.25 hr

---

## Phase 2 · Provider 分層

### Task 2.1 · 字典拆分

**動什麼**：

```
src/lib/tts-preprocess/
  index.ts              ← 對外 export preprocessTTS
  core.ts               ← Markdown/URL 清除、ZH_TW_MAP（兩家共用）
  rules/
    elevenlabs.ts       ← 現有 PRONUNCIATION_MAP 全部
    minimax.ts          ← 空（待 Task 2.4 校對結果填入）
  detect.ts             ← detect CLI 邏輯
```

舊的 `tts-preprocess.ts` 保留為 re-export shim，避免 import 全網改。

**驗收**：
- `tsc -b` 過
- 既有 `import { preprocessTTS } from '@/lib/tts-preprocess'` 不用改
- 所有 test 仍綠

**估時**：1 hr

---

### Task 2.2 · preprocessTTS API 升級為 provider-aware

**動什麼**：

```ts
preprocessTTS(text: string, opts?: { provider?: Provider; characterId?: string }): string
```

行為：
- 沒給 provider → 預設 `'elevenlabs'`（向後相容）
- core 規則永遠跑
- provider 規則依 provider 選 overlay

**驗收**：
- 沒帶參數呼叫等於現在的行為
- 帶 `{ provider: 'minimax' }` 會走 minimax overlay（即使空也不會跑 elevenlabs 的）

**估時**：0.5 hr

---

### Task 2.3 · 兩條 route 傳 provider

**動什麼**：
- `src/app/api/tts/route.ts` 從 `process.env.TTS_PROVIDER` 或 request body 拿 provider，傳給 `preprocessTTS`
- `src/app/api/voice-stream/route.ts` 同上
- 對齊 `src/lib/tts-providers/` 既有的 provider 選擇邏輯（避免兩處不同步）

**驗收**：
- TTS_PROVIDER=minimax 時 logging 顯示 `provider: 'minimax'`
- TTS_PROVIDER 沒設時顯示 `provider: 'elevenlabs'`

**估時**：0.5 hr

---

### Task 2.4 · MiniMax 試聽校對工作流

**動什麼**：
1. 寫腳本 `scripts/tts-minimax-audit.ts`：撈 Firestore 近 30 通對話的 reply 文本
2. 對每段文本跑 detect CLI，列出含高風險字的句子
3. 寫腳本 `scripts/tts-minimax-tts.ts`：批次叫 MiniMax 合成 mp3 存到 `~/Desktop/tts-audit/`
4. Adam 試聽，標記每段「念對 / 念錯」（CSV）
5. 把「念錯」的詞 → 設計 MiniMax 同音字替換 → 進 `rules/minimax.ts`
6. 把「念對」的詞 → 進 minimax 白名單（不繼承 elevenlabs 規則）

**白名單機制**：MiniMax overlay 有兩種規則：
- `replacements`：要替換的（同 ElevenLabs 結構）
- `excludeFromCore`：明確標「不要從 elevenlabs 規則繼承」（白名單）

**Adam 依賴**：步驟 4（試聽 + 標記）是 Adam 工時，不算我的工時。

**估時**：腳本 1.5 hr · Adam 試聽 ~1-2 hr

---

### Task 2.5 · 切 MiniMax 預演

**動什麼**：
- 在 dev 環境設 `TTS_PROVIDER=minimax`，用幾個固定角色（如馬雲）跑端到端對話 5 通
- 比對：MiniMax overlay 是否有效、白名單是否生效、log 是否乾淨
- 列出仍有問題的句子，回到 Task 2.4 補規則

**驗收**：
- 一通完整對話無「念錯」回報
- log 顯示正確 provider

**估時**：0.5 hr · Adam 試聽 ~0.5 hr

---

## 紅線（每個 Task 都守）

- ❌ 不改既有 TTS 行為（直到 Task 2.5 預演通過）
- ❌ 不刪既有規則（只加 metadata、不動內容）
- ❌ 不破壞向後相容（`preprocessTTS(text)` 沒參數呼叫必須等於現在）
- ❌ 不跳 `npm run build`
- ✅ 每個 Task 完成都跑一次 test 確認沒 regression
- ✅ Phase 1 完整跑完才 deploy（一次到位）

---

## 階段交付物對照

| Task | 產出 | 驗證 |
|------|------|------|
| 1.1 | RuleEntry type 定義 | tsc 過 |
| 1.2 | ~200 條 metadata 完整 | Object.keys 數量一致 |
| 1.3 | `[TTS-fix]` log 在 Vercel | 抽 10 通看得到 |
| 1.4 | `npm run tts:detect` CLI | 對示例文本輸出正確 |
| 1.5 | test suite | 100% 規則覆蓋 |
| 1.6 | build 接 test | 撞規則時 build 紅 |
| 2.1 | 三檔字典結構 | import 不用改 |
| 2.2 | provider-aware API | 兩種 provider 分流 |
| 2.3 | route 傳 provider | log 顯示正確 |
| 2.4 | minimax.ts 補滿 + 白名單 | Adam 簽收 |
| 2.5 | MiniMax 預演通過 | 無念錯 |

---

## 起手順序

按 ID 順序做，1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 2.1 → 2.2 → 2.3 → 2.4 → 2.5。

每完成一個 Task：
1. 跑 test
2. 更新本文件「階段交付物對照」表的驗證欄
3. 進下一個 Task

完成 Phase 1（1.1-1.6）後 commit + deploy 一次。
完成 Phase 2 字典結構（2.1-2.3）後 commit + deploy 一次（行為不變）。
完成 Phase 2 校對（2.4-2.5）後切 MiniMax 一次 commit。
