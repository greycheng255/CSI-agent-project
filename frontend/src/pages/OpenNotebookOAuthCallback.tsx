import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { completeOpenNotebookAuthorization } from '../features/agent-market/openNotebookOAuth';
import { useAuthStore } from '../store/authStore';

export default function OpenNotebookOAuthCallback() {
  const navigate = useNavigate();
  const started = useRef(false);
  const accountId = useAuthStore(
    (state) => state.user?.id || state.admin?.id || 'anonymous',
  );
  const [status, setStatus] = useState<'working' | 'success' | 'error'>('working');
  const [error, setError] = useState('');

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    completeOpenNotebookAuthorization(accountId, window.location.search)
      .then(({ returnTo }) => {
        setStatus('success');
        navigate(returnTo, { replace: true });
      })
      .catch((reason: unknown) => {
        setStatus('error');
        setError(reason instanceof Error ? reason.message : 'OpenNotebook 授权失败。');
      });
  }, [accountId, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background-50)] p-6">
      <section className="w-full max-w-md rounded-2xl border border-[color:var(--border)] bg-white p-8 text-center shadow-sm">
        {status === 'working' && (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-[var(--brand-600)]" />
            <h1 className="mt-5 text-xl font-bold text-[var(--text-900)]">正在完成 OpenNotebook 授权</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-500)]">正在校验 state 和 PKCE，并交换访问令牌。</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-[var(--state-success-text)]" />
            <h1 className="mt-5 text-xl font-bold text-[var(--text-900)]">授权成功</h1>
            <p className="mt-2 text-sm text-[var(--text-500)]">正在返回智能体工作台。</p>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertTriangle className="mx-auto h-10 w-10 text-[var(--state-error)]" />
            <h1 className="mt-5 text-xl font-bold text-[var(--text-900)]">授权未完成</h1>
            <p className="mt-3 rounded-xl bg-[var(--state-error-surface)] p-3 text-sm leading-6 text-[var(--state-error)]">
              {error}
            </p>
            <Link
              to="/agent-market"
              replace
              className="mt-5 inline-flex min-h-10 items-center rounded-xl bg-[var(--brand-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-700)]"
            >
              返回智能体集市
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
