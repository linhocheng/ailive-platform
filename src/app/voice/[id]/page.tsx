'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

type VoiceState = 'idle' | 'recording' | 'processing' | 'playing' | 'ending';

interface Character {
  id: string; name: string; mission: string; type: string;
  voiceId?: string;
  visualIdentity?: { characterSheet?: string };
}
interface Message { role: 'user' | 'assistant'; content: string; timestamp: string; }

// 不在 module scope 判斷 SpeechRecognition，避免 SSR hydration mismatch

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

const FLOW: Record<string, FlowParams> = {
  idle:       { noiseScale:0.002,  speed:0.8,  attraction:0,    vortex:0.1, lineWidth:0.4, noiseZStep:0.002, colorAlpha:0.08, hueBase:190 },
  recording:  { noiseScale:0.005,  speed:3.5,  attraction:1.2,  vortex:0.5, lineWidth:0.7, noiseZStep:0.015, colorAlpha:0.25, hueBase:0   },
  processing: { noiseScale:0.05,   speed:0.3,  attraction:3.5,  vortex:0.3, lineWidth:1.0, noiseZStep:0.12,  colorAlpha:0.22, hueBase:280 },
  playing:    { noiseScale:0.0015, speed:2.8,  attraction:-0.6, vortex:2.2, lineWidth:2.2, noiseZStep:0.012, colorAlpha:0.40, hueBase:170 },
  ending:     { noiseScale:0.002,  speed:0.5,  attraction:0,    vortex:0.05,lineWidth:0.4, noiseZStep:0.003, colorAlpha:0.06, hueBase:190 },
};

const STATE_LABEL: Record<VoiceState, string> = {
  idle: '( 通話 )', recording: '( 錄音中 )', processing: '( 思考中 )', playing: '( 播放中 )', ending: '( 整理中 )',
};

export default function VoicePage() {
  const { id: characterId } = useParams<{ id: string }>();
  const [char, setChar] = useState<Character | null>(null);
  const [state, setState] = useState<VoiceState>('idle');
  const [interimText, setInterimText] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [endDone, setEndDone] = useState(false);
  const [insightCount, setInsightCount] = useState(0);
  const [usingSpeechAPI, setUsingSpeechAPI] = useState(false);
  useEffect(() => {
    const w = window as any;
    const isAndroid = /Android/i.test(navigator.userAgent);
    // Android Web Speech API 開關有系統提示音，強制走靜音的 Gemini STT 路徑
    const hasSpeechAPI = !!(w.SpeechRecognition || w.webkitSpeechRecognition);
    setUsingSpeechAPI(hasSpeechAPI && !isAndroid);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flowRef = useRef<FlowParams>({ ...FLOW.idle });
  const targetFlowRef = useRef<FlowParams>({ ...FLOW.idle });
  const rafRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedAudioRef = useRef<HTMLAudioElement | null>(null); // iOS autoplay unlock
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRecRef = useRef<any>(null);
  const finalTextRef = useRef('');

  // ── 粒子 Canvas ──
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
      // 每幀把 flowRef 往 targetFlowRef lerp（0.03 = 慢速平滑）
      const lerpF = 0.03;
      const cur = flowRef.current;
      const tgt = targetFlowRef.current;
      cur.noiseScale  += (tgt.noiseScale  - cur.noiseScale)  * lerpF;
      cur.speed       += (tgt.speed       - cur.speed)       * lerpF;
      cur.attraction  += (tgt.attraction  - cur.attraction)  * lerpF;
      cur.vortex      += (tgt.vortex      - cur.vortex)      * lerpF;
      cur.lineWidth   += (tgt.lineWidth   - cur.lineWidth)   * lerpF;
      cur.noiseZStep  += (tgt.noiseZStep  - cur.noiseZStep)  * lerpF;
      cur.colorAlpha  += (tgt.colorAlpha  - cur.colorAlpha)  * lerpF;
      cur.hueBase     += (tgt.hueBase     - cur.hueBase)     * lerpF;

      const p = flowRef.current;
      const isThinking = tgt.hueBase === 280;
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
        const isActive = p.hueBase !== 190 || p.speed > 1;
        if (pt.x<-100||pt.x>width+100||pt.y<-100||pt.y>height+100) {
          if (isActive) { pt.x=width/2+(Math.random()-0.5)*50; pt.y=height/2+(Math.random()-0.5)*50; }
          else { pt.x=Math.random()*width; pt.y=Math.random()*height; }
          pt.prevX=pt.x; pt.prevY=pt.y; pt.velX=0; pt.velY=0;
        }
        ctx.beginPath(); ctx.moveTo(pt.prevX,pt.prevY); ctx.lineTo(pt.x,pt.y);
        ctx.strokeStyle=`hsla(${p.hueBase+(Math.sqrt(pt.velX**2+pt.velY**2)*15)},80%,65%,${p.colorAlpha})`;
        ctx.lineWidth=p.lineWidth; ctx.stroke();
      });
      rafRef.current = requestAnimationFrame(animate);
    };
    resize(); animate();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(rafRef.current); };
  }, []);

  // 同步 flow 參數
  const setVoiceState = useCallback((s: VoiceState) => {
    setState(s);
    targetFlowRef.current = { ...FLOW[s] };
  }, []);

  // 載入角色
  useEffect(() => {
    fetch(`/api/characters/${characterId}`).then(r=>r.json()).then(d=>setChar(d.character));
    const saved = localStorage.getItem(`conv-${characterId}`);
    if (saved) setConversationId(saved);
  }, [characterId]);
  useEffect(() => () => { streamRef.current?.getTracks().forEach(t=>t.stop()); }, []);

  // ── 送出對話 ──
  const sendToDialogue = useCallback(async (userText: string) => {
    if (!userText.trim()) { setVoiceState('idle'); return; }
    setInterimText('');
    setVoiceState('processing');
    try {
      const res = await fetch('/api/voice-stream', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ characterId, userId:`voice-${characterId}`, message: userText, conversationId }),
      });
      if (!res.ok || !res.body) throw new Error('voice-stream 失敗');

      // iOS 不支援 MSE (MediaSource) streaming audio/mpeg，偵測後走 blob 路徑
      const mseSupported = typeof MediaSource !== 'undefined' &&
        (typeof (MediaSource as any).isTypeSupported === 'function'
          ? (MediaSource as any).isTypeSupported('audio/mpeg')
          : true);

      let mediaSource: MediaSource|null=null, sourceBuffer: SourceBuffer|null=null;
      let audio: HTMLAudioElement|null=null;
      const audioQueue: Uint8Array[]=[];
      let isAppending=false, streamDone=false, fullReplyText='';
      // iOS blob path
      const iosChunks: Uint8Array[]=[];

      const initMSEAudio = () => {
        if (audio) return;
        mediaSource = new MediaSource();
        audio = new Audio(URL.createObjectURL(mediaSource));
        audioRef.current = audio;
        mediaSource.addEventListener('sourceopen', () => {
          try { sourceBuffer = mediaSource!.addSourceBuffer('audio/mpeg'); sourceBuffer.addEventListener('updateend', drainQueue); drainQueue(); } catch {}
        }, {once:true});
        audio.play().catch(()=>{});
        setVoiceState('playing');
      };
      const drainQueue = () => {
        if (isAppending||!sourceBuffer||sourceBuffer.updating) return;
        if (audioQueue.length===0) { if (streamDone&&mediaSource&&mediaSource.readyState==='open') { try{mediaSource.endOfStream();}catch{} } return; }
        isAppending=true;
        try { sourceBuffer!.appendBuffer(audioQueue.shift()!.buffer as ArrayBuffer); } catch {}
        isAppending=false;
      };

      const reader = res.body.getReader(); const dec = new TextDecoder(); let sseBuf='';
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        sseBuf += dec.decode(value,{stream:true});
        const lines = sseBuf.split('\n'); sseBuf = lines.pop()||'';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as {type:string;content?:string;chunk?:string;conversationId?:string;fullText?:string;message?:string};
            if (ev.type==='text'&&ev.content) {
              if (mseSupported && !audio) initMSEAudio();
              fullReplyText+=ev.content;
            }
            if (ev.type==='audio'&&ev.chunk) {
              const b=atob(ev.chunk); const arr=new Uint8Array(b.length);
              for(let i=0;i<b.length;i++)arr[i]=b.charCodeAt(i);
              if (mseSupported) { audioQueue.push(arr); drainQueue(); }
              else { iosChunks.push(arr); }  // iOS: 收集起來等 done
            }
            if (ev.type==='done') {
              if (ev.conversationId) { setConversationId(ev.conversationId); localStorage.setItem(`conv-${characterId}`,ev.conversationId); }
              const now=new Date().toISOString();
              setMessages(prev=>[...prev,{role:'user',content:userText,timestamp:now},{role:'assistant',content:fullReplyText||ev.fullText||'',timestamp:now}]);
              streamDone=true;
              if (mseSupported) {
                drainQueue();
              } else if (iosChunks.length > 0) {
                // iOS：所有 chunk 收齊後合成 blob 一次播
                const total = iosChunks.reduce((s,c)=>s+c.length,0);
                const combined = new Uint8Array(total);
                let offset=0; for(const c of iosChunks){combined.set(c,offset);offset+=c.length;}
                const blob = new Blob([combined],{type:'audio/mpeg'});
                const url = URL.createObjectURL(blob);
                // iOS: 用 gesture 裡預解鎖的 Audio 元素，避免 autoplay 封鎖
                const iosAudio = unlockedAudioRef.current || new Audio();
                iosAudio.src = url;
                iosAudio.load();
                audio = iosAudio; audioRef.current=audio;
                audio.play().catch(()=>{});
                setVoiceState('playing');
              }
            }
            if (ev.type==='error') throw new Error(ev.message);
          } catch(e){ if(e instanceof SyntaxError) continue; throw e; }
        }
      }
      if (audio) await new Promise<void>(resolve=>{
        // 主路徑：等 audio.ended
        (audio as HTMLAudioElement).addEventListener('ended', ()=>resolve(), {once:true});
        // 聰明 fallback：串流結束後最多再等 8 秒
        const smartFallback = setTimeout(()=>resolve(), 8000);
        (audio as HTMLAudioElement).addEventListener('ended', ()=>clearTimeout(smartFallback), {once:true});
      });
      // 播完：先讓粒子慢下來再切 idle
      setVoiceState('ending');
      setTimeout(() => setVoiceState('idle'), 800);
    } catch { setVoiceState('idle'); }
  }, [characterId, conversationId, setVoiceState]);

  // ── Web Speech API ──
  const isRecordingRef = useRef(false); // 追蹤「用戶是否還在錄音」，用於自動重啟判斷

  const startWebSpeechSession = useCallback((SR: any) => {
    // 每次開一個新的 recognition session，累積文字進同一個 finalTextRef
    const rec = new SR();
    rec.lang='zh-TW'; rec.interimResults=true; rec.continuous=true; rec.maxAlternatives=1;
    speechRecRef.current=rec;

    rec.onresult=(e:any)=>{
      let interim='';
      for(let i=e.resultIndex;i<e.results.length;i++){
        if(e.results[i].isFinal){finalTextRef.current+=e.results[i][0].transcript;}
        else{interim+=e.results[i][0].transcript;}
      }
      setInterimText(interim);
    };

    rec.onerror=(e:any)=>{
      if(e.error==='no-speech') {
        // 靜音超時：只要用戶還在錄音，自動重啟，文字繼續累積
        if(isRecordingRef.current) {
          try{rec.stop();}catch{}
          setTimeout(()=>{ if(isRecordingRef.current) startWebSpeechSession(SR); }, 100);
        }
        return;
      }
      // 其他錯誤才真的停掉
      isRecordingRef.current=false; setVoiceState('idle');
    };

    rec.onend=()=>{
      // 瀏覽器強制停（iOS 60秒限制等）：自動重啟，文字繼續累積
      if(isRecordingRef.current) {
        setTimeout(()=>{ if(isRecordingRef.current) startWebSpeechSession(SR); }, 100);
      }
    };

    try{ rec.start(); } catch{ isRecordingRef.current=false; setVoiceState('idle'); }
  }, [setVoiceState]);

  const startWebSpeech = useCallback(() => {
    const w=window as any; const SR=w.SpeechRecognition||w.webkitSpeechRecognition; if(!SR) return false;
    finalTextRef.current=''; setInterimText(''); setEndDone(false);
    isRecordingRef.current=true;
    startWebSpeechSession(SR);
    setVoiceState('recording');
    return true;
  }, [setVoiceState, startWebSpeechSession]);

  const stopWebSpeechAndSend = useCallback(() => {
    isRecordingRef.current=false; // 先關旗，避免 onend 觸發重啟
    const rec=speechRecRef.current; if(rec){try{rec.stop();}catch{} speechRecRef.current=null;}
    sendToDialogue((finalTextRef.current+' '+interimText).trim());
  }, [interimText, sendToDialogue]);

  // ── Gemini STT fallback ──
  const startGemini = useCallback(async () => {
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true}); streamRef.current=stream;
      // iOS 不支援 audio/webm，動態選支援的格式
      const mimeType=['audio/webm','audio/mp4','audio/ogg'].find(t=>MediaRecorder.isTypeSupported(t))||'';
      const mr=new MediaRecorder(stream, mimeType ? {mimeType} : {}); chunksRef.current=[];
      mr.ondataavailable=e=>{if(e.data.size>0)chunksRef.current.push(e.data);}; mr.start(100);
      mediaRecorderRef.current=mr; setVoiceState('recording'); setEndDone(false);
    } catch { /* mic denied */ }
  }, [setVoiceState]);

  const stopGeminiAndSend = useCallback(() => {
    const mr=mediaRecorderRef.current; if(!mr) return;
    mr.onstop=async()=>{
      streamRef.current?.getTracks().forEach(t=>t.stop());
      const blobType=mr.mimeType||'audio/webm';
      const blob=new Blob(chunksRef.current,{type:blobType});
      try {
        const ext=blobType.includes('mp4')?'audio.mp4':'audio.webm';
        const form=new FormData(); form.append('audio',blob,ext);
        const sttRes=await fetch('/api/stt',{method:'POST',body:form});
        const sttData=await sttRes.json() as {text?:string};
        if(sttData.text) await sendToDialogue(sttData.text);
        else setVoiceState('idle');
      } catch { setVoiceState('idle'); }
    };
    mr.stop();
  }, [sendToDialogue, setVoiceState]);

  // ── 主按鈕 ──
  const handleMainButton = useCallback(() => {
    // iOS: 每次 user gesture 都預先解鎖一個 Audio 元素，供後續 blob 播放
    try { const a=new Audio(); a.play().catch(()=>{}); a.pause(); unlockedAudioRef.current=a; } catch {}
    if (state==='idle') { if(usingSpeechAPI) startWebSpeech(); else startGemini(); }
    else if (state==='recording') { if(usingSpeechAPI) stopWebSpeechAndSend(); else stopGeminiAndSend(); }
    else if (state==='playing') { audioRef.current?.pause(); setVoiceState('idle'); }
  }, [state, usingSpeechAPI, startWebSpeech, startGemini, stopWebSpeechAndSend, stopGeminiAndSend, setVoiceState]);

  // ── 結束對話 ──
  const endConversation = useCallback(async () => {
    if (!conversationId||state!=='idle') return;
    setVoiceState('ending');
    try {
      const res=await fetch('/api/voice-end',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId,conversationId})});
      const data=await res.json() as {saved?:number}; setInsightCount(data.saved||0); setEndDone(true);
    } catch { setEndDone(true); }
    finally { setVoiceState('idle'); }
  }, [conversationId, characterId, state, setVoiceState]);

  // ── 按鈕視覺 ──
  const dotColor = state==='recording' ? '#ff3b30' : state==='processing' ? '#ffffff' : state==='playing' ? '#00f2ff' : 'white';
  const ringColor = state==='recording' ? '#ff3b30' : state==='processing' ? 'rgba(255,255,255,0.6)' : state==='playing' ? '#00f2ff' : 'rgba(255,255,255,0.2)';
  const btnScale = state==='recording' ? 1.1 : state==='processing' ? 0.85 : state==='playing' ? 1.2 : 1;
  const dotScale = state==='recording' ? 1.5 : state==='processing' ? 0.7 : state==='playing' ? 1.8 : 1;
  const disabled = state==='processing'||state==='ending';

  const avatar = char?.visualIdentity?.characterSheet;

  return (
    <div style={{ position:'fixed', inset:0, background:'#000', overflow:'hidden', fontFamily:"'Inter', sans-serif" }}>
      {/* 粒子 Canvas */}
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0, display:'block', filter:'contrast(1.1) brightness(1.2)' }} />

      {/* 頂部：角色資訊 */}
      <div style={{ position:'absolute', top:0, left:0, right:0, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'24px 24px 0' }}>
        <div />

        <div />

        <div style={{ fontSize:18, color:'rgba(255,255,255,0.4)', letterSpacing:'0.15em', fontWeight:200 }}>
          {usingSpeechAPI ? 'LIVE' : 'CLOUD'}
        </div>
      </div>

      {/* 中心：按鈕 */}
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>

        {/* 角色名 — 按鈕上方 */}
        <div style={{
          marginBottom:20,
          fontSize:18,
          letterSpacing:'0.3em',
          textTransform:'uppercase',
          color:'rgba(255,255,255,0.85)',
          fontWeight:200,
          borderBottom:'1px solid rgba(255,255,255,0.4)',
          paddingBottom:4,
        }}>{char?.name||'…'}</div>

        {/* ping 圈（playing 時） */}
        {state==='playing' && (
          <div style={{ position:'absolute', width:180, height:180, borderRadius:'50%', border:'1px solid rgba(0,242,255,0.12)', animation:'ping 1.8s ease-out infinite' }} />
        )}

        <div
          onClick={disabled ? undefined : handleMainButton}
          style={{ position:'relative', width:160, height:160, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'auto', cursor: disabled ? 'default' : 'pointer' }}
        >
          <div style={{
            width:120, height:120, borderRadius:'50%',
            background:'rgba(255,255,255,0.04)',
            backdropFilter:'blur(20px)',
            border:`1px solid ${ringColor}`,
            display:'flex', alignItems:'center', justifyContent:'center',
            transform:`scale(${btnScale})`,
            transition:'all 0.8s cubic-bezier(0.16,1,0.3,1)',
            animation: state==='processing' ? 'breathe 1s infinite alternate' : 'none',
          }}>
            <div style={{
              width:20, height:20, borderRadius:'50%',
              background: dotColor,
              boxShadow:`0 0 24px ${dotColor}`,
              transform:`scale(${dotScale})`,
              transition:'all 0.6s ease',
            }} />
          </div>
        </div>

        {/* 狀態文字 */}
        <div style={{
          marginTop:32,
          fontSize:20,
          letterSpacing: state==='processing' ? '1em' : '0.8em',
          textTransform:'uppercase',
          fontWeight:200,
          color: state==='idle' ? 'rgba(255,255,255,0.6)' : state==='recording' ? '#ff3b30' : state==='processing' ? '#ffffff' : state==='playing' ? '#00f2ff' : 'rgba(255,255,255,0.6)',
          transition:'all 0.8s ease',
        }}>
          {STATE_LABEL[state]}
        </div>

        {/* 即時辨識文字（錄音時顯示，sonic 風格）*/}
        {state==='recording' && (finalTextRef.current || interimText) && (
          <div style={{
            marginTop:20,
            maxWidth:280,
            textAlign:'center',
            fontSize:14,
            fontWeight:200,
            letterSpacing:'0.05em',
            lineHeight:1.7,
            color:'rgba(255,80,60,0.85)',
            transition:'opacity 0.3s ease',
          }}>
            {finalTextRef.current}
            {interimText && <span style={{color:'rgba(255,80,60,0.45)'}}>{interimText}</span>}
          </div>
        )}
      </div>

      {/* 底部：輪數 / 結束 / 沉澱結果 */}
      <div style={{ position:'absolute', bottom:32, left:0, right:0, display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
        {endDone ? (
          <div style={{ fontSize:20, letterSpacing:'0.3em', fontWeight:200, color:'rgba(52,211,153,0.9)', textTransform:'uppercase' }}>
            ✓ {insightCount > 0 ? `${insightCount} MEMORIES` : 'SAVED'}
          </div>
        ) : messages.length >= 2 && state==='idle' && (
          <button onClick={endConversation} style={{
            background:'transparent', border:'1px solid rgba(255,255,255,0.3)',
            color:'rgba(255,255,255,0.7)', fontSize:18,
            letterSpacing:'0.3em', textTransform:'uppercase',
            fontWeight:200, padding:'10px 28px', borderRadius:20, cursor:'pointer',
            fontFamily:"'Inter', sans-serif",
          }}>
            END · {char?.name}
          </button>
        )}

        {messages.length > 0 && (
          <div style={{ fontSize:18, color:'rgba(255,255,255,0.35)', letterSpacing:'0.2em', fontWeight:200 }}>
            {messages.length / 2} TURNS
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@100;200;400&display=swap');
        @keyframes breathe {
          from { opacity:0.4; box-shadow:0 0 20px rgba(255,255,255,0.1); }
          to   { opacity:1;   box-shadow:0 0 60px rgba(255,255,255,0.4); }
        }
        @keyframes ping {
          0%   { transform:scale(1);   opacity:0.3; }
          100% { transform:scale(1.6); opacity:0; }
        }
      `}</style>
    </div>
  );
}
