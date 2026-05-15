# AILIVE 客戶端入口 — UI 介面對接文件

> 寫給：新 UI/UX 設計對接用
> 現場日期：2026-05-15
> 負責人：築

---

## 一、三層入口架構

```
後台管理員（identity 頁面）
    ↓ 設定密碼 + 通路
客戶端儀表板（/client/{characterId}）
    ↓ 貼文審核 + 排程 + 知識庫 + 聊天
即時語音（/realtime/{characterId}）
```

---

## 二、入口 URL

| 入口 | URL 格式 | 說明 |
|---|---|---|
| 客戶端儀表板 | `/client/{characterId}` | 貼文/排程/知識/聊天五合一 |
| 即時語音 | `/realtime/{characterId}` | LiveKit 語音通話 |
| 語音入口 | `/voice/{characterId}` | 語音聊天（voice-stream SSE） |

---

## 三、客戶端密碼機制（目前）

- 密碼存在 Firestore `platform_characters.clientPassword`
- 進 `/client/{id}` 時前端讀取密碼 → `window.__checkPassword()` 驗證
- 驗通後存 `sessionStorage: client_unlocked_{charId}=1`
- **缺點**：純前端驗證，密碼在 client-side 暴露

> ⚠️ 新 UI 如需更嚴格的安全性，應改為後端驗證 + httpOnly cookie（參考 `/api/auth/login` 模式）

---

## 四、API 介面清單

### 4.1 文字對話

```
POST /api/dialogue
Content-Type: application/json
```

**Request Body：**
```json
{
  "characterId": "kTwsX44G0ImsApEACDuE",   // 必填
  "message": "用戶輸入的文字",               // 必填
  "userId": "user123",                       // 選填，沒帶預設 anon
  "conversationId": "voice-xxx-user123"      // 選填，沒帶自動生成
}
```

**Response：**
```json
{
  "reply": "角色回覆的文字",
  "conversationId": "voice-kTwsX44G...-anon",
  "usage": { "input_tokens": 1200, "output_tokens": 85 }
}
```

---

### 4.2 語音串流（SSE）

```
POST /api/voice-stream
Content-Type: application/json
Accept: text/event-stream
```

**Request Body：**（同 dialogue）

**Response 格式（SSE events）：**
```
data: {"type":"text","content":"這是第一句話","index":0}
data: {"type":"audio","chunk":"base64==","index":0}
data: {"type":"text","content":"這是第二句話","index":1}
data: {"type":"audio","chunk":"base64==","index":1}
data: {"type":"done","fullText":"完整回覆","conversationId":"xxx"}
data: {"type":"ping"}
data: {"type":"error","message":"錯誤訊息"}
```

> **音訊格式**：base64 encoded MP3（ElevenLabs）或 hex（MiniMax）
> **句子切割門檻**：首句 3 字、後續句 15 字

---

### 4.3 LiveKit 語音通話 Token

```
POST /api/livekit/token
Content-Type: application/json
```

**Request Body：**
```json
{
  "characterId": "kTwsX44G0ImsApEACDuE",   // 必填
  "userId": "user123",                       // 選填
  "convId": "voice-xxx-user123"              // 選填
}
```

**Response：**
```json
{
  "token": "eyJ...",                          // LiveKit JWT
  "url": "wss://ailive-nfobc27q.livekit.cloud",
  "roomName": "realtime-{charId}-{userId}-{ts}",
  "identity": "user123"
}
```

---

### 4.4 對話記錄

```
GET /api/conversations?characterId={id}
```

**Response：**
```json
{
  "conversations": [
    {
      "id": "voice-xxx-anon",
      "characterId": "xxx",
      "userId": "anon",
      "messageCount": 12,
      "lastMessage": "再見",
      "lastRole": "assistant",
      "updatedAt": "2026-05-15T..."
    }
  ],
  "total": 3
}
```

---

### 4.5 角色資料

```
GET /api/characters/{characterId}
```

**Response 關鍵欄位：**
```json
{
  "id": "kTwsX44G0ImsApEACDuE",
  "name": "奧",
  "mission": "角色使命描述",
  "ttsProvider": "minimax",
  "voiceId": "ElevenLabs voice ID",
  "voiceIdMinimax": "MiniMax voice ID",
  "clientPassword": "xxx 或 null",
  "visualIdentity": {
    "characterSheet": "角色描述",
    "fixedElements": ["特徵1", "特徵2"]
  }
}
```

---

### 4.6 貼文（posts）

```
GET  /api/posts?characterId={id}&status=draft    // 列出草稿
POST /api/posts/{postId}/approve                 // 核准
POST /api/posts/{postId}/reject                  // 拒絕
PATCH /api/posts/{postId}                        // 編輯文案/圖片描述
POST /api/posts/regenerate-image                 // 重新生圖
```

**regenerate-image Request：**
```json
{
  "postId": "xxx",
  "imagePrompt": "新的圖片描述（選填）"
}
```

---

### 4.7 排程任務

```
GET    /api/tasks?characterId={id}   // 列出任務
POST   /api/tasks                    // 新增任務
PATCH  /api/tasks/{taskId}           // 編輯/啟停
DELETE /api/tasks/{taskId}           // 刪除
```

**Task 資料結構：**
```json
{
  "id": "xxx",
  "characterId": "xxx",
  "type": "post",
  "description": "任務描述",
  "intent": "任務意義",
  "run_hour": 9,
  "run_minute": 0,
  "days": ["mon", "tue", "wed", "thu", "fri"],
  "enabled": true
}
```

---

## 五、Firestore Collections（前端需知）

| Collection | 用途 | 主要欄位 |
|---|---|---|
| `platform_characters` | 角色設定 | name, mission, soul, ttsProvider, voiceId, clientPassword |
| `platform_conversations` | 對話記錄 | messages[], summary, lastSession |
| `platform_posts` | 貼文草稿 | content, imageUrl, status, scheduledAt |
| `platform_tasks` | 排程任務 | type, run_hour, days, enabled |
| `platform_insights` | 角色記憶 | content, tier, hitCount |

---

## 六、現況痛點（新 UI 設計時要注意）

### 1. 密碼機制是前端驗證
- 目前：密碼在 JS 裡驗證（`window.__checkPassword`）
- 建議：新 UI 如要跨設備，改用 `/api/auth/login` 模式（server-side cookie）

### 2. 沒有 userId 機制
- 目前：客戶端使用者 userId 是 `anon`，沒有區分不同使用者
- 影響：多人使用同一客戶端入口時，對話記錄混在一起
- 建議：新 UI 可以讓使用者輸入名字作為 userId（不需帳號系統）

### 3. 語音入口沒有集成在儀表板
- 目前：realtime 語音是獨立 URL，沒有在 client 頁面的 tab 裡
- 建議：新 UI 可以加一個「通話」tab，讓使用者不需另外記 URL

### 4. 對話沒有跨 session 延續
- 目前：`conversationId` 如果沒傳，每次進頁面都是新對話
- 建議：新 UI 把 `conversationId` 存 localStorage，讓角色記得上次聊到哪

### 5. 五個 tab 一次全露
- 目前：所有功能對所有客戶端使用者都顯示
- 建議：可依業務場景選擇顯示哪些 tab（例如純聊天版只顯示聊天）

---

## 七、新 UI 對接 checklist

- [ ] 確認哪些入口需要保護（clientPassword vs 無密碼）
- [ ] 確認要顯示哪些 tab / 功能
- [ ] userId 策略（anon / localStorage 暱稱 / 正式帳號）
- [ ] conversationId 持久化策略（localStorage）
- [ ] 語音模式選擇（voice-stream SSE 或 LiveKit realtime）
- [ ] 音訊播放實作（base64 → AudioBuffer 解碼）
- [ ] 貼文審核流程（approve/reject 後刷新列表）

---

*由築整理，2026-05-15*
