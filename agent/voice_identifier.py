"""
voice_identifier.py — 跨 session 聲紋識別

使用 librosa MFCC 特徵提取 + cosine similarity
不依賴 PyTorch，Docker image 輕量

Firestore collection: platform_voice_prints
Doc ID: {characterId}_{userId}
Fields:
  character_id, user_id, display_name,
  embedding: List[float] (52-d),
  created_at, last_seen
"""

import logging
from typing import Optional, List, Tuple
from datetime import datetime, timezone

import numpy as np

logger = logging.getLogger("voice-identifier")

SIMILARITY_THRESHOLD = 0.85
MIN_AUDIO_SAMPLES = 8000   # 0.5s at 16kHz
TARGET_AUDIO_SAMPLES = 48000  # 3s at 16kHz


def extract_voice_embedding(audio_frames: List) -> Optional[np.ndarray]:
    """
    從 LiveKit AudioFrames 提取 52-d 聲紋向量
    (MFCC 13×2 stats + delta 13×2 stats)

    Returns normalized ndarray or None if insufficient audio / librosa unavailable
    """
    try:
        import librosa
    except ImportError:
        logger.warning("librosa not installed, voice identification disabled")
        return None

    try:
        pcm_chunks = []
        for frame in audio_frames:
            raw = bytes(frame.data)
            samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            # Downmix to mono if multi-channel
            if frame.num_channels > 1:
                samples = samples[:: frame.num_channels]
            pcm_chunks.append(samples)

        if not pcm_chunks:
            return None

        audio = np.concatenate(pcm_chunks)
        if len(audio) < MIN_AUDIO_SAMPLES:
            logger.debug(f"[voice-id] too short: {len(audio)} samples")
            return None

        # All LiveKit frames are already 16kHz when requested via AudioStream(sample_rate=16000)
        sr = 16000

        mfcc = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=13)
        delta = librosa.feature.delta(mfcc)

        features = np.concatenate([
            np.mean(mfcc, axis=1),   # 13
            np.std(mfcc, axis=1),    # 13
            np.mean(delta, axis=1),  # 13
            np.std(delta, axis=1),   # 13
        ])  # 52-d total

        norm = np.linalg.norm(features)
        if norm > 0:
            features = features / norm

        return features

    except Exception as e:
        logger.error(f"[voice-id] extract_voice_embedding failed: {e}")
        return None


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))


class VoiceIdentifier:
    """聲紋識別器 — 儲存 / 比對 / 更新聲紋"""

    COLLECTION = "platform_voice_prints"

    def __init__(self, db, character_id: str):
        self.db = db
        self.character_id = character_id

    def _doc_id(self, user_id: str) -> str:
        return f"{self.character_id}_{user_id}"

    def store_embedding(
        self,
        user_id: str,
        display_name: str,
        embedding: np.ndarray,
    ) -> None:
        """Upsert voice embedding for (character, user) pair."""
        doc_id = self._doc_id(user_id)
        now = datetime.now(timezone.utc)
        payload = {
            "character_id": self.character_id,
            "user_id": user_id,
            "display_name": display_name,
            "embedding": embedding.tolist(),
            "last_seen": now,
        }
        doc_ref = self.db.collection(self.COLLECTION).document(doc_id)
        if doc_ref.get().exists:
            doc_ref.update(payload)
        else:
            doc_ref.set({**payload, "created_at": now})
        logger.info(f"[voice-id] stored embedding user={user_id} char={self.character_id}")

    def find_best_match(
        self,
        embedding: np.ndarray,
        threshold: float = SIMILARITY_THRESHOLD,
    ) -> Tuple[Optional[str], Optional[str], float]:
        """
        Search all stored prints for this character.
        Returns (user_id, display_name, similarity) — user_id is None if below threshold.
        """
        try:
            docs = self.db.collection(self.COLLECTION).where(
                "character_id", "==", self.character_id
            ).get()

            best_sim = 0.0
            best_uid: Optional[str] = None
            best_name: Optional[str] = None

            for doc in docs:
                data = doc.to_dict()
                stored = np.array(data.get("embedding", []))
                if stored.shape != embedding.shape:
                    continue
                sim = cosine_similarity(embedding, stored)
                if sim > best_sim:
                    best_sim = sim
                    best_uid = data.get("user_id")
                    best_name = data.get("display_name")

            if best_sim >= threshold:
                return best_uid, best_name, best_sim

            return None, None, best_sim

        except Exception as e:
            logger.error(f"[voice-id] find_best_match failed: {e}")
            return None, None, 0.0
