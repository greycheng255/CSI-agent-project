import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Loader2, 
  DollarSign, 
  CheckCircle, 
  Clock, 
  ArrowLeft, 
  Wallet, 
  User, 
  TrendingUp,
  Package,
  AlertCircle,
  ChevronRight,
  FileText,
  CreditCard
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

type OrderStatus = 
  | 'PENDING_PAYMENT' 
  | 'IN_PROGRESS' 
  | 'DELIVERED' 
  | 'ACCEPTED' 
  | 'COMPLETED' 
  | 'REJECTED' 
  | 'ARBITRATING' 
  | 'REFUNDED' 
  | 'CANCELED';

type ApiOrder = {
  id: string;
  taskId?: string;
  task?: {
    id: string;
    title: string;
  };
  bid?: {
    agent?: {
      name: string;
    };
  };
  client?: {
    phone: string;
  };
  amountCny?: number;
  platformFeeCny?: number;
  payoutCny?: number;
  status?: string;
  createdAt?: string;
  escrowedAt?: string;
  deliveredAt?: string;
  acceptedAt?: string;
  releasedAt?: string;
};

type ReceiptItem = {
  id: string;
  orderId: string;
  taskId: string;
  taskTitle: string;
  amountCny: number;
  platformFeeCny: number;
  payoutCny: number;
  status: OrderStatus;
  createdAt: string;
  escrowedAt?: string;
  deliveredAt?: string;
  acceptedAt?: string;
  releasedAt?: string;
  clientPhone?: string;
  agentName?: string;
  paymentProofUrl?: string;
  payoutProofUrl?: string;
};

// 状态配置
const statusConfig: Record<OrderStatus, { 
  label: string; 
  badge: string; 
  icon: React.ReactNode;
  description: string;
  progress: number;
  color: string;
}> = {
  COMPLETED: {
    label: '已收款',
    badge: 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border border-[#bde9c9]',
    icon: <CheckCircle className="w-4 h-4" />,
    description: '款项已到账',
    progress: 100,
    color: 'green',
  },
  ACCEPTED: {
    label: '待放款',
    badge: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
    icon: <Clock className="w-4 h-4" />,
    description: '雇主已验收，等待平台放款',
    progress: 90,
    color: 'cyan',
  },
  DELIVERED: {
    label: '待验收',
    badge: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
    icon: <FileText className="w-4 h-4" />,
    description: '已提交交付，等待雇主验收',
    progress: 75,
    color: 'purple',
  },
  IN_PROGRESS: {
    label: '执行中',
    badge: 'bg-[var(--brand-50)] text-[var(--brand-600)] border border-blue-500/20',
    icon: <TrendingUp className="w-4 h-4" />,
    description: '任务正在执行中',
    progress: 50,
    color: 'blue',
  },
  PENDING_PAYMENT: {
    label: '待支付',
    badge: 'bg-[var(--state-warning-surface)] text-[var(--state-warning)] border border-yellow-500/20',
    icon: <CreditCard className="w-4 h-4" />,
    description: '等待雇主支付',
    progress: 25,
    color: 'yellow',
  },
  REJECTED: {
    label: '被拒绝',
    badge: 'bg-red-500/10 text-[var(--state-error)] border border-red-500/20',
    icon: <AlertCircle className="w-4 h-4" />,
    description: '雇主拒绝验收，等待平台处理',
    progress: 75,
    color: 'red',
  },
  ARBITRATING: {
    label: '仲裁中',
    badge: 'bg-red-500/10 text-[var(--state-error)] border border-red-500/20',
    icon: <AlertCircle className="w-4 h-4" />,
    description: '争议仲裁中',
    progress: 75,
    color: 'red',
  },
  REFUNDED: {
    label: '已退款',
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
    icon: <Clock className="w-4 h-4" />,
    description: '订单已退款',
    progress: 0,
    color: 'gray',
  },
  CANCELED: {
    label: '已取消',
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
    icon: <Clock className="w-4 h-4" />,
    description: '订单已取消',
    progress: 0,
    color: 'gray',
  },
};

// 计算预计到账时间
const getEstimatedPaymentTime = (status: OrderStatus, acceptedAt?: string) => {
  if (status === 'COMPLETED') return '已到账';
  if (status === 'ACCEPTED' && acceptedAt) {
    const accepted = new Date(acceptedAt);
    const estimated = new Date(accepted.getTime() + 24 * 60 * 60 * 1000); // 24小时后
    return `预计 ${estimated.toLocaleDateString('zh-CN')} 到账`;
  }
  return '-';
};

export default function MyReceipts({ embedded }: { embedded?: boolean }) {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [stats, setStats] = useState({
    totalReceipts: 0,
    totalAmount: 0,
    completedAmount: 0,
    pendingAmount: 0,
    inProgressCount: 0,
  });

  const apiBase = API_BASE;

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    fetch(`${apiBase}/api/v1/orders/owner/${user.id}`, {
      headers: {
        'Authorization': `Bearer ${useAuthStore.getState().token || ''}`,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error('network');
        return res.json();
      })
      .then((data) => {
        const orders = Array.isArray(data) ? data : [];
        
        const receiptData: ReceiptItem[] = orders.map((order: ApiOrder) => ({
          id: order.id,
          orderId: order.id,
          taskId: order.task?.id || order.taskId || '',
          taskTitle: order.task?.title || '未知任务',
          amountCny: order.amountCny || 0,
          platformFeeCny: order.platformFeeCny || 0,
          payoutCny: order.payoutCny || 0,
          status: (order.status as OrderStatus) || 'PENDING_PAYMENT',
          createdAt: order.createdAt || '',
          escrowedAt: order.escrowedAt,
          deliveredAt: order.deliveredAt,
          acceptedAt: order.acceptedAt,
          releasedAt: order.releasedAt,
          clientPhone: order.client?.phone,
          agentName: order.bid?.agent?.name,
        }));

        // 计算统计
        const completedReceipts = receiptData.filter(r => r.status === 'COMPLETED');
        const pendingReceipts = receiptData.filter(r => 
          ['ACCEPTED', 'DELIVERED', 'IN_PROGRESS'].includes(r.status)
        );
        const inProgressReceipts = receiptData.filter(r => r.status === 'IN_PROGRESS');
        
        setStats({
          totalReceipts: receiptData.length,
          totalAmount: receiptData.reduce((sum, r) => sum + r.payoutCny, 0),
          completedAmount: completedReceipts.reduce((sum, r) => sum + r.payoutCny, 0),
          pendingAmount: pendingReceipts.reduce((sum, r) => sum + r.payoutCny, 0),
          inProgressCount: inProgressReceipts.length,
        });

        setReceipts(receiptData);
        setError('');
        setLoading(false);
      })
      .catch(() => {
        setReceipts([]);
        setError('读取收款记录失败，请检查后端服务是否正常运行。');
        setLoading(false);
      });
  }, [apiBase, navigate, user]);

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number) => {
    return `¥${amount.toFixed(2)}`;
  };

  // 过滤收据
  const filteredReceipts = receipts.filter(receipt => {
    if (activeFilter === 'pending') {
      return ['IN_PROGRESS', 'DELIVERED', 'ACCEPTED', 'PENDING_PAYMENT'].includes(receipt.status);
    }
    if (activeFilter === 'completed') {
      return receipt.status === 'COMPLETED';
    }
    return true;
  });

  // 渲染进度条
  const renderProgressBar = (status: OrderStatus) => {
    const config = statusConfig[status];
    const steps = [
      { label: '接单', active: config.progress >= 25 },
      { label: '执行', active: config.progress >= 50 },
      { label: '交付', active: config.progress >= 75 },
      { label: '收款', active: config.progress >= 100 },
    ];

    return (
      <div className="flex items-center gap-1 mt-3">
        {steps.map((step, idx) => (
          <div key={idx} className="flex items-center">
            <div className={`text-xs px-2 py-0.5 rounded ${
              step.active 
                ? 'bg-[var(--state-success-surface)] text-[var(--state-success-text)]'
                : 'bg-[var(--background-100)] text-[var(--text-500)]'
            }`}>
              {step.label}
            </div>
            {idx < steps.length - 1 && (
              <div className={`w-4 h-0.5 mx-1 ${
                step.active ? 'bg-[var(--state-success)]' : 'bg-[var(--border)]'
              }`} />
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={embedded ? '' : 'min-h-screen bg-white'}>
      <div className={embedded ? '' : 'max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8'}>
        {/* 头部 */}
        {!embedded && (
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              to="/owner/agents"
            className="flex items-center gap-2 text-[var(--text-500)] transition-colors hover:text-[var(--brand-600)]"
            >
              <ArrowLeft className="w-5 h-5" />
              返回
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-900)]">
                <Wallet className="w-7 h-7 text-[var(--state-success-text)]" />
                我的收款记录
              </h1>
              <p className="text-sm text-[var(--text-500)] mt-1">
                查看您作为开发者的所有收款记录
              </p>
            </div>
          </div>
          <Link
            to="/owner/payment-codes"
            className="text-sm text-[var(--brand-600)] hover:text-[var(--brand-700)] border border-[var(--brand-300)] px-4 py-2 rounded-lg bg-[var(--brand-50)] transition-colors flex items-center gap-2"
          >
            <DollarSign className="w-4 h-4" />
            管理收款码
          </Link>
        </div>
        )}

        {/* 统计卡片 - 重新设计 */}
        <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white divide-x divide-y divide-[color:var(--border)] md:grid-cols-4 md:divide-y-0">
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--text-500)]">总订单数</p>
                <p className="mt-1 text-2xl font-bold text-[var(--text-900)]">{stats.totalReceipts}</p>
              </div>
              <div className="w-12 h-12 bg-[var(--brand-50)] rounded-xl flex items-center justify-center">
                <Package className="w-6 h-6 text-[var(--brand-600)]" />
              </div>
            </div>
          </div>
          
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--text-500)]">预计总收款</p>
                <p className="mt-1 text-2xl font-bold text-[var(--text-900)]">{formatCurrency(stats.totalAmount)}</p>
              </div>
              <div className="w-12 h-12 bg-[var(--brand-50)] rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-[var(--brand-600)]" />
              </div>
            </div>
          </div>
          
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--text-500)]">已到账</p>
                <p className="mt-1 text-2xl font-bold text-[var(--text-900)]">{formatCurrency(stats.completedAmount)}</p>
              </div>
              <div className="w-12 h-12 bg-[var(--state-success-surface)] rounded-xl flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-[var(--state-success-text)]" />
              </div>
            </div>
            {stats.completedAmount > 0 && (
              <p className="text-xs text-[var(--state-success-text)]/70 mt-2">
                占比 {(stats.completedAmount / stats.totalAmount * 100).toFixed(1)}%
              </p>
            )}
          </div>
          
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--text-500)]">待到账</p>
                <p className="mt-1 text-2xl font-bold text-[var(--text-900)]">{formatCurrency(stats.pendingAmount)}</p>
              </div>
              <div className="w-12 h-12 bg-[var(--state-warning-surface)] rounded-xl flex items-center justify-center">
                <Clock className="w-6 h-6 text-[var(--state-warning)]" />
              </div>
            </div>
            {stats.inProgressCount > 0 && (
              <p className="text-xs text-[var(--state-warning)]/70 mt-2">
                {stats.inProgressCount} 个任务进行中
              </p>
            )}
          </div>
        </div>

        {/* 筛选标签 */}
        <div className="mb-6 flex gap-1 rounded-xl bg-[var(--background-100)] p-1">
          {[
            { key: 'all', label: '全部', count: receipts.length },
            { key: 'pending', label: '进行中', count: receipts.filter(r => ['IN_PROGRESS', 'DELIVERED', 'ACCEPTED', 'PENDING_PAYMENT'].includes(r.status)).length },
            { key: 'completed', label: '已完成', count: receipts.filter(r => r.status === 'COMPLETED').length },
          ].map((filter) => (
            <button
              key={filter.key}
              onClick={() => setActiveFilter(filter.key as 'all' | 'pending' | 'completed')}
              className={`min-h-10 rounded-lg px-4 text-sm font-medium transition-colors ${
                activeFilter === filter.key
                  ? 'bg-white text-[var(--brand-700)] shadow-sm'
                  : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
              }`}
            >
              {filter.label}
              <span className="ml-2 text-xs opacity-70">({filter.count})</span>
            </button>
          ))}
        </div>

        {/* 收款列表 */}
        {loading ? (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white">
            <Loader2 className="mr-3 h-5 w-5 animate-spin text-[var(--brand-500)]" />
            <span className="text-sm text-[var(--text-500)]">正在读取收款记录...</span>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[color:var(--state-error)] bg-[var(--state-error-surface)] p-6 text-center text-[var(--state-error)]">
            <AlertCircle className="w-8 h-8 mx-auto mb-2" />
            {error}
          </div>
        ) : filteredReceipts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-white py-20 text-center">
            <Wallet className="mx-auto mb-4 h-12 w-12 text-[var(--text-300)]" />
            <p className="mb-2 text-lg text-[var(--text-700)]">暂无收款记录</p>
            <p className="text-sm text-[var(--text-500)]">您的 Agent 还没有承接任何订单</p>
            <Link
              to="/owner/agents"
              className="btn-cs btn-primary btn-sm mt-6"
            >
              去管理我的 Agent
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white divide-y divide-[color:var(--border)]">
            {filteredReceipts.map((receipt) => {
              const config = statusConfig[receipt.status];
              const isCompleted = receipt.status === 'COMPLETED';
              const isInProgress = receipt.status === 'IN_PROGRESS';
              
              return (
                <div
                  key={receipt.id}
                  className="overflow-hidden transition-colors hover:bg-[var(--background-100)]"
                >
                  {/* 卡片头部 */}
                  <div className="p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        {/* 标题行 */}
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="text-base font-semibold text-[var(--text-900)]">
                            {receipt.taskTitle}
                          </h3>
                          <span className={`px-2.5 py-1 text-xs rounded-lg border ${config.badge} flex items-center gap-1.5`}>
                            {config.icon}
                            {config.label}
                          </span>
                        </div>
                        
                        {/* 状态描述 */}
                        <p className="mb-4 text-sm text-[var(--text-500)]">{config.description}</p>
                        
                        {/* 进度条 - 仅进行中的任务显示 */}
                        {(isInProgress || ['DELIVERED', 'ACCEPTED'].includes(receipt.status)) && renderProgressBar(receipt.status)}
                      </div>

                      {/* 金额区域 */}
                      <div className="text-right ml-6">
                        <div className="text-2xl font-bold text-[var(--text-900)]">
                          {formatCurrency(receipt.payoutCny)}
                        </div>
                        <div className="mt-1 text-sm text-[var(--text-500)]">
                          实际收款
                        </div>
                      </div>
                    </div>

                    {/* 详情网格 */}
                    <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[color:var(--border)] pt-5 md:grid-cols-4">
                      <div className="rounded-lg bg-[var(--background-100)] p-3">
                        <div className="mb-1 text-xs text-[var(--text-500)]">订单金额</div>
                        <div className="font-medium text-[var(--text-800)]">{formatCurrency(receipt.amountCny)}</div>
                      </div>
                      <div className="rounded-lg bg-[var(--background-100)] p-3">
                        <div className="text-[var(--text-500)] text-xs mb-1">平台服务费</div>
                        <div className="text-[var(--state-error)] font-medium">-{formatCurrency(receipt.platformFeeCny)}</div>
                      </div>
                      <div className="rounded-lg bg-[var(--background-100)] p-3">
                        <div className="text-[var(--text-500)] text-xs mb-1">创建时间</div>
                        <div className="text-[var(--text-700)] text-sm">{formatDateTime(receipt.createdAt)}</div>
                      </div>
                      <div className="rounded-lg bg-[var(--background-100)] p-3">
                        <div className="text-[var(--text-500)] text-xs mb-1">
                          {isCompleted ? '到账时间' : '预计到账'}
                        </div>
                        <div className={`text-sm ${isCompleted ? 'text-[var(--state-success-text)]' : 'text-[var(--state-warning)]'}`}>
                          {isCompleted 
                            ? formatDateTime(receipt.releasedAt)
                            : getEstimatedPaymentTime(receipt.status, receipt.acceptedAt)
                          }
                        </div>
                      </div>
                    </div>

                    {/* 参与方信息 */}
                    {receipt.clientPhone && (
                      <div className="mt-4 flex items-center gap-6 border-t border-[color:var(--border)] pt-4 text-sm">
                        <div className="flex items-center gap-2 text-[var(--text-600)]">
                          <User className="w-4 h-4" />
                          <span>雇主: <span className="text-[var(--text-700)]">{receipt.clientPhone}</span></span>
                        </div>
                        {receipt.agentName && (
                          <div className="flex items-center gap-2 text-[var(--text-600)]">
                            <Package className="w-4 h-4" />
                            <span>Agent: <span className="text-[var(--text-700)]">{receipt.agentName}</span></span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 底部操作栏 */}
                  <div className="flex items-center justify-between border-t border-[color:var(--border)] px-5 py-3">
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-[var(--text-500)]">订单号: <span className="text-[var(--text-600)] font-mono">{receipt.orderId.slice(0, 16)}...</span></span>
                    </div>
                    <Link
                      to={`/orders/${receipt.orderId}`}
                      className="flex items-center gap-1 text-sm font-medium text-[var(--brand-600)] hover:text-[var(--brand-700)]"
                    >
                      查看详情
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


