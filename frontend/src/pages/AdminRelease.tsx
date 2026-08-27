import { useCallback, useEffect, useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { CircleAlert, Inbox, Loader2, DollarSign, CheckCircle2, RefreshCw, ExternalLink, User, Upload, X } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import { WorkbenchPageHeader, WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';

type OrderStatus = 'PENDING_RELEASE' | 'COMPLETED';

type PaymentCode = {
  id: string;
  qrCodeUrl: string;
  type: string;
  accountName: string | null;
  isDefault: boolean;
};

type OrderItem = {
  id: string;
  status: OrderStatus;
  amountCny: number;
  platformFeeCny?: number | null;
  payoutCny?: number | null;
  createdAt: string;
  escrowedAt?: string | null;
  deliveredAt?: string | null;
  acceptedAt?: string | null;
  releasedAt?: string | null;
  task?: {
    id: string;
    title?: string;
  };
  client?: {
    id: string;
    phone?: string;
  };
  bid?: {
    agent?: {
      id: string;
      name?: string;
      owner?: {
        id: string;
        phone?: string;
        displayName?: string;
      };
      paymentQrUrl?: string | null;
      paymentQrType?: string | null;
      paymentAccount?: string | null;
      paymentCodes?: PaymentCode[];
    };
    priceCny?: number;
  };
};

export default function AdminRelease() {
  const { admin, adminToken } = useAuthStore();
  const navigate = useNavigate();
  const apiBase = API_BASE;

  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [showReleaseModal, setShowReleaseModal] = useState<OrderItem | null>(null);
  const [selectedPaymentCode, setSelectedPaymentCode] = useState<PaymentCode | null>(null);
  const [transferScreenshot, setTransferScreenshot] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchOrders = useCallback(() => {
    setLoading(true);
    setError('');
    const status = activeTab === 'pending' ? 'PENDING_RELEASE' : 'COMPLETED';
    fetch(`${apiBase}/api/v1/orders?status=${status}`, {
      headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined,
    })
      .then((r) => r.json())
      .then((data) => {
        setOrders(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setOrders([]);
        setError('放款订单暂时无法加载，请检查服务状态后重试。');
        setLoading(false);
      });
  }, [apiBase, adminToken, activeTab]);

  useEffect(() => {
    if (!admin) {
      navigate('/login');
      return;
    }
    fetchOrders();
  }, [fetchOrders, navigate, admin]);

  const handleReleaseWithProof = async (orderId: string) => {
    if (!admin || !adminToken) return;

    setActingId(orderId);
    try {
      const res = await fetch(`${apiBase}/api/v1/orders/${orderId}/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          adminUserId: admin.id,
          transactionId: transactionId || undefined,
          notes: releaseNotes || undefined,
          transferScreenshot: transferScreenshot || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.message || '放款失败');
      } else {
        alert('放款成功！');
        setShowReleaseModal(null);
        setTransferScreenshot(null);
        setTransactionId('');
        setReleaseNotes('');
      }
    } finally {
      setActingId(null);
      fetchOrders();
    }
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  const totalAmount = orders.reduce((sum, o) => sum + (o.payoutCny || o.amountCny), 0);

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={DollarSign}
        eyebrow="放款管理"
        title="订单资金放款"
        description="核对已验收订单、开发者收款信息与转账凭证，完成平台资金放款。"
        actions={<button type="button" onClick={() => fetchOrders()} disabled={loading} className="btn-cs btn-ghost-dark btn-sm disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新列表</button>}
      />

      {/* 统计卡片 */}
      <section className="grid grid-cols-1 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white divide-y divide-[color:var(--border)] md:grid-cols-3 md:divide-x md:divide-y-0">
        <div className="p-5">
          <div className="mb-1 text-sm text-[var(--text-500)]">待放款订单</div>
          <div className="text-2xl font-bold text-[var(--text-900)]">
            {activeTab === 'pending' ? orders.length : '-'}
          </div>
        </div>
        <div className="p-5">
          <div className="mb-1 text-sm text-[var(--text-500)]">当前列表总金额</div>
          <div className="text-2xl font-bold text-[var(--text-900)]">
            ¥{totalAmount.toLocaleString()}
          </div>
        </div>
        <div className="p-5">
          <div className="mb-1 text-sm text-[var(--text-500)]">平台服务费</div>
          <div className="text-2xl font-bold text-[var(--text-900)]">
            ¥{orders.reduce((sum, o) => sum + (o.platformFeeCny || 0), 0).toLocaleString()}
          </div>
        </div>
      </section>

      {/* 标签切换 */}
      <div className="flex gap-1 rounded-xl bg-[var(--background-100)] p-1">
        <button
          onClick={() => setActiveTab('pending')}
          className={`min-h-10 rounded-lg px-4 text-sm font-medium transition-colors ${
            activeTab === 'pending'
              ? 'bg-white text-[var(--brand-700)] shadow-sm'
              : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
          }`}
        >
          待放款
          {activeTab === 'pending' && orders.length > 0 && (
            <span className="ml-2 rounded-full bg-[var(--brand-50)] px-2 py-0.5 text-xs text-[var(--brand-700)]">
              {orders.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`min-h-10 rounded-lg px-4 text-sm font-medium transition-colors ${
            activeTab === 'completed'
              ? 'bg-white text-[var(--brand-700)] shadow-sm'
              : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
          }`}
        >
          已放款
        </button>
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white text-sm text-[var(--text-500)]">
          <Loader2 className="mr-3 h-5 w-5 animate-spin text-[var(--brand-500)]" />
          加载中...
        </div>
      ) : error ? (
        <WorkbenchStatePanel icon={CircleAlert} title="放款订单暂时无法加载" description={error} tone="error" action={<button type="button" onClick={() => fetchOrders()} className="btn-cs btn-primary btn-sm">重新加载</button>} />
      ) : orders.length === 0 ? (
        <WorkbenchStatePanel icon={Inbox} title={activeTab === 'pending' ? '暂无待放款订单' : '暂无已放款订单'} description={activeTab === 'pending' ? '已验收并等待平台放款的订单会显示在这里。' : '完成放款后，可在这里查询历史记录。'} />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white divide-y divide-[color:var(--border)]">
          {orders.map((order) => (
            <div
              key={order.id}
              className="p-5 transition-colors hover:bg-[var(--background-100)]"
            >
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                {/* 左侧信息 */}
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-[var(--text-400)]">ORDER#{order.id.slice(0, 8)}</span>
                    {activeTab === 'pending' ? (
                      <span className="rounded-full border border-[#f3d79a] bg-[var(--state-warning-surface)] px-2.5 py-1 text-xs text-[var(--state-warning)]">
                        待放款
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded-full border border-[#bde9c9] bg-[var(--state-success-surface)] px-2.5 py-1 text-xs text-[var(--state-success-text)]">
                        <CheckCircle2 className="w-3 h-3" />
                        已放款
                      </span>
                    )}
                    <Link
                      to={`/orders/${order.id}`}
                      className="flex items-center gap-1 text-xs font-medium text-[var(--brand-600)] hover:text-[var(--brand-700)]"
                    >
                      <ExternalLink className="w-3 h-3" />
                      查看详情
                    </Link>
                  </div>

                  <h3 className="text-base font-semibold text-[var(--text-900)]">
                    {order.task?.title || '无标题'}
                  </h3>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="mb-1 block text-xs text-[var(--text-400)]">雇主</span>
                      <span className="flex items-center gap-1 text-[var(--text-700)]">
                        <User className="w-3 h-3" />
                        {order.client?.phone || order.client?.id?.slice(0, 8) || '未知'}
                      </span>
                    </div>
                    <div>
                      <span className="mb-1 block text-xs text-[var(--text-400)]">开发者</span>
                      <span className="flex items-center gap-1 text-[var(--text-700)]">
                        <User className="w-3 h-3" />
                        {order.bid?.agent?.owner?.phone || order.bid?.agent?.owner?.displayName || '未知'}
                      </span>
                      {!order.bid?.agent?.paymentCodes?.length && (
                        <span className="ml-1 text-xs text-[var(--state-error)]">(未设置收款码)</span>
                      )}
                    </div>
                    <div>
                      <span className="mb-1 block text-xs text-[var(--text-400)]">订单金额</span>
                      <span className="text-[var(--text-700)]">¥{order.amountCny}</span>
                    </div>
                    <div>
                      <span className="mb-1 block text-xs text-[var(--text-400)]">应放款</span>
                      <span className="font-bold text-[var(--text-900)]">¥{order.payoutCny || order.amountCny}</span>
                    </div>
                  </div>

                  {/* 时间线 */}
                  <div className="flex flex-wrap gap-4 border-t border-[color:var(--border)] pt-3 text-xs text-[var(--text-500)]">
                    <span>托管时间：{formatDate(order.escrowedAt)}</span>
                    <span>交付时间：{formatDate(order.deliveredAt)}</span>
                    <span>验收时间：{formatDate(order.acceptedAt)}</span>
                    {order.releasedAt && (
                      <span className="text-[var(--state-success-text)]">放款时间：{formatDate(order.releasedAt)}</span>
                    )}
                  </div>
                </div>

                {/* 右侧操作 */}
                {activeTab === 'pending' && (
                  <div className="flex flex-col gap-2 min-w-[140px]">
                    <button
                      type="button"
                      onClick={() => {
                        setShowReleaseModal(order);
                        // 自动选择默认收款码，如果没有默认则选择第一个
                        const codes = order.bid?.agent?.paymentCodes || [];
                        const defaultCode = codes.find(c => c.isDefault) || codes[0] || null;
                        setSelectedPaymentCode(defaultCode);
                        setTransferScreenshot(null);
                        setTransactionId('');
                        setReleaseNotes('');
                      }}
                      disabled={actingId === order.id}
                      className="btn-cs btn-primary btn-sm w-full disabled:opacity-50"
                    >
                      {actingId === order.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <DollarSign className="w-4 h-4" />
                          确认放款
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 放款确认弹窗 */}
      {showReleaseModal && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-labelledby="release-dialog-title">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[color:var(--border)] bg-white p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 id="release-dialog-title" className="text-lg font-semibold text-[var(--text-900)]">确认放款</h3>
              <button
                type="button"
                onClick={() => setShowReleaseModal(null)}
                aria-label="关闭放款确认弹窗"
                className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-500)] hover:bg-[var(--background-100)] hover:text-[var(--text-800)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 步骤说明 */}
            <div className="mb-4 rounded-xl border border-[#f3d79a] bg-[var(--state-warning-surface)] p-3">
              <p className="text-sm text-[var(--state-warning)]">
                <strong>放款流程：</strong>请先使用您的支付工具向开发者转账，然后上传转账截图作为凭证，最后点击确认放款。
              </p>
            </div>

            <div className="space-y-4">
              {/* 开发者收款信息 */}
              <div className="rounded-xl border border-[color:var(--border)] p-4">
                <h4 className="mb-3 text-sm font-semibold text-[var(--text-800)]">开发者收款信息</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-500)]">开发者</span>
                    <span className="text-[var(--text-800)]">{showReleaseModal.bid?.agent?.owner?.phone || showReleaseModal.bid?.agent?.owner?.displayName || '未知'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-500)]">可用收款方式</span>
                    <span className="text-[var(--text-800)]">
                      {showReleaseModal.bid?.agent?.paymentCodes && showReleaseModal.bid.agent.paymentCodes.length > 0
                        ? showReleaseModal.bid.agent.paymentCodes.map(c => 
                            c.type === 'alipay' ? '支付宝' : 
                            c.type === 'wechat' ? '微信' : c.type
                          ).join('、')
                        : '未设置'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-500)]">应放款金额</span>
                    <span className="text-lg font-bold text-[var(--text-900)]">
                      ¥{showReleaseModal.payoutCny || showReleaseModal.amountCny}
                    </span>
                  </div>
                </div>

                {/* 收款码选择 */}
                {showReleaseModal.bid?.agent?.paymentCodes && showReleaseModal.bid.agent.paymentCodes.length > 0 ? (
                  <div className="mt-4 border-t border-[color:var(--border)] pt-4">
                    <span className="text-xs text-[var(--text-500)] block mb-2">选择收款码（点击选择）</span>
                    <div className="grid grid-cols-2 gap-3">
                      {showReleaseModal.bid.agent.paymentCodes.map((code) => (
                        <button
                          key={code.id}
                          type="button"
                          onClick={() => setSelectedPaymentCode(code)}
                          className={`border rounded-lg p-3 text-left transition-colors ${
                            selectedPaymentCode?.id === code.id
                              ? 'border-[var(--brand-400)] bg-[var(--brand-50)]'
                              : 'border-[color:var(--border)] hover:border-[var(--brand-300)]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-[var(--text-800)]">
                              {code.type === 'alipay' ? '支付宝' :
                               code.type === 'wechat' ? '微信支付' : code.type}
                            </span>
                            {code.isDefault && (
                              <span className="rounded bg-[var(--state-warning-surface)] px-1.5 py-0.5 text-xs text-[var(--state-warning)]">
                                默认
                              </span>
                            )}
                          </div>
                          {code.accountName && (
                            <p className="text-xs text-[var(--text-500)] mb-2">{code.accountName}</p>
                          )}
                          <img
                            loading="lazy"
                            src={code.qrCodeUrl}
                            alt="收款码"
                            className="h-32 w-full rounded bg-[var(--background-100)] object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 border-t border-[color:var(--border)] pt-4">
                    <div className="bg-[var(--state-error-surface)] border border-[#ffc6c1] rounded-lg p-3">
                      <p className="text-sm text-[var(--state-error)]">
                        <strong>⚠️ 开发者未设置收款码</strong>
                      </p>
                      <p className="text-xs text-[var(--text-500)] mt-1">
                        该开发者尚未在"我的收款码"页面上传收款码。请提醒开发者上传收款码后再进行放款操作。
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* 转账截图上传 */}
              <div>
                <label className="mb-2 block text-sm text-[var(--text-600)]">
                  转账截图 <span className="text-[var(--state-error)]">*</span>
                </label>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        setTransferScreenshot(event.target?.result as string);
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                />
                {!transferScreenshot ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-[color:var(--border)] p-8 text-[var(--text-500)] transition-colors hover:border-[var(--brand-300)] hover:text-[var(--brand-600)]"
                  >
                    <Upload className="w-8 h-8 mb-2" />
                    <span className="text-sm">点击上传转账截图</span>
                    <span className="text-xs text-[var(--text-500)] mt-1">支持 JPG、PNG 格式</span>
                  </button>
                ) : (
                  <div className="relative rounded-xl border border-[color:var(--border)] p-2">
                    <img
                      loading="lazy"
                      src={transferScreenshot}
                      alt="转账截图"
                      className="max-w-full max-h-48 object-contain rounded mx-auto"
                    />
                    <button
                      type="button"
                      onClick={() => setTransferScreenshot(null)}
                      className="absolute top-2 right-2 px-2 py-1 bg-[var(--state-error)] text-white text-xs rounded hover:bg-[var(--state-error-dark)]"
                    >
                      重新上传
                    </button>
                  </div>
                )}
              </div>

              {/* 交易流水号 */}
              <div>
                <label className="mb-2 block text-sm text-[var(--text-600)]">交易流水号（可选）</label>
                <input
                  type="text"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  placeholder="请输入转账交易号"
                  className="field-input"
                />
              </div>

              {/* 备注 */}
              <div>
                <label className="mb-2 block text-sm text-[var(--text-600)]">备注（可选）</label>
                <textarea
                  value={releaseNotes}
                  onChange={(e) => setReleaseNotes(e.target.value)}
                  placeholder="转账备注或其他说明"
                  rows={2}
                  className="field-input resize-none"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowReleaseModal(null)}
                className="min-h-11 flex-1 rounded-full border border-[color:var(--border)] px-4 text-sm font-medium text-[var(--text-600)] hover:border-[var(--brand-300)]"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (!transferScreenshot) {
                    alert('请上传转账截图');
                    return;
                  }
                  handleReleaseWithProof(showReleaseModal.id);
                }}
                disabled={actingId === showReleaseModal.id || !transferScreenshot}
                className="btn-cs btn-primary btn-sm flex-1 disabled:opacity-50"
              >
                {actingId === showReleaseModal.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    确认已转账并放款
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
