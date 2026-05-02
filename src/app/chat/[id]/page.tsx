'use client';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import CommissionStatusBar from '@/components/CommissionStatusBar';
import type { ActiveJob } from '@/lib/commission-stages';
import { deriveMiniLight } from '@/lib/commission-stages';

interface Message {
  role: 'user' | 'assistant' | 'system_event';
  content: string;
  timestamp: string;
  imageUrl?: string;
  // system_event 專屬
  eventType?: string;
  specialistName?: string;
  specialistId?: string;
  jobId?: string;
  output?: { type: string; imageUrl?: string; docUrl?: string; slideUrl?: string; title?: string; workLog?: string };
  workLog?: string;
  error?: string;
}

interface Character {
  id: string;
  name: string;
  mission: string;
  type: string;
  enhancedSoul: string;
  visualIdentity?: { characterSheet?: string };
}

// ── SVG 線條圖示（strokeWidth 1.5，無 fill）──
const IconImage = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
);

const IconRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);

const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

const IconSend = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);

const IconClose = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const IconUser = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

const IconBack = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);

export default function ChatPage() {
  const { id: characterId } = useParams<{ id: string }>();
  const [char, setChar] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const searchParams = useSearchParams();
  const cidFromUrl = searchParams.get('cid');
  const [conversationId, setConversationId] = useState<string | null>(cidFromUrl);
  // 穩定 userId：與 voice/realtime 共用同一 localStorage key，記憶跨模式打通
  const [userId] = useState(() => {
    if (typeof window === 'undefined') return '';
    let id = localStorage.getItem('ailive_realtime_anon_uid');
    if (!id) {
      id = `anon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem('ailive_realtime_anon_uid', id);
    }
    return id;
  });
  // ref 讓 event handler 能讀到最新 conversationId（閉包不更新）
  const conversationIdRef = useRef<string | null>(cidFromUrl);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<{ base64: string; preview: string; mimeType?: string } | null>(null);
  const [isNewVisit, setIsNewVisit] = useState(true);

  useEffect(() => {
    fetch(`/api/characters/${characterId}`)
      .then(r => r.json())
      .then(d => setChar(d.character));
  }, [characterId]);

  useEffect(() => {
    if (cidFromUrl) {
      localStorage.setItem(`conv-${characterId}`, cidFromUrl);
      loadHistory(cidFromUrl);
    } else {
      const saved = localStorage.getItem(`conv-${characterId}`);
      if (saved) {
        setConversationId(saved);
        conversationIdRef.current = saved;
        loadHistory(saved);
      }
    }
  }, [characterId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── dialogue-end 觸發器：visibilitychange / beforeunload / 10 分鐘閒置 ──
  useEffect(() => {
    const IDLE_MS = 10 * 60 * 1000;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const fire = () => {
      const cid = conversationIdRef.current;
      if (!cid || !characterId || !userId) return;
      const payload = JSON.stringify({ characterId, conversationId: cid, userId });
      navigator.sendBeacon('/api/dialogue-end', new Blob([payload], { type: 'application/json' }));
    };

    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(fire, IDLE_MS);
    };

    const onVisibility = () => { if (document.hidden) fire(); };
    const onUnload = () => fire();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('mousemove', resetIdle);
    window.addEventListener('keydown', resetIdle);
    resetIdle();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('mousemove', resetIdle);
      window.removeEventListener('keydown', resetIdle);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [characterId, userId]);

  // ── Polling：每 5s 更新 messages + activeJobs（捕捉 system_event 交件 + 委託狀態）──
  useEffect(() => {
    if (!conversationId) return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/dialogue?conversationId=${conversationId}`);
        const d = await r.json();
        if (d.messages?.length > 0) {
          setMessages(prev => {
            // 只有訊息數量增加時才更新（避免覆蓋 streaming）
            if (d.messages.length <= prev.length) return prev;
            return d.messages.map((m: Message) => ({
              role: m.role,
              content: m.content || '',
              timestamp: m.timestamp || new Date().toISOString(),
              imageUrl: m.imageUrl || m.output?.imageUrl,
              eventType: m.eventType,
              specialistName: m.specialistName,
              specialistId: m.specialistId,
              jobId: m.jobId,
              output: m.output,
              workLog: m.workLog,
              error: m.error,
            }));
          });
        }
        // activeJobs 每次都覆寫（後端已過濾 active + 60s 內）
        if (Array.isArray(d.activeJobs)) setActiveJobs(d.activeJobs as ActiveJob[]);
      } catch { /* ignore polling errors */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [conversationId]);

  const loadHistory = async (convId: string) => {
    setLoadingHistory(true);
    try {
      const r = await fetch(`/api/dialogue?conversationId=${convId}`);
      const d = await r.json();
      if (d.messages?.length > 0) {
        setMessages(d.messages.map((m: Message) => ({
          role: m.role,
          content: m.content || '',
          timestamp: m.timestamp || new Date().toISOString(),
          imageUrl: m.imageUrl || m.output?.imageUrl,
          // system_event fields
          eventType: m.eventType,
          specialistName: m.specialistName,
          specialistId: m.specialistId,
          jobId: m.jobId,
          output: m.output,
          workLog: m.workLog,
          error: m.error,
        })));
      }
      if (Array.isArray(d.activeJobs)) setActiveJobs(d.activeJobs as ActiveJob[]);
    } catch { /* ignore */ }
    finally { setLoadingHistory(false); }
  };

  const newConversation = () => {
    localStorage.removeItem(`conv-${characterId}`);
    setConversationId(null);
    setMessages([]);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Canvas 壓縮：最長邊 1280px，quality 0.85，防止大圖炸 Vercel 4.5MB 上限
      const img = new window.Image();
      img.onload = () => {
        const MAX = 1280;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = compressed.split(',')[1];
        setPendingImage({ base64, preview: compressed, mimeType: 'image/jpeg' });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const send = useCallback(async () => {
    if ((!input.trim() && !pendingImage) || loading) return;
    const userContent = input.trim() || '（傳了一張圖）';
    const currentImage = pendingImage;
    const userMsg: Message = { role: 'user', content: userContent, timestamp: new Date().toISOString(), imageUrl: currentImage?.preview };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setPendingImage(null);
    setLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // 加一個 streaming 用的佔位訊息
    const streamingIdx = React.createRef<number>();
    let streamingContent = '';
    setMessages(prev => { (streamingIdx as React.MutableRefObject<number>).current = prev.length; return [...prev, { role: 'assistant', content: '', timestamp: new Date().toISOString() }]; });

    try {
      const body: Record<string, unknown> = {
        characterId, userId, message: userContent,
        conversationId: conversationId || undefined, isNewVisit,
      };
      setIsNewVisit(false);
      if (currentImage) {
        body.image = { type: 'base64', media_type: currentImage.mimeType || 'image/jpeg', data: currentImage.base64 };
      }
      const r = await fetch('/api/dialogue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok || !r.body) throw new Error('連線失敗');

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let sseBuf = '';
      let extractedImageUrl: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuf += dec.decode(value, { stream: true });
        const lines = sseBuf.split('\n');
        sseBuf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as { type: string; content?: string; conversationId?: string; imageUrl?: string; message?: string };
            if (ev.type === 'text' && ev.content) {
              streamingContent += ev.content;
              // 即時更新 streaming 訊息
              const idx = (streamingIdx as React.MutableRefObject<number>).current;
              const liveImgMatch = streamingContent.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
              const liveImg = liveImgMatch ? liveImgMatch[1] : undefined;
              setMessages(prev => prev.map((m, i) => i === idx
                ? { ...m,
                    content: streamingContent.replace(/!\[.*?\]\(https?:\/\/[^)]+\)/g, '').replace(/IMAGE_URL:https?:\/\/[^\s]+/g, '').trim(),
                    ...(liveImg ? { imageUrl: liveImg } : {})
                  }
                : m));
            }
            if (ev.type === 'done') {
              if (ev.conversationId && !conversationId) {
                setConversationId(ev.conversationId);
                conversationIdRef.current = ev.conversationId;
                localStorage.setItem(`conv-${characterId}`, ev.conversationId);
              }
              if (ev.imageUrl) extractedImageUrl = ev.imageUrl;
              // 清理 markdown 圖片語法，最終更新
              const urlMatch1 = streamingContent.match(/IMAGE_URL:(https?:\/\/[^\s]+)/);
              const urlMatch2 = streamingContent.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
              extractedImageUrl = extractedImageUrl || (urlMatch1 ? urlMatch1[1] : urlMatch2 ? urlMatch2[1] : undefined);
              const cleanReply = streamingContent
                .replace(/IMAGE_URL:https?:\/\/[^\s]+/g, '')
                .replace(/!\[.*?\]\(https?:\/\/[^)]+\)/g, '')
                .trim();
              const idx = (streamingIdx as React.MutableRefObject<number>).current;
              setMessages(prev => prev.map((m, i) => i === idx
                ? { ...m, content: cleanReply || '（圖片已生成）', imageUrl: extractedImageUrl }
                : m));
            }
            if (ev.type === 'error') throw new Error(ev.message);
          } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
        }
      }
    } catch (err) {
      const idx = (streamingIdx as React.MutableRefObject<number>).current;
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, content: String(err) } : m));
    } finally { setLoading(false); }
  }, [input, pendingImage, loading, characterId, userId, conversationId, isNewVisit]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const charName = char?.name || '…';
  const avatar = char?.visualIdentity?.characterSheet;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100dvh',
      background: '#FFFFFF',
      fontFamily: 'var(--font-body, "DM Sans", system-ui, sans-serif)',
    }}>

      {/* ── Header ── */}
      <header style={{
        padding: '0 20px', height: 56,
        borderBottom: '1px solid var(--border, #E4E2DC)',
        background: '#FFFFFF',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a href={`/dashboard/${characterId}`} style={{
            width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted, #9C9A95)',
            borderRadius: 6,
            transition: 'background 0.15s, color 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-alt, #EDECEA)'; e.currentTarget.style.color = 'var(--text-primary, #1A1916)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted, #9C9A95)'; }}
          ><IconBack /></a>

          <div style={{ width: 1, height: 20, background: 'var(--border, #E4E2DC)' }} />

          <div style={{ position: 'relative', width: 30, height: 30 }}>
            {avatar ? (
              <img src={avatar} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border, #E4E2DC)' }} />
            ) : (
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'var(--bg-alt, #EDECEA)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted, #9C9A95)',
              }}><IconUser /></div>
            )}
            {(() => {
              const mini = deriveMiniLight(activeJobs, messages as unknown as Array<{ role?: string; eventType?: string; jobId?: string }>);
              if (mini === 'idle') return null;
              const color =
                mini === 'failed' ? '#C0392B'
                : mini === 'done' ? '#27AE60'
                : mini === 'running' ? '#E67E22'  // 橘（脈動）
                : '#E67E22'; // pending 也橘（尚未接到工）
              const pulse = (mini === 'running' || mini === 'pending');
              const title =
                mini === 'failed' ? '有委託失敗'
                : mini === 'done' ? '剛完成委託'
                : mini === 'running' ? '瞬的手在動'
                : '委託已送出，等候接單';
              return (
                <span
                  title={title}
                  style={{
                    position: 'absolute', right: -1, bottom: -1,
                    width: 10, height: 10, borderRadius: '50%',
                    background: color,
                    border: '1.5px solid var(--bg-primary, #FFFFFF)',
                    animation: pulse ? 'zhu-minilight-pulse 1.2s ease-in-out infinite' : undefined,
                    boxShadow: pulse ? '0 0 0 2px rgba(230,126,34,0.18)' : undefined,
                  }}
                />
              );
            })()}
            <style>{`@keyframes zhu-minilight-pulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }`}</style>
          </div>

          <div>
            <div style={{
              fontSize: 14, fontWeight: 600,
              color: 'var(--text-primary, #1A1916)',
              fontFamily: 'var(--font-display, "Syne", sans-serif)',
              letterSpacing: '-0.01em',
            }}>{charName}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted, #9C9A95)', letterSpacing: '0.08em' }}>
              {conversationId ? `#${conversationId.slice(-6)}` : '新對話'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {conversationId && (
            <button onClick={() => loadHistory(conversationId)} disabled={loadingHistory}
              style={{
                padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 5,
                background: 'transparent', border: '1px solid var(--border, #E4E2DC)',
                borderRadius: 6, color: 'var(--text-muted, #9C9A95)',
                fontSize: 12, cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-secondary)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <IconRefresh />
              {loadingHistory ? '載入中' : '重新整理'}
            </button>
          )}
          <button onClick={newConversation}
            style={{
              padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 5,
              background: 'transparent', border: '1px solid var(--border, #E4E2DC)',
              borderRadius: 6, color: 'var(--text-muted, #9C9A95)',
              fontSize: 12, cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-secondary)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <IconPlus /> 新對話
          </button>
        </div>
      </header>

      <CommissionStatusBar
        jobs={activeJobs}
        messages={messages as unknown as Array<{ role?: string; eventType?: string; jobId?: string }>}
      />

      {/* ── Messages ── */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '28px 0',
        display: 'flex', flexDirection: 'column',
        background: '#FFFFFF',
      }}>

        {loadingHistory && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 40 }}>載入對話記錄中…</div>
        )}

        {!loadingHistory && messages.length === 0 && char && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 40 }}>
            {avatar
              ? <img src={avatar} alt="" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }} />
              : <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}><IconUser /></div>
            }
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontFamily: 'var(--font-display, "Syne", sans-serif)',
                fontSize: 18, fontWeight: 700,
                color: 'var(--text-primary)', marginBottom: 6,
                letterSpacing: '-0.02em',
              }}>{charName}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 260, lineHeight: 1.65 }}>{char.mission || '開始對話'}</div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '0 20px', maxWidth: 760, margin: '0 auto', width: '100%' }}>
          {messages.map((msg, i) => {
            const isUser = msg.role === 'user';
            const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '';

            // ── system_event bubble（瞬交件）──
            if (msg.role === 'system_event') {
              const delivered = msg.eventType === 'specialist_delivered';
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
                  <div style={{
                    maxWidth: '85%', borderRadius: 12, overflow: 'hidden',
                    border: '1px solid var(--border, #E4E2DC)',
                    background: 'var(--surface-2, #FAFAF8)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border, #E4E2DC)', background: 'var(--bg-alt, #F5F3EF)' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {delivered ? ('🎨 ' + (msg.specialistName || '瞬') + ' 交件了') : ('⚠️ ' + (msg.specialistName || '瞬') + ' 回報')}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{time}</span>
                    </div>
                    {msg.output?.imageUrl && (
                      <div style={{ padding: '12px 14px 8px' }}>
                        <img
                          src={msg.output.imageUrl}
                          alt={msg.output.title || ''}
                          style={{ width: '100%', maxWidth: 380, borderRadius: 8, display: 'block', border: '1px solid var(--border)' }}
                        />
                      </div>
                    )}
                    {msg.output?.docUrl && (
                      <div style={{ padding: '10px 14px' }}>
                        <a href={msg.output.docUrl} target="_blank" rel="noreferrer" style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                          borderRadius: 8, border: '1px solid var(--border)', background: 'white',
                          color: 'var(--text-primary)', fontSize: 13, textDecoration: 'none', fontWeight: 500,
                        }}>
                          {'📄 ' + (msg.output.title || '查看文件')}
                        </a>
                      </div>
                    )}
                    {msg.output?.slideUrl && (
                      <div style={{ padding: '10px 14px' }}>
                        <a href={msg.output.slideUrl} target="_blank" rel="noreferrer" style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                          borderRadius: 8, border: '1px solid var(--border)', background: 'white',
                          color: 'var(--text-primary)', fontSize: 13, textDecoration: 'none', fontWeight: 500,
                        }}>
                          {'▶ 查看投影片'}
                        </a>
                      </div>
                    )}
                    {msg.error && (
                      <div style={{ padding: '10px 14px', color: '#c0392b', fontSize: 13 }}>{msg.error}</div>
                    )}
                    {msg.workLog && (
                      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.6 }}>
                        {(msg.specialistName || '瞬') + '：' + msg.workLog}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', marginBottom: 20 }}>
                {/* Name + time */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {!isUser && avatar && (
                    <img src={avatar} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }} />
                  )}
                  <span style={{
                    fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                    color: isUser ? 'var(--text-muted)' : 'var(--text-secondary)',
                    textTransform: 'uppercase',
                  }}>{isUser ? 'You' : charName}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{time}</span>
                </div>

                {/* Bubble */}
                <div style={{
                  maxWidth: '72%', padding: '11px 15px',
                  borderRadius: isUser ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
                  background: isUser ? 'var(--bg-alt, #EDECEA)' : 'var(--surface-2, #FAFAF8)',
                  border: '1px solid var(--border, #E4E2DC)',
                  color: 'var(--text-primary, #1A1916)',
                  fontSize: 14, lineHeight: 1.7, fontWeight: 400,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.imageUrl && (
                    <img src={msg.imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: 8, display: 'block', marginBottom: msg.content ? 8 : 0, border: '1px solid var(--border)' }} />
                  )}
                  {msg.content}
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {avatar && <img src={avatar} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} />}
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{charName}</span>
              </div>
              <div style={{
                padding: '12px 16px',
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: '14px 14px 14px 3px',
                display: 'flex', gap: 4, alignItems: 'center',
              }}>
                {[0, 1, 2].map(j => (
                  <div key={j} style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: 'var(--text-muted)',
                    animation: `typing-dot 1.2s ${j * 0.2}s ease-in-out infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div style={{
        padding: '12px 20px 16px',
        borderTop: '1px solid var(--border, #E4E2DC)',
        background: '#FFFFFF',
        flexShrink: 0,
      }}>
        {pendingImage && (
          <div style={{ maxWidth: 720, margin: '0 auto 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={pendingImage.preview} alt="" style={{ height: 40, borderRadius: 6, border: '1px solid var(--border)' }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>圖片已選取</span>
            <button onClick={() => setPendingImage(null)} style={{
              width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', background: 'none',
              border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
            }}><IconClose /></button>
          </div>
        )}

        <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', maxWidth: 720, margin: '0 auto' }}>
          <button onClick={() => imageInputRef.current?.click()} disabled={loading}
            style={{
              width: 38, height: 38, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 8, color: 'var(--text-muted)', cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-secondary)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          ><IconImage /></button>

          <textarea ref={textareaRef} value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={onKeyDown}
            placeholder={`傳訊息給 ${charName}`}
            rows={1} disabled={loading}
            style={{
              flex: 1,
              background: 'var(--bg, #F5F4F1)',
              border: '1px solid var(--border, #E4E2DC)',
              borderRadius: 8,
              padding: '9px 14px',
              color: 'var(--text-primary)',
              fontSize: 14, lineHeight: 1.5,
              resize: 'none', outline: 'none',
              fontFamily: 'inherit',
              maxHeight: 120, overflowY: 'auto',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--text-secondary)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          />

          <button onClick={send} disabled={loading || (!input.trim() && !pendingImage)}
            style={{
              width: 38, height: 38, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: (loading || (!input.trim() && !pendingImage)) ? 'var(--bg)' : 'var(--text-primary, #1A1916)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: (loading || (!input.trim() && !pendingImage)) ? 'var(--text-muted)' : '#fff',
              cursor: (loading || (!input.trim() && !pendingImage)) ? 'default' : 'pointer',
              transition: 'all 0.15s',
            }}
          ><IconSend /></button>
        </div>

        <p style={{
          textAlign: 'center', fontSize: 10,
          color: 'var(--text-muted)', margin: '8px 0 0',
          letterSpacing: '0.15em',
        }}>AILIVE · {charName}</p>
      </div>

      <style>{`
        @keyframes typing-dot {
          0%, 100% { opacity: 0.25; transform: translateY(0); }
          50% { opacity: 0.8; transform: translateY(-2px); }
        }
        * { box-sizing: border-box; }
        textarea::placeholder { color: var(--text-muted); }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
      `}</style>
    </div>
  );
}
