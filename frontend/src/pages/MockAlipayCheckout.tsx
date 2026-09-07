import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { API_BASE } from '../config/api';

interface MockNotifyResponse {
  success: true;
  data: { orderId: string; outTradeNo: string };
}

export default function MockAlipayCheckout() {
  const [outTradeNo] = useState(
    () => new URLSearchParams(window.location.search).get('out_trade_no') || '',
  );
  const [totalAmount] = useState(
    () => new URLSearchParams(window.location.search).get('total_amount') || '',
  );
  const [subject] = useState(
    () => new URLSearchParams(window.location.search).get('subject') ||
      'CSI 任务订单',
  );
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState('');
  const closedHintShownRef = useRef(false);

  const ready = Boolean(outTradeNo && totalAmount);

  useEffect(() => {
    if (!paid) return;
    if (closedHintShownRef.current) return;
    closedHintShownRef.current = true;
    // 通知父窗口（在线支付组件会通过轮询发现 PAID 并跳转订单详情）
    try {
      window.opener?.postMessage?.({ source: 'mock-alipay', paid: true }, '*');
    } catch {
      // 跨域或无 opener 时忽略
    }
    // 尝试自动关闭弹窗；浏览器阻止时留给用户手动关闭
    setTimeout(() => {
      try {
        window.close();
      } catch {
        // ignore
      }
    }, 1200);
  }, [paid]);

  const confirmPay = async () => {
    if (!ready) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        `${API_BASE}/api/v1/payments/alipay/mock/notify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            out_trade_no: outTradeNo,
            total_amount: totalAmount,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | MockNotifyResponse
        | { message?: string | string[] }
        | null;
      if (!response.ok || !payload || (payload as MockNotifyResponse).success !== true) {
        const message = (payload as { message?: string | string[] })?.message;
        throw new Error(
          Array.isArray(message)
            ? message.join('；')
            : message || `支付确认失败 (${response.status})`,
        );
      }
      setPaid(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '支付确认失败，请重试',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(160deg,#eef6ff_0%,#f7fbff_55%,#ffffff_100%)] px-4 py-10">
      <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-[#b8dcff] bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-[#e3f0ff] bg-[linear-gradient(135deg,#1677ff_0%,#3b8cff_100%)] px-5 py-4 text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 text-lg font-bold">
            支
          </span>
          <div>
            <h1 className="text-base font-semibold">支付宝 · 模拟收银台</h1>
            <p className="mt-0.5 text-xs text-white/80">
              商户资质审批期间用于本地联调，不会发生真实扣款
            </p>
          </div>
        </div>

        <div className="space-y-5 px-5 py-6">
          <div className="rounded-xl bg-[var(--background-100)] p-4 text-sm">
            <div className="flex items-center gap-1.5 text-[var(--state-success-text)]">
              <ShieldCheck className="h-4 w-4" />
              <span className="font-medium">RSA2 验签与金额核对（模拟）</span>
            </div>
            <div className="mt-3 flex justify-between gap-3">
              <span className="text-[var(--text-500)]">商品</span>
              <span className="max-w-[60%] text-right font-medium text-[var(--text-800)]">{subject}</span>
            </div>
            <div className="mt-3 flex justify-between gap-3">
              <span className="text-[var(--text-500)]">商户订单号</span>
              <span className="break-all text-right font-mono text-xs text-[var(--text-700)]">{outTradeNo || '-'}</span>
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <span className="text-[var(--text-500)]">应付金额</span>
              <span className="text-2xl font-bold text-[var(--state-error)]">¥{totalAmount || '0.00'}</span>
            </div>
          </div>

          {paid ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-[var(--state-success-text)]" />
              <p className="text-sm font-medium text-[var(--state-success-text)]">
                支付已确认（模拟）
              </p>
              <p className="text-xs text-[var(--text-500)]">
                原页面会自动确认结果，本窗口可关闭。
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={confirmPay}
              disabled={!ready || submitting}
              className="btn-cs btn-primary btn-md w-full disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="text-sm font-semibold">确认支付（模拟）</span>
              )}
            </button>
          )}

          {error && (
            <p className="text-sm text-[var(--state-error)]">{error}</p>
          )}

          {!ready && (
            <p className="text-center text-xs text-[var(--text-500)]">
              链接缺少 out_trade_no / total_amount 参数，请从订单支付页重新发起。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
