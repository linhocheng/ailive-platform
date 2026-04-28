"""
Firestore loader — 從 ailive-platform 既有 schema 讀角色 soul + 對話歷史 + 角色承諾

讀法照抄 voice-stream/route.ts 的優先序，避免「真相分裂」。

- platform_characters.{characterId}: aiName / system_soul / soul_core / enhancedSoul / soul
- platform_conversations.{convId}:    summary / messages（last 10）/ updatedAt
- platform_insights:                  characterId × userId 的 actions（promise/question/event/note）
"""
import json
import logging
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta

import firebase_admin
from firebase_admin import credentials, firestore

logger = logging.getLogger(__name__)

_initialized = False


def _ensure_init():
    """初始化 firebase-admin（idempotent，多次呼叫只 init 一次）"""
    global _initialized
    if _initialized:
        return
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "")
    if not sa_json:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON missing")
    sa_dict = json.loads(sa_json)
    cred = credentials.Certificate(sa_dict)
    firebase_admin.initialize_app(cred, {"projectId": sa_dict["project_id"]})
    _initialized = True
    logger.info(f"firebase-admin initialized for project {sa_dict['project_id']}")


@dataclass
class CharacterContext:
    character_id: str
    name: str
    soul_text: str
    voice_id_minimax: str  # 給 Phase 4.x 動態切 voice 用
    tts_settings_minimax: dict  # speed/pitch


@dataclass
class ConversationContext:
    conv_id: str
    summary: str
    messages: list  # last 10, [{role, content}]
    last_updated_ms: int = 0  # ms epoch；0 = 沒更新過或新 conv
    message_count: int = 0
    last_session: dict | None = None  # {summary, endingMood, unfinishedThreads, updatedAt}


@dataclass
class ActionEntry:
    action_type: str  # promise/question/event/note/general
    title: str
    content: str
    created_at: str  # ISO
    fulfilled: bool = False


# ────────────────────────────────────────────────────────────────────
# 時間感知（對齊 src/lib/time-awareness.ts）
# 閾值 10 分鐘 + 4 檔位（分/小時/天/週），統一用 round（不 floor）
# ────────────────────────────────────────────────────────────────────
NEW_VISIT_THRESHOLD_MS = 10 * 60 * 1000


def format_gap(ms: int) -> str:
    minutes = ms / 60000
    if minutes < 60:
        return f"約 {round(minutes)} 分鐘"
    if minutes < 1440:
        return f"約 {round(minutes / 60)} 小時"
    if minutes < 10080:
        return f"約 {round(minutes / 1440)} 天"
    return f"約 {round(minutes / 10080)} 週"


def should_inject_gap(last_updated_ms: int, message_count: int) -> tuple[bool, str]:
    if message_count <= 0 or last_updated_ms <= 0:
        return (False, "")
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    gap_ms = now_ms - last_updated_ms
    if gap_ms <= NEW_VISIT_THRESHOLD_MS:
        return (False, "")
    return (True, format_gap(gap_ms))


def load_character(character_id: str) -> CharacterContext:
    """讀 platform_characters doc，組角色 context

    soul 優先序對齊 voice-stream/route.ts:150：
      system_soul > soul_core > enhancedSoul > soul
    """
    _ensure_init()
    db = firestore.client()
    doc = db.collection("platform_characters").document(character_id).get()
    if not doc.exists:
        raise ValueError(f"character {character_id} not found")
    d = doc.to_dict() or {}

    soul_text = (
        d.get("system_soul")
        or d.get("soul_core")
        or d.get("enhancedSoul")
        or d.get("soul")
        or ""
    )
    tts_settings = (d.get("ttsSettings") or {}).get("minimax") or {}
    return CharacterContext(
        character_id=character_id,
        name=d.get("name") or character_id,
        soul_text=soul_text,
        voice_id_minimax=d.get("voiceIdMinimax") or "",
        tts_settings_minimax=tts_settings,
    )


def load_conversation(conv_id: str) -> ConversationContext:
    """讀 platform_conversations doc，回傳 summary + last 10 messages + updatedAt

    沒有 conv 也回空殼，不 raise（新通話就是新 conv）。
    """
    _ensure_init()
    db = firestore.client()
    doc = db.collection("platform_conversations").document(conv_id).get()
    if not doc.exists:
        return ConversationContext(conv_id=conv_id, summary="", messages=[])
    d = doc.to_dict() or {}
    msgs = d.get("messages") or []

    # 解析 updatedAt（既有 conv 可能存 ISO string 或 firestore Timestamp）
    last_ms = 0
    raw = d.get("updatedAt")
    if raw:
        try:
            if isinstance(raw, str):
                # ISO string，譬如 voice-stream 寫的
                last_ms = int(datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp() * 1000)
            elif hasattr(raw, "timestamp"):
                # firestore SERVER_TIMESTAMP 解出來是 datetime
                last_ms = int(raw.timestamp() * 1000)
        except Exception as e:
            logger.warning(f"updatedAt parse failed: {e}")

    return ConversationContext(
        conv_id=conv_id,
        summary=d.get("summary") or "",
        messages=msgs[-10:],
        last_updated_ms=last_ms,
        message_count=int(d.get("messageCount") or 0),
        last_session=d.get("lastSession") or None,
    )


def load_recent_actions(
    character_id: str,
    user_id: str,
    days: int = 7,
    limit: int = 5,
    unfulfilled_only: bool = True,
) -> list:
    """讀 platform_insights 該 (角色, 用戶) 對的近期 actions

    對齊 ailive src/lib/character-actions.ts:getRecentUserActions
    - 不用 orderBy 避免要組合索引；client 端依 createdAt 排序
    - 預設只撈 unfulfilled（promise/question 還沒兌現的更該帶進 prompt）
    """
    _ensure_init()
    db = firestore.client()
    q = (
        db.collection("platform_insights")
        .where("characterId", "==", character_id)
        .where("userId", "==", user_id)
    )
    if unfulfilled_only:
        q = q.where("fulfilled", "==", False)
    snap = q.limit(max(limit * 3, 30)).get()

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    items = []
    for d in snap:
        data = d.to_dict() or {}
        created = data.get("createdAt") or ""
        if not created:
            continue
        try:
            created_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            if created_dt < cutoff:
                continue
        except Exception:
            continue
        items.append(ActionEntry(
            action_type=data.get("actionType") or "general",
            title=str(data.get("title") or ""),
            content=str(data.get("content") or ""),
            created_at=str(created),
            fulfilled=bool(data.get("fulfilled")),
        ))
    items.sort(key=lambda a: a.created_at, reverse=True)
    return items[:limit]


def extract_session_summary(
    transcript: list,
    anthropic_api_key: str,
) -> dict | None:
    """從本次通話 transcript 萃取 lastSession（給下次撥號開場用）

    對齊 src/lib/session-summary.ts:extractSessionSummary 的 prompt + 結構。
    回傳 None 代表對話太短或解析失敗（caller 應靜默跳過）。
    """
    if not transcript or len(transcript) < 4:
        return None
    text_parts = []
    for m in transcript:
        role = "用戶" if m.get("role") == "user" else "角色"
        content = (m.get("content") or "")[:300]
        line = f"{role}：{content}"
        if len(line) > 5:
            text_parts.append(line)
    text = "\n".join(text_parts)
    if len(text) > 6000:
        text = text[-6000:]  # 取尾段，最近的對話最重要
    if len(text) < 30:
        return None

    try:
        import anthropic as anthropic_sdk
        client = anthropic_sdk.Anthropic(api_key=anthropic_api_key)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=350,
            messages=[{
                "role": "user",
                "content": (
                    "以下是一段對話記錄。請產出一個 JSON 物件，給「下次對話」開場用的快照。\n\n"
                    "欄位：\n"
                    "- summary: 一句話白描這段對話聊了什麼主題（≤40 字，繁體中文）\n"
                    "- endingMood: positive / neutral / concerned / unfinished 四選一（看對話走向判斷氣氛）\n"
                    "- unfinishedThreads: 角色提到但沒講完、或用戶問了但沒解決的話題（字串陣列，可空）\n\n"
                    "回傳格式（只回 JSON，不要其他文字、不要 code fence）：\n"
                    "{\"summary\":\"...\",\"endingMood\":\"neutral\",\"unfinishedThreads\":[]}\n\n"
                    f"對話：\n{text}"
                ),
            }],
        )
        raw = resp.content[0].text.strip()
        # 容忍 code fence
        if raw.startswith("```"):
            raw = raw.split("```")[1] if "```" in raw[3:] else raw
            if raw.startswith("json\n"):
                raw = raw[5:]
            raw = raw.strip()
        parsed = json.loads(raw)
        if not parsed.get("summary"):
            return None
        return {
            "summary": str(parsed["summary"])[:80],
            "endingMood": parsed.get("endingMood") or "neutral",
            "unfinishedThreads": [
                str(t) for t in (parsed.get("unfinishedThreads") or [])
                if t
            ][:5],
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.warning(f"extract_session_summary failed: {e}")
        return None


def save_conversation(
    conv_id: str,
    character_id: str,
    user_id: str,
    new_messages: list,  # [{role: 'user'|'assistant', content: str, timestamp?: str}]
    anthropic_api_key: str = "",
    last_session: dict | None = None,  # P1: 通話結束抽出的 lastSession 快照
) -> dict:
    """通話結束時 append 新訊息到 conv doc，順手壓縮 summary

    對齊 voice-stream/route.ts:758-790 的邏輯：
    - merge 新 messages 到既有 messages
    - 超過 10 條時把「最前面 N-10 條」壓縮進 summary（用 Anthropic Haiku）
    - 保留 last 10 條原文

    Returns: stats dict（用於 log）
    """
    _ensure_init()
    db = firestore.client()
    ref = db.collection("platform_conversations").document(conv_id)
    doc = ref.get()
    existing = doc.to_dict() or {} if doc.exists else {}

    existing_messages = existing.get("messages") or []
    existing_summary = existing.get("summary") or ""
    existing_count = int(existing.get("messageCount") or 0)

    # append + 計數
    merged_messages = existing_messages + new_messages
    new_count = existing_count + len(new_messages)

    # summary 壓縮（>10 條時把舊的壓進 summary）
    new_summary = existing_summary
    if len(merged_messages) > 10 and anthropic_api_key:
        older = merged_messages[: len(merged_messages) - 10]
        if len(older) >= 4:  # 對齊 voice-stream:760
            try:
                compress_text = "\n".join(
                    f"{'用戶' if m.get('role') == 'user' else '角色'}：{(m.get('content') or '')[:100]}"
                    for m in older
                )
                import anthropic as anthropic_sdk
                client = anthropic_sdk.Anthropic(api_key=anthropic_api_key)
                resp = client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=400,
                    messages=[{
                        "role": "user",
                        "content": (
                            "以下是對話的早期段落，請壓縮成摘要。\n\n"
                            "務必保留（漏寫即失憶）：\n"
                            "- 用戶說過的具體事（人事時地物、數字、名稱、地點）\n"
                            "- 用戶的處境與情緒（最近發生什麼、現在感覺怎樣）\n"
                            "- 角色（你）做過的承諾、答應的事、約定的時間\n"
                            "- 角色（你）問過但用戶還沒回答的問題\n"
                            "- 未完成、待續的話題\n\n"
                            "抽象的「兩人聊了商業策略」這種無細節句子算失敗。\n"
                            "直接輸出摘要本體，不要標題、不要編號。\n\n"
                            f"{compress_text}"
                        ),
                    }],
                )
                fresh = resp.content[0].text.strip()
                merged = (existing_summary + "\n" + fresh) if existing_summary else fresh
                new_summary = merged[-800:]  # 對齊 voice-stream:788
                logger.info(f"summary compressed: {len(older)} msgs → {len(fresh)} chars")
            except Exception as e:
                logger.error(f"summary compression failed: {e}")
        # 保留 last 10
        merged_messages = merged_messages[-10:]

    # 寫回（merge=True 不覆蓋其他欄位）
    payload = {
        "characterId": character_id,
        "userId": user_id or "anon",
        "messages": merged_messages,
        "messageCount": new_count,
        "summary": new_summary,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    if last_session:
        payload["lastSession"] = last_session
    ref.set(payload, merge=True)

    return {
        "appended": len(new_messages),
        "total_messages": len(merged_messages),
        "summary_chars": len(new_summary),
        "messageCount": new_count,
        "last_session_saved": bool(last_session),
    }


_MOOD_LABEL = {
    "positive": "聊得愉快",
    "concerned": "對方心情不太好",
    "unfinished": "意猶未盡",
    # neutral 不顯示，避免雜訊
}


def build_last_session_block(last_session: dict | None) -> str:
    """對齊 src/lib/last-session-block.ts:buildLastSessionBlock"""
    if not last_session or not last_session.get("summary"):
        return ""
    parts = [f"\n\n---\n【上次對話】{last_session['summary']}"]
    mood = last_session.get("endingMood")
    if mood and mood in _MOOD_LABEL:
        parts.append(f"氣氛：{_MOOD_LABEL[mood]}")
    threads = last_session.get("unfinishedThreads") or []
    if isinstance(threads, list) and threads:
        parts.append(f"未完話題：{'、'.join(threads[:2])}")
    parts.append(
        "（可以自然帶出延續上次，也可以完全不提，看情境與對方開場。"
        "不要硬套、不要報告式複述。）"
    )
    return "\n".join(parts)


_ACTION_LABEL = {
    "promise": "我答應過",
    "question": "我問過（用戶還沒回）",
    "event": "他/她的事",
    "note": "記住",
    "general": "我說過",
}


def format_action_block(actions: list) -> str:
    """把 actions 組成 prompt 段落（對齊 voice-stream/dialogue 的注入格式）"""
    if not actions:
        return ""
    lines = []
    today = datetime.now(timezone.utc).date()
    for a in actions:
        # 日期遠近
        try:
            ad = datetime.fromisoformat(a.created_at.replace("Z", "+00:00")).date()
            days_ago = (today - ad).days
            if days_ago == 0:
                date_str = "今天"
            elif days_ago == 1:
                date_str = "昨天"
            elif days_ago == 2:
                date_str = "前天"
            else:
                date_str = f"{days_ago} 天前"
        except Exception:
            date_str = ""
        label = _ACTION_LABEL.get(a.action_type, "")
        title = a.title or a.content[:50]
        prefix = f"- {date_str}（{label}）" if label else f"- {date_str}"
        lines.append(f"{prefix}：{title}")
    return "\n".join(lines)


def build_system_prompt(
    char: CharacterContext,
    conv: ConversationContext,
    actions: list | None = None,
) -> str:
    """組 agent 用的 system prompt — 對齊 voice-stream voiceStableBlock 結構

    結構：
    - 角色 soul
    - 語音對話天條 + STT 容錯 + 記憶系統說明
    - 當前時間（台北）+ 時間遠近指引
    - 時間感知 gap（距離上次對話多久）
    - 角色承諾（platform_insights 近 7 天 unfulfilled actions）
    - 對話摘要（更早對話精華）
    - 最近 N 條對話（接續脈絡）
    """
    parts = [char.soul_text]

    parts.append("""
【語音對話天條】
你現在是即時語音通話，正在跟用戶撥號中。說話要像真人對話，不是寫文章。
- 說人話，像朋友在聊天，不要條列式、不要 Markdown 符號
- 一次說一個完整的想法，可以延伸，但不要長篇大論
- 說完自然問一個問題讓對話有來有往
- 用簡體中文回覆（TTS 發音穩定）
- 不要說「（思考）」「（停頓）」這類括號 stage directions
- 數字用中文念法(例如「三百五」不是「350」)

【記憶系統 — 重要】
你有「跨次對話的持續記憶」。系統會把歷次對話寫進 Firestore 並做 summary 壓縮。
- 每次撥號開始時，下方會帶「對話摘要」+「最近對話」段落讓你接續
- 你應該假裝這些是你「記得」的事，不是系統幫你提詞
- 禁止說「我每次對話都是新的開始」「我沒有長期記憶」「我不記得之前」這類話
- 用戶的名字、講過的具體事、你做過的承諾，都應該主動帶進對話展現連續性

【STT 容錯】
✅ 根據上下文猜用戶意圖，就算聽起來不通順也要猜
✅ 用自然方式回應，當作你完全聽懂了
❌ 不要說「我沒聽清楚」「請再說一次」「你說的 XXX 是什麼意思」""")

    # 當前時間（台北 GMT+8）+ 時間遠近指引（對齊江彬 context_builder:38-43）
    tw_tz = timezone(timedelta(hours=8))
    now = datetime.now(tw_tz)
    weekday_names = ['一', '二', '三', '四', '五', '六', '日']
    time_str = now.strftime(f"%Y年%m月%d日 星期{weekday_names[now.weekday()]} %H:%M")
    parts.append(
        f"\n【當前時間】{time_str}\n"
        "請依對話紀錄的時間戳判斷遠近：同一天內用「剛才」「剛剛」，"
        "昨天的用「昨天」，超過兩天才用「前幾天」「上次」。"
        "絕對不要把幾分鐘前的事說成「上次」「之前」。"
    )

    # 時間感知 gap（對齊 voice-stream:174-182）
    gap_inject, gap_text = should_inject_gap(conv.last_updated_ms, conv.message_count)
    if gap_inject:
        parts.append(
            f"\n【時間感知】距離上次跟用戶對話過了 {gap_text}。\n"
            "可以自然帶出，也可以什麼都不說，看情境決定。"
        )

    # 角色承諾（platform_insights 近 7 天 unfulfilled）
    action_block = format_action_block(actions or [])
    if action_block:
        parts.append(
            f"\n【我對這位用戶說過的話 / 答應過的事（還沒兌現的優先帶進來）】\n{action_block}"
        )

    # P1：上次對話快照（Smart Greeting）
    last_session_block = build_last_session_block(conv.last_session)
    if last_session_block:
        parts.append(last_session_block)

    # 把記憶接進 prompt：summary（更早壓縮過的）+ recent messages（最近原文）
    # 對齊 voice-stream/route.ts 既有行為，跨次撥號接續
    # 紅線：messages < 10 時 summary 永遠空，這時 recent block 是唯一記憶來源
    if conv.summary:
        parts.append(f"\n【對話摘要（更早對話的精華）】\n{conv.summary}")

    if conv.messages:
        lines = []
        for m in conv.messages:
            role = m.get("role", "")
            content = (m.get("content") or "")[:400]
            if not content.strip():
                continue
            speaker = "用戶" if role == "user" else "你"
            lines.append(f"{speaker}：{content}")
        if lines:
            history_block = "\n".join(lines)
            parts.append(
                f"\n【最近 {len(lines)} 條對話（接續這個脈絡，不要重述）】\n{history_block}"
            )

    return "\n".join(parts)
