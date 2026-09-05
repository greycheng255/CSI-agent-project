import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ShieldCheck, XCircle, Key } from 'lucide-react';
import { API_BASE } from '../config/api';
import { useAuthStore } from '../store/authStore';

/**
 * SSO 授权页（Marketplace 作为 IdP）
 * 流程：子应用携带 client_id/redirect_uri/state/code_challenge 跳入本页；
 * - 未登录 → 跳转 /login?redirect=（登录后回跳本页自动完成授权）
 * - 已登录 → 调用后端签发授权码，携带 code + state 跳回子应用 redirect_uri
 */
export default function SsoAuthorize() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'init' | 'redirecting'>('init');
  const startedRef = useRef(false);

  const clientId = searchParams.get('client_id') || '';
  const redirectUri = searchParams.get('redirect_uri') || '';
  const state = searchParams.get('state');
  const codeChallenge = searchParams.get('code_challenge');
  const codeChallengeMethod = searchParams.get('code_challenge_method') || 'S256';

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const run = async () => {
      if (!clientId || !redirectUri) {
        setError('缺少 client_id 或 redirect_uri 参数');
        return;
      }

      const token = useAuthStore.getState().token;
      if (!token) {
        // 未登录：携带当前完整路径回跳登录页，登录成功后回到本页继续授权
        const currentPath = `/sso/authorize?${window.location.search}`;
        navigate(`/login?redirect=${encodeURIComponent(currentPath)}`);
        return;
      }

      setStatus('redirecting');
      try {
        const response = await fetch(`${API_BASE}/api/v1/sso/authorize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            client_id: clientId,
            redirect_uri: redirectUri,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: codeChallengeMethod,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.message || `授权失败 (${response.status})`);
        }

        const data = (await response.json()) as {
          code: string;
          state: string | null;
          redirect_uri: string;
        };

        const back = new URL(data.redirect_uri);
        back.searchParams.set('code', data.code);
        if (data.state !== null && data.state !== undefined) {
          back.searchParams.set('state', data.state);
        }
        window.location.href = back.toString();
      } catch (err) {
        setStatus('init');
        setError(err instanceof Error ? err.message : '授权失败');
      }
    };

    void run();
  }, [clientId, redirectUri, state, codeChallenge, codeChallengeMethod, navigate]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-md items-center px-4 py-10">
      <section className="card-cs w-full p-8 text-center">
        <div className="icon-tile-cs mx-auto mb-4">
          {error ? (
            <XCircle className="h-6 w-6 text-[var(--state-error)]" />
          ) : (
            <ShieldCheck className="h-6 w-6" />
          )}
        </div>

        {error ? (
          <>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">授权失败</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-500)]">{error}</p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="btn-cs btn-primary btn-sm mt-6"
            >
              返回首页
            </button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">正在授权</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-500)]">
              正在使用 CSi 账号登录 <span className="font-mono">{clientId}</span>
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-[var(--text-500)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === 'redirecting' ? '授权成功，正在跳转…' : '正在验证登录状态…'}
            </div>
            <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-[var(--text-400)]">
              <Key className="h-3.5 w-3.5" />
              仅授予权限范围内的账号信息，可随时在个人中心撤销令牌
            </p>
          </>
        )}
      </section>
    </div>
  );
}
