'use client';
import { usePathname } from 'next/navigation';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboardRoot = pathname === '/dashboard';

  return (
    <div style={{
      fontFamily: 'var(--font-body)',
      minHeight: '100vh',
      background: 'var(--bg)',
    }}>
      {/* ── Header ── */}
      <header style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 32px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <a href="/dashboard" style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            fontWeight: 800,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{
              width: 26, height: 26,
              background: 'var(--text-primary)',
              borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 12, fontWeight: 800,
            }}>AI</span>
            AILIVE
          </a>
          {!isDashboardRoot && (
            <span style={{
              color: 'var(--border)',
              fontSize: 18,
              fontWeight: 300,
            }}>/</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/dashboard" style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            padding: '5px 12px',
            borderRadius: 'var(--r-sm)',
            transition: 'background 0.15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-alt)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >所有角色</a>
          <a href="/dashboard/create" style={{
            fontSize: 13,
            fontWeight: 500,
            color: '#fff',
            background: 'var(--text-primary)',
            padding: '6px 16px',
            borderRadius: 'var(--r-sm)',
            transition: 'opacity 0.15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >+ 新增角色</a>
        </div>
      </header>

      {/* ── Main ── */}
      <main style={{
        maxWidth: 1280,
        margin: '0 auto',
        padding: '32px 32px',
      }}>
        {children}
      </main>
    </div>
  );
}
