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
  visualIdentity?: { characterSheet?: string };
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

// Web Speech API 支援偵測
const hasSpeechRecognition = () =>
  typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

export default function VoicePage() {
  const { id: characterId } = useParams<{ id: string }>();
  const [char, setChar] = useState<Character | null>(null);
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState(''); // Web Speech 即時文字
  const [reply, setReply] = useState('');
  const [statusText, setStatusText] = useState('按下開始說話');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [endDone, setEndDone] = useState(false);
  const [insightCount, setInsightCount] = useState(0);
  const [usingSpeechAPI, setUsingSpeechAPI] = useState(false);

  // refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speechRecRef = useRef<any>(null);
  const finalTranscriptRef = useRef('');

  useEffect(() => {
    fetch(`/api/characters/${characterId}`)
      .then(r => r.json())
      .then(d => setChar(d.character));
    const saved = localStorage.getItem(`conv-${characterId}`);
    if (saved) setConversationId(saved);
    setUsingSpeechAPI(hasSpeechRecognition());
  }, [characterId]);

  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  // ===== 送出文字給角色（共用邏輯）=====
  const sendToDialogue = useCallback(async (userText: string) => {
    setState('processing');
    setTranscript(userText);
    setInterimText('');
    setStatusText(`${char?.name || '角色'} 思考中...`);

    try {
      const dlgRes = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId,
          userId: `voice-${characterId}`,
          message: userText,
          conversationId,
          voiceMode: true,
        }),
      });
      const dlgData = await dlgRes.json() as { reply?: string; conversationId?: string; error?: string };
      if (!dlgData.reply) throw new Error(dlgData.error || 'dialogue 失敗');

      const replyText = dlgData.reply;
      setReply(replyText);

      if (dlgData.conversationId) {
        setConversationId(dlgData.conversationId);
        localStorage.setItem(`conv-${characterId}`, dlgData.conversationId);
      }

      const now = new Date().toISOString();
      setMessages(prev => [...prev,
        { role: 'user', content: userText, timestamp: now },
        { role: 'assistant', content: replyText, timestamp: now },
      ]);

      setState('playing');
      setStatusText(`${char?.name || '角色'} 說話中...`);

      const ttsRes = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: replyText, voiceId: char?.voiceId }),
      });

      if (!ttsRes.ok) throw new Error('TTS 失敗');
      const audioBlob = await ttsRes.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        setState('idle');
        setStatusText('按下繼續說話');
        setEndDone(false);
      };
      await audio.play();

    } catch (err) {
      console.error(err);
      setState('idle');
      setStatusText(`⚠️ ${err instanceof Error ? err.message : '發生錯誤'}`);
    }
  }, [char, characterId, conversationId]);

  // ===== Web Speech API 錄音 =====
  const startWebSpeech = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return false;

    const recognition = new SR();
    recognition.lang = 'zh-TW';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    finalTranscriptRef.current = '';
    speechRecRef.current = recognition;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          final += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      if (final) finalTranscriptRef.current += final;
      setInterimText(interim);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (e: any) => {
      console.error('SpeechRecognition error:', e.error);
      setState('idle');
      setStatusText(`⚠️ 語音辨識錯誤：${e.error}`);
    };

    recognition.start();
    setState('recording');
    setTranscript('');
    setInterimText('');
    setReply('');
    setEndDone(false);
    setStatusText('錄音中... 再按一下送出');
    return true;
  }, []);

  // ===== Gemini STT 錄音（fallback）=====
  const startGeminiSTT = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(100);
      mediaRecorderRef.current = mr;
      setState('recording');
      setTranscript('');
      setReply('');
      setEndDone(false);
      setStatusText('錄音中... 再按一下送出');
    } catch {
      setStatusText('⚠️ 請允許麥克風權限');
    }
  }, []);

  // ===== 停止 Web Speech 並送出 =====
  const stopWebSpeechAndSend = useCallback(() => {
    const recognition = speechRecRef.current;
    if (recognition) {
      recognition.onend = async () => {
        const text = (finalTranscriptRef.current || '').trim();
        if (!text) {
          setState('idle');
          setStatusText('沒有聽到內容，再試一次');
          return;
        }
        await sendToDialogue(text);
      };
      recognition.stop();
    }
    setState('processing');
    setStatusText('正在處理...');
  }, [sendToDialogue]);

  // ===== 停止 Gemini STT 並送出 =====
  const stopGeminiAndSend = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    setState('processing');
    setStatusText('正在聆聽...');

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
      else startGeminiSTT();
    } else if (state === 'recording') {
      if (usingSpeechAPI) stopWebSpeechAndSend();
      else stopGeminiAndSend();
    } else if (state === 'playing') {
      audioRef.current?.pause();
      setState('idle');
      setStatusText('按下繼續說話');
    }
  }, [state, usingSpeechAPI, startWebSpeech, startGeminiSTT, stopWebSpeechAndSend, stopGeminiAndSend]);

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
      setStatusText(data.saved ? `✓ ${char?.name} 記住了這次對話` : '對話已結束');
    } catch {
      setStatusText('記憶整理完成');
      setEndDone(true);
    } finally {
      setState('idle');
    }
  }, [conversationId, characterId, char, state]);

  const isWaveActive = state === 'recording' || state === 'playing';
  const btnColor =
    state === 'recording' ? '#ef4444' :
    state === 'processing' || state === 'ending' ? '#6b7280' :
    state === 'playing' ? '#8b5cf6' : '#1a1a2e';

  const btnLabel =
    state === 'idle' ? (messages.length === 0 ? '開始' : '繼續') :
    state === 'recording' ? '送出' :
    state === 'processing' ? '...' :
    state === 'playing' ? '⏸' :
    state === 'ending' ? '...' : '開始';

  if (!char) return (
    <div style={{ minHeight: '100vh', background: '#0a0a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 16 }}>載入中...</div>
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', padding: '24px', position: 'relative',
    }}>
      <a href={`/dashboard/${characterId}`} style={{
        position: 'absolute', top: 20, left: 20,
        color: 'rgba(255,255,255,0.4)', textDecoration: 'none', fontSize: 14,
      }}>← 返回</a>

      {/* STT 模式提示 */}
      <div style={{ position: 'absolute', top: 20, right: 20, fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
        {usingSpeechAPI ? '⚡ 即時辨識' : '☁️ 雲端辨識'}
      </div>

      {/* 角色名稱 */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 6, letterSpacing: 2 }}>與</div>
        <div style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>{char.name}</div>
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 4 }}>
          {char.mission?.slice(0, 40) || '語音對話'}
        </div>
      </div>

      {/* 聲波 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, height: 100, marginBottom: 48 }}>
        {Array.from({ length: 15 }).map((_, i) => (
          <WaveBar key={i} active={isWaveActive} index={i} />
        ))}
      </div>

      {/* 主按鈕 */}
      <button
        onClick={handleMainButton}
        disabled={state === 'processing' || state === 'ending'}
        style={{
          width: 140, height: 140, borderRadius: '50%',
          background: btnColor,
          border: `4px solid ${state === 'recording' ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.1)'}`,
          color: '#fff', fontSize: 20, fontWeight: 700,
          cursor: state === 'processing' || state === 'ending' ? 'default' : 'pointer',
          boxShadow: isWaveActive
            ? `0 0 60px ${state === 'recording' ? 'rgba(239,68,68,0.5)' : 'rgba(139,92,246,0.5)'}`
            : '0 0 30px rgba(26,26,46,0.8)',
          transition: 'all 0.3s ease',
        }}
      >
        {btnLabel}
      </button>

      {/* 狀態 + 即時文字 */}
      <div style={{ marginTop: 28, textAlign: 'center', minHeight: 44, maxWidth: 300 }}>
        {state === 'recording' && interimText ? (
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, lineHeight: 1.5 }}>
            {interimText}
          </div>
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>{statusText}</div>
        )}
      </div>

      {/* 角色回覆 */}
      {reply && (
        <div style={{
          marginTop: 20,
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 16, padding: '16px 20px', maxWidth: 320,
          color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 1.7,
          textAlign: 'center', border: '1px solid rgba(255,255,255,0.08)',
        }}>
          {reply.slice(0, 120)}{reply.length > 120 ? '...' : ''}
        </div>
      )}

      {/* 結束對話 */}
      {messages.length >= 2 && !endDone && state === 'idle' && (
        <button onClick={endConversation} style={{
          marginTop: 32, padding: '10px 24px', borderRadius: 24,
          border: '1px solid rgba(255,255,255,0.15)', background: 'transparent',
          color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer',
        }}>
          結束對話，讓{char.name}帶走記憶
        </button>
      )}

      {endDone && (
        <div style={{
          marginTop: 28, padding: '12px 24px', borderRadius: 24,
          background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)',
          color: 'rgba(52,211,153,0.9)', fontSize: 13, textAlign: 'center',
        }}>
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
