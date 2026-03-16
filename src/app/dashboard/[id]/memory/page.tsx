'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface Insight { id: string; title: string; content: string; source: string; tier: string; hitCount: number; eventDate: string; createdAt: string; }

const TIER_COLORS: Record<string, string> = { core: '#fff3e0', fresh: '#f8f9fa', archived: '#eeeeee' };
const SOURCE_LABELS: Record<string, string> = { conversation: '對話', manual: '手動', self_learning: '自學', reflect: '省思', sleep_time: '夢境', auto_extract: '自動提煉' };

export default function MemoryPage() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [charName, setCharName] = useState('');
  const [filter, setFilter] = useState('all');

  const load = () => {
    setLoading(true);
    fetch(`/api/insights?characterId=${id}&limit=100`).then(r => r.json()).then(d => {
      setItems(d.insights || []);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => setCharName(d.character?.name || ''));
  }, [id]);

  const del = async (insightId: string) => {
    if (!confirm('確定刪除？')) return;
    await fetch(`/api/insights?id=${insightId}`, { method: 'DELETE' });
    load();
  };

  const promote = async (insightId: string, tier: string) => {
    await fetch('/api/insights', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: insightId, tier }) });
    load();
  };

  const filtered = filter === 'all' ? items : items.filter(i => i.tier === filter);

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> › <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a> › 記憶
      </div>
      <CharNav id={id} active="/memory" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>共 {items.length} 條記憶</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {['all', 'core', 'fresh', 'archived'].map(t => (
            <button key={t} onClick={() => setFilter(t)}
              style={{ padding: '5px 12px', border: '1px solid #e0e0e0', borderRadius: 20, background: filter === t ? '#1a1a2e' : '#fff', color: filter === t ? '#fff' : '#666', cursor: 'pointer', fontSize: 12 }}>
              {t === 'all' ? '全部' : t === 'core' ? '核心' : t === 'fresh' ? '新鮮' : '封存'}
            </button>
          ))}
        </div>
      </div>
      {loading ? <div style={{ color: '#999' }}>載入中...</div> : filtered.length === 0 ? (
        <div style={{ color: '#bbb', textAlign: 'center', padding: 40, border: '2px dashed #e0e0e0', borderRadius: 12 }}>沒有記憶</div>
      ) : filtered.map(item => (
        <div key={item.id} style={{ background: TIER_COLORS[item.tier] || '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{item.title}</span>
              <span style={{ background: '#fff', border: '1px solid #e0e0e0', color: '#666', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{SOURCE_LABELS[item.source] || item.source}</span>
              {item.tier === 'core' && <span style={{ background: '#ff9800', color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>核心</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#999' }}>命中 {item.hitCount}</span>
              <span style={{ fontSize: 11, color: '#bbb' }}>{item.eventDate}</span>
              {item.tier !== 'core' && <button onClick={() => promote(item.id, 'core')} style={{ background: 'none', border: '1px solid #ff9800', color: '#ff9800', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 }}>升核心</button>}
              <button onClick={() => del(item.id)} style={{ background: 'none', border: 'none', color: '#c00', cursor: 'pointer', fontSize: 13 }}>刪</button>
            </div>
          </div>
          <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6 }}>{item.content.slice(0, 200)}{item.content.length > 200 ? '...' : ''}</div>
        </div>
      ))}
    </div>
  );
}
