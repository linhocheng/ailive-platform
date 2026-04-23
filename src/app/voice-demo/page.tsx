'use client';
/**
 * 語音溝通頁 · 純 UI/UX Demo
 *
 * - 單檔，不依賴專案任何 module，整檔 copy-paste 可用
 * - 自動循環 idle → recording → processing → playing → ending，每 3 秒切
 * - 視覺：粒子 Perlin flow field 背景 + 三層嵌套主按鈕
 * - 剔除所有邏輯：錄音 / 對話 / TTS / 音訊 / 角色 / 頭像
 *
 * 路由：/voice-demo
 */
import { useEffect, useRef, useState } from 'react';

type VoiceState = 'idle' | 'recording' | 'processing' | 'playing' | 'ending';

const STATE_LABEL: Record<VoiceState, string> = {
  idle: '( 通話 )',
  recording: '( 錄音中 )',
  processing: '( 沈思中 )',
  playing: '( 播放中 )',
  ending: '( 整理中 )',
};

const CYCLE: VoiceState[] = ['idle', 'recording', 'processing', 'playing', 'ending'];
const CYCLE_MS = 3000;

// ── Perlin Noise ──────────────────────────────────────────────────────────
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
    const h = hash & 15,
      u = h < 8 ? x : y,
      v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  return (x: number, y: number, z: number) => {
    const X = Math.floor(x) & 255,
      Y = Math.floor(y) & 255,
      Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      w,
      lerp(
        v,
        lerp(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)),
        lerp(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z)),
      ),
      lerp(
        v,
        lerp(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1)),
      ),
    );
  };
}

type FlowParams = {
  noiseScale: number;
  speed: number;
  attraction: number;
  vortex: number;
  lineWidth: number;
  noiseZStep: number;
  colorAlpha: number;
  hueBase: number;
};

const FLOW: Record<VoiceState, FlowParams> = {
  idle:       { noiseScale: 0.002,  speed: 0.8, attraction:  0,   vortex: 0.1,  lineWidth: 0.4, noiseZStep: 0.002, colorAlpha: 0.08, hueBase: 190 },
  recording:  { noiseScale: 0.005,  speed: 3.5, attraction:  1.2, vortex: 0.5,  lineWidth: 0.7, noiseZStep: 0.015, colorAlpha: 0.25, hueBase: 0   },
  processing: { noiseScale: 0.05,   speed: 0.3, attraction:  3.5, vortex: 0.3,  lineWidth: 1.0, noiseZStep: 0.12,  colorAlpha: 0.22, hueBase: 280 },
  playing:    { noiseScale: 0.0015, speed: 2.8, attraction: -0.6, vortex: 2.2,  lineWidth: 2.2, noiseZStep: 0.012, colorAlpha: 0.40, hueBase: 170 },
  ending:     { noiseScale: 0.002,  speed: 0.5, attraction:  0,   vortex: 0.05, lineWidth: 0.4, noiseZStep: 0.003, colorAlpha: 0.06, hueBase: 190 },
};

// ──────────────────────────────────────────────────────────────────────────
export default function VoiceDemoPage() {
  const [state, setState] = useState<VoiceState>('idle');

  // 自動循環
  useEffect(() => {
    let idx = 0;
    const t = setInterval(() => {
      idx = (idx + 1) % CYCLE.length;
      setState(CYCLE[idx]);
    }, CYCLE_MS);
    return () => clearInterval(t);
  }, []);

  // 粒子 Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flowRef = useRef<FlowParams>({ ...FLOW.idle });
  const targetFlowRef = useRef<FlowParams>({ ...FLOW.idle });
  const rafRef = useRef<number>(0);

  // 狀態 → 目標 flow
  useEffect(() => {
    targetFlowRef.current = { ...FLOW[state] };
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
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
      particles.forEach(p => { p.prevX = p.x; p.prevY = p.y; });
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    };

    const animate = () => {
      const lerpF = 0.03;
      const cur = flowRef.current;
      const tgt = targetFlowRef.current;
      cur.noiseScale += (tgt.noiseScale - cur.noiseScale) * lerpF;
      cur.speed += (tgt.speed - cur.speed) * lerpF;
      cur.attraction += (tgt.attraction - cur.attraction) * lerpF;
      cur.vortex += (tgt.vortex - cur.vortex) * lerpF;
      cur.lineWidth += (tgt.lineWidth - cur.lineWidth) * lerpF;
      cur.noiseZStep += (tgt.noiseZStep - cur.noiseZStep) * lerpF;
      cur.colorAlpha += (tgt.colorAlpha - cur.colorAlpha) * lerpF;
      cur.hueBase += (tgt.hueBase - cur.hueBase) * lerpF;

      const p = flowRef.current;
      const isThinking = tgt.hueBase === 280;
      ctx.fillStyle = `rgba(0,0,0,${isThinking ? 0.25 : 0.07})`;
      ctx.fillRect(0, 0, width, height);
      zOff += p.noiseZStep;

      particles.forEach(pt => {
        let angle = perlin(pt.x * p.noiseScale, pt.y * p.noiseScale, zOff) * Math.PI * 4;
        if (isThinking) angle += (Math.random() - 0.5) * 1.5;
        let accX = Math.cos(angle) * 0.4, accY = Math.sin(angle) * 0.4;
        const dx = width / 2 - pt.x, dy = height / 2 - pt.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (p.attraction !== 0) { accX += (dx / dist) * p.attraction; accY += (dy / dist) * p.attraction; }
        if (p.vortex !== 0)     { accX += (-dy / dist) * p.vortex;    accY += (dx / dist) * p.vortex;    }
        pt.velX += accX; pt.velY += accY;
        let maxSpd = pt.maxSpeed * p.speed;
        if (isThinking) maxSpd *= 0.8 + Math.random() * 0.4;
        const spd = Math.sqrt(pt.velX ** 2 + pt.velY ** 2);
        if (spd > maxSpd) { pt.velX = (pt.velX / spd) * maxSpd; pt.velY = (pt.velY / spd) * maxSpd; }
        pt.prevX = pt.x; pt.prevY = pt.y;
        pt.x += pt.velX; pt.y += pt.velY;

        const isActive = p.hueBase !== 190 || p.speed > 1;
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
        ctx.strokeStyle = `hsla(${p.hueBase + Math.sqrt(pt.velX ** 2 + pt.velY ** 2) * 15},80%,65%,${p.colorAlpha})`;
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

  // 按鈕視覺
  const dotColor  = state === 'recording' ? '#ff3b30' : state === 'processing' ? '#ffffff' : state === 'playing' ? '#00f2ff' : 'white';
  const ringColor = state === 'recording' ? '#ff3b30' : state === 'processing' ? 'rgba(255,255,255,0.6)' : state === 'playing' ? '#00f2ff' : 'rgba(255,255,255,0.2)';
  const btnScale  = state === 'recording' ? 1.1 : state === 'processing' ? 0.85 : state === 'playing' ? 1.2 : 1;
  const dotScale  = state === 'recording' ? 1.5 : state === 'processing' ? 0.7  : state === 'playing' ? 1.8 : 1;
  const stateColor =
    state === 'idle'       ? 'rgba(255,255,255,0.6)'
    : state === 'recording' ? '#ff3b30'
    : state === 'processing' ? '#ffffff'
    : state === 'playing'   ? '#00f2ff'
    : 'rgba(255,255,255,0.6)';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden', fontFamily: "'Inter', sans-serif" }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block', filter: 'contrast(1.1) brightness(1.2)' }} />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        {/* ping 圈（playing 時） */}
        {state === 'playing' && (
          <div
            style={{
              position: 'absolute',
              width: 360,
              height: 360,
              borderRadius: '50%',
              border: '1px solid rgba(0,242,255,0.12)',
              animation: 'ping 1.8s ease-out infinite',
            }}
          />
        )}

        {/* 主按鈕：外層 320 → 毛玻璃 240 → dot 40 */}
        <div
          style={{
            position: 'relative',
            width: 320,
            height: 320,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              width: 240,
              height: 240,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(20px)',
              border: `1px solid ${ringColor}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${btnScale})`,
              transition: 'all 0.8s cubic-bezier(0.16,1,0.3,1)',
              animation: state === 'processing' ? 'breathe 1s infinite alternate' : 'none',
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: dotColor,
                boxShadow: `0 0 24px ${dotColor}`,
                transform: `scale(${dotScale})`,
                transition: 'all 0.6s ease',
              }}
            />
          </div>
        </div>

        {/* 狀態文字 */}
        <div
          style={{
            marginTop: 32,
            fontSize: 20,
            letterSpacing: state === 'processing' ? '1em' : '0.8em',
            textTransform: 'uppercase',
            fontWeight: 200,
            color: stateColor,
            transition: 'all 0.8s ease',
          }}
        >
          {STATE_LABEL[state]}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@100;200;400&display=swap');
        @keyframes breathe {
          from { opacity: 0.4; box-shadow: 0 0 20px rgba(255,255,255,0.1); }
          to   { opacity: 1;   box-shadow: 0 0 60px rgba(255,255,255,0.4); }
        }
        @keyframes ping {
          0%   { transform: scale(1);   opacity: 0.3; }
          100% { transform: scale(1.6); opacity: 0;   }
        }
      `}</style>
    </div>
  );
}
