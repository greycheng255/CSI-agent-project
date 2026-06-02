import { useCallback, useEffect, useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Loader2, DollarSign, CheckCircle2, RefreshCw, ExternalLink, User, Upload } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchOrders = useCallback(() => {
    setLoading(true);
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
        setLoading(false);
      });
  }, [apiBase, adminToken, activeTab]);

  useEffect(() => {
    if (!admin) {
      navigate('/admin/login');
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
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-2xl font-bold text-gray-200 flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-yellow-500" />
            放款管理
          </div>
          <div className="text-sm text-gray-500 mt-1">
            管理订单放款流程：审核已验收订单并放款给开发者。
          </div>
        </div>
        <button
          type="button"
          onClick={() => fetchOrders()}
          className="px-3 py-2 border border-gray-700 rounded text-sm text-gray-300 hover:border-gray-500 flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
          <div className="text-sm text-gray-500 mb-1">待放款订单</div>
          <div className="text-2xl font-bold text-yellow-400">
            {activeTab === 'pending' ? orders.length : '-'}
          </div>
        </div>
        <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
          <div className="text-sm text-gray-500 mb-1">当前列表总金额</div>
          <div className="text-2xl font-bold text-green-400">
            ¥{totalAmount.toLocaleString()}
          </div>
        </div>
        <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
          <div className="text-sm text-gray-500 mb-1">平台服务费</div>
          <div className="text-2xl font-bold text-blue-400">
            ¥{orders.reduce((sum, o) => sum + (o.platformFeeCny || 0), 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* 标签切换 */}
      <div className="flex gap-2 border-b border-gray-800">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'pending'
              ? 'text-yellow-400 border-b-2 border-yellow-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          待放款
          {activeTab === 'pending' && orders.length > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full text-xs">
              {orders.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'completed'
              ? 'text-green-400 border-b-2 border-green-400'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          已放款
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin mr-3 text-yellow-500" />
          加载中...
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 text-gray-500 border border-dashed border-gray-800 rounded-xl">
          {activeTab === 'pending' ? '暂无待放款订单' : '暂无已放款订单'}
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div
              key={order.id}
              className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6 hover:border-yellow-500/30 transition-colors"
            >
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                {/* 左侧信息 */}
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-gray-500">ORDER#{order.id.slice(0, 8)}</span>
                    {activeTab === 'pending' ? (
                      <span className="px-2 py-0.5 bg-yellow-500/10 text-yellow-400 rounded text-xs border border-yellow-500/20">
                        待放款
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-green-500/10 text-green-400 rounded text-xs border border-green-500/20 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        已放款
                      </span>
                    )}
                    <Link
                      to={`/orders/${order.id}`}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      查看详情
                    </Link>
                  </div>

                  <h3 className="font-bold text-lg text-gray-200">
                    {order.task?.title || '无标题'}
                  </h3>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 block text-xs mb-1">雇主</span>
                      <span className="text-gray-300 flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {order.client?.phone || order.client?.id?.slice(0, 8) || '未知'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs mb-1">开发者</span>
                      <span className="text-blue-400 flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {order.bid?.agent?.owner?.phone || order.bid?.agent?.owner?.displayName || '未知'}
                      </span>
                      {!order.bid?.agent?.paymentCodes?.length && (
                        <span className="text-xs text-red-400 ml-1">(未设置收款码)</span>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs mb-1">订单金额</span>
                      <span className="text-gray-300">¥{order.amountCny}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs mb-1">应放款</span>
                      <span className="text-green-400 font-bold">¥{order.payoutCny || order.amountCny}</span>
                    </div>
                  </div>

                  {/* 时间线 */}
                  <div className="flex flex-wrap gap-4 text-xs text-gray-500 pt-3 border-t border-gray-800">
                    <span>托管时间：{formatDate(order.escrowedAt)}</span>
                    <span>交付时间：{formatDate(order.deliveredAt)}</span>
                    <span>验收时间：{formatDate(order.acceptedAt)}</span>
                    {order.releasedAt && (
                      <span className="text-green-400">放款时间：{formatDate(order.releasedAt)}</span>
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
                      className="w-full px-4 py-2 bg-yellow-500 text-black font-bold rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
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
        </div>
      )}

      {/* 放款确认弹窗 */}
      {showReleaseModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0a0a0a] border border-gray-800 rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-200">确认放款</h3>
              <button
                onClick={() => setShowReleaseModal(null)}
                className="text-gray-500 hover:text-gray-300"
              >
                ✕
              </button>
            </div>

            {/* 步骤说明 */}
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-4">
              <p className="text-sm text-yellow-400">
                <strong>放款流程：</strong>请先使用您的支付工具向开发者转账，然后上传转账截图作为凭证，最后点击确认放款。
              </p>
            </div>

            <div className="space-y-4">
              {/* 开发者收款信息 */}
              <div className="border border-gray-800 rounded-lg p-4 bg-black/40">
                <h4 className="text-sm font-bold text-gray-300 mb-3">开发者收款信息</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">开发者</span>
                    <span className="text-gray-200">{showReleaseModal.bid?.agent?.owner?.phone || showReleaseModal.bid?.agent?.owner?.displayName || '未知'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">可用收款方式</span>
                    <span className="text-gray-200">
                      {showReleaseModal.bid?.agent?.paymentCodes && showReleaseModal.bid.agent.paymentCodes.length > 0
                        ? showReleaseModal.bid.agent.paymentCodes.map(c => 
                            c.type === 'alipay' ? '支付宝' : 
                            c.type === 'wechat' ? '微信' : c.type
                          ).join('、')
                        : '未设置'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">应放款金额</span>
                    <span className="text-green-400 font-bold text-lg">
                      ¥{showReleaseModal.payoutCny || showReleaseModal.amountCny}
                    </span>
                  </div>
                </div>

                {/* 收款码选择 */}
                {showReleaseModal.bid?.agent?.paymentCodes && showReleaseModal.bid.agent.paymentCodes.length > 0 ? (
                  <div className="mt-4 border-t border-gray-800 pt-4">
                    <span className="text-xs text-gray-500 block mb-2">选择收款码（点击选择）</span>
                    <div className="grid grid-cols-2 gap-3">
                      {showReleaseModal.bid.agent.paymentCodes.map((code) => (
                        <button
                          key={code.id}
                          type="button"
                          onClick={() => setSelectedPaymentCode(code)}
                          className={`border rounded-lg p-3 text-left transition-colors ${
                            selectedPaymentCode?.id === code.id
                              ? 'border-yellow-500 bg-yellow-500/10'
                              : 'border-gray-700 hover:border-gray-500'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-200">
                              {code.type === 'alipay' ? '支付宝' :
                               code.type === 'wechat' ? '微信支付' : code.type}
                            </span>
                            {code.isDefault && (
                              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">
                                默认
                              </span>
                            )}
                          </div>
                          {code.accountName && (
                            <p className="text-xs text-gray-500 mb-2">{code.accountName}</p>
                          )}
                          <img
                            src={code.qrCodeUrl}
                            alt="收款码"
                            className="w-full h-32 object-contain rounded bg-black/40"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 border-t border-gray-800 pt-4">
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                      <p className="text-sm text-red-400">
                        <strong>⚠️ 开发者未设置收款码</strong>
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        该开发者尚未在"我的收款码"页面上传收款码。请提醒开发者上传收款码后再进行放款操作。
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* 转账截图上传 */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  转账截图 <span className="text-red-400">*</span>
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
                    className="w-full border-2 border-dashed border-gray-700 rounded-lg p-8 flex flex-col items-center justify-center text-gray-500 hover:border-gray-500 hover:text-gray-400 transition-colors"
                  >
                    <Upload className="w-8 h-8 mb-2" />
                    <span className="text-sm">点击上传转账截图</span>
                    <span className="text-xs text-gray-600 mt-1">支持 JPG、PNG 格式</span>
                  </button>
                ) : (
                  <div className="relative border border-gray-700 rounded-lg p-2">
                    <img
                      src={transferScreenshot}
                      alt="转账截图"
                      className="max-w-full max-h-48 object-contain rounded mx-auto"
                    />
                    <button
                      type="button"
                      onClick={() => setTransferScreenshot(null)}
                      className="absolute top-2 right-2 px-2 py-1 bg-red-500/80 text-white text-xs rounded hover:bg-red-500"
                    >
                      重新上传
                    </button>
                  </div>
                )}
              </div>

              {/* 交易流水号 */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">交易流水号（可选）</label>
                <input
                  type="text"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  placeholder="请输入转账交易号"
                  className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2 text-gray-200 focus:outline-none focus:border-yellow-500 text-sm"
                />
              </div>

              {/* 备注 */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">备注（可选）</label>
                <textarea
                  value={releaseNotes}
                  onChange={(e) => setReleaseNotes(e.target.value)}
                  placeholder="转账备注或其他说明"
                  rows={2}
                  className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2 text-gray-200 focus:outline-none focus:border-yellow-500 text-sm resize-none"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowReleaseModal(null)}
                className="flex-1 px-4 py-2 border border-gray-700 text-gray-300 rounded-lg hover:border-gray-500"
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
                className="flex-1 px-4 py-2 bg-yellow-500 text-black font-bold rounded-lg hover:bg-yellow-400 disabled:opacity-50 flex justify-center items-center gap-2"
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
