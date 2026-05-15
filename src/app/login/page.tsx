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
    <div className='flex min-h-screen items-center justify-center bg-[#F5F4F1] p-6'>
      <div className='w-full max-w-xs rounded-2xl bg-white p-8 shadow-sm'>
        <div className='mb-6'>
          <div className='text-lg font-semibold tracking-tight'>AILIVE</div>
          <div className='text-sm text-gray-400'>請輸入密碼</div>
        </div>
        <form onSubmit={onSubmit} className='flex flex-col gap-3'>
          <input
            type='password'
            autoFocus
            placeholder='密碼'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            className='w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-gray-400'
          />
          {error && <div className='text-sm text-red-500'>{error}</div>}
          <button
            type='submit'
            disabled={pending || !password}
            className='w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white disabled:opacity-40'
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
