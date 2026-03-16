'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface Post { id: string; content: string; imageUrl: string; topic: string; status: string; createdAt: string; scheduledAt?: string; }

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  draft: { bg: '#fff3e0', color: '#e65100', label: '草稿' },
  scheduled: { bg: '#e8f5e9', color: '#2e7d32', label: '已排程' },
  published: { bg: '#e3f2fd', color: '#1565c0', label: '已發佈' },
  rejected: { bg: '#fce4ec', color: '#c62828', label: '已拒絕' },
};

export default function PostsPage() {
  const { id } = useParams<{ id: string }>();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [charName, setCharName] = useState('');
  const [filter, setFilter] = useState('draft');
  const [acting, setActing] = useState<string | null>(null);

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
      </div>

      {loading ? <div style={{ color: '#999' }}>載入中...</div> : filtered.length === 0 ? (
        <div style={{ color: '#bbb', textAlign: 'center', padding: 40, border: '2px dashed #e0e0e0', borderRadius: 12 }}>
          {filter === 'draft' ? '目前沒有待審核草稿' : '沒有發文記錄'}
        </div>
      ) : filtered.map(post => {
        const sc = STATUS_COLORS[post.status] || { bg: '#f8f9fa', color: '#666', label: post.status };
        return (
          <div key={post.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{sc.label}</span>
                {post.topic && <span style={{ color: '#666', fontSize: 13 }}>#{post.topic}</span>}
              </div>
              <span style={{ fontSize: 12, color: '#bbb' }}>{new Date(post.createdAt).toLocaleString('zh-TW')}</span>
            </div>
            <div style={{ fontSize: 14, color: '#333', lineHeight: 1.8, whiteSpace: 'pre-wrap', background: '#f8f9fa', borderRadius: 8, padding: 12, marginBottom: 10 }}>
              {post.content}
            </div>
            {post.imageUrl && (
              <div style={{ marginBottom: 10 }}>
                <img src={post.imageUrl} alt="貼文圖片" style={{ maxWidth: 200, borderRadius: 8, border: '1px solid #e0e0e0' }} />
              </div>
            )}
            {post.status === 'draft' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => approve(post.id)} disabled={acting === post.id}
                  style={{ background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  ✓ 核准
                </button>
                <button onClick={() => reject(post.id)} disabled={acting === post.id}
                  style={{ background: '#c62828', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}>
                  ✗ 拒絕
                </button>
                <button onClick={() => del(post.id)} style={{ background: 'none', border: '1px solid #e0e0e0', color: '#999', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>刪除</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
