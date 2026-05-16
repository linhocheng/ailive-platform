'use client';
import { useEffect, useState } from 'react';

interface Character {
  id: string;
  name: string;
  type: string;
  tier?: 'character' | 'strategist' | 'specialist' | string;
  status: string;
  soulVersion: number;
  mission?: string;
  growthMetrics?: { totalConversations: number; totalInsights: number; totalPosts: number };
  costMetrics?: { totalCostUSD: number };
  updatedAt?: string;
}

function TierBadge({ tier }: { tier?: string }) {
  const cfg = (() => {
    switch (tier) {
      case 'character':  return { label: '🎭 CHARACTER',  fg: '#2D6A4F', bg: '#D8F3DC', border: '#95D5B2' };
      case 'strategist': return { label: '🧠 STRATEGIST', fg: '#5A3E7A', bg: '#EDE4F5', border: '#C8B0DC' };
      case 'specialist': return { label: '🛠 SPECIALIST', fg: '#1E4A6B', bg: '#D6E9F5', border: '#A7C9E0' };
      default:           return { label: '◦ UNTAGGED',    fg: '#8A887F', bg: '#F0EEE8', border: '#DDD9D0' };
    }
  })();
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
      color: cfg.fg, background: cfg.bg,
      padding: '2px 8px', borderRadius: 20,
      border: `1px solid ${cfg.border}`, whiteSpace: 'nowrap',
    }}>{cfg.label}</span>
  );
}

function AvatarLetter({ name, tier }: { name: string; tier?: string }) {
  const bg = tier === 'character' ? '#D8F3DC' : tier === 'strategist' ? '#EDE4F5' : tier === 'specialist' ? '#D6E9F5' : '#F0EEE8';
  const fg = tier === 'character' ? '#2D6A4F' : tier === 'strategist' ? '#5A3E7A' : tier === 'specialist' ? '#1E4A6B' : '#8A887F';
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 14,
      background: bg, color: fg,
      fontSize: 20, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, fontFamily: 'var(--font-display)',
      letterSpacing: '-0.02em',
    }}>{name[0]}</div>
  );
}

const IconMic = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);

export default function DashboardPage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/characters').then(r => r.json()).then(d => {
      setCharacters(d.characters || []);
      setLoading(false);
    });
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>載入中…</div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700,
          color: 'var(--text-primary)', letterSpacing: '-0.03em', lineHeight: 1.2, margin: 0,
        }}>角色</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, margin: '6px 0 0' }}>
          {characters.length} 個角色活躍中
        </p>
      </div>

      {characters.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '80px 40px',
          border: '1.5px dashed var(--border)', borderRadius: 'var(--r-lg)',
          color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>＋</div>
          <div style={{ fontSize: 15, marginBottom: 20 }}>還沒有角色</div>
          <a href="/dashboard/create" style={{
            color: '#fff', background: 'var(--text-primary)',
            padding: '8px 20px', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 500,
            textDecoration: 'none',
          }}>建立第一個</a>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 14,
        }}>
          {characters.map(c => (
            <a key={c.id} href={`/dashboard/${c.id}`} style={{ textDecoration: 'none', display: 'block' }}>
              <div
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)', padding: '20px 20px 16px',
                  transition: 'box-shadow 0.18s var(--ease), transform 0.18s var(--ease)',
                  cursor: 'pointer', height: '100%', boxSizing: 'border-box',
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                {/* Top: avatar + info */}
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
                  <AvatarLetter name={c.name} tier={c.tier} />
                  <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                    <div style={{
                      fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700,
                      color: 'var(--text-primary)', letterSpacing: '-0.02em',
                      marginBottom: 4, lineHeight: 1.2,
                    }}>{c.name}</div>
                    {c.mission && (
                      <div style={{
                        fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
                        display: '-webkit-box', WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>{c.mission}</div>
                    )}
                  </div>
                  {/* status dot */}
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 6,
                    background: c.status === 'active' ? 'var(--green)' : 'var(--amber)',
                    boxShadow: c.status === 'active' ? '0 0 0 2px var(--green-bg)' : '0 0 0 2px var(--amber-bg)',
                  }} />
                </div>

                {/* Badges + stats row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                  <TierBadge tier={c.tier} />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto', letterSpacing: '0.02em' }}>
                    {[
                      `${c.growthMetrics?.totalConversations ?? 0} 對話`,
                      `${c.growthMetrics?.totalInsights ?? 0} 記憶`,
                      `${c.growthMetrics?.totalPosts ?? 0} 發文`,
                    ].join(' · ')}
                  </span>
                </div>

                {/* Footer */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  paddingTop: 12, borderTop: '1px solid var(--border-soft)',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    v{c.soulVersion}{(c.costMetrics?.totalCostUSD ?? 0) > 0 ? ` · NT$${((c.costMetrics!.totalCostUSD) * 32).toFixed(0)}` : ''}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }} onClick={e => e.preventDefault()}>
                    <a href={`/chat/${c.id}`}
                      onClick={e => e.stopPropagation()}
                      style={{
                        fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
                        border: '1px solid var(--border)', borderRadius: 20,
                        padding: '4px 12px', background: 'var(--surface)',
                        textDecoration: 'none', transition: 'border-color 0.15s, color 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-primary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >文字</a>
                    <a href={`/voice/${c.id}`} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{
                        fontSize: 12, fontWeight: 500, color: '#fff',
                        background: 'var(--text-primary)', borderRadius: 20,
                        padding: '4px 12px', textDecoration: 'none',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                    ><IconMic /> 語音</a>
                    <a href={`/realtime/${c.id}`} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{
                        fontSize: 12, fontWeight: 500, color: '#fff',
                        background: '#C2410C', borderRadius: 20,
                        padding: '4px 12px', textDecoration: 'none',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
                      即時
                    </a>
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
