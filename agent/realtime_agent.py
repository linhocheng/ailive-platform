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
from livekit.plugins import elevenlabs, silero, anthropic, deepgram

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("ailive-realtime")

# 防跨專案 dispatch 串錯。Next.js token API 的 roomName 是 `realtime-{characterId}-{userId}-{ts}`
PROJECT_NAMESPACE = os.environ.get("PROJECT_NAMESPACE", "realtime")

PHASE2_HELLO_PROMPT = (
    "你是一個禮貌、簡短的測試助手。這是即時語音通話的端到端連通測試。\n"
    "請用一兩句話回應使用者，每次回覆都簡短。不要長篇大論。\n"
    "規則：\n"
    "1. 回覆使用簡體中文（TTS 發音穩定）\n"
    "2. 不要說「（思考）」「（停頓）」這類括號 stage directions\n"
    "3. 數字用中文念法（例如「三百五」不是「350」）\n"
    "4. 第一句先打招呼說『你好，我是即時通話測試 agent』\n"
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

    await ctx.connect()
    logger.info("Connected to room, waiting for participant...")

    participant = await ctx.wait_for_participant()
    logger.info(f"Participant joined: {participant.identity}")

    # Phase 2：room metadata 帶了 characterId 但先不使用，留 log 為 Phase 3 接續做準備
    if participant.metadata:
        try:
            meta = json.loads(participant.metadata)
            logger.info(f"Participant metadata (Phase 2 ignored, Phase 3 will use): {meta}")
        except (json.JSONDecodeError, TypeError):
            logger.warning("Participant metadata not parseable JSON")

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

    # TTS — ElevenLabs flash_v2_5（Phase 2 統一用 ElevenLabs，Phase 4 才依角色切 MiniMax）
    elevenlabs_key = os.environ.get("ELEVENLABS_API_KEY", "")
    elevenlabs_voice_id = os.environ.get("ELEVENLABS_DEFAULT_VOICE_ID", "")
    if not elevenlabs_key or not elevenlabs_voice_id:
        logger.critical("ELEVENLABS_API_KEY or ELEVENLABS_DEFAULT_VOICE_ID missing")
        return
    tts = elevenlabs.TTS(
        voice_id=elevenlabs_voice_id,
        model="eleven_flash_v2_5",
        api_key=elevenlabs_key,
    )

    agent = Agent(instructions=PHASE2_HELLO_PROMPT)

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
