'use client';
import './client-v2.css';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useChat } from '@/hooks/useChat';

// ── Types ──────────────────────────────────────────────────────────────────
interface Character {
  id: string; name: string; mission: string; type: string;
  enhancedSoul: string; clientPassword?: string;
  visualIdentity?: { characterSheet?: string };
}
interface Post {
  id: string; content: string; imageUrl?: string; topic: string;
  status: string; createdAt: string; scheduledAt?: string; igPostId?: string; imagePrompt?: string;
}
interface Task {
  id: string; type: string; description: string; intent?: string; enabled: boolean;
  run_hour: number; run_minute: number; days: string[]; last_run?: string;
}
interface KnowledgeItem {
  id: string; title: string; content: string; category: string;
  hitCount: number; createdAt: string; imageUrl?: string;
}
interface ImageItem {
  url: string; conversationId: string; timestamp: string;
  source: string; specialistName?: string; workLog?: string;
}
type Tab = 'posts' | 'schedule' | 'knowledge' | 'gallery' | 'chat';

// ── Constants ──────────────────────────────────────────────────────────────
const DAYS_LABEL: Record<string,string> = { mon:'一',tue:'二',wed:'三',thu:'四',fri:'五',sat:'六',sun:'日' };
const ALL_DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const STATUS_META: Record<string,{cls:string;label:string}> = {
  draft:     { cls:'badge-draft',     label:'草稿' },
  scheduled: { cls:'badge-scheduled', label:'已排程' },
  published: { cls:'badge-published', label:'已發佈' },
  rejected:  { cls:'badge-rejected',  label:'已拒絕' },
};
const TYPE_LABEL: Record<string,string> = {
  post:'生成草稿', reflect:'每日省思', learn:'主動學習',
  explore:'探索學習', sleep:'作夢沉澱', engage:'互動',
};

// ── Icon ──────────────────────────────────────────────────────────────────
function Icon({ name, size=16 }: { name:string; size?: number }) {
  const s = { width:size, height:size, display:'block', flexShrink:0 } as React.CSSProperties;
  const p = { fill:'none', stroke:'currentColor', strokeWidth:1.5, strokeLinecap:'round' as const, strokeLinejoin:'round' as const };
  switch(name) {
    case 'post':    return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
    case 'calendar':return <svg style={s} viewBox="0 0 24 24" {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
    case 'book':    return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>;
    case 'image':   return <svg style={s} viewBox="0 0 24 24" {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
    case 'chat':    return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
    case 'mic':     return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>;
    case 'lock':    return <svg style={s} viewBox="0 0 24 24" {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
    case 'check':   return <svg style={s} viewBox="0 0 24 24" {...p}><polyline points="20 6 9 17 4 12"/></svg>;
    case 'x':       return <svg style={s} viewBox="0 0 24 24" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
    case 'trash':   return <svg style={s} viewBox="0 0 24 24" {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
    case 'edit':    return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
    case 'upload':  return <svg style={s} viewBox="0 0 24 24" {...p}><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>;
    case 'plus':    return <svg style={s} viewBox="0 0 24 24" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
    case 'send':    return <svg style={s} viewBox="0 0 24 24" {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
    case 'refresh': return <svg style={s} viewBox="0 0 24 24" {...p}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
    case 'hash':    return <svg style={s} viewBox="0 0 24 24" {...p}><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>;
    case 'filter':  return <svg style={s} viewBox="0 0 24 24" {...p}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
    case 'sparkle': return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>;
    case 'eye':     return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
    case 'search':  return <svg style={s} viewBox="0 0 24 24" {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
    case 'doc':     return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
    case 'clock':   return <svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    case 'phone':   return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.62 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.72-.72a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>;
    case 'new-chat':return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/></svg>;
    case 'chevron-down': return <svg style={s} viewBox="0 0 24 24" {...p}><polyline points="6 9 12 15 18 9"/></svg>;
    case 'globe':   return <svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
    case 'menu':    return <svg style={s} viewBox="0 0 24 24" {...p}><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
    default:        return <svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/></svg>;
  }
}

// ── PasswordGate ──────────────────────────────────────────────────────────
function PasswordGate({ char, onUnlock }: { char: Character; onUnlock: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    if (!pw.trim()) return;
    setChecking(true); setError('');
    const stored = char.clientPassword;
    const ok = !stored || pw === stored;
    if (ok) {
      sessionStorage.setItem(`client_unlocked_${char.id}`, '1');
      onUnlock();
    } else {
      setError('密碼錯誤，請再試一次');
      setChecking(false); setPw('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="client-v2">
      <div className="login-stage">
        <div className="login-corner">
          <div className="brand-mark">AI</div>
          <span>AILIVE</span>
        </div>
        <div className="login-card">
          <div className="login-character">
            <div className="avatar avatar-lg">
              {char.visualIdentity?.characterSheet
                ? <img src={char.visualIdentity.characterSheet} alt="" />
                : char.name[0]
              }
            </div>
            <h1>{char.name}</h1>
            {char.mission && (
              <div className="tagline">{char.mission.slice(0, 80)}{char.mission.length > 80 ? '…' : ''}</div>
            )}
          </div>
          <div className="field">
            <label className="field-label">存取密碼</label>
            <input
              ref={inputRef}
              className="input input-lg"
              type="password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="輸入密碼繼續…"
              style={{ textAlign: 'center', letterSpacing: '0.3em' }}
            />
          </div>
          {error && <div className="login-error"><Icon name="x" size={13} />{error}</div>}
          <button
            className="btn btn-primary btn-lg"
            onClick={submit}
            disabled={checking || !pw.trim()}
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
          >
            {checking ? '驗證中…' : '進入'}
          </button>
          <div className="login-foot">
            由 <strong>AILIVE</strong> 提供支援<br />
            你正在存取 <strong>{char.name}</strong> 的專屬後台
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PostsScreen ────────────────────────────────────────────────────────────
function PostsScreen({ charId }: { charId: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('draft');
  const [acting, setActing] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTopicId, setEditTopicId] = useState<string | null>(null);
  const [editTopic, setEditTopic] = useState('');
  const [editImgId, setEditImgId] = useState<string | null>(null);
  const [editImg, setEditImg] = useState('');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [regenResult, setRegenResult] = useState<{ id: string; success: boolean; message?: string } | null>(null);
  const [editPromptId, setEditPromptId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/posts?characterId=${charId}&limit=50`).then(r => r.json()).then(d => { setPosts(d.posts || []); setLoading(false); });
  }, [charId]);
  useEffect(() => { load(); }, [load]);

  const patch = async (id: string, fields: Record<string, unknown>) => {
    await fetch('/api/posts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...fields }) });
    load();
  };
  const regenerateImage = async (postId: string, newPrompt?: string) => {
    setRegenerating(postId); setRegenResult(null);
    try {
      const res = await fetch('/api/posts/regenerate-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, imagePrompt: newPrompt }),
      });
      const data = await res.json();
      setRegenResult({ id: postId, success: data.success, message: data.success ? '圖片已更新' : (data.error || '生圖失敗') });
      if (data.success) { setEditPromptId(null); load(); }
      setTimeout(() => setRegenResult(null), 4000);
    } catch { setRegenResult({ id: postId, success: false, message: '連線錯誤' }); setTimeout(() => setRegenResult(null), 4000); }
    setRegenerating(null);
  };

  const approve = async (id: string) => { setActing(id); await patch(id, { status: 'scheduled' }); setActing(null); };
  const reject  = async (id: string) => { setActing(id); await patch(id, { status: 'rejected' });  setActing(null); };
  const del     = async (id: string) => {
    if (!confirm('確定刪除這篇草稿？')) return;
    setActing(id);
    await fetch('/api/posts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setActing(null); load();
  };

  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter);
  const counts = { all: posts.length, draft: 0, scheduled: 0, published: 0, rejected: 0 };
  posts.forEach(p => { if (p.status in counts) (counts as Record<string, number>)[p.status]++; });

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          <h1>貼文</h1>
          <span className="subtitle">{counts.draft} 則草稿等你審核</span>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost"><Icon name="filter" size={14} />篩選</button>
        </div>
      </div>
      <div className="content">
        <div className="page-head">
          <h2>等你過目的草稿</h2>
          <p>AI 角色會依照排程自動產生貼文草稿。你可以直接修改文字、核准上架，或標記拒絕。所有變動都會即時同步。</p>
        </div>
        <div className="post-toolbar">
          <div className="pills">
            {(['draft', 'scheduled', 'published', 'rejected', 'all'] as const).map(s => (
              <button key={s} className={`pill${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>
                {s === 'all' ? '全部' : STATUS_META[s]?.label || s}
                <span className="pill-count">{counts[s]}</span>
              </button>
            ))}
          </div>
        </div>

        {loading ? <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>載入中…</div>
          : filtered.length === 0
            ? <div className="empty"><div className="empty-icon"><Icon name="post" size={28} /></div><h4>這個分類目前沒有貼文</h4></div>
            : (
              <div className="post-list">
                {filtered.map(post => {
                  const sc = STATUS_META[post.status] || { cls: '', label: post.status };
                  const isDraft = post.status === 'draft';
                  return (
                    <div key={post.id} className="card post-card">
                      <div className="post-card-head">
                        <div className="post-card-meta">
                          <span className={`badge ${sc.cls}`}><span className="badge-dot" />{sc.label}</span>
                          {post.igPostId && <span className="badge badge-published">IG 已發佈</span>}
                          {editTopicId === post.id ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <input className="input" value={editTopic} onChange={e => setEditTopic(e.target.value)} style={{ width: 120, padding: '4px 8px', fontSize: 12 }} />
                              <button className="icon-btn" onClick={async () => { setSaving(true); await patch(post.id, { topic: editTopic }); setSaving(false); setEditTopicId(null); }} disabled={saving}><Icon name="check" size={13} /></button>
                              <button className="icon-btn" onClick={() => setEditTopicId(null)}><Icon name="x" size={13} /></button>
                            </div>
                          ) : (
                            <button onClick={() => { setEditTopicId(post.id); setEditTopic(post.topic || ''); }}
                              style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--ink-3)', fontSize: 13 }}>
                              <Icon name="hash" size={13} />{post.topic || '加 topic'}
                            </button>
                          )}
                        </div>
                        <div className="post-card-actions">
                          {post.status === 'scheduled' && post.scheduledAt
                            ? <span className="post-date" style={{ color: 'var(--green)' }}>排程：{new Date(post.scheduledAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                            : <span className="post-date">{new Date(post.createdAt).toLocaleDateString('zh-TW')}</span>
                          }
                          {isDraft && !editingId && (
                            <button className="icon-btn" title="編輯文案" onClick={() => { setEditingId(post.id); setEditContent(post.content); }}><Icon name="edit" size={14} /></button>
                          )}
                          <button className="icon-btn" title="刪除" onClick={() => del(post.id)} disabled={!!acting}
                            style={{ color: 'var(--ink-3)' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--ink-3)'}><Icon name="trash" size={14} /></button>
                        </div>
                      </div>

                      <div className="post-body">
                        {isDraft && editingId === post.id ? (
                          <div>
                            <textarea className="textarea" value={editContent} onChange={e => setEditContent(e.target.value)}
                              rows={Math.max(4, editContent.split('\n').length + 1)} style={{ borderColor: 'var(--accent)', marginBottom: 8 }} />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-sm btn-primary" onClick={async () => { setSaving(true); await patch(post.id, { content: editContent }); setSaving(false); setEditingId(null); }} disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
                              <button className="btn btn-sm" onClick={() => setEditingId(null)}>取消</button>
                            </div>
                          </div>
                        ) : (
                          <div className="post-text"
                            onClick={() => { if (isDraft) { setEditingId(post.id); setEditContent(post.content); } }}
                            style={{ cursor: isDraft ? 'text' : 'default' }}>
                            {post.content}
                          </div>
                        )}

                        {post.imageUrl && (
                          <div className="post-image" style={{ marginTop: 16 }}>
                            <img src={post.imageUrl} alt="" />
                          </div>
                        )}
                        {regenerating === post.id && <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 8 }}>生成中…（約30-60秒）</div>}
                        {regenResult?.id === post.id && <div style={{ fontSize: 12, color: regenResult.success ? 'var(--green)' : 'var(--red)', marginTop: 6 }}>{regenResult.message}</div>}
                        {isDraft && editPromptId === post.id ? (
                          <div style={{ marginTop: 12 }}>
                            <label className="field-label">圖片描述（英文更精準）</label>
                            <textarea className="textarea" value={editPrompt} onChange={e => setEditPrompt(e.target.value)} rows={3} placeholder="描述畫面場景、光線、構圖…" />
                            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                              <button className="btn btn-sm btn-accent" onClick={() => regenerateImage(post.id, editPrompt)} disabled={!!regenerating || !editPrompt.trim()}><Icon name="refresh" size={13} />生圖</button>
                              <button className="btn btn-sm" onClick={() => setEditPromptId(null)}>取消</button>
                            </div>
                          </div>
                        ) : isDraft ? (
                          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                            {post.imagePrompt && <button className="btn btn-sm" onClick={() => regenerateImage(post.id)} disabled={!!regenerating} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}><Icon name="refresh" size={13} />重新生圖</button>}
                            <button className="btn btn-sm" onClick={() => { setEditPromptId(post.id); setEditPrompt(post.imagePrompt || ''); }}><Icon name="edit" size={13} />{post.imagePrompt ? '改描述' : '寫描述'}</button>
                            <button className="btn btn-sm" onClick={() => { setEditImgId(post.id); setEditImg(post.imageUrl || ''); }}><Icon name="image" size={13} />{post.imageUrl ? '換圖URL' : '貼圖URL'}</button>
                          </div>
                        ) : null}
                        {editImgId === post.id && (
                          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                            <input className="input" value={editImg} onChange={e => setEditImg(e.target.value)} placeholder="圖片 URL" style={{ flex: 1 }} />
                            <button className="btn btn-sm btn-primary" onClick={async () => { setSaving(true); await patch(post.id, { imageUrl: editImg }); setSaving(false); setEditImgId(null); }} disabled={saving}><Icon name="check" size={13} /></button>
                            <button className="btn btn-sm" onClick={() => setEditImgId(null)}><Icon name="x" size={13} /></button>
                          </div>
                        )}
                      </div>

                      <div className="post-card-foot">
                        <div className="post-card-foot-left">
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink-3)' }}><Icon name="globe" size={13} />Instagram · Facebook</span>
                        </div>
                        <div className="post-card-foot-right">
                          {(post.status === 'draft' || post.status === 'scheduled') && (
                            <button className="btn btn-sm btn-danger-ghost" onClick={() => reject(post.id)} disabled={!!acting}><Icon name="x" size={13} />拒絕</button>
                          )}
                          {post.status === 'draft' && (
                            <button className="btn btn-sm btn-accent" onClick={() => approve(post.id)} disabled={!!acting}><Icon name="check" size={13} />核准排程</button>
                          )}
                          {post.status === 'scheduled' && (
                            <span style={{ fontSize: 12, color: 'var(--blue)' }}>等待發佈中</span>
                          )}
                          {post.status === 'rejected' && (
                            <button className="btn btn-sm" onClick={() => patch(post.id, { status: 'draft' })}><Icon name="refresh" size={13} />還原草稿</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
      </div>
    </>
  );
}

// ── ScheduleScreen ─────────────────────────────────────────────────────────
function ScheduleScreen({ charId }: { charId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState('post');
  const [newDesc, setNewDesc] = useState('');
  const [newIntent, setNewIntent] = useState('');
  const [newHour, setNewHour] = useState(9);
  const [newMin, setNewMin] = useState(0);
  const [newDays, setNewDays] = useState(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/tasks?characterId=${charId}`).then(r => r.json()).then(d => { setTasks(d.tasks || []); setLoading(false); });
  }, [charId]);
  useEffect(() => { load(); }, [load]);

  const patch = async (taskId: string, updates: Partial<Task>) => {
    await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: taskId, ...updates }) });
    load();
  };
  const del = async (taskId: string) => {
    if (!confirm('確定刪除這個排程任務？')) return;
    setDeleting(taskId);
    await fetch(`/api/tasks?id=${taskId}`, { method: 'DELETE' });
    setDeleting(null); load();
  };
  const addTask = async () => {
    if (newDays.length === 0) return;
    setAdding(true);
    await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: charId, type: newType, description: newDesc, intent: newIntent, run_hour: newHour, run_minute: newMin, days: newDays, enabled: true }) });
    setAdding(false); setShowAdd(false);
    setNewType('post'); setNewDesc(''); setNewIntent(''); setNewHour(9); setNewMin(0); setNewDays(['mon', 'tue', 'wed', 'thu', 'fri']);
    load();
  };

  const activeTasks = tasks.filter(t => t.enabled).length;

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          <h1>排程</h1>
          <span className="subtitle">{activeTasks} 個自動任務執行中</span>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={() => setShowAdd(v => !v)}><Icon name="plus" size={14} />新增任務</button>
        </div>
      </div>
      <div className="content">
        <div className="page-head">
          <h2>AI 角色的工作排程</h2>
          <p>每天會在固定時間生成草稿、產出配圖、發佈已核准的貼文。你可以隨時調整時間與頻率，或暫時停用。</p>
        </div>

        {showAdd && (
          <div className="card card-pad" style={{ marginBottom: 20, borderColor: 'var(--accent-soft)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>新增排程任務</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div className="field">
                <label className="field-label">類型</label>
                <select className="select" value={newType} onChange={e => setNewType(e.target.value)}>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">時間</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select className="select" value={newHour} onChange={e => setNewHour(Number(e.target.value))}>
                    {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}
                  </select>
                  <span style={{ color: 'var(--ink-3)', fontWeight: 600 }}>:</span>
                  <select className="select" value={newMin} onChange={e => setNewMin(Number(e.target.value))}>
                    {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="field">
              <label className="field-label">描述（選填）</label>
              <input className="input" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="任務說明" />
            </div>
            <div className="field">
              <label className="field-label">任務意義</label>
              <textarea className="textarea" value={newIntent} onChange={e => setNewIntent(e.target.value)} rows={3} placeholder="這個任務存在的意義是什麼？" />
            </div>
            <div className="field">
              <label className="field-label">執行日</label>
              <div style={{ display: 'flex', gap: 5 }}>
                {ALL_DAYS.map(d => {
                  const active = newDays.includes(d);
                  return (
                    <button key={d} onClick={() => setNewDays(prev => active ? prev.filter(x => x !== d) : [...prev, d])}
                      style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--line)', fontSize: 12, fontWeight: active ? 600 : 400, cursor: 'pointer', background: active ? 'var(--ink)' : 'transparent', color: active ? 'var(--bg)' : 'var(--ink-3)', transition: 'all 0.12s' }}>
                      {DAYS_LABEL[d]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={addTask} disabled={adding || newDays.length === 0}>{adding ? '新增中…' : '新增'}</button>
              <button className="btn" onClick={() => setShowAdd(false)}>取消</button>
            </div>
          </div>
        )}

        {loading ? <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>載入中…</div>
          : tasks.length === 0
            ? <div className="empty"><div className="empty-icon"><Icon name="calendar" size={28} /></div><h4>目前沒有排程任務</h4></div>
            : (
              <div>
                {tasks.map(task => (
                  editing?.id === task.id ? (
                    <div key={task.id} className="card card-pad" style={{ marginBottom: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                        <div className="field"><label className="field-label">小時</label><input type="number" className="input" min={0} max={23} value={editing.run_hour} onChange={e => setEditing({ ...editing, run_hour: +e.target.value })} /></div>
                        <div className="field"><label className="field-label">分鐘</label><input type="number" className="input" min={0} max={59} value={editing.run_minute} onChange={e => setEditing({ ...editing, run_minute: +e.target.value })} /></div>
                      </div>
                      <div className="field"><label className="field-label">描述</label><textarea className="textarea" value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={2} /></div>
                      <div className="field"><label className="field-label">任務意義</label><textarea className="textarea" value={editing.intent || ''} onChange={e => setEditing({ ...editing, intent: e.target.value })} rows={4} placeholder="這個任務存在的意義是什麼？" /></div>
                      <div className="field">
                        <label className="field-label">執行日</label>
                        <div style={{ display: 'flex', gap: 5 }}>
                          {ALL_DAYS.map(d => {
                            const active = editing.days.includes(d);
                            return <button key={d} onClick={() => { const days = active ? editing.days.filter(x => x !== d) : [...editing.days, d]; if (days.length > 0) setEditing({ ...editing, days }); }}
                              style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--line)', fontSize: 12, fontWeight: active ? 600 : 400, cursor: 'pointer', background: active ? 'var(--ink)' : 'transparent', color: active ? 'var(--bg)' : 'var(--ink-3)' }}>{DAYS_LABEL[d]}</button>;
                          })}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary" onClick={async () => { setSaving(true); await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) }); setSaving(false); setEditing(null); load(); }} disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
                        <button className="btn" onClick={() => setEditing(null)}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <div key={task.id} className={`schedule-task${!task.enabled ? ' disabled' : ''}`}>
                      <div className="schedule-time">
                        <span className="hh">{String(task.run_hour).padStart(2, '0')}:{String(task.run_minute).padStart(2, '0')}</span>
                      </div>
                      <div className="schedule-meta">
                        <div className="task-name">
                          {TYPE_LABEL[task.type] || task.type}
                          <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400, marginLeft: 8 }}>週{task.days.map(d => DAYS_LABEL[d] || '').join('')}</span>
                        </div>
                        <div className="task-detail">
                          {task.description && <span>{task.description}</span>}
                          {task.intent && <span style={{ borderLeft: '2px solid var(--line)', paddingLeft: 8 }}>{task.intent.slice(0, 100)}{task.intent.length > 100 ? '…' : ''}</span>}
                          {task.last_run && <span style={{ color: 'var(--ink-4)' }}>上次執行：{new Date(task.last_run).toLocaleString('zh-TW')}</span>}
                        </div>
                      </div>
                      <div className="schedule-actions">
                        <button onClick={() => patch(task.id, { enabled: !task.enabled })}
                          className="btn btn-sm"
                          style={{ borderColor: task.enabled ? 'var(--green)' : 'var(--line)', color: task.enabled ? 'var(--green)' : 'var(--ink-3)', background: task.enabled ? 'var(--green-soft)' : 'transparent' }}>
                          {task.enabled ? '啟用中' : '已停用'}
                        </button>
                        <button className="icon-btn" onClick={() => setEditing(task)}><Icon name="edit" size={14} /></button>
                        <button className="icon-btn" onClick={() => del(task.id)} disabled={deleting === task.id}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'} onMouseLeave={e => e.currentTarget.style.color = ''}><Icon name="trash" size={14} /></button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}
      </div>
    </>
  );
}

// ── KnowledgeScreen ────────────────────────────────────────────────────────
function KnowledgeScreen({ charId }: { charId: string }) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'parsing' | 'done' | 'error'>('idle');
  const [uploadMsg, setUploadMsg] = useState('');
  const [mode, setMode] = useState<'file' | 'manual'>('file');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/knowledge?characterId=${charId}&limit=100`).then(r => r.json()).then(d => { setItems(d.knowledge || []); setLoading(false); });
  }, [charId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!content.trim()) return;
    setAdding(true);
    await fetch('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: charId, title, content, category }) });
    setTitle(''); setContent(''); setAdding(false); load();
  };
  const del = async (id: string) => {
    await fetch(`/api/knowledge?id=${id}`, { method: 'DELETE' });
    setItems(prev => prev.filter(i => i.id !== id));
  };
  const clearByCategory = async (target: string) => {
    const targets = target === 'all' ? items : items.filter(i => i.category === target);
    if (targets.length === 0) return;
    if (!confirm(`確定清除？此操作不可復原。`)) return;
    setClearing(target);
    for (const item of targets) await fetch(`/api/knowledge?id=${item.id}`, { method: 'DELETE' });
    setClearing(null); load();
  };
  const uploadFile = async (file: File) => {
    setUploadStatus('uploading'); setUploadMsg('取得上傳憑證中…');
    try {
      const urlRes = await fetch('/api/knowledge-upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream', characterId: charId }) });
      const urlData = await urlRes.json();
      if (!urlData.uploadUrl) throw new Error(urlData.error || '取得 URL 失敗');
      setUploadMsg(`上傳中… (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      const putRes = await fetch(urlData.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!putRes.ok) throw new Error(`上傳失敗 (HTTP ${putRes.status})`);
      setUploadStatus('parsing'); setUploadMsg('解析文件，拆分知識條目中…');
      const parseRes = await fetch('/api/knowledge-parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storagePath: urlData.storagePath, characterId: charId, filename: file.name, category: 'document' }) });
      const parseData = await parseRes.json();
      if (!parseData.success) throw new Error(parseData.error || '解析失敗');
      setUploadStatus('done');
      const textPart = parseData.text ? `文字 ${parseData.text.chunks} 條` : `${parseData.saved} 條`;
      const imgPart = parseData.images?.chunks > 0 ? `、圖片 ${parseData.images.chunks} 條` : '';
      setUploadMsg(`${file.name} 解析完成，新增 ${textPart}${imgPart}`);
      load();
    } catch (e: unknown) {
      setUploadStatus('error'); setUploadMsg(e instanceof Error ? e.message : String(e));
    } finally { if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const isUploading = uploadStatus === 'uploading' || uploadStatus === 'parsing';
  const categoryCount = items.reduce<Record<string, number>>((acc, item) => { acc[item.category] = (acc[item.category] || 0) + 1; return acc; }, {});
  const totalHits = items.reduce((sum, k) => sum + k.hitCount, 0);

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          <h1>知識庫</h1>
          <span className="subtitle">{items.length} 條 · 累積被引用 {totalHits.toLocaleString()} 次</span>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost"><Icon name="search" size={14} />搜尋知識</button>
        </div>
      </div>
      <div className="content">
        <div className="page-head">
          <h2>給 AI 角色的腦袋餵料</h2>
          <p>AI 角色寫每一則貼文時，都會先翻過這裡的知識。內容越完整、越具體，寫出來的東西就越像你的品牌。</p>
        </div>

        <div className="knowledge-grid">
          <div>
            <div className="post-toolbar" style={{ marginBottom: 14 }}>
              <div className="pills" style={{ flexWrap: 'wrap' }}>
                <button className="pill active" onClick={() => {}}><span>全部</span><span className="pill-count">{items.length}</span></button>
                {Object.entries(categoryCount).map(([cat, count]) => (
                  <button key={cat} className="pill">
                    <span>{cat}</span>
                    <span className="pill-count">{count}</span>
                  </button>
                ))}
              </div>
              {Object.keys(categoryCount).length > 0 && (
                <button className="btn btn-sm btn-danger-ghost" onClick={() => clearByCategory('all')} disabled={clearing !== null}>{clearing === 'all' ? '清除中…' : `全部清除（${items.length}）`}</button>
              )}
            </div>

            <div className="card" style={{ padding: 0 }}>
              {loading ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>載入中…</div>
              ) : items.length === 0 ? (
                <div className="empty" style={{ border: 0 }}><div className="empty-icon"><Icon name="book" size={28} /></div><h4>還沒有知識</h4><p>從右側上傳文件或手動輸入新增。</p></div>
              ) : (
                items.map(item => (
                  <div key={item.id} className="k-row">
                    <div className="k-icon"><Icon name="doc" size={15} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="k-title">{item.title || '未命名'}</div>
                      <div className="k-meta">
                        <span className="k-cat-chip">{item.category}</span>
                        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{new Date(item.createdAt).toLocaleDateString('zh-TW')}</span>
                      </div>
                    </div>
                    <div className="k-usage"><div className="n">{item.hitCount}</div><div className="l">次引用</div></div>
                    <button className="icon-btn" onClick={() => del(item.id)}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'} onMouseLeave={e => e.currentTarget.style.color = ''}><Icon name="trash" size={14} /></button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="k-uploader" style={{ position: 'sticky', top: 84 }}>
            <div className="k-uploader-head">
              <div style={{ fontSize: 14, fontWeight: 600 }}>新增知識</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>讓 AI 角色知道更多關於品牌的事</div>
            </div>
            <div className="k-uploader-tabs">
              <button className={`k-uploader-tab${mode === 'file' ? ' active' : ''}`} onClick={() => setMode('file')}>上傳文件</button>
              <button className={`k-uploader-tab${mode === 'manual' ? ' active' : ''}`} onClick={() => setMode('manual')}>手動輸入</button>
            </div>
            <div className="k-uploader-body">
              {mode === 'file' ? (
                <>
                  <input ref={fileInputRef} type="file" accept=".docx,.pdf,.md,.txt" onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} style={{ display: 'none' }} />
                  <div className="dropzone" onClick={() => { if (!isUploading) { setUploadStatus('idle'); setUploadMsg(''); fileInputRef.current?.click(); } }}>
                    <div className="drop-icon"><Icon name="upload" size={32} /></div>
                    <div className="drop-title">{isUploading ? uploadMsg : '拖放檔案至此，或點擊選擇'}</div>
                    <div className="drop-sub">{isUploading ? '' : '單檔不超過 20MB'}</div>
                    <div className="drop-formats">
                      {['.docx', '.pdf', '.md', '.txt'].map(f => <span key={f} className="format-chip">{f}</span>)}
                    </div>
                  </div>
                  {uploadStatus === 'done' && <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--green-soft)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--green)' }}>{uploadMsg}</div>}
                  {uploadStatus === 'error' && <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--red-soft)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--red)' }}>{uploadMsg}</div>}
                </>
              ) : (
                <>
                  <div className="field"><label className="field-label">標題（選填）</label><input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="例：品牌故事與核心理念" /></div>
                  <div className="field"><label className="field-label">分類</label><input className="input" value={category} onChange={e => setCategory(e.target.value)} placeholder="品牌/產品/常見問題" /></div>
                  <div className="field"><label className="field-label">內容</label><textarea className="textarea" value={content} onChange={e => setContent(e.target.value)} rows={6} placeholder="輸入這條知識的內容，AI 角色之後寫文章時會直接引用。" /><div className="field-hint">建議單條內容控制在 200-800 字之間。</div></div>
                  <button className="btn btn-accent btn-lg" style={{ width: '100%', justifyContent: 'center' }} onClick={add} disabled={adding || !content.trim()}><Icon name="plus" size={14} />{adding ? '新增中…' : '新增知識'}</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── GalleryScreen ──────────────────────────────────────────────────────────
function GalleryScreen({ charId }: { charId: string }) {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<ImageItem | null>(null);

  useEffect(() => {
    fetch(`/api/images?characterId=${charId}`).then(r => r.json()).then(d => { setImages(d.images || []); setLoading(false); });
  }, [charId]);

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          <h1>生圖</h1>
          <span className="subtitle">{images.length} 張 AI 配圖</span>
        </div>
      </div>
      <div className="content">
        <div className="page-head">
          <h2>AI 角色為品牌畫的圖</h2>
          <p>每則貼文配圖都會集中在這裡，點擊任一張查看大圖和原始提示語。</p>
        </div>

        {loading ? <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>載入中…</div>
          : images.length === 0
            ? <div className="empty"><div className="empty-icon"><Icon name="image" size={28} /></div><h4>還沒有生圖紀錄</h4></div>
            : (
              <div className="gallery-grid">
                {images.map((img, i) => (
                  <div key={i} className="gallery-cell" onClick={() => setLightbox(img)}>
                    <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <div className="meta">{new Date(img.timestamp).toLocaleDateString('zh-TW')} · {img.source?.startsWith('specialist') ? (img.specialistName || '繪師') : 'AI'}</div>
                  </div>
                ))}
              </div>
            )}
      </div>

      {lightbox && (
        <div className="gallery-lightbox" onClick={() => setLightbox(null)}>
          <div className="gallery-lightbox-inner" onClick={e => e.stopPropagation()}>
            <div className="lightbox-image">
              <img src={lightbox.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'var(--r)' }} />
            </div>
            <div className="lightbox-side">
              <h3>AI 配圖</h3>
              <div className="when">{new Date(lightbox.timestamp).toLocaleString('zh-TW')}</div>
              {lightbox.workLog && (
                <div className="lightbox-prompt">
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>提示語</div>
                  {lightbox.workLog}
                </div>
              )}
              <div className="lightbox-actions">
                <button className="btn btn-sm" onClick={() => setLightbox(null)}><Icon name="x" size={13} />關閉</button>
                <a href={lightbox.url} download className="btn btn-sm"><span style={{ display:'inline-flex', transform:'rotate(180deg)' }}><Icon name="upload" size={13} /></span>下載</a>
              </div>
            </div>
            <button className="voice-overlay-close" style={{ position: 'fixed', top: 28, right: 32 }} onClick={() => setLightbox(null)}><Icon name="x" size={16} /></button>
          </div>
        </div>
      )}
    </>
  );
}

// ── ChatScreen ─────────────────────────────────────────────────────────────
function ChatScreen({ charId, char }: { charId: string; char: Character }) {
  const {
    messages, activeJobs,
    input, setInput,
    loading,
    conversationId,
    pendingImage, setPendingImage,
    send, newConversation,
    handleImageSelect,
    imageInputRef, bottomRef, textareaRef,
  } = useChat(charId);

  const [confirmNew, setConfirmNew] = useState(false);

  const doNewChat = () => { newConversation(); setConfirmNew(false); };

  return (
    <div className="chat-wrap">
      <div className="chat-head">
        <div className="chat-head-meta">
          <div className="avatar avatar-sm">
            {char.visualIdentity?.characterSheet
              ? <img src={char.visualIdentity.characterSheet} alt="" />
              : char.name[0]
            }
          </div>
          <div>
            <h2>和 {char.name} 對話</h2>
            <div className="sub">
              <span style={{ color: 'var(--green)' }}>● </span>
              {conversationId ? `#${conversationId.slice(-6)}` : '線上'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setConfirmNew(true)}><Icon name="new-chat" size={13} />開啟新對話</button>
        </div>
      </div>

      {activeJobs.length > 0 && (
        <div style={{ padding: '7px 16px', borderBottom: '1px solid var(--line)', background: 'var(--accent-soft)', fontSize: 12, color: 'var(--ink-2)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {activeJobs.map(j => (
            <span key={j.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'cv2-pulse 1.2s ease-in-out infinite' }} />
              {j.jobType || j.assigneeId || '瞬'} 處理中…
            </span>
          ))}
        </div>
      )}

      <div className="chat-stream">
        <div className="chat-stream-inner">
          {messages.map((msg, i) => {
            const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '';

            if (msg.role === 'system_event') {
              const isHtml = msg.eventType === 'strategy_html_delivered';
              const delivered = msg.eventType === 'specialist_delivered' || isHtml;
              const headerText = isHtml
                ? '設計版 HTML 完成'
                : (delivered ? (msg.specialistName || '瞬') + ' 交件了' : (msg.specialistName || '瞬') + ' 回報');
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
                  <div style={{ maxWidth: '90%', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--bg-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--line)', background: 'var(--bg-3)' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>{headerText}</span>
                      <span style={{ fontSize: 10, color: 'var(--ink-4)', marginLeft: 'auto' }}>{time}</span>
                    </div>
                    {msg.output?.imageUrl && (
                      <div style={{ padding: '10px 14px 6px' }}>
                        <img src={msg.output.imageUrl} alt={msg.output.title || ''} style={{ width: '100%', maxWidth: 340, borderRadius: 6, display: 'block', border: '1px solid var(--line)' }} />
                      </div>
                    )}
                    {msg.output?.docUrl && (
                      <div style={{ padding: '8px 14px' }}>
                        <a href={msg.output.docUrl} target="_blank" rel="noreferrer" className="btn btn-sm">{'查看文件'}</a>
                      </div>
                    )}
                    {msg.output?.htmlUrl && (
                      <div style={{ padding: '8px 14px' }}>
                        <a href={msg.output.htmlUrl} target="_blank" rel="noreferrer" className="btn btn-sm">{msg.output.title || '設計版 HTML'}</a>
                      </div>
                    )}
                    {msg.output?.slideUrl && (
                      <div style={{ padding: '8px 14px' }}>
                        <a href={msg.output.slideUrl} target="_blank" rel="noreferrer" className="btn btn-sm">查看投影片</a>
                      </div>
                    )}
                    {msg.error && <div style={{ padding: '8px 14px', color: 'var(--red)', fontSize: 12 }}>{msg.error}</div>}
                    {msg.workLog && (
                      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--ink-3)', fontStyle: 'italic', lineHeight: 1.6 }}>
                        {(msg.specialistName || '瞬') + '：' + msg.workLog}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            const isUser = msg.role === 'user';
            const roleClass = isUser ? 'user' : 'ai';
            return (
              <div key={i} className={`chat-msg ${roleClass}`}>
                {!isUser && (
                  <div className="avatar avatar-sm">
                    {char.visualIdentity?.characterSheet ? <img src={char.visualIdentity.characterSheet} alt="" /> : char.name[0]}
                  </div>
                )}
                <div>
                  <div className="chat-bubble">
                    {msg.imageUrl && <img src={msg.imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: 6, display: 'block', marginBottom: msg.content ? 6 : 0 }} />}
                    {msg.content || (!isUser && loading && i === messages.length - 1 ? <span className="typing"><span /><span /><span /></span> : '')}
                  </div>
                  <div className="chat-time">{time}</div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="chat-input">
        {pendingImage && (
          <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--line)' }}>
            <img src={pendingImage.preview} alt="" style={{ height: 36, borderRadius: 4, border: '1px solid var(--line)' }} />
            <span style={{ fontSize: 12, color: 'var(--ink-3)', flex: 1 }}>圖片已選取</span>
            <button className="icon-btn" onClick={() => setPendingImage(null)}><Icon name="x" size={12} /></button>
          </div>
        )}
        <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />
        <div className="chat-input-inner">
          <button className="icon-btn" onClick={() => imageInputRef.current?.click()} disabled={loading} title="上傳圖片">
            <Icon name="image" size={15} />
          </button>
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            rows={1}
            placeholder={`和 ${char.name} 說點什麼…`}
            value={input}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <div className="chat-input-actions">
            <button className="send-btn" onClick={send} disabled={(!input.trim() && !pendingImage) || loading} title="送出">
              <Icon name="send" size={15} />
            </button>
          </div>
        </div>
      </div>
      <div className="chat-foot">
        由 <strong>AILIVE</strong> 提供支援 · 你正在和 <strong>{char.name}</strong> 對話
      </div>

      {confirmNew && (
        <div className="modal-stage" onClick={() => setConfirmNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>開啟新的對話？</h3>
            <p>目前的對話紀錄將被收起，你可以隨時從歷史紀錄中找回。</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmNew(false)}>取消</button>
              <button className="btn btn-primary" onClick={doNewChat}>開啟新對話</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function ClientPage() {
  const { id: charId } = useParams<{ id: string }>();
  const [char, setChar] = useState<Character | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<Tab>('posts');
  const [postCount, setPostCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/characters/${charId}`).then(r => r.json()).then(d => setChar(d.character || null));
    if (typeof window !== 'undefined' && sessionStorage.getItem(`client_unlocked_${charId}`) === '1') setUnlocked(true);
  }, [charId]);

  useEffect(() => {
    if (!unlocked || !charId) return;
    fetch(`/api/posts?characterId=${charId}&limit=1`).then(r => r.json()).then(d => {
      setPostCount((d.posts || []).filter((p: Post) => p.status === 'draft').length);
    });
  }, [unlocked, charId, tab]);

  if (!char) return (
    <div className="client-v2" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>載入中…</div>
  );
  if (!unlocked) return <PasswordGate char={char} onUnlock={() => setUnlocked(true)} />;

  const NAV = [
    { key: 'posts' as Tab,     icon: 'post',     label: '貼文',  count: postCount || undefined },
    { key: 'schedule' as Tab,  icon: 'calendar', label: '排程' },
    { key: 'knowledge' as Tab, icon: 'book',     label: '知識庫' },
    { key: 'gallery' as Tab,   icon: 'image',    label: '生圖' },
    { key: 'chat' as Tab,      icon: 'chat',     label: '聊天' },
  ];

  return (
    <div className="client-v2">
      <button className="mobile-menu-fab" onClick={() => setSidebarOpen(true)} aria-label="開啟選單">
        <Icon name="menu" size={18} />
      </button>

      <div className="app">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}
        <aside className={`sidebar${sidebarOpen ? ' mobile-open' : ''}`}>
          <div className="sidebar-brand">
            <div className="brand-mark">AI</div>
            <span className="brand-name">AILIVE <small>客戶端</small></span>
            <button className="sidebar-close icon-btn" onClick={() => setSidebarOpen(false)} aria-label="關閉選單">
              <Icon name="x" size={16} />
            </button>
          </div>

          <div className="character">
            <div className="character-row">
              <div className="avatar">
                {char.visualIdentity?.characterSheet
                  ? <img src={char.visualIdentity.characterSheet} alt="" />
                  : char.name[0]
                }
              </div>
              <div className="character-meta">
                <div className="character-name">
                  {char.name}
                  <span className="live-dot" />
                </div>
                <div className="character-role">{char.type || 'AI 角色'}</div>
              </div>
            </div>
            {char.mission && (
              <div className="character-tag">
                <div className="character-tag-body">{char.mission.slice(0, 60)}{char.mission.length > 60 ? '…' : ''}</div>
              </div>
            )}
          </div>

          <a
            href={`/voice/${charId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="voice-btn"
            style={{ textDecoration: 'none' }}
          >
            <div className="voice-icon"><Icon name="mic" size={14} /></div>
            <div className="voice-meta">
              語音對話
              <small>即時語音互動</small>
            </div>
          </a>

          <nav className="nav">
            <div className="nav-label">管理功能</div>
            {NAV.map(n => (
              <button key={n.key} className={`nav-item${tab === n.key ? ' active' : ''}`} onClick={() => { setTab(n.key); setSidebarOpen(false); }}>
                <Icon name={n.icon} size={16} />
                <span className="nav-text">{n.label}</span>
                {n.count ? <span className="nav-count">{n.count}</span> : null}
              </button>
            ))}
          </nav>

          <div className="sidebar-foot">
            <span>AILIVE Platform</span>
            <span style={{ opacity: 0.6, fontSize: 10 }}>v2.0</span>
          </div>
        </aside>

        {/* Main content */}
        <main className="main">
          {tab === 'posts'     && <PostsScreen     charId={charId} />}
          {tab === 'schedule'  && <ScheduleScreen  charId={charId} />}
          {tab === 'knowledge' && <KnowledgeScreen charId={charId} />}
          {tab === 'gallery'   && <GalleryScreen   charId={charId} />}
          {tab === 'chat'      && <ChatScreen      charId={charId} char={char} />}
        </main>
      </div>
    </div>
  );
}
