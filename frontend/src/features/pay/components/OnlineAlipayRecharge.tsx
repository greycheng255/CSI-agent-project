import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  createRechargePayment,
  getRechargePaymentStatus,
} from '../../../api/pay';
import type { RechargePaymentState } from '../types';

interface Props {
  amountCny: number;
  token: string;
  onPaid: () => void;
}

const POLL_INTERVAL_MS = 2500;

/**
 * 余额充值支付组件：与 OnlineAlipayPayment 骨架一致，但按 outTradeNo
 * 轮询充值状态（无 orderId）。复用 mock 收银台弹窗。
 */
export function OnlineAlipayRecharge({ amountCny, token, onPaid }: Props) {
  const [payment, setPayment] = useState<RechargePaymentState | null>(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const paidHandledRef = useRef(false);
  const paymentRef = useRef<RechargePaymentState | null>(null);

  const acceptState = useCallback(
    (next: RechargePaymentState) => {
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
      if (!paymentRef.current?.outTradeNo) return;
      setChecking(true);
      try {
        const next = await getRechargePaymentStatus(
          paymentRef.current.outTradeNo,
          token,
          refresh,
        );
        acceptState(next);
        setError('');
      } catch (requestError) {
        if (paymentRef.current) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : '充值状态查询失败',
          );
        }
      } finally {
        setChecking(false);
      }
    },
    [acceptState, token],
  );

  // 轮询：PENDING 时每 2.5s 查一次
  useEffect(() => {
    if (payment?.status !== 'PENDING') return;
    const timer = window.setInterval(() => {
      void checkStatus(false);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [checkStatus, payment?.status]);

  // 窗口聚焦时主动刷新
  useEffect(() => {
    if (payment?.status !== 'PENDING') return;
    const onFocus = () => void checkStatus(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [checkStatus, payment?.status]);

  const startRecharge = async () => {
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
      const result = await createRechargePayment(amountCny, token);
      acceptState(result);
      if (result.status === 'PAID') {
        popup.close();
        return;
      }
      if (!result.paymentUrl) throw new Error('支付渠道未返回收银台地址');
      popup.location.assign(result.paymentUrl);
    } catch (requestError) {
      popup.close();
      setError(
        requestError instanceof Error ? requestError.message : '创建充值失败',
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
              充
            </span>
            <div>
              <h2 className="font-semibold text-[var(--text-900)]">
                支付宝余额充值
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-500)]">
                在线支付自动入账，无需人工确认
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="text-[var(--text-500)]">
              充值金额{' '}
              <strong className="text-xl text-[var(--text-900)]">
                ¥{(amountCny / 100).toFixed(2)}
              </strong>
            </span>
            <span className="inline-flex items-center gap-1 text-[var(--state-success-text)]">
              <ShieldCheck className="h-4 w-4" /> 支付成功后自动到账
            </span>
          </div>
          {payment?.status === 'PENDING' && (
            <p className="mt-3 text-sm text-[#0f63b5]">
              充值订单已创建，请在支付宝页面完成付款；本页会自动确认结果。
            </p>
          )}
          {payment?.status === 'PAID' && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--state-success-text)]">
              <CheckCircle2 className="h-4 w-4" /> 充值已到账，正在刷新余额…
            </p>
          )}
          {payment?.status === 'FAILED' && (
            <p className="mt-3 text-sm text-[var(--state-error)]">
              上一笔充值已关闭或失效，可以重新发起。
            </p>
          )}
          {error && (
            <p className="mt-3 text-sm text-[var(--state-error)]">{error}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:w-48">
          <button
            type="button"
            onClick={startRecharge}
            disabled={creating || payment?.status === 'PAID'}
            className="btn-cs btn-primary btn-sm w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            {payment?.status === 'PENDING' ? '重新打开收银台' : '前往支付宝充值'}
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
