"""
ailive-realtime-agent — LiveKit Agent 啟動入口（Phase 2 hello world）

用法：
  python -m agent.main dev    # 本地開發
  python -m agent.main start  # 正式環境
"""
import os
from livekit.agents import cli, WorkerOptions
from agent.realtime_agent import entrypoint


def _stamp_boot():
    """開機蓋章：開關制（/api/livekit/wake）的鑑別信號。

    agentBootAt > lastSleepAt = 有實例真的活著——Cloud Run 設定 min=1
    不代表容器起來了，這個章是實例沒起來時不可能出現的信號。失敗不擋啟動。
    """
    try:
        from agent.firestore_loader import _ensure_init
        _ensure_init()
        from firebase_admin import firestore
        db = firestore.client()
        db.collection("system_status").document("voice_agent").set({
            "agentBootAt": firestore.SERVER_TIMESTAMP,
            "bootRevision": os.environ.get("K_REVISION", "unknown"),
        }, merge=True)
        print(f"boot stamp written (revision={os.environ.get('K_REVISION', 'unknown')})")
    except Exception as e:  # noqa: BLE001
        print(f"boot stamp failed (non-fatal): {e}")


if __name__ == "__main__":
    _stamp_boot()
    # Cloud Run 自動注入 PORT；不要手動設此 env（會被 Cloud Run 拒絕）
    port = int(os.environ.get("PORT", 8080))
    # agent_name = 'ailive-realtime'：跟江彬共用同一個 LiveKit project，靠 agent_name 隔離 dispatch
    # token 簽發時指定 agentName='ailive-realtime' → LiveKit 只 dispatch 給這個 name 的 worker
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        agent_name="ailive-realtime",
        port=port,
    ))
