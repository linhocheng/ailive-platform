# ailive-realtime-agent Dockerfile（build context = repo root，因為要 COPY agent/）
# 用法：
#   cd ~/.ailive/ailive-platform
#   docker build -f agent/Dockerfile -t ailive-realtime-agent .
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# 安裝系統依賴（最小化）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 先 COPY requirements（cache layer，pip install 不會每次重跑）
COPY agent/requirements.txt ./agent/requirements.txt
RUN pip install --no-cache-dir -r agent/requirements.txt

# COPY agent code
COPY agent/ ./agent/

# Cloud Run 規定：listen on $PORT（8080 預設）— 不要在 Dockerfile 寫死
CMD ["python", "-m", "agent.main", "start"]
