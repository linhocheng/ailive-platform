'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  Room, RoomEvent, RemoteParticipant, RemoteTrack, RemoteTrackPublication,
  Track, ConnectionState, ConnectionQuality,
} from 'livekit-client';

type CallState = 'idle' | 'connecting' | 'connected' | 'waiting-agent' | 'in-call' | 'disconnected' | 'error';

interface Caption { who: 'user' | 'agent'; text: string; ts: number; }
interface Health {
  token: 'unknown' | 'ok' | 'fail';
  mic: 'unknown' | 'ok' | 'fail';
  micLevel: number;
  micDevice: string;
  room: 'unknown' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  agent: 'unknown' | 'present' | 'absent';
  audio: 'unknown' | 'subscribed' | 'absent';
  netQuality: 'unknown' | 'excellent' | 'good' | 'poor' | 'lost';
}
interface DiagLog { ts: number; level: 'info' | 'warn' | 'error'; msg: string; }
interface Diag { livekitUrl: string; roomName: string; identity: string; }

const INITIAL_HEALTH: Health = {
  token: 'unknown', mic: 'unknown', micLevel: 0, micDevice: '',
  room: 'unknown', agent: 'unknown', audio: 'unknown', netQuality: 'unknown',
};

// ── Perlin Noise ──
function buildNoise() {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t: number, a: number, b: number) => a + t * (b - a);
  const grad = (hash: number, x: number, y: number, z: number) => {
    const h = hash & 15, u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  return (x: number, y: number, z: number) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X]+Y, AA = perm[A]+Z, AB = perm[A+1]+Z, B = perm[X+1]+Y, BA = perm[B]+Z, BB = perm[B+1]+Z;
    return lerp(w, lerp(v, lerp(u, grad(perm[AA],x,y,z), grad(perm[BA],x-1,y,z)), lerp(u, grad(perm[AB],x,y-1,z), grad(perm[BB],x-1,y-1,z))),
      lerp(v, lerp(u, grad(perm[AA+1],x,y,z-1), grad(perm[BA+1],x-1,y,z-1)), lerp(u, grad(perm[AB+1],x,y-1,z-1), grad(perm[BB+1],x-1,y-1,z-1))));
  };
}

type FlowParams = { noiseScale:number; speed:number; attraction:number; vortex:number; lineWidth:number; noiseZStep:number; colorAlpha:number; hueBase:number; };

// 用戶調好的參數（用戶說話 / 角色說話共用）
const SPEAKING_PARAMS: FlowParams = {
  noiseScale: 0.007, speed: 1.35, attraction: -2.05,
  vortex: 0.0, lineWidth: 2.75, noiseZStep: 0.004, colorAlpha: 0.07, hueBase: 190,
};

const FLOW: Record<string, FlowParams> = {
  idle:       { noiseScale:0.002,  speed:0.8,  attraction:0,    vortex:0.1, lineWidth:0.4, noiseZStep:0.002, colorAlpha:0.08, hueBase:190 },
  processing: { noiseScale:0.05,   speed:0.3,  attraction:3.5,  vortex:0.3, lineWidth:1.0, noiseZStep:0.12,  colorAlpha:0.22, hueBase:280 },
  speaking:   SPEAKING_PARAMS,
};

export default function RealtimeCallPage() {
  const params = useParams<{ characterId: string }>();
  const characterId = params.characterId;
  const search = useSearchParams();
  const userId = (() => {
    const fromQuery = search.get('u');
    if (fromQuery) return fromQuery;
    if (typeof window === 'undefined') return '';
    let stable = window.localStorage.getItem('ailive_realtime_anon_uid');
    if (!stable) {
      stable = `anon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      window.localStorage.setItem('ailive_realtime_anon_uid', stable);
    }
    return stable;
  })();

  const [state, setState] = useState<CallState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [health, setHealth] = useState<Health>(INITIAL_HEALTH);
  const [diagLogs, setDiagLogs] = useState<DiagLog[]>([]);
  const [diag, setDiag] = useState<Diag>({ livekitUrl: '', roomName: '', identity: '' });
  const [micMuted, setMicMuted] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const callStartRef = useRef<number>(0);
  const micAnalyserRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; raf: number } | null>(null);
  const agentAnalyserRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode } | null>(null);
  const micLevelRef = useRef(0);
  const agentLevelRef = useRef(0);

  // ── Canvas ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flowRef = useRef<FlowParams>({ ...FLOW.idle });
  const targetFlowRef = useRef<FlowParams>({ ...FLOW.idle });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const perlin = buildNoise();
    type Pt = { x:number; y:number; prevX:number; prevY:number; velX:number; velY:number; maxSpeed:number; };
    let width = 0, height = 0, particles: Pt[] = [], zOff = 0;
    const mkPt = (): Pt => ({ x: Math.random()*width, y: Math.random()*height, prevX:0, prevY:0, velX:0, velY:0, maxSpeed: 1+Math.random()*2 });
    const resize = () => {
      width = canvas.width = window.innerWidth; height = canvas.height = window.innerHeight;
      particles = Array.from({length:4000}, mkPt);
      particles.forEach(p => { p.prevX=p.x; p.prevY=p.y; });
      ctx.fillStyle='#000'; ctx.fillRect(0,0,width,height);
    };
    const animate = () => {
      // 用戶 mic + 角色 audio 合併驅動粒子
      const level = Math.max(micLevelRef.current, agentLevelRef.current);
      const boosted = Math.pow(Math.min(level * 6, 1), 0.55);
      const base = targetFlowRef.current;
      const tgt: FlowParams = { ...base };
      tgt.speed   = Math.min(base.speed + boosted * 6.7 * 0.4, 6);
      tgt.vortex  = Math.min(base.vortex + boosted * 6.7 * 0.25, 5);
      tgt.attraction = base.attraction + boosted * 6.7;

      const lerpF = boosted > 0.05 ? 0.18 : 0.04;
      const cur = flowRef.current;
      (Object.keys(tgt) as (keyof FlowParams)[]).forEach(k => { cur[k] += (tgt[k] - cur[k]) * lerpF; });

      const p = flowRef.current;
      const isThinking = targetFlowRef.current.hueBase === 280;
      ctx.fillStyle = `rgba(0,0,0,${isThinking ? 0.25 : 0.07})`; ctx.fillRect(0,0,width,height);
      zOff += p.noiseZStep;
      particles.forEach(pt => {
        let angle = perlin(pt.x*p.noiseScale, pt.y*p.noiseScale, zOff) * Math.PI * 4;
        if (isThinking) angle += (Math.random()-0.5)*1.5;
        let accX = Math.cos(angle)*0.4, accY = Math.sin(angle)*0.4;
        const dx = width/2-pt.x, dy = height/2-pt.y, dist = Math.sqrt(dx*dx+dy*dy)||1;
        if (p.attraction !== 0) { accX += (dx/dist)*p.attraction; accY += (dy/dist)*p.attraction; }
        if (p.vortex !== 0) { accX += (-dy/dist)*p.vortex; accY += (dx/dist)*p.vortex; }
        pt.velX += accX; pt.velY += accY;
        let maxSpd = pt.maxSpeed*p.speed;
        if (isThinking) maxSpd *= (0.8+Math.random()*0.4);
        const spd = Math.sqrt(pt.velX**2+pt.velY**2);
        if (spd > maxSpd) { pt.velX=(pt.velX/spd)*maxSpd; pt.velY=(pt.velY/spd)*maxSpd; }
        pt.prevX=pt.x; pt.prevY=pt.y; pt.x+=pt.velX; pt.y+=pt.velY;
        const isActive = p.attraction > 0.5 || p.speed > 1.2;
        if (pt.x<-100||pt.x>width+100||pt.y<-100||pt.y>height+100) {
          if (isActive) { pt.x=width/2+(Math.random()-0.5)*50; pt.y=height/2+(Math.random()-0.5)*50; }
          else { pt.x=Math.random()*width; pt.y=Math.random()*height; }
          pt.prevX=pt.x; pt.prevY=pt.y; pt.velX=0; pt.velY=0;
        }
        ctx.beginPath(); ctx.moveTo(pt.prevX,pt.prevY); ctx.lineTo(pt.x,pt.y);
        const hue = (p.hueBase + Math.sqrt(pt.velX**2+pt.velY**2)*15) % 360;
        ctx.strokeStyle=`hsla(${hue},80%,65%,${p.colorAlpha})`;
        ctx.lineWidth=p.lineWidth; ctx.stroke();
      });
      rafRef.current = requestAnimationFrame(animate);
    };
    resize(); animate();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(rafRef.current); };
  }, []);

  // 狀態 → flow 參數
  const setFlowForState = useCallback((s: CallState) => {
    if (s === 'idle' || s === 'disconnected' || s === 'error') {
      targetFlowRef.current = { ...FLOW.idle };
    } else if (s === 'connecting' || s === 'waiting-agent') {
      targetFlowRef.current = { ...FLOW.processing };
    } else {
      targetFlowRef.current = { ...FLOW.speaking };
    }
  }, []);

  // 通話時長
  useEffect(() => {
    if (state !== 'in-call' && state !== 'waiting-agent') return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - callStartRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [state]);

  const log = (level: DiagLog['level'], msg: string) => {
    setDiagLogs(prev => [...prev.slice(-49), { ts: Date.now(), level, msg }]);
  };

  const startMicMonitor = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const deviceLabel = stream.getAudioTracks()[0]?.label || 'unknown';
      setHealth(h => ({ ...h, mic: 'ok', micDevice: deviceLabel }));
      log('info', `mic: ${deviceLabel}`);
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i]-128)/128; sum += v*v; }
        const rms = Math.sqrt(sum/buf.length);
        micLevelRef.current = rms;
        setHealth(h => ({ ...h, micLevel: rms }));
        const raf = requestAnimationFrame(tick);
        if (micAnalyserRef.current) micAnalyserRef.current.raf = raf;
      };
      tick();
      micAnalyserRef.current = { ctx, analyser, raf: 0 };
      return stream;
    } catch (e: unknown) {
      setHealth(h => ({ ...h, mic: 'fail' }));
      log('error', `mic fail: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  };

  const stopMicMonitor = () => {
    if (micAnalyserRef.current) { cancelAnimationFrame(micAnalyserRef.current.raf); micAnalyserRef.current.ctx.close(); micAnalyserRef.current = null; }
    micLevelRef.current = 0;
  };

  const handleConnect = async () => {
    setState('connecting'); setFlowForState('connecting');
    setErrorMsg(''); setHealth(INITIAL_HEALTH); setDiagLogs([]);
    log('info', `connect: ${characterId}`);
    try {
      await startMicMonitor();
      const tokenRes = await fetch('/api/livekit/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, userId }),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        setHealth(h => ({ ...h, token: 'fail' }));
        throw new Error(err.error || `token ${tokenRes.status}`);
      }
      const { token, url, roomName, identity } = await tokenRes.json();
      setHealth(h => ({ ...h, token: 'ok' }));
      setDiag({ livekitUrl: url, roomName, identity });
      log('info', `token OK, room=${roomName}`);

      const room = new Room({ adaptiveStream: true, dynacast: true });
      room
        .on(RoomEvent.ConnectionStateChanged, (s: ConnectionState) => {
          log('info', `room: ${s}`);
          setHealth(h => ({
            ...h, room: s === ConnectionState.Connected ? 'connected'
              : s === ConnectionState.Connecting ? 'connecting'
              : s === ConnectionState.Reconnecting ? 'reconnecting' : 'disconnected',
          }));
          if (s === ConnectionState.Disconnected) { setState('disconnected'); setFlowForState('disconnected'); }
        })
        .on(RoomEvent.ConnectionQualityChanged, (q: ConnectionQuality, p) => {
          if (p?.isLocal) {
            const map: Record<string, Health['netQuality']> = { excellent:'excellent', good:'good', poor:'poor', lost:'lost', unknown:'unknown' };
            setHealth(h => ({ ...h, netQuality: map[q] || 'unknown' }));
          }
        })
        .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
          log('info', `agent joined: ${p.identity}`);
          setHealth(h => ({ ...h, agent: 'present' }));
          setState('in-call'); setFlowForState('in-call');
        })
        .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
          log('warn', `agent left: ${p.identity}`);
          setHealth(h => ({ ...h, agent: 'absent' }));
        })
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, p: RemoteParticipant) => {
          log('info', `track: ${track.kind} from ${p.identity}`);
          if (track.kind === Track.Kind.Audio) {
            if (audioElRef.current) {
              track.attach(audioElRef.current);
              // 接 agent audio → analyser → agentLevelRef
              try {
                const actx = new AudioContext();
                const src = actx.createMediaElementSource(audioElRef.current);
                const analyser = actx.createAnalyser();
                analyser.fftSize = 256;
                src.connect(analyser);
                src.connect(actx.destination); // 還是要讓聲音出去
                agentAnalyserRef.current = { ctx: actx, analyser };
                const buf = new Uint8Array(analyser.fftSize);
                const tick = () => {
                  analyser.getByteTimeDomainData(buf);
                  let sum = 0;
                  for (let i = 0; i < buf.length; i++) { const v = (buf[i]-128)/128; sum += v*v; }
                  agentLevelRef.current = Math.sqrt(sum/buf.length);
                  requestAnimationFrame(tick);
                };
                tick();
              } catch {}
            }
            setHealth(h => ({ ...h, audio: 'subscribed' }));
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) setHealth(h => ({ ...h, audio: 'absent' }));
        })
        .on(RoomEvent.DataReceived, (payload: Uint8Array) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload));
            if (msg.type === 'caption' && msg.text) setCaptions(prev => [...prev, { who: msg.who||'agent', text: msg.text, ts: Date.now() }]);
            else if (msg.type === 'character' && msg.name) setCharacterName(msg.name);
          } catch { /* ignore */ }
        });

      await room.connect(url, token);
      log('info', 'connected');
      await room.localParticipant.setMicrophoneEnabled(true);
      log('info', 'mic published');

      if (room.remoteParticipants.size > 0) {
        setHealth(h => ({ ...h, agent: 'present' }));
        setState('in-call'); setFlowForState('in-call');
      }
      roomRef.current = room;
      callStartRef.current = Date.now();
      setState(s => { const ns = s === 'in-call' ? 'in-call' : 'waiting-agent'; setFlowForState(ns); return ns; });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg); setState('error'); setFlowForState('error'); log('error', msg);
    }
  };

  const handleDisconnect = async () => {
    if (roomRef.current) { await roomRef.current.disconnect(); roomRef.current = null; }
    stopMicMonitor();
    setState('disconnected'); setFlowForState('disconnected'); setElapsed(0); setMicMuted(false);
  };

  const toggleMic = useCallback(async () => {
    const room = roomRef.current; if (!room) return;
    const next = !micMuted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMicMuted(next);
  }, [micMuted]);

  useEffect(() => () => { if (roomRef.current) void roomRef.current.disconnect(); stopMicMonitor(); }, []);

  // 載入角色名
  useEffect(() => {
    fetch(`/api/characters/${characterId}`).then(r=>r.json()).then(d => {
      if (d.character?.name) setCharacterName(d.character.name);
    }).catch(() => {});
  }, [characterId]);

  const canConnect = state === 'idle' || state === 'disconnected' || state === 'error';
  const canDisconnect = state === 'connected' || state === 'waiting-agent' || state === 'in-call';
  const inCall = state === 'in-call' || state === 'waiting-agent';
  const min = Math.floor(elapsed / 60), sec = elapsed % 60;

  const stateLabel: Record<CallState, string> = {
    idle: '( 通話 )', connecting: '( 連線中 )', connected: '( 進房 )',
    'waiting-agent': '( 等待中 )', 'in-call': '( 通話中 )', disconnected: '( 已掛斷 )', error: '( 錯誤 )',
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'#000', overflow:'hidden', fontFamily:"'Inter', system-ui, sans-serif" }}>
      {/* 粒子 canvas */}
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0, display:'block', filter:'contrast(1.1) brightness(1.2)' }} />

      {/* 右上角燈號 */}
      <div style={{ position:'absolute', top:20, right:20, display:'flex', gap:8, alignItems:'center' }}>
        {([
          { key:'token', ok: health.token==='ok', fail: health.token==='fail' },
          { key:'mic',   ok: health.mic==='ok',   fail: health.mic==='fail' },
          { key:'room',  ok: health.room==='connected', fail: health.room==='disconnected' },
          { key:'agent', ok: health.agent==='present',  fail: health.agent==='absent' },
          { key:'audio', ok: health.audio==='subscribed', fail: health.audio==='absent' },
        ] as { key:string; ok:boolean; fail:boolean }[]).map(l => (
          <div key={l.key} title={l.key} style={{ width:7, height:7, borderRadius:'50%', background: l.ok ? '#22c55e' : l.fail ? '#ef4444' : 'rgba(255,255,255,0.25)' }} />
        ))}
      </div>

      {/* 中심 */}
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>

        {/* 角色名 */}
        <div style={{ marginBottom:20, fontSize:28, fontWeight:900, letterSpacing:'0.25em', textTransform:'uppercase', color:'#fff' }}>
          {characterName || characterId}
        </div>

        {/* 主按鈕 */}
        <div
          onClick={canConnect ? handleConnect : canDisconnect ? handleDisconnect : undefined}
          style={{ pointerEvents:'auto', cursor: (canConnect||canDisconnect) ? 'pointer' : 'default',
            width:240, height:240, borderRadius:'50%',
            background:'rgba(255,255,255,0.04)', backdropFilter:'blur(20px)',
            border:`1px solid ${state==='in-call' ? 'rgba(0,242,255,0.5)' : state==='connecting'||state==='waiting-agent' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)'}`,
            display:'flex', alignItems:'center', justifyContent:'center',
            transition:'border 0.6s ease',
          }}
        >
          <div style={{
            width:40, height:40, borderRadius:'50%',
            background: state==='in-call' ? '#00f2ff' : state==='error' ? '#ef4444' : '#fff',
            boxShadow:`0 0 24px ${state==='in-call' ? '#00f2ff' : state==='error' ? '#ef4444' : '#fff'}`,
            transition:'all 0.6s ease',
          }} />
        </div>

        {/* 狀態文字 */}
        <div style={{ marginTop:28, fontSize:18, letterSpacing:'0.8em', textTransform:'uppercase', fontWeight:200,
          color: state==='in-call' ? '#00f2ff' : state==='error' ? '#ef4444' : 'rgba(255,255,255,0.6)',
          transition:'all 0.6s ease' }}>
          {stateLabel[state]}
        </div>

        {/* 通話時長 */}
        {inCall && (
          <div style={{ marginTop:12, fontSize:14, letterSpacing:'0.3em', color:'rgba(255,255,255,0.35)', fontVariantNumeric:'tabular-nums' }}>
            {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}
          </div>
        )}

        {/* 最新字幕 */}
        {captions.length > 0 && (
          <div style={{ marginTop:24, maxWidth:320, textAlign:'center', fontSize:14, fontWeight:200, letterSpacing:'0.04em', lineHeight:1.7, color:'rgba(255,255,255,0.6)' }}>
            {captions[captions.length-1].text}
          </div>
        )}
      </div>

      {/* 底部：靜音按鈕 */}
      {inCall && (
        <div style={{ position:'absolute', bottom:40, left:0, right:0, display:'flex', justifyContent:'center', gap:16, pointerEvents:'auto' }}>
          <button onClick={toggleMic} style={{
            width:48, height:48, borderRadius:'50%',
            background: micMuted ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${micMuted ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.2)'}`,
            color: micMuted ? '#ef4444' : 'rgba(255,255,255,0.7)',
            cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
            backdropFilter:'blur(8px)', transition:'all 0.2s',
          }} title={micMuted ? '取消靜音' : '靜音'}>
            {micMuted ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="2" y1="2" x2="22" y2="22" />
                <path d="M18.89 13.23A7 7 0 0 0 19 12v-2" />
                <path d="M5 10v2a7 7 0 0 0 12 5" />
                <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
        </div>
      )}

      {errorMsg && (
        <div style={{ position:'absolute', bottom:40, left:'50%', transform:'translateX(-50%)',
          fontSize:12, color:'rgba(239,68,68,0.8)', letterSpacing:'0.05em' }}>
          {errorMsg}
        </div>
      )}

      <audio ref={audioElRef} autoPlay playsInline />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@200;900&display=swap');
      `}</style>
    </div>
  );
}
