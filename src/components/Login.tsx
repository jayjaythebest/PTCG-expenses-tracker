import { useState, FormEvent } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

function friendlyError(message: string): string {
  if (/invalid login credentials/i.test(message)) return '帳號或密碼不正確';
  if (/email not confirmed/i.test(message))       return '此帳號尚未完成驗證';
  if (/too many requests|rate limit/i.test(message)) return '嘗試次數過多，請稍後再試';
  return '登入失敗，請稍後再試';
}

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : ''));
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center px-4">
      <div className="poke-card w-full max-w-sm p-8">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-poke-blue rounded-full flex items-center justify-center shadow-sm">
            <Zap className="w-7 h-7 text-white fill-white" />
          </div>
          <h1 className="font-black text-xl text-slate-100 tracking-tight">J Vault</h1>
          <p className="text-sm text-slate-400">請登入以查看你的收藏與帳目</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-black text-slate-400 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="poke-input text-base"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-black text-slate-400 mb-1.5">
              密碼
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="poke-input text-base"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="poke-button-primary w-full flex items-center justify-center gap-2 font-black"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? '登入中…' : '登入'}
          </button>
        </form>
      </div>
    </div>
  );
}
