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
import json
import logging
import os
import sys
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / ".env.local.fresh")  # 開發時用 ailive-platform 的 env

from livekit.agents import Agent, AgentSession, JobContext
from livekit.plugins import silero, anthropic, deepgram

# MiniMax 自訂 wrapper（江彬教訓 #6：官方 plugin 不相容 1.5.x）
from agent.minimax_tts import MiniMaxCustomTTS

# Phase 3：從 Firestore 讀角色 soul + 對話歷史
from agent.firestore_loader import (
    load_character,
    load_conversation,
    build_system_prompt,
)

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

    # 從 Firestore 讀角色 soul + 對話 summary
    system_prompt = FALLBACK_PROMPT
    char_name = "agent"
    if character_id:
        try:
            char_ctx = load_character(character_id)
            conv_ctx = load_conversation(conv_id) if conv_id else None
            if conv_ctx is None:
                from agent.firestore_loader import ConversationContext
                conv_ctx = ConversationContext(conv_id="", summary="", messages=[])
            system_prompt = build_system_prompt(char_ctx, conv_ctx)
            char_name = char_ctx.name
            logger.info(
                f"Loaded character={char_name} id={character_id} "
                f"soul_chars={len(char_ctx.soul_text)} summary_chars={len(conv_ctx.summary)} "
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

    # Voice Activity Detection
    vad = silero.VAD.load(
        min_silence_duration=0.4,
        prefix_padding_duration=0.3,
        min_speech_duration=0.1,
        activation_threshold=0.5,
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

    # LLM — Claude Haiku 4.5（低延遲）
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not anthropic_key:
        logger.critical("ANTHROPIC_API_KEY missing")
        return
    llm = anthropic.LLM(
        model="claude-haiku-4-5-20251001",
        api_key=anthropic_key,
        temperature=0.7,
    )

    # TTS — MiniMax 自訂 wrapper（Phase 4 跳級上線，治本）
    # ElevenLabs key 端到端證實失效；MiniMax 已驗 HTTP 200，且聖嚴本來就是 minimax
    minimax_key = os.environ.get("MINIMAX_API_KEY", "")
    minimax_group_id = os.environ.get("MINIMAX_GROUP_ID", "")
    minimax_voice_id = os.environ.get("MINIMAX_DEFAULT_VOICE_ID", "")
    if not minimax_key or not minimax_group_id or not minimax_voice_id:
        logger.critical("MINIMAX_API_KEY / MINIMAX_GROUP_ID / MINIMAX_DEFAULT_VOICE_ID missing")
        return
    tts = MiniMaxCustomTTS(
        api_key=minimax_key,
        group_id=minimax_group_id,
        voice_id=minimax_voice_id,
        model="speech-02-turbo",
        speed=1.0,
    )

    agent = Agent(instructions=system_prompt)
    logger.info(f"Agent initialized with {char_name} soul, prompt={len(system_prompt)} chars")

    session = AgentSession(
        stt=stt,
        llm=llm,
        tts=tts,
        vad=vad,
    )

    call_start = time.time()

    @ctx.room.on("disconnected")
    def on_disconnected():
        duration = time.time() - call_start
        logger.info(f"Room disconnected after {duration:.1f}s")

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
