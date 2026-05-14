"""
ailive-realtime-agent — Phase 2 hello world

接收 LiveKit room dispatch → STT (Deepgram) → LLM (Claude Haiku) → TTS (ElevenLabs)

Phase 2 限制：
  - prompt 寫死「hello world」式短 prompt，不從 Firestore 讀
  - room metadata 雖然帶了 characterId/voiceId 但暫時不使用
  - 只跑通端到端 audio loop，驗證 LiveKit + STT + LLM + TTS 連通

下一階段（Phase 3）才接 Firestore 讀真正的角色 soul。

紅線（從江彬血淚教訓繼承）：
  - LiveKit 套件全部鎖 ==1.5.1（version mismatch 會 ChunkedStream crash）
  - PROJECT_NAMESPACE 防止跨專案 dispatch 串錯（馬雲事件）
  - room name 必須以 'realtime-' 開頭（對齊 Next.js token API 的 roomName 格式）
"""
import asyncio
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / ".env.local.fresh")  # 開發時用 ailive-platform 的 env

from livekit.agents import Agent, AgentSession, JobContext, function_tool
from livekit.plugins import silero, anthropic, deepgram

# MiniMax 自訂 wrapper（江彬教訓 #6：官方 plugin 不相容 1.5.x）
from agent.minimax_tts import MiniMaxCustomTTS

# Phase 3：從 Firestore 讀角色 soul + 對話歷史
from firebase_admin import firestore
from agent.firestore_loader import (
    load_character,
    load_conversation,
    load_recent_actions,
    load_episodic_block,
    save_conversation,
    extract_session_summary,
    build_system_prompt,
)
from agent.promise_reflection import reflect_and_mark_fulfilled
from agent.user_profile import load_user_profile, format_profile_block
from agent.user_observations import load_user_observations, format_observations_block

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("ailive-realtime")

# 防跨專案 dispatch 串錯。Next.js token API 的 roomName 是 `realtime-{characterId}-{userId}-{ts}`
PROJECT_NAMESPACE = os.environ.get("PROJECT_NAMESPACE", "realtime")

# Phase 3 後 prompt 由 firestore_loader.build_system_prompt 動態組（角色 soul + summary）
# 留 fallback 給 metadata 不正常時使用
FALLBACK_PROMPT = (
    "你是一個禮貌、簡短的測試助手。這是即時語音通話。\n"
    "用簡體中文回覆，一兩句話即可。不要說（思考）（停頓）這類 stage directions。"
)


async def entrypoint(ctx: JobContext):
    """LiveKit Agent 入口點 — Phase 2 hello world"""
    logger.info(f"Job dispatched: room={ctx.room.name}")

    # 防跨專案 dispatch
    if not ctx.room.name.startswith(f"{PROJECT_NAMESPACE}-"):
        logger.critical(
            f"SECURITY: Room '{ctx.room.name}' lacks '{PROJECT_NAMESPACE}-' prefix. "
            f"Rejecting dispatch (cross-project guard)."
        )
        return

    # Phase 3：解析 dispatch metadata 拿 characterId / userId / convId
    # token API 透過 RoomAgentDispatch.metadata 傳進來
    dispatch_metadata = {}
    try:
        if ctx.job.metadata:
            dispatch_metadata = json.loads(ctx.job.metadata)
            logger.info(f"Job metadata: {dispatch_metadata}")
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning(f"Job metadata parse failed: {e}")

    character_id = dispatch_metadata.get("characterId", "")
    user_id = dispatch_metadata.get("userId", "")
    conv_id = dispatch_metadata.get("convId", "")

    # 從 Firestore 讀角色 soul + 對話 summary（Phase 3）+ TTS 設定（Phase 4.x）
    system_prompt = FALLBACK_PROMPT
    char_name = "agent"
    char_ctx = None  # outer scope，給後面 TTS 初始化讀
    if character_id:
        try:
            char_ctx = load_character(character_id)
            conv_ctx = load_conversation(conv_id) if conv_id else None
            if conv_ctx is None:
                from agent.firestore_loader import ConversationContext
                conv_ctx = ConversationContext(conv_id="", summary="", messages=[])
            # P0：載入 character-actions（近 7 天未兌現的承諾/問題）
            actions = []
            if user_id:
                try:
                    actions = load_recent_actions(character_id, user_id, days=7, limit=5)
                except Exception as e:
                    logger.warning(f"load_recent_actions failed: {e}")
            # M1：episodic memory（platform_insights 近期記憶 + 資源認知）
            episodic_block = ""
            try:
                episodic_block = load_episodic_block(character_id, user_id)
            except Exception as e:
                logger.warning(f"load_episodic_block failed: {e}")
            # B3：UserProfile（事實 global）+ UserObservations（觀察 per-pair）
            profile_block = ""
            observations_block = ""
            if user_id:
                try:
                    profile = load_user_profile(user_id)
                    profile_block = format_profile_block(profile)
                except Exception as e:
                    logger.warning(f"load_user_profile failed: {e}")
                try:
                    obs = load_user_observations(character_id, user_id)
                    observations_block = format_observations_block(obs, char_ctx.name)
                except Exception as e:
                    logger.warning(f"load_user_observations failed: {e}")
            system_prompt = build_system_prompt(
                char_ctx, conv_ctx,
                actions=actions,
                episodic_block=episodic_block,
                profile_block=profile_block,
                observations_block=observations_block,
            )
            char_name = char_ctx.name
            logger.info(
                f"Loaded character={char_name} id={character_id} "
                f"soul_chars={len(char_ctx.soul_text)} summary_chars={len(conv_ctx.summary)} "
                f"messages={len(conv_ctx.messages)} actions={len(actions)} "
                f"episodic_chars={len(episodic_block)} "
                f"last_gap_ms={int(datetime.now(timezone.utc).timestamp()*1000) - conv_ctx.last_updated_ms if conv_ctx.last_updated_ms else 'n/a'} "
                f"voice_minimax={char_ctx.voice_id_minimax or '(empty, fallback)'}"
            )
        except Exception as e:
            logger.error(f"Firestore load failed, using fallback prompt: {e}")
    else:
        logger.warning("No characterId in metadata, using fallback prompt")

    await ctx.connect()
    logger.info("Connected to room, waiting for participant...")

    participant = await ctx.wait_for_participant()
    logger.info(f"Participant joined: {participant.identity}")

    # ── 主動打斷設定 ──────────────────────────────────────────────
    MAX_UTTERANCE_SECS = 90          # 超過 90 秒強制截斷
    QUESTION_RE = re.compile(r'[？?]\s*$')   # interim 以問句結尾 → 立刻截斷
    INTERIM_CHAR_LIMIT = 200         # interim 累積超過 200 字 → 截斷

    # Voice Activity Detection
    vad = silero.VAD.load(
        min_silence_duration=0.4,
        prefix_padding_duration=0.3,
        min_speech_duration=0.1,
        activation_threshold=0.5,
        max_buffered_speech=90.0,    # 對齊 MAX_UTTERANCE_SECS，避免 VAD 丟棄音訊
    )

    # STT — Deepgram Nova-2（中文 language="zh"，無串流時間限制）
    deepgram_key = os.environ.get("DEEPGRAM_API_KEY", "")
    if not deepgram_key:
        logger.critical("DEEPGRAM_API_KEY missing")
        return
    stt = deepgram.STT(
        model="nova-2",
        language="zh",
        interim_results=True,
        api_key=deepgram_key,
    )

    # LLM — 優先走 Bridge VM（Max 月費），fallback 直接 API key
    bridge_url = os.environ.get("BRIDGE_URL", "")
    bridge_secret = os.environ.get("BRIDGE_SECRET", "")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")

    if bridge_url and bridge_secret:
        # 走 Bridge VM（Max OAuth），不燒 API 餘額
        logger.info(f"LLM: using Bridge VM at {bridge_url}")
        llm = anthropic.LLM(
            model="claude-sonnet-4-6",
            api_key=bridge_secret,
            base_url=bridge_url,
            temperature=0.7,
            caching="ephemeral",
        )
    elif anthropic_key:
        logger.info("LLM: using direct Anthropic API key")
        llm = anthropic.LLM(
            model="claude-haiku-4-5-20251001",
            api_key=anthropic_key,
            temperature=0.7,
            caching="ephemeral",
        )
    else:
        logger.critical("No LLM credentials: set BRIDGE_URL+BRIDGE_SECRET or ANTHROPIC_API_KEY")
        return

    # TTS — MiniMax 自訂 wrapper
    # Phase 4.x：voice_id + speed/pitch 從 character doc 讀，沒設則 fallback default
    minimax_key = os.environ.get("MINIMAX_API_KEY", "")
    minimax_group_id = os.environ.get("MINIMAX_GROUP_ID", "")
    default_voice_id = os.environ.get("MINIMAX_DEFAULT_VOICE_ID", "")
    if not minimax_key or not minimax_group_id or not default_voice_id:
        logger.critical("MINIMAX_API_KEY / MINIMAX_GROUP_ID / MINIMAX_DEFAULT_VOICE_ID missing")
        return

    # 角色設定優先：voice_id 從 character.voiceIdMinimax；speed/pitch 從 ttsSettings.minimax
    char_voice_id = char_ctx.voice_id_minimax if char_ctx else ""
    voice_id = char_voice_id or default_voice_id
    settings = (char_ctx.tts_settings_minimax if char_ctx else {}) or {}
    speed = settings.get("speed", 1.0)
    pitch = settings.get("pitch", 0)
    logger.info(
        f"TTS: MiniMax voice={voice_id} (from {'character' if char_voice_id else 'default'}) "
        f"speed={speed} pitch={pitch}"
    )

    tts = MiniMaxCustomTTS(
        api_key=minimax_key,
        group_id=minimax_group_id,
        voice_id=voice_id,
        model="speech-02-turbo",
        speed=speed,
        pitch=pitch,
    )

    # ── dispatch_research：派工給索（非同步，不阻塞對話）────────────────
    # 建 Firestore job doc → background asyncio task 自己跑索五層協議 + web_search
    # 完成後 session.say() 主動說出吸收後的話（allow_interruptions=False）
    db_rt = firestore.client()
    anthropic_key_rt = os.environ.get("ANTHROPIC_API_KEY", "")

    RESEARCH_TIMEOUT_SECS = 120  # 索 + 吸收兩段加總上限
    # 5/13 實測：character 一輪內叫了 5 次 dispatch_research → 5 個 generate_reply
    # 同時要 TTS → MiniMax RPM 撞牆、AudioEmitter 全死。加 in-flight lock：
    # 同 session 同時最多 1 個 research，第二個來直接拒絕。
    research_in_flight = {"active": False}

    ABSORB_DISCIPLINE = (
        "\n\n== 關於剛剛這條資訊 ==\n"
        "把它當成你的內務——你想了一下，現在要對用戶說。\n"
        "查到的事先進入你的世界觀，再從你口中說出。語氣、節奏、判斷都是你的；\n"
        "對方聽到的不是搜尋摘要、不是助理回報，是你的觀察、你的解讀、你的立場。\n"
        "不要說「我查了」「我朋友幫我」「資料顯示」「根據最新」——這些痕跡都是漏氣。\n"
        "用一句到三句話自然接話。"
    )

    def _sync_run_suo(question: str, context: str) -> str:
        """呼叫索 → 回 raw 文字結果（sync，跑在 worker thread）"""
        import anthropic as anthropic_sdk
        suo_doc = db_rt.collection("platform_characters").document("dQHkL6vvhmKlNho8dA1L").get()
        suo_soul = (suo_doc.to_dict() or {}).get("system_soul") or (suo_doc.to_dict() or {}).get("soul_core") or ""
        client = anthropic_sdk.Anthropic(api_key=anthropic_key_rt)
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=suo_soul,
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],  # type: ignore
            messages=[{"role": "user", "content": f"查詢需求:{question}\n\n脈絡:{context}"}],
        )
        return "\n".join(b.text for b in resp.content if b.type == "text")

    def _sync_absorb(question: str, result_text: str) -> str:
        """角色靈魂 + 紀律段 + 索結果 → 角色語氣版（sync）"""
        import anthropic as anthropic_sdk
        client = anthropic_sdk.Anthropic(api_key=anthropic_key_rt)
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system_prompt + ABSORB_DISCIPLINE,
            messages=[{
                "role": "user",
                "content": f"剛剛你想了一下「{question}」這件事。你內心整理到的資訊是:\n\n{result_text}\n\n現在自然接話告訴用戶。",
            }],
        )
        return "\n".join(b.text for b in resp.content if b.type == "text")

    def _sync_update_job(job_id: str, patch: dict) -> None:
        db_rt.collection("platform_research_jobs").document(job_id).update(patch)

    async def _research_pipeline(job_id: str, question: str, context: str) -> None:
        await asyncio.to_thread(_sync_update_job, job_id, {"status": "running"})
        result_text = await asyncio.to_thread(_sync_run_suo, question, context)
        try:
            await ctx.room.local_participant.publish_data(
                json.dumps({"type": "research", "phase": "data_ready"}).encode(), reliable=True,
            )
        except Exception:
            pass
        await asyncio.to_thread(_sync_update_job, job_id, {
            "status": "done",
            "result": {"raw": result_text},
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })
        absorbed = await asyncio.to_thread(_sync_absorb, question, result_text)
        await asyncio.to_thread(_sync_update_job, job_id, {"consumed": True})
        # session.history 的 copy 加入研究結果，顯式傳給 generate_reply(chat_ctx=)。
        # 直接改 session.history 不可靠（generate_reply 可能用內部獨立 ctx），
        # 傳 copy 才保證 LLM 這一次一定看到。
        ctx_copy = session.history.copy()
        ctx_copy.add_message(
            role="developer",
            content=(
                f"[研究就緒] 你剛才在想「{question}」這件事，現在已經想好了。\n"
                f"你準備要說的話：{absorbed}\n\n"
                f"請接著對用戶自然說出來（用你的語氣，不要說「根據資料」「以下是」等轉述語）。"
            ),
        )
        try:
            await ctx.room.local_participant.publish_data(
                json.dumps({"type": "research", "phase": "delivered"}).encode(), reliable=True,
            )
        except Exception:
            pass
        logger.info(f"[research] job={job_id[:8]} done, generate_reply with ctx_copy ({len(absorbed)} chars)")
        await session.generate_reply(chat_ctx=ctx_copy)

    async def _run_research(job_id: str, question: str, context: str) -> None:
        """Background task：呼叫索查詢 → 吸收 → generate_reply()
        所有 sync I/O（Firestore + Anthropic SDK）都走 asyncio.to_thread()，
        避免阻塞 LiveKit event loop（會造成音訊掉幀、TTS 中斷、連線斷）。
        finally 清 in-flight lock，讓下次 dispatch 能用。"""
        try:
            await asyncio.wait_for(
                _research_pipeline(job_id, question, context),
                timeout=RESEARCH_TIMEOUT_SECS,
            )
        except asyncio.TimeoutError:
            logger.error(f"[research] job={job_id[:8]} timeout after {RESEARCH_TIMEOUT_SECS}s")
            try:
                await asyncio.to_thread(_sync_update_job, job_id, {
                    "status": "failed", "error": f"timeout after {RESEARCH_TIMEOUT_SECS}s",
                })
            except Exception:
                pass
        except Exception as e:
            logger.error(f"[research] job={job_id[:8]} failed: {e}")
            try:
                await asyncio.to_thread(_sync_update_job, job_id, {
                    "status": "failed", "error": str(e),
                })
            except Exception:
                pass
        finally:
            research_in_flight["active"] = False
            logger.info(f"[research] job={job_id[:8]} lock released")

    @function_tool(
        name="dispatch_research",
        description=(
            "需要當下外部資訊（即時資料、最新新聞、特定數字）時用這個工具。"
            "把它當成你停下來想一件事——你不會看到「索」這個名字，"
            "不會收到「資料」「報告」；想完之後，你會自己接著對用戶說。"
            "呼叫工具的這一輪，對用戶就說「這個我想一下，我們先聊別的」(或符合你人格的對等說法)，"
            "繼續陪聊。資訊到位時你會被叫起來說話——用你的語氣、你的判斷，不是轉述。"
            "\n\n"
            "【紀律 · 必守】一次只想一件事。"
            "如果用戶一次問了好幾件相關的事，合併成一句完整的 question 再呼叫一次——"
            "不要拆成多個 tool_use 並行呼叫，這會把你逼成 5 個工具同時搶話、用戶反而聽不到。"
            "目前正在想一件事時，第二次呼叫會被直接拒絕（你會看到 ALREADY_THINKING）。"
        ),
    )
    async def dispatch_research(question: str, context: str = "") -> str:  # type: ignore[misc]
        """
        question: 要查的問題（完整句子，多個相關問題合併成一句）
        context: 為什麼問、哪個層面最重要、用戶是誰
        """
        # In-flight 硬鎖：同 session 同時最多 1 個 research。LLM 在單一 turn 可能 emit
        # 多個 tool_use block 並行派工（5/13 實測馬雲一輪派 5 次），這裡擋下。
        if research_in_flight["active"]:
            logger.info(f"[research] rejected (in-flight active), question={question[:40]!r}")
            return "ALREADY_THINKING:你已經在想一件事了。這輪不要再派工，等想完再說。"
        research_in_flight["active"] = True

        def _create_job():
            return db_rt.collection("platform_research_jobs").add({
                "character_id": character_id,
                "session_id": f"realtime-{character_id}-{user_id or 'anon'}",
                "user_id": user_id or "",
                "question": question,
                "context": context,
                "status": "pending",
                "result": None,
                "consumed": False,
                "source": "realtime",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
            })
        try:
            job_ref = await asyncio.to_thread(_create_job)
        except Exception:
            research_in_flight["active"] = False  # 寫不進去 lock 還回去
            raise
        job_id = job_ref[1].id
        try:
            await ctx.room.local_participant.publish_data(
                json.dumps({"type": "research", "phase": "searching"}).encode(), reliable=True,
            )
        except Exception:
            pass
        asyncio.ensure_future(_run_research(job_id, question, context))
        return f"RESEARCH_PENDING:{job_id}"

    agent = Agent(instructions=system_prompt, tools=[dispatch_research])
    logger.info(f"Agent initialized with {char_name} soul, prompt={len(system_prompt)} chars")

    session = AgentSession(
        stt=stt,
        llm=llm,
        tts=tts,
        vad=vad,
    )

    call_start = time.time()

    # Phase 5：收集本次通話的 transcript（user + assistant）→ 通話結束寫回 Firestore
    transcript: list = []

    @session.on("conversation_item_added")
    def _on_item_added(event):
        item = getattr(event, "item", None)
        if not item:
            return
        role = getattr(item, "role", "")
        text = getattr(item, "text_content", "") or getattr(item, "content", "") or ""
        if not text or not text.strip():
            return
        if role in ("user", "assistant"):
            transcript.append({
                "role": role,
                "content": text.strip(),
                "timestamp": time.time(),
            })

    # ── 主動打斷：90 秒 timeout + 問句即時截斷 ────────────────────
    _utterance_timer: asyncio.Task | None = None
    _interrupted_this_turn: bool = False   # 防同一句話打斷兩次

    async def _do_interrupt() -> None:
        try:
            await session.interrupt()
        except Exception as e:
            logger.warning(f"interrupt failed: {e}")

    @session.on("user_state_changed")
    def _on_user_state(event) -> None:
        nonlocal _utterance_timer, _interrupted_this_turn
        new_state = str(getattr(event, "new_state", ""))

        if new_state == "speaking":
            _interrupted_this_turn = False
            if _utterance_timer:
                _utterance_timer.cancel()
            async def _timeout_task():
                await asyncio.sleep(MAX_UTTERANCE_SECS)
                logger.info(f"[interrupt] utterance exceeded {MAX_UTTERANCE_SECS}s")
                await _do_interrupt()
            _utterance_timer = asyncio.ensure_future(_timeout_task())

        elif new_state in ("listening", "away"):
            if _utterance_timer:
                _utterance_timer.cancel()
                _utterance_timer = None

    @session.on("user_input_transcribed")
    def _on_transcribed(event) -> None:
        nonlocal _interrupted_this_turn
        if _interrupted_this_turn:
            return
        if getattr(event, "is_final", True):
            return  # 只處理 interim
        text: str = getattr(event, "transcript", "") or ""
        if not text:
            return
        should_cut = QUESTION_RE.search(text) or len(text) > INTERIM_CHAR_LIMIT
        if should_cut:
            reason = "question" if QUESTION_RE.search(text) else f"len={len(text)}"
            logger.info(f"[interrupt] {reason}: {text[-30:]!r}")
            _interrupted_this_turn = True
            asyncio.ensure_future(_do_interrupt())

    @ctx.room.on("disconnected")
    def on_disconnected():
        duration = time.time() - call_start
        logger.info(f"Room disconnected after {duration:.1f}s, transcript={len(transcript)} msgs")
        # 通話結束寫回 conv（含 summary 壓縮 + P1 lastSession 快照）
        if transcript and conv_id and character_id:
            try:
                anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
                # P1：抽 lastSession（Smart Greeting 用）
                last_session = extract_session_summary(transcript, anthropic_key)
                if last_session:
                    logger.info(f"lastSession: {last_session}")
                stats = save_conversation(
                    conv_id=conv_id,
                    character_id=character_id,
                    user_id=user_id,
                    new_messages=transcript,
                    anthropic_api_key=anthropic_key,
                    last_session=last_session,
                )
                logger.info(f"Saved to {conv_id}: {stats}")

                # B2.4：promise-reflection — 自動標記哪些 unfulfilled actions 被兌現
                if user_id:
                    try:
                        transcript_text = "\n".join(
                            f"{'用戶' if m.get('role') == 'user' else '角色'}：{(m.get('content') or '')[:300]}"
                            for m in transcript
                        )
                        ref_stats = reflect_and_mark_fulfilled(
                            character_id=character_id,
                            user_id=user_id,
                            transcript=transcript_text,
                            anthropic_api_key=anthropic_key,
                        )
                        logger.info(f"promise-reflection: {ref_stats}")
                    except Exception as e:
                        logger.warning(f"promise-reflection failed: {e}")
            except Exception as e:
                logger.error(f"save_conversation failed: {e}")
        else:
            logger.info(f"Skip save: transcript={len(transcript)}, conv_id={conv_id}, char_id={character_id}")

    await session.start(agent=agent, room=ctx.room)
    logger.info("Session started, agent active")

    # 主動打招呼 — Phase 3：由角色 soul 自己決定打招呼方式（不再 hardcode 內容）
    try:
        await session.generate_reply(
            instructions="用一句話自然打招呼，符合你的人格。如果對話摘要中有上次聊過的東西，可以順手帶出。",
        )
        logger.info("Initial greeting sent")
    except Exception as e:
        logger.error(f"Initial greeting failed: {e}")
