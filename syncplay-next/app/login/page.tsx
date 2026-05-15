'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [isReg, setIsReg] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const path = isReg ? '/auth/register' : '/auth/login';
      const body = isReg ? { username, email, password } : { username, password };
      await api('POST', path, body);
      router.push('/');
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  }

  return (
    <div style={{ position: 'relative', zIndex: 10, minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass" style={{ padding: 36, width: 380, maxWidth: '90vw', borderRadius: 20 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 44, marginBottom: 6 }}>🎵</div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.5px', margin: '0 0 4px' }}>SyncPlay</h1>
          <p style={{ color: 'var(--ink-dim)', fontSize: 13, margin: 0 }}>
            {isReg ? 'Создай аккаунт' : 'Войди чтобы слушать вместе'}
          </p>
        </div>

        <form onSubmit={submit}>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Имя пользователя" style={inp} />
          {isReg && <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" style={inp} />}
          <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Пароль" type="password" style={inp} />
          <button type="submit" disabled={loading} style={{
            width: '100%', padding: 13, borderRadius: 12, marginTop: 8,
            background: 'var(--accent)', color: '#1a0030', border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
          }}>
            {loading ? '...' : (isReg ? 'Зарегистрироваться' : 'Войти')}
          </button>
        </form>

        <div onClick={() => setIsReg(!isReg)} style={{
          textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--ink-dim)',
          cursor: 'pointer', textDecoration: 'underline',
        }}>
          {isReg ? 'Уже есть аккаунт? Войди' : 'Нет аккаунта? Зарегистрируйся'}
        </div>

        {error && <div style={{ color: 'oklch(0.7 0.2 30)', fontSize: 12, marginTop: 10, textAlign: 'center' }}>{error}</div>}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: '100%', padding: '12px 16px', marginBottom: 10,
  background: 'var(--glass)', border: '1px solid var(--glass-border)',
  borderRadius: 12, color: 'var(--ink)', fontSize: 14, outline: 'none',
  fontFamily: 'inherit',
};
