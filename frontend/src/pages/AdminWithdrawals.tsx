import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  CircleAlert,
  Inbox,
  Loader2,
  CheckCircle,
  XCircle,
  Banknote,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';

type WithdrawalRow = {
  id: string;
  amountCny: number;
  paymentMethod: 'ALIPAY' | 'WECHAT' | 'BANK';
  accountInfo: string;
  status: string;
  reviewNotes: string | null;
  transactionId: string | null;
  createdAt: string;
  user: { id: string; displayName: string | null; phone: string | null } | null;
};

const methodLabel: Record<string, string> = {
  ALIPAY: '支付宝',
  WECHAT: '微信',
  BANK: '银行转账',
};

const statusTabs = [
  { key: 'PENDING', label: '待审核' },
  { key: 'APPROVED', label: '待打款' },
  { key: 'COMPLETED', label: '已完成' },
  { key: 'REJECTED', label: '已拒绝' },
  { key: '', label: '全部' },
];

const statusBadge: Record<string, string> = {
  PENDING:
    'bg-[var(--state-warning-surface)] text-[var(--state-warning)] border border-yellow-500/20',
  APPROVED:
    'bg-[var(--brand-50)] text-[var(--brand-600)] border border-blue-500/20',
  PROCESSING: 'bg-purple-500/10 text-purple-500 border border-purple-500/20',
  COMPLETED:
    'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border border-[#bde9c9]',
  REJECTED: 'bg-red-500/10 text-[var(--state-error)] border border-red-500/20',
  FAILED: 'bg-red-500/10 text-[var(--state-error)] border border-red-500/20',
};

const statusLabel: Record<string, string> = {
  PENDING: '待审核',
  APPROVED: '已批准',
  PROCESSING: '打款中',
  COMPLETED: '已完成',
  REJECTED: '已拒绝',
  FAILED: '失败',
};

const cny = (v: number) => `¥${(v / 100).toFixed(2)}`;

export default function AdminWithdrawals() {
  const { admin, adminToken } = useAuthStore();
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 每行操作输入：审核备注 / 打款交易单号
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [txnById, setTxnById] = useState<Record<string, string>>({});
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/balance/admin/withdrawals${status ? `?status=${status}` : ''}`,
        { headers: { Authorization: `Bearer ${adminToken}` } },
      );
      if (res.ok) {
        const data = await res.json();
        setRows(data.data || []);
      } else {
        setError('获取提现列表失败');
      }
    } catch {
      setError('获取提现列表失败');
    } finally {
      setLoading(false);
    }
  }, [adminToken, status]);

  useEffect(() => {
    if (admin) load();
  }, [admin, load]);

  if (!admin) return <Navigate to="/login" replace />;

  const review = async (row: WithdrawalRow, approved: boolean) => {
    setActingId(row.id);
    setMsg(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/balance/admin/withdrawals/${row.id}/review`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            approved,
            notes: notesById[row.id]?.trim() || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data?.message || '审核操作失败' });
        return;
      }
      setMsg({
        ok: true,
        text: approved
          ? `已批准 ${cny(row.amountCny)} 提现，请线下打款后回填交易单号`
          : '已拒绝该提现申请，冻结金额已解冻',
      });
      load();
    } catch {
      setMsg({ ok: false, text: '审核请求失败，请重试' });
    } finally {
      setActingId(null);
    }
  };

  const complete = async (row: WithdrawalRow) => {
    const txn = txnById[row.id]?.trim();
    if (!txn) {
      setMsg({ ok: false, text: '请先填写支付宝/银行转账流水单号' });
      return;
    }
    setActingId(row.id);
    setMsg(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/balance/admin/withdrawals/${row.id}/complete`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ transactionId: txn }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data?.message || '完成打款操作失败' });
        return;
      }
      setMsg({ ok: true, text: '提现已标记完成' });
      load();
    } catch {
      setMsg({ ok: false, text: '完成打款请求失败，请重试' });
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={Banknote}
        eyebrow="资金管理"
        title="提现审核"
        description="审核用户余额提现申请：批准后线下转账打款，再回填交易单号完成闭环；拒绝后冻结金额自动解冻。"
      />

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
            <CircleAlert className="h-4 w-4 shrink-0" />
          )}
          {msg.text}
        </div>
      )}

      {/* 状态过滤 */}
      <div className="flex w-full gap-1 overflow-x-auto rounded-xl bg-[var(--background-100)] p-1 sm:w-fit">
        {statusTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-4 text-sm font-medium transition-colors sm:flex-none ${
              status === t.key
                ? 'bg-white text-[var(--brand-700)] shadow-sm'
                : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--brand-600)]" />
        </div>
      ) : error ? (
        <p className="text-sm text-[var(--state-error)]">{error}</p>
      ) : rows.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-[var(--text-500)]">
          <Inbox className="h-8 w-8" />
          <p className="text-sm">当前筛选下暂无提现记录</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-2xl border border-[color:var(--border)] bg-white p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-900)]">
                    {cny(row.amountCny)}
                    <span className="ml-2 text-xs font-normal text-[var(--text-500)]">
                      {methodLabel[row.paymentMethod] || row.paymentMethod}｜{row.accountInfo}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-400)]">
                    申请人：{row.user?.displayName || row.user?.phone || row.userId}
                    {row.user?.phone && row.user.displayName ? `（${row.user.phone}）` : ''}
                    ｜{new Date(row.createdAt).toLocaleString('zh-CN')}
                    {row.transactionId ? `｜流水号 ${row.transactionId}` : ''}
                  </p>
                  {row.reviewNotes && (
                    <p className="mt-1 text-xs text-[var(--state-warning)]">
                      备注：{row.reviewNotes}
                    </p>
                  )}
                </div>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    statusBadge[row.status] ||
                    'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]'
                  }`}
                >
                  {statusLabel[row.status] || row.status}
                </span>
              </div>

              {/* 操作区 */}
              {row.status === 'PENDING' && (
                <div className="mt-4 flex flex-col gap-2 border-t border-[color:var(--border)] pt-4 sm:flex-row">
                  <input
                    type="text"
                    value={notesById[row.id] || ''}
                    onChange={(e) =>
                      setNotesById((prev) => ({
                        ...prev,
                        [row.id]: e.target.value,
                      }))
                    }
                    placeholder="审核备注（可选，拒绝时建议填写原因）"
                    className="input-cs flex-1"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={actingId === row.id}
                      onClick={() => review(row, true)}
                      className="btn-cs btn-primary btn-sm flex-1 sm:flex-none"
                    >
                      {actingId === row.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4" />
                      )}
                      批准
                    </button>
                    <button
                      type="button"
                      disabled={actingId === row.id}
                      onClick={() => review(row, false)}
                      className="btn-cs btn-sm flex-1 border border-red-500/20 text-[var(--state-error)] hover:bg-red-500/5 sm:flex-none"
                    >
                      <XCircle className="h-4 w-4" />
                      拒绝
                    </button>
                  </div>
                </div>
              )}

              {row.status === 'APPROVED' && (
                <div className="mt-4 flex flex-col gap-2 border-t border-[color:var(--border)] pt-4 sm:flex-row">
                  <input
                    type="text"
                    value={txnById[row.id] || ''}
                    onChange={(e) =>
                      setTxnById((prev) => ({ ...prev, [row.id]: e.target.value }))
                    }
                    placeholder="线下打款后，填写支付宝转账单号 / 银行流水号"
                    className="input-cs flex-1"
                  />
                  <button
                    type="button"
                    disabled={actingId === row.id}
                    onClick={() => complete(row)}
                    className="btn-cs btn-primary btn-sm"
                  >
                    {actingId === row.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Banknote className="h-4 w-4" />
                    )}
                    确认打款完成
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
