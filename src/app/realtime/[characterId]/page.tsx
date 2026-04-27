/**
 * 即時撥號頁面（Phase 2 + 環境偵測）
 *
 * 路由：/realtime/[characterId]
 *
 * 功能：
 *   - 進入 LiveKit room（用 /api/livekit/token 簽的 JWT）
 *   - 5 顆環境健康燈：token / mic / room / agent / audio
 *   - 即時 diagnostic log（最後 50 條）
 *   - 一鍵複製診斷資訊
 *   - 接收 agent audio track + 字幕 data channel
 *   - 掛斷
 *
 * 紅線：樣式中性、命名清楚（Adam 之後會自己換皮）。
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
  ConnectionQuality,
} from 'livekit-client';

type CallState = 'idle' | 'connecting' | 'connected' | 'waiting-agent' | 'in-call' | 'disconnected' | 'error';

interface Caption {
  who: 'user' | 'agent';
  text: string;
  ts: number;
}

interface Health {
  token: 'unknown' | 'ok' | 'fail';
  mic: 'unknown' | 'ok' | 'fail';
  micLevel: number; // 0-1 RMS
  micDevice: string;
  room: 'unknown' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  agent: 'unknown' | 'present' | 'absent';
  audio: 'unknown' | 'subscribed' | 'absent';
  netQuality: 'unknown' | 'excellent' | 'good' | 'poor' | 'lost';
}

interface DiagLog {
  ts: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

interface Diag {
  livekitUrl: string;
  roomName: string;
  identity: string;
}

const INITIAL_HEALTH: Health = {
  token: 'unknown',
  mic: 'unknown',
  micLevel: 0,
  micDevice: '',
  room: 'unknown',
  agent: 'unknown',
  audio: 'unknown',
  netQuality: 'unknown',
};

export default function RealtimeCallPage() {
  const params = useParams<{ characterId: string }>();
  const characterId = params.characterId;

  const [state, setState] = useState<CallState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [characterName, setCharacterName] = useState(characterId);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [health, setHealth] = useState<Health>(INITIAL_HEALTH);
  const [diagLogs, setDiagLogs] = useState<DiagLog[]>([]);
  const [diag, setDiag] = useState<Diag>({ livekitUrl: '', roomName: '', identity: '' });
  const [showHealth, setShowHealth] = useState(true);

  const roomRef = useRef<Room | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const callStartRef = useRef<number>(0);
  const micAnalyserRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; raf: number } | null>(null);

  const log = (level: DiagLog['level'], msg: string) => {
    setDiagLogs(prev => [...prev.slice(-49), { ts: Date.now(), level, msg }]);
    if (level === 'error') console.error('[realtime]', msg);
    else console.log('[realtime]', msg);
  };

  // 通話時長
  useEffect(() => {
    if (state !== 'in-call' && state !== 'waiting-agent') return;
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - callStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [state]);

  // 麥克風 RMS 監控（用 Web Audio API）
  const startMicMonitor = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tracks = stream.getAudioTracks();
      const deviceLabel = tracks[0]?.label || 'unknown';
      setHealth(h => ({ ...h, mic: 'ok', micDevice: deviceLabel }));
      log('info', `mic acquired: ${deviceLabel}`);

      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);

      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setHealth(h => ({ ...h, micLevel: rms }));
        const raf = requestAnimationFrame(tick);
        if (micAnalyserRef.current) micAnalyserRef.current.raf = raf;
      };
      tick();
      micAnalyserRef.current = { ctx, analyser, raf: 0 };
      return stream;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setHealth(h => ({ ...h, mic: 'fail' }));
      log('error', `mic FAIL: ${msg}`);
      throw e;
    }
  };

  const stopMicMonitor = () => {
    if (micAnalyserRef.current) {
      cancelAnimationFrame(micAnalyserRef.current.raf);
      micAnalyserRef.current.ctx.close();
      micAnalyserRef.current = null;
    }
  };

  const handleConnect = async () => {
    setState('connecting');
    setErrorMsg('');
    setHealth(INITIAL_HEALTH);
    setDiagLogs([]);
    log('info', `connect start, characterId=${characterId}`);

    try {
      // 1. 先拿 mic（瀏覽器 permission 通常會 prompt）
      log('info', 'requesting microphone...');
      await startMicMonitor();

      // 2. 拿 token
      log('info', 'POST /api/livekit/token');
      const tokenRes = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        setHealth(h => ({ ...h, token: 'fail' }));
        log('error', `token API ${tokenRes.status}: ${err.error || 'no detail'}`);
        throw new Error(err.error || `token API ${tokenRes.status}`);
      }
      const { token, url, roomName, identity } = await tokenRes.json();
      setHealth(h => ({ ...h, token: 'ok' }));
      setDiag({ livekitUrl: url, roomName, identity });
      log('info', `token OK, room=${roomName}, url=${url}`);

      // 3. 建 Room + 監聽事件
      const room = new Room({ adaptiveStream: true, dynacast: true });

      room
        .on(RoomEvent.ConnectionStateChanged, (s: ConnectionState) => {
          log('info', `room state: ${s}`);
          setHealth(h => ({
            ...h,
            room: s === ConnectionState.Connected ? 'connected'
                : s === ConnectionState.Connecting ? 'connecting'
                : s === ConnectionState.Reconnecting ? 'reconnecting'
                : 'disconnected',
          }));
          if (s === ConnectionState.Disconnected) setState('disconnected');
        })
        .on(RoomEvent.ConnectionQualityChanged, (q: ConnectionQuality, p) => {
          if (p?.isLocal) {
            const map: Record<string, Health['netQuality']> = {
              excellent: 'excellent', good: 'good', poor: 'poor', lost: 'lost', unknown: 'unknown',
            };
            setHealth(h => ({ ...h, netQuality: map[q] || 'unknown' }));
          }
        })
        .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
          log('info', `participant joined: ${p.identity}`);
          if (p.identity.startsWith('agent-') || p.identity.includes('agent')) {
            setHealth(h => ({ ...h, agent: 'present' }));
            setState('in-call');
          }
        })
        .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
          log('warn', `participant left: ${p.identity}`);
          if (p.identity.startsWith('agent-') || p.identity.includes('agent')) {
            setHealth(h => ({ ...h, agent: 'absent' }));
          }
        })
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, p: RemoteParticipant) => {
          log('info', `track subscribed: kind=${track.kind} from=${p.identity}`);
          if (track.kind === Track.Kind.Audio) {
            if (audioElRef.current) track.attach(audioElRef.current);
            setHealth(h => ({ ...h, audio: 'subscribed' }));
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          log('warn', `track unsubscribed: kind=${track.kind}`);
          if (track.kind === Track.Kind.Audio) {
            setHealth(h => ({ ...h, audio: 'absent' }));
          }
        })
        .on(RoomEvent.DataReceived, (payload: Uint8Array) => {
          try {
            const text = new TextDecoder().decode(payload);
            const msg = JSON.parse(text);
            if (msg.type === 'caption' && msg.text) {
              setCaptions(prev => [...prev, { who: msg.who || 'agent', text: msg.text, ts: Date.now() }]);
            } else if (msg.type === 'character' && msg.name) {
              setCharacterName(msg.name);
            }
          } catch { /* ignore */ }
        });

      log('info', `connecting to ${url}...`);
      await room.connect(url, token);
      log('info', `room.connect resolved, name=${room.name}`);

      // 開麥（room 自己會用 getUserMedia）
      await room.localParticipant.setMicrophoneEnabled(true);
      log('info', 'mic published to room');

      // 檢查目前已在房內的 agent participant（race condition: agent 可能比我先進房）
      room.remoteParticipants.forEach(p => {
        if (p.identity.startsWith('agent-') || p.identity.includes('agent')) {
          setHealth(h => ({ ...h, agent: 'present' }));
          setState('in-call');
          log('info', `agent already in room: ${p.identity}`);
        }
      });

      roomRef.current = room;
      callStartRef.current = Date.now();
      if (state !== 'in-call') setState('waiting-agent');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setState('error');
      log('error', msg);
    }
  };

  const handleDisconnect = async () => {
    log('info', 'disconnect requested');
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
    }
    stopMicMonitor();
    setState('disconnected');
    setElapsed(0);
  };

  const handleCopyDiag = () => {
    const lines = [
      `=== ailive realtime diag ===`,
      `time: ${new Date().toISOString()}`,
      `characterId: ${characterId}`,
      `state: ${state}`,
      `health: ${JSON.stringify(health)}`,
      `diag: ${JSON.stringify(diag)}`,
      `errorMsg: ${errorMsg}`,
      `userAgent: ${navigator.userAgent}`,
      ``,
      `=== logs (last 50) ===`,
      ...diagLogs.map(l => `[${new Date(l.ts).toISOString().slice(11,23)}] ${l.level.toUpperCase()} ${l.msg}`),
    ].join('\n');
    navigator.clipboard.writeText(lines).then(
      () => log('info', 'diag copied to clipboard'),
      () => log('error', 'clipboard write failed; check console'),
    );
    console.log(lines);
  };

  // 卸載清理
  useEffect(() => {
    return () => {
      if (roomRef.current) void roomRef.current.disconnect();
      stopMicMonitor();
    };
  }, []);

  return (
    <RealtimeCallShell>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>即時通話（Phase 2 偵測版）</h1>
        <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
          角色：{characterName} <span style={{ opacity: 0.5 }}>({characterId})</span>
        </div>
      </header>

      <CallStatusBadge state={state} elapsed={elapsed} />
      <CallControls state={state} onConnect={handleConnect} onDisconnect={handleDisconnect} />

      {errorMsg && (
        <div style={{ padding: 10, background: '#fee', color: '#c00', borderRadius: 4, marginTop: 12, fontSize: 13 }}>
          錯誤：{errorMsg}
        </div>
      )}

      <HealthPanel
        health={health}
        diag={diag}
        diagLogs={diagLogs}
        show={showHealth}
        onToggle={() => setShowHealth(v => !v)}
        onCopy={handleCopyDiag}
      />

      <LiveCaption captions={captions} />

      <audio ref={audioElRef} autoPlay playsInline />
    </RealtimeCallShell>
  );
}

function RealtimeCallShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 720, margin: '32px auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#222' }}>
      {children}
    </div>
  );
}

function CallStatusBadge({ state, elapsed }: { state: CallState; elapsed: number }) {
  const labels: Record<CallState, string> = {
    idle: '尚未連線', connecting: '連線中…', connected: '已進房',
    'waiting-agent': '等待 agent…', 'in-call': '通話中',
    disconnected: '已掛斷', error: '錯誤',
  };
  const colors: Record<CallState, string> = {
    idle: '#999', connecting: '#e8a900', connected: '#2a82e8',
    'waiting-agent': '#e8a900', 'in-call': '#2a8a2a',
    disconnected: '#666', error: '#c00',
  };
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: colors[state], display: 'inline-block' }} />
      <span style={{ fontSize: 14 }}>{labels[state]}</span>
      {(state === 'in-call' || state === 'waiting-agent') && (
        <span style={{ fontSize: 13, color: '#666', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {String(min).padStart(2, '0')}:{String(sec).padStart(2, '0')}
        </span>
      )}
    </div>
  );
}

function CallControls({ state, onConnect, onDisconnect }: {
  state: CallState; onConnect: () => void; onDisconnect: () => void;
}) {
  const canConnect = state === 'idle' || state === 'disconnected' || state === 'error';
  const canDisconnect = state === 'connected' || state === 'waiting-agent' || state === 'in-call';
  return (
    <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
      <button onClick={onConnect} disabled={!canConnect} style={btn(canConnect ? '#2a8a2a' : '#ccc')}>
        進入通話
      </button>
      <button onClick={onDisconnect} disabled={!canDisconnect} style={btn(canDisconnect ? '#c00' : '#ccc')}>
        掛斷
      </button>
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    padding: '8px 18px', fontSize: 14,
    background: bg, color: '#fff',
    border: 'none', borderRadius: 4,
    cursor: bg === '#ccc' ? 'not-allowed' : 'pointer',
  };
}

function HealthPanel({
  health, diag, diagLogs, show, onToggle, onCopy,
}: {
  health: Health; diag: Diag; diagLogs: DiagLog[];
  show: boolean; onToggle: () => void; onCopy: () => void;
}) {
  return (
    <div style={{ marginTop: 18, border: '1px solid #ddd', borderRadius: 4, background: '#fafafa' }}>
      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: show ? '1px solid #ddd' : 'none' }}>
        <button onClick={onToggle} style={{ background: 'transparent', border: 'none', fontSize: 13, cursor: 'pointer', color: '#333' }}>
          {show ? '▼' : '▶'} 環境偵測
        </button>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <Lamp label="token" status={lampOf(health.token, ['ok'], ['fail'])} />
          <Lamp label="mic" status={lampOf(health.mic, ['ok'], ['fail'])} extra={health.mic === 'ok' ? `${(health.micLevel * 100).toFixed(0)}%` : undefined} />
          <Lamp label="room" status={lampOf(health.room, ['connected'], ['disconnected'])} />
          <Lamp label="agent" status={lampOf(health.agent, ['present'], ['absent'])} />
          <Lamp label="audio" status={lampOf(health.audio, ['subscribed'], ['absent'])} />
        </div>
        <button onClick={onCopy} style={{ marginLeft: 8, fontSize: 12, padding: '3px 8px', background: '#fff', border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer' }}>
          複製診斷
        </button>
      </div>

      {show && (
        <>
          <div style={{ padding: 10, fontSize: 12, color: '#444', borderBottom: '1px solid #eee', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
            <strong>mic device</strong><span>{health.micDevice || '—'}</span>
            <strong>livekit url</strong><span style={{ wordBreak: 'break-all' }}>{diag.livekitUrl || '—'}</span>
            <strong>room</strong><span style={{ wordBreak: 'break-all' }}>{diag.roomName || '—'}</span>
            <strong>identity</strong><span>{diag.identity || '—'}</span>
            <strong>net quality</strong><span>{health.netQuality}</span>
          </div>

          <div style={{ padding: 10, fontSize: 11, fontFamily: 'ui-monospace, monospace', maxHeight: 220, overflowY: 'auto', background: '#fff' }}>
            {diagLogs.length === 0 ? (
              <span style={{ color: '#999' }}>（按進入通話後會顯示診斷日誌）</span>
            ) : diagLogs.map((l, i) => (
              <div key={i} style={{ color: l.level === 'error' ? '#c00' : l.level === 'warn' ? '#a80' : '#333' }}>
                <span style={{ color: '#999' }}>[{new Date(l.ts).toISOString().slice(11, 19)}]</span> {l.msg}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function lampOf<T extends string>(value: T, okValues: T[], failValues: T[]): 'ok' | 'fail' | 'unknown' {
  if (okValues.includes(value)) return 'ok';
  if (failValues.includes(value)) return 'fail';
  return 'unknown';
}

function Lamp({ label, status, extra }: { label: string; status: 'ok' | 'fail' | 'unknown'; extra?: string }) {
  const bg = status === 'ok' ? '#2a8a2a' : status === 'fail' ? '#c00' : '#bbb';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: bg }} />
      <span>{label}{extra ? ` ${extra}` : ''}</span>
    </span>
  );
}

function LiveCaption({ captions }: { captions: Caption[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [captions.length]);
  if (captions.length === 0) {
    return (
      <div style={{ marginTop: 16, padding: 16, background: '#fafafa', borderRadius: 4, color: '#999', fontSize: 13 }}>
        即時字幕（agent 未上線時不會出現）
      </div>
    );
  }
  return (
    <div style={{ marginTop: 16, padding: 12, background: '#fafafa', borderRadius: 4, maxHeight: 280, overflowY: 'auto', fontSize: 13 }}>
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
