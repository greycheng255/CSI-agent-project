import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, CreditCard, CheckCircle, Clock, ArrowLeft, Bot } from 'lucide-react';
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
  owner?: {
    phone: string;
  };
  amountCny?: number;
  platformFeeCny?: number;
  status?: string;
  createdAt?: string;
  escrowedAt?: string;
  deliveredAt?: string;
  acceptedAt?: string;
  releasedAt?: string;
  refundedAt?: string;
};

type PaymentItem = {
  id: string;
  orderId: string;
  taskId: string;
  taskTitle: string;
  amountCny: number;
  platformFeeCny: number;
  totalAmount: number;
  status: OrderStatus;
  createdAt: string;
  escrowedAt?: string;
  deliveredAt?: string;
  acceptedAt?: string;
  releasedAt?: string;
  refundedAt?: string;
  agentName?: string;
  ownerPhone?: string;
  paymentProofUrl?: string;
};

function paymentStatusView(status: OrderStatus) {
  switch (status) {
    case 'COMPLETED':
      return {
        label: '已完成',
        badge: 'bg-green-500/10 text-green-400 border border-green-500/20',
        icon: <CheckCircle className="w-4 h-4" />,
        description: '订单已完成，款项已支付给开发者',
      };
    case 'ACCEPTED':
      return {
        label: '已验收',
        badge: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
        icon: <CheckCircle className="w-4 h-4" />,
        description: '您已验收，等待平台放款',
      };
    case 'DELIVERED':
      return {
        label: '待验收',
        badge: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
        icon: <Clock className="w-4 h-4" />,
        description: '开发者已提交交付物，请尽快验收',
      };
    case 'IN_PROGRESS':
      return {
        label: '执行中',
        badge: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
        icon: <Clock className="w-4 h-4" />,
        description: '已支付，Agent正在执行任务',
      };
    case 'PENDING_PAYMENT':
      return {
        label: '待支付',
        badge: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
        icon: <Clock className="w-4 h-4" />,
        description: '请选择Agent并完成支付',
      };
    case 'REJECTED':
      return {
        label: '已拒绝',
        badge: 'bg-red-500/10 text-red-400 border border-red-500/20',
        icon: <Clock className="w-4 h-4" />,
        description: '您已拒绝验收，等待平台处理',
      };
    case 'ARBITRATING':
      return {
        label: '仲裁中',
        badge: 'bg-red-500/10 text-red-400 border border-red-500/20',
        icon: <Clock className="w-4 h-4" />,
        description: '争议仲裁中',
      };
    case 'REFUNDED':
      return {
        label: '已退款',
        badge: 'bg-gray-800 text-gray-300 border border-gray-700',
        icon: <CheckCircle className="w-4 h-4" />,
        description: '订单已退款',
      };
    case 'CANCELED':
      return {
        label: '已取消',
        badge: 'bg-gray-800 text-gray-300 border border-gray-700',
        icon: <Clock className="w-4 h-4" />,
        description: '订单已取消',
      };
    default:
      return {
        label: status,
        badge: 'bg-gray-800 text-gray-400 border border-gray-700',
        icon: <Clock className="w-4 h-4" />,
        description: '',
      };
  }
}

export default function MyPayments({ embedded }: { embedded?: boolean }) {
  const { user, admin } = useAuthStore();
  const navigate = useNavigate();
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({
    totalPayments: 0,
    totalAmount: 0,
    completedAmount: 0,
    pendingAmount: 0,
    refundedAmount: 0,
  });

  const apiBase = API_BASE;

  useEffect(() => {
    if (!user && !admin) {
      navigate('/login');
      return;
    }

    // 获取雇主（Client）的订单列表
    fetch(`${apiBase}/api/v1/orders/client/${user.id}`, {
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
        
        // 转换为支付记录格式
        // 注意：雇主只支付任务金额，平台服务费从开发者收益中扣除
        const paymentData: PaymentItem[] = orders.map((order: ApiOrder) => ({
          id: order.id,
          orderId: order.id,
          taskId: order.task?.id || order.taskId || '',
          taskTitle: order.task?.title || '未知任务',
          amountCny: order.amountCny || 0,
          platformFeeCny: order.platformFeeCny || 0,
          totalAmount: order.amountCny || 0, // 雇主实际支付金额（不含平台服务费）
          status: (order.status as OrderStatus) || 'PENDING_PAYMENT',
          createdAt: order.createdAt || '',
          escrowedAt: order.escrowedAt,
          deliveredAt: order.deliveredAt,
          acceptedAt: order.acceptedAt,
          releasedAt: order.releasedAt,
          refundedAt: order.refundedAt,
          agentName: order.bid?.agent?.name,
          ownerPhone: order.owner?.phone,
        }));

        // 计算统计
        const completedPayments = paymentData.filter(p => p.status === 'COMPLETED');
        const pendingPayments = paymentData.filter(p => 
          ['IN_PROGRESS', 'DELIVERED', 'ACCEPTED'].includes(p.status)
        );
        const refundedPayments = paymentData.filter(p => p.status === 'REFUNDED');
        
        setStats({
          totalPayments: paymentData.length,
          totalAmount: paymentData.reduce((sum, p) => sum + p.totalAmount, 0),
          completedAmount: completedPayments.reduce((sum, p) => sum + p.totalAmount, 0),
          pendingAmount: pendingPayments.reduce((sum, p) => sum + p.totalAmount, 0),
          refundedAmount: refundedPayments.reduce((sum, p) => sum + p.totalAmount, 0),
        });

        setPayments(paymentData);
        setError('');
        setLoading(false);
      })
      .catch(() => {
        setPayments([]);
        setError('读取支付记录失败，请检查后端服务是否正常运行。');
        setLoading(false);
      });
  }, [apiBase, navigate, user]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-CN', {
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

  return (
    <div className={embedded ? 'space-y-6' : 'max-w-6xl mx-auto space-y-6'}>
      {/* 头部 */}
      {!embedded && (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/orders/mine"
            className="flex items-center gap-2 text-gray-400 hover:text-green-400 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            返回
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="w-7 h-7 text-blue-400" />
              我的支付记录
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              查看您作为雇主的所有支付记录
            </p>
          </div>
        </div>
        <Link
          to="/market"
          className="text-sm text-green-400 hover:text-green-300 border border-green-500/30 px-3 py-1.5 rounded bg-green-500/10 transition-colors"
        >
          去发布任务
        </Link>
      </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">总订单数</div>
          <div className="text-2xl font-bold text-white">{stats.totalPayments}</div>
        </div>
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">总支付金额</div>
          <div className="text-2xl font-bold text-blue-400">{formatCurrency(stats.totalAmount)}</div>
        </div>
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">已完成支付</div>
          <div className="text-2xl font-bold text-green-400">{formatCurrency(stats.completedAmount)}</div>
        </div>
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">进行中</div>
          <div className="text-2xl font-bold text-yellow-400">{formatCurrency(stats.pendingAmount)}</div>
        </div>
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">已退款</div>
          <div className="text-2xl font-bold text-gray-400">{formatCurrency(stats.refundedAmount)}</div>
        </div>
      </div>

      {/* 支付列表 */}
      {loading ? (
        <div className="flex justify-center items-center py-20 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-3 text-blue-500" />
          正在读取支付记录...
        </div>
      ) : error ? (
        <div className="p-4 border border-red-900/50 bg-red-900/10 text-red-400 rounded-lg text-center">
          {error}
        </div>
      ) : payments.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <CreditCard className="w-16 h-16 mx-auto mb-4 text-gray-600" />
          <p className="text-lg mb-2">暂无支付记录</p>
          <p className="text-sm">您还没有发布过任务或创建过订单</p>
          <Link
            to="/tasks/new"
            className="inline-block mt-4 text-green-400 hover:text-green-300 border border-green-500/30 px-4 py-2 rounded bg-green-500/10 transition-colors"
          >
            去发布任务
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {payments.map((payment) => {
            const statusView = paymentStatusView(payment.status);
            return (
              <div
                key={payment.id}
                className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-white">
                        {payment.taskTitle}
                      </h3>
                      <span className={`px-2 py-0.5 text-xs rounded border ${statusView.badge} flex items-center gap-1`}>
                        {statusView.icon}
                        {statusView.label}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">{statusView.description}</p>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-gray-500 mb-1">任务金额</div>
                        <div className="text-white font-medium">{formatCurrency(payment.amountCny)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500 mb-1">支付金额</div>
                        <div className="text-blue-400 font-bold text-lg">{formatCurrency(payment.totalAmount)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500 mb-1">订单时间</div>
                        <div className="text-gray-300">{formatDate(payment.createdAt)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500 mb-1">支付时间</div>
                        <div className="text-gray-300">{formatDate(payment.escrowedAt)}</div>
                      </div>
                    </div>

                    {payment.agentName && (
                      <div className="mt-4 pt-4 border-t border-gray-800 flex items-center gap-2 text-sm text-gray-400">
                        <Bot className="w-4 h-4" />
                        执行 Agent: {payment.agentName}
                        {payment.ownerPhone && (
                          <>
                            <span className="mx-2">|</span>
                            <span>开发者: {payment.ownerPhone}</span>
                          </>
                        )}
                      </div>
                    )}

                    {payment.releasedAt && (
                      <div className="mt-2 text-sm text-green-400 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" />
                        放款时间: {formatDate(payment.releasedAt)}
                      </div>
                    )}

                    {payment.refundedAt && (
                      <div className="mt-2 text-sm text-gray-400 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" />
                        退款时间: {formatDate(payment.refundedAt)}
                      </div>
                    )}
                  </div>

                  <div className="ml-4 flex flex-col gap-2">
                    <Link
                      to={`/orders/${payment.orderId}`}
                      className="text-sm text-blue-400 hover:text-blue-300 border border-blue-500/30 px-3 py-1.5 rounded bg-blue-500/10 transition-colors text-center"
                    >
                      查看订单
                    </Link>
                    {payment.status === 'DELIVERED' && (
                      <Link
                        to={`/orders/${payment.orderId}`}
                        className="text-sm text-green-400 hover:text-green-300 border border-green-500/30 px-3 py-1.5 rounded bg-green-500/10 transition-colors text-center"
                      >
                        去验收
                      </Link>
                    )}
                    {payment.status === 'PENDING_PAYMENT' && (
                      <Link
                        to={`/orders/${payment.orderId}`}
                        className="text-sm text-yellow-400 hover:text-yellow-300 border border-yellow-500/30 px-3 py-1.5 rounded bg-yellow-500/10 transition-colors text-center"
                      >
                        去支付
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
