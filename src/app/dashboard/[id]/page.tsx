'use client';
import React from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useIsMobile } from '@/hooks/useIsMobile';

const CHARACTER_NAV = [
  { href: '', label: '概覽' },
  { href: '/soul', label: '靈魂' },
  { href: '/identity', label: '身份' },
  { href: '/knowledge', label: '知識庫' },
  { href: '/images', label: '生圖檔' },
  { href: '/strategies', label: '策略書' },
  { href: '/memory', label: '記憶' },
  { href: '/posts', label: '發文' },
  { href: '/skills', label: '技巧' },
  { href: '/tasks', label: '排程' },
  { href: '/growth', label: '成長' },
];

const STRATEGIST_NAV = [
  { href: '', label: '概覽' },
  { href: '/soul', label: '靈魂' },
  { href: '/assignments', label: '管轄設定' },
  { href: '/tasks', label: '任務提案' },
  { href: '/strategies', label: '策略書' },
  { href: '/memory', label: '記憶' },
  { href: '/growth', label: '成長' },
];

function getNavItems(tier?: string) {
  return tier === 'strategist' ? STRATEGIST_NAV : CHARACTER_NAV;
}

interface Character {
  id: string; name: string; type: string; status: string; mission: string;
  soulVersion: number; enhancedSoul: string; tier?: string;
  growthMetrics?: { totalConversations: number; totalInsights: number; totalPosts: number };
  updatedAt?: string;
}

const Ic = {
  Chat:         () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  Brain:        () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.14z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.14z"/></svg>,
  Edit:         () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Book:         () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  File:         () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  Clock:        () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Lightbulb:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>,
  Trash:        () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  ExternalLink: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  User:         () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
};

export function CharNav({ id, active, tier: tierProp }: { id: string; active: string; tier?: string }) {
  const [tier, setTier] = React.useState(tierProp || '');
  React.useEffect(() => {
    if (tierProp !== undefined) { setTier(tierProp); return; }
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => setTier(d.character?.tier || ''));
  }, [id, tierProp]);

  const navItems = getNavItems(tier);
  return (
    <nav style={{
      display: 'flex', gap: 0, marginBottom: 28,
      borderBottom: '1px solid var(--border)',
      overflowX: 'auto', paddingBottom: 0,
      WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
    } as React.CSSProperties}>
      {navItems.map(item => {
        const href = `/dashboard/${id}${item.href}`;
        const isActive = active === item.href;
        return (
          <a key={item.href} href={href} style={{
            padding: '10px 16px', textDecoration: 'none',
            fontSize: 13, fontWeight: isActive ? 600 : 400,
            color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
            borderBottom: isActive ? '2px solid var(--text-primary)' : '2px solid transparent',
            whiteSpace: 'nowrap', transition: 'color 0.15s', letterSpacing: '0.01em',
          }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)'; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-muted)'; }}
          >{item.label}</a>
        );
      })}
    </nav>
  );
}

function AvatarLetter({ name, size = 56 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.28,
      background: 'var(--bg-alt)', color: 'var(--text-secondary)',
      fontSize: size * 0.42, fontWeight: 700, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-display)', letterSpacing: '-0.02em',
      border: '1px solid var(--border-soft)',
    }}>{name[0]}</div>
  );
}

export default function CharacterPage() {
  const { id } = useParams<{ id: string }>();
  const [char, setChar] = useState<Character | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!id) return;
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => {
      setChar(d.character); setLoading(false);
    });
  }, [id]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>載入中...</div>;

  const handleDelete = async () => {
    if (!confirm(`確定要刪除「${char?.name}」嗎？\n\n這會永久刪除：\n• 角色本體\n• 所有記憶（insights）\n• 所有對話記錄\n• 所有排程任務\n• 所有草稿\n• 知識庫\n\n此操作無法復原。`)) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/characters/${id}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) { alert('角色已刪除'); window.location.href = '/dashboard'; }
      else { alert('刪除失敗：' + d.error); setDeleting(false); }
    } catch { alert('刪除失敗'); setDeleting(false); }
  };

  if (!char) return <div style={{ padding: 40, color: '#c00' }}>角色不存在</div>;

  const metrics = char.growthMetrics || { totalConversations: 0, totalInsights: 0, totalPosts: 0 };

  const QUICK_ACTIONS = [
    { href: `/chat/${id}`,                  label: '對話窗',   icon: 'Chat',      desc: '開啟對話，可分享給用戶', external: true },
    { href: `/dashboard/${id}/soul`,        label: '管理靈魂', icon: 'Edit',      desc: '查看/編輯 enhancedSoul' },
    { href: `/dashboard/${id}/knowledge`,   label: '知識庫',   icon: 'Book',      desc: '新增/刪除知識' },
    { href: `/dashboard/${id}/memory`,      label: '記憶',     icon: 'Brain',     desc: 'insights 管理' },
    { href: `/dashboard/${id}/posts`,       label: '發文草稿', icon: 'File',      desc: '審核草稿' },
    { href: `/dashboard/${id}/tasks`,       label: '排程',     icon: 'Clock',     desc: '設定任務時間' },
    { href: `/dashboard/${id}/proposals`,   label: '靈魂提案', icon: 'Lightbulb', desc: '審核靈魂修改' },
  ];

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', padding: '14px 16px',
    transition: 'box-shadow 0.18s var(--ease), transform 0.18s var(--ease)',
    cursor: 'pointer',
  };

  return (
    <div>
      {/* 麵包屑 */}
      <div style={{ marginBottom: 20, fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <a href="/dashboard" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>所有角色</a>
        <span style={{ margin: '0 4px' }}>›</span>
        <span style={{ color: 'var(--text-primary)' }}>{char.name}</span>
      </div>

      {/* ── Hero header ── */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)', padding: isMobile ? 20 : 28, marginBottom: 28,
      }}>
        {/* Top row: avatar + name + actions */}
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          <AvatarLetter name={char.name} size={isMobile ? 48 : 56} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
              <h1 style={{
                margin: 0, fontSize: isMobile ? 20 : 24,
                color: 'var(--text-primary)', fontFamily: 'var(--font-display)',
                fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2,
              }}>{char.name}</h1>
              <span style={{
                background: 'var(--green-bg)', color: 'var(--green)',
                padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 500,
              }}>{char.status === 'active' ? '活躍' : char.status}</span>
              <span style={{
                background: 'var(--bg-alt)', color: 'var(--text-muted)',
                padding: '2px 9px', borderRadius: 20, fontSize: 11,
              }}>靈魂 v{char.soulVersion}</span>
            </div>

            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 16 }}>
              {char.mission || '（使命未設定）'}
            </div>

            {/* Stats inline */}
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {[
                { label: '對話', value: metrics.totalConversations },
                { label: '記憶', value: metrics.totalInsights },
                { label: '發文', value: metrics.totalPosts },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{s.value}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Primary action */}
          {!isMobile && (
            <a href={`/chat/${id}`} target="_blank" rel="noopener noreferrer" style={{
              background: 'var(--text-primary)', color: '#fff',
              padding: '8px 16px', borderRadius: 'var(--r-sm)',
              fontSize: 13, fontWeight: 500, textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              transition: 'opacity 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              <Ic.Chat /> 對話窗
            </a>
          )}
        </div>

        {/* Mobile primary action */}
        {isMobile && (
          <a href={`/chat/${id}`} target="_blank" rel="noopener noreferrer" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginTop: 16, padding: '10px', borderRadius: 'var(--r-sm)',
            background: 'var(--text-primary)', color: '#fff',
            fontSize: 13, fontWeight: 500, textDecoration: 'none',
          }}>
            <Ic.Chat /> 對話窗
          </a>
        )}
      </div>

      {/* ── Nav ── */}
      <CharNav id={id} active="" tier={char.tier} />

      {/* ── 快速操作 ── */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>
          快速操作
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 160 : 200}px, 1fr))`, gap: 10 }}>
          {QUICK_ACTIONS.map(item => (
            <a key={item.href} href={item.href}
              target={(item as { external?: boolean }).external ? '_blank' : undefined}
              rel={(item as { external?: boolean }).external ? 'noopener noreferrer' : undefined}
              style={{ textDecoration: 'none' }}
            >
              <div style={cardStyle}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {(() => { const I = Ic[item.icon as keyof typeof Ic]; return I ? <I /> : null; })()}
                  {item.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{item.desc}</div>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* ── 危險區 ── */}
      <div style={{
        marginTop: 48, padding: isMobile ? 16 : 20,
        border: '1px solid var(--border-soft)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>
          危險操作
        </div>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>刪除角色</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>永久刪除此角色及所有關聯資料（記憶、對話、任務、草稿）。此操作無法復原。</div>
          </div>
          <button onClick={handleDelete} disabled={deleting} style={{
            background: deleting ? 'var(--text-muted)' : 'var(--red)',
            color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 20px', fontSize: 13, fontWeight: 600,
            cursor: deleting ? 'default' : 'pointer',
            flexShrink: 0, alignSelf: isMobile ? 'flex-end' : 'auto',
            display: 'flex', alignItems: 'center', gap: 6,
            transition: 'opacity 0.15s',
          }}
            onMouseEnter={e => { if (!deleting) e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            <Ic.Trash />
            {deleting ? '刪除中...' : '刪除角色'}
          </button>
        </div>
      </div>
    </div>
  );
}
