'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

type VoiceState = 'idle' | 'recording' | 'processing' | 'playing' | 'ending';

interface Character {
  id: string;
  name: string;
  mission: string;
  type: string;
  voiceId?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

function WaveBar({ active, index }: { active: boolean; index: number }) {
  const heights = [20, 35, 50, 65, 80, 65, 50, 35, 20, 30, 55, 70, 45, 60, 35];
  const h = heights[index % heights.length];
  return (
    <div style={{
      width: 4, borderRadius: 4,
      background: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.25)',
      height: active ? `${h}px` : '8px',
      transition: active
        ? `height ${0.3 + (index % 5) * 0.07}s ease ${(index % 7) * 0.04}s, background 0.3s`
        : 'height 0.4s ease, background 0.3s',
    }} />
  );
}

const hasSpeechRecognition = () =>
  typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

export default function VoicePage() {
  const { id: characterId } = useParams<{ id: string }>();
  const [char, setChar] = useState<Character | null>(null);
  const [state, setState] = useState<VoiceState>('idle');
  const [interimText, setInterimText] = useState('');
  const [reply, setReply] = useState('');
  const [statusText, setStatusText] = useState('按下開始說話');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [endDone, setEndDone] = useState(false);
  const [insightCount, setInsightCount] = useState(0);
  const [usingSpeechAPI] = useState(hasSpeechRecognition);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speechRecRef = useRef<any>(null);
  const finalTextRef = useRef(''); // 累積最終辨識結果

  useEffect(() => {
    fetch(`/api/characters/${characterId}`)
      .then(r => r.json())
      .then(d => setChar(d.character));
    const saved = localStorage.getItem(`conv-${characterId}`);
    if (saved) setConversationId(saved);
  }, [characterId]);

  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  // ===== 共用：送文字給角色（Claude Streaming + TTS）=====
  const sendToDialogue = useCallback(async (userText: string) => {
    if (!userText.trim()) {
      setState('idle');
      setStatusText('沒有聽到內容，再試一次');
      return;
    }

    setState('processing');
    setInterimText('');
    setStatusText(`你說：${userText.slice(0, 30)}${userText.length > 30 ? '...' : ''}`);

    try {
      await new Promise(r => setTimeout(r, 200));
      setStatusText(`${char?.name || '角色'} 思考中...`);

      // ✅ voice-stream：Claude streaming + TTS pipeline
      const res = await fetch('/api/voice-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId,
          userId: `voice-${characterId}`,
          message: userText,
          conversationId,
        }),
      });

      if (!res.ok || !res.body) throw new Error('voice-stream 連線失敗');

      // ✅ 音訊播放佇列（句子按順序播）
      let mediaSource: MediaSource | null = null;
      let sourceBuffer: SourceBuffer | null = null;
      let audio: HTMLAudioElement | null = null;
      const audioQueue: Uint8Array[] = [];
      let isAppending = false;
      let streamDone = false;
      let pendingSentences = 0;
      let playedSentences = 0;
      let fullReplyText = '';

      const initAudio = () => {
        if (audio) return;
        mediaSource = new MediaSource();
        const url = URL.createObjectURL(mediaSource);
        audio = new Audio(url);
        audioRef.current = audio;

        mediaSource.addEventListener('sourceopen', () => {
          try {
            sourceBuffer = mediaSource!.addSourceBuffer('audio/mpeg');
            sourceBuffer.addEventListener('updateend', drainQueue);
            drainQueue();
          } catch (_e) {}
        }, { once: true });

        audio.play().catch(() => {});
        setState('playing');
        setStatusText(`${char?.name || '角色'} 說話中...`);
      };

      const drainQueue = () => {
        if (isAppending || !sourceBuffer || sourceBuffer.updating) return;
        if (audioQueue.length === 0) {
          if (streamDone && mediaSource && mediaSource.readyState === 'open') {
            try { mediaSource.endOfStream(); } catch (_e) {}
          }
          return;
        }
        isAppending = true;
        const chunk = audioQueue.shift()!;
        try {
          sourceBuffer!.appendBuffer(chunk.buffer as ArrayBuffer);
        } catch (_e) {}
        isAppending = false;
      };

      // ✅ 讀 SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string; content?: string; chunk?: string;
              index?: number; fullText?: string; conversationId?: string; message?: string;
            };

            if (event.type === 'text' && event.content) {
              // 第一句文字到 → 初始化音訊
              if (!audio) initAudio();
              pendingSentences++;
              setReply(prev => prev + event.content);
              fullReplyText += event.content;
            }

            if (event.type === 'audio' && event.chunk) {
              // base64 音訊 chunk → 推進播放佇列
              const binary = atob(event.chunk);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              audioQueue.push(bytes);
              drainQueue();
              playedSentences++;
            }

            if (event.type === 'done') {
              if (event.conversationId) {
                setConversationId(event.conversationId);
                localStorage.setItem(`conv-${characterId}`, event.conversationId);
              }
              const now = new Date().toISOString();
              setMessages(prev => [...prev,
                { role: 'user', content: userText, timestamp: now },
                { role: 'assistant', content: fullReplyText || event.fullText || '', timestamp: now },
              ]);
              streamDone = true;
              drainQueue();
            }

            if (event.type === 'error') throw new Error(event.message || 'stream 錯誤');

          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      // 等音訊播完
      if (audio) {
        await new Promise<void>(resolve => {
          const checkEnd = () => {
            if (!audio) { resolve(); return; }
            if (audio.ended || (streamDone && audioQueue.length === 0 && !sourceBuffer?.updating)) {
              resolve();
            } else {
              setTimeout(checkEnd, 200);
            }
          };
          const audioEl = audio; if (audioEl) audioEl.addEventListener('ended', () => resolve(), { once: true });
          setTimeout(checkEnd, 500);
        });
      }

      setState('idle');
      setStatusText('按下繼續說話');
      setEndDone(false);

    } catch (err) {
      setState('idle');
      setStatusText(`⚠️ ${err instanceof Error ? err.message : '發生錯誤'}`);
    }
  }, [char, characterId, conversationId]);

  // ===== Web Speech API =====
  const startWebSpeech = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return false;

    finalTextRef.current = '';
    setInterimText('');
    setReply('');
    setEndDone(false);

    const rec = new SR();
    rec.lang = 'zh-TW';
    rec.interimResults = true;
    rec.continuous = true; // ✅ 持續辨識，不自動停
    rec.maxAlternatives = 1;
    speechRecRef.current = rec;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTextRef.current += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      setInterimText(interim);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      if (e.error === 'no-speech') return; // 靜默不算錯
      setState('idle');
      setStatusText(`⚠️ 辨識錯誤：${e.error}`);
    };

    rec.start();
    setState('recording');
    setStatusText('錄音中... 再按一下送出');
    return true;
  }, []);

  const stopWebSpeechAndSend = useCallback(() => {
    const rec = speechRecRef.current;
    if (rec) {
      try { rec.stop(); } catch { /* already stopped */ }
      speechRecRef.current = null;
    }
    // ✅ 關鍵修正：直接讀已有的文字，不等 onend
    const text = (finalTextRef.current + ' ' + interimText).trim();
    sendToDialogue(text);
  }, [interimText, sendToDialogue]);

  // ===== Gemini STT fallback =====
  const startGemini = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(100);
      mediaRecorderRef.current = mr;
      setState('recording');
      setReply('');
      setEndDone(false);
      setStatusText('錄音中... 再按一下送出');
    } catch {
      setStatusText('⚠️ 請允許麥克風權限');
    }
  }, []);

  const stopGeminiAndSend = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    setState('processing');
    setStatusText('轉換語音中...');

    mr.onstop = async () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      try {
        const form = new FormData();
        form.append('audio', blob, 'audio.webm');
        const sttRes = await fetch('/api/stt', { method: 'POST', body: form });
        const sttData = await sttRes.json() as { text?: string; error?: string };
        if (!sttData.text) throw new Error(sttData.error || 'STT 失敗');
        await sendToDialogue(sttData.text);
      } catch (err) {
        setState('idle');
        setStatusText(`⚠️ ${err instanceof Error ? err.message : '發生錯誤'}`);
      }
    };
    mr.stop();
  }, [sendToDialogue]);

  // ===== 主按鈕 =====
  const handleMainButton = useCallback(() => {
    if (state === 'idle') {
      if (usingSpeechAPI) startWebSpeech();
      else startGemini();
    } else if (state === 'recording') {
      if (usingSpeechAPI) stopWebSpeechAndSend();
      else stopGeminiAndSend();
    } else if (state === 'playing') {
      audioRef.current?.pause();
      setState('idle');
      setStatusText('按下繼續說話');
    }
  }, [state, usingSpeechAPI, startWebSpeech, startGemini, stopWebSpeechAndSend, stopGeminiAndSend]);

  // ===== 結束對話 =====
  const endConversation = useCallback(async () => {
    if (!conversationId || state !== 'idle') return;
    setState('ending');
    setStatusText('整理記憶中...');
    try {
      const res = await fetch('/api/voice-end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, conversationId }),
      });
      const data = await res.json() as { saved?: number };
      setInsightCount(data.saved || 0);
      setEndDone(true);
    } catch { setEndDone(true); }
    finally { setState('idle'); setStatusText(char?.name ? `✓ ${char.name} 記住了這次對話` : '對話已結束'); }
  }, [conversationId, characterId, char, state]);

  const isWaveActive = state === 'recording' || state === 'playing';
  const btnColor = state === 'recording' ? '#ef4444' : state === 'processing' || state === 'ending' ? '#6b7280' : state === 'playing' ? '#8b5cf6' : '#1a1a2e';
  const btnLabel = state === 'idle' ? (messages.length === 0 ? '開始' : '繼續') : state === 'recording' ? '送出' : state === 'processing' ? '...' : state === 'playing' ? '⏸' : '...';

  if (!char) return (
    <div style={{ minHeight: '100vh', background: '#0a0a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 16 }}>載入中...</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', padding: '24px', position: 'relative' }}>

      <a href={`/dashboard/${characterId}`} style={{ position: 'absolute', top: 20, left: 20, color: 'rgba(255,255,255,0.4)', textDecoration: 'none', fontSize: 14 }}>← 返回</a>

      <div style={{ position: 'absolute', top: 22, right: 20, fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
        {usingSpeechAPI ? '⚡ 即時辨識' : '☁️ 雲端辨識'}
      </div>

      {/* 角色名稱 */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 6, letterSpacing: 2 }}>與</div>
        <div style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>{char.name}</div>
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 4 }}>{char.mission?.slice(0, 40)}</div>
      </div>

      {/* 聲波 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, height: 100, marginBottom: 48 }}>
        {Array.from({ length: 15 }).map((_, i) => <WaveBar key={i} active={isWaveActive} index={i} />)}
      </div>

      {/* 主按鈕 */}
      <button onClick={handleMainButton} disabled={state === 'processing' || state === 'ending'}
        style={{ width: 140, height: 140, borderRadius: '50%', background: btnColor, border: `4px solid ${state === 'recording' ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.1)'}`, color: '#fff', fontSize: 20, fontWeight: 700, cursor: state === 'processing' || state === 'ending' ? 'default' : 'pointer', boxShadow: isWaveActive ? `0 0 60px ${state === 'recording' ? 'rgba(239,68,68,0.5)' : 'rgba(139,92,246,0.5)'}` : '0 0 30px rgba(26,26,46,0.8)', transition: 'all 0.3s ease' }}>
        {btnLabel}
      </button>

      {/* 即時文字 / 狀態 */}
      <div style={{ marginTop: 28, textAlign: 'center', minHeight: 44, maxWidth: 300 }}>
        {state === 'recording' && (finalTextRef.current || interimText) ? (
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 1.6 }}>
            {finalTextRef.current}{interimText && <span style={{ color: 'rgba(255,255,255,0.4)' }}>{interimText}</span>}
          </div>
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>{statusText}</div>
        )}
      </div>

      {/* 角色回覆 */}
      {reply && (
        <div style={{ marginTop: 20, background: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: '16px 20px', maxWidth: 320, color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 1.7, textAlign: 'center', border: '1px solid rgba(255,255,255,0.08)' }}>
          {reply.slice(0, 150)}{reply.length > 150 ? '...' : ''}
        </div>
      )}

      {/* 結束對話 */}
      {messages.length >= 2 && !endDone && state === 'idle' && (
        <button onClick={endConversation} style={{ marginTop: 32, padding: '10px 24px', borderRadius: 24, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}>
          結束對話，讓{char.name}帶走記憶
        </button>
      )}

      {endDone && (
        <div style={{ marginTop: 28, padding: '12px 24px', borderRadius: 24, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', color: 'rgba(52,211,153,0.9)', fontSize: 13, textAlign: 'center' }}>
          ✓ {insightCount > 0 ? `沉澱了 ${insightCount} 條記憶` : '對話已結束'}
        </div>
      )}

      {messages.length > 0 && (
        <div style={{ position: 'absolute', bottom: 24, color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
          {messages.length / 2} 輪對話
        </div>
      )}
    </div>
  );
}
