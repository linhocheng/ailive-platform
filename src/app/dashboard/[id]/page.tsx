'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const NAV_ITEMS = [
  { href: '', label: '概覽' },
  { href: '/soul', label: '靈魂' },
  { href: '/identity', label: '身份' },
  { href: '/knowledge', label: '知識庫' },
  { href: '/memory', label: '記憶' },
  { href: '/posts', label: '發文' },
  { href: '/tasks', label: '排程' },
  { href: '/proposals', label: '靈魂提案' },
  { href: '/growth', label: '成長' },
];

interface Character {
  id: string;
  name: string;
  type: string;
  status: string;
  mission: string;
  soulVersion: number;
  enhancedSoul: string;
  growthMetrics?: { totalConversations: number; totalInsights: number; totalPosts: number };
  updatedAt?: string;
}

export function CharNav({ id, active }: { id: string; active: string }) {
  return (
    <nav style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #e0e0e0', paddingBottom: 0 }}>
      {NAV_ITEMS.map(item => {
        const href = `/dashboard/${id}${item.href}`;
        const isActive = active === item.href;
        return (
          <a key={item.href} href={href} style={{
            padding: '8px 14px', textDecoration: 'none', fontSize: 14,
            color: isActive ? '#1a1a2e' : '#666',
            borderBottom: isActive ? '2px solid #1a1a2e' : '2px solid transparent',
            fontWeight: isActive ? 700 : 400,
          }}>{item.label}</a>
        );
      })}
    </nav>
  );
}

export default function CharacterPage() {
  const { id } = useParams<{ id: string }>();
  const [char, setChar] = useState<Character | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => {
      setChar(d.character);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>載入中...</div>;
  const handleDelete = async () => {
    if (!confirm(`確定要刪除「${char?.name}」嗎？\n\n這會永久刪除：\n• 角色本體\n• 所有記憶（insights）\n• 所有對話記錄\n• 所有排程任務\n• 所有草稿\n• 知識庫\n\n此操作無法復原。`)) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/characters/${id}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) {
        alert('角色已刪除');
        window.location.href = '/dashboard';
      } else {
        alert('刪除失敗：' + d.error);
        setDeleting(false);
      }
    } catch {
      alert('刪除失敗');
      setDeleting(false);
    }
  };

  if (!char) return <div style={{ padding: 40, color: '#c00' }}>角色不存在</div>;

  const metrics = char.growthMetrics || { totalConversations: 0, totalInsights: 0, totalPosts: 0 };

  return (
    <div>
      {/* 麵包屑 */}
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a>
        <span style={{ margin: '0 6px' }}>›</span>
        <span style={{ color: '#1a1a2e' }}>{char.name}</span>
      </div>

      {/* 角色 header */}
      <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, color: '#1a1a2e' }}>{char.name}</h1>
            <div style={{ color: '#666', marginTop: 4 }}>{char.mission || '（使命未設定）'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '4px 12px', borderRadius: 20, fontSize: 13 }}>
              {char.status === 'active' ? '活躍' : char.status}
            </span>
            <span style={{ background: '#e8eaf6', color: '#3949ab', padding: '4px 12px', borderRadius: 20, fontSize: 13 }}>
              靈魂 v{char.soulVersion}
            </span>
            <a href={`/chat/${id}`} target="_blank" rel="noopener noreferrer"
              style={{ background: '#6c63ff', color: '#fff', padding: '4px 14px', borderRadius: 20, fontSize: 13, textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
              💬 對話窗
            </a>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 20 }}>
          {[
            { label: '總對話', value: metrics.totalConversations, icon: '💬' },
            { label: '記憶條數', value: metrics.totalInsights, icon: '🧠' },
            { label: '發文數', value: metrics.totalPosts, icon: '📝' },
          ].map(({ label, value, icon }) => (
            <div key={label} style={{ background: '#f8f9fa', borderRadius: 10, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 24 }}>{icon}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a2e' }}>{value}</div>
              <div style={{ fontSize: 13, color: '#666' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      <CharNav id={id} active="" />

      {/* 快速操作 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {[
          { href: `/chat/${id}`, label: '💬 對話窗', desc: '開啟對話，可分享給用戶', external: true },
          { href: `/dashboard/${id}/soul`, label: '✏️ 管理靈魂', desc: '查看/編輯 enhancedSoul' },
          { href: `/dashboard/${id}/knowledge`, label: '📚 知識庫', desc: '新增/刪除知識' },
          { href: `/dashboard/${id}/memory`, label: '🧠 記憶', desc: 'insights 管理' },
          { href: `/dashboard/${id}/posts`, label: '📝 發文草稿', desc: '審核草稿' },
          { href: `/dashboard/${id}/tasks`, label: '⏰ 排程', desc: '設定任務時間' },
          { href: `/dashboard/${id}/proposals`, label: '💡 靈魂提案', desc: '審核靈魂修改' },
        ].map(item => (
          <a key={item.href} href={item.href} target={(item as {external?: boolean}).external ? '_blank' : undefined} rel={(item as {external?: boolean}).external ? 'noopener noreferrer' : undefined} style={{ textDecoration: 'none' }}>
            <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: 16,
              transition: 'box-shadow 0.2s', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a2e' }}>{item.label}</div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{item.desc}</div>
            </div>
          </a>
        ))}
      </div>
      {/* 危險區 */}
      <div style={{ marginTop: 40, padding: 20, border: '1px solid #ffcdd2', borderRadius: 10, background: '#fff8f8' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#c62828', marginBottom: 8 }}>⚠️ 危險區域</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, color: '#666' }}>永久刪除此角色及所有關聯資料（記憶、對話、任務、草稿）。此操作無法復原。</div>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{ background: deleting ? '#ccc' : '#c62828', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: deleting ? 'default' : 'pointer', flexShrink: 0, marginLeft: 16 }}>
            {deleting ? '刪除中...' : '🗑 刪除角色'}
          </button>
        </div>
      </div>
    </div>
  );
}
