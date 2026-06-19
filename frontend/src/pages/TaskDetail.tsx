import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Clock, DollarSign, Loader2, Bot, CheckCircle2, Package, ExternalLink, CheckCircle, XCircle, Gauge, Hourglass } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import { BidDetailPanel } from '../components/BidDetailPanel';
import { formatShanghaiDateTime } from '../utils/date';

interface Task {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  budgetCny?: number;
  expectedDeliveryAt?: string;
  status: string;
  createdAt?: string;
  client?: { id: string; phone?: string };
  tags?: string[] | null;
  skillsRequired?: string[] | null;
  attachmentUrls?: string[] | null;
}

interface Order {
  id: string;
  status: 'PENDING_PAYMENT' | 'IN_PROGRESS' | 'DELIVERED' | 'ACCEPTED' | 'PENDING_RELEASE' | 'COMPLETED' | 'CANCELED' | 'REFUNDED';
  amountCny: number;
  createdAt: string;
  deliveredAt?: string;
  acceptedAt?: string;
  deliveryUrl?: string;
  deliverySummary?: string;
  bid?: {
    agent?: {
      id: string;
      name: string;
    };
    priceCny?: number;
  };
}

interface Agent {
  id: string;
  name: string;
}

interface Bid {
  id: string;
  priceCny: number;
  planSummary?: string;
  agent?: Agent;
  pricingModel?: string | null;
  createdAt?: string;
  status?: 'submitted' | 'accepted' | 'rejected' | 'expired' | 'withdrawn';
  confidenceScore?: number;
  estimatedHours?: number | null;
  riskNotes?: string | null;
  rankScore?: number;
  pricingMeta?: {
    scores?: {
      relevance?: number;
      complexity?: number;
      urgency?: number;
      overall?: number;
    };
    skillHits?: string[];
    params?: {
      minBidRatio?: number;
      maxBidRatio?: number;
      minScore?: number;
    };
    budgetCny?: number | null;
    ratio?: number | null;
    evaluation?: {
      baseRate: number;
      estimatedHours: number;
      basePrice: number;
      complexityFactor: number;
      complexity: string;
      complexityCn: string;
      confidence: string;
      minPrice: number;
      maxPrice: number;
      budgetCny: number;
      matchedSkills: Array<{
        name: string;
        description: string;
        matchScore: number;
      }>;
      executionPlan: string[];
      analysis?: string;
    };
  } | null;
}

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const apiBase = API_BASE;
  const [task, setTask] = useState<Task | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectingBidId, setSelectingBidId] = useState<string | null>(null);
  const [expandedBidId, setExpandedBidId] = useState<string | null>(null);
  const canSelectBid = !!user && !!task?.client?.id && user.id === task.client.id && task.status === 'OPEN' && !order;

  const bidStatusView = (status?: Bid['status']) => {
    switch (status) {
      case 'accepted':
        return { label: '已中标', cls: 'bg-green-500/10 text-green-400 border-green-500/20' };
      case 'rejected':
        return { label: '未中标', cls: 'bg-gray-800 text-gray-400 border-gray-700' };
      case 'expired':
        return { label: '已过期', cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' };
      case 'withdrawn':
        return { label: '已撤回', cls: 'bg-red-500/10 text-red-400 border-red-500/20' };
      case 'submitted':
      default:
        return { label: '待选择', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
    }
  };

  const fetchBids = async (taskId: string) => {
    const res = await fetch(`${apiBase}/api/v1/tasks/${taskId}/bids`);
    if (!res.ok) throw new Error('获取报价失败');
    const data = await res.json();
    setBids(Array.isArray(data) ? data : []);
  };

  // 获取任务订单
  const fetchTaskOrder = async (taskId: string) => {
    try {
      const res = await fetch(`${apiBase}/api/v1/orders/task/${taskId}`);
      if (res.ok) {
        const orders = await res.json();
        if (Array.isArray(orders) && orders.length > 0) {
          setOrder(orders[0]);
        } else {
          setOrder(null);
        }
      }
    } catch {
      // 忽略错误
      setOrder(null);
    }
  };

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`${apiBase}/api/v1/tasks/${id}`).then(r => r.json()),
      fetch(`${apiBase}/api/v1/tasks/${id}/bids`).then(r => r.json()),
    ])
    .then(([taskData, bidsData]: [Task, Bid[]]) => {
      setTask(taskData || null);
      setBids(Array.isArray(bidsData) ? bidsData : []);
      // 获取任务订单
      fetchTaskOrder(id);
      setLoading(false);
    })
    .catch(() => {
      setTask(null);
      setBids([]);
      setLoading(false);
    });
  }, [apiBase, id]);

  useEffect(() => {
    if (!id) return;
    const status = task?.status;
    if (status !== 'OPEN') return;
    const timer = setInterval(() => {
      fetchBids(id).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [apiBase, id, task?.status]);

  const handleSelectBid = async (bidId: string) => {
    if (!user) {
      alert('请先登录');
      navigate('/login');
      return;
    }
    if (!task?.client?.id) {
      alert('该任务缺少雇主信息，无法选标');
      return;
    }
    if (user.id !== task.client.id) {
      alert('只有雇主才能选择报价');
      return;
    }
    setSelectingBidId(bidId);
    try {
      const res = await fetch(`${apiBase}/api/v1/tasks/${id}/select-bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidId, userId: user.id }),
      });
      if (!res.ok) throw new Error('选标失败');
      const order = await res.json();
      alert('选标成功！即将跳转至支付页面...');
      navigate(`/orders/${order.id}`);
    } catch {
      alert('选标失败，请重试');
    } finally {
      setSelectingBidId(null);
    }
  };

  // 订单状态视图
  const orderStatusView = (status: Order['status']) => {
    switch (status) {
      case 'PENDING_PAYMENT':
        return { label: '待支付', badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: <Clock className="w-4 h-4" /> };
      case 'IN_PROGRESS':
        return { label: '进行中', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: <Loader2 className="w-4 h-4 animate-spin" /> };
      case 'DELIVERED':
        return { label: '待验收', badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: <Package className="w-4 h-4" /> };
      case 'ACCEPTED':
        return { label: '已验收', badge: 'bg-green-500/10 text-green-400 border-green-500/20', icon: <CheckCircle className="w-4 h-4" /> };
      case 'PENDING_RELEASE':
        return { label: '待放款', badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: <Clock className="w-4 h-4" /> };
      case 'COMPLETED':
        return { label: '已完成', badge: 'bg-green-500/10 text-green-400 border-green-500/20', icon: <CheckCircle2 className="w-4 h-4" /> };
      case 'CANCELED':
        return { label: '已取消', badge: 'bg-gray-800 text-gray-400 border-gray-700', icon: <XCircle className="w-4 h-4" /> };
      case 'REFUNDED':
        return { label: '已退款', badge: 'bg-gray-800 text-gray-400 border-gray-700', icon: <XCircle className="w-4 h-4" /> };
      default:
        return { label: status, badge: 'bg-gray-800 text-gray-400 border-gray-700', icon: <Package className="w-4 h-4" /> };
    }
  };

  if (loading || !task) {
    return (
      <div className="flex justify-center items-center py-20 text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin mr-3 text-green-500" />
        正在连接网络读取数据...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-8 relative overflow-hidden">
        <div className={`absolute top-0 left-0 w-1 h-full ${order?.status === 'COMPLETED' ? 'bg-green-500' : 'bg-blue-500'}`}></div>
        <div className="flex justify-between items-start mb-6">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              <span className="text-sm font-mono text-gray-500">TASK#{task.id}</span>
              {order?.status === 'COMPLETED' ? (
                <span className="px-2 py-0.5 bg-green-500/10 text-green-400 rounded text-xs border border-green-500/20 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  已完成
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded text-xs">{task.status}</span>
              )}
              <span className="px-2 py-0.5 bg-gray-800/50 text-gray-300 rounded text-xs">
                雇主：{task.client?.phone || task.client?.id?.slice(0, 8) || '未知'}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-gray-200">{task.title}</h1>
            
            {/* 任务完成后的摘要信息 */}
            {order?.status === 'COMPLETED' && (
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                <span className="text-gray-400">
                  执行者：<span className="text-blue-400 font-medium">{order.bid?.agent?.name || '未知 Agent'}</span>
                </span>
                <span className="text-gray-400">
                  成交价格：<span className="text-green-400 font-medium">¥{order.amountCny}</span>
                </span>
                {order.acceptedAt && (
                  <span className="text-gray-400">
                    完成时间：<span className="text-gray-300">{formatShanghaiDateTime(order.acceptedAt)}</span>
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-green-500">¥{task.budgetCny ?? 0}</div>
            <div className="text-xs text-gray-500 mt-1 flex items-center justify-end">
              <DollarSign className="w-3 h-3 mr-1" /> 最高预算
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-bold text-gray-400 mb-2 border-b border-gray-800 pb-2">详细描述</h3>
            <p className="text-gray-300 font-mono text-sm whitespace-pre-wrap">{task.description}</p>
          </div>
          {((task.tags && task.tags.length > 0) || (task.skillsRequired && task.skillsRequired.length > 0)) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {task.tags && task.tags.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-gray-400 mb-2 border-b border-gray-800 pb-2">任务标签</h3>
                  <div className="flex flex-wrap gap-2">
                    {task.tags.map((tag) => (
                      <span key={tag} className="px-2 py-1 bg-gray-800/70 rounded text-xs text-gray-300">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {task.skillsRequired && task.skillsRequired.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-gray-400 mb-2 border-b border-gray-800 pb-2">所需能力</h3>
                  <div className="flex flex-wrap gap-2">
                    {task.skillsRequired.map((skill) => (
                      <span key={skill} className="px-2 py-1 bg-green-500/10 text-green-400 rounded text-xs">{skill}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {task.attachmentUrls && task.attachmentUrls.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-400 mb-2 border-b border-gray-800 pb-2">附件</h3>
              <div className="space-y-2">
                {task.attachmentUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-green-400 hover:text-green-300 flex items-center gap-2">
                    <ExternalLink className="w-4 h-4" />
                    {url}
                  </a>
                ))}
              </div>
            </div>
          )}
          <div>
            <h3 className="text-sm font-bold text-gray-400 mb-2 border-b border-gray-800 pb-2 flex items-center">
              <CheckCircle2 className="w-4 h-4 mr-2" /> 验收标准
            </h3>
            <p className="text-gray-300 font-mono text-sm whitespace-pre-wrap">{task.acceptanceCriteria}</p>
          </div>
          
          {/* 任务时间线 */}
          <div className="bg-black p-4 rounded-lg border border-gray-800">
            <h3 className="text-sm font-bold text-gray-400 mb-3 flex items-center">
              <Clock className="w-4 h-4 mr-2" /> 任务时间线
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-gray-500 block mb-1">发布时间</span>
                <span className="text-gray-300">{formatShanghaiDateTime(task.createdAt)}</span>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">期望交付</span>
                <span className="text-gray-300">{formatShanghaiDateTime(task.expectedDeliveryAt)}</span>
              </div>
              {order?.deliveredAt && (
                <div>
                  <span className="text-gray-500 block mb-1">实际交付</span>
                  <span className="text-green-400">{formatShanghaiDateTime(order.deliveredAt)}</span>
                </div>
              )}
              {order?.acceptedAt && (
                <div>
                  <span className="text-gray-500 block mb-1">验收通过</span>
                  <span className="text-green-400">{formatShanghaiDateTime(order.acceptedAt)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 订单信息 - 如果有订单则显示 */}
      {order && (
        <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-xl font-bold flex items-center space-x-2">
              <Package className="text-blue-500 w-6 h-6" />
              <span>订单信息</span>
            </h2>
            {(() => {
              const statusView = orderStatusView(order.status);
              return (
                <span className={`px-3 py-1 rounded border flex items-center gap-2 ${statusView.badge}`}>
                  {statusView.icon}
                  {statusView.label}
                </span>
              );
            })()}
          </div>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">订单编号：</span>
                <span className="text-gray-300 font-mono">{order.id}</span>
              </div>
              <div>
                <span className="text-gray-500">成交价格：</span>
                <span className="text-green-400 font-bold">¥{order.amountCny}</span>
              </div>
              <div>
                <span className="text-gray-500">执行 Agent：</span>
                <span className="text-blue-400">{order.bid?.agent?.name || '未知'}</span>
              </div>
              <div>
                <span className="text-gray-500">创建时间：</span>
                <span className="text-gray-300">{formatShanghaiDateTime(order.createdAt)}</span>
              </div>
              {order.deliveredAt && (
                <div>
                  <span className="text-gray-500">交付时间：</span>
                  <span className="text-gray-300">{formatShanghaiDateTime(order.deliveredAt)}</span>
                </div>
              )}
              {order.acceptedAt && (
                <div>
                  <span className="text-gray-500">验收时间：</span>
                  <span className="text-gray-300">{formatShanghaiDateTime(order.acceptedAt)}</span>
                </div>
              )}
            </div>
            
            {/* 交付物信息 */}
            {order.deliveryUrl && (
              <div className="mt-4 p-4 bg-gray-900/50 rounded-lg border border-gray-800">
                <h3 className="text-sm font-bold text-gray-400 mb-2">交付物</h3>
                <a 
                  href={order.deliveryUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-green-400 hover:text-green-300 flex items-center gap-2 text-sm"
                >
                  <ExternalLink className="w-4 h-4" />
                  {order.deliveryUrl}
                </a>
                {order.deliverySummary && (
                  <p className="text-xs text-gray-500 mt-2">{order.deliverySummary}</p>
                )}
              </div>
            )}
            
            {/* 操作按钮 */}
            <div className="flex gap-3 mt-4">
              <Link
                to={`/orders/${order.id}`}
                className="flex-1 text-center py-2 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/20 transition-colors"
              >
                查看订单详情
              </Link>
              {order.status === 'PENDING_PAYMENT' && (
                <Link
                  to={`/orders/${order.id}`}
                  className="flex-1 text-center py-2 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded hover:bg-yellow-500/20 transition-colors"
                >
                  去支付
                </Link>
              )}
              {order.status === 'DELIVERED' && (
                <Link
                  to={`/orders/${order.id}`}
                  className="flex-1 text-center py-2 bg-purple-500/10 text-purple-400 border border-purple-500/30 rounded hover:bg-purple-500/20 transition-colors"
                >
                  去验收
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 报价列表 - 只在任务开放且没有订单时显示 */}
      {task.status === 'OPEN' && !order && (
      <div>
        <div className="flex justify-between items-end mb-4">
          <h2 className="text-xl font-bold flex items-center space-x-2">
            <Bot className="text-green-500 w-6 h-6" />
            <span>硅基报价池 (Bids)</span>
            <span className="text-sm font-normal text-gray-500 ml-2">当前 {bids.length} 个 Agent 参与竞标</span>
          </h2>
        </div>
        {!canSelectBid && (
          <div className="mb-4 text-xs text-gray-500">
            当前账号不是雇主，仅可查看报价；选择报价需使用雇主账号登录。
          </div>
        )}

        {bids.length === 0 ? (
          <div className="border border-gray-800 border-dashed rounded-xl p-12 text-center text-gray-500">
            正在向全网在线 Agent 广播需求，请耐心等待报价...
            <div className="mt-4">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-600" />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {bids.map((bid) => (
              (() => {
                const statusView = bidStatusView(bid.status);
                const canSelectThisBid = canSelectBid && (bid.status || 'submitted') === 'submitted';
                return (
              <div
                key={bid.id}
                className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 hover:border-green-500/30 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <span className="font-bold text-green-400 flex items-center">
                      <Bot className="w-4 h-4 mr-1" />
                      {bid.agent?.name || 'Unknown Agent'}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">ID: {bid.agent?.id ? bid.agent.id.slice(0, 8) : '--------'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded border ${statusView.cls}`}>{statusView.label}</span>
                    {bid.rankScore !== undefined && (
                      <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                        排名分 {Math.round(bid.rankScore)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 font-mono bg-black p-3 rounded border border-gray-800 mt-2">
                    {bid.planSummary}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <Gauge className="w-3.5 h-3.5" />
                      置信度 {Math.round((bid.confidenceScore ?? 0.5) * 100)}%
                    </span>
                    {bid.estimatedHours !== null && bid.estimatedHours !== undefined && (
                      <span className="flex items-center gap-1">
                        <Hourglass className="w-3.5 h-3.5" />
                        预估 {bid.estimatedHours} 小时
                      </span>
                    )}
                    {bid.riskNotes && <span className="text-yellow-400">风险: {bid.riskNotes}</span>}
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setExpandedBidId((cur) => (cur === bid.id ? null : bid.id))}
                      className="text-xs text-gray-400 hover:text-gray-200 underline underline-offset-4"
                    >
                      {expandedBidId === bid.id ? '收起报价依据' : '查看报价依据'}
                    </button>
                  </div>
                  {expandedBidId === bid.id && (
                    <div className="mt-4">
                      <BidDetailPanel bid={bid} />
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end min-w-[150px]">
                  <div className="text-2xl font-bold text-white mb-3">¥{bid.priceCny}</div>
                  {canSelectBid && (
                    <button
                      onClick={() => handleSelectBid(bid.id)}
                      disabled={selectingBidId === bid.id || !canSelectThisBid}
                      className="w-full px-4 py-2 bg-green-500 text-black font-bold rounded hover:bg-green-400 transition-colors disabled:opacity-50 flex justify-center items-center"
                    >
                      {selectingBidId === bid.id ? <Loader2 className="w-4 h-4 animate-spin" /> : canSelectThisBid ? '选择该报价' : '不可选择'}
                    </button>
                  )}
                </div>
              </div>
                );
              })()
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

