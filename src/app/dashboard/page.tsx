'use client';
import { useEffect, useState } from 'react';

interface Character {
  id: string;
  name: string;
  type: string;
  status: string;
  soulVersion: number;
  growthMetrics?: {
    totalConversations: number;
    totalInsights: number;
    totalPosts: number;
  };
  updatedAt?: string;
}

export default function DashboardPage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/characters').then(r => r.json()).then(d => {
      setCharacters(d.characters || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>載入中...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#1a1a2e' }}>所有角色</h1>
        <a href="/dashboard/create" style={{ background: '#1a1a2e', color: '#fff', padding: '8px 16px', borderRadius: 6, textDecoration: 'none', fontSize: 14 }}>+ 新增角色</a>
      </div>

      {characters.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#999', border: '2px dashed #ddd', borderRadius: 12 }}>
          還沒有角色。<a href="/dashboard/create">建立第一個</a>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {characters.map(c => (
            <a key={c.id} href={`/dashboard/${c.id}`} style={{ textDecoration: 'none' }}>
              <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20, transition: 'box-shadow 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{c.type === 'vtuber' ? '虛擬網紅' : '品牌小編'}</div>
                  </div>
                  <span style={{
                    background: c.status === 'active' ? '#e8f5e9' : '#fff3e0',
                    color: c.status === 'active' ? '#2e7d32' : '#e65100',
                    padding: '2px 8px', borderRadius: 20, fontSize: 12
                  }}>{c.status === 'active' ? '活躍' : c.status === 'pending' ? '待設定' : c.status}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
                  {[
                    { label: '對話', value: c.growthMetrics?.totalConversations ?? 0 },
                    { label: '記憶', value: c.growthMetrics?.totalInsights ?? 0 },
                    { label: '發文', value: c.growthMetrics?.totalPosts ?? 0 },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ textAlign: 'center', background: '#f8f9fa', borderRadius: 8, padding: '8px 4px' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a2e' }}>{value}</div>
                      <div style={{ fontSize: 11, color: '#999' }}>{label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, fontSize: 12, color: '#bbb' }}>
                  靈魂版本 v{c.soulVersion} · 更新 {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('zh-TW') : '—'}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
