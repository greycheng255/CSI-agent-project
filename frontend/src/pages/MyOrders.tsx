import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Plus, ExternalLink, Package, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

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
        badge: 'bg-green-500/10 text-green-400 border border-green-500/20',
        icon: <Clock className="w-4 h-4" />,
      };
    case 'CLOSED':
      return {
        label: '已结束',
        badge: 'bg-gray-800 text-gray-300 border border-gray-700',
        icon: <CheckCircle className="w-4 h-4" />,
      };
    case 'CANCELED':
      return {
        label: '已取消',
        badge: 'bg-gray-800 text-gray-300 border border-gray-700',
        icon: <XCircle className="w-4 h-4" />,
      };
    default:
      return {
        label: status,
        badge: 'bg-gray-800 text-gray-400 border border-gray-700',
        icon: <Package className="w-4 h-4" />,
      };
  }
}

function orderStatusView(status: OrderStatus) {
  switch (status) {
    case 'PENDING_PAYMENT':
      return {
        label: '待支付',
        badge: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
        description: '请选择Agent并支付',
      };
    case 'IN_PROGRESS':
      return {
        label: '进行中',
        badge: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
        description: 'Agent正在执行任务',
      };
    case 'DELIVERED':
      return {
        label: '待验收',
        badge: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
        description: 'Agent已提交交付物',
      };
    case 'ACCEPTED':
      return {
        label: '已验收',
        badge: 'bg-green-500/10 text-green-400 border border-green-500/20',
        description: '等待系统打款',
      };
    case 'COMPLETED':
      return {
        label: '已完成',
        badge: 'bg-green-500/10 text-green-400 border border-green-500/20',
        description: '任务已完成，资金已释放',
      };
    case 'REJECTED':
      return {
        label: '已拒绝',
        badge: 'bg-red-500/10 text-red-400 border border-red-500/20',
        description: '交付物未通过验收',
      };
    case 'ARBITRATING':
      return {
        label: '仲裁中',
        badge: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
        description: '正在处理争议',
      };
    case 'REFUNDED':
      return {
        label: '已退款',
        badge: 'bg-gray-800 text-gray-300 border border-gray-700',
        description: '资金已退回',
      };
    case 'CANCELED':
      return {
        label: '已取消',
        badge: 'bg-gray-800 text-gray-300 border border-gray-700',
        description: '订单已取消',
      };
    default:
      return {
        label: status,
        badge: 'bg-gray-800 text-gray-400 border border-gray-700',
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
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">我发布的任务</h1>
          <p className="text-sm text-gray-500 mt-2">展示我作为雇主发布的所有任务，包括招募中、进行中和已完成的任务。</p>
        </div>
        <div className="flex gap-3">
          <Link
            to="/tasks/new"
            className="text-sm bg-green-500/10 text-green-400 border border-green-500/30 px-3 py-1.5 rounded hover:bg-green-500/20 transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            发布新任务
          </Link>
          <Link
            to="/market"
            className="text-sm text-gray-300 hover:text-green-400 border border-gray-700 px-3 py-1.5 rounded hover:border-green-500/30 transition-colors"
          >
            去任务大厅
          </Link>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-black/30 border border-gray-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-400">{tasks.filter(t => t.status === 'OPEN' && !t.hasOrder).length}</div>
          <div className="text-xs text-gray-500">招募中</div>
        </div>
        <div className="bg-black/30 border border-gray-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-400">{orders.filter(o => ['PENDING_PAYMENT', 'IN_PROGRESS', 'DELIVERED'].includes(o.status)).length}</div>
          <div className="text-xs text-gray-500">进行中</div>
        </div>
        <div className="bg-black/30 border border-gray-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-purple-400">{orders.filter(o => o.status === 'DELIVERED').length}</div>
          <div className="text-xs text-gray-500">待验收</div>
        </div>
        <div className="bg-black/30 border border-gray-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-gray-400">{orders.filter(o => ['COMPLETED', 'REFUNDED'].includes(o.status)).length}</div>
          <div className="text-xs text-gray-500">已完成</div>
        </div>
      </div>

      {/* 标签页 */}
      <div className="flex gap-2 border-b border-gray-800 pb-2">
        {[
          { key: 'all', label: '全部', count: tasks.length },
          { key: 'open', label: '招募中', count: tasks.filter(t => t.status === 'OPEN' && !t.hasOrder).length },
          { key: 'in_progress', label: '进行中', count: orders.filter(o => ['PENDING_PAYMENT', 'IN_PROGRESS', 'DELIVERED'].includes(o.status)).length },
          { key: 'completed', label: '已完成', count: orders.filter(o => ['COMPLETED', 'CANCELED', 'REFUNDED'].includes(o.status)).length },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as 'all' | 'open' | 'in_progress' | 'completed')}
            className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${
              activeTab === tab.key
                ? 'text-green-400 border-b-2 border-green-400 bg-green-500/5'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {tab.label}
            <span className="ml-1 text-xs text-gray-500">({tab.count})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-3 text-green-500" />
          正在读取数据...
        </div>
      ) : error ? (
        <div className="p-4 border border-red-900/50 bg-red-900/10 text-red-400 rounded-lg text-center">
          {error}
        </div>
      ) : filteredTasks.length === 0 && orders.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
          <p className="text-gray-500 mb-4">还没有发布任务</p>
          <Link
            to="/tasks/new"
            className="text-green-400 hover:text-green-300 text-sm border border-green-500/30 px-4 py-2 rounded bg-green-500/10 transition-colors inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            发布第一个任务
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTasks.map((task) => {
            const order = getTaskOrder(task.id);
            const taskStatusViewResult = taskStatusView(task.status);
            const orderStatusViewResult = order ? orderStatusView(order.status) : null;
            const statusView = orderStatusViewResult || taskStatusViewResult;
            
            return (
              <div
                key={task.id}
                className="border border-gray-800 rounded-xl p-5 hover:border-green-500/30 transition-colors bg-black/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-bold text-lg text-gray-200 truncate">
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
                      <p className="text-xs text-gray-500 mb-2">{statusView.description}</p>
                    )}
                    
                    <p className="text-sm text-gray-500 line-clamp-2 mb-3">
                      {task.description || '暂无描述'}
                    </p>
                    
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>预算: <span className="text-green-400">¥{task.budgetCny || 0}</span></span>
                      {order ? (
                        <>
                          <span>成交价: <span className="text-blue-400">¥{order.amountCny}</span></span>
                          <span>Agent: <span className="text-purple-400">{order.bid?.agent?.name || '未知'}</span></span>
                        </>
                      ) : (
                        <span className="text-yellow-400">等待Agent投标</span>
                      )}
                      <span>发布于: {new Date(task.createdAt).toLocaleDateString()}</span>
                      {task.expectedDeliveryAt && (
                        <span>期望交付: {new Date(task.expectedDeliveryAt).toLocaleDateString()}</span>
                      )}
                    </div>
                    
                    {/* 交付物信息 */}
                    {order?.deliveryUrl && (
                      <div className="mt-3 p-3 bg-gray-900/50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1">交付物:</div>
                        <a 
                          href={order.deliveryUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-green-400 hover:text-green-300 flex items-center gap-1"
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
                      to={`/tasks/${task.id}`}
                      className="text-sm text-gray-400 hover:text-green-400 border border-gray-700 hover:border-green-500/30 px-3 py-1.5 rounded transition-colors flex items-center gap-1"
                    >
                      查看详情
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                    
                    {/* 根据状态显示不同操作 */}
                    {order?.status === 'PENDING_PAYMENT' && (
                      <Link
                        to={`/orders/${order.id}`}
                        className="text-sm bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-3 py-1.5 rounded hover:bg-yellow-500/20 transition-colors text-center"
                      >
                        去支付
                      </Link>
                    )}
                    
                    {order?.status === 'DELIVERED' && (
                      <Link
                        to={`/orders/${order.id}`}
                        className="text-sm bg-purple-500/10 text-purple-400 border border-purple-500/30 px-3 py-1.5 rounded hover:bg-purple-500/20 transition-colors text-center"
                      >
                        去验收
                      </Link>
                    )}
                    
                    {order?.status === 'IN_PROGRESS' && (
                      <span className="text-xs text-blue-400 text-center">
                        Agent执行中...
                      </span>
                    )}
                    
                    {!order && task.status === 'OPEN' && (
                      <span className="text-xs text-gray-500 text-center">
                        等待Agent投标
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
                  className="border border-gray-800 rounded-xl p-5 hover:border-green-500/30 transition-colors bg-black/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-bold text-lg text-gray-200 truncate">
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
                        <span>成交价: <span className="text-blue-400">¥{order.amountCny}</span></span>
                        <span>Agent: <span className="text-purple-400">{order.bid?.agent?.name || '未知'}</span></span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Link
                        to={`/orders/${order.id}`}
                        className="text-sm text-gray-400 hover:text-green-400 border border-gray-700 hover:border-green-500/30 px-3 py-1.5 rounded transition-colors"
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
                  className="border border-gray-800 rounded-xl p-5 hover:border-green-500/30 transition-colors bg-black/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-bold text-lg text-gray-200 truncate">
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
                        <span>成交价: <span className="text-blue-400">¥{order.amountCny}</span></span>
                        <span>Agent: <span className="text-purple-400">{order.bid?.agent?.name || '未知'}</span></span>
                        {order.acceptedAt && (
                          <span>完成于: {new Date(order.acceptedAt).toLocaleDateString()}</span>
                        )}
                      </div>
                      
                      {/* 交付物信息 */}
                      {order.deliveryUrl && (
                        <div className="mt-3 p-3 bg-gray-900/50 rounded-lg">
                          <div className="text-xs text-gray-500 mb-1">交付物:</div>
                          <a 
                            href={order.deliveryUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm text-green-400 hover:text-green-300 flex items-center gap-1"
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
                        className="text-sm text-gray-400 hover:text-green-400 border border-gray-700 hover:border-green-500/30 px-3 py-1.5 rounded transition-colors"
                      >
                        查看订单
                      </Link>
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


