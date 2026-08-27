import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleAlert, ClipboardList, ExternalLink, Inbox, Loader2, Package, Plus, Clock, CheckCircle, XCircle } from 'lucide-react';
import { WorkbenchPageHeader, WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import { formatShanghaiDate } from '../utils/date';

type TaskStatus = 'OPEN' | 'CLOSED' | 'CANCELED';

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

type ApiTask = {
  id: string;
  title: string;
  description?: string;
  budgetCny?: number;
  status?: string;
  createdAt: string;
  expectedDeliveryAt?: string;
};

type ApiOrder = {
  id: string;
  taskId?: string;
  task?: {
    id: string;
    title: string;
    description?: string;
    status?: string;
  };
  bid?: {
    agent?: {
      id: string;
      name: string;
    };
    priceCny?: number;
  };
  status?: string;
  amountCny?: number;
  createdAt?: string;
  deliveredAt?: string;
  [key: string]: unknown;
};

type TaskItem = {
  id: string;
  title: string;
  description?: string;
  budgetCny?: number;
  status: TaskStatus;
  createdAt: string;
  expectedDeliveryAt?: string;
  hasOrder?: boolean;
};

type OrderItem = {
  id: string;
  taskId: string;
  task?: {
    id: string;
    title: string;
    description?: string;
    status?: string;
  };
  bid?: {
    agent?: {
      id: string;
      name: string;
    };
    priceCny?: number;
  };
  status: OrderStatus;
  amountCny: number;
  createdAt: string;
  deliveredAt?: string;
  acceptedAt?: string;
  deliveryUrl?: string;
  deliverySummary?: string;
};

function taskStatusView(status: TaskStatus) {
  switch (status) {
    case 'OPEN':
      return {
        label: '招募中',
        badge: 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border border-[#bde9c9]',
        icon: <Clock className="w-4 h-4" />,
      };
    case 'CLOSED':
      return {
        label: '已结束',
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
        icon: <CheckCircle className="w-4 h-4" />,
      };
    case 'CANCELED':
      return {
        label: '已取消',
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
        icon: <XCircle className="w-4 h-4" />,
      };
    default:
      return {
        label: status,
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
        icon: <Package className="w-4 h-4" />,
      };
  }
}

function orderStatusView(status: OrderStatus) {
  switch (status) {
    case 'PENDING_PAYMENT':
      return {
        label: '待支付',
        badge: 'bg-[var(--state-warning-surface)] text-[var(--state-warning)] border border-[#f3d79a]',
        description: '请选择Agent并支付',
      };
    case 'IN_PROGRESS':
      return {
        label: '进行中',
        badge: 'bg-[var(--brand-50)] text-[var(--brand-700)] border border-[var(--brand-200)]',
        description: 'Agent正在执行任务',
      };
    case 'DELIVERED':
      return {
        label: '待验收',
        badge: 'bg-[#f1f0ff] text-[#514fc4] border border-[#d9d7ff]',
        description: 'Agent已提交交付物',
      };
    case 'ACCEPTED':
      return {
        label: '已验收',
        badge: 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border border-[#bde9c9]',
        description: '等待系统打款',
      };
    case 'COMPLETED':
      return {
        label: '已完成',
        badge: 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border border-[#bde9c9]',
        description: '任务已完成，资金已释放',
      };
    case 'REJECTED':
      return {
        label: '已拒绝',
        badge: 'bg-[var(--state-error-surface)] text-[var(--state-error)] border border-[#ffc6c1]',
        description: '交付物未通过验收',
      };
    case 'ARBITRATING':
      return {
        label: '仲裁中',
        badge: 'bg-[var(--state-warning-surface)] text-[var(--state-warning)] border border-[#f3d79a]',
        description: '正在处理争议',
      };
    case 'REFUNDED':
      return {
        label: '已退款',
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
        description: '资金已退回',
      };
    case 'CANCELED':
      return {
        label: '已取消',
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
        description: '订单已取消',
      };
    default:
      return {
        label: status,
        badge: 'bg-[var(--background-100)] text-[var(--text-600)] border border-[color:var(--border)]',
        description: '',
      };
  }
}

export default function MyOrders() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'open' | 'in_progress' | 'completed'>('all');

  const apiBase = API_BASE;

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    // 同时获取用户的任务列表和订单列表
    Promise.all([
      fetch(`${apiBase}/api/v1/tasks/my-tasks?clientId=${user.id}`).then(res => res.ok ? res.json() : []),
      fetch(`${apiBase}/api/v1/orders/client/${user.id}`).then(res => res.ok ? res.json() : [])
    ])
      .then(([tasksData, ordersData]) => {
        setError('');
        
        // 处理订单数据 - 将 task.id 映射到 taskId
        const ordersArray: OrderItem[] = Array.isArray(ordersData) ? ordersData.map((o: ApiOrder) => ({
          ...o,
          taskId: o.task?.id || o.taskId || '',
          status: (o.status as OrderStatus) || 'PENDING_PAYMENT',
          amountCny: o.amountCny || 0,
          createdAt: o.createdAt || '',
        })) : [];
        setOrders(ordersArray);
        
        // 处理任务数据
        const myTasks: TaskItem[] = Array.isArray(tasksData) ? tasksData.map((t: ApiTask) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: (t.status as TaskStatus) || 'CLOSED',
          createdAt: t.createdAt,
          budgetCny: t.budgetCny,
          expectedDeliveryAt: t.expectedDeliveryAt,
          hasOrder: ordersArray.some((o: OrderItem) => o.taskId === t.id)
        })) : [];
        
        setTasks(myTasks);
        setLoading(false);
      })
      .catch(() => {
        setTasks([]);
        setOrders([]);
        setError('读取数据失败，请检查后端服务是否正常运行。');
        setLoading(false);
      });
  }, [apiBase, navigate, user]);

  // 过滤显示的任务
  const filteredTasks = tasks.filter(task => {
    if (activeTab === 'all') return true;
    if (activeTab === 'open') return task.status === 'OPEN' && !task.hasOrder;
    if (activeTab === 'in_progress') return task.hasOrder && !['COMPLETED', 'CANCELED', 'REFUNDED'].includes(
      orders.find(o => o.taskId === task.id)?.status || ''
    );
    if (activeTab === 'completed') {
      // 已完成包括：1) 有已完成订单的任务 2) 任务本身状态为CLOSED或CANCELED
      const order = orders.find(o => o.taskId === task.id);
      const hasCompletedOrder = order && ['COMPLETED', 'CANCELED', 'REFUNDED'].includes(order.status);
      const isClosedTask = task.status === 'CLOSED' || task.status === 'CANCELED';
      return hasCompletedOrder || isClosedTask;
    }
    return true;
  });

  // 获取任务对应的订单
  const getTaskOrder = (taskId: string) => {
    return orders.find(o => o.taskId === taskId);
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={ClipboardList}
        eyebrow="我的任务"
        title="已发布任务"
        description="跟进自己发布的任务，从 Agent 招募、订单支付到交付验收集中处理。"
        actions={<>
          <Link
            to="/tasks/new"
            className="btn-cs btn-primary btn-sm"
          >
            <Plus className="h-4 w-4" />
            发布新任务
          </Link>
          <Link to="/market" className="btn-cs btn-ghost-dark btn-sm">任务大厅</Link>
        </>}
      />

      {/* 统计卡片 */}
      <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white divide-x divide-y divide-[color:var(--border)] md:grid-cols-4 md:divide-y-0">
        <div className="p-5">
          <div className="text-2xl font-bold text-[var(--text-900)]">{tasks.filter(t => t.status === 'OPEN' && !t.hasOrder).length}</div>
          <div className="mt-1 text-xs text-[var(--text-500)]">招募中</div>
        </div>
        <div className="p-5">
          <div className="text-2xl font-bold text-[var(--text-900)]">{orders.filter(o => ['PENDING_PAYMENT', 'IN_PROGRESS', 'DELIVERED'].includes(o.status)).length}</div>
          <div className="mt-1 text-xs text-[var(--text-500)]">进行中</div>
        </div>
        <div className="p-5">
          <div className="text-2xl font-bold text-[var(--text-900)]">{orders.filter(o => o.status === 'DELIVERED').length}</div>
          <div className="mt-1 text-xs text-[var(--text-500)]">待验收</div>
        </div>
        <div className="p-5">
          <div className="text-2xl font-bold text-[var(--text-900)]">{orders.filter(o => ['COMPLETED', 'REFUNDED'].includes(o.status)).length}</div>
          <div className="mt-1 text-xs text-[var(--text-500)]">已完成</div>
        </div>
      </section>

      {/* 标签页 */}
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-[var(--background-100)] p-1">
        {[
          { key: 'all', label: '全部', count: tasks.length },
          { key: 'open', label: '招募中', count: tasks.filter(t => t.status === 'OPEN' && !t.hasOrder).length },
          { key: 'in_progress', label: '进行中', count: orders.filter(o => ['PENDING_PAYMENT', 'IN_PROGRESS', 'DELIVERED'].includes(o.status)).length },
          { key: 'completed', label: '已完成', count: orders.filter(o => ['COMPLETED', 'CANCELED', 'REFUNDED'].includes(o.status)).length },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as 'all' | 'open' | 'in_progress' | 'completed')}
            className={`min-h-10 whitespace-nowrap rounded-lg px-4 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-[var(--brand-700)] shadow-sm'
                : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
            }`}
          >
            {tab.label}
            <span className="ml-1 text-xs text-[var(--text-400)]">{tab.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white text-sm text-[var(--text-500)]">
          <Loader2 className="mr-3 h-5 w-5 animate-spin text-[var(--brand-500)]" />
          正在读取数据...
        </div>
      ) : error ? (
        <WorkbenchStatePanel icon={CircleAlert} title="任务记录暂时无法加载" description={error} tone="error" />
      ) : filteredTasks.length === 0 && orders.length === 0 ? (
        <WorkbenchStatePanel icon={Inbox} title="还没有发布任务" description="发布首个任务后，可在这里持续跟进报价、支付、执行与验收。" action={<Link to="/tasks/new" className="btn-cs btn-primary btn-sm"><Plus className="h-4 w-4" />发布第一个任务</Link>} />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white divide-y divide-[color:var(--border)]">
          {filteredTasks.map((task) => {
            const order = getTaskOrder(task.id);
            const taskStatusViewResult = taskStatusView(task.status);
            const orderStatusViewResult = order ? orderStatusView(order.status) : null;
            const statusView = orderStatusViewResult || taskStatusViewResult;
            
            return (
              <div
                key={task.id}
                className="p-5 transition-colors hover:bg-[var(--background-100)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="truncate text-base font-semibold text-[var(--text-900)]">
                        {task.title}
                      </h3>
                      <span
                        className={`px-2 py-0.5 text-xs rounded border flex items-center gap-1 ${statusView.badge}`}
                      >
                        {'icon' in statusView && statusView.icon}
                        {statusView.label}
                      </span>
                    </div>
                    
                    {/* 状态描述 */}
                    {'description' in statusView && (
                      <p className="mb-2 text-xs text-[var(--text-500)]">{statusView.description}</p>
                    )}
                    
                    <p className="mb-3 line-clamp-2 text-sm leading-6 text-[var(--text-500)]">
                      {task.description || '暂无描述'}
                    </p>
                    
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-500)]">
                      <span>预算：<span className="font-medium text-[var(--text-800)]">¥{task.budgetCny || 0}</span></span>
                      {order ? (
                        <>
                          <span>成交价：<span className="font-medium text-[var(--text-800)]">¥{order.amountCny}</span></span>
                          <span>Agent：<span className="font-medium text-[var(--text-800)]">{order.bid?.agent?.name || '未知'}</span></span>
                        </>
                      ) : (
                        <span className="text-[var(--state-warning)]">等待 Agent 投标</span>
                      )}
                      <span>发布于: {formatShanghaiDate(task.createdAt)}</span>
                      {task.expectedDeliveryAt && (
                        <span>期望交付: {formatShanghaiDate(task.expectedDeliveryAt)}</span>
                      )}
                    </div>
                    
                    {/* 交付物信息 */}
                    {order?.deliveryUrl && (
                      <div className="mt-3 rounded-xl bg-[var(--background-100)] p-3">
                        <div className="mb-1 text-xs text-[var(--text-500)]">交付物</div>
                        <a 
                          href={order.deliveryUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm text-[var(--brand-600)] hover:text-[var(--brand-700)]"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {order.deliveryUrl}
                        </a>
                        {order.deliverySummary && (
                          <p className="mt-1 text-xs text-[var(--text-500)]">{order.deliverySummary}</p>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <Link
                      to={`/tasks/${task.id}`}
                      className="inline-flex min-h-9 items-center gap-1 rounded-full border border-[color:var(--border)] px-3 text-sm font-medium text-[var(--text-600)] hover:border-[var(--brand-300)] hover:text-[var(--brand-600)]"
                    >
                      查看详情
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                    
                    {/* 根据状态显示不同操作 */}
                    {order?.status === 'PENDING_PAYMENT' && (
                      <Link
                        to={`/orders/${order.id}`}
                        className="min-h-9 rounded-full bg-[var(--state-warning-surface)] px-3 py-2 text-center text-sm font-medium text-[var(--state-warning)]"
                      >
                        去支付
                      </Link>
                    )}
                    
                    {order?.status === 'DELIVERED' && (
                      <Link
                        to={`/orders/${order.id}`}
                        className="min-h-9 rounded-full bg-[var(--brand-50)] px-3 py-2 text-center text-sm font-medium text-[var(--brand-700)]"
                      >
                        去验收
                      </Link>
                    )}
                    
                    {order?.status === 'IN_PROGRESS' && (
                      <span className="text-center text-xs text-[var(--brand-600)]">
                        Agent 执行中...
                      </span>
                    )}
                    
                    {!order && task.status === 'OPEN' && (
                      <span className="text-center text-xs text-[var(--text-500)]">
                        等待 Agent 投标
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          
          {/* 显示纯订单（如果任务数据未加载出来）- 进行中标签页 */}
          {activeTab === 'in_progress' && orders
            .filter(o => !tasks.find(t => t.id === o.taskId) && ['PENDING_PAYMENT', 'IN_PROGRESS', 'DELIVERED'].includes(o.status))
            .map(order => {
              const orderStatusViewResult = orderStatusView(order.status);
              return (
                <div
                  key={order.id}
                  className="p-5 transition-colors hover:bg-[var(--background-100)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="truncate text-base font-semibold text-[var(--text-900)]">
                          {order.task?.title || '未知任务'}
                        </h3>
                        <span
                          className={`px-2 py-0.5 text-xs rounded border flex items-center gap-1 ${orderStatusViewResult.badge}`}
                        >
                          {orderStatusViewResult.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{orderStatusViewResult.description}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>成交价：<span className="font-medium text-[var(--text-800)]">¥{order.amountCny}</span></span>
                        <span>Agent：<span className="font-medium text-[var(--text-800)]">{order.bid?.agent?.name || '未知'}</span></span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Link
                        to={`/orders/${order.id}`}
                        className="inline-flex min-h-9 items-center rounded-full border border-[color:var(--border)] px-3 text-sm font-medium text-[var(--text-600)] hover:border-[var(--brand-300)] hover:text-[var(--brand-600)]"
                      >
                        查看订单
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          
          {/* 显示纯订单（如果任务数据未加载出来）- 已完成标签页 */}
          {activeTab === 'completed' && orders
            .filter(o => !tasks.find(t => t.id === o.taskId) && ['COMPLETED', 'CANCELED', 'REFUNDED'].includes(o.status))
            .map(order => {
              const orderStatusViewResult = orderStatusView(order.status);
              return (
                <div
                  key={order.id}
                  className="p-5 transition-colors hover:bg-[var(--background-100)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="truncate text-base font-semibold text-[var(--text-900)]">
                          {order.task?.title || '未知任务'}
                        </h3>
                        <span
                          className={`px-2 py-0.5 text-xs rounded border flex items-center gap-1 ${orderStatusViewResult.badge}`}
                        >
                          {orderStatusViewResult.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{orderStatusViewResult.description}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>成交价：<span className="font-medium text-[var(--text-800)]">¥{order.amountCny}</span></span>
                        <span>Agent：<span className="font-medium text-[var(--text-800)]">{order.bid?.agent?.name || '未知'}</span></span>
                        {order.acceptedAt && (
                          <span>完成于: {formatShanghaiDate(order.acceptedAt)}</span>
                        )}
                      </div>
                      
                      {/* 交付物信息 */}
                      {order.deliveryUrl && (
                        <div className="mt-3 rounded-xl bg-[var(--background-100)] p-3">
                          <div className="text-xs text-gray-500 mb-1">交付物:</div>
                          <a 
                            href={order.deliveryUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-sm text-[var(--brand-600)] hover:text-[var(--brand-700)]"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {order.deliveryUrl}
                          </a>
                          {order.deliverySummary && (
                            <p className="text-xs text-gray-500 mt-1">{order.deliverySummary}</p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <Link
                        to={`/orders/${order.id}`}
                        className="inline-flex min-h-9 items-center rounded-full border border-[color:var(--border)] px-3 text-sm font-medium text-[var(--text-600)] hover:border-[var(--brand-300)] hover:text-[var(--brand-600)]"
                      >
                        查看订单
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
        </section>
      )}
    </div>
  );
}


