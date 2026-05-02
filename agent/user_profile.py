"""
User Profile (Python) — 對齊 src/lib/user-profile.ts

collection: platform_user_profiles/{userId}
全局事實（跨角色共用）：name/birthday/age/occupation/interests/extraInfo
"""
import logging
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import firestore

logger = logging.getLogger(__name__)

COLLECTION = "platform_user_profiles"


def _ensure_init():
    if not firebase_admin._apps:
        from agent.firestore_loader import _ensure_init as _init
        _init()


def load_user_profile(user_id: str) -> dict | None:
    if not user_id:
        return None
    _ensure_init()
    db = firestore.client()
    doc = db.collection(COLLECTION).document(user_id).get()
    if not doc.exists:
        return None
    d = doc.to_dict() or {}
    return {
        "userId": user_id,
        "name": d.get("name"),
        "birthday": d.get("birthday"),
        "age": d.get("age"),
        "occupation": d.get("occupation"),
        "interests": d.get("interests") or [],
        "extraInfo": d.get("extraInfo"),
        "createdAt": d.get("createdAt"),
        "updatedAt": d.get("updatedAt"),
    }


def upsert_user_profile(user_id: str, partial: dict) -> None:
    if not user_id:
        raise ValueError("upsert_user_profile: user_id required")
    _ensure_init()
    db = firestore.client()
    ref = db.collection(COLLECTION).document(user_id)
    now = datetime.now(timezone.utc).isoformat()
    payload: dict = {"userId": user_id, "updatedAt": now}
    for k, v in partial.items():
        if v is not None:
            payload[k] = v
    existing = ref.get()
    if not existing.exists:
        payload["createdAt"] = now
    ref.set(payload, merge=True)


def _derive_age(birthday: str | None) -> int | None:
    if not birthday:
        return None
    try:
        bd = datetime.fromisoformat(birthday)
        now = datetime.now(timezone.utc)
        age = now.year - bd.year
        if (now.month, now.day) < (bd.month, bd.day):
            age -= 1
        return age if 0 <= age < 150 else None
    except Exception:
        return None


def format_profile_block(profile: dict | None) -> str:
    if not profile:
        return ""
    lines = []
    if profile.get("name"):
        lines.append(f"- 名字：{profile['name']}")
    if profile.get("birthday"):
        lines.append(f"- 生日：{profile['birthday']}")
    age = profile.get("age") or _derive_age(profile.get("birthday"))
    if age:
        lines.append(f"- 年齡：{age} 歲")
    if profile.get("occupation"):
        lines.append(f"- 職業：{profile['occupation']}")
    interests = profile.get("interests") or []
    if interests:
        lines.append(f"- 興趣：{'、'.join(interests[:5])}")
    if profile.get("extraInfo"):
        lines.append(f"- 其他：{profile['extraInfo']}")
    if not lines:
        return ""
    return "\n\n【關於這位朋友（用戶親口說過的事實）】\n" + "\n".join(lines)
