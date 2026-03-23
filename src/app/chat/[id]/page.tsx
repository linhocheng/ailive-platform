'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  imageUrl?: string;
}

interface Character {
  id: string;
  name: string;
  mission: string;
  type: string;
  enhancedSoul: string;
  visualIdentity?: { characterSheet?: string };
}

const PC98Overlay = () => (
  <div style={{
    position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 50,
    overflow: 'hidden', userSelect: 'none',
  }}>
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(rgba(255,102,204,0.025) 1px, transparent 1px)',
      backgroundSize: '100% 2px',
    }} />
    <div style={{
      position: 'absolute', inset: 0,
      boxShadow: 'inset 0 0 120px rgba(255,102,204,0.08)',
    }} />
  </div>
);

export default function ChatPage() {
  const { id: characterId } = useParams<{ id: string }>();
  const [char, setChar] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const searchParams = useSearchParams();
  const cidFromUrl = searchParams.get('cid');
  const [conversationId, setConversationId] = useState<string | null>(cidFromUrl);
  const [userId] = useState(() => `web-${Math.random().toString(36).slice(2, 8)}`);
  const [mood, setMood] = useState<'happy' | 'sad' | 'love' | 'thinking'>('happy');

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<{ base64: string; preview: string; mimeType?: string } | null>(null);

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
        loadHistory(saved);
      }
    }
  }, [characterId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadHistory = async (convId: string) => {
    setLoadingHistory(true);
    try {
      const r = await fetch(`/api/dialogue?conversationId=${convId}`);
      const d = await r.json();
      if (d.messages?.length > 0) {
        setMessages(d.messages.map((m: Message) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || new Date().toISOString(),
          imageUrl: m.imageUrl,
        })));
      }
    } catch { /* ignore */ }
    finally { setLoadingHistory(false); }
  };

  const newConversation = () => {
    localStorage.removeItem(`conv-${characterId}`);
    setConversationId(null);
    setMessages([]);
    setMood('happy');
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      const mimeMatch = dataUrl.match(/^data:([^;]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : (file.type || 'image/jpeg');
      setPendingImage({ base64, preview: dataUrl, mimeType });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const send = useCallback(async () => {
    if ((!input.trim() && !pendingImage) || loading) return;

    const userContent = input.trim() || '\uff08\u50b3\u4e86\u4e00\u5f35\u5716\uff09';
    const currentImage = pendingImage;

    const userMsg: Message = {
      role: 'user', content: userContent,
      timestamp: new Date().toISOString(), imageUrl: currentImage?.preview,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setPendingImage(null);
    setLoading(true);
    setMood('thinking');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const body: Record<string, unknown> = {
        characterId, userId, message: userContent,
        conversationId: conversationId || undefined,
      };
      if (currentImage) {
        body.image = { type: 'base64', media_type: currentImage.mimeType || 'image/jpeg', data: currentImage.base64 };
      }

      const r = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || '\u5c0d\u8a71\u5931\u6557');

      if (d.conversationId && !conversationId) {
        setConversationId(d.conversationId);
        localStorage.setItem(`conv-${characterId}`, d.conversationId);
      }

      const replyText = d.reply || '';
      const urlMatch1 = replyText.match(/IMAGE_URL:(https?:\/\/[^\s]+)/);
      const urlMatch2 = replyText.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
      const extractedImageUrl = urlMatch1 ? urlMatch1[1] : urlMatch2 ? urlMatch2[1] : undefined;
      const cleanReply = replyText
        .replace(/IMAGE_URL:https?:\/\/[^\s]+/g, '')
        .replace(/!\[.*?\]\(https?:\/\/[^)]+\)/g, '')
        .trim();

      if (replyText.match(/\u611b|\u559c\u6b61|\u73cd\u60dc|\u5728\u4e00\u8d77|\u5fc3\u8df3/)) setMood('love');
      else if (replyText.match(/\u5c31\u5fc3|\u96e3\u904e|\u5bc2\u5bde|\u62b1\u6b49|\u5c0d\u4e0d\u8d77/)) setMood('sad');
      else setMood('happy');

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: cleanReply || '\uff08\u5716\u7247\u5df2\u751f\u6210\uff09',
        timestamp: new Date().toISOString(),
        imageUrl: extractedImageUrl,
      }]);
    } catch (err) {
      setMood('sad');
      setMessages(prev => [...prev, {
        role: 'assistant', content: `\u26a0 ${String(err)}`, timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, pendingImage, loading, characterId, userId, conversationId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const charName = char?.name || '\u2026';
  const avatar = char?.visualIdentity?.characterSheet;

  const moodMap = {
    happy:   { icon: '\u25c9', color: '#00ffcc' },
    sad:     { icon: '\u25ce', color: '#a388e4' },
    love:    { icon: '\u2665', color: '#ff66cc' },
    thinking:{ icon: '\u25c8', color: '#ffcc44' },
  };
  const currentMood = moodMap[mood];

  const formatTime = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 8px', fontSize: 9,
    fontFamily: "'Courier New', Courier, monospace",
    background: '#2d1b4d',
    color: active ? '#ff66cc' : '#4a338d',
    borderTop: `1px solid ${active ? '#ff66cc' : '#2d1b4d'}`,
    borderLeft: `1px solid ${active ? '#ff66cc' : '#2d1b4d'}`,
    borderBottom: '2px solid #0f0a1f',
    borderRight: '2px solid #0f0a1f',
    cursor: 'pointer',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
  });

  const bubbleStyle = (isUser: boolean): React.CSSProperties => ({
    maxWidth: '78%',
    padding: '10px 14px',
    background: isUser ? '#36246a' : '#1a1030',
    borderTop: `1px solid ${isUser ? 'rgba(0,255,204,0.5)' : 'rgba(255,102,204,0.5)'}`,
    borderLeft: `1px solid ${isUser ? 'rgba(0,255,204,0.5)' : 'rgba(255,102,204,0.5)'}`,
    borderBottom: '2px solid #0f0a1f',
    borderRight: '2px solid #0f0a1f',
    color: isUser ? '#c8ffe8' : '#e8d5f5',
    fontSize: 13,
    lineHeight: 1.8,
    fontWeight: 400,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  });

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100dvh',
      background: '#1a1030', fontFamily: "'Courier New', Courier, monospace",
      color: '#e0d5f5', overflow: 'hidden', position: 'relative',
    }}>
      {/* Dithering bg */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 0.15,
        backgroundImage: 'radial-gradient(#ff66cc 0.5px, transparent 0.5px)',
        backgroundSize: '4px 4px',
      }} />
      <PC98Overlay />

      {/* Title Bar */}
      <div style={{
        background: '#4a338d', padding: '5px 12px', zIndex: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '2px solid #1a1030',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.2em' }}>
          <span style={{ color: '#ff66cc' }}>\u25a3</span>
          <span style={{ color: '#fff' }}>SOUL_SYNC_TERMINAL v3.2</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['_', '\xd7'].map((c, i) => (
            <div key={i} style={{
              width: 18, height: 18, fontSize: 9, fontWeight: 900,
              background: '#36246a', color: '#ff66cc',
              borderTop: '1px solid #ff66cc', borderLeft: '1px solid #ff66cc',
              borderBottom: '2px solid #0f0a1f', borderRight: '2px solid #0f0a1f',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{c}</div>
          ))}
        </div>
      </div>

      {/* Info Strip */}
      <div style={{
        background: '#1a1030', padding: '3px 12px', zIndex: 10, flexShrink: 0,
        display: 'flex', gap: 16, fontSize: 9, color: '#ff66cc',
        textTransform: 'uppercase', letterSpacing: '0.1em',
        borderBottom: '1px solid rgba(255,102,204,0.15)',
      }}>
        <span>Mode: Soul_Dialogue</span>
        <span>Char: {charName}</span>
        <span style={{ marginLeft: 'auto' }}>\u25cf Signal_Active</span>
      </div>

      {/* Header */}
      <div style={{
        padding: '10px 14px', zIndex: 10, flexShrink: 0,
        background: '#241744', borderBottom: '2px solid #0f0a1f',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {avatar ? (
            <div style={{
              width: 40, height: 40, flexShrink: 0,
              border: '2px solid #ff66cc',
              boxShadow: '2px 2px 0 #0f0a1f, 0 0 10px rgba(255,102,204,0.3)',
              overflow: 'hidden',
            }}>
              <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ) : (
            <div style={{
              width: 40, height: 40, flexShrink: 0,
              background: '#2d1b4d', border: '2px solid #ff66cc',
              boxShadow: '2px 2px 0 #0f0a1f',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#ff66cc', fontSize: 18,
            }}>\u27c1</div>
          )}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: '0.1em' }}>{charName}</div>
            <div style={{ fontSize: 9, color: '#ff66cc', opacity: 0.7, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              {conversationId ? `ID_${conversationId.slice(-6).toUpperCase()}` : 'NEW_SESSION'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Mood Widget */}
          <div style={{
            width: 52, height: 52, background: '#2d1b4d',
            border: `2px solid ${currentMood.color}`,
            boxShadow: `3px 3px 0 #1a1030, 0 0 10px ${currentMood.color}44`,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 2, position: 'relative', flexShrink: 0,
          }}>
            <div style={{ fontSize: 7, color: currentMood.color, letterSpacing: '0.1em', opacity: 0.8 }}>EMO_SYNC</div>
            <div style={{ fontSize: 20, color: currentMood.color, lineHeight: 1 }}>{currentMood.icon}</div>
            <div style={{ position: 'absolute', top: 3, left: 3, width: 3, height: 3, background: currentMood.color, opacity: 0.5 }} />
            <div style={{ position: 'absolute', bottom: 3, right: 3, width: 3, height: 3, background: '#00ffcc', opacity: 0.5 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {conversationId && (
              <button onClick={() => loadHistory(conversationId)} disabled={loadingHistory} style={btnStyle(true)}>
                {loadingHistory ? 'LOAD\u2026' : '\u21bb RELOAD'}
              </button>
            )}
            <button onClick={newConversation} style={btnStyle(true)}>+ NEW</button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '20px 16px',
        display: 'flex', flexDirection: 'column', zIndex: 1,
      }}>
        {loadingHistory && (
          <div style={{ textAlign: 'center', color: '#ff66cc', fontSize: 9, letterSpacing: '0.3em', padding: 40, textTransform: 'uppercase' }}>
            \u25c8 LOADING_HISTORY\u2026
          </div>
        )}

        {!loadingHistory && messages.length === 0 && char && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 40 }}>
            {avatar ? (
              <div style={{
                width: 80, height: 80, flexShrink: 0,
                border: '2px solid #ff66cc',
                boxShadow: '4px 4px 0 #0f0a1f, 0 0 30px rgba(255,102,204,0.2)',
                overflow: 'hidden',
              }}>
                <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ) : (
              <div style={{
                width: 80, height: 80, background: '#2d1b4d',
                border: '2px solid #ff66cc', boxShadow: '4px 4px 0 #0f0a1f',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#ff66cc', fontSize: 36,
              }}>\u27c1</div>
            )}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '0.2em', marginBottom: 8 }}>{charName}</div>
              <div style={{ fontSize: 9, color: '#ff66cc', opacity: 0.7, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8 }}>
                Soul Visualization Protocol
              </div>
              <div style={{ fontSize: 12, color: '#a388e4', maxWidth: 260, lineHeight: 1.8 }}>{char.mission || '\u958b\u59cb\u5c0d\u8a71'}</div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          const time = formatTime(msg.timestamp);
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {!isUser && avatar && (
                  <img src={avatar} alt="" style={{ width: 16, height: 16, objectFit: 'cover', border: '1px solid #ff66cc' }} />
                )}
                <span style={{ fontSize: 8, letterSpacing: '0.25em', fontWeight: 700, textTransform: 'uppercase', color: isUser ? '#00ffcc' : '#ff66cc' }}>
                  {isUser ? 'USER' : charName.toUpperCase()}
                </span>
                <span style={{ fontSize: 8, color: '#4a338d', letterSpacing: '0.1em' }}>{time} //</span>
              </div>
              <div style={bubbleStyle(isUser)}>
                {msg.imageUrl && (
                  <img src={msg.imageUrl} alt="" style={{
                    maxWidth: '100%', display: 'block',
                    border: '1px solid rgba(255,102,204,0.3)',
                    marginBottom: msg.content ? 8 : 0,
                  }} />
                )}
                {msg.content}
              </div>
            </div>
          );
        })}

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              {avatar && <img src={avatar} alt="" style={{ width: 16, height: 16, objectFit: 'cover', border: '1px solid #ff66cc' }} />}
              <span style={{ fontSize: 8, letterSpacing: '0.25em', fontWeight: 700, color: '#ff66cc', textTransform: 'uppercase' }}>
                {charName.toUpperCase()}
              </span>
            </div>
            <div style={{
              padding: '10px 14px', background: '#1a1030',
              borderTop: '1px solid rgba(255,102,204,0.5)',
              borderLeft: '1px solid rgba(255,102,204,0.5)',
              borderBottom: '2px solid #0f0a1f', borderRight: '2px solid #0f0a1f',
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 9, color: '#00ffcc', letterSpacing: '0.2em',
            }}>
              \u25c8 ANALYZING_SOUL_WAVE\u2026
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div style={{ padding: '10px 14px 14px', zIndex: 10, flexShrink: 0, background: '#1a1030', borderTop: '2px solid #241744' }}>
        {pendingImage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, maxWidth: 680, margin: '0 auto 8px' }}>
            <img src={pendingImage.preview} alt="" style={{ height: 40, border: '1px solid #ff66cc', boxShadow: '2px 2px 0 #0f0a1f' }} />
            <span style={{ fontSize: 9, color: '#ff66cc', letterSpacing: '0.15em', textTransform: 'uppercase' }}>IMG_LOADED</span>
            <button onClick={() => setPendingImage(null)} style={btnStyle(true)}>\u2715</button>
          </div>
        )}
        <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', maxWidth: 680, margin: '0 auto' }}>
          <button onClick={() => imageInputRef.current?.click()} disabled={loading} style={{
            padding: '8px 10px', flexShrink: 0,
            background: '#2d1b4d', color: '#ff66cc', fontSize: 14,
            borderTop: '1px solid #ff66cc', borderLeft: '1px solid #ff66cc',
            borderBottom: '2px solid #0f0a1f', borderRight: '2px solid #0f0a1f',
            cursor: 'pointer', lineHeight: 1,
          }}>\U0001f5bc</button>
          <div style={{
            flex: 1, position: 'relative',
            borderTop: '1px solid rgba(255,102,204,0.5)',
            borderLeft: '1px solid rgba(255,102,204,0.5)',
            borderBottom: '2px solid #0f0a1f', borderRight: '2px solid #0f0a1f',
            background: '#0f0a1f',
          }}>
            <span style={{
              position: 'absolute', top: -8, left: 8,
              background: '#1a1030', padding: '0 4px',
              fontSize: 8, color: '#ff66cc', letterSpacing: '0.2em', textTransform: 'uppercase',
            }}>INPUT_CMD</span>
            <textarea ref={textareaRef} value={input}
              onChange={e => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              onKeyDown={onKeyDown}
              placeholder={`\u50b3\u8a0a\u606f\u7d66 ${charName}\u2026`}
              rows={1} disabled={loading}
              style={{
                width: '100%', background: 'transparent', border: 'none', outline: 'none',
                padding: '10px 12px', color: '#ff66cc',
                fontSize: 13, fontFamily: "'Courier New', Courier, monospace",
                lineHeight: 1.5, resize: 'none', maxHeight: 120, overflowY: 'auto',
              }}
            />
          </div>
          <button onClick={send} disabled={loading || (!input.trim() && !pendingImage)} style={{
            padding: '10px 14px', flexShrink: 0,
            fontFamily: "'Courier New', Courier, monospace",
            background: (loading || (!input.trim() && !pendingImage)) ? '#2d1b4d' : '#ff66cc',
            color: (loading || (!input.trim() && !pendingImage)) ? '#4a338d' : '#1a1030',
            borderTop: '1px solid #ff66cc', borderLeft: '1px solid #ff66cc',
            borderBottom: '2px solid #0f0a1f', borderRight: '2px solid #0f0a1f',
            fontSize: 10, fontWeight: 900, cursor: loading ? 'default' : 'pointer',
            letterSpacing: '0.15em', textTransform: 'uppercase',
          }}>SEND</button>
        </div>
      </div>

      {/* Footer Status Bar */}
      <div style={{
        background: '#0f0a1f', padding: '4px 14px', zIndex: 10, flexShrink: 0,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 8, color: '#ff66cc', borderTop: '2px solid #1a1030',
      }}>
        <div style={{ display: 'flex', gap: 14, opacity: 0.6 }}>
          <span>\u2b21 MEMORY_INIT</span>
          <span>\u26a1 V-SYNC_LOCKED</span>
          <span>AILIVE \u00b7 {charName.toUpperCase()}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff66cc', boxShadow: '0 0 4px #ff66cc' }} />
          SIGNAL_STABLE
        </div>
      </div>

      <style>{`
        @keyframes spin-slow { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        div[style*="overflow-y: auto"]::-webkit-scrollbar { width: 8px; }
        div[style*="overflow-y: auto"]::-webkit-scrollbar-track { background: #1a1030; border-left: 1px solid rgba(255,102,204,0.2); }
        div[style*="overflow-y: auto"]::-webkit-scrollbar-thumb { background: #36246a; border: 1px solid #ff66cc; }
        textarea::placeholder { color: rgba(255,102,204,0.25); }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
