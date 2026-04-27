"""
Firestore loader — 從 ailive-platform 既有 schema 讀角色 soul + 對話歷史

讀法照抄 voice-stream/route.ts 的優先序，避免「真相分裂」（同一角色在文字 / 語音 /
即時撥號三種對話模式下用同一份 soul + conv）。

- platform_characters.{characterId}: aiName / system_soul / soul_core / enhancedSoul / soul
- platform_conversations.{convId}:    summary / messages（last 10）/ updatedAt

Phase 3：先讀，不寫。寫回是 Phase 5。
"""
import json
import logging
import os
from dataclasses import dataclass

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
    """讀 platform_conversations doc，回傳 summary + last 10 messages

    沒有 conv 也回空殼，不 raise（新通話就是新 conv）。
    """
    _ensure_init()
    db = firestore.client()
    doc = db.collection("platform_conversations").document(conv_id).get()
    if not doc.exists:
        return ConversationContext(conv_id=conv_id, summary="", messages=[])
    d = doc.to_dict() or {}
    msgs = d.get("messages") or []
    return ConversationContext(
        conv_id=conv_id,
        summary=d.get("summary") or "",
        messages=msgs[-10:],  # 對齊 voice-stream:165
    )


def save_conversation(
    conv_id: str,
    character_id: str,
    user_id: str,
    new_messages: list,  # [{role: 'user'|'assistant', content: str, timestamp?: str}]
    anthropic_api_key: str = "",
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

    # 寫回（merge=True 不覆蓋既有其他欄位如 lastSession 等）
    ref.set({
        "characterId": character_id,
        "userId": user_id or "anon",
        "messages": merged_messages,
        "messageCount": new_count,
        "summary": new_summary,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }, merge=True)

    return {
        "appended": len(new_messages),
        "total_messages": len(merged_messages),
        "summary_chars": len(new_summary),
        "messageCount": new_count,
    }


def build_system_prompt(char: CharacterContext, conv: ConversationContext) -> str:
    """組 agent 用的 system prompt — 對齊 voice-stream voiceStableBlock 結構

    精簡版（即時通話 hello world phase 3）：
    - 角色 soul
    - 語音對話天條（說人話）
    - STT 容錯
    - 對話摘要（如有）
    - 不含委派工具（Phase 7 才接）
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
- 數字用中文念法（例如「三百五」不是「350」）

【STT 容錯】
✅ 根據上下文猜用戶意圖，就算聽起來不通順也要猜
✅ 用自然方式回應，當作你完全聽懂了
❌ 不要說「我沒聽清楚」「請再說一次」「你說的 XXX 是什麼意思」""")

    if conv.summary:
        parts.append(f"\n【對話摘要】\n{conv.summary}")

    return "\n".join(parts)
