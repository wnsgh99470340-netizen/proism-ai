'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        const from = searchParams.get('from') || '/';
        router.push(from);
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || '로그인에 실패했습니다.');
      }
    } catch {
      setError('서버 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--c-page)',
        padding: '1rem',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: '360px',
          background: 'var(--c-card)',
          border: '1px solid var(--c-border)',
          borderRadius: '12px',
          padding: '2.5rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: 'var(--c-text-1)',
              margin: 0,
            }}
          >
            3M 프로이즘
          </h1>
          <p
            style={{
              fontSize: '0.85rem',
              color: 'var(--c-text-3)',
              margin: '0.5rem 0 0',
            }}
          >
            CRM 시스템에 접속하려면 비밀번호를 입력하세요.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            autoFocus
            required
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '0.9rem',
              background: 'var(--c-input)',
              border: `1px solid ${error ? '#ef4444' : 'var(--c-border)'}`,
              borderRadius: '8px',
              color: 'var(--c-text-1)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {error && (
            <p
              style={{
                fontSize: '0.8rem',
                color: '#ef4444',
                margin: 0,
              }}
            >
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !password}
          style={{
            width: '100%',
            padding: '0.75rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            background: loading || !password ? 'var(--c-subtle)' : '#3b82f6',
            color: loading || !password ? 'var(--c-text-3)' : '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: loading || !password ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '확인 중...' : '로그인'}
        </button>
      </form>
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
