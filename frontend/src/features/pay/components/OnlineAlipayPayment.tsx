import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  createAlipayPayment,
  getAlipayPaymentStatus,
} from '../../../api/pay';
import type { AlipayPaymentState } from '../types';

interface Props {
  orderId: string;
  token: string;
  amountCny: number;
  onPaid: () => void;
}

const POLL_INTERVAL_MS = 2500;
const CHANNEL_REFRESH_AFTER_MS = 10_000;
const CHANNEL_REFRESH_INTERVAL_MS = 10_000;

export function OnlineAlipayPayment({
  orderId,
  token,
  amountCny,
  onPaid,
}: Props) {
  const [payment, setPayment] = useState<AlipayPaymentState | null>(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const startedAtRef = useRef(0);
  const paidHandledRef = useRef(false);
  const paymentRef = useRef<AlipayPaymentState | null>(null);
  const lastChannelRefreshAtRef = useRef(0);

  const acceptState = useCallback(
    (next: AlipayPaymentState) => {
      paymentRef.current = next;
      setPayment(next);
      if (next.status === 'PAID' && !paidHandledRef.current) {
        paidHandledRef.current = true;
        onPaid();
      }
    },
    [onPaid],
  );

  const checkStatus = useCallback(
    async (refresh: boolean) => {
      setChecking(true);
      if (refresh) lastChannelRefreshAtRef.current = Date.now();
      try {
        const next = await getAlipayPaymentStatus(orderId, token, refresh);
        acceptState(next);
        setError('');
      } catch (requestError) {
        if (paymentRef.current) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : '支付状态查询失败',
          );
        }
      } finally {
        setChecking(false);
      }
    },
    [acceptState, orderId, token],
  );

  useEffect(() => {
    void getAlipayPaymentStatus(orderId, token)
      .then((next) => {
        acceptState(next);
        if (next.status === 'PENDING') startedAtRef.current = Date.now();
      })
      .catch(() => undefined);
  }, [acceptState, orderId, token]);

  useEffect(() => {
    if (payment?.status !== 'PENDING') return;
    if (!startedAtRef.current) startedAtRef.current = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const shouldRefresh =
        now - startedAtRef.current >= CHANNEL_REFRESH_AFTER_MS &&
        now - lastChannelRefreshAtRef.current >= CHANNEL_REFRESH_INTERVAL_MS;
      void checkStatus(shouldRefresh);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [checkStatus, payment?.status]);

  useEffect(() => {
    if (payment?.status !== 'PENDING') return;
    const onFocus = () => void checkStatus(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [checkStatus, payment?.status]);

  const startPayment = async () => {
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      setError('浏览器阻止了支付窗口，请允许本站打开弹窗后重试。');
      return;
    }
    popup.document.title = '正在打开支付宝…';
    popup.opener = null;
    setCreating(true);
    setError('');
    try {
      const result = await createAlipayPayment(orderId, token);
      acceptState(result);
      if (result.status === 'PAID') {
        popup.close();
        return;
      }
      if (!result.paymentUrl) throw new Error('支付渠道未返回收银台地址');
      startedAtRef.current = Date.now();
      popup.location.assign(result.paymentUrl);
    } catch (requestError) {
      popup.close();
      setError(
        requestError instanceof Error ? requestError.message : '创建支付失败',
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-[#b8dcff] bg-[linear-gradient(135deg,#f5fbff_0%,#ffffff_65%)]">
      <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1677ff] text-lg font-bold text-white">
              支
            </span>
            <div>
              <h2 className="font-semibold text-[var(--text-900)]">
                支付宝在线支付
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-500)]">
                服务端创建订单并验签确认，无需上传付款截图
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="text-[var(--text-500)]">
              应付{' '}
              <strong className="text-xl text-[var(--text-900)]">
                ¥{(amountCny / 100).toFixed(2)}
              </strong>
            </span>
            <span className="inline-flex items-center gap-1 text-[var(--state-success-text)]">
              <ShieldCheck className="h-4 w-4" /> RSA2 验签与金额核对
            </span>
          </div>
          {payment?.status === 'PENDING' && (
            <p className="mt-3 text-sm text-[#0f63b5]">
              支付订单已创建，请在支付宝页面完成付款；本页会自动确认结果。
            </p>
          )}
          {payment?.status === 'PAID' && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--state-success-text)]">
              <CheckCircle2 className="h-4 w-4" /> 支付已确认，正在进入订单…
            </p>
          )}
          {payment?.status === 'FAILED' && (
            <p className="mt-3 text-sm text-[var(--state-error)]">
              上一笔支付已关闭或失效，可以重新发起支付。
            </p>
          )}
          {error && (
            <p className="mt-3 text-sm text-[var(--state-error)]">{error}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:w-48">
          <button
            type="button"
            onClick={startPayment}
            disabled={creating || payment?.status === 'PAID'}
            className="btn-cs btn-primary btn-sm w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            {payment?.status === 'PENDING' ? '重新打开收银台' : '前往支付宝付款'}
          </button>
          {payment?.status === 'PENDING' && (
            <button
              type="button"
              onClick={() => void checkStatus(true)}
              disabled={checking}
              className="btn-cs btn-secondary btn-sm w-full disabled:opacity-50"
            >
              {checking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              我已完成支付
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
