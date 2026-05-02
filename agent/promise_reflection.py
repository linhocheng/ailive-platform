"""
Promise Reflection — session 結束時用 LLM 判斷哪些 unfulfilled actions 被兌現

對齊 src/lib/promise-reflection.ts:reflectAndMarkFulfilled。
紅線：
  - env PROMISE_REFLECTION_ENABLED=false 可全關
  - 失敗不阻斷（caller 應 catch）
  - 只標 confidence >= 4（防 hallucination）
"""
import json
import logging
import os
from datetime import datetime, timezone, timedelta

import firebase_admin
from firebase_admin import firestore

logger = logging.getLogger(__name__)

REFLECTION_MODEL = "claude-haiku-4-5-20251001"
MIN_CONFIDENCE = 4


def _enabled() -> bool:
    return os.environ.get("PROMISE_REFLECTION_ENABLED", "true").lower() != "false"


def _label(action_type: str) -> str:
    return {
        "promise": "我答應過",
        "question": "我問過",
        "event": "他/她的事",
        "note": "記得",
    }.get(action_type, "")


def _build_prompt(transcript: str, actions: list[dict]) -> str:
    lines = []
    for i, a in enumerate(actions, 1):
        label = _label(a.get("actionType") or "")
        body = a.get("title") or a.get("content") or ""
        prefix = f"（{label}）" if label else ""
        lines.append(f"{i}. [id={a['id']}] {prefix}{body}")
    return (
        "以下是一段對話記錄。你是一個誠實的紀錄員。\n\n"
        "【未兌現的承諾/問題/記得清單】\n"
        + "\n".join(lines)
        + "\n\n【對話記錄】\n"
        + transcript
        + "\n\n"
        "請判斷對話中是否兌現了清單中的條目（也就是角色實際聊了那個主題、回應了那個問題、提到了那個記得的事）。\n\n"
        "回 JSON 陣列，**每條清單項目都要評估**（不能漏、不能多）：\n"
        '[{"actionId":"<id>","fulfilled":true|false,"confidence":1-5}]\n\n'
        "confidence 標準：\n"
        "- 5 = 確定（對話明確處理了該條）\n"
        "- 4 = 高度可能\n"
        "- 3 = 模糊\n"
        "- 2 = 不太像\n"
        "- 1 = 完全沒提\n\n"
        "只回 JSON 陣列，不要其他文字、不要 code fence。"
    )


def _parse_verdicts(raw: str) -> list[dict]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        # 容忍 code fence
        cleaned = cleaned.split("```")[1] if "```" in cleaned[3:] else cleaned[3:]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip().rstrip("```").strip()
    try:
        arr = json.loads(cleaned)
        if not isinstance(arr, list):
            return []
        return [
            v for v in arr
            if isinstance(v, dict)
            and isinstance(v.get("actionId"), str)
            and isinstance(v.get("fulfilled"), bool)
            and isinstance(v.get("confidence"), (int, float))
        ]
    except Exception:
        return []


def _ensure_init():
    if not firebase_admin._apps:
        from agent.firestore_loader import _ensure_init as _init
        _init()


def _load_unfulfilled_actions(
    character_id: str,
    user_id: str,
    days: int = 7,
    limit: int = 20,
) -> list[dict]:
    """撈該 (角色, 用戶) 的 unfulfilled + relevant actions

    對齊 character-actions.ts:getRecentUserActions（不帶 isRelevant 視為 True）
    """
    _ensure_init()
    db = firestore.client()
    q = (
        db.collection("platform_insights")
        .where("characterId", "==", character_id)
        .where("userId", "==", user_id)
        .where("fulfilled", "==", False)
        .limit(max(limit * 3, 30))
    )
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    items = []
    for d in q.get():
        data = d.to_dict() or {}
        if data.get("isRelevant") is False:
            continue
        created = data.get("createdAt") or ""
        if not created:
            continue
        try:
            created_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            if created_dt < cutoff:
                continue
        except Exception:
            continue
        items.append({
            "id": d.id,
            "actionType": data.get("actionType") or "general",
            "title": str(data.get("title") or ""),
            "content": str(data.get("content") or ""),
            "createdAt": created,
        })
    items.sort(key=lambda a: a.get("createdAt") or "", reverse=True)
    return items[:limit]


def reflect_and_mark_fulfilled(
    character_id: str,
    user_id: str,
    transcript: str,
    anthropic_api_key: str,
) -> dict:
    """執行 reflection 並回傳統計

    Returns: {enabled, checked, marked, skipped, errors}
    """
    stats = {"enabled": _enabled(), "checked": 0, "marked": 0, "skipped": 0, "errors": 0}
    if not stats["enabled"]:
        return stats
    if not transcript or len(transcript) < 50:
        return stats
    if not anthropic_api_key:
        return stats

    actions = _load_unfulfilled_actions(character_id, user_id)
    stats["checked"] = len(actions)
    if not actions:
        return stats

    try:
        import anthropic as anthropic_sdk
        client = anthropic_sdk.Anthropic(api_key=anthropic_api_key)
        resp = client.messages.create(
            model=REFLECTION_MODEL,
            max_tokens=600,
            messages=[{"role": "user", "content": _build_prompt(transcript, actions)}],
        )
        raw = resp.content[0].text or ""
        verdicts = _parse_verdicts(raw)
    except Exception as e:
        stats["errors"] += 1
        logger.warning(f"promise-reflection LLM failed: {e}")
        return stats

    valid_ids = {a["id"] for a in actions}
    db = firestore.client()
    for v in verdicts:
        action_id = v.get("actionId")
        if action_id not in valid_ids:
            stats["skipped"] += 1
            continue
        if not v.get("fulfilled"):
            stats["skipped"] += 1
            continue
        if v.get("confidence", 0) < MIN_CONFIDENCE:
            stats["skipped"] += 1
            continue
        try:
            db.collection("platform_insights").document(action_id).update({
                "fulfilled": True,
                "fulfilledAt": datetime.now(timezone.utc).isoformat(),
                "fulfilledBy": "auto-haiku",
            })
            stats["marked"] += 1
        except Exception as e:
            stats["errors"] += 1
            logger.warning(f"markActionFulfilled {action_id} failed: {e}")
    return stats
