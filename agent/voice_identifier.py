"""
voice_identifier.py — 跨 session 聲紋識別

純 numpy 實作（無 librosa/scipy/numba），CPU 零 JIT 延遲。
特徵：ZCR + 能量 + FFT 頻譜（重心/帶寬/滾降/平坦度）+ 8 頻段能量分布 = 20-d

Firestore collection: platform_voice_prints
Doc ID: {characterId}_{userId}
Fields:
  character_id, user_id, display_name,
  embedding: List[float] (20-d),
  created_at, last_seen
"""

import logging
from typing import Optional, List, Tuple
from datetime import datetime, timezone

import numpy as np

logger = logging.getLogger("voice-identifier")

SIMILARITY_THRESHOLD = 0.92  # 純幾何特徵，比 MFCC 更穩定，閾值拉高
MIN_AUDIO_SAMPLES = 8000   # 0.5s at 16kHz
TARGET_AUDIO_SAMPLES = 48000  # 3s at 16kHz


def extract_voice_embedding(audio_frames: List) -> Optional[np.ndarray]:
    """
    從 LiveKit AudioFrames 提取 20-d 聲紋向量（純 numpy，無 librosa）
    ZCR + 能量 + 頻譜重心/帶寬/滾降/平坦度（各 mean+std）+ 8 頻段能量分布
    """
    try:
        pcm_chunks = []
        for frame in audio_frames:
            raw = bytes(frame.data)
            samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            if frame.num_channels > 1:
                samples = samples[:: frame.num_channels]
            pcm_chunks.append(samples)

        if not pcm_chunks:
            return None

        audio = np.concatenate(pcm_chunks)
        if len(audio) < MIN_AUDIO_SAMPLES:
            logger.debug(f"[voice-id] too short: {len(audio)} samples")
            return None

        sr = 16000
        frame_length = 512
        hop_length = 256

        n_frames = (len(audio) - frame_length) // hop_length + 1
        if n_frames < 1:
            return None

        frames = np.stack([
            audio[i * hop_length: i * hop_length + frame_length]
            for i in range(n_frames)
        ])  # (n_frames, frame_length)

        # ZCR
        signs = np.sign(frames)
        zcr = np.mean(np.abs(np.diff(signs, axis=1)), axis=1) / 2
        zcr_mean, zcr_std = float(np.mean(zcr)), float(np.std(zcr))

        # Short-time energy
        energy = np.mean(frames ** 2, axis=1)
        energy_mean, energy_std = float(np.mean(energy)), float(np.std(energy))

        # FFT-based spectral features
        fft_mag = np.abs(np.fft.rfft(frames, axis=1))  # (n_frames, frame_length//2+1)
        freqs = np.fft.rfftfreq(frame_length, d=1.0 / sr)
        fft_sum = np.sum(fft_mag, axis=1) + 1e-10

        # Spectral centroid
        centroid = np.sum(freqs * fft_mag, axis=1) / fft_sum
        centroid_mean, centroid_std = float(np.mean(centroid)), float(np.std(centroid))

        # Spectral bandwidth
        bandwidth = np.sqrt(
            np.sum(((freqs[None, :] - centroid[:, None]) ** 2) * fft_mag, axis=1) / fft_sum
        )
        bandwidth_mean, bandwidth_std = float(np.mean(bandwidth)), float(np.std(bandwidth))

        # Spectral rolloff (85%)
        cumsum = np.cumsum(fft_mag, axis=1)
        threshold = 0.85 * cumsum[:, -1:]
        rolloff_idx = np.argmax(cumsum >= threshold, axis=1)
        rolloff = freqs[rolloff_idx]
        rolloff_mean, rolloff_std = float(np.mean(rolloff)), float(np.std(rolloff))

        # Spectral flatness
        geo_mean = np.exp(np.mean(np.log(fft_mag + 1e-10), axis=1))
        arith_mean = np.mean(fft_mag, axis=1) + 1e-10
        flatness = geo_mean / arith_mean
        flatness_mean, flatness_std = float(np.mean(flatness)), float(np.std(flatness))

        # 8-band energy distribution（normalize by sr）
        n_bands = 8
        band_size = fft_mag.shape[1] // n_bands
        band_energy = np.array([
            float(np.mean(fft_mag[:, i * band_size: (i + 1) * band_size]))
            for i in range(n_bands)
        ])
        band_sum = np.sum(band_energy) + 1e-10
        band_energy = band_energy / band_sum

        features = np.array([
            zcr_mean, zcr_std,
            energy_mean, energy_std,
            centroid_mean / sr, centroid_std / sr,
            bandwidth_mean / sr, bandwidth_std / sr,
            rolloff_mean / sr, rolloff_std / sr,
            flatness_mean, flatness_std,
            *band_energy,
        ], dtype=np.float32)  # 20-d

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
