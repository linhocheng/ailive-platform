# 平台統一計劃 — voice-stream × dialogue 收斂

**起草**：2026-04-26 · 築
**範圍**：`/api/voice-stream` + `/api/dialogue` + 共用 conversation 邏輯
**驅動**：兩條 route 各自演化造成 (1) 同步生圖 timeout (2) 記憶分裂兩個宇宙 (3) 工具/邏輯三份重複

---

## WHY（為何要做這件事）

當初拆 dialogue / voice-stream 是對的——語音上下文確實不該卡長操作。但事實演進到現在：

1. **dialogue 早就解過長工具問題**：`commission_specialist` 委派 painter（瞬）非同步執行，立刻回應、後台跑
2. **voice-stream 沒對齊**：`generate_image` 仍用 `await generateImageForCharacter(...)` 同步等 30-60 秒 → SSE 卡死 → 用戶以為斷線
3. **兩條 route 維護成本越來越高**：工具定義 / conversation 邏輯 / 提煉壓縮 寫了三次
4. **同用戶 × 同角色記憶分裂**：文字 conv doc 跟語音 conv doc 是兩個不同檔案，session state Redis key 也不同

**核心判斷**：不是「拿掉長工具」，是「全用委派模式」+「共用記憶核心」。
這跟 P1 commit A 的 `character-actions` (`actionType: 'promise'`) 哲學一致——**承諾是先承諾，兌現是分開的事**。

---

## 階段總覽

| Phase | 主軸 | 工時 | 風險 | 何時 deploy |
|------|------|------|------|------------|
| **Phase 1** · voice 對齊委派模式 | 解決同步生圖 timeout，跟 dialogue 對齊 | 2-3 hr | 低 | 完成後一次 |
| **觀察 2-3 天** | 看 P1 + P2 + Phase 1 累積效果 | — | — | — |
| **Phase 2** · 共用 conversation core | 真相統一、邏輯收斂、工具 registry | 1.5-2 天 | 中 | 每個 Task 獨立 deploy |

---

## Phase 1 · voice-stream 對齊委派模式（短期）

### Task 1.1 · voice-stream 加 commission_specialist 工具定義

**動點**：`src/app/api/voice-stream/route.ts:222` 的 VOICE_TOOLS

加入：
```ts
{
  name: 'commission_specialist',
  description: '把長任務（生圖、深研究）委派給 specialist 角色（painter=瞬）。立刻回應，後台執行。',
  input_schema: { ... 對齊 dialogue:142-175 ... },
}
```

**驗收**：tsc 過、工具清單出現在 system 給 Claude 看的 tools 陣列

**估時**：0.25 hr

---

### Task 1.2 · voice-stream 的 generate_image 改 stub → 委派

**動點**：`voice-stream/route.ts:467-477` 的 generate_image handler

改寫對齊 `dialogue/route.ts:435-445`：
```ts
if (toolName === 'generate_image') {
  return await execVoiceTool('commission_specialist', {
    specialist: 'painter',
    brief: prompt,
    refs: refUrl ? [refUrl] : [],
  });
}
```

**驗收**：
- 撥語音叫角色生圖 — 角色 5 秒內回「好我請瞬畫」
- dashboard 後台看到瞬的工作出現
- 5 分鐘內 dashboard 出現新圖

**估時**：0.25 hr

---

### Task 1.3 · voice-stream 加 commission_specialist handler

**動點**：`voice-stream/route.ts:280` 的 execVoiceTool

對齊 `dialogue/route.ts:447+` commission_specialist 邏輯：
- 解析 specialist key（painter → shun-001）
- 呼叫 `/api/specialist/image` 非同步 endpoint
- **寫 character-actions 一條 `actionType: 'promise'`, `fulfilled: false`**（接 P1 commit A 的能力）
- 立刻回 `已委派 ${specialist} 處理，預估 ${estimateMin} 分鐘`

後台完成後（specialist endpoint 內部）→ markFulfilled。

**驗收**：
- character-actions 看到 `promise` 條目
- 完成後條目 `fulfilled = true`
- 下次對話角色會自然帶出「上次你叫我畫的圖好了」

**估時**：1.5 hr

---

### Task 1.4 · voice 委派紀律 prompt

**動點**：`voice-stream/route.ts:195-208` 的 voiceStableBlock

加入一段：

```
【委派紀律】
你有 specialist 可以調度（painter=瞬負責生圖）。
- 用戶請你做長任務（生圖、深度查詢、寫長內容）→ 一定走 commission_specialist
- 立刻說「好我請 XXX 處理，等下你看 dashboard / 我下次告訴你」
- 不要說「我馬上幫你畫」然後等很久（會超時）
- 答應 ≠ 立刻做。承諾是承諾，兌現是兌現。
```

**驗收**：抽 5 通含生圖請求的對話，看角色用詞符合「我請瞬畫」而非「我畫」

**估時**：0.5 hr

---

### Phase 1 commit 規劃

- `v0.2.4.018 — 重構：voice-stream 對齊委派模式`（1.1 + 1.2 + 1.3 一個 commit）
- `v0.2.4.019 — 設定：voice 委派紀律 prompt`（1.4 單獨）

---

## ⏸ 觀察期（2-3 天）

讓 Phase 1 + 既有 P2 / P1 commit A 累積對話樣本。

**觀察指標**：
- voice-stream 不再因生圖 timeout
- character-actions 的 promise 條目開始出現
- summary 是否確實留下承諾（P2 效果）
- query_knowledge_base 是否開始撈到 user 維度的 insights（commit A leak 補丁無誤）

**Adam 回報**：通話實感 → 角色記得不記得？

---

## Phase 2 · 共用 conversation core（中期）

### Task 2.1 · 抽 conversation-core helper

**新檔**：`src/lib/conversation-core.ts`

包含：
```ts
getConvId(characterId, userId, opts?: { explicit?: string }): string
loadConvData(convId): Promise<ConvData>
saveConvPartial(convId, patch): Promise<void>
shouldCompressSummary(convData): boolean
runSummaryCompress(convData, recent): Promise<string>  // 共用 P2 prompt
shouldExtractInsights(messageCount): boolean
runExtractionAndStore(...): Promise<void>  // 共用提煉邏輯
writeLastSession(convId, snapshot): Promise<void>
```

**驗收**：
- voice-stream / dialogue 的 conversation 邏輯改用這個 helper
- 行為完全不變（手動測試三種劇本：新對話、進行中對話、跨日對話）

**估時**：2-3 hr

---

### Task 2.2 · 統一 conversation doc ID

**決策**：取消 `voice-` 前綴，所有對話用 `${characterId}-${userId}` 為 doc ID。

**遷移**：
- 寫 `scripts/migrate_conv_ids.ts`
- 對每個 `voice-{cid}-{uid}` doc：
  - 找對應的 `{cid}-{uid}` doc（dialogue 端）
  - 若存在 → messages 合併（按 createdAt 排序，去重複）、summary 連接、lastSession 取較新
  - 若不存在 → 直接 rename
- **不刪舊 doc**，標 `_migrated_to: ${newId}` 保留追溯

**route 改動**：
- voice-stream:151 從 `voice-${cid}-${uid}` 改為 `${cid}-${uid}`
- voice-stream 載入時：先試新 ID，找不到 fallback 試 voice-prefix（讓正在進行的舊對話不斷線）

**驗收**：同 user × char，文字後立刻語音 → 角色記得文字裡聊的事

**估時**：1 hr + 遷移 0.5 hr

**🚨 紅線檢查**：遷移 script 不刪、只標、可回滾

---

### Task 2.3 · 統一 session state Redis key

**動點**：
- voice-stream:190 從 `session:${convId}` 改為 `session:${characterId}:${userId}`
- voice-stream:735 同步改

**驗收**：dialogue 寫的 session state，voice-stream 讀得到

**估時**：0.25 hr

---

### Task 2.4 · voice-stream 加 userProfile + episodicBlock 預塞

**動點**：voice-stream:165 的 systemPrompt 組裝

對齊 dialogue:1149-1308 的：
- userProfile 預塞（`【我認識這個人】`）
- episodicBlock（撈 50 條 platform_insights filter identity sources）

但要注意 token：
- voice 模式 prompt 已經偏長
- 預塞限：userProfile 全帶；episodicBlock 取前 10 條（不是 dialogue 的 50 條）

**驗收**：
- voice 第一輪角色「認識用戶」（不用工具就帶出名字、之前聊過的事）
- token 增量 < 1000

**估時**：1 hr

---

### Task 2.5 · 工具 registry 統一 + voiceCompatible flag

**新檔**：`src/lib/tools-registry.ts`

```ts
type ToolDef = Anthropic.Tool & {
  voiceCompatible: boolean;  // 是否可在 voice-stream 用
  description_haiku?: string; // haiku 用的輕量 description（可選）
};

export const TOOLS: ToolDef[] = [
  { name: 'query_knowledge_base', voiceCompatible: true, ... },
  { name: 'remember', voiceCompatible: true, ... },
  { name: 'commission_specialist', voiceCompatible: true, ... },
  { name: 'lookup_character', voiceCompatible: false, ... },  // 跨角色查詢，語音不該用
  ...
];
```

route 端：
```ts
const tools = TOOLS.filter(t => mode === 'voice' ? t.voiceCompatible : true);
```

**驗收**：新增工具只要寫一份；voice 模式不會收到不該有的工具

**估時**：2 hr

---

### Task 2.6 · 提煉 / 壓縮 / lastSession 寫入合一

**動點**：兩條 route 的 finalize 區段都改用 conversation-core helper（Task 2.1 立的）

**驗收**：
- 兩條 route 的「對話結束 async 區段」變成 < 30 行
- 提煉 prompt 改一處兩邊都生效

**估時**：1 hr

---

### Phase 2 commit 規劃

- `v0.2.4.020 — 重構：抽 conversation-core helper`
- `v0.2.4.021 — 重構：統一 conversation doc ID（含遷移 script）`
- `v0.2.4.022 — 修正：session state Redis key 兩端統一`
- `v0.2.4.023 — 新增：voice-stream 加 userProfile + episodic 預塞`
- `v0.2.4.024 — 重構：工具 registry 統一 + voiceCompatible flag`
- `v0.2.4.025 — 重構：finalize 區段改用 conversation-core`

---

## 紅線（兩 Phase 都守）

- ❌ 不刪生產資料（遷移用「複製 + 標記」不是「rename + 刪舊」）
- ❌ 不暴露密鑰
- ❌ 不跳過 `npm run build`
- ❌ 不動瞬（painter）的核心邏輯
- ❌ 不改謀謀靈魂
- ❌ 同一個 commit 不改超過一個維度（P1 commit A 已經教訓過：`git add -A` 帶進不該進的）
- ❌ 不在 Phase 1 跑穩前進 Phase 2
- ✅ 每個 Task 獨立 commit + deploy + 驗證
- ✅ Phase 1 完整跑 2-3 天再進 Phase 2
- ✅ 改完跑端到端：撥語音 + 文字交互測試

---

## 不做的事（捨）

- 不重構瞬本身的圖生成邏輯（瞬已穩定，動它風險高）
- 不改 dashboard 顯示介面（先讓 character-actions 資料長出來）
- 不做跨平台 push 通知（用「下次對話帶出」即可）
- 不做圖片版本管理 / 重畫流
- 不動 line-webhook 外部入口
- 不改既有對話歷史（messages 不重寫）
- 不在這個計劃裡碰「永久筆記 / user_event」（P3 推延）

---

## 起手順序

按 ID 順序，每完成一個：
1. 跑 build
2. 改本文件「Task XX」末加 ✅ 已完成
3. commit + deploy
4. （Phase 2）撥一通端到端驗證
5. 進下一個 Task

---

## 預估總工時

| 段 | 估時 |
|---|---|
| Phase 1（1.1-1.4） | 2-3 hr |
| 觀察期 | 2-3 天（Adam 試用） |
| Phase 2（2.1-2.6） | 1.5-2 天 |

**總**：約 2-2.5 個工作天（不含觀察）

---

## 一句話 WHY 收尾

> 角色不該在「文字宇宙」跟「語音宇宙」失憶。承諾不該綁著兌現。蓋一間房子，住活的人。
