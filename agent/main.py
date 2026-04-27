"""
ailive-realtime-agent — LiveKit Agent 啟動入口（Phase 2 hello world）

用法：
  python -m agent.main dev    # 本地開發
  python -m agent.main start  # 正式環境
"""
import os
from livekit.agents import cli, WorkerOptions
from agent.realtime_agent import entrypoint

if __name__ == "__main__":
    # Cloud Run 自動注入 PORT；不要手動設此 env（會被 Cloud Run 拒絕）
    port = int(os.environ.get("PORT", 8080))
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        port=port,
    ))
