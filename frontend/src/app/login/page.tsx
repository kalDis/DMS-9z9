'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#080D1A' }}>
      <div className="w-full max-w-sm animate-fadeIn">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl"
            style={{ background: 'linear-gradient(135deg, rgba(0,229,255,.15), rgba(123,47,190,.2))', border: '1px solid rgba(0,229,255,.35)' }}>
            ⬡
          </div>
          <div>
            <div className="text-white font-bold text-lg tracking-wide">DMS</div>
            <div className="text-[9px] tracking-[.12em] uppercase" style={{ color: '#2A4060' }}>Delivery System</div>
          </div>
        </div>

        <div className="rounded-xl p-6" style={{ background: '#0D1B2A', border: '1px solid #1A2940' }}>
          <div className="text-sm font-semibold mb-4" style={{ color: '#E8F4FF' }}>Sign in to your account</div>

          {error && (
            <div className="rounded-lg p-3 mb-4 text-xs font-semibold"
              style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#EF4444' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg px-4 py-3 text-sm mb-3 outline-none"
              style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg px-4 py-3 text-sm mb-4 outline-none"
              style={{ background: '#080D1A', border: '1px solid #1A2940', color: '#C8D8E8' }}
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg py-3 text-sm font-semibold transition-all"
              style={{
                background: 'rgba(0,229,255,.08)',
                border: '1px solid rgba(0,229,255,.3)',
                color: '#00E5FF',
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <div className="text-center mt-4 text-xs" style={{ color: '#2A4060' }}>
          Default: admin@dms.lk / admin123
        </div>
      </div>
    </div>
  );
}
