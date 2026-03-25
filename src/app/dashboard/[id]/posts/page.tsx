'use client';
import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface Post { id: string; content: string; imageUrl: string; topic: string; status: string; createdAt: string; scheduledAt?: string; igPostId?: string; }

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  draft: { bg: '#fff3e0', color: '#e65100', label: '草稿' },
  scheduled: { bg: '#e8f5e9', color: '#2e7d32', label: '已排程' },
  published: { bg: '#e3f2fd', color: '#1565c0', label: '已發佈' },
  rejected: { bg: '#fce4ec', color: '#c62828', label: '已拒絕' },
};

// 單欄位 inline 編輯 hook
function useInlineEdit(postId: string, field: string, initial: string, onSaved: () => void) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => { setValue(initial); }, [initial]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  const save = async () => {
    if (value === initial) { setEditing(false); return; }
    setSaving(true);
    await fetch('/api/posts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: postId, [field]: value }),
    });
    setSaving(false);
    setEditing(false);
    onSaved();
  };

  return { editing, setEditing, value, setValue, saving, ref, save };
}

// 可編輯 content textarea
function EditableContent({ postId, content, onSaved }: { postId: string; content: string; onSaved: () => void }) {
  const { editing, setEditing, value, setValue, saving, ref, save } = useInlineEdit(postId, 'content', content, onSaved);

  if (editing) {
    return (
      <div style={{ position: 'relative' }}>
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Escape') { setValue(content); setEditing(false); } }}
          rows={Math.max(3, value.split('\n').length + 1)}
          style={{ width: '100%', fontSize: 14, color: '#333', lineHeight: 1.8, background: '#f0f7ff', border: '2px solid #1976d2', borderRadius: 8, padding: 12, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
        />
        <span style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 11, color: saving ? '#1976d2' : '#bbb' }}>
          {saving ? '儲存中...' : '失焦自動儲存 · Esc 取消'}
        </span>
      </div>
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      title="點擊編輯"
      style={{ fontSize: 14, color: '#333', lineHeight: 1.8, whiteSpace: 'pre-wrap', background: '#f8f9fa', borderRadius: 8, padding: 12, cursor: 'text', border: '2px solid transparent', transition: 'border 0.15s', position: 'relative' }}
      onMouseEnter={e => (e.currentTarget.style.border = '2px solid #bbdefb')}
      onMouseLeave={e => (e.currentTarget.style.border = '2px solid transparent')}
    >
      {content}
      <span style={{ position: 'absolute', top: 8, right: 10, fontSize: 10, color: '#bbb', opacity: 0 }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
      >✏️ 點擊編輯</span>
    </div>
  );
}

// 可編輯 topic input
function EditableTopic({ postId, topic, onSaved }: { postId: string; topic: string; onSaved: () => void }) {
  const { editing, setEditing, value, setValue, saving, ref, save } = useInlineEdit(postId, 'topic', topic, onSaved);

  if (editing) {
    return (
      <input
        ref={ref as React.RefObject<HTMLInputElement>}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setValue(topic); setEditing(false); } }}
        placeholder="主題標籤"
        style={{ fontSize: 13, color: '#333', background: '#f0f7ff', border: '2px solid #1976d2', borderRadius: 6, padding: '2px 8px', outline: 'none', width: 120 }}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="點擊編輯主題"
      style={{ color: '#666', fontSize: 13, cursor: 'text', padding: '2px 4px', borderRadius: 4, border: '1px solid transparent', transition: 'border 0.15s' }}
      onMouseEnter={e => (e.currentTarget.style.border = '1px solid #bbdefb')}
      onMouseLeave={e => (e.currentTarget.style.border = '1px solid transparent')}
    >
      {topic ? `#${topic}` : <span style={{ color: '#ccc' }}>+ 主題</span>}
    </span>
  );
}

// 可編輯 imageUrl input
function EditableImageUrl({ postId, imageUrl, onSaved }: { postId: string; imageUrl: string; onSaved: () => void }) {
  const { editing, setEditing, value, setValue, saving, ref, save } = useInlineEdit(postId, 'imageUrl', imageUrl, onSaved);

  if (editing) {
    return (
      <div style={{ marginBottom: 10 }}>
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setValue(imageUrl); setEditing(false); } }}
          placeholder="圖片 URL"
          style={{ width: '100%', fontSize: 12, color: '#333', background: '#f0f7ff', border: '2px solid #1976d2', borderRadius: 6, padding: '6px 10px', outline: 'none', boxSizing: 'border-box' }}
        />
        <div style={{ fontSize: 11, color: saving ? '#1976d2' : '#bbb', marginTop: 3 }}>{saving ? '儲存中...' : 'Enter 儲存 · Esc 取消'}</div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 10 }}>
      {imageUrl ? (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img
            src={imageUrl}
            alt="貼文圖片"
            onClick={() => setEditing(true)}
            title="點擊更換圖片 URL"
            style={{ maxWidth: 200, borderRadius: 8, border: '2px solid transparent', cursor: 'pointer', transition: 'border 0.15s', display: 'block' }}
            onMouseEnter={e => (e.currentTarget.style.border = '2px solid #bbdefb')}
            onMouseLeave={e => (e.currentTarget.style.border = '2px solid transparent')}
          />
          <span style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>✏️ 點擊換圖</span>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          style={{ background: 'none', border: '1px dashed #ccc', color: '#bbb', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12 }}
        >+ 加入圖片 URL</button>
      )}
    </div>
  );
}

export default function PostsPage() {
  const { id } = useParams<{ id: string }>();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [charName, setCharName] = useState('');
  const [filter, setFilter] = useState('draft');
  const [acting, setActing] = useState<string | null>(null);
  const [igMsg, setIgMsg] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    fetch(`/api/posts?characterId=${id}&limit=50`).then(r => r.json()).then(d => {
      setPosts(d.posts || []);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => setCharName(d.character?.name || ''));
  }, [id]);

  const approve = async (postId: string) => {
    setActing(postId);
    await fetch('/api/posts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: postId, status: 'scheduled' }) });
    setActing(null);
    load();
  };

  const reject = async (postId: string) => {
    setActing(postId);
    await fetch('/api/posts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: postId, status: 'rejected' }) });
    setActing(null);
    load();
  };

  const del = async (postId: string) => {
    if (!confirm('確定刪除？')) return;
    await fetch(`/api/posts?id=${postId}`, { method: 'DELETE' });
    load();
  };

  const publishToIG = async (postId: string) => {
    if (!confirm('確定發佈到 Instagram？')) return;
    setActing(postId);
    setIgMsg(prev => ({ ...prev, [postId]: '發佈中...' }));
    try {
      const res = await fetch('/api/posts/publish-ig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId }),
      });
      const data = await res.json();
      if (data.success) {
        setIgMsg(prev => ({ ...prev, [postId]: '✅ 已發到 IG！' }));
        setTimeout(() => load(), 1200);
      } else {
        setIgMsg(prev => ({ ...prev, [postId]: `❌ ${data.error}` }));
      }
    } catch (err) {
      setIgMsg(prev => ({ ...prev, [postId]: `❌ ${String(err)}` }));
    }
    setActing(null);
  };

  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter);
  const draftCount = posts.filter(p => p.status === 'draft').length;

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> › <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a> › 發文管理
      </div>
      <CharNav id={id} active="/posts" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['draft', 'scheduled', 'published', 'rejected', 'all'] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: '5px 12px', border: '1px solid #e0e0e0', borderRadius: 20, background: filter === s ? '#1a1a2e' : '#fff', color: filter === s ? '#fff' : '#666', cursor: 'pointer', fontSize: 12, position: 'relative' }}>
              {s === 'all' ? '全部' : STATUS_COLORS[s]?.label || s}
              {s === 'draft' && draftCount > 0 && <span style={{ marginLeft: 4, background: '#ff5722', color: '#fff', borderRadius: 20, padding: '0 5px', fontSize: 10 }}>{draftCount}</span>}
            </button>
          ))}
        </div>
        {filter === 'draft' && <span style={{ fontSize: 11, color: '#bbb' }}>✏️ 點擊文字可直接編輯</span>}
      </div>

      {loading ? <div style={{ color: '#999' }}>載入中...</div> : filtered.length === 0 ? (
        <div style={{ color: '#bbb', textAlign: 'center', padding: 40, border: '2px dashed #e0e0e0', borderRadius: 12 }}>
          {filter === 'draft' ? '目前沒有待審核草稿' : '沒有發文記錄'}
        </div>
      ) : filtered.map(post => {
        const sc = STATUS_COLORS[post.status] || { bg: '#f8f9fa', color: '#666', label: post.status };
        const isDraft = post.status === 'draft';
        return (
          <div key={post.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{sc.label}</span>
                {isDraft
                  ? <EditableTopic postId={post.id} topic={post.topic || ''} onSaved={load} />
                  : post.topic && <span style={{ color: '#666', fontSize: 13 }}>#{post.topic}</span>
                }
                {post.igPostId && <span style={{ background: '#fce8ff', color: '#7b1fa2', padding: '2px 8px', borderRadius: 20, fontSize: 11 }}>📸 IG 已發佈</span>}
              </div>
              <span style={{ fontSize: 12, color: '#bbb' }}>{new Date(post.createdAt).toLocaleString('zh-TW')}</span>
            </div>

            {isDraft
              ? <EditableContent postId={post.id} content={post.content} onSaved={load} />
              : <div style={{ fontSize: 14, color: '#333', lineHeight: 1.8, whiteSpace: 'pre-wrap', background: '#f8f9fa', borderRadius: 8, padding: 12, marginBottom: 10 }}>{post.content}</div>
            }

            {isDraft
              ? <EditableImageUrl postId={post.id} imageUrl={post.imageUrl || ''} onSaved={load} />
              : post.imageUrl && (
                <div style={{ marginBottom: 10 }}>
                  <img src={post.imageUrl} alt="貼文圖片" style={{ maxWidth: 200, borderRadius: 8, border: '1px solid #e0e0e0' }} />
                </div>
              )
            }

            {isDraft && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                <button onClick={() => approve(post.id)} disabled={acting === post.id}
                  style={{ background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  ✓ 核准
                </button>
                <button onClick={() => reject(post.id)} disabled={acting === post.id}
                  style={{ background: '#c62828', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}>
                  ✗ 拒絕
                </button>
                {post.imageUrl && (
                  <button onClick={() => publishToIG(post.id)} disabled={acting === post.id}
                    style={{ background: acting === post.id ? '#ccc' : 'linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: acting === post.id ? 'default' : 'pointer', fontSize: 13, fontWeight: 600 }}>
                    📸 發到 IG
                  </button>
                )}
                <button onClick={() => del(post.id)} style={{ background: 'none', border: '1px solid #e0e0e0', color: '#999', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>刪除</button>
                {igMsg[post.id] && <span style={{ fontSize: 13, color: igMsg[post.id].startsWith('✅') ? '#2e7d32' : '#c62828' }}>{igMsg[post.id]}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
