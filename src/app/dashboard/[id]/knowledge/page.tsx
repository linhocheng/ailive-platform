'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface KnowledgeItem { id: string; title: string; content: string; category: string; hitCount: number; createdAt: string; }

export default function KnowledgePage() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [adding, setAdding] = useState(false);
  const [charName, setCharName] = useState('');

  const load = () => {
    setLoading(true);
    fetch(`/api/knowledge?characterId=${id}`).then(r => r.json()).then(d => { setItems(d.knowledge || []); setLoading(false); });
  };

  useEffect(() => {
    load();
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => setCharName(d.character?.name || ''));
  }, [id]);

  const add = async () => {
    if (!content.trim()) return;
    setAdding(true);
    await fetch('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: id, title, content, category }) });
    setTitle(''); setContent(''); setAdding(false);
    load();
  };

  const del = async (itemId: string) => {
    if (!confirm('確定刪除？')) return;
    await fetch(`/api/knowledge?id=${itemId}`, { method: 'DELETE' });
    load();
  };

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> › <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a> › 知識庫
      </div>
      <CharNav id={id} active="/knowledge" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20 }}>
        {/* 新增 */}
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20, alignSelf: 'start' }}>
          <h3 style={{ margin: '0 0 16px' }}>新增知識</h3>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="標題（選填）"
            style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', marginBottom: 8, fontSize: 14, boxSizing: 'border-box' }} />
          <input value={category} onChange={e => setCategory(e.target.value)} placeholder="分類（如：品牌/產品/常見問題）"
            style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', marginBottom: 8, fontSize: 14, boxSizing: 'border-box' }} />
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="知識內容..." rows={6}
            style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', marginBottom: 8, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
          <button onClick={add} disabled={adding || !content.trim()}
            style={{ width: '100%', background: adding ? '#ccc' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: 10, cursor: 'pointer', fontSize: 14 }}>
            {adding ? '新增中...' : '+ 新增'}
          </button>
        </div>
        {/* 列表 */}
        <div>
          <h3 style={{ margin: '0 0 16px', color: '#1a1a2e' }}>共 {items.length} 條知識</h3>
          {loading ? <div style={{ color: '#999' }}>載入中...</div> : items.length === 0 ? (
            <div style={{ color: '#bbb', textAlign: 'center', padding: 40, border: '2px dashed #e0e0e0', borderRadius: 12 }}>還沒有知識，從左側新增</div>
          ) : items.map(item => (
            <div key={item.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  {item.title && <span style={{ fontWeight: 600, color: '#1a1a2e', marginRight: 8 }}>{item.title}</span>}
                  <span style={{ background: '#f0f0f0', color: '#666', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{item.category}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#999' }}>查詢 {item.hitCount} 次</span>
                  <button onClick={() => del(item.id)} style={{ background: 'none', border: 'none', color: '#c00', cursor: 'pointer', fontSize: 13 }}>刪</button>
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6 }}>{item.content.slice(0, 200)}{item.content.length > 200 ? '...' : ''}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
