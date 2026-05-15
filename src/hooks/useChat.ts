'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { ActiveJob } from '@/lib/commission-stages';

// ── Types ──────────────────────────────────────────────────────────────────
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system_event';
  content: string;
  timestamp: string;
  imageUrl?: string;
  // system_event 專屬
  eventType?: string;
  specialistName?: string;
  specialistId?: string;
  jobId?: string;
  output?: {
    type: string;
    imageUrl?: string;
    docUrl?: string;
    htmlUrl?: string;
    slideUrl?: string;
    title?: string;
    workLog?: string;
  };
  workLog?: string;
  error?: string;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  activeJobs: ActiveJob[];
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  loadingHistory: boolean;
  conversationId: string | null;
  pendingImage: { base64: string; preview: string; mimeType?: string } | null;
  setPendingImage: (v: { base64: string; preview: string; mimeType?: string } | null) => void;
  send: () => Promise<void>;
  newConversation: () => void;
  loadHistory: (convId: string) => Promise<void>;
  handleImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

// ── mapMessage helper ──────────────────────────────────────────────────────
function mapMessage(m: ChatMessage): ChatMessage {
  return {
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
  };
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useChat(characterId: string): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<{ base64: string; preview: string; mimeType?: string } | null>(null);
  const [isNewVisit, setIsNewVisit] = useState(true);

  // 穩定 userId：與 voice/realtime 共用，記憶跨模式打通
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
  const conversationIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // ── 初始化：讀 localStorage 的上次 conversationId ──
  useEffect(() => {
    if (!characterId) return;
    const saved = localStorage.getItem(`conv-${characterId}`);
    if (saved) {
      setConversationId(saved);
      conversationIdRef.current = saved;
      loadHistory(saved);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  // ── 自動捲到底 ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── dialogue-end beacon（閒置 10 分鐘 / 離開頁面觸發）──
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

  // ── Polling：每 5s 拉 messages + activeJobs（捕捉 system_event + 委託狀態）──
  useEffect(() => {
    if (!conversationId) return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/dialogue?conversationId=${conversationId}`);
        const d = await r.json();
        if (d.messages?.length > 0) {
          setMessages(prev => {
            // 只在訊息數量增加時更新（避免覆蓋 streaming 中的佔位訊息）
            if (d.messages.length <= prev.length) return prev;
            return d.messages.map(mapMessage);
          });
        }
        if (Array.isArray(d.activeJobs)) setActiveJobs(d.activeJobs as ActiveJob[]);
      } catch { /* polling 錯誤靜默 */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [conversationId]);

  // ── loadHistory ──────────────────────────────────────────────────────────
  const loadHistory = useCallback(async (convId: string) => {
    setLoadingHistory(true);
    try {
      const r = await fetch(`/api/dialogue?conversationId=${convId}`);
      const d = await r.json();
      if (d.messages?.length > 0) setMessages(d.messages.map(mapMessage));
      if (Array.isArray(d.activeJobs)) setActiveJobs(d.activeJobs as ActiveJob[]);
    } catch { /* ignore */ }
    finally { setLoadingHistory(false); }
  }, []);

  // ── newConversation ───────────────────────────────────────────────────────
  const newConversation = useCallback(() => {
    localStorage.removeItem(`conv-${characterId}`);
    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    setActiveJobs([]);
    setIsNewVisit(true);
  }, [characterId]);

  // ── handleImageSelect（canvas 壓縮，最長邊 1280px）────────────────────────
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
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
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.85);
        setPendingImage({ base64: compressed.split(',')[1], preview: compressed, mimeType: 'image/jpeg' });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  // ── send（POST + SSE 解析）────────────────────────────────────────────────
  const send = useCallback(async () => {
    if ((!input.trim() && !pendingImage) || loading) return;

    const userContent = input.trim() || '（傳了一張圖）';
    const currentImage = pendingImage;

    const userMsg: ChatMessage = {
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString(),
      imageUrl: currentImage?.preview,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setPendingImage(null);
    setLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // 加 streaming 佔位訊息，記下 index
    let streamingIdx = -1;
    let streamingContent = '';
    setMessages(prev => {
      streamingIdx = prev.length;
      return [...prev, { role: 'assistant', content: '', timestamp: new Date().toISOString() }];
    });

    try {
      const body: Record<string, unknown> = {
        characterId,
        userId,
        message: userContent,
        conversationId: conversationIdRef.current || undefined,
        isNewVisit,
      };
      setIsNewVisit(false);
      if (currentImage) {
        body.image = { type: 'base64', media_type: currentImage.mimeType || 'image/jpeg', data: currentImage.base64 };
      }

      const r = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
            const ev = JSON.parse(line.slice(6)) as {
              type: string;
              content?: string;
              conversationId?: string;
              imageUrl?: string;
              message?: string;
            };

            if (ev.type === 'text' && ev.content) {
              streamingContent += ev.content;
              // 即時更新佔位訊息，順便抓 markdown 圖片
              const liveImgMatch = streamingContent.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
              const liveImg = liveImgMatch ? liveImgMatch[1] : undefined;
              const idx = streamingIdx;
              setMessages(prev => prev.map((m, i) => i === idx
                ? {
                    ...m,
                    content: streamingContent
                      .replace(/!\[.*?\]\(https?:\/\/[^)]+\)/g, '')
                      .replace(/IMAGE_URL:https?:\/\/[^\s]+/g, '')
                      .trim(),
                    ...(liveImg ? { imageUrl: liveImg } : {}),
                  }
                : m));
            }

            if (ev.type === 'done') {
              if (ev.conversationId && !conversationIdRef.current) {
                conversationIdRef.current = ev.conversationId;
                setConversationId(ev.conversationId);
                localStorage.setItem(`conv-${characterId}`, ev.conversationId);
              }
              if (ev.imageUrl) extractedImageUrl = ev.imageUrl;
              // 清理 markdown 圖片語法，最終更新
              const urlMatch1 = streamingContent.match(/IMAGE_URL:(https?:\/\/[^\s]+)/);
              const urlMatch2 = streamingContent.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
              extractedImageUrl = extractedImageUrl || urlMatch1?.[1] || urlMatch2?.[1];
              const cleanReply = streamingContent
                .replace(/IMAGE_URL:https?:\/\/[^\s]+/g, '')
                .replace(/!\[.*?\]\(https?:\/\/[^)]+\)/g, '')
                .trim();
              const idx = streamingIdx;
              setMessages(prev => prev.map((m, i) => i === idx
                ? { ...m, content: cleanReply || '（圖片已生成）', imageUrl: extractedImageUrl }
                : m));
            }

            if (ev.type === 'error') throw new Error(ev.message);
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } catch (err) {
      const idx = streamingIdx;
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, content: String(err) } : m));
    } finally {
      setLoading(false);
    }
  }, [input, pendingImage, loading, characterId, userId, isNewVisit]);

  return {
    messages, activeJobs,
    input, setInput,
    loading, loadingHistory,
    conversationId,
    pendingImage, setPendingImage,
    send, newConversation, loadHistory,
    handleImageSelect,
    imageInputRef, bottomRef, textareaRef,
  };
}
