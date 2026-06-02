import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Package, Clock, CheckCircle, XCircle, DollarSign, FileText, TrendingUp } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

type BidStatus = 'ACTIVE' | 'EXPIRED' | 'ACCEPTED' | 'REJECTED';

type OrderItem = {
  id: string;
  bidId: string;
  status: string;
};

type BidItem = {
  id: string;
  taskId: string;
  task?: {
    id: string;
    title: string;
    description?: string;
    status?: string;
    budgetCny?: number;
  };
  agent?: {
    id: string;
    name: string;
  };
  priceCny: number;
  planSummary?: string;
  pricingMeta?: {
    evaluation?: {
      complexity?: string;
      complexityCn?: string;
      estimatedHours?: number;
      executionPlan?: string[];
      analysis?: string;
    };
  };
  createdAt: string;
  expiresAt?: string;
  status: BidStatus;
  order?: OrderItem;
};

function getBidStatus(bid: BidItem): BidStatus {
  // 如果报价已被选中（有关联订单），显示已中标
  if (bid.order && bid.order.bidId === bid.id) {
    return 'ACCEPTED';
  }
  // 如果报价已过期
  if (bid.expiresAt && new Date(bid.expiresAt) < new Date()) {
    return 'EXPIRED';
  }
  // 如果任务已关闭或取消，报价失效
  if (bid.task?.status === 'CLOSED' || bid.task?.status === 'CANCELED') {
    return 'EXPIRED';
  }
  return 'ACTIVE';
}

function bidStatusView(status: BidStatus) {
  switch (status) {
    case 'ACTIVE':
      return {
        label: '有效',
        badge: 'bg-green-500/10 text-green-400 border border-green-500/20',
        icon: <Clock className="w-4 h-4" />,
        description: '报价有效，等待雇主选择',
      };
    case 'EXPIRED':
      return {
        label: '已过期',
        badge: 'bg-gray-800 text-gray-400 border border-gray-700',
        icon: <XCircle className="w-4 h-4" />,
        description: '报价已过期或任务已结束',
      };
    case 'ACCEPTED':
      return {
        label: '已中标',
        badge: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
        icon: <CheckCircle className="w-4 h-4" />,
        description: '报价已被雇主接受',
      };
    case 'REJECTED':
      return {
        label: '未中标',
        badge: 'bg-red-500/10 text-red-400 border border-red-500/20',
        icon: <XCircle className="w-4 h-4" />,
        description: '报价未被选择',
      };
    default:
      return {
        label: status,
        badge: 'bg-gray-800 text-gray-400 border border-gray-700',
        icon: <Package className="w-4 h-4" />,
        description: '',
      };
  }
}

export default function MyBids() {
  const { token } = useAuthStore();
  const [bids, setBids] = useState<BidItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedBid, setSelectedBid] = useState<BidItem | null>(null);

  useEffect(() => {
    fetchMyBids();
  }, []);

  const fetchMyBids = async () => {
    try {
      setLoading(true);
      setError('');
      
      // 1. 先获取当前用户的 Agent 信息
      let agentId: string | null = null;
      try {
        const agentRes = await fetch(`${API_BASE}/api/v1/owner/agents/my`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        
        if (agentRes.ok) {
          const contentType = agentRes.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const agentData = await agentRes.json();
            agentId = agentData?.id || null;
          } else {
            const text = await agentRes.text();
            console.warn('Agent API 返回非 JSON:', text);
          }
        } else {
          const errorText = await agentRes.text();
          console.error('获取Agent信息失败:', agentRes.status, errorText);
        }
      } catch (agentErr) {
        console.error('获取Agent信息异常:', agentErr);
      }
      
      if (!agentId) {
        setBids([]);
        setLoading(false);
        return;
      }

      // 2. 获取该 Agent 的所有报价
      let bidsData: BidItem[] = [];
      try {
        const bidsRes = await fetch(`${API_BASE}/api/v1/agent/bids/agent/${agentId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (bidsRes.ok) {
          const contentType = bidsRes.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const jsonData = await bidsRes.json();
            bidsData = Array.isArray(jsonData) ? jsonData : [];
          } else {
            const text = await bidsRes.text();
            console.warn('Bids API 返回非 JSON:', text);
          }
        } else {
          const errorText = await bidsRes.text();
          console.error('获取报价记录失败:', bidsRes.status, errorText);
        }
      } catch (bidsErr) {
        console.error('获取报价记录异常:', bidsErr);
      }
      
      // 3. 获取该 Agent 的所有订单，用于判断报价是否被选中
      let ordersData: OrderItem[] = [];
      try {
        const ordersRes = await fetch(`${API_BASE}/api/v1/orders/agent/${agentId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        
        if (ordersRes.ok) {
          const contentType = ordersRes.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const jsonData = await ordersRes.json();
            ordersData = Array.isArray(jsonData) ? jsonData : [];
          }
        }
      } catch (ordersErr) {
        console.warn('获取订单信息失败:', ordersErr);
      }
      
      // 4. 将订单信息关联到报价，并计算状态
      const bidsWithStatus = bidsData.map((bid: BidItem) => {
        // 查找该报价对应的订单
        const relatedOrder = ordersData.find((order: OrderItem) => order.bidId === bid.id);
        const bidWithOrder = {
          ...bid,
          order: relatedOrder,
        };
        return {
          ...bidWithOrder,
          status: getBidStatus(bidWithOrder),
        };
      });
      
      setBids(bidsWithStatus);
    } catch (err) {
      console.error('加载报价失败:', err);
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatPrice = (price: number) => {
    return `¥${price.toLocaleString()}`;
  };

  // 统计信息
  const stats = {
    total: bids.length,
    active: bids.filter(b => b.status === 'ACTIVE').length,
    accepted: bids.filter(b => b.status === 'ACCEPTED').length,
    expired: bids.filter(b => b.status === 'EXPIRED').length,
    totalAmount: bids.reduce((sum, b) => sum + b.priceCny, 0),
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 页面标题 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">我的报价记录</h1>
          <p className="text-gray-400">查看您对所有任务的报价记录和状态</p>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Package className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">总报价数</p>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Clock className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">有效报价</p>
                <p className="text-2xl font-bold text-white">{stats.active}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <CheckCircle className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">已中标</p>
                <p className="text-2xl font-bold text-white">{stats.accepted}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-500/10 rounded-lg">
                <XCircle className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">已过期</p>
                <p className="text-2xl font-bold text-white">{stats.expired}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-500/10 rounded-lg">
                <DollarSign className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">报价总额</p>
                <p className="text-2xl font-bold text-white">{formatPrice(stats.totalAmount)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
            {error}
          </div>
        )}

        {/* 报价列表 */}
        {bids.length === 0 ? (
          <div className="bg-[#111] border border-gray-800 rounded-lg p-12 text-center">
            <Package className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">暂无报价记录</h3>
            <p className="text-gray-400 mb-4">您还没有对任何任务进行报价</p>
            <Link
              to="/market"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <TrendingUp className="w-4 h-4" />
              去任务大厅
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {bids.map((bid) => {
              const statusView = bidStatusView(bid.status);
              return (
                <div
                  key={bid.id}
                  className="bg-[#111] border border-gray-800 rounded-lg p-6 hover:border-gray-700 transition-colors"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    {/* 左侧：任务信息 */}
                    <div className="flex-1">
                      <div className="flex items-start gap-3 mb-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusView.badge}`}>
                          {statusView.icon}
                          {statusView.label}
                        </span>
                        <span className="text-sm text-gray-500">
                          报价时间：{formatDate(bid.createdAt)}
                        </span>
                      </div>
                      
                      <Link
                        to={`/tasks/${bid.taskId}`}
                        className="text-lg font-semibold text-white hover:text-blue-400 transition-colors block mb-2"
                      >
                        {bid.task?.title || '未知任务'}
                      </Link>
                      
                      {bid.task?.description && (
                        <p className="text-gray-400 text-sm line-clamp-2 mb-3">
                          {bid.task.description}
                        </p>
                      )}
                      
                      {/* 报价详情摘要 */}
                      {bid.pricingMeta?.evaluation && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {bid.pricingMeta.evaluation.complexityCn && (
                            <span className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-300">
                              复杂度：{bid.pricingMeta.evaluation.complexityCn}
                            </span>
                          )}
                          {bid.pricingMeta.evaluation.estimatedHours && (
                            <span className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-300">
                              预估工时：{bid.pricingMeta.evaluation.estimatedHours}小时
                            </span>
                          )}
                        </div>
                      )}
                      
                      <p className="text-sm text-gray-400 line-clamp-2">
                        {bid.planSummary || '暂无报价说明'}
                      </p>
                    </div>

                    {/* 右侧：价格和操作 */}
                    <div className="lg:text-right flex flex-row lg:flex-col items-center lg:items-end gap-4 lg:gap-2">
                      <div>
                        <p className="text-sm text-gray-400 mb-1">报价金额</p>
                        <p className="text-2xl font-bold text-white">{formatPrice(bid.priceCny)}</p>
                      </div>
                      
                      {bid.task?.budgetCny && (
                        <div className="text-sm">
                          <span className="text-gray-500">雇主预算：</span>
                          <span className="text-gray-300">{formatPrice(bid.task.budgetCny)}</span>
                        </div>
                      )}
                      
                      <button
                        onClick={() => setSelectedBid(bid)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm"
                      >
                        <FileText className="w-4 h-4" />
                        查看详情
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 报价详情弹窗 */}
        {selectedBid && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#111] border border-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-800">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">报价详情</h2>
                  <button
                    onClick={() => setSelectedBid(null)}
                    className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <XCircle className="w-5 h-5 text-gray-400" />
                  </button>
                </div>
              </div>
              
              <div className="p-6 space-y-6">
                {/* 任务信息 */}
                <div>
                  <h3 className="text-sm font-medium text-gray-400 mb-2">任务信息</h3>
                  <Link
                    to={`/tasks/${selectedBid.taskId}`}
                    className="text-lg font-semibold text-blue-400 hover:text-blue-300"
                  >
                    {selectedBid.task?.title}
                  </Link>
                  {selectedBid.task?.description && (
                    <p className="text-gray-400 mt-2 text-sm">{selectedBid.task.description}</p>
                  )}
                </div>

                {/* 报价信息 */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-800/50 rounded-lg p-4">
                    <p className="text-sm text-gray-400 mb-1">报价金额</p>
                    <p className="text-2xl font-bold text-white">{formatPrice(selectedBid.priceCny)}</p>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-4">
                    <p className="text-sm text-gray-400 mb-1">状态</p>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${bidStatusView(selectedBid.status).badge}`}>
                      {bidStatusView(selectedBid.status).icon}
                      {bidStatusView(selectedBid.status).label}
                    </span>
                  </div>
                </div>

                {/* 评估信息 */}
                {selectedBid.pricingMeta?.evaluation && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-3">评估信息</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {selectedBid.pricingMeta.evaluation.complexityCn && (
                        <div className="flex justify-between py-2 border-b border-gray-800">
                          <span className="text-gray-500">复杂度</span>
                          <span className="text-gray-300">{selectedBid.pricingMeta.evaluation.complexityCn}</span>
                        </div>
                      )}
                      {selectedBid.pricingMeta.evaluation.estimatedHours && (
                        <div className="flex justify-between py-2 border-b border-gray-800">
                          <span className="text-gray-500">预估工时</span>
                          <span className="text-gray-300">{selectedBid.pricingMeta.evaluation.estimatedHours}小时</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 执行计划 */}
                {selectedBid.pricingMeta?.evaluation?.executionPlan && selectedBid.pricingMeta.evaluation.executionPlan.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-3">执行计划</h3>
                    <div className="space-y-2">
                      {selectedBid.pricingMeta.evaluation.executionPlan.map((step, idx) => (
                        <div key={idx} className="flex gap-3 text-sm">
                          <span className="text-blue-400 font-medium">{idx + 1}.</span>
                          <span className="text-gray-300">{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 详细分析 */}
                {selectedBid.pricingMeta?.evaluation?.analysis && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-3">详细分析</h3>
                    <div className="bg-gray-800/30 rounded-lg p-4 text-sm text-gray-300 whitespace-pre-wrap">
                      {selectedBid.pricingMeta.evaluation.analysis}
                    </div>
                  </div>
                )}

                {/* 报价说明 */}
                {selectedBid.planSummary && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">报价说明</h3>
                    <p className="text-gray-300 text-sm">{selectedBid.planSummary}</p>
                  </div>
                )}

                {/* 时间信息 */}
                <div className="text-sm text-gray-500 space-y-1">
                  <p>报价时间：{formatDate(selectedBid.createdAt)}</p>
                  {selectedBid.expiresAt && (
                    <p>过期时间：{formatDate(selectedBid.expiresAt)}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
