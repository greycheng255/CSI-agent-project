import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  CheckCircle,
  Clock,
  AlertCircle,
  History,
  Landmark,
  Smartphone,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

type BalanceView = {
  availableCny: number;
  frozenCny: number;
  totalIncomeCny: number;
  totalWithdrawalCny: number;
};

type BalanceRecordView = {
  id: string;
  amountCny: number;
  beforeBalanceCny: number;
  afterBalanceCny: number;
  changeType: string;
  description: string | null;
  createdAt: string;
};

type WithdrawalView = {
  id: string;
  amountCny: number;
  paymentMethod: 'ALIPAY' | 'WECHAT' | 'BANK';
  accountInfo: string;
  status: string;
  reviewNotes: string | null;
  createdAt: string;
};

type RechargeView = {
  rechargeId: string;
  outTradeNo: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  amountCny: number;
  paidAt: string | null;
  expiresAt: string;
};

const fen = (yuan: string): number | null => {
  const value = Number.parseFloat(yuan);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
};

const cny = (v: number) => `¥${(v / 100).toFixed(2)}`;

const changeTypeLabel: Record<string, string> = {
  ORDER_INCOME: '订单收入',
  REFUND: '退款',
  DEPOSIT: '充值',
  WITHDRAWAL: '提现',
  PLATFORM_FEE: '平台服务费',
  PENALTY: '违约扣款',
};

const withdrawalStatusView: Record<
  string,
  { label: string; badge: string }
> = {
  PENDING: {
    label: '待审核',
    badge: 'bg-[var(--state-warning-surface)] text-[var(--state-warning)] border border-yellow-500/20',
  },
  APPROVED: {
    label: '已批准',
    badge: 'bg-[var(--brand-50)] text-[var(--brand-600)] border border-blue-500/20',
  },
  PROCESSING: {
    label: '打款中',
    badge: 'bg-purple-500/10 text-purple-500 border border-purple-500/20',
  },
  COMPLETED: {
    label: '已完成',
    badge: 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border border-[#bde9c9]',
  },
  REJECTED: {
    label: '已拒绝',
    badge: 'bg-red-500/10 text-[var(--state-error)] border border-red-500/20',
  },
  FAILED: {
    label: '失败',
    badge: 'bg-red-500/10 text-[var(--state-error)] border border-red-500/20',
  },
};

const methodLabel: Record<string, string> = {
  ALIPAY: '支付宝',
  WECHAT: '微信',
  BANK: '银行转账',
};

const methodIcon: Record<string, React.ReactNode> = {
  ALIPAY: <Wallet className="h-4 w-4" />,
  WECHAT: <Smartphone className="h-4 w-4" />,
  BANK: <Landmark className="h-4 w-4" />,
};

export default function MyBalance({ embedded }: { embedded?: boolean }) {
  const { token } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();

  const [balance, setBalance] = useState<BalanceView | null>(null);
  const [records, setRecords] = useState<BalanceRecordView[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalView[]>([]);
  const [loading, setLoading] = useState(true);

  // 充值表单
  const [rechargeYuan, setRechargeYuan] = useState('');
  const [rechargeSubmitting, setRechargeSubmitting] = useState(false);

  // 提现表单
  const [withdrawYuan, setWithdrawYuan] = useState('');
  const [withdrawMethod, setWithdrawMethod] = useState<
    'ALIPAY' | 'WECHAT' | 'BANK'
  >('ALIPAY');
  const [withdrawAccount, setWithdrawAccount] = useState('');
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 支付宝回跳后的充值单轮询
  const [pollingRechargeId, setPollingRechargeId] = useState<string | null>(
    null,
  );
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const loadAll = useCallback(async () => {
    try {
      const [balanceRes, recordsRes, withdrawalsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/balance/my`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/v1/balance/records?limit=30`, {
          headers: authHeaders,
        }),
        fetch(`${API_BASE}/api/v1/balance/withdrawals`, {
          headers: authHeaders,
        }),
      ]);
      if (balanceRes.ok) setBalance((await balanceRes.json()).data);
      if (recordsRes.ok) setRecords((await recordsRes.json()).data || []);
      if (withdrawalsRes.ok)
        setWithdrawals((await withdrawalsRes.json()).data || []);
    } catch {
      setMsg({ ok: false, text: '加载余额数据失败，请刷新重试' });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 回跳轮询：?tab=balance&payment=returned&recharge=<id>
  useEffect(() => {
    const rechargeId = searchParams.get('recharge');
    if (!rechargeId || searchParams.get('payment') !== 'returned') return;
    setPollingRechargeId(rechargeId);

    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/balance/recharge/${rechargeId}?refresh=true`,
          { headers: authHeaders },
        );
        if (res.ok) {
          const { data } = (await res.json()) as { data: RechargeView };
          if (data.status === 'PAID') {
            setMsg({ ok: true, text: `充值成功 ${cny(data.amountCny)}，已入账` });
            setPollingRechargeId(null);
            setSearchParams({}, { replace: true });
            loadAll();
            return;
          }
          if (data.status === 'FAILED') {
            setMsg({ ok: false, text: '充值单已失效或未完成支付' });
            setPollingRechargeId(null);
            setSearchParams({}, { replace: true });
            loadAll();
            return;
          }
        }
      } catch {
        // 网络抖动时继续下一次轮询
      }
      if (attempts >= 40) {
        setMsg({
          ok: false,
          text: '充值到账确认超时，到账后流水会出现充值记录，无需重复支付',
        });
        setPollingRechargeId(null);
        setSearchParams({}, { replace: true });
        return;
      }
      pollTimer.current = setTimeout(poll, 3000);
    };

    poll();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleRecharge = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const amount = fen(rechargeYuan);
    if (amount == null || amount < 100) {
      setMsg({ ok: false, text: '充值金额最低 1 元' });
      return;
    }
    if (amount > 5_000_000) {
      setMsg({ ok: false, text: '单笔充值不可超过 50000 元' });
      return;
    }
    setRechargeSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/balance/recharge`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCny: amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data?.message || '创建充值单失败' });
        return;
      }
      if (data?.data?.paymentUrl) {
        window.location.href = data.data.paymentUrl as string;
      } else {
        setMsg({ ok: false, text: '未获取到支付宝收银台链接' });
      }
    } catch {
      setMsg({ ok: false, text: '充值请求失败，请重试' });
    } finally {
      setRechargeSubmitting(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const amount = fen(withdrawYuan);
    if (amount == null || amount < 10000) {
      setMsg({ ok: false, text: '最低提现金额为 100 元' });
      return;
    }
    if (!withdrawAccount.trim()) {
      setMsg({ ok: false, text: '请填写收款账号信息' });
      return;
    }
    setWithdrawSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/balance/withdrawals`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCny: amount,
          paymentMethod: withdrawMethod,
          accountInfo: withdrawAccount.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data?.message || '提现申请提交失败' });
        return;
      }
      setMsg({
        ok: true,
        text: '提现申请已提交，等待平台审核（金额已冻结）',
      });
      setWithdrawYuan('');
      setWithdrawAccount('');
      loadAll();
    } catch {
      setMsg({ ok: false, text: '提现请求失败，请重试' });
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--brand-600)]" />
      </div>
    );
  }

  return (
    <div className={embedded ? 'space-y-6' : 'mx-auto max-w-6xl space-y-6 p-6'}>
      {msg && (
        <div
          className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
            msg.ok
              ? 'border-[#bde9c9] bg-[var(--state-success-surface)] text-[var(--state-success-text)]'
              : 'border-[#ffc6c1] bg-[var(--state-error-surface)] text-[var(--state-error)]'
          }`}
        >
          {msg.ok ? (
            <CheckCircle className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {msg.text}
        </div>
      )}

      {pollingRechargeId && (
        <div className="flex items-center gap-2 rounded-xl border border-yellow-500/20 bg-[var(--state-warning-surface)] p-3 text-sm text-[var(--state-warning)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在与支付宝确认充值到账，请稍候…
        </div>
      )}

      {/* 余额卡片 */}
      <section className="rounded-2xl border border-[color:var(--border)] bg-white">
        <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-5 py-4">
          <Wallet className="h-4 w-4 text-[var(--brand-600)]" />
          <h3 className="text-sm font-semibold text-[var(--text-800)]">
            账户余额
          </h3>
        </div>
        <dl className="grid divide-y divide-[color:var(--border)] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <div className="py-4 sm:px-5 sm:first:pl-5">
            <dt className="text-xs text-[var(--text-500)]">可用余额</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text-900)]">
              {balance ? cny(balance.availableCny) : '¥0.00'}
            </dd>
          </div>
          <div className="py-4 sm:px-5">
            <dt className="text-xs text-[var(--text-500)]">冻结中</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--state-warning)]">
              {balance ? cny(balance.frozenCny) : '¥0.00'}
            </dd>
          </div>
          <div className="py-4 sm:px-5">
            <dt className="text-xs text-[var(--text-500)]">累计收入</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--brand-700)]">
              {balance ? cny(balance.totalIncomeCny) : '¥0.00'}
            </dd>
          </div>
          <div className="py-4 sm:px-5">
            <dt className="text-xs text-[var(--text-500)]">累计提现</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text-600)]">
              {balance ? cny(balance.totalWithdrawalCny) : '¥0.00'}
            </dd>
          </div>
        </dl>
      </section>

      {/* 充值 + 提现 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 充值表单 */}
        <section className="rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-5 py-4">
            <ArrowDownToLine className="h-4 w-4 text-[var(--brand-600)]" />
            <h3 className="text-sm font-semibold text-[var(--text-800)]">
              余额充值
            </h3>
          </div>
          <form onSubmit={handleRecharge} className="space-y-4 px-5 py-5">
            <div>
              <label className="text-xs font-medium text-[var(--text-600)]">
                充值金额（元）
              </label>
              <input
                type="number"
                min="1"
                max="50000"
                step="0.01"
                value={rechargeYuan}
                onChange={(e) => setRechargeYuan(e.target.value)}
                placeholder="1 ~ 50000"
                className="input-cs mt-1 w-full"
                required
              />
              <p className="mt-1 text-xs text-[var(--text-400)]">
                跳转支付宝收银台完成支付，支付成功后自动入账。
              </p>
            </div>
            <button
              type="submit"
              disabled={rechargeSubmitting}
              className="btn-cs btn-primary w-full"
            >
              {rechargeSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-4 w-4" />
              )}
              支付宝充值
            </button>
          </form>
        </section>

        {/* 提现表单 */}
        <section className="rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-5 py-4">
            <ArrowUpFromLine className="h-4 w-4 text-[var(--brand-600)]" />
            <h3 className="text-sm font-semibold text-[var(--text-800)]">
              申请提现
            </h3>
          </div>
          <form onSubmit={handleWithdraw} className="space-y-4 px-5 py-5">
            <div>
              <label className="text-xs font-medium text-[var(--text-600)]">
                提现金额（元，最低 100）
              </label>
              <input
                type="number"
                min="100"
                step="0.01"
                value={withdrawYuan}
                onChange={(e) => setWithdrawYuan(e.target.value)}
                placeholder={
                  balance ? `最多 ${cny(balance.availableCny)}` : '100'
                }
                className="input-cs mt-1 w-full"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-600)]">
                提现方式
              </label>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {(['ALIPAY', 'WECHAT', 'BANK'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setWithdrawMethod(m)}
                    className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
                      withdrawMethod === m
                        ? 'border-[var(--brand-600)] bg-[var(--brand-50)] text-[var(--brand-700)]'
                        : 'border-[color:var(--border)] text-[var(--text-500)] hover:text-[var(--text-800)]'
                    }`}
                  >
                    {methodIcon[m]}
                    {methodLabel[m]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-600)]">
                收款账号
              </label>
              {withdrawMethod === 'ALIPAY' && (
                <input
                  type="text"
                  value={withdrawAccount}
                  onChange={(e) => setWithdrawAccount(e.target.value)}
                  placeholder="支付宝手机号 / 邮箱"
                  className="input-cs mt-1 w-full"
                  required
                />
              )}
              {withdrawMethod === 'WECHAT' && (
                <input
                  type="text"
                  value={withdrawAccount}
                  onChange={(e) => setWithdrawAccount(e.target.value)}
                  placeholder="微信号 / 绑定手机号"
                  className="input-cs mt-1 w-full"
                  required
                />
              )}
              {withdrawMethod === 'BANK' && (
                <input
                  type="text"
                  value={withdrawAccount}
                  onChange={(e) => setWithdrawAccount(e.target.value)}
                  placeholder="开户行 + 户名 + 卡号"
                  className="input-cs mt-1 w-full"
                  required
                />
              )}
            </div>
            <button
              type="submit"
              disabled={withdrawSubmitting}
              className="btn-cs btn-primary w-full"
            >
              {withdrawSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUpFromLine className="h-4 w-4" />
              )}
              提交提现申请
            </button>
            <p className="text-xs text-[var(--text-400)]">
              提交后金额将冻结，平台审核通过后打款；最低提现 100 元。
            </p>
          </form>
        </section>
      </div>

      {/* 流水记录 */}
      <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
        <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-5 py-4">
          <History className="h-4 w-4 text-[var(--brand-600)]" />
          <h3 className="text-sm font-semibold text-[var(--text-800)]">
            余额流水
          </h3>
        </div>
        {records.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[var(--text-500)]">
            暂无流水记录
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {records.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-800)]">
                    {changeTypeLabel[r.changeType] || r.changeType}
                    {r.description ? (
                      <span className="ml-2 text-xs font-normal text-[var(--text-400)]">
                        {r.description}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-400)]">
                    {new Date(r.createdAt).toLocaleString('zh-CN')}
                    ｜余额 {cny(r.afterBalanceCny)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    r.amountCny >= 0
                      ? 'text-[var(--state-success-text)]'
                      : 'text-[var(--text-700)]'
                  }`}
                >
                  {r.amountCny >= 0 ? '+' : ''}
                  {cny(r.amountCny)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 提现记录 */}
      <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
        <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-5 py-4">
          <ArrowUpFromLine className="h-4 w-4 text-[var(--brand-600)]" />
          <h3 className="text-sm font-semibold text-[var(--text-800)]">
            我的提现记录
          </h3>
        </div>
        {withdrawals.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[var(--text-500)]">
            暂无提现记录
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {withdrawals.map((w) => {
              const view = withdrawalStatusView[w.status] || {
                label: w.status,
                badge:
                  'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
              };
              return (
                <li
                  key={w.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-800)]">
                      {methodLabel[w.paymentMethod] || w.paymentMethod}
                      <span className="ml-2 text-xs font-normal text-[var(--text-400)]">
                        {w.accountInfo}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-400)]">
                      {new Date(w.createdAt).toLocaleString('zh-CN')}
                      {w.reviewNotes ? `｜${w.reviewNotes}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums text-[var(--text-900)]">
                      {cny(w.amountCny)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${view.badge}`}
                    >
                      {w.status === 'PENDING' ? (
                        <Clock className="h-3 w-3" />
                      ) : w.status === 'COMPLETED' ? (
                        <CheckCircle className="h-3 w-3" />
                      ) : null}
                      {view.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
