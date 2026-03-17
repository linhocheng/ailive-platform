'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

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

export default function ChatPage() {
  const { id: characterId } = useParams<{ id: string }>();
  const [char, setChar] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [userId] = useState(() => `web-${Math.random().toString(36).slice(2, 8)}`);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<{ base64: string; preview: string } | null>(null);

  // 載入角色資料
  useEffect(() => {
    fetch(`/api/characters/${characterId}`)
      .then(r => r.json())
      .then(d => setChar(d.character));
  }, [characterId]);

  // 恢復 conversationId（localStorage）
  useEffect(() => {
    const saved = localStorage.getItem(`conv-${characterId}`);
    if (saved) {
      setConversationId(saved);
      loadHistory(saved);
    }
  }, [characterId]);

  // 自動滾到底
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
          imageUrl: m.imageUrl,  // 歷史載入時帶出 imageUrl，圖片才能正確顯示
        })));
      }
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
      const base64 = (reader.result as string).split(',')[1];
      setPendingImage({ base64, preview: reader.result as string });
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

    try {
      const body: Record<string, unknown> = {
        characterId,
        userId,
        message: userContent,
        conversationId: conversationId || undefined,
      };
      if (currentImage) {
        body.image = { type: 'base64', media_type: 'image/jpeg', data: currentImage.base64 };
      }

      const r = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();

      if (!d.success) throw new Error(d.error || '對話失敗');

      // 儲存 conversationId
      if (d.conversationId && !conversationId) {
        setConversationId(d.conversationId);
        localStorage.setItem(`conv-${characterId}`, d.conversationId);
      }

      // 解析生圖 URL（支援兩種格式）
      // 格式1: IMAGE_URL:https://...
      // 格式2: ![...](https://...) markdown
      const replyText = d.reply || '';
      const urlMatch1 = replyText.match(/IMAGE_URL:(https?:\/\/[^\s]+)/);
      const urlMatch2 = replyText.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
      const extractedImageUrl = urlMatch1 ? urlMatch1[1] : urlMatch2 ? urlMatch2[1] : undefined;
      const cleanReply = replyText
        .replace(/IMAGE_URL:https?:\/\/[^\s]+/g, '')
        .replace(/!\[.*?\]\(https?:\/\/[^)]+\)/g, '')
        .trim();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: cleanReply || '（圖片已生成）',
        timestamp: new Date().toISOString(),
        imageUrl: extractedImageUrl,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant', content: `⚠ ${String(err)}`, timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, pendingImage, loading, characterId, userId, conversationId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const charName = char?.name || '…';
  const avatar = char?.visualIdentity?.characterSheet;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0f0f13', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <header style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e28', background: '#13131a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {avatar ? (
            <img src={avatar} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '1px solid #2a2a38' }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1e1e2e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c63ff', fontSize: 16 }}>⟁</div>
          )}
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#e8e8f0' }}>{charName}</div>
            <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              {conversationId ? `#${conversationId.slice(-6)}` : 'new conversation'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {conversationId && (
            <button onClick={() => loadHistory(conversationId)} disabled={loadingHistory}
              style={{ padding: '5px 12px', background: 'transparent', border: '1px solid #2a2a38', borderRadius: 20, color: '#888', fontSize: 11, cursor: 'pointer', letterSpacing: '0.05em' }}>
              {loadingHistory ? '載入中' : '↻ 重新載入'}
            </button>
          )}
          <button onClick={newConversation}
            style={{ padding: '5px 12px', background: 'transparent', border: '1px solid #2a2a38', borderRadius: 20, color: '#888', fontSize: 11, cursor: 'pointer', letterSpacing: '0.05em' }}>
            + 新對話
          </button>
        </div>
      </header>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>

        {loadingHistory && (
          <div style={{ textAlign: 'center', color: '#444', fontSize: 11, letterSpacing: '0.2em', padding: 40 }}>載入對話記錄中…</div>
        )}

        {!loadingHistory && messages.length === 0 && char && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40 }}>
            {avatar && <img src={avatar} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '2px solid #2a2a38' }} />}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#e8e8f0', marginBottom: 6 }}>{charName}</div>
              <div style={{ fontSize: 13, color: '#555', maxWidth: 280, lineHeight: 1.6 }}>{char.mission || '開始對話'}</div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '';
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                {!isUser && avatar && <img src={avatar} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} />}
                <span style={{ fontSize: 10, letterSpacing: '0.2em', fontWeight: 700, textTransform: 'uppercase', color: isUser ? '#444' : '#6c63ff' }}>
                  {isUser ? 'You' : charName}
                </span>
                <span style={{ fontSize: 10, color: '#333' }}>{time}</span>
              </div>
              <div style={{
                maxWidth: '75%', padding: '12px 16px',
                borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: isUser ? '#1a1a2e' : '#16161f',
                border: isUser ? '1px solid #2a2a4a' : '1px solid #6c63ff33',
                color: isUser ? '#c8c8e8' : '#e0e0f0',
                fontSize: 14, lineHeight: 1.75, fontWeight: 300,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {msg.imageUrl && (
                  <img src={msg.imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: 10, display: 'block', marginBottom: msg.content ? 8 : 0 }} />
                )}
                {msg.content}
              </div>
            </div>
          );
        })}

        {/* 打字動畫 */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              {avatar && <img src={avatar} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} />}
              <span style={{ fontSize: 10, letterSpacing: '0.2em', fontWeight: 700, textTransform: 'uppercase', color: '#6c63ff' }}>{charName}</span>
            </div>
            <div style={{ padding: '14px 18px', background: '#16161f', border: '1px solid #6c63ff33', borderRadius: '18px 18px 18px 4px', display: 'flex', gap: 5, alignItems: 'center' }}>
              {[0, 1, 2].map(j => (
                <div key={j} style={{ width: 5, height: 5, borderRadius: '50%', background: '#6c63ff', opacity: 0.6, animation: `pulse 1.2s ${j * 0.2}s ease-in-out infinite` }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{ padding: '12px 16px 20px', borderTop: '1px solid #1e1e28', background: '#13131a', flexShrink: 0 }}>

        {/* 圖片預覽 */}
        {pendingImage && (
          <div style={{ maxWidth: 680, margin: '0 auto 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={pendingImage.preview} alt="" style={{ height: 44, borderRadius: 8, border: '1px solid #2a2a38' }} />
            <span style={{ fontSize: 11, color: '#555' }}>圖片已選擇</span>
            <button onClick={() => setPendingImage(null)} style={{ fontSize: 11, color: '#555', background: 'none', border: '1px solid #2a2a38', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', maxWidth: 680, margin: '0 auto' }}>
          <button onClick={() => imageInputRef.current?.click()} disabled={loading}
            style={{ padding: '10px 12px', background: '#1a1a26', border: '1px solid #2a2a38', borderRadius: 12, cursor: 'pointer', fontSize: 16, lineHeight: 1, color: '#555', flexShrink: 0 }}>
            🖼
          </button>

          <textarea ref={textareaRef} value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={onKeyDown}
            placeholder={`傳訊息給 ${charName}…`}
            rows={1} disabled={loading}
            style={{
              flex: 1, background: '#1a1a26', border: '1px solid #2a2a38', borderRadius: 12,
              padding: '10px 14px', color: '#e0e0f0', fontSize: 14, fontWeight: 300,
              resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
              maxHeight: 120, overflowY: 'auto',
            }}
          />

          <button onClick={send} disabled={loading || (!input.trim() && !pendingImage)}
            style={{
              padding: '10px 18px', flexShrink: 0,
              background: loading || (!input.trim() && !pendingImage) ? '#1a1a26' : '#6c63ff',
              border: 'none', borderRadius: 12,
              color: loading || (!input.trim() && !pendingImage) ? '#444' : '#fff',
              fontSize: 13, fontWeight: 600, cursor: loading || (!input.trim() && !pendingImage) ? 'default' : 'pointer',
              transition: 'all 0.15s', letterSpacing: '0.05em',
            }}>
            發送
          </button>
        </div>

        <p style={{ textAlign: 'center', fontSize: 9, color: '#2a2a38', margin: '8px 0 0', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          AILIVE · {charName}
        </p>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.2;transform:scale(0.8)} 50%{opacity:0.8;transform:scale(1)} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a38; border-radius: 2px; }
      `}</style>
    </div>
  );
}
