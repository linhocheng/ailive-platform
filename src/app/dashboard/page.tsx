'use client';
import { useEffect, useState } from 'react';

interface Character {
  id: string;
  name: string;
  type: string;
  status: string;
  soulVersion: number;
  mission?: string;
  growthMetrics?: {
    totalConversations: number;
    totalInsights: number;
    totalPosts: number;
  };
  costMetrics?: {
    totalCostUSD: number;
  };
  updatedAt?: string;
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 2, padding: '10px 8px',
      background: 'var(--bg)',
      borderRadius: 'var(--r-sm)',
      minWidth: 60,
    }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{label}</span>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const label = type === 'vtuber' ? '虛擬網紅' : '品牌小編';
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, letterSpacing: '0.05em',
      color: 'var(--text-muted)',
      background: 'var(--bg-alt)',
      padding: '2px 8px',
      borderRadius: 20,
      border: '1px solid var(--border-soft)',
    }}>{label}</span>
  );
}

function StatusDot({ status }: { status: string }) {
  const active = status === 'active';
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: active ? 'var(--green)' : 'var(--amber)',
        boxShadow: active ? '0 0 0 2px var(--green-bg)' : '0 0 0 2px var(--amber-bg)',
      }} />
      <span style={{ fontSize: 12, color: active ? 'var(--green)' : 'var(--amber)', fontWeight: 500 }}>
        {active ? '活躍' : '待設定'}
      </span>
    </span>
  );
}

const IconMic = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
      {/* ── Page Header ── */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 26,
          fontWeight: 700,
          color: 'var(--text-primary)',
          letterSpacing: '-0.03em',
          lineHeight: 1.2,
          margin: 0,
        }}>角色</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
          {characters.length} 個角色活躍中
        </p>
      </div>

      {characters.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '80px 40px',
          border: '1.5px dashed var(--border)',
          borderRadius: 'var(--r-lg)',
          color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>＋</div>
          <div style={{ fontSize: 15, marginBottom: 20 }}>還沒有角色</div>
          <a href="/dashboard/create" style={{
            color: '#fff', background: 'var(--text-primary)',
            padding: '8px 20px', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 500,
          }}>建立第一個</a>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16,
        }}>
          {characters.map(c => (
            <a key={c.id} href={`/dashboard/${c.id}`} style={{ textDecoration: 'none', display: 'block' }}>
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  padding: '20px',
                  transition: 'box-shadow 0.18s var(--ease), transform 0.18s var(--ease)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {/* ── Card Top ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 17, fontWeight: 700,
                      color: 'var(--text-primary)',
                      letterSpacing: '-0.02em',
                      marginBottom: 5,
                    }}>{c.name}</div>
                    <TypeBadge type={c.type} />
                  </div>
                  <StatusDot status={c.status} />
                </div>

                {/* ── Mission ── */}
                {c.mission && (
                  <p style={{
                    fontSize: 12, color: 'var(--text-secondary)',
                    lineHeight: 1.5, marginBottom: 16,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>{c.mission}</p>
                )}

                {/* ── Stats ── */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                  <StatPill label="對話" value={c.growthMetrics?.totalConversations ?? 0} />
                  <StatPill label="記憶" value={c.growthMetrics?.totalInsights ?? 0} />
                  <StatPill label="發文" value={c.growthMetrics?.totalPosts ?? 0} />
                </div>

                {/* ── Footer ── */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  paddingTop: 14,
                  borderTop: '1px solid var(--border-soft)',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    v{c.soulVersion} · {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('zh-TW') : '—'}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <a href={`/chat/${c.id}`}
                      onClick={e => e.stopPropagation()}
                      style={{
                        fontSize: 12, fontWeight: 500,
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: 20,
                        padding: '4px 12px',
                        background: 'var(--surface)',
                        transition: 'border-color 0.15s, color 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-primary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >文字</a>
                    <a href={`/voice/${c.id}`} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{
                        fontSize: 12, fontWeight: 500,
                        color: '#fff',
                        background: 'var(--text-primary)',
                        borderRadius: 20,
                        padding: '4px 12px',
                        transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                    ><IconMic /> 語音</a>
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
