import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { useAuthStore, getActiveToken } from '../store/authStore';
import {
  getWechatBindStatus,
  getWechatBindUrl,
  wechatBindCallback,
} from '../api/longtaskApi';

type BindState =
  | 'loading'
  | 'unbound'
  | 'bound'
  | 'notConfigured'
  | 'binding'
  | 'qr'
  | 'error';

/**
 * 微信公众号绑定页：既作为个人中心的绑定入口，也作为网页授权回调落地页。
 * 回调带 ?code= → 调后端换 openid 写库 → 展示已绑定。
 */
export default function WechatBind() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token) || getActiveToken();
  const [state, setState] = useState<BindState>('loading');
  const [error, setError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [authUrl, setAuthUrl] = useState('');

  useEffect(() => {
    const code = params.get('code');
    if (code) {
      return void handleCallback(code);
    }
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStatus() {
    if (!token) {
      setState('unbound');
      return;
    }
    try {
      const res = await getWechatBindStatus(token);
      if (!res.configured) setState('notConfigured');
      else setState(res.bound ? 'bound' : 'unbound');
    } catch {
      setState('unbound');
    }
  }

  async function handleCallback(code: string) {
    if (!token) {
      setState('error');
      setError('登录状态失效，请重新登录后再绑定。');
      return;
    }
    setState('binding');
    try {
      const res = await wechatBindCallback(token, code);
      if (res.ok && res.bound) {
        setState('bound');
      } else {
        setState('error');
        setError(res.error || '绑定失败，请稍后重试');
      }
    } catch (e) {
      setState('error');
      setError((e as Error).message);
    }
  }

  async function startBind() {
    if (!token) {
      setError('请先登录');
      setState('error');
      return;
    }
    setState('binding');
    try {
      const res = await getWechatBindUrl(token);
      if (!res.configured || !res.url) {
        setState('notConfigured');
        return;
      }
      // snsapi_base 静默授权只能在微信客户端内打开，故改为展示二维码，
      // 用户用微信扫一扫后在微信内完成绑定。
      const dataUrl = await QRCode.toDataURL(res.url, {
        width: 240,
        margin: 2,
      });
      setQrDataUrl(dataUrl);
      setAuthUrl(res.url);
      setState('qr');
    } catch (e) {
      setState('error');
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background-100)] px-4">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-[color:var(--border)] bg-white p-8 shadow-sm">
        <div className="space-y-3">
          <div className="text-2xl font-semibold text-[var(--foreground)]">
            微信公众号通知
          </div>
          <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">
            绑定微信公众号后，中标签约、雇主支付托管到账以及结算资金到账时，将实时推送到你的微信提醒你。
          </p>
        </div>

        <div className="space-y-3">
          {(state === 'unbound' || state === 'loading') && (
            <>
              <button
                type="button"
                onClick={startBind}
                disabled={state === 'loading'}
                className="w-full rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {state === 'loading' ? '加载中…' : '绑定微信'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/me')}
                className="w-full rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm font-medium text-[var(--foreground-muted)] hover:bg-[var(--background-50)]"
              >
                返回个人中心
              </button>
            </>
          )}

          {state === 'bound' && (
            <div className="space-y-3">
              <div className="rounded-xl bg-[color:var(--success-50)] px-4 py-3 text-sm text-[color:var(--success)]">
                ✓ 已绑定微信，中标、到账等重要提醒将推送至你的微信。
              </div>
              <button
                type="button"
                onClick={() => navigate('/me')}
                className="w-full rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm font-medium text-[var(--foreground-muted)] hover:bg-[var(--background-50)]"
              >
                返回个人中心
              </button>
            </div>
          )}

          {state === 'qr' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3">
                <img
                  src={qrDataUrl}
                  alt="微信扫码绑定二维码"
                  className="h-56 w-56 rounded-xl border border-[color:var(--border)]"
                />
                <p className="text-center text-sm text-[var(--foreground-muted)]">
                  用<strong>微信扫一扫</strong>上方二维码，
                  <br />
                  即可完成微信通知绑定。
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={startBind}
                  className="flex-1 rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm font-medium text-[var(--foreground-muted)] hover:bg-[var(--background-50)]"
                >
                  刷新二维码
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/me')}
                  className="flex-1 rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm font-medium text-[var(--foreground-muted)] hover:bg-[var(--background-50)]"
                >
                  返回个人中心
                </button>
              </div>
              <a
                href={authUrl}
                className="block text-center text-xs text-[var(--foreground-muted)] underline"
              >
                已在微信或支持的环境，点此直接打开授权链接
              </a>
            </div>
          )}

          {state === 'notConfigured' && (
            <div className="space-y-3">
              <div className="rounded-xl bg-[var(--background-100)] px-4 py-3 text-sm text-[var(--foreground-muted)]">
                平台暂未开启微信通知通道，请稍后再试。
              </div>
              <button
                type="button"
                onClick={() => navigate('/me')}
                className="w-full rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm font-medium text-[var(--foreground-muted)] hover:bg-[var(--background-50)]"
              >
                返回个人中心
              </button>
            </div>
          )}

          {state === 'error' && (
            <div className="space-y-3">
              <div className="rounded-xl bg-[color:var(--danger-50)] px-4 py-3 text-sm text-[color:var(--danger)]">
                {error}
              </div>
              <button
                type="button"
                onClick={() => navigate('/me')}
                className="w-full rounded-xl border border-[color:var(--border)] px-4 py-3 text-sm font-medium text-[var(--foreground-muted)] hover:bg-[var(--background-50)]"
              >
                返回个人中心
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}