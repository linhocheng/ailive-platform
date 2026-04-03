'use client';
import { useEffect, useRef, useState } from 'react';

type AppState = 'idle' | 'recording' | 'thinking' | 'playing';

const STATE_LABEL: Record<AppState, string> = {
  idle: '( 通話 )',
  recording: '( 錄音中 )',
  thinking: '( 思考中 )',
  playing: '( 播放中 )',
};

interface Params {
  noiseScale: number;
  speed: number;
  attraction: number;
  vortex: number;
  lineWidth: number;
  noiseZStep: number;
  colorAlpha: number;
  hueBase: number;
}

const STATE_PARAMS: Record<AppState, Params> = {
  idle: {
    noiseScale: 0.002, speed: 0.8, attraction: 0, vortex: 0.1,
    lineWidth: 0.4, noiseZStep: 0.002, colorAlpha: 0.08, hueBase: 190,
  },
  recording: {
    noiseScale: 0.005, speed: 3.5, attraction: 1.2, vortex: 0.5,
    lineWidth: 0.7, noiseZStep: 0.015, colorAlpha: 0.25, hueBase: 0,
  },
  thinking: {
    noiseScale: 0.05, speed: 0.3, attraction: 3.5, vortex: 0.3,
    lineWidth: 1.0, noiseZStep: 0.12, colorAlpha: 0.22, hueBase: 280,
  },
  playing: {
    noiseScale: 0.0015, speed: 2.5, attraction: -0.4, vortex: 1.8,
    lineWidth: 2.0, noiseZStep: 0.008, colorAlpha: 0.35, hueBase: 170,
  },
};

// Perlin Noise
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
      lerp(v,
        lerp(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)),
        lerp(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z))
      ),
      lerp(v,
        lerp(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1))
      )
    );
  };
}

export default function SonicPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<AppState>('idle');
  const paramsRef = useRef<Params>({ ...STATE_PARAMS.idle });
  const [appState, setAppState] = useState<AppState>('idle');
  const rafRef = useRef<number>(0);

  const setState = (s: AppState) => {
    stateRef.current = s;
    paramsRef.current = { ...STATE_PARAMS[s] };
    setAppState(s);
  };

  const handleClick = () => {
    const cur = stateRef.current;
    if (cur === 'idle') {
      setState('recording');
    } else if (cur === 'recording') {
      setState('thinking');
      setTimeout(() => setState('playing'), 3000);
      setTimeout(() => setState('idle'), 6000);
    } else if (cur === 'playing') {
      setState('idle');
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const perlin = buildNoise();

    type Particle = {
      x: number; y: number;
      prevX: number; prevY: number;
      velX: number; velY: number;
      maxSpeed: number;
    };

    let width = 0, height = 0;
    let particles: Particle[] = [];
    let zOff = 0;

    const initParticle = (): Particle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      prevX: 0, prevY: 0,
      velX: 0, velY: 0,
      maxSpeed: 1 + Math.random() * 2,
    });

    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      particles = Array.from({ length: 4000 }, initParticle);
      particles.forEach(p => { p.prevX = p.x; p.prevY = p.y; });
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    };

    const animate = () => {
      const p = paramsRef.current;
      const state = stateRef.current;

      const fade = state === 'thinking' ? 0.25 : 0.07;
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, width, height);
      zOff += p.noiseZStep;

      particles.forEach(pt => {
        const nx = pt.x * p.noiseScale;
        const ny = pt.y * p.noiseScale;
        let angle = perlin(nx, ny, zOff) * Math.PI * 4;
        if (state === 'thinking') angle += (Math.random() - 0.5) * 1.5;

        let accX = Math.cos(angle) * 0.4;
        let accY = Math.sin(angle) * 0.4;

        const dx = width / 2 - pt.x;
        const dy = height / 2 - pt.y;
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
        if (state === 'thinking') maxSpd *= (0.8 + Math.random() * 0.4);

        const spd = Math.sqrt(pt.velX ** 2 + pt.velY ** 2);
        if (spd > maxSpd) {
          pt.velX = (pt.velX / spd) * maxSpd;
          pt.velY = (pt.velY / spd) * maxSpd;
        }

        pt.prevX = pt.x; pt.prevY = pt.y;
        pt.x += pt.velX; pt.y += pt.velY;

        if (pt.x < -100 || pt.x > width + 100 || pt.y < -100 || pt.y > height + 100) {
          if (state === 'playing' || state === 'thinking') {
            pt.x = width / 2 + (Math.random() - 0.5) * 50;
            pt.y = height / 2 + (Math.random() - 0.5) * 50;
          } else {
            pt.x = Math.random() * width;
            pt.y = Math.random() * height;
          }
          pt.prevX = pt.x; pt.prevY = pt.y;
          pt.velX = 0; pt.velY = 0;
        }

        ctx.beginPath();
        ctx.moveTo(pt.prevX, pt.prevY);
        ctx.lineTo(pt.x, pt.y);
        const dynHue = p.hueBase + (Math.sqrt(pt.velX ** 2 + pt.velY ** 2) * 15);
        ctx.strokeStyle = `hsla(${dynHue},80%,65%,${p.colorAlpha})`;
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

  // 狀態對應的按鈕樣式
  const dotColor = {
    idle: 'white',
    recording: '#ff3b30',
    thinking: '#ffffff',
    playing: '#00f2ff',
  }[appState];

  const ringColor = {
    idle: 'rgba(255,255,255,0.2)',
    recording: '#ff3b30',
    thinking: 'rgba(255,255,255,0.6)',
    playing: '#00f2ff',
  }[appState];

  const btnScale = {
    idle: 1,
    recording: 1.1,
    thinking: 0.85,
    playing: 1.2,
  }[appState];

  const dotScale = {
    idle: 1,
    recording: 1.5,
    thinking: 0.7,
    playing: 1.8,
  }[appState];

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', filter: 'contrast(1.1) brightness(1.2)', position: 'absolute', inset: 0 }}
      />

      {/* 中心按鈕 */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <div style={{ position: 'relative', width: 120, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', cursor: 'pointer' }}
          onClick={handleClick}>

          {/* 光暈圈（playing 時） */}
          {appState === 'playing' && (
            <div style={{
              position: 'absolute',
              width: 120, height: 120,
              borderRadius: '50%',
              border: '1px solid rgba(0,242,255,0.15)',
              animation: 'ping 1.5s ease-out infinite',
            }} />
          )}

          <div style={{
            width: 60, height: 60,
            background: 'rgba(255,255,255,0.05)',
            backdropFilter: 'blur(20px)',
            border: `1px solid ${ringColor}`,
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: `scale(${btnScale})`,
            transition: 'all 0.8s cubic-bezier(0.16,1,0.3,1)',
            animation: appState === 'thinking' ? 'breathe 1s infinite alternate' : 'none',
          }}>
            <div style={{
              width: 12, height: 12,
              background: dotColor,
              borderRadius: '50%',
              boxShadow: `0 0 20px ${dotColor}`,
              transform: `scale(${dotScale})`,
              transition: 'all 0.6s ease',
            }} />
          </div>
        </div>

        {/* 狀態文字 */}
        <div style={{
          marginTop: 40,
          fontFamily: "'Inter', sans-serif",
          fontWeight: 200,
          fontSize: 10,
          textTransform: 'uppercase',
          color: appState === 'idle' ? 'rgba(255,255,255,0.3)' :
                 appState === 'recording' ? '#ff3b30' :
                 appState === 'thinking' ? '#ffffff' : '#00f2ff',
          opacity: appState === 'idle' ? 0.3 : appState === 'thinking' ? 1 : 0.8,
          letterSpacing: appState === 'thinking' ? '1em' : '0.8em',
          transition: 'all 0.8s ease',
        }}>
          {STATE_LABEL[appState]}
        </div>
      </div>

      {/* 底部署名 */}
      <div style={{
        position: 'absolute', bottom: 30, left: 30,
        fontFamily: "'Inter', sans-serif",
        fontWeight: 200,
        fontSize: 9,
        letterSpacing: '0.2em',
        color: 'rgba(255,255,255,0.15)',
      }}>
        AILIVE // ALGORITHMIC RESONANCE // SILK FLOW FIELD
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@100;200;400&display=swap');
        @keyframes breathe {
          from { opacity: 0.4; box-shadow: 0 0 20px rgba(255,255,255,0.1); }
          to   { opacity: 1;   box-shadow: 0 0 60px rgba(255,255,255,0.4); }
        }
        @keyframes ping {
          0%   { transform: scale(1);   opacity: 0.4; }
          100% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
