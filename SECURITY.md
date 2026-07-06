# ailive-platform 安全防線地圖

> 給未來在這個 repo 工作的築。動 API/auth 前先讀這份，知道防線在哪、哪些是刻意留開的。
> 最後更新：2026-07-06（築，Vercel 安全加固 commit 8b8bc72）

## Auth 模型
- `src/middleware.ts`：只 gate 非 /api 頁面（比對 `AILIVE_PASSWORD` → `ailive-auth` cookie）。**`/api/` 在白名單裡＝middleware 不擋，保護在各路由自己做。**
- 守門 helper（`src/lib/char-access.ts`）：
  - `hasOperatorAccess(req)`：後台密碼 cookie。`AILIVE_PASSWORD` 未設 → 全放行（跟 middleware 一致）。
  - `assertCharAccess(req, id)`：operator 或該角色 `cli_<id>` cookie；角色沒設 clientPassword → 開放（「選一」政策）。
- `src/lib/rate-limit.ts`：`checkRateLimit(req, bucket, limit, windowSec)`，Upstash INCR+EXPIRE，fail-open。

## 已上鎖（2026-07-06）
| 類型 | 路由 | 機制 |
|---|---|---|
| operator-only（純後台，client 不呼叫） | soul-enhance、user-observations(PII)、longform、strategist-guide、debug-kb、cache-clear、design-x/generate | `hasOperatorAccess` |
| worker-secret（內部 fetch） | strategist-review（task-run 打它，帶 `x-worker-secret`） | `WORKER_SECRET` |
| IP 限流（合法匿名的付費路由） | dialogue 40/分、voice-stream 40/分、tts 60/分、stt 30/分 | `checkRateLimit` |
| cron | runner、sync-services | `CRON_SECRET`（已設 prod） |

## 刻意留開 / 已知殘留（未鎖，動之前想清楚）
- **client 授權路由**（/client 頁在用）：characters、knowledge、tasks、posts、images 等——走 `assertCharAccess` 但「沒設密碼＝開放」，多數角色沒設 clientPassword ＝實際仍開。要真鎖得先幫角色設 clientPassword。
- **IDOR 讀取尚未修**：`GET /api/conversations`、`insights`、`knowledge`、`characters`、`user-observations`(已鎖) 以外的讀取端點，仍可匿名帶任意 characterId 跨租戶讀。這次只鎖了 user-observations(PII 最敏感)，其餘讀取端點是**下一輪工作**。
- CLAUDE.md 的語音路由段落過時（寫逐版分支，實際是 DEFAULT_VOICE_VERSION 常數制）。

## 相關 env（值不在 git）
`AILIVE_PASSWORD`、`WORKER_SECRET`、`CRON_SECRET`（2026-07-06 新設）、`UPSTASH_REDIS_REST_URL/TOKEN`（限流用）。

## 怎麼驗
```
B=https://ailive-platform.vercel.app
curl -s -o /dev/null -w '%{http_code}\n' "$B/api/user-observations?characterId=x&userId=y"   # 期望 401
curl -s -o /dev/null -w '%{http_code}\n' "$B/api/characters"                                    # 期望 200（未鎖）
# 限流：連打 >60 次 POST /api/tts 空 body，第 61 起應 429
```
