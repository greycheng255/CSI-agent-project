import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Loader2, ShieldAlert } from 'lucide-react';

/**
 * Casdoor SSO 回调落地页（Casdoor 白名单 redirect_uri = {origin}/callback）：
 * 校验 state（防 CSRF）→ 用授权码换平台会话（authStore.login）→ 续跳原目标。
 * 仅作协议落地，不挂 MainLayout。
 */
export default function SsoCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const casdoorError = searchParams.get('error');
    if (casdoorError) {
      setError(`Casdoor 授权失败：${casdoorError}`);
      return;
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const expectedState = sessionStorage.getItem('csi_sso_state');
    if (!code || !state) {
      setError('回调缺少 code 或 state 参数');
      return;
    }
    if (!expectedState || state !== expectedState) {
      setError('state 校验失败，请返回登录页重新发起 SSO 登录');
      return;
    }

    const saved = sessionStorage.getItem('csi_sso_redirect') ?? '/';
    const safeRedirect = saved.startsWith('/') && !saved.startsWith('//') ? saved : '/';
    sessionStorage.removeItem('csi_sso_state');
    sessionStorage.removeItem('csi_sso_redirect');

    import('../services/auth.service').then(({ loginWithSsoCode }) =>
      loginWithSsoCode(code, `${window.location.origin}/callback`)
        .then(() => navigate(safeRedirect, { replace: true }))
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : 'SSO 登录失败，请稍后重试'),
        ),
    );
  }, [searchParams, navigate]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-md items-center px-4 py-10">
      <section className="card-cs w-full p-8">
        <div className="mb-6 text-center">
          <div className="icon-tile-cs mx-auto mb-4">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">SSO 登录</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-500)]">
            正在通过 Casdoor 完成登录
          </p>
        </div>

        {error ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-lg border border-[color:var(--border)] bg-[var(--background-100)] p-4 text-sm text-[var(--text-600)]">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-400)]" />
              <span>{error}</span>
            </div>
            <Link to="/login" className="btn-cs btn-primary w-full text-center">
              返回登录页
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 py-6 text-sm text-[var(--text-500)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在校验授权并建立会话，请稍候…
          </div>
        )}
      </section>
    </div>
  );
}
