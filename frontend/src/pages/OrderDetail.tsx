import { useCallback, useEffect, useState, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  MessageSquare,
  Package,
  RefreshCw,
  ShieldCheck,
  UserCircle2,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import DeliveryHistory from '../components/DeliveryHistory';
import DeliveryForm from '../components/DeliveryForm';
import AcceptanceChecklist from '../components/AcceptanceChecklist';
import { acceptDelivery, rejectDelivery } from '../api/deliveryApi';
import type { Delivery } from '../types/delivery';
import { formatShanghaiDateTime } from '../utils/date';

type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'IN_PROGRESS'
  | 'DELIVERED'
  | 'ACCEPTED'
  | 'PENDING_RELEASE'
  | 'COMPLETED'
  | 'REJECTED'
  | 'ARBITRATING'
  | 'REFUNDED'
  | 'CANCELED';

type LogEntry = {
  message: string;
};

type ApiSubTask = {
  id: string;
  name: string;
  description: string;
  status: 'RUNNING' | 'PENDING' | 'COMPLETED' | 'FAILED';
  progress: number;
  startedAt?: string;
  completedAt?: string;
  logs?: LogEntry[];
  result?: string;
};

type ApiPhase = {
  id: string;
  name: string;
  description: string;
  status: 'RUNNING' | 'PENDING' | 'COMPLETED' | 'FAILED';
  progress: number;
  startedAt?: string;
  completedAt?: string;
  subTasks: ApiSubTask[];
};

type SubTask = {
  id: string;
  name: string;
  description: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  progress: number;
  startTime?: string;
  endTime?: string;
  logs?: string[];
  result?: string;
};

type ExecutionPhase = {
  id: string;
  name: string;
  description: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  progress: number;
  subTasks: SubTask[];
  startTime?: string;
  endTime?: string;
};

type Order = {
  id: string;
  status: OrderStatus;
  amountCny: number;
  platformFeeCny?: number | null;
  payoutCny?: number | null;
  escrowedAt?: string | null;
  deliveredAt?: string | null;
  acceptedAt?: string | null;
  releasedAt?: string | null;
  deliverySummary?: string | null;
  deliveryUrl?: string | null;
  task?: { 
    id: string;
    title: string;
    description?: string;
  };
  bid?: { 
    id: string;
    agent?: { name: string };
    pricingMeta?: {
      evaluation?: {
        executionPlan?: string[];
        analysis?: string;
        estimatedHours?: number;
        complexityCn?: string;
      };
    };
  };
  client?: { id: string };
  owner?: { id: string };
  execution?: {
    totalProgress: number;
    status: string;
    phases: ApiPhase[];
  };
  executionPhases?: ExecutionPhase[];
  deliveryHistory?: Delivery[];
};

type PlatformPaymentCode = {
  id: string;
  type: 'ALIPAY' | 'WECHAT';
  qrCodeUrl: string;
  accountName: string;
  isActive: boolean;
};

// 模拟执行阶段数据（实际应该从后端获取）
const generateExecutionPhases = (order: Order): ExecutionPhase[] => {
  const plan = order.bid?.pricingMeta?.evaluation?.executionPlan || [];
  
  // 根据执行计划生成阶段
  const phases: ExecutionPhase[] = [];
  // 需求分析阶段
  if (plan.some(p => p.includes('需求分析'))) {
    phases.push({
      id: 'phase-1',
      name: '需求分析',
      description: '分析任务需求，确定数据字段和来源',
      status: order.status === 'IN_PROGRESS' ? 'COMPLETED' : 'PENDING',
      progress: 100,
      startTime: order.escrowedAt || undefined,
      endTime: order.escrowedAt || undefined,
      subTasks: [
        {
          id: 'task-1-1',
          name: '页面结构分析',
          description: '使用开发者工具分析目标页面',
          status: 'COMPLETED',
          progress: 100,
          logs: ['已分析页面结构', '确定了CSS选择器'],
        },
        {
          id: 'task-1-2',
          name: '数据字段确认',
          description: '确认需要采集的数据字段',
          status: 'COMPLETED',
          progress: 100,
          logs: ['已确认8个数据字段：点赞数、评论数、收藏数、转发数、作者信息、主页链接、产品信息、链接'],
        },
      ],
    });
  }
  
  // 核心爬取阶段
  phases.push({
    id: 'phase-2',
    name: '核心爬取逻辑开发',
    description: '实现数据抓取和解析功能',
    status: order.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PENDING',
    progress: order.status === 'IN_PROGRESS' ? 60 : 0,
    startTime: order.escrowedAt || undefined,
    subTasks: [
      {
        id: 'task-2-1',
        name: 'HTTP请求模块',
        description: '发送HTTP请求获取页面HTML',
        status: 'COMPLETED',
        progress: 100,
        logs: ['已实现请求模块', '添加了重试机制'],
      },
      {
        id: 'task-2-2',
        name: 'HTML解析模块',
        description: '使用BeautifulSoup解析HTML',
        status: 'COMPLETED',
        progress: 100,
        logs: ['已配置BeautifulSoup解析器'],
      },
      {
        id: 'task-2-3',
        name: '数据提取逻辑',
        description: '根据CSS选择器提取数据字段',
        status: 'IN_PROGRESS',
        progress: 40,
        logs: ['正在提取点赞数、评论数等字段...'],
      },
    ],
  });
  
  // 数据存储阶段
  phases.push({
    id: 'phase-3',
    name: '数据存储',
    description: '将提取的数据保存到文件',
    status: 'PENDING',
    progress: 0,
    subTasks: [
      {
        id: 'task-3-1',
        name: '数据结构定义',
        description: '定义数据结构和字段映射',
        status: 'PENDING',
        progress: 0,
      },
      {
        id: 'task-3-2',
        name: '导出功能实现',
        description: '实现JSON/CSV导出功能',
        status: 'PENDING',
        progress: 0,
      },
    ],
  });
  
  // 健壮性处理阶段
  phases.push({
    id: 'phase-4',
    name: '健壮性处理',
    description: '添加异常处理和反爬策略',
    status: 'PENDING',
    progress: 0,
    subTasks: [
      {
        id: 'task-4-1',
        name: '异常处理',
        description: '处理网络超时和异常',
        status: 'PENDING',
        progress: 0,
      },
      {
        id: 'task-4-2',
        name: '日志记录',
        description: '记录操作日志',
        status: 'PENDING',
        progress: 0,
      },
    ],
  });
  
  return phases;
};

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const apiBase = API_BASE;
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [expandedPhases, setExpandedPhases] = useState<string[]>([]);
  const [helpMessage, setHelpMessage] = useState('');
  const [sendingHelp, setSendingHelp] = useState(false);
  const [retrying, setRetrying] = useState(false);
  
  // 平台收款码相关状态
  const [platformCodes, setPlatformCodes] = useState<PlatformPaymentCode[]>([]);
  const [selectedCode, setSelectedCode] = useState<PlatformPaymentCode | null>(null);
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [paymentProofPreview, setPaymentProofPreview] = useState<string>('');
  const [uploadingProof, setUploadingProof] = useState(false);

  const fetchOrder = useCallback(() => {
    if (!id) return;
    setLoading(true);
    fetch(`${apiBase}/api/v1/orders/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error('获取订单详情失败');
        return res.json();
      })
      .then(async (response: Order | Order[]) => {
        const data = Array.isArray(response)
          ? response.find((item) => item.id === id)
          : response;
        if (!data?.id) throw new Error('未找到订单');

        if (data.execution?.phases?.length) {
          data.executionPhases = data.execution.phases.map((phase: ApiPhase) => ({
            id: phase.id,
            name: phase.name,
            description: phase.description,
            status: phase.status === 'RUNNING' ? 'IN_PROGRESS' :
                    phase.status === 'PENDING' ? 'PENDING' :
                    phase.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
            progress: phase.progress,
            startTime: phase.startedAt,
            endTime: phase.completedAt,
            subTasks: (phase.subTasks || []).map((subTask: ApiSubTask) => ({
              id: subTask.id,
              name: subTask.name,
              description: subTask.description,
              status: subTask.status === 'RUNNING' ? 'IN_PROGRESS' :
                      subTask.status === 'PENDING' ? 'PENDING' :
                      subTask.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
              progress: subTask.progress,
              startTime: subTask.startedAt,
              endTime: subTask.completedAt,
              logs: subTask.logs?.map((log: LogEntry) => log.message) || [],
              result: subTask.result,
            })),
          }));
          setOrder(data);
          setLoading(false);
          return;
        }
        // 非执行中的订单优先展示履约结果与资金信息，避免等待无意义的进度请求。
        if (data.status !== 'IN_PROGRESS') {
          data.executionPhases = [];
          setOrder(data);
          setLoading(false);
          return;
        }
        // 尝试获取真实的执行进度数据
        try {
          const token = useAuthStore.getState().token;
          const progressRes = await fetch(`${apiBase}/api/v1/execution/orders/${id}/progress`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          });

          if (progressRes.ok) {
            const progressData = await progressRes.json();
            if (progressData.success && progressData.data && progressData.data.phases.length > 0) {
              // 使用真实的执行进度数据
              data.executionPhases = progressData.data.phases.map((phase: ApiPhase) => ({
                id: phase.id,
                name: phase.name,
                description: phase.description,
                status: phase.status === 'RUNNING' ? 'IN_PROGRESS' :
                        phase.status === 'PENDING' ? 'PENDING' :
                        phase.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
                progress: phase.progress,
                startTime: phase.startedAt,
                endTime: phase.completedAt,
                subTasks: phase.subTasks.map((subTask: ApiSubTask) => ({
                  id: subTask.id,
                  name: subTask.name,
                  description: subTask.description,
                  status: subTask.status === 'RUNNING' ? 'IN_PROGRESS' :
                          subTask.status === 'PENDING' ? 'PENDING' :
                          subTask.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
                  progress: subTask.progress,
                  startTime: subTask.startedAt,
                  endTime: subTask.completedAt,
                  logs: subTask.logs?.map((log: LogEntry) => log.message) || [],
                  result: subTask.result,
                })),
              }));
            } else {
              // 没有真实数据，使用模拟数据
              data.executionPhases = generateExecutionPhases(data);
            }
          } else {
            // API 调用失败，使用模拟数据
            data.executionPhases = generateExecutionPhases(data);
          }
        } catch {
          // 获取真实进度失败，使用模拟数据
          data.executionPhases = generateExecutionPhases(data);
        }
        setOrder(data);
        setLoading(false);
      })
      .catch(() => {
        setOrder(null);
        setLoading(false);
      });
  }, [apiBase, id]);

  // 获取平台收款码
  const fetchPlatformCodes = useCallback(() => {
    const token = useAuthStore.getState().token;
    fetch(`${apiBase}/api/v1/payments/platform-codes`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401) {
            console.error('获取收款码失败：未登录');
            return [];
          }
          throw new Error('获取收款码失败');
        }
        return res.json();
      })
      .then((response) => {
        const data = response.data || response;
        setPlatformCodes(Array.isArray(data) ? data : []);
        if (data.length > 0 && !selectedCode) {
          setSelectedCode(data[0]);
        }
      })
      .catch((err) => {
        console.error('获取平台收款码失败:', err);
        setPlatformCodes([]);
      });
  }, [apiBase, selectedCode]);

  useEffect(() => {
    fetchOrder();
    fetchPlatformCodes();
    // 轮询订单状态
    const status = order?.status;
    const timer = setInterval(() => {
      if (
        status === 'PENDING_PAYMENT' ||
        status === 'IN_PROGRESS' ||
        status === 'ACCEPTED' ||
        status === 'REJECTED'
      ) {
        fetchOrder();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [fetchOrder, fetchPlatformCodes, order?.status]);

  // 切换阶段展开/折叠
  const togglePhase = (phaseId: string) => {
    setExpandedPhases(prev => 
      prev.includes(phaseId) 
        ? prev.filter(id => id !== phaseId)
        : [...prev, phaseId]
    );
  };

  // 计算总进度
  const calculateTotalProgress = (phases?: ExecutionPhase[]) => {
    if (!phases || phases.length === 0) return 0;
    const totalProgress = phases.reduce((sum, phase) => sum + phase.progress, 0);
    return Math.round(totalProgress / phases.length);
  };

  // 发送求助消息
  const handleSendHelp = async () => {
    if (!helpMessage.trim()) return;
    setSendingHelp(true);
    // 模拟发送求助消息
    await new Promise(resolve => setTimeout(resolve, 1000));
    alert('求助消息已发送给雇主');
    setHelpMessage('');
    setSendingHelp(false);
  };

  // 重试执行任务
  const handleRetry = async () => {
    if (!id) return;
    
    const confirmed = window.confirm('确定要重新执行任务吗？系统将根据上次失败原因调整策略并重新生成代码。');
    if (!confirmed) return;
    
    setRetrying(true);
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_BASE}/api/v1/execution/orders/${id}/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
      });
      
      if (res.ok) {
        await res.json();
        alert('重试已启动！系统将重新生成代码并执行。');
        // 刷新订单状态
        fetchOrder();
      } else {
        const error = await res.json();
        alert(`重试失败: ${error.error || '未知错误'}`);
      }
    } catch {
      alert('重试请求失败，请检查网络连接');
    } finally {
      setRetrying(false);
    }
  };

  // 处理支付凭证文件选择
  const handleProofFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPaymentProof(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPaymentProofPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // 提交支付凭证
  const handleSubmitPayment = async () => {
    if (!user) {
      alert('请先登录雇主账号再支付');
      navigate('/login');
      return;
    }
    if (!selectedCode) {
      alert('请选择支付方式');
      return;
    }
    if (!paymentProof) {
      alert('请上传支付凭证截图');
      return;
    }
    
    setUploadingProof(true);
    try {
      // 1. 上传支付凭证
      const formData = new FormData();
      formData.append('file', paymentProof);
      formData.append('platformCodeId', selectedCode.id);
      
      const uploadRes = await fetch(`${apiBase}/api/v1/orders/${id}/payment-proof`, {
        method: 'POST',
        body: formData,
      });
      
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => null);
        alert(err?.message || '上传支付凭证失败');
        return;
      }
      
      // 2. 确认支付
      const payRes = await fetch(`${apiBase}/api/v1/orders/${id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      
      if (payRes.ok) {
        fetchOrder();
        setPaymentProof(null);
        setPaymentProofPreview('');
        alert('支付凭证已提交，等待平台确认');
      } else {
        const err = await payRes.json().catch(() => null);
        alert(err?.message || '支付确认失败');
      }
    } catch (err) {
      console.error(err);
      alert('提交支付凭证失败');
    } finally {
      setUploadingProof(false);
    }
  };

  // 旧的交付处理函数已移除，使用 deliveryApi.ts 中的新函数

  const handleCancel = async () => {
    if (!user) {
      alert('请先登录');
      navigate('/login');
      return;
    }
    if (!confirm('确定要取消此订单吗？')) return;
    setCanceling(true);
    try {
      const res = await fetch(`${apiBase}/api/v1/orders/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (res.ok) {
        fetchOrder();
        alert('订单已取消');
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.message || '取消失败');
      }
    } catch {
      alert('取消请求失败');
    } finally {
      setCanceling(false);
    }
  };

  const statusView = (status: OrderStatus) => {
    switch (status) {
      case 'PENDING_PAYMENT':
        return { label: '待支付', cls: 'bg-[color:var(--state-warning-surface)] text-[color:var(--state-warning)]' };
      case 'IN_PROGRESS':
        return { label: '进行中', cls: 'bg-[color:var(--brand-50)] text-[color:var(--brand-700)]' };
      case 'DELIVERED':
        return { label: '待验收', cls: 'bg-[#f3efff] text-[#6544a5]' };
      case 'ACCEPTED':
        return { label: '已验收', cls: 'bg-[color:var(--state-success-surface)] text-[color:var(--state-success-text)]' };
      case 'PENDING_RELEASE':
        return { label: '待放款', cls: 'bg-[color:var(--state-warning-surface)] text-[color:var(--state-warning)]' };
      case 'COMPLETED':
        return { label: '已完成', cls: 'bg-[color:var(--state-success-surface)] text-[color:var(--state-success-text)]' };
      case 'REJECTED':
        return { label: '已拒绝', cls: 'bg-[color:var(--state-error-surface)] text-[color:var(--state-error)]' };
      case 'ARBITRATING':
        return { label: '仲裁中', cls: 'bg-[color:var(--state-error-surface)] text-[color:var(--state-error)]' };
      case 'REFUNDED':
        return { label: '已退款', cls: 'bg-[color:var(--background-200)] text-[color:var(--text-500)]' };
      case 'CANCELED':
        return { label: '已取消', cls: 'bg-[color:var(--background-200)] text-[color:var(--text-500)]' };
      default:
        return { label: status, cls: 'bg-[color:var(--background-200)] text-[color:var(--text-500)]' };
    }
  };

  const getPhaseStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-[color:var(--state-success-surface)] text-[color:var(--state-success-text)]';
      case 'IN_PROGRESS':
        return 'bg-[color:var(--brand-50)] text-[color:var(--brand-700)]';
      case 'FAILED':
        return 'bg-[color:var(--state-error-surface)] text-[color:var(--state-error)]';
      default:
        return 'bg-[color:var(--background-200)] text-[color:var(--text-500)]';
    }
  };

  const getPhaseStatusLabel = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return '已完成';
      case 'IN_PROGRESS':
        return '进行中';
      case 'FAILED':
        return '失败';
      default:
        return '待开始';
    }
  };

  if (loading) {
    return (
      <div className="w-full space-y-4 py-8" aria-label="正在加载订单详情">
        <div className="h-8 w-48 animate-pulse rounded bg-[color:var(--background-200)]" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-96 animate-pulse rounded-2xl bg-[color:var(--background-200)]" />
          <div className="h-80 animate-pulse rounded-2xl bg-[color:var(--background-200)]" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="rounded-2xl border border-dashed border-[color:var(--background-400)] px-6 py-16 text-center">
        <Package className="mx-auto h-9 w-9 text-[color:var(--text-400)]" />
        <h1 className="mt-4 text-xl font-bold text-[color:var(--text-900)]">未找到订单</h1>
        <p className="mt-2 text-sm text-[color:var(--text-500)]">订单可能已取消，或当前链接无效。</p>
        <Link to="/market" className="btn-cs btn-primary mt-6">返回任务大厅</Link>
      </div>
    );
  }

  const sv = statusView(order.status);
  const totalProgress = calculateTotalProgress(order.executionPhases);
  const isOwner = user?.id === order.owner?.id;
  const isClient = user?.id === order.client?.id;

  return (
    <div className="w-full pb-10">
      <Link
        to={order.task?.id ? `/tasks/${order.task.id}` : '/market'}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-[color:var(--brand-600)] transition-colors hover:text-[color:var(--brand-700)]"
      >
        <ArrowLeft className="h-4 w-4" />
        {order.task?.id ? '返回任务详情' : '返回任务大厅'}
      </Link>

      <div className="mt-3 grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,1fr)] xl:gap-6">
        <main className="min-w-0 self-start rounded-2xl border border-[color:var(--border)] bg-white px-5 py-6 md:px-7">
          <header className="border-b border-[color:var(--border)] pb-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-[color:var(--text-500)]">ORDER#{order.id.slice(0, 12)}</span>
              <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ${sv.cls}`}>
                {sv.label}
              </span>
            </div>
            <h1 className="max-w-4xl text-2xl font-bold tracking-tight text-[color:var(--text-900)] md:text-[28px]">
              {order.task?.title || '未知任务'}
            </h1>
            {order.task?.description && (
              <p className="mt-3 max-w-[75ch] text-sm leading-7 text-[color:var(--text-600)]">
                {order.task.description}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[color:var(--text-500)]">
              <span className="inline-flex items-center gap-1.5">
                <UserCircle2 className="h-4 w-4" />
                任务方 {order.client?.id ? '雇主用户' : '信息暂不可见'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Package className="h-4 w-4" />
                执行智能体 {order.bid?.agent?.name || '尚未分配'}
              </span>
            </div>
          </header>

          <div className="divide-y divide-[color:var(--border)]">
            {order.status === 'IN_PROGRESS' && (
              <section className="py-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="flex items-center gap-2 text-base font-bold text-[color:var(--text-900)]">
                      <Clock className="h-4 w-4 text-[color:var(--brand-500)]" />
                      执行进度
                    </h2>
                    <p className="mt-1 text-sm text-[color:var(--text-500)]">
                      预计 {order.bid?.pricingMeta?.evaluation?.estimatedHours || '-'} 小时 ·
                      复杂度 {order.bid?.pricingMeta?.evaluation?.complexityCn || '-'}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <strong className="text-2xl text-[color:var(--brand-700)]">{totalProgress}%</strong>
                    <button
                      onClick={handleRetry}
                      disabled={retrying}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[color:var(--brand-300)] px-3 text-sm font-semibold text-[color:var(--brand-700)] transition-colors hover:bg-[color:var(--brand-50)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {retrying ? '重试中...' : '重新执行'}
                    </button>
                  </div>
                </div>
                <div className="mt-4 h-2.5 w-full rounded-full bg-[color:var(--background-200)]">
                  <div
                    className="h-2.5 rounded-full bg-[color:var(--brand-500)] transition-all duration-500"
                    style={{ width: `${totalProgress}%` }}
                  />
                </div>

                {order.executionPhases && order.executionPhases.length > 0 && (
                  <div className="mt-5 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
                    {order.executionPhases.map((phase, index) => (
                      <article key={phase.id}>
                        <button
                          onClick={() => togglePhase(phase.id)}
                          className="flex min-h-16 w-full items-center justify-between gap-3 px-1 py-3 text-left transition-colors hover:bg-[color:var(--background-100)]"
                        >
                          <span className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 text-xs text-[color:var(--text-500)]">{index + 1}</span>
                            <span className="min-w-0">
                              <span className="block font-medium text-[color:var(--text-800)]">{phase.name}</span>
                              <span className="mt-0.5 block truncate text-xs text-[color:var(--text-500)]">{phase.description}</span>
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-3">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getPhaseStatusColor(phase.status)}`}>
                              {getPhaseStatusLabel(phase.status)}
                            </span>
                            <span className="text-sm text-[color:var(--text-500)]">{phase.progress}%</span>
                            {expandedPhases.includes(phase.id)
                              ? <ChevronUp className="h-4 w-4 text-[color:var(--text-500)]" />
                              : <ChevronDown className="h-4 w-4 text-[color:var(--text-500)]" />}
                          </span>
                        </button>
                        {expandedPhases.includes(phase.id) && (
                          <div className="border-t border-[color:var(--border)] bg-[color:var(--background-100)] px-4 py-4">
                            <div className="space-y-3">
                              {phase.subTasks.map((task) => (
                                <div key={task.id} className="flex items-start gap-3">
                                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                                    task.status === 'COMPLETED' ? 'bg-[color:var(--state-success)]' :
                                    task.status === 'IN_PROGRESS' ? 'bg-[color:var(--brand-500)]' :
                                    task.status === 'FAILED' ? 'bg-[color:var(--state-error)]' :
                                    'bg-[color:var(--background-500)]'
                                  }`} />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-[color:var(--text-800)]">{task.name}</p>
                                    <p className="text-xs text-[color:var(--text-500)]">{task.description}</p>
                                    {task.logs?.map((log, logIndex) => (
                                      <p key={logIndex} className="mt-1 text-xs text-[color:var(--text-500)]">• {log}</p>
                                    ))}
                                  </div>
                                  <span className="text-xs text-[color:var(--text-500)]">{task.progress}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}

            {isOwner && order.status === 'IN_PROGRESS' && (
              <section className="py-6">
                <h2 className="flex items-center gap-2 text-base font-bold text-[color:var(--text-900)]">
                  <AlertCircle className="h-4 w-4 text-[color:var(--state-warning)]" />
                  执行求助
                </h2>
                <p className="mt-1 text-sm text-[color:var(--text-500)]">遇到阻碍时可向任务方发送说明。</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={helpMessage}
                    onChange={(event) => setHelpMessage(event.target.value)}
                    placeholder="描述您遇到的问题..."
                    className="h-11 flex-1 rounded-xl border border-[color:var(--border)] bg-white px-3 text-sm text-[color:var(--text-800)] outline-none placeholder:text-[color:var(--text-500)] focus:border-[color:var(--brand-500)] focus:ring-4 focus:ring-blue-500/10"
                  />
                  <button
                    onClick={handleSendHelp}
                    disabled={sendingHelp || !helpMessage.trim()}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[color:var(--state-warning)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sendingHelp ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                    发送求助
                  </button>
                </div>
              </section>
            )}

            {['DELIVERED', 'ACCEPTED', 'PENDING_RELEASE', 'COMPLETED', 'REJECTED', 'ARBITRATING'].includes(order.status) && (
              <DeliveryHistory
                orderId={order.id}
                initialDeliveries={order.deliveryHistory}
                embedded
              />
            )}

            {(isClient || isOwner) && ['DELIVERED', 'ACCEPTED', 'PENDING_RELEASE', 'COMPLETED'].includes(order.status) && (
              <AcceptanceChecklist
                orderId={order.id}
                userId={user?.id || ''}
                isClient={isClient}
                orderStatus={order.status}
                onStatusChange={fetchOrder}
                embedded
              />
            )}

            {isOwner && ['IN_PROGRESS', 'DELIVERED'].includes(order.status) && (
              <DeliveryForm
                orderId={order.id}
                userId={user?.id || ''}
                onSuccess={() => {
                  fetchOrder();
                  alert('交付提交成功！');
                }}
                onCancel={() => {}}
                embedded
              />
            )}

            {isClient && order.status === 'DELIVERED' && (
              <section className="py-6">
                <h2 className="text-base font-bold text-[color:var(--text-900)]">验收操作</h2>
                <p className="mt-1 text-sm text-[color:var(--text-500)]">请先逐项核对检查清单，再确认验收或退回修改。</p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={async () => {
                      if (!window.confirm('确认验收此交付？资金将释放给开发者。')) return;
                      setAccepting(true);
                      try {
                        await acceptDelivery(order.id, user?.id || '');
                        fetchOrder();
                        alert('验收成功！');
                      } catch (err) {
                        alert(err instanceof Error ? err.message : '验收失败');
                      } finally {
                        setAccepting(false);
                      }
                    }}
                    disabled={accepting}
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[color:var(--state-success-text)] px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    确认验收
                  </button>
                  <button
                    onClick={() => document.getElementById('reject-section')?.scrollIntoView({ behavior: 'smooth' })}
                    className="min-h-11 rounded-xl bg-[color:var(--state-error-surface)] px-4 font-semibold text-[color:var(--state-error)]"
                  >
                    退回修改
                  </button>
                </div>
                <div id="reject-section" className="mt-4 border-t border-[color:var(--border)] pt-4">
                  <label className="mb-2 block text-sm font-medium text-[color:var(--text-600)]">原因说明</label>
                  <textarea
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    placeholder="说明需要修改的地方..."
                    className="mb-3 w-full rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-[color:var(--text-800)] outline-none placeholder:text-[color:var(--text-500)] focus:border-[color:var(--state-error)] focus:ring-4 focus:ring-red-500/10"
                    rows={2}
                  />
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      onClick={async () => {
                        if (!rejectReason.trim()) {
                          alert('请填写退回原因');
                          return;
                        }
                        if (!window.confirm('退回给开发者修改？开发者可以重新提交交付。')) return;
                        setRejecting(true);
                        try {
                          await rejectDelivery(order.id, user?.id || '', { reason: rejectReason, requireRevision: true });
                          fetchOrder();
                          alert('已退回给开发者修改');
                        } catch (err) {
                          alert(err instanceof Error ? err.message : '操作失败');
                        } finally {
                          setRejecting(false);
                        }
                      }}
                      disabled={rejecting}
                      className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[color:var(--state-warning)] px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {rejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
                      退回修改
                    </button>
                    <button
                      onClick={async () => {
                        if (!rejectReason.trim()) {
                          alert('请填写拒绝原因');
                          return;
                        }
                        if (!window.confirm('确认拒绝并发起仲裁？这将进入平台仲裁流程。')) return;
                        setRejecting(true);
                        try {
                          await rejectDelivery(order.id, user?.id || '', { reason: rejectReason, requireRevision: false });
                          fetchOrder();
                          alert('已拒绝并发起仲裁');
                        } catch (err) {
                          alert(err instanceof Error ? err.message : '操作失败');
                        } finally {
                          setRejecting(false);
                        }
                      }}
                      disabled={rejecting}
                      className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[color:var(--state-error)] px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {rejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
                      拒绝并仲裁
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        </main>

        <aside className="self-start rounded-2xl border border-[color:var(--border)] bg-white px-5 py-6 md:px-6 lg:sticky lg:top-20">
          <section>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[color:var(--text-500)]">订单金额</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-[color:var(--text-900)]">
                  ¥{order.amountCny.toLocaleString('zh-CN')}
                </p>
              </div>
              <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ${sv.cls}`}>
                {sv.label}
              </span>
            </div>
            <dl className="mt-5 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)] text-sm">
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-[color:var(--text-500)]">平台服务费</dt>
                <dd className="font-semibold text-[color:var(--text-700)]">-¥{order.platformFeeCny ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-[color:var(--text-500)]">执行方实得</dt>
                <dd className="font-bold text-[color:var(--state-success-text)]">
                  ¥{(order.payoutCny ?? order.amountCny).toLocaleString('zh-CN')}
                </dd>
              </div>
            </dl>
          </section>

          <section className="border-b border-[color:var(--border)] py-6">
            <h2 className="flex items-center gap-2 text-base font-bold text-[color:var(--text-900)]">
              <UserCircle2 className="h-4 w-4 text-[color:var(--brand-500)]" />
              参与方
            </h2>
            <dl className="mt-3 divide-y divide-[color:var(--border)] text-sm">
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-[color:var(--text-500)]">执行智能体</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-[color:var(--text-700)]">
                  {order.bid?.agent?.name || '尚未分配'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-[color:var(--text-500)]">任务方</dt>
                <dd className="font-semibold text-[color:var(--text-700)]">
                  {order.client?.id ? '雇主用户' : '信息暂不可见'}
                </dd>
              </div>
            </dl>
          </section>

          <section className="border-b border-[color:var(--border)] py-6">
            <h2 className="flex items-center gap-2 text-base font-bold text-[color:var(--text-900)]">
              <Clock className="h-4 w-4 text-[color:var(--brand-500)]" />
              履约时间
            </h2>
            <dl className="mt-3 divide-y divide-[color:var(--border)] text-sm">
              {order.escrowedAt && (
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[color:var(--text-500)]">开始执行</dt>
                  <dd className="text-right font-medium text-[color:var(--text-700)]">{formatShanghaiDateTime(order.escrowedAt)}</dd>
                </div>
              )}
              {order.deliveredAt && (
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[color:var(--text-500)]">提交交付</dt>
                  <dd className="text-right font-medium text-[color:var(--text-700)]">{formatShanghaiDateTime(order.deliveredAt)}</dd>
                </div>
              )}
              {order.acceptedAt && (
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[color:var(--text-500)]">完成验收</dt>
                  <dd className="text-right font-medium text-[color:var(--text-700)]">{formatShanghaiDateTime(order.acceptedAt)}</dd>
                </div>
              )}
              {order.releasedAt && (
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[color:var(--text-500)]">款项结算</dt>
                  <dd className="text-right font-medium text-[color:var(--text-700)]">{formatShanghaiDateTime(order.releasedAt)}</dd>
                </div>
              )}
              {!order.escrowedAt && !order.deliveredAt && !order.acceptedAt && !order.releasedAt && (
                <div className="py-3 text-[color:var(--text-500)]">付款后将生成履约时间信息。</div>
              )}
            </dl>
          </section>

          {isClient && order.status === 'PENDING_PAYMENT' && (
            <section className="border-b border-[color:var(--border)] py-6">
              <h2 className="flex items-center gap-2 text-base font-bold text-[color:var(--text-900)]">
                <ShieldCheck className="h-4 w-4 text-[color:var(--brand-500)]" />
                支付订单
              </h2>
              <p className="mt-1 text-sm text-[color:var(--text-500)]">选择收款方式并上传支付凭证。</p>
              <div className="mt-4 space-y-2">
                {platformCodes.map((code) => (
                  <button
                    key={code.id}
                    onClick={() => setSelectedCode(code)}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                      selectedCode?.id === code.id
                        ? 'border-[color:var(--brand-400)] bg-[color:var(--brand-50)]'
                        : 'border-[color:var(--border)] hover:border-[color:var(--brand-300)]'
                    }`}
                  >
                    <span className="text-sm font-semibold text-[color:var(--text-700)]">
                      {code.type === 'ALIPAY' ? '支付宝' : '微信'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-500)]">{code.accountName}</span>
                  </button>
                ))}
              </div>
              {selectedCode && (
                <div className="mt-4 text-center">
                  <p className="mb-2 text-sm font-medium text-[color:var(--text-700)]">扫码支付 ¥{order.amountCny}</p>
                      <img
                        loading="lazy"
                    src={selectedCode.qrCodeUrl}
                    alt="收款码"
                    className="mx-auto max-h-[200px] max-w-[200px] rounded-lg"
                  />
                </div>
              )}
              <div className="mt-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleProofFileChange}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--background-400)] p-4 transition-colors hover:border-[color:var(--brand-400)]"
                >
                  {paymentProofPreview
                    ? <img src={paymentProofPreview} alt="支付凭证预览" className="max-h-32 rounded-lg" />
                    : <>
                        <Camera className="h-6 w-6 text-[color:var(--brand-600)]" />
                        <span className="text-sm text-[color:var(--text-500)]">点击上传支付截图</span>
                      </>}
                </button>
              </div>
              <button
                onClick={handleSubmitPayment}
                disabled={uploadingProof || !selectedCode || !paymentProof}
                className="btn-cs btn-primary mt-4 w-full"
              >
                {uploadingProof ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                确认已支付
              </button>
            </section>
          )}

          {(isClient || isOwner) && ['PENDING_PAYMENT', 'IN_PROGRESS'].includes(order.status) && (
            <button
              onClick={handleCancel}
              disabled={canceling}
              className="mt-5 flex min-h-11 w-full items-center justify-center rounded-xl border border-[color:var(--state-error)] px-4 text-sm font-medium text-[color:var(--state-error)] transition-colors hover:bg-[color:var(--state-error-surface)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {canceling ? <Loader2 className="h-4 w-4 animate-spin" /> : '取消订单'}
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

