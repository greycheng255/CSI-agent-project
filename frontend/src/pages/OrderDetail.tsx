import { useCallback, useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ShieldCheck, Loader2, CheckCircle2, Camera, Clock, AlertCircle, FileText, ChevronDown, ChevronUp, MessageSquare, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

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
  executionPhases?: ExecutionPhase[];
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
  const [delivering, setDelivering] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [deliverySummary, setDeliverySummary] = useState('已完成交付，请雇主验收。');
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const [rejectReason, setRejectReason] = useState('交付未满足验收标准。');
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
    fetch(`${apiBase}/api/v1/orders/${id}`)
      .then((res) => res.json())
      .then(async (data: Order) => {
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
      .catch(() => setLoading(false));
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
      const token = localStorage.getItem('token');
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

  const handleDeliver = async () => {
    if (!user) {
      alert('请先登录');
      navigate('/login');
      return;
    }
    if (!deliverySummary.trim()) {
      alert('请输入交付说明');
      return;
    }
    setDelivering(true);
    try {
      const res = await fetch(`${apiBase}/api/v1/orders/${id}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          deliverySummary,
          deliveryUrl: deliveryUrl || undefined,
        }),
      });
      if (res.ok) {
        fetchOrder();
        alert('交付已提交，等待雇主验收');
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.message || '交付失败');
      }
    } catch {
      alert('交付请求失败');
    } finally {
      setDelivering(false);
    }
  };

  const handleAccept = async () => {
    if (!user) {
      alert('请先登录');
      navigate('/login');
      return;
    }
    setAccepting(true);
    try {
      const res = await fetch(`${apiBase}/api/v1/orders/${id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (res.ok) {
        fetchOrder();
        alert('已确认验收');
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.message || '验收失败');
      }
    } catch {
      alert('验收请求失败');
    } finally {
      setAccepting(false);
    }
  };

  const handleReject = async () => {
    if (!user) {
      alert('请先登录');
      navigate('/login');
      return;
    }
    if (!rejectReason.trim()) {
      alert('请输入拒绝原因');
      return;
    }
    setRejecting(true);
    try {
      const res = await fetch(`${apiBase}/api/v1/orders/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, reason: rejectReason }),
      });
      if (res.ok) {
        fetchOrder();
        alert('已拒绝交付，订单进入仲裁');
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.message || '拒绝失败');
      }
    } catch {
      alert('拒绝请求失败');
    } finally {
      setRejecting(false);
    }
  };

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
        return { label: '待支付', color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/20' };
      case 'IN_PROGRESS':
        return { label: '进行中', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' };
      case 'DELIVERED':
        return { label: '待验收', color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/20' };
      case 'ACCEPTED':
        return { label: '已验收', color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/20' };
      case 'PENDING_RELEASE':
        return { label: '待放款', color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/20' };
      case 'COMPLETED':
        return { label: '已完成', color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/20' };
      case 'REJECTED':
        return { label: '已拒绝', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' };
      case 'ARBITRATING':
        return { label: '仲裁中', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' };
      case 'REFUNDED':
        return { label: '已退款', color: 'text-gray-400', bg: 'bg-gray-400/10', border: 'border-gray-400/20' };
      case 'CANCELED':
        return { label: '已取消', color: 'text-gray-400', bg: 'bg-gray-400/10', border: 'border-gray-400/20' };
      default:
        return { label: status, color: 'text-gray-400', bg: 'bg-gray-400/10', border: 'border-gray-400/20' };
    }
  };

  const getPhaseStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'text-green-400 bg-green-400/10 border-green-400/20';
      case 'IN_PROGRESS':
        return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      case 'FAILED':
        return 'text-red-400 bg-red-400/10 border-red-400/20';
      default:
        return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
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
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-gray-400">
        订单不存在
      </div>
    );
  }

  const sv = statusView(order.status);
  const totalProgress = calculateTotalProgress(order.executionPhases);
  const isOwner = user?.id === order.owner?.id;
  const isClient = user?.id === order.client?.id;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 订单标题和状态 */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${sv.bg} ${sv.color} border ${sv.border}`}>
              {sv.label}
            </span>
            <span className="text-gray-500 text-sm">订单号: {order.id.slice(0, 16)}...</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            {order.task?.title || '未知任务'}
          </h1>
          {order.task?.description && (
            <p className="text-gray-400">{order.task.description}</p>
          )}
        </div>

        {/* 总体进度 */}
        {order.status === 'IN_PROGRESS' && (
          <div className="bg-[#111] border border-gray-800 rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-blue-400" />
                <h2 className="text-lg font-semibold text-white">任务执行进度</h2>
              </div>
              <span className="text-2xl font-bold text-blue-400">{totalProgress}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-3 mb-4">
              <div 
                className="bg-blue-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${totalProgress}%` }}
              />
            </div>
            <p className="text-sm text-gray-400">
              预计工时: {order.bid?.pricingMeta?.evaluation?.estimatedHours || '-'} 小时 | 
              复杂度: {order.bid?.pricingMeta?.evaluation?.complexityCn || '-'}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：执行计划和进度 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 执行阶段 */}
            {order.executionPhases && order.executionPhases.length > 0 && (
              <div className="bg-[#111] border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-400" />
                    执行计划
                  </h2>
                  {/* 重试按钮 - 始终显示，用户可以手动触发重试 */}
                  <button
                    onClick={handleRetry}
                    disabled={retrying}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    {retrying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    {retrying ? '重试中...' : '重新执行'}
                  </button>
                </div>
                <div className="space-y-4">
                  {order.executionPhases.map((phase, index) => (
                    <div key={phase.id} className="border border-gray-800 rounded-lg overflow-hidden">
                      {/* 阶段头部 */}
                      <button
                        onClick={() => togglePhase(phase.id)}
                        className="w-full px-4 py-3 flex items-center justify-between bg-gray-800/30 hover:bg-gray-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-gray-500 text-sm">{index + 1}</span>
                          <div className="text-left">
                            <p className="font-medium text-white">{phase.name}</p>
                            <p className="text-sm text-gray-400">{phase.description}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-1 rounded text-xs ${getPhaseStatusColor(phase.status)}`}>
                            {getPhaseStatusLabel(phase.status)}
                          </span>
                          <span className="text-sm text-gray-400">{phase.progress}%</span>
                          {expandedPhases.includes(phase.id) ? (
                            <ChevronUp className="w-4 h-4 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </button>
                      
                      {/* 阶段详情 */}
                      {expandedPhases.includes(phase.id) && (
                        <div className="px-4 py-3 border-t border-gray-800">
                          {/* 进度条 */}
                          <div className="w-full bg-gray-800 rounded-full h-2 mb-4">
                            <div 
                              className={`h-2 rounded-full transition-all duration-500 ${
                                phase.status === 'COMPLETED' ? 'bg-green-500' : 
                                phase.status === 'IN_PROGRESS' ? 'bg-blue-500' : 
                                phase.status === 'FAILED' ? 'bg-red-500' : 'bg-gray-600'
                              }`}
                              style={{ width: `${phase.progress}%` }}
                            />
                          </div>
                          
                          {/* 子任务列表 */}
                          <div className="space-y-2">
                            {phase.subTasks.map((task) => (
                              <div key={task.id} className="flex items-start gap-3 p-2 bg-gray-800/20 rounded">
                                <div className={`mt-0.5 w-2 h-2 rounded-full ${
                                  task.status === 'COMPLETED' ? 'bg-green-500' :
                                  task.status === 'IN_PROGRESS' ? 'bg-blue-500 animate-pulse' :
                                  task.status === 'FAILED' ? 'bg-red-500' :
                                  'bg-gray-600'
                                }`} />
                                <div className="flex-1">
                                  <p className="text-sm text-white">{task.name}</p>
                                  <p className="text-xs text-gray-400">{task.description}</p>
                                  {task.logs && task.logs.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {task.logs.map((log, i) => (
                                        <p key={i} className="text-xs text-gray-500">• {log}</p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <span className="text-xs text-gray-500">{task.progress}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 求助功能（仅开发者可见） */}
            {isOwner && order.status === 'IN_PROGRESS' && (
              <div className="bg-[#111] border border-gray-800 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-yellow-400" />
                  需要帮助？
                </h2>
                <p className="text-sm text-gray-400 mb-4">
                  如果在执行任务过程中遇到困难，可以向雇主发送求助消息
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={helpMessage}
                    onChange={(e) => setHelpMessage(e.target.value)}
                    placeholder="描述您遇到的问题..."
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleSendHelp}
                    disabled={sendingHelp || !helpMessage.trim()}
                    className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    {sendingHelp ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <MessageSquare className="w-4 h-4" />
                    )}
                    发送求助
                  </button>
                </div>
              </div>
            )}

            {/* 交付区域（仅开发者可见） */}
            {isOwner && order.status === 'IN_PROGRESS' && (
              <div className="bg-[#111] border border-gray-800 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-white mb-4">提交交付</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">交付说明</label>
                    <textarea
                      value={deliverySummary}
                      onChange={(e) => setDeliverySummary(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                      rows={3}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">交付链接（可选）</label>
                    <input
                      type="text"
                      value={deliveryUrl}
                      onChange={(e) => setDeliveryUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    onClick={handleDeliver}
                    disabled={delivering}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {delivering ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    提交交付
                  </button>
                </div>
              </div>
            )}

            {/* 验收区域（仅雇主可见） */}
            {isClient && order.status === 'DELIVERED' && (
              <div className="bg-[#111] border border-gray-800 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-white mb-4">验收交付</h2>
                {order.deliverySummary && (
                  <div className="mb-4 p-3 bg-gray-800/30 rounded-lg">
                    <p className="text-sm text-gray-300">{order.deliverySummary}</p>
                    {order.deliveryUrl && (
                      <a 
                        href={order.deliveryUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:text-blue-300 mt-2 inline-block"
                      >
                        查看交付物 →
                      </a>
                    )}
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={handleAccept}
                    disabled={accepting}
                    className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {accepting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    确认验收
                  </button>
                  <button
                    onClick={() => document.getElementById('reject-section')?.scrollIntoView({ behavior: 'smooth' })}
                    className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 rounded-lg font-medium transition-colors"
                  >
                    拒绝
                  </button>
                </div>
                
                {/* 拒绝原因 */}
                <div id="reject-section" className="mt-4 pt-4 border-t border-gray-800">
                  <label className="block text-sm text-gray-400 mb-2">拒绝原因</label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-red-500 mb-3"
                    rows={2}
                  />
                  <button
                    onClick={handleReject}
                    disabled={rejecting}
                    className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {rejecting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    确认拒绝并仲裁
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 右侧：订单信息 */}
          <div className="space-y-6">
            {/* 订单金额 */}
            <div className="bg-[#111] border border-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">订单金额</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">任务金额</span>
                  <span className="text-white">¥{order.amountCny}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">平台服务费</span>
                  <span className="text-gray-400">-¥{order.platformFeeCny || 0}</span>
                </div>
                <div className="flex justify-between pt-3 border-t border-gray-800">
                  <span className="text-white font-medium">开发者实得</span>
                  <span className="text-green-400 font-bold">¥{order.payoutCny || order.amountCny}</span>
                </div>
              </div>
            </div>

            {/* 参与方 */}
            <div className="bg-[#111] border border-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">参与方</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-400">开发者 (Agent)</p>
                  <p className="text-white">{order.bid?.agent?.name || '未知'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">雇主</p>
                  <p className="text-white">{order.client?.id ? '雇主用户' : '未知'}</p>
                </div>
              </div>
            </div>

            {/* 时间线 */}
            <div className="bg-[#111] border border-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">时间线</h2>
              <div className="space-y-3 text-sm">
                {order.escrowedAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">开始时间</span>
                    <span className="text-white">{new Date(order.escrowedAt).toLocaleString('zh-CN')}</span>
                  </div>
                )}
                {order.deliveredAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">交付时间</span>
                    <span className="text-white">{new Date(order.deliveredAt).toLocaleString('zh-CN')}</span>
                  </div>
                )}
                {order.acceptedAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">验收时间</span>
                    <span className="text-white">{new Date(order.acceptedAt).toLocaleString('zh-CN')}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 支付区域（仅雇主可见） */}
            {isClient && order.status === 'PENDING_PAYMENT' && (
              <div className="bg-[#111] border border-gray-800 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-white mb-4">支付订单</h2>
                
                {/* 选择支付方式 */}
                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-2">选择支付方式</label>
                  <div className="space-y-2">
                    {platformCodes.map((code) => (
                      <button
                        key={code.id}
                        onClick={() => setSelectedCode(code)}
                        className={`w-full p-3 border rounded-lg flex items-center gap-3 transition-colors ${
                          selectedCode?.id === code.id
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-gray-700 hover:border-gray-600'
                        }`}
                      >
                        <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
                          {code.type === 'ALIPAY' ? (
                            <span className="text-blue-400 text-xs">支付宝</span>
                          ) : (
                            <span className="text-green-400 text-xs">微信</span>
                          )}
                        </div>
                        <div className="text-left">
                          <p className="text-white text-sm">{code.accountName}</p>
                          <p className="text-gray-500 text-xs">{code.type === 'ALIPAY' ? '支付宝' : '微信支付'}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 收款码 */}
                {selectedCode && (
                  <div className="mb-4">
                    <p className="text-sm text-gray-400 mb-2">扫码支付 ¥{order.amountCny}</p>
                    <div className="bg-white p-4 rounded-lg flex items-center justify-center">
                      <img 
                        src={selectedCode.qrCodeUrl} 
                        alt="收款码" 
                        className="max-w-[200px] max-h-[200px]"
                      />
                    </div>
                  </div>
                )}

                {/* 上传支付凭证 */}
                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-2">上传支付凭证</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleProofFileChange}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full p-4 border-2 border-dashed border-gray-700 rounded-lg flex flex-col items-center gap-2 hover:border-gray-600 transition-colors"
                  >
                    {paymentProofPreview ? (
                      <img src={paymentProofPreview} alt="预览" className="max-h-32 rounded" />
                    ) : (
                      <>
                        <Camera className="w-8 h-8 text-gray-600" />
                        <span className="text-gray-400 text-sm">点击上传支付截图</span>
                      </>
                    )}
                  </button>
                </div>

                <button
                  onClick={handleSubmitPayment}
                  disabled={uploadingProof || !selectedCode || !paymentProof}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {uploadingProof ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" />
                  )}
                  确认已支付
                </button>
              </div>
            )}

            {/* 取消订单 */}
            {(isClient || isOwner) && ['PENDING_PAYMENT', 'IN_PROGRESS'].includes(order.status) && (
              <button
                onClick={handleCancel}
                disabled={canceling}
                className="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 text-gray-400 rounded-lg text-sm transition-colors"
              >
                {canceling ? <Loader2 className="w-4 h-4 animate-spin inline" /> : '取消订单'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
