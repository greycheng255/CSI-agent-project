import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { DollarSign, QrCode, Receipt, CreditCard, Wallet, Plus } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import PaymentCodes from './PaymentCodes';
import MyReceipts from './MyReceipts';
import MyPayments from './MyPayments';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';

type Tab = 'balance' | 'codes' | 'receipts' | 'payments';

interface BalanceData {
  availableCny: number;
  frozenCny: number;
  totalIncomeCny: number;
  totalWithdrawalCny: number;
}

interface BalanceRecord {
  id: string;
  amountCny: number;
  beforeBalanceCny: number;
  afterBalanceCny: number;
  changeType: string;
  orderId: string | null;
  withdrawalId: string | null;
  paymentId: string | null;
  description: string | null;
  createdAt: string;
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  ORDER_INCOME: '订单收入',
  REFUND: '退款',
  DEPOSIT: '充值',
  WITHDRAWAL: '提现',
  PLATFORM_FEE: '平台服务费',
  PENALTY: '罚款',
};

export default function FinanceManagement() {
  const { user, admin, token } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedTab = searchParams.get('tab');
  const activeTab: Tab =
    requestedTab === 'codes' || requestedTab === 'receipts' || requestedTab === 'payments' || requestedTab === 'balance'
      ? (requestedTab as Tab)
      : 'balance';

  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [records, setRecords] = useState<BalanceRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/balance/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (res.ok && payload.success) setBalance(payload.data);
    } catch {
      // ignore
    }
  }, [token]);

  const fetchRecords = useCallback(async () => {
    if (!token) return;
    setLoadingRecords(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/balance/records?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (res.ok && payload.success) setRecords(payload.data || []);
    } catch {
      // ignore
    } finally {
      setLoadingRecords(false);
    }
  }, [token]);

  useEffect(() => {
    fetchBalance();
    if (activeTab === 'balance') fetchRecords();
  }, [fetchBalance, fetchRecords, activeTab]);

  if (!user && !admin) return <Navigate to="/login" replace />;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'balance', label: '余额', icon: <Wallet className="w-4 h-4" /> },
    { key: 'codes', label: '收款码', icon: <QrCode className="w-4 h-4" /> },
    { key: 'receipts', label: '收款记录', icon: <Receipt className="w-4 h-4" /> },
    { key: 'payments', label: '支付记录', icon: <CreditCard className="w-4 h-4" /> },
  ];

  const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={DollarSign}
        eyebrow="我的收支"
        title="收支管理"
        description="管理余额、默认收款方式，并核对作为 Agent 所有者的收款与作为任务方的支付记录。"
      />

      {/* 余额概览卡 */}
      <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div>
            <p className="text-xs text-[var(--text-500)]">可用余额</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-900)]">
              {balance ? yuan(balance.availableCny) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-500)]">冻结余额</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-500)]">
              {balance ? yuan(balance.frozenCny) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-500)]">累计收入</p>
            <p className="mt-1 text-lg font-medium tabular-nums text-[var(--text-700)]">
              {balance ? yuan(balance.totalIncomeCny) : '—'}
            </p>
          </div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-[var(--text-500)]">累计提现</p>
              <p className="mt-1 text-lg font-medium tabular-nums text-[var(--text-700)]">
                {balance ? yuan(balance.totalWithdrawalCny) : '—'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/finance/recharge')}
              className="btn-cs btn-primary btn-sm shrink-0"
            >
              <Plus className="h-4 w-4" />充值
            </button>
          </div>
        </div>
      </section>

      {/* Tab 切换 */}
      <div className="flex w-full gap-1 overflow-x-auto rounded-xl bg-[var(--background-100)] p-1 sm:w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setSearchParams({ tab: t.key }, { replace: true })}
            className={`flex min-h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium transition-colors sm:flex-none ${
              activeTab === t.key ? 'bg-white text-[var(--brand-700)] shadow-sm' : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[400px]">
        {activeTab === 'balance' && (
          <BalanceRecords records={records} loading={loadingRecords} yuan={yuan} />
        )}
        {activeTab === 'codes' && <PaymentCodes embedded />}
        {activeTab === 'receipts' && <MyReceipts embedded />}
        {activeTab === 'payments' && <MyPayments embedded />}
      </div>
    </div>
  );
}

function BalanceRecords({
  records,
  loading,
  yuan,
}: {
  records: BalanceRecord[];
  loading: boolean;
  yuan: (fen: number) => string;
}) {
  if (loading) {
    return (
      <div className="h-64 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
    );
  }
  if (records.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-white px-6 py-12 text-center text-sm text-[var(--text-500)]">
        暂无余额变动记录
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-[color:var(--border)] bg-[var(--background-50)] text-left text-xs text-[var(--text-500)]">
          <tr>
            <th className="px-4 py-3 font-medium">时间</th>
            <th className="px-4 py-3 font-medium">类型</th>
            <th className="px-4 py-3 text-right font-medium">变动金额</th>
            <th className="px-4 py-3 text-right font-medium">变动后余额</th>
            <th className="px-4 py-3 font-medium">说明</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border)]">
          {records.map((r) => (
            <tr key={r.id} className="hover:bg-[var(--background-50)]">
              <td className="whitespace-nowrap px-4 py-3 text-[var(--text-500)]">
                {new Date(r.createdAt).toLocaleString('zh-CN')}
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex rounded-md bg-[var(--background-100)] px-2 py-0.5 text-xs font-medium text-[var(--text-600)]">
                  {CHANGE_TYPE_LABELS[r.changeType] || r.changeType}
                </span>
              </td>
              <td className={`px-4 py-3 text-right font-medium tabular-nums ${r.amountCny >= 0 ? 'text-[var(--state-success-text)]' : 'text-[var(--state-error)]'}`}>
                {r.amountCny >= 0 ? '+' : ''}{yuan(r.amountCny)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-[var(--text-700)]">
                {yuan(r.afterBalanceCny)}
              </td>
              <td className="max-w-xs truncate px-4 py-3 text-[var(--text-500)]" title={r.description || ''}>
                {r.description || '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
