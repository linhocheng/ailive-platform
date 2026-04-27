/**
 * 即時撥號頁面（即時通話模式 Phase 1 最小可用 UI 殼）
 *
 * 路由：/realtime/[characterId]
 *
 * 功能：
 *   - 進入 LiveKit room（用 /api/livekit/token 簽的 JWT）
 *   - 顯示角色名 + 連線狀態 + 通話時長
 *   - 麥克風自動發布（進房就開麥）
 *   - 接收 agent 端的 audio track + data channel 字幕
 *   - 掛斷
 *
 * 紅線：樣式中性，命名清楚（Adam 之後會自己換皮）。
 *   - RealtimeCallShell : 整頁 layout
 *   - CallStatusBadge   : 狀態徽章
 *   - LiveCaption       : 即時字幕
 *   - CallControls      : 進入/掛斷按鈕
 *
 * Phase 1 限制：agent 還沒接通，進房後只會看到「等待 agent」狀態，沒 AI 回應。
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Track,
  ConnectionState,
} from 'livekit-client';

type CallState = 'idle' | 'connecting' | 'connected' | 'waiting-agent' | 'in-call' | 'disconnected' | 'error';

interface Caption {
  who: 'user' | 'agent';
  text: string;
  ts: number;
}

export default function RealtimeCallPage() {
  const params = useParams<{ characterId: string }>();
  const characterId = params.characterId;

  const [state, setState] = useState<CallState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [characterName, setCharacterName] = useState(characterId);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const callStartRef = useRef<number>(0);

  // 通話時長計時
  useEffect(() => {
    if (state !== 'in-call' && state !== 'waiting-agent') return;
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - callStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [state]);

  const handleConnect = async () => {
    setState('connecting');
    setErrorMsg('');
    try {
      const tokenRes = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.error || `token API ${tokenRes.status}`);
      }
      const { token, url } = await tokenRes.json();

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      room
        .on(RoomEvent.ConnectionStateChanged, (s: ConnectionState) => {
          if (s === ConnectionState.Disconnected) setState('disconnected');
        })
        .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
          if (p.identity.startsWith('agent-')) setState('in-call');
        })
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, p: RemoteParticipant) => {
          if (track.kind === Track.Kind.Audio && audioElRef.current) {
            track.attach(audioElRef.current);
          }
          void p;
        })
        .on(RoomEvent.DataReceived, (payload: Uint8Array, _participant) => {
          try {
            const text = new TextDecoder().decode(payload);
            const msg = JSON.parse(text);
            if (msg.type === 'caption' && msg.text) {
              setCaptions(prev => [...prev, { who: msg.who || 'agent', text: msg.text, ts: Date.now() }]);
            } else if (msg.type === 'character' && msg.name) {
              setCharacterName(msg.name);
            }
          } catch {
            // 忽略解析失敗的 data
          }
        });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);

      roomRef.current = room;
      callStartRef.current = Date.now();
      setState('waiting-agent');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  };

  const handleDisconnect = async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
    }
    setState('disconnected');
    setElapsed(0);
  };

  // 卸載時清理
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        void roomRef.current.disconnect();
      }
    };
  }, []);

  return (
    <RealtimeCallShell>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>即時通話</h1>
        <div style={{ fontSize: 14, color: '#666', marginTop: 4 }}>
          角色：{characterName} <span style={{ opacity: 0.5 }}>（{characterId}）</span>
        </div>
      </header>

      <CallStatusBadge state={state} elapsed={elapsed} />

      {errorMsg && (
        <div style={{ padding: 12, background: '#fee', color: '#c00', borderRadius: 4, marginTop: 12, fontSize: 13 }}>
          錯誤：{errorMsg}
        </div>
      )}

      <CallControls state={state} onConnect={handleConnect} onDisconnect={handleDisconnect} />

      <LiveCaption captions={captions} />

      <audio ref={audioElRef} autoPlay playsInline />
    </RealtimeCallShell>
  );
}

function RealtimeCallShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 600,
        margin: '40px auto',
        padding: 24,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#222',
      }}
    >
      {children}
    </div>
  );
}

function CallStatusBadge({ state, elapsed }: { state: CallState; elapsed: number }) {
  const labels: Record<CallState, string> = {
    idle: '尚未連線',
    connecting: '連線中…',
    connected: '已進房',
    'waiting-agent': '等待 agent…',
    'in-call': '通話中',
    disconnected: '已掛斷',
    error: '錯誤',
  };
  const colors: Record<CallState, string> = {
    idle: '#999',
    connecting: '#e8a900',
    connected: '#2a82e8',
    'waiting-agent': '#e8a900',
    'in-call': '#2a8a2a',
    disconnected: '#666',
    error: '#c00',
  };
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: colors[state],
          display: 'inline-block',
        }}
      />
      <span style={{ fontSize: 14 }}>{labels[state]}</span>
      {(state === 'in-call' || state === 'waiting-agent') && (
        <span style={{ fontSize: 14, color: '#666', marginLeft: 'auto' }}>
          {String(min).padStart(2, '0')}:{String(sec).padStart(2, '0')}
        </span>
      )}
    </div>
  );
}

function CallControls({
  state,
  onConnect,
  onDisconnect,
}: {
  state: CallState;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const canConnect = state === 'idle' || state === 'disconnected' || state === 'error';
  const canDisconnect = state === 'connected' || state === 'waiting-agent' || state === 'in-call';
  return (
    <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
      <button
        onClick={onConnect}
        disabled={!canConnect}
        style={{
          padding: '8px 20px',
          fontSize: 14,
          background: canConnect ? '#2a8a2a' : '#ccc',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: canConnect ? 'pointer' : 'not-allowed',
        }}
      >
        進入通話
      </button>
      <button
        onClick={onDisconnect}
        disabled={!canDisconnect}
        style={{
          padding: '8px 20px',
          fontSize: 14,
          background: canDisconnect ? '#c00' : '#ccc',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: canDisconnect ? 'pointer' : 'not-allowed',
        }}
      >
        掛斷
      </button>
    </div>
  );
}

function LiveCaption({ captions }: { captions: Caption[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [captions.length]);
  if (captions.length === 0) {
    return (
      <div style={{ marginTop: 20, padding: 20, background: '#fafafa', borderRadius: 4, color: '#999', fontSize: 13 }}>
        即時字幕會顯示在這裡（需 agent 上線後）
      </div>
    );
  }
  return (
    <div
      style={{
        marginTop: 20,
        padding: 12,
        background: '#fafafa',
        borderRadius: 4,
        maxHeight: 300,
        overflowY: 'auto',
        fontSize: 13,
      }}
    >
      {captions.map((c, i) => (
        <div key={i} style={{ marginBottom: 6 }}>
          <span style={{ color: c.who === 'user' ? '#2a82e8' : '#2a8a2a', fontWeight: 500 }}>
            {c.who === 'user' ? '你' : '角色'}：
          </span>
          <span>{c.text}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
