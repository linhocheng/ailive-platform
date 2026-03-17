# 生圖模組開發文件
> 版本：v2.0 · 2026-03-17
> 作者：築
> 定位：可複用模組，一鍵 copy 帶走，不依賴任何 route handler

---

## 一、模組概覽

讓 AI 角色在對話中**自然地畫圖**，包括自拍。

核心能力：
- 角色說「畫一張側臉笑臉」→ 自動選最合適的 ref 照 → 生圖臉部一致
- 中文 prompt 自動翻英文（中文送 Gemini 臉容易跑）
- 無 ref 照時 fallback 純文字生圖
- tool description 動態注入 refs 清單，讓 Claude 知道有哪些角度可用

---

## 二、檔案清單

```
src/lib/generate-image.ts          ← 核心邏輯（這個 copy 走就夠）
src/lib/gemini-imagen.ts           ← Gemini multimodal 生圖底層
src/lib/image-storage.ts           ← Firebase Storage 上傳工具
src/lib/firebase-admin.ts          ← Firebase Admin SDK 初始化
src/app/api/image/upload/route.ts  ← 上傳 ref 照的 HTTP 入口
src/app/api/image/generate/route.ts ← 生圖的 HTTP 入口（很薄，import lib）
```

---

## 三、核心 lib：`generate-image.ts`

### 匯出的函式

#### `generateImageForCharacter(characterId, rawPrompt)`

主生圖函式。從 Firestore 讀角色資料，自動處理選圖、翻譯、生圖。

```typescript
import { generateImageForCharacter } from '@/lib/generate-image';

const result = await generateImageForCharacter(
  'se7K2jsx8P1ROVqE1Ppb',   // characterId
  '拍一張側臉微笑的照片'      // 支援中文，會自動翻英文
);

// result 回傳
// {
//   imageUrl: 'https://storage.googleapis.com/...',
//   model: 'gemini-2.5-flash-image',
//   selectedRef: 'https://...',    // 實際選到的 ref URL
//   usedAngle: 'side',             // 選到的角度
//   promptTranslated: true,        // 是否有翻譯
// }
```

#### `buildGenerateImageDescription(refs)`

動態組 `generate_image` tool 的 description，注入角色的 refs 清單。
在 dialogue route 組 tools 時呼叫。

```typescript
import { buildGenerateImageDescription } from '@/lib/generate-image';

const refs = char.visualIdentity?.refs || [];
const dynamicTools = PLATFORM_TOOLS.map(t =>
  t.name === 'generate_image'
    ? { ...t, description: buildGenerateImageDescription(refs) }
    : t
);
```

---

## 四、Firestore 資料結構

角色的視覺身份存在 `platform_characters/{characterId}.visualIdentity`：

```typescript
visualIdentity: {
  characterSheet: string;       // PRIMARY ref 圖 URL（必填，鎖臉用）
  imagePromptPrefix: string;    // 英文固定描述，每次生圖都帶（如 "A young woman with..."）
  styleGuide: string;           // realistic | anime | illustration
  negativePrompt: string;       // 負向提示（如 "different face, inconsistent features"）
  fixedElements: string[];      // 固定特徵列表
  referenceImages: string[];    // 所有 ref URL 列表
  refs: RefImage[];             // 結構化 ref 列表（含三維度）
}

interface RefImage {
  url: string;
  name: string;       // 人類可讀名稱（如 "半身_側臉_開心"）
  angle: string;      // front | side | 3/4 | back | dynamic | down | up
  framing: string;    // full | half | 7/10 | closeup
  expression: string; // happy | calm | angry | coquettish
}
```

---

## 五、選圖邏輯（三維度評分）

根據 prompt 關鍵字評分選最合適的 ref：

| 維度 | 分數 | 關鍵字範例 |
|------|------|-----------|
| angle | +3 | "side", "側臉", "3/4", "背影", "jumping" |
| framing | +2 | "full body", "全身", "半身", "close-up" |
| expression | +1 | "smile", "微笑", "生氣", "撒嬌" |

- 最高分的 ref 送進 Gemini multimodal
- 全 0 分 → fallback `characterSheet`（PRIMARY）

---

## 六、中文翻譯流程

```
角色說「拍側臉微笑」
  → 偵測到中文（/[\u4e00-\u9fff]/）
  → 呼叫 Claude Haiku 翻英文
  → "Side profile, smiling"
  → 送進 Gemini
```

翻譯失敗不阻斷生圖，fallback 用原始 prompt。
成本：Haiku 幾乎免費，~0.001 USD/次。

---

## 七、靈魂注入（鑄魂 prompt 必須包含）

讓角色知道自己有生圖能力，且**不需要特別說「包含我的臉」**：

```
### ⟁ 第六咒：我的成長方向
...
- 當對話中心裡浮現一個畫面，我能把它畫出來——不是意圖，是真的能做到
- 如果畫面裡有我自己，**不用特別說「包含我的臉」**——我的臉已在系統裡，會自動帶著
...
```

---

## 八、dialogue route 整合方式

```typescript
// 1. import
import { generateImageForCharacter, buildGenerateImageDescription } from '@/lib/generate-image';

// 2. 讀角色後，動態組 tools
const charRefs = char.visualIdentity?.refs || [];
const dynamicTools = PLATFORM_TOOLS.map(t =>
  t.name === 'generate_image'
    ? { ...t, description: buildGenerateImageDescription(charRefs) }
    : t
);

// 3. Claude API 呼叫用 dynamicTools
tools: [WEB_SEARCH_TOOL, ...dynamicTools],

// 4. executeTool 裡
if (toolName === 'generate_image') {
  const result = await generateImageForCharacter(characterId, toolInput.prompt as string);
  return `IMAGE_URL:${result.imageUrl}`;
}
```

---

## 九、chat 頁：解析圖片 URL

Claude 的回覆可能有兩種圖片格式，需同時解析：

```typescript
// 格式1: IMAGE_URL:https://...
const urlMatch1 = replyText.match(/IMAGE_URL:(https?:\/\/[^\s]+)/);
// 格式2: ![alt](https://...) markdown
const urlMatch2 = replyText.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
const imageUrl = urlMatch1?.[1] ?? urlMatch2?.[1];

// 清掉 URL，只留文字
const cleanText = replyText
  .replace(/IMAGE_URL:https?:\/\/[^\s]+/g, '')
  .replace(/!\[.*?\]\(https?:\/\/[^)]+\)/g, '')
  .trim();
```

---

## 十、上傳 ref 照 API

```bash
# POST /api/image/upload
# body: { base64, contentType, characterId, filename }
# 檔名解析角度：正面_全身_微笑.jpg → angle=front, framing=full, expression=happy

curl -X POST https://ailive-platform.vercel.app/api/image/upload \
  -H "Content-Type: application/json" \
  -d '{
    "base64": "...",
    "contentType": "image/jpeg",
    "characterId": "xxx",
    "filename": "正面_全身_微笑.jpg"
  }'
# → { "success": true, "url": "https://storage.googleapis.com/..." }
```

檔名命名規則：`[angle]_[framing]_[expression].[ext]`
- angle: 正面/側臉/背面/側45度/全身/跳躍
- framing: 全身/半身/7分身/特寫
- expression: 微笑/開心/生氣/撒嬌/穩定

---

## 十一、環境變數

| 變數 | 用途 | 格式注意 |
|------|------|---------|
| `GEMINI_API_KEY` | Gemini 生圖 | 從 `.env.local` 取時要 `tr -d '"'` 清引號 |
| `ANTHROPIC_API_KEY` | 中文翻譯（Haiku） | 同上 |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Storage 上傳 | JSON 字串，不帶引號 |
| `FIREBASE_STORAGE_BUCKET` | Storage bucket 名稱 | 如 `moumou-os.firebasestorage.app` |

---

## 十二、踩雷記錄

1. **Vercel server-to-server HTTP 禁忌**
   - dialogue 不能用 `fetch('/api/image/generate')` 呼叫自己
   - 解法：把邏輯抽成 lib，直接 import

2. **GEMINI_API_KEY 引號問題**
   - 從 `.env.local` 取值後必須 `tr -d '"'` 清掉引號再設進 Vercel
   - 帶引號的 key 送進 API 會 401

3. **中文 prompt 稀釋問題**
   - Gemini multimodal 對中文 prompt 理解較弱，臉容易跑
   - 解法：先用 Haiku 翻英文再送 Gemini

4. **`Buffer` vs `Uint8Array`**
   - Firebase Storage 上傳用 `new Uint8Array(buffer)`，不是 `buffer` 直接傳
   - TypeScript build error 或 runtime 靜默失敗

---

*文件維護者：築 · 每次修改 generate-image.ts 時同步更新此文件*
