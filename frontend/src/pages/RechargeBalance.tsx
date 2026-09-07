import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Wallet } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';
import { OnlineAlipayRecharge } from '../features/pay/components/OnlineAlipayRecharge';

const QUICK_AMOUNTS = [5000, 10000, 50000, 100000]; // 50/100/500/1000 元

export default function RechargeBalance() {
  const { token } = useAuthStore();
  const navigate = useNavigate();
  const [amountYuan, setAmountYuan] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (!token) return <Navigate to="/login" replace />;

  const yuan = Number(amountYuan);
  const valid = Number.isFinite(yuan) && yuan >= 1 && yuan <= 50000;
  const amountFen = valid ? Math.round(yuan * 100) : 0;

  const handleRecharge = () => {
    if (!valid) return;
    setSubmitted(true);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <WorkbenchPageHeader
        icon={Wallet}
        eyebrow="余额充值"
        title="充值余额"
        description="通过支付宝在线充值，支付成功后自动到账，可用于订单付款。"
        actions={
          <Link to="/finance" className="btn-cs btn-ghost-dark btn-sm">
            <ArrowLeft className="h-4 w-4" />
            返回收支管理
          </Link>
        }
      />

      {!submitted ? (
        <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="border-b border-[color:var(--border)] px-5 py-5 sm:px-6">
            <label htmlFor="recharge-amount" className="block text-sm font-medium text-[var(--text-700)]">
              充值金额（元）
            </label>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-2xl font-bold text-[var(--text-900)]">¥</span>
              <input
                id="recharge-amount"
                type="number"
                min="1"
                max="50000"
                step="0.01"
                value={amountYuan}
                onChange={(e) => setAmountYuan(e.target.value)}
                placeholder="请输入充值金额"
                className="flex-1 border-b-2 border-[var(--border)] bg-transparent py-1 text-2xl font-bold tabular-nums text-[var(--text-900)] outline-none focus:border-[var(--brand-500)]"
                autoFocus
              />
            </div>
            <p className="mt-2 text-xs text-[var(--text-500)]">
              单笔最低 1 元，最高 50000 元
            </p>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((fen) => (
                <button
                  key={fen}
                  type="button"
                  onClick={() => setAmountYuan((fen / 100).toString())}
                  className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-600)] transition-colors hover:border-[var(--brand-300)] hover:text-[var(--brand-600)]"
                >
                  ¥{(fen / 100).toFixed(0)}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-[color:var(--border)] px-5 py-5 sm:px-6">
            <button
              type="button"
              onClick={handleRecharge}
              disabled={!valid}
              className="btn-cs btn-primary btn-md w-full disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一步：前往支付宝充值
            </button>
          </div>
        </section>
      ) : (
        <>
          <OnlineAlipayRecharge
            amountCny={amountFen}
            token={token}
            onPaid={() => {
              setTimeout(() => navigate('/finance?tab=balance', { replace: true }), 1500);
            }}
          />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => {
                setSubmitted(false);
                setAmountYuan('');
              }}
              className="btn-cs btn-ghost-dark btn-sm"
            >
              重新输入金额
            </button>
          </div>
        </>
      )}
    </div>
  );
}
