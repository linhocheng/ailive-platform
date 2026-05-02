"""
User Observations (Python) — 對齊 src/lib/user-observations.ts

collection: platform_user_observations/{characterId}_{userId}
角色主觀觀察（per-pair，不跨角色共享）
"""
import logging
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import firestore

logger = logging.getLogger(__name__)

COLLECTION = "platform_user_observations"


def _ensure_init():
    if not firebase_admin._apps:
        from agent.firestore_loader import _ensure_init as _init
        _init()


def _doc_id(character_id: str, user_id: str) -> str:
    return f"{character_id}_{user_id}"


def load_user_observations(character_id: str, user_id: str) -> dict | None:
    if not character_id or not user_id:
        return None
    _ensure_init()
    db = firestore.client()
    doc = db.collection(COLLECTION).document(_doc_id(character_id, user_id)).get()
    if not doc.exists:
        return None
    d = doc.to_dict() or {}
    return {
        "characterId": character_id,
        "userId": user_id,
        "personality": d.get("personality"),
        "preferences": d.get("preferences") or [],
        "inferredInterests": d.get("inferredInterests") or [],
        "notes": d.get("notes"),
        "createdAt": d.get("createdAt"),
        "updatedAt": d.get("updatedAt"),
    }


def upsert_user_observations(character_id: str, user_id: str, partial: dict) -> None:
    if not character_id or not user_id:
        raise ValueError("upsert_user_observations: ids required")
    _ensure_init()
    db = firestore.client()
    ref = db.collection(COLLECTION).document(_doc_id(character_id, user_id))
    now = datetime.now(timezone.utc).isoformat()
    payload: dict = {"characterId": character_id, "userId": user_id, "updatedAt": now}
    for k, v in partial.items():
        if v is not None:
            payload[k] = v
    existing = ref.get()
    if not existing.exists:
        payload["createdAt"] = now
    ref.set(payload, merge=True)


def format_observations_block(obs: dict | None, char_name: str = "我") -> str:
    if not obs:
        return ""
    lines = []
    if obs.get("personality"):
        lines.append(f"- 個性印象：{obs['personality']}")
    prefs = obs.get("preferences") or []
    if prefs:
        lines.append(f"- 偏好：{'、'.join(prefs[:5])}")
    inferred = obs.get("inferredInterests") or []
    if inferred:
        lines.append(f"- 推測興趣：{'、'.join(inferred[:5])}")
    if obs.get("notes"):
        lines.append(f"- 其他：{obs['notes']}")
    if not lines:
        return ""
    title = "我對這位朋友的觀察" if char_name == "我" else f"{char_name}對這位朋友的觀察"
    return f"\n\n【{title}（不是用戶親口說的，是我自己感受到的）】\n" + "\n".join(lines)
