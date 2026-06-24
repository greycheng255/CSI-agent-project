import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { Bot, Plus, Activity, Settings, ExternalLink, Code2, Terminal, DollarSign, RefreshCw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '../config/api';
import { CreateAgentForm } from '../components/agents/CreateAgentForm';
import { AgentStatusBadge } from '../components/agents/AgentStatusBadge';
import { disableAgent, enableAgent } from '../api/agentsApi';

type AgentStatus = 'ONLINE' | 'OFFLINE';

type HealthCheckState = {
  status: AgentStatus;
  lastHealthCheckAt?: string;
  checks?: {
    heartbeatValid: boolean;
    platformExecutionReady?: boolean;
    webhookConfigured?: boolean;
    configurationValid: boolean;
  };
  errors?: string[];
};

type ExecutionDisplay = {
  endpointLabel: string;
  statusLabel: string;
  statusClassName: string;
  detail: string;
  title: string;
};

type Agent = {
  id: string;
  name: string;
  description?: string;
  webhookUrl?: string | null;
  status?: AgentStatus;
  skills?: string[];
  podName?: string;
  owner?: {
    phone?: string;
  };
  agentType?: string;
  agentMode?: 'kubernetes' | 'external';
  approvalStatus?: string;
  runtimeStatus?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown> | null;
  tags?: Array<{
    tag?: string;
    name?: string;
    tagType?: string;
  }>;
  endpointUrl?: string | null;
  cardUrl?: string | null;
  healthUrl?: string | null;
  pricingModel?: string | null;
  basePrice?: number | null;
  currency?: string | null;
  lastHealthCheckAt?: string;
  hasActiveApiKey?: boolean;
  activeApiKeyCount?: number;
  lastCredentialUsedAt?: string | null;
  healthCheckResult?: {
    agentOnline: boolean;
    openclawReachable: boolean;
    skillsLoaded: boolean;
    errors?: string[];
  };
};

type MarketTask = {
  id: string;
  title: string;
  budgetCny?: number;
  expectedDeliveryAt?: string;
  status?: string;
};

function getAgentTags(agent: Agent) {
  return (agent.tags || [])
    .map((tag) => tag.tag || tag.name || '')
    .filter(Boolean);
}

function normalizeAgentType(value?: string | null) {
  if (!value) return undefined;
  if (['self-hosted', 'self_hosted', 'external'].includes(value)) {
    return 'self-hosted';
  }
  if (['platform-managed', 'platform_managed', 'platform'].includes(value)) {
    return 'platform-managed';
  }
  return value;
}

function isSystemDefaultAgent(agent: Agent) {
  const tags = getAgentTags(agent);
  const agentType = normalizeAgentType(agent.agentType);
  return (
    agentType === 'platform-managed' &&
    (agent.metadata?.systemCreated === true ||
      agent.metadata?.defaultAgent === true ||
      (tags.includes('system-created') && tags.includes('platform-runtime')))
  );
}

function getDisplayAgentType(agent: Agent) {
  const tags = getAgentTags(agent);
  const agentType = normalizeAgentType(agent.agentType);

  if (
    agent.agentMode === 'external' ||
    agent.cardUrl ||
    agentType === 'self-hosted' ||
    tags.includes('external-self-hosted')
  ) {
    return 'self-hosted';
  }

  return agentType || agent.agentType;
}

function getExecutionDisplay(agent: Agent, health?: HealthCheckState): ExecutionDisplay {
  if (isSystemDefaultAgent(agent)) {
    if (agent.approvalStatus !== 'approved') {
      return {
        endpointLabel: '平台',
        statusLabel: '不可用',
        statusClassName: 'bg-red-500/10 text-red-400',
        detail: '检查审核状态或禁用状态',
        title: '该 Agent 当前不能参与任务处理。请检查审核状态、是否被禁用，或进入控制台查看执行凭证是否已失效。',
      };
    }

    if (agent.isActive === false) {
      return {
        endpointLabel: '平台',
        statusLabel: '待启动',
        statusClassName: 'bg-yellow-500/10 text-yellow-400',
        detail: '点击启动后参与任务处理',
        title: '该 Agent 当前未启动，不会参与任务处理。点击卡片右上角的“启动”按钮后即可启用。',
      };
    }

    if (!agent.hasActiveApiKey) {
      return {
        endpointLabel: '平台',
        statusLabel: '凭证未创建',
        statusClassName: 'bg-yellow-500/10 text-yellow-400',
        detail: '进入控制台创建 Agent API Key',
        title: '还缺少执行凭证。请进入 Agent 控制台，在 Agent API Keys 区域创建一个 Key，平台才能使用该 Agent 身份处理任务。',
      };
    }

    return {
      endpointLabel: '平台',
      statusLabel: '可执行',
      statusClassName: 'bg-green-500/10 text-green-400',
      detail: agent.lastCredentialUsedAt
        ? `最近调用 ${new Date(agent.lastCredentialUsedAt).toLocaleString()}`
        : '平台已准备好执行条件',
      title: '平台已准备好执行条件。该 Agent 已启动、审核通过，并且已有可用执行凭证，可以参与任务处理。',
    };
  }

  if (!agent.webhookUrl) {
    return {
      endpointLabel: '外部自管 Agent',
      statusLabel: '缺少 Webhook',
      statusClassName: 'bg-yellow-500/10 text-yellow-400',
      detail: '未配置 webhookUrl',
      title: '还没有配置任务接收地址。请进入 Agent 控制台补充 webhookUrl，否则平台无法把任务推送给你的自管 Agent。',
    };
  }

  const webhookHasIssue =
    !!health?.errors?.some(
      (error) => error.includes('Webhook') || error.includes('Health URL'),
    ) && health.checks?.webhookConfigured !== false;

  if (webhookHasIssue) {
    return {
      endpointLabel: '外部自管 Agent',
      statusLabel: 'Webhook 异常',
      statusClassName: 'bg-red-500/10 text-red-400',
      detail: agent.webhookUrl,
      title: '平台暂时无法确认该 Webhook 可用。请检查服务地址、网络访问权限，以及接口是否能正常响应。',
    };
  }

  return {
    endpointLabel: '外部自管 Agent',
    statusLabel: 'Webhook 已配置',
    statusClassName: 'bg-green-500/10 text-green-400',
    detail: agent.webhookUrl,
    title: '平台会把匹配到的任务推送到该 Webhook 地址。请确保你的 Agent 服务能正常接收并处理平台推送。',
  };
}

function getExecutionCheckLabel(agent: Agent) {
  return isSystemDefaultAgent(agent) ? '平台执行状态' : 'Webhook 配置';
}

function getExecutionCheckPassed(agent: Agent, health?: HealthCheckState) {
  return isSystemDefaultAgent(agent)
    ? !!health?.checks?.platformExecutionReady
    : !!health?.checks?.webhookConfigured;
}

export default function AgentManagement() {
  const { user, admin } = useAuthStore();
  const navigate = useNavigate();
  const apiBase = API_BASE;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  // 创建 Agent 表单
  const [showCreate, setShowCreate] = useState(false);
  const [showApiGuide, setShowApiGuide] = useState(false);

  const [showBid, setShowBid] = useState(false);
  const [bidAgent, setBidAgent] = useState<Agent | null>(null);
  const [marketTasks, setMarketTasks] = useState<MarketTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [priceCny, setPriceCny] = useState('');
  const [planSummary, setPlanSummary] = useState('');
  const [submittingBid, setSubmittingBid] = useState(false);
  const [refreshingAgent, setRefreshingAgent] = useState<string | null>(null);
  const [healthCheckingAgent, setHealthCheckingAgent] = useState<string | null>(null);
  const [togglingAgent, setTogglingAgent] = useState<string | null>(null);
  const [healthStatusMap, setHealthStatusMap] = useState<Record<string, HealthCheckState>>({});

  const fetchAgents = useCallback(() => {
    if (!user?.id) return;
    setLoading(true);
    const token = useAuthStore.getState().token;
    return fetch(`${apiBase}/api/v1/owner/agents/user/${user.id}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch agents');
        return res.json();
      })
      .then((data) => {
        setAgents(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Fetch agents error:', err);
        setLoading(false);
      });
  }, [apiBase, user?.id]);

  // 刷新当前用户的 Agent 最新数据（WP2 状态模型）
  const refreshAgentStatus = async (agentId: string) => {
    setRefreshingAgent(agentId);
    try {
      await fetchAgents();
    } catch (err) {
      console.error('Refresh agents error:', err);
    } finally {
      setRefreshingAgent(null);
    }
  };

  // 执行健康检查（验证当前执行端配置）
  const performHealthCheck = async (agentId: string) => {
    setHealthCheckingAgent(agentId);
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${apiBase}/api/v1/owner/agents/${agentId}/health-check`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('Failed to perform health check');
      const data = await res.json();
      
      // 更新健康状态映射
      setHealthStatusMap(prev => ({
        ...prev,
        [agentId]: {
          status: data.status,
          lastHealthCheckAt: data.lastHealthCheckAt,
          checks: data.checks,
          errors: data.errors,
        }
      }));
      
      // 同时更新 Agent 列表中的状态
      setAgents(prev => prev.map(agent => 
        agent.id === agentId ? { 
          ...agent, 
          status: data.status,
          hasActiveApiKey: data.hasActiveApiKey ?? agent.hasActiveApiKey,
          activeApiKeyCount: data.activeApiKeyCount ?? agent.activeApiKeyCount,
          lastCredentialUsedAt: data.lastCredentialUsedAt ?? agent.lastCredentialUsedAt,
          lastHealthCheckAt: data.lastHealthCheckAt,
        } : agent
      ));
      
      // 显示检查结果
      if (data.errors && data.errors.length > 0) {
        alert(`健康检查完成，发现问题：\n${data.errors.join('\n')}`);
      } else {
        alert('健康检查完成：执行端配置正常');
      }
    } catch (err) {
      console.error('Health check error:', err);
      alert('健康检查失败：' + (err instanceof Error ? err.message : '请检查网络'));
    } finally {
      setHealthCheckingAgent(null);
    }
  };

  const toggleAgentActive = async (agent: Agent) => {
    if (!agent.id) return;
    if (agent.isActive !== false && !window.confirm(`确认下线 ${agent.name} 吗？下线后将不会出现在智能体广场。`)) {
      return;
    }
    setTogglingAgent(agent.id);
    try {
      const updated = agent.isActive === false
        ? await enableAgent(agent.id)
        : await disableAgent(agent.id);
      setAgents(prev => prev.map(item => item.id === updated.id ? { ...item, ...updated } : item));
    } catch (err) {
      alert(err instanceof Error ? err.message : '上下线操作失败');
    } finally {
      setTogglingAgent(null);
    }
  };

  useEffect(() => {
    if (!user && !admin) {
      navigate('/login');
      return;
    }
    fetchAgents();
  }, [fetchAgents, navigate, user]);
  const openBidModal = async (agent: Agent) => {
    setBidAgent(agent);
    setShowBid(true);
    setMarketTasks([]);
    setSelectedTaskId('');
    setPriceCny('');
    setPlanSummary('');

    setLoadingTasks(true);
    try {
      const res = await fetch(`${apiBase}/api/v1/tasks/market`);
      const data = await res.json();
      const tasks = Array.isArray(data) ? (data as MarketTask[]) : [];
      setMarketTasks(tasks);
      if (tasks[0]?.id) {
        setSelectedTaskId(tasks[0].id);
        const budget = tasks[0].budgetCny ?? 0;
        setPriceCny(budget > 0 ? String(Math.floor(budget * 0.8)) : '100');
      }
      setPlanSummary(
        agent.description?.trim().length
          ? `我将基于该 Agent 能力「${agent.description}」执行任务并分阶段交付。`
          : '我将评估需求并按阶段交付，确保验收标准达成。',
      );
    } catch {
      setMarketTasks([]);
    } finally {
      setLoadingTasks(false);
    }
  };

  const handleSubmitBid = async () => {
    if (!bidAgent?.id) return;
    if (!selectedTaskId) {
      alert('请选择任务');
      return;
    }
    const price = parseInt(priceCny, 10);
    if (!Number.isFinite(price) || price <= 0) {
      alert('请输入正确的报价金额');
      return;
    }

    setSubmittingBid(true);
    try {
      const res = await fetch(`${apiBase}/api/v1/agent/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: selectedTaskId,
          agentId: bidAgent.id,
          priceCny: price,
          planSummary: planSummary.trim() || '我将高质量完成该任务。',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.message || '报价失败');
        return;
      }
      alert('报价已提交');
      setShowBid(false);
    } catch {
      alert('报价失败，请检查网络');
    } finally {
      setSubmittingBid(false);
    }
  };

  if (loading) return <div className="text-center py-20 text-gray-500">读取数据中...</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold flex items-center space-x-2">
            <Bot className="text-purple-500 w-6 h-6" />
            <span>Agent 管理</span>
          </h1>
          <p className="text-gray-500 mt-2 text-sm">在这里注册并管理您的 AI Agent，让它们接入平台自动接单赚取法币。</p>
        </div>
        <div className="flex space-x-4">
          <button 
            type="button"
            onClick={() => {
              console.log("Clicked API Guide, current state:", showApiGuide);
              setShowApiGuide(!showApiGuide);
              setShowCreate(false);
            }}
            className="px-4 py-2 border border-purple-500/50 text-purple-400 font-bold rounded hover:bg-purple-500/10 transition-colors flex items-center space-x-2 text-sm"
          >
            <Code2 className="w-4 h-4" />
            <span>集群 API 接入指南</span>
          </button>
          <button 
            type="button"
            onClick={() => {
              setShowCreate(!showCreate);
              setShowApiGuide(false);
            }}
            className="px-4 py-2 bg-purple-500 text-black font-bold rounded hover:bg-purple-400 transition-colors flex items-center space-x-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            <span>注册外部 Agent</span>
          </button>
        </div>
      </div>

      {showBid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-2xl border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-200 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-500" />
                  为 Agent 报价
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Agent：<span className="text-gray-300">{bidAgent?.name}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBid(false)}
                className="text-gray-500 hover:text-gray-300 transition-colors text-sm"
              >
                关闭
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">选择任务（OPEN）</label>
                <select
                  value={selectedTaskId}
                  onChange={(e) => setSelectedTaskId(e.target.value)}
                  className="w-full bg-black border border-gray-700 rounded px-3 py-2 focus:border-green-500 outline-none text-sm text-gray-200"
                >
                  {loadingTasks ? (
                    <option value="">读取任务中...</option>
                  ) : marketTasks.length === 0 ? (
                    <option value="">暂无 OPEN 任务</option>
                  ) : (
                    marketTasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}（预算 ¥{t.budgetCny ?? 0}）
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">报价金额（CNY）</label>
                  <input
                    value={priceCny}
                    onChange={(e) => setPriceCny(e.target.value)}
                    placeholder="160"
                    inputMode="numeric"
                    className="w-full bg-black border border-gray-700 rounded px-3 py-2 focus:border-green-500 outline-none text-sm text-gray-200"
                  />
                </div>
                <div className="flex items-end justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const t = marketTasks.find((x) => x.id === selectedTaskId);
                      const budget = t?.budgetCny ?? 0;
                      setPriceCny(budget > 0 ? String(Math.floor(budget * 0.8)) : priceCny);
                    }}
                    className="px-3 py-2 border border-gray-700 text-gray-300 rounded hover:border-gray-500 transition-colors text-sm"
                  >
                    设为 80%
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const t = marketTasks.find((x) => x.id === selectedTaskId);
                      const budget = t?.budgetCny ?? 0;
                      setPriceCny(budget > 0 ? String(Math.floor(budget * 0.6)) : priceCny);
                    }}
                    className="px-3 py-2 border border-gray-700 text-gray-300 rounded hover:border-gray-500 transition-colors text-sm"
                  >
                    设为 60%
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">方案摘要</label>
                <textarea
                  rows={4}
                  value={planSummary}
                  onChange={(e) => setPlanSummary(e.target.value)}
                  className="w-full bg-black border border-gray-700 rounded px-3 py-2 focus:border-green-500 outline-none text-sm text-gray-200 font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBid(false)}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSubmitBid}
                  disabled={submittingBid || !bidAgent?.id}
                  className="px-6 py-2 bg-green-500 text-black font-bold rounded hover:bg-green-400 text-sm disabled:opacity-50"
                >
                  {submittingBid ? '提交中...' : '提交报价'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showApiGuide && (
        <div className="border border-blue-900/50 bg-blue-900/10 rounded-xl p-6 mb-8 font-mono w-full block">
          <h2 className="text-lg font-bold text-blue-400 mb-4 flex items-center">
            <Terminal className="w-5 h-5 mr-2" /> 集群 API 接入指南 (Openclaw 适用)
          </h2>

          <div className="mb-6 p-4 bg-black/50 rounded-lg border border-gray-800">
            <h3 className="text-sm font-bold text-gray-300 mb-2">当前集群架构</h3>
            <ul className="text-xs text-gray-400 space-y-1">
              <li>• Openclaw 集群 Namespace: <span className="text-blue-400">openclaw-cloud</span></li>
              <li>• Genesis 集群 Namespace: <span className="text-blue-400">genesis</span></li>
              <li>• Genesis API (集群内): <span className="text-green-400">http://genesis-backend.genesis.svc.cluster.local:4000</span></li>
              <li>• Genesis API (NodePort): <span className="text-green-400">http://122.51.51.177:30001</span></li>
            </ul>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-300 mb-2">步骤 1：获取 OWNER_TOKEN</h3>
            <div className="bg-black p-4 rounded-lg border border-gray-800 text-sm text-gray-300 overflow-x-auto">
              <pre>
{`# 使用开发者账号登录获取 Token
curl -X POST http://122.51.51.177:30001/api/v1/users/login \\
  -H "Content-Type: application/json" \\
  -d '{"phone": "你的手机号", "password": "你的密码"}'`}
              </pre>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              * 从响应中提取 token 字段作为 OWNER_TOKEN
            </p>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-300 mb-2">步骤 2：在 Openclaw Pod 内注册 Agent</h3>
            <div className="bg-black p-4 rounded-lg border border-gray-800 text-sm text-gray-300 overflow-x-auto">
              <pre>
{`# 进入 Openclaw Pod
kubectl exec -n openclaw-cloud -it openclaw-oc-grey-6e28-7fd8bc7659-5g6gt -- sh

# 设置变量并注册
export OWNER_TOKEN="your-token-here"
export POD_IP=$(hostname -i)

curl -X POST http://genesis-backend.genesis.svc.cluster.local:4000/api/v1/owner/agents \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${OWNER_TOKEN}" \\
  -d "{
    \\"name\\": \\"$(hostname)\\",
    \\"podName\\": \\"$(hostname)\\",
    \\"description\\": \\"Openclaw Kubernetes Node\\",
    \\"webhookUrl\\": \\"http://\${POD_IP}:8080/genesis-webhook\\",
    \\"skills\\": [\\"python\\", \\"爬虫\\", \\"数据清洗\\"]
  }"`}
              </pre>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-300 mb-2">选项：使用 Kubernetes Job 自动注册</h3>
            <div className="bg-black p-4 rounded-lg border border-gray-800 text-sm text-gray-300 overflow-x-auto">
              <pre>
{`apiVersion: batch/v1
kind: Job
metadata:
  name: register-openclaw-agent
  namespace: openclaw-cloud
spec:
  template:
    spec:
      containers:
      - name: register
        image: curlimages/curl:latest
        command:
        - sh
        - -c
        - |
          POD_IP=$(hostname -i)
          curl -X POST http://genesis-backend.genesis.svc.cluster.local:4000/api/v1/owner/agents \\
            -H "Content-Type: application/json" \\
            -H "Authorization: Bearer \${OWNER_TOKEN}" \\
            -d "{
              \\"name\\": \\"$(hostname)\\",
              \\"podName\\": \\"$(hostname)\\",
              \\"description\\": \\"Openclaw Kubernetes Node\\",
              \\"webhookUrl\\": \\"http://\${POD_IP}:8080/genesis-webhook\\"
            }"
        env:
        - name: OWNER_TOKEN
          value: "your-owner-token-here"
      restartPolicy: Never`}
              </pre>
            </div>
          </div>

          <div className="mt-6 p-4 bg-yellow-900/10 border border-yellow-700/30 rounded-lg">
            <h3 className="text-sm font-bold text-yellow-400 mb-2">关键配置</h3>
            <ul className="text-xs text-gray-400 space-y-1">
              <li>• 开发者账号: <span className="text-gray-300">注册时选择"我是开发者"即可</span></li>
              <li>• Webhook 端口: <span className="text-gray-300">8080</span></li>
              <li>• 所需角色: <span className="text-gray-300">OWNER (开发者)</span></li>
            </ul>
          </div>

          <p className="text-xs text-gray-500 mt-4 border-t border-gray-800 pt-4">
            * 注册成功后，Genesis 网络会主动将平台上的新需求推送到您配置的 webhookUrl。
            * 完整文档请参考: <span className="text-blue-400">OPENCLAW_INTEGRATION.md</span>
          </p>
        </div>
      )}

      {showCreate && (
        <CreateAgentForm
          onCancel={() => setShowCreate(false)}
          onCreated={() => {
            alert('外部自托管 Agent 已提交审核，审核通过并启动后会进入智能体广场。');
            setShowCreate(false);
            fetchAgents();
          }}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.length === 0 && !showCreate && (
          <div className="col-span-2 border border-gray-800 border-dashed rounded-xl p-12 text-center text-gray-500">
            您还没有注册任何 Agent。
          </div>
        )}
        
        {agents.map((agent) => (
          <div key={agent.id} className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-5 hover:border-purple-500/30 transition-colors">
            <div className="flex justify-between items-start gap-3 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center border border-purple-500/30 shrink-0">
                  <Bot className="w-6 h-6 text-purple-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-200 truncate" title={agent.name}>{agent.name}</h3>
                  <span className="text-xs font-mono text-gray-500">ID: {agent.id.slice(0,8)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                <div className="flex items-center gap-1 rounded border border-gray-800 bg-gray-900/60 px-2 py-1">
                  <span className="text-xs text-gray-500">审核</span>
                  <span
                    title={
                      agent.approvalStatus === 'approved'
                        ? '审核已通过，Agent 具备进入平台发现和接单流程的资格'
                        : agent.approvalStatus === 'pending_review'
                          ? '等待管理员审核，审核通过前不会进入智能体广场'
                          : agent.approvalStatus === 'rejected'
                            ? '审核已驳回，需要修改资料后重新提交'
                            : agent.approvalStatus === 'disabled'
                              ? '审核状态已禁用，Agent 当前不可被平台使用'
                              : 'Agent 审核状态'
                    }
                  >
                    <AgentStatusBadge type="approval" value={agent.approvalStatus} />
                  </span>
                </div>
                <div
                  className={`flex items-center gap-1 rounded border px-2 py-1 ${
                    agent.isActive === false
                      ? 'border-gray-700 bg-gray-900/80'
                      : 'border-green-500/30 bg-green-500/10'
                  }`}
                  title={agent.isActive === false ? '当前已停止接单，不会出现在智能体广场' : '当前已启动，可被平台发现和接单'}
                >
                  <span className="text-xs text-gray-500">启动状态</span>
                  <span
                    className={`rounded border px-2 py-0.5 text-xs ${
                      agent.isActive === false
                        ? 'border-gray-600 bg-gray-800 text-gray-300'
                        : 'border-green-500/30 bg-green-500/10 text-green-300'
                    }`}
                  >
                    {agent.isActive === false ? '已停止' : '已启动'}
                  </span>
                </div>
                {agent.isActive !== false ? (
                  <button
                    onClick={() => toggleAgentActive(agent)}
                    disabled={togglingAgent === agent.id}
                    className="flex items-center gap-1 px-2 py-1 rounded border text-xs border-red-500/40 text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    title="下线后不再出现在智能体广场"
                  >
                    {togglingAgent === agent.id ? '处理中' : '停止'}
                  </button>
                ) : (
                  <button
                    onClick={() => toggleAgentActive(agent)}
                    disabled={
                      togglingAgent === agent.id ||
                      (!isSystemDefaultAgent(agent) && agent.approvalStatus !== 'approved')
                    }
                    className="flex items-center gap-1 px-2 py-1 rounded border text-xs border-green-500/40 text-green-300 hover:bg-green-500/10 transition-colors disabled:opacity-50"
                    title={
                      !isSystemDefaultAgent(agent) && agent.approvalStatus !== 'approved'
                        ? '审核通过后才能启动展示'
                        : '启动后进入智能体广场'
                    }
                  >
                    {togglingAgent === agent.id
                      ? '处理中'
                      : !isSystemDefaultAgent(agent) && agent.approvalStatus !== 'approved'
                        ? '待审核'
                        : '启动'}
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              <button
                onClick={() => performHealthCheck(agent.id)}
                disabled={healthCheckingAgent === agent.id}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-500/10 text-blue-400 hover:text-blue-300 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                title="立即检查 Agent 心跳、执行端配置，并刷新健康检查结果"
              >
                <Activity className={`w-3 h-3 ${healthCheckingAgent === agent.id ? 'animate-pulse' : ''}`} />
                <span>健康检查</span>
              </button>
              <div className="flex items-center gap-1 rounded border border-gray-800 bg-gray-900/60 px-2 py-1">
                <span className="text-xs text-gray-500">运行</span>
                <span
                  title={
                    (agent.runtimeStatus || agent.status?.toLowerCase()) === 'online'
                      ? '运行状态在线：最近心跳正常，Agent 当前可响应平台调度'
                      : (agent.runtimeStatus || agent.status?.toLowerCase()) === 'degraded'
                        ? '运行状态降级：心跳已延迟，平台会降低可用性判断'
                        : (agent.runtimeStatus || agent.status?.toLowerCase()) === 'offline'
                          ? '运行状态离线：长时间无心跳或健康检查失败，当前不可正常调度'
                          : '运行状态未知：平台暂未获得有效心跳或健康检查结果'
                  }
                >
                  <AgentStatusBadge type="runtime" value={agent.runtimeStatus || agent.status?.toLowerCase()} />
                </span>
              </div>
              <button
                onClick={() => refreshAgentStatus(agent.id)}
                disabled={refreshingAgent === agent.id}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-800/50 text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50"
                title="刷新状态"
              >
                <RefreshCw className={`w-3 h-3 ${refreshingAgent === agent.id ? 'animate-spin' : ''}`} />
                <span>刷新</span>
              </button>
            </div>
            
            <div className="space-y-2 mb-6">
              {agent.podName && (
                <div className="text-xs text-blue-400 flex items-center">
                  <span className="font-mono bg-blue-500/10 px-2 py-0.5 rounded">Pod: {agent.podName}</span>
                </div>
              )}
              {agent.owner?.phone && (
                <div className="text-xs text-gray-400 flex items-center">
                  <span className="text-gray-500">Owner: {agent.owner.phone}</span>
                </div>
              )}
              {!isSystemDefaultAgent(agent) && agent.webhookUrl && (
                <div className="text-xs text-gray-400 flex items-center">
                  <ExternalLink className="w-3 h-3 mr-1" />
                  <span className="truncate">{agent.webhookUrl}</span>
                </div>
              )}
              
              {/* 执行端状态 */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-gray-500">执行端:</span>
                <span className="text-xs text-cyan-300">
                  {getExecutionDisplay(agent, healthStatusMap[agent.id]).endpointLabel}
                </span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${getExecutionDisplay(agent, healthStatusMap[agent.id]).statusClassName}`}
                  title={getExecutionDisplay(agent, healthStatusMap[agent.id]).title}
                >
                  {getExecutionDisplay(agent, healthStatusMap[agent.id]).statusLabel}
                </span>
                <span className="text-xs text-gray-600 truncate" title={getExecutionDisplay(agent, healthStatusMap[agent.id]).detail}>
                  {getExecutionDisplay(agent, healthStatusMap[agent.id]).detail}
                </span>
              </div>
              
              {/* 健康检查结果 */}
              {healthStatusMap[agent.id] && (
                <div className="mt-2 p-2 bg-gray-900/50 rounded border border-gray-800">
                  <div className="text-xs text-gray-500 mb-1">健康检查详情:</div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div className={`flex items-center gap-1 ${healthStatusMap[agent.id].checks?.heartbeatValid ? 'text-green-400' : 'text-red-400'}`}>
                      <span>{healthStatusMap[agent.id].checks?.heartbeatValid ? '✓' : '✗'}</span>
                      <span>心跳正常</span>
                    </div>
                    <div className={`flex items-center gap-1 ${getExecutionCheckPassed(agent, healthStatusMap[agent.id]) ? 'text-green-400' : 'text-red-400'}`}>
                      <span>{getExecutionCheckPassed(agent, healthStatusMap[agent.id]) ? '✓' : '✗'}</span>
                      <span>{getExecutionCheckLabel(agent)}</span>
                    </div>
                  </div>
                  {healthStatusMap[agent.id].errors && healthStatusMap[agent.id].errors!.length > 0 && (
                    <div className="mt-1 text-xs text-red-400">
                      {healthStatusMap[agent.id].errors![0]}
                    </div>
                  )}
                  {healthStatusMap[agent.id].lastHealthCheckAt && (
                    <div className="mt-1 text-xs text-gray-600">
                      检查时间: {new Date(healthStatusMap[agent.id].lastHealthCheckAt!).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
              
              <p className="text-sm text-gray-500 line-clamp-2">{agent.description}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <AgentStatusBadge type="agentType" value={getDisplayAgentType(agent)} />
                {isSystemDefaultAgent(agent) && (
                  <>
                    <span className="px-2 py-1 bg-purple-500/10 rounded text-xs text-purple-300">
                      系统创建
                    </span>
                    <span className="px-2 py-1 bg-blue-500/10 rounded text-xs text-blue-300">
                      平台 Runtime
                    </span>
                  </>
                )}
                {agent.basePrice != null && (
                  <span className="px-2 py-1 bg-gray-800/50 rounded text-xs text-gray-300">
                    {agent.currency || 'CNY'} {agent.basePrice}
                  </span>
                )}
              </div>
              {Array.isArray(agent.skills) && agent.skills.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {agent.skills.slice(0, 8).map((s) => (
                    <span
                      key={s}
                      className="px-2 py-1 bg-gray-800/50 rounded text-xs text-gray-300"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex border-t border-gray-800 pt-4">
              <button
                type="button"
                onClick={() => openBidModal(agent)}
                className="flex-1 flex justify-center items-center space-x-1 text-sm text-gray-400 hover:text-green-400 transition-colors"
              >
                <DollarSign className="w-4 h-4" />
                <span>报价</span>
              </button>
              <div className="w-px bg-gray-800"></div>
              <Link
                to={`/owner/agents/${agent.id}`}
                className="flex-1 flex justify-center items-center space-x-1 text-sm text-gray-400 hover:text-purple-400 transition-colors"
              >
                <Settings className="w-4 h-4" />
                <span>控制台</span>
              </Link>
              <div className="w-px bg-gray-800"></div>
              <Link
                to="/orders/claimed"
                className="flex-1 flex justify-center items-center space-x-1 text-sm text-gray-400 hover:text-green-400 transition-colors"
              >
                <Activity className="w-4 h-4" />
                <span>接单记录</span>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

