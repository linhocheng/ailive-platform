'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get('from') || '/dashboard';

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password })
    });
    setPending(false);
    if (res.ok) {
      router.replace(from);
      router.refresh();
    } else {
      setError('密碼錯誤');
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: '24px',
      fontFamily: 'var(--font-sans, "DM Sans", system-ui, sans-serif)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '360px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '20px',
        padding: '40px 36px',
        boxShadow: '0 2px 0 rgba(26,25,22,0.04), 0 12px 40px -12px rgba(26,25,22,0.10)',
      }}>
        <div style={{ marginBottom: '28px' }}>
          <div style={{
            fontSize: '18px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'var(--text-primary)',
            marginBottom: '6px',
          }}>
            AILIVE
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            請輸入密碼繼續
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input
            type="password"
            autoFocus
            placeholder="密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            style={{
              width: '100%',
              border: '1.5px solid var(--border)',
              borderRadius: '10px',
              padding: '10px 14px',
              fontSize: '14px',
              fontFamily: 'inherit',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          />

          {error && (
            <div style={{ fontSize: '12.5px', color: '#C0392B' }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={pending || !password}
            style={{
              width: '100%',
              background: 'var(--text-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              padding: '11px',
              fontSize: '13.5px',
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: pending || !password ? 'default' : 'pointer',
              opacity: pending || !password ? 0.4 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {pending ? '驗證中…' : '進入'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
