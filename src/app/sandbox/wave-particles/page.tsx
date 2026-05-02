'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

type FlowState = 'idle' | 'processing' | 'playing';

interface FlowParams {
  noiseScale: number;
  speed: number;
  attraction: number;
  vortex: number;
  lineWidth: number;
  noiseZStep: number;
  colorAlpha: number;
  hueBase: number;
}

type ParamKey = keyof FlowParams;

const FLOW: Record<FlowState, FlowParams> = {
  idle:       { noiseScale: 0.002,  speed: 0.8, attraction: 0,    vortex: 0.1, lineWidth: 0.4, noiseZStep: 0.002, colorAlpha: 0.08, hueBase: 190 },
  processing: { noiseScale: 0.05,   speed: 0.3, attraction: 3.5,  vortex: 0.3, lineWidth: 1.0, noiseZStep: 0.12,  colorAlpha: 0.22, hueBase: 280 },
  playing:    { noiseScale: 0.0015, speed: 2.8, attraction: -0.6, vortex: 2.2, lineWidth: 2.2, noiseZStep: 0.012, colorAlpha: 0.40, hueBase: 170 },
};

const STATE_LABELS: Record<FlowState, string> = {
  idle: 'idle 寧靜',
  processing: 'processing 思考',
  playing: 'playing 說話',
};

const PARAM_RANGES: Record<ParamKey, { min: number; max: number; step: number; label: string }> = {
  noiseScale: { min: 0.0005, max: 0.1,  step: 0.0005, label: '紋路密度 noiseScale' },
  speed:      { min: 0,      max: 5,    step: 0.05,   label: '速度上限 speed' },
  attraction: { min: -3,     max: 5,    step: 0.05,   label: '吸引/排斥 attraction' },
  vortex:     { min: 0,      max: 4,    step: 0.05,   label: '渦旋強度 vortex' },
  lineWidth:  { min: 0.2,    max: 4,    step: 0.05,   label: '線條粗細 lineWidth' },
  noiseZStep: { min: 0.001,  max: 0.2,  step: 0.001,  label: '流場躁動 noiseZStep' },
  colorAlpha: { min: 0.02,   max: 0.6,  step: 0.005,  label: '軌跡濃度 colorAlpha' },
  hueBase:    { min: 0,      max: 360,  step: 1,      label: '色相基底 hueBase' },
};

const PARAM_KEYS = Object.keys(PARAM_RANGES) as ParamKey[];

function buildNoise() {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t: number, a: number, b: number) => a + t * (b - a);
  const grad = (hash: number, x: number, y: number, z: number) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  return (x: number, y: number, z: number) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(w,
      lerp(v, lerp(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)),
              lerp(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z))),
      lerp(v, lerp(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)),
              lerp(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1))));
  };
}

export default function FlowFieldSandbox() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputLevelRef = useRef(0);
  const flowRef = useRef<FlowParams>({ ...FLOW.idle });
  const targetFlowRef = useRef<FlowParams>({ ...FLOW.idle });
  const rafRef = useRef<number>(0);

  const [state, setState] = useState<FlowState>('idle');
  const [params, setParams] = useState<FlowParams>(FLOW.idle);
  const [micActive, setMicActive] = useState(false);
  const [micTarget, setMicTarget] = useState<ParamKey>('attraction');
  const [micStrength, setMicStrength] = useState(12);
  const [showPanel, setShowPanel] = useState(true);
  const [levelDisplay, setLevelDisplay] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // 收音參數
  const [inputGain, setInputGain] = useState(3);
  const [echoCancellation, setEchoCancellation] = useState(true);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [autoGainControl, setAutoGainControl] = useState(false);

  const micTargetRef = useRef(micTarget);
  const micStrengthRef = useRef(micStrength);
  useEffect(() => { micTargetRef.current = micTarget; }, [micTarget]);
  useEffect(() => { micStrengthRef.current = micStrength; }, [micStrength]);

  // inputGain 即時生效（不需重啟麥克風）
  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = inputGain;
  }, [inputGain]);

  useEffect(() => {
    targetFlowRef.current = { ...params };
  }, [params]);

  const switchState = useCallback((s: FlowState) => {
    setState(s);
    setParams({ ...FLOW[s] });
  }, []);

  const updateParam = useCallback((key: ParamKey, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const stopMic = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close();
    streamRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    gainNodeRef.current = null;
    setMicActive(false);
  }, []);

  const startMic = async (opts?: { echo?: boolean; noise?: boolean; agc?: boolean }) => {
    stopMic();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: opts?.echo ?? echoCancellation,
          noiseSuppression: opts?.noise ?? noiseSuppression,
          autoGainControl: opts?.agc ?? autoGainControl,
        },
      });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const gainNode = ctx.createGain();
      gainNode.gain.value = inputGain;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(gainNode);
      gainNode.connect(analyser);
      streamRef.current = stream;
      audioCtxRef.current = ctx;
      gainNodeRef.current = gainNode;
      analyserRef.current = analyser;
      setMicActive(true);
      setError(null);
    } catch (e) {
      setError(`麥克風啟動失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggleAudioConstraint = (type: 'echo' | 'noise' | 'agc', val: boolean) => {
    if (type === 'echo') { setEchoCancellation(val); if (micActive) startMic({ echo: val }); }
    if (type === 'noise') { setNoiseSuppression(val); if (micActive) startMic({ noise: val }); }
    if (type === 'agc') { setAutoGainControl(val); if (micActive) startMic({ agc: val }); }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const perlin = buildNoise();
    type Pt = { x: number; y: number; prevX: number; prevY: number; velX: number; velY: number; maxSpeed: number };
    let width = 0, height = 0, particles: Pt[] = [], zOff = 0;
    const mkPt = (): Pt => ({
      x: Math.random() * width,
      y: Math.random() * height,
      prevX: 0, prevY: 0, velX: 0, velY: 0,
      maxSpeed: 1 + Math.random() * 2,
    });
    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      particles = Array.from({ length: 4000 }, mkPt);
      particles.forEach((pt) => { pt.prevX = pt.x; pt.prevY = pt.y; });
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    };

    const measureLevel = () => {
      const a = analyserRef.current;
      if (!a) return 0;
      const arr = new Uint8Array(a.frequencyBinCount);
      a.getByteTimeDomainData(arr);
      let sum = 0;
      for (let i = 0; i < arr.length; i++) {
        const v = (arr[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / arr.length);
    };

    let levelPushFrame = 0;
    const animate = () => {
      const level = measureLevel();
      inputLevelRef.current = level;
      levelPushFrame += 1;
      if (levelPushFrame % 6 === 0) setLevelDisplay(level);

      const base = targetFlowRef.current;
      const tgt: FlowParams = { ...base };
      const mTarget = micTargetRef.current;
      const mStrength = micStrengthRef.current;
      // 非線性放大：讓小聲也看得到、大聲不爆
      const boosted = Math.pow(Math.min(level * 6, 1), 0.55);
      const inject = boosted * mStrength;
      if (mTarget === 'hueBase') {
        tgt.hueBase = (base.hueBase + inject * 100) % 360;
      } else {
        (tgt[mTarget] as number) = (base[mTarget] as number) + inject;
      }
      // 同時帶動 speed 和 vortex，讓聲音影響更全面
      tgt.speed = Math.min(base.speed + boosted * mStrength * 0.4, 6);
      tgt.vortex = Math.min(base.vortex + boosted * mStrength * 0.25, 5);

      // 有聲音時快速跟上，安靜時慢慢回落
      const lerpF = boosted > 0.05 ? 0.18 : 0.04;
      const cur = flowRef.current;
      (PARAM_KEYS).forEach((k) => {
        cur[k] += (tgt[k] - cur[k]) * lerpF;
      });

      const p = flowRef.current;
      const isActive = p.attraction > 0.3 || p.speed > 1.5;
      const isThinking = p.attraction > 2 && p.noiseZStep > 0.05;

      ctx.fillStyle = `rgba(0,0,0,${isThinking ? 0.25 : 0.07})`;
      ctx.fillRect(0, 0, width, height);
      zOff += p.noiseZStep;

      particles.forEach((pt) => {
        let angle = perlin(pt.x * p.noiseScale, pt.y * p.noiseScale, zOff) * Math.PI * 4;
        if (isThinking) angle += (Math.random() - 0.5) * 1.5;
        let accX = Math.cos(angle) * 0.4, accY = Math.sin(angle) * 0.4;
        const dx = width / 2 - pt.x, dy = height / 2 - pt.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (p.attraction !== 0) {
          accX += (dx / dist) * p.attraction;
          accY += (dy / dist) * p.attraction;
        }
        if (p.vortex !== 0) {
          accX += (-dy / dist) * p.vortex;
          accY += (dx / dist) * p.vortex;
        }
        pt.velX += accX;
        pt.velY += accY;
        let maxSpd = pt.maxSpeed * p.speed;
        if (isThinking) maxSpd *= (0.8 + Math.random() * 0.4);
        const spd = Math.sqrt(pt.velX ** 2 + pt.velY ** 2);
        if (spd > maxSpd) {
          pt.velX = (pt.velX / spd) * maxSpd;
          pt.velY = (pt.velY / spd) * maxSpd;
        }
        pt.prevX = pt.x; pt.prevY = pt.y;
        pt.x += pt.velX; pt.y += pt.velY;
        if (pt.x < -100 || pt.x > width + 100 || pt.y < -100 || pt.y > height + 100) {
          if (isActive) {
            pt.x = width / 2 + (Math.random() - 0.5) * 50;
            pt.y = height / 2 + (Math.random() - 0.5) * 50;
          } else {
            pt.x = Math.random() * width;
            pt.y = Math.random() * height;
          }
          pt.prevX = pt.x; pt.prevY = pt.y; pt.velX = 0; pt.velY = 0;
        }
        ctx.beginPath();
        ctx.moveTo(pt.prevX, pt.prevY);
        ctx.lineTo(pt.x, pt.y);
        const hue = ((p.hueBase + Math.sqrt(pt.velX ** 2 + pt.velY ** 2) * 15) % 360 + 360) % 360;
        ctx.strokeStyle = `hsla(${hue}, 80%, 65%, ${p.colorAlpha})`;
        ctx.lineWidth = p.lineWidth;
        ctx.stroke();
      });
      rafRef.current = requestAnimationFrame(animate);
    };
    resize();
    animate();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 6,
    border: `1px solid ${active ? 'rgba(125, 211, 252, 0.7)' : 'rgba(255,255,255,0.12)'}`,
    background: active ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255,255,255,0.04)',
    color: active ? 'rgb(186, 230, 253)' : 'rgba(255,255,255,0.72)',
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 120ms',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'black', overflow: 'hidden', fontFamily: 'var(--font-geist-sans), system-ui, sans-serif' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, display: 'block', filter: 'contrast(1.1) brightness(1.2)' }}
      />

      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          color: 'rgba(255,255,255,0.7)',
          fontSize: 12,
          padding: '8px 12px',
          background: 'rgba(0,0,0,0.4)',
          borderRadius: 6,
          backdropFilter: 'blur(8px)',
          pointerEvents: 'none',
        }}
      >
        {STATE_LABELS[state]} · 麥克風 {micActive ? `→ ${PARAM_RANGES[micTarget].label.split(' ')[0]} (×${micStrength})` : '未開'} · level {levelDisplay.toFixed(3)}
      </div>

      <button
        onClick={() => setShowPanel((p) => !p)}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(0,0,0,0.5)',
          color: 'rgba(255,255,255,0.72)',
          fontSize: 12,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
        }}
      >
        {showPanel ? '隱藏面板' : '顯示面板'}
      </button>

      {!micActive && (
        <button
          onClick={() => startMic()}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '14px 28px',
            borderRadius: 10,
            border: '1px solid rgba(125, 211, 252, 0.5)',
            background: 'rgba(56, 189, 248, 0.15)',
            color: 'rgb(186, 230, 253)',
            fontSize: 14,
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
          }}
        >
          開麥克風開始玩
        </button>
      )}

      {error && (
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: 16,
            padding: 8,
            borderRadius: 6,
            background: 'rgba(239, 68, 68, 0.18)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: 'rgb(252, 165, 165)',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {showPanel && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            top: 60,
            bottom: 16,
            width: 340,
            padding: 16,
            background: 'rgba(8, 10, 18, 0.78)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            backdropFilter: 'blur(12px)',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            overflowY: 'auto',
          }}
        >
          <div>
            <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 6 }}>狀態（套參數預設）</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['idle', 'processing', 'playing'] as FlowState[]).map((s) => (
                <button key={s} onClick={() => switchState(s)} style={btnStyle(state === s)}>
                  {STATE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
            <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 8 }}>收音參數</div>
            {/* 輸入增益（即時） */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ opacity: 0.6, width: 64, flexShrink: 0 }}>輸入增益</span>
              <input type="range" min={0.1} max={20} step={0.1} value={inputGain}
                onChange={(e) => setInputGain(parseFloat(e.target.value))} style={{ flex: 1 }} />
              <span style={{ width: 36, textAlign: 'right', opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{inputGain.toFixed(1)}×</span>
            </div>
            {/* level 條 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ opacity: 0.6, width: 64, flexShrink: 0 }}>收音量</span>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(levelDisplay * 600, 100)}%`, background: levelDisplay > 0.05 ? 'rgb(125,211,252)' : 'rgba(255,255,255,0.2)', borderRadius: 3, transition: 'width 80ms' }} />
              </div>
              <span style={{ width: 36, textAlign: 'right', opacity: 0.5, fontVariantNumeric: 'tabular-nums' }}>{levelDisplay.toFixed(3)}</span>
            </div>
            {/* toggles */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
              {([
                { label: '回音消除', key: 'echo' as const, val: echoCancellation },
                { label: '噪音抑制', key: 'noise' as const, val: noiseSuppression },
                { label: '自動增益', key: 'agc' as const, val: autoGainControl },
              ]).map(({ label, key, val }) => (
                <button key={key} onClick={() => toggleAudioConstraint(key, !val)} style={btnStyle(val)}>
                  {label} {val ? 'ON' : 'OFF'}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, opacity: 0.35, marginTop: 4 }}>toggle 會重啟麥克風</div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
            <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 6 }}>麥克風路由（你的聲音 → 哪個參數）</div>
            <select
              value={micTarget}
              onChange={(e) => setMicTarget(e.target.value as ParamKey)}
              style={{
                width: '100%',
                padding: '6px 8px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.85)',
                fontSize: 12,
                marginBottom: 8,
              }}
            >
              {PARAM_KEYS.map((k) => (
                <option key={k} value={k} style={{ background: '#0c0e16' }}>
                  {PARAM_RANGES[k].label}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ opacity: 0.55, width: 60 }}>強度</span>
              <input
                type="range"
                min={0}
                max={50}
                step={0.1}
                value={micStrength}
                onChange={(e) => setMicStrength(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ width: 40, textAlign: 'right', opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
                {micStrength.toFixed(1)}
              </span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, opacity: 0.55 }}>八軸參數（即時調整 · 點狀態會 reset 成 preset）</div>
            {PARAM_KEYS.map((k) => {
              const r = PARAM_RANGES[k];
              const v = params[k];
              const isMicTarget = micTarget === k;
              return (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ opacity: isMicTarget ? 0.9 : 0.6, color: isMicTarget ? 'rgb(186, 230, 253)' : undefined }}>
                      {r.label}{isMicTarget ? ' ◀ mic' : ''}
                    </span>
                    <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(r.step < 0.01 ? 4 : r.step < 0.1 ? 3 : 2)}</span>
                  </div>
                  <input
                    type="range"
                    min={r.min}
                    max={r.max}
                    step={r.step}
                    value={v}
                    onChange={(e) => updateParam(k, parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
