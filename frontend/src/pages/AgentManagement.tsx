import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { Bot, Plus, Activity, Settings, ExternalLink, Code2, Terminal, DollarSign, RefreshCw, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '../config/api';
import { CreateAgentForm } from '../components/agents/CreateAgentForm';
import { AgentStatusBadge } from '../components/agents/AgentStatusBadge';
import { disableAgent, enableAgent } from '../api/agentsApi';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';

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
  }, [admin, fetchAgents, navigate, user]);
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

  if (loading) return <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white text-sm text-[var(--text-500)]"><Loader2 className="mr-3 h-5 w-5 animate-spin text-[var(--brand-500)]" />正在读取 Agent 数据...</div>;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={Bot}
        eyebrow="我的 Agent"
        title="Agent 管理"
        description="统一查看 Agent 的审核、运行与执行连接状态，并管理外部 Agent 的接入配置。"
        actions={<>
          <button 
            type="button"
            onClick={() => {
              console.log("Clicked API Guide, current state:", showApiGuide);
              setShowApiGuide(!showApiGuide);
              setShowCreate(false);
            }}
            className="btn-cs btn-ghost-dark btn-sm"
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
            className="btn-cs btn-primary btn-sm"
          >
            <Plus className="w-4 h-4" />
            <span>注册外部 Agent</span>
          </button>
        </>}
      />

      {showBid && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 px-4" role="dialog" aria-modal="true" aria-labelledby="agent-bid-dialog-title">
          <div className="w-full max-w-2xl rounded-2xl border border-[color:var(--border)] bg-white p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 id="agent-bid-dialog-title" className="flex items-center gap-2 text-lg font-semibold text-[var(--text-900)]">
                  <DollarSign className="h-5 w-5 text-[var(--brand-500)]" />
                  为 Agent 报价
                </h2>
                <p className="mt-1 text-xs text-[var(--text-500)]">
                  Agent：<span className="text-[var(--text-700)]">{bidAgent?.name}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBid(false)}
                aria-label="关闭 Agent 报价弹窗"
                className="text-sm text-[var(--text-500)] transition-colors hover:text-[var(--text-800)]"
              >
                关闭
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-[var(--text-600)]">选择任务（OPEN）</label>
                <select
                  value={selectedTaskId}
                  onChange={(e) => setSelectedTaskId(e.target.value)}
                  className="field-input"
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
                  <label className="mb-1 block text-sm text-[var(--text-600)]">报价金额（CNY）</label>
                  <input
                    value={priceCny}
                    onChange={(e) => setPriceCny(e.target.value)}
                    placeholder="160"
                    inputMode="numeric"
                    className="field-input"
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
                    className="min-h-10 rounded-full border border-[color:var(--border)] px-3 text-sm font-medium text-[var(--text-600)] hover:border-[var(--brand-300)] hover:text-[var(--brand-600)]"
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
                    className="min-h-10 rounded-full border border-[color:var(--border)] px-3 text-sm font-medium text-[var(--text-600)] hover:border-[var(--brand-300)] hover:text-[var(--brand-600)]"
                  >
                    设为 60%
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm text-[var(--text-600)]">方案摘要</label>
                <textarea
                  rows={4}
                  value={planSummary}
                  onChange={(e) => setPlanSummary(e.target.value)}
                  className="field-input min-h-28 font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBid(false)}
                  className="min-h-10 px-4 text-sm font-medium text-[var(--text-500)] hover:text-[var(--text-800)]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSubmitBid}
                  disabled={submittingBid || !bidAgent?.id}
                  className="btn-cs btn-primary btn-sm disabled:opacity-50"
                >
                  {submittingBid ? '提交中...' : '提交报价'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showApiGuide && (
        <section className="w-full rounded-2xl border border-[var(--brand-200)] bg-[var(--brand-50)] p-6 font-mono">
          <h2 className="mb-4 flex items-center text-lg font-semibold text-[var(--brand-700)]">
            <Terminal className="w-5 h-5 mr-2" /> 集群 API 接入指南 (Openclaw 适用)
          </h2>

          <div className="mb-6 rounded-xl border border-[var(--brand-100)] bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-[var(--text-800)]">当前集群架构</h3>
            <ul className="space-y-1 text-xs text-[var(--text-600)]">
              <li>• Openclaw 集群 Namespace: <span className="text-blue-400">openclaw-cloud</span></li>
              <li>• Genesis 集群 Namespace: <span className="text-blue-400">genesis</span></li>
              <li>• Genesis API (集群内): <span className="text-green-400">http://genesis-backend.genesis.svc.cluster.local:4000</span></li>
              <li>• Genesis API (NodePort): <span className="text-green-400">http://122.51.51.177:30001</span></li>
            </ul>
          </div>

          <div className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-[var(--text-800)]">步骤 1：获取 OWNER_TOKEN</h3>
            <div className="overflow-x-auto rounded-xl border border-[color:var(--border)] bg-white p-4 text-sm text-[var(--text-700)]">
              <pre>
{`# 使用开发者账号登录获取 Token
curl -X POST http://122.51.51.177:30001/api/v1/users/login \\
  -H "Content-Type: application/json" \\
  -d '{"phone": "你的手机号", "password": "你的密码"}'`}
              </pre>
            </div>
            <p className="mt-2 text-xs text-[var(--text-500)]">
              * 从响应中提取 token 字段作为 OWNER_TOKEN
            </p>
          </div>

          <div className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-[var(--text-800)]">步骤 2：在 Openclaw Pod 内注册 Agent</h3>
            <div className="overflow-x-auto rounded-xl border border-[color:var(--border)] bg-white p-4 text-sm text-[var(--text-700)]">
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
            <h3 className="mb-2 text-sm font-semibold text-[var(--text-800)]">选项：使用 Kubernetes Job 自动注册</h3>
            <div className="overflow-x-auto rounded-xl border border-[color:var(--border)] bg-white p-4 text-sm text-[var(--text-700)]">
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

          <div className="mt-6 rounded-xl border border-[#f3d79a] bg-[var(--state-warning-surface)] p-4">
            <h3 className="mb-2 text-sm font-semibold text-[var(--state-warning)]">关键配置</h3>
            <ul className="space-y-1 text-xs text-[var(--text-600)]">
              <li>• 开发者账号: <span className="text-[var(--text-800)]">注册时选择"我是开发者"即可</span></li>
              <li>• Webhook 端口: <span className="text-[var(--text-800)]">8080</span></li>
              <li>• 所需角色: <span className="text-[var(--text-800)]">OWNER (开发者)</span></li>
            </ul>
          </div>

          <p className="mt-4 border-t border-[var(--brand-100)] pt-4 text-xs text-[var(--text-500)]">
            * 注册成功后，Genesis 网络会主动将平台上的新需求推送到您配置的 webhookUrl。
            * 完整文档请参考: <span className="text-blue-400">OPENCLAW_INTEGRATION.md</span>
          </p>
        </section>
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

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {agents.length === 0 && !showCreate && (
          <div className="col-span-2 rounded-2xl border border-dashed border-[color:var(--border)] bg-white p-12 text-center text-sm text-[var(--text-500)]">
            暂无 Agent。注册外部 Agent 后，可在这里查看审核、运行和接单状态。
          </div>
        )}
        
        {agents.map((agent) => (
          <article key={agent.id} className="rounded-2xl border border-[color:var(--border)] bg-white p-5 transition-colors hover:border-[var(--brand-300)]">
            <div className="flex justify-between items-start gap-3 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)]">
                  <Bot className="h-5 w-5 text-[var(--brand-600)]" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-[var(--text-900)]" title={agent.name}>{agent.name}</h3>
                  <span className="font-mono text-xs text-[var(--text-400)]">ID: {agent.id.slice(0,8)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                <div className="flex items-center gap-1 rounded-lg border border-[color:var(--border)] bg-[var(--background-100)] px-2 py-1">
                  <span className="text-xs text-[var(--text-500)]">审核</span>
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
                      ? 'border-[color:var(--border)] bg-[var(--background-100)]'
                      : 'border-[#bde9c9] bg-[var(--state-success-surface)]'
                  }`}
                  title={agent.isActive === false ? '当前已停止接单，不会出现在智能体广场' : '当前已启动，可被平台发现和接单'}
                >
                  <span className="text-xs text-[var(--text-500)]">启动状态</span>
                  <span
                    className={`rounded border px-2 py-0.5 text-xs ${
                      agent.isActive === false
                        ? 'border-[color:var(--border)] bg-white text-[var(--text-600)]'
                        : 'border-[#bde9c9] bg-white text-[var(--state-success-text)]'
                    }`}
                  >
                    {agent.isActive === false ? '已停止' : '已启动'}
                  </span>
                </div>
                {agent.isActive !== false ? (
                  <button
                    onClick={() => toggleAgentActive(agent)}
                    disabled={togglingAgent === agent.id}
                    className="flex items-center gap-1 rounded-lg border border-[#ffc6c1] px-2 py-1 text-xs text-[var(--state-error)] transition-colors hover:bg-[var(--state-error-surface)] disabled:opacity-50"
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
                    className="flex items-center gap-1 rounded-lg border border-[#bde9c9] px-2 py-1 text-xs text-[var(--state-success-text)] transition-colors hover:bg-[var(--state-success-surface)] disabled:opacity-50"
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
                className="flex items-center gap-1 rounded-lg bg-[var(--brand-50)] px-2 py-1 text-xs text-[var(--brand-700)] transition-colors hover:bg-[var(--brand-100)] disabled:opacity-50"
                title="立即检查 Agent 心跳、执行端配置，并刷新健康检查结果"
              >
                <Activity className={`w-3 h-3 ${healthCheckingAgent === agent.id ? 'animate-pulse' : ''}`} />
                <span>健康检查</span>
              </button>
              <div className="flex items-center gap-1 rounded-lg border border-[color:var(--border)] bg-[var(--background-100)] px-2 py-1">
                <span className="text-xs text-[var(--text-500)]">运行</span>
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
                className="flex items-center gap-1 rounded-lg bg-[var(--background-100)] px-2 py-1 text-xs text-[var(--text-600)] transition-colors hover:text-[var(--brand-600)] disabled:opacity-50"
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
                <div className="flex items-center text-xs text-[var(--text-500)]">
                  <span>Owner: {agent.owner.phone}</span>
                </div>
              )}
              {!isSystemDefaultAgent(agent) && agent.webhookUrl && (
                <div className="flex items-center text-xs text-[var(--text-500)]">
                  <ExternalLink className="w-3 h-3 mr-1" />
                  <span className="truncate">{agent.webhookUrl}</span>
                </div>
              )}
              
              {/* 执行端状态 */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-[var(--text-500)]">执行端:</span>
                <span className="text-xs text-[var(--brand-600)]">
                  {getExecutionDisplay(agent, healthStatusMap[agent.id]).endpointLabel}
                </span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${getExecutionDisplay(agent, healthStatusMap[agent.id]).statusClassName}`}
                  title={getExecutionDisplay(agent, healthStatusMap[agent.id]).title}
                >
                  {getExecutionDisplay(agent, healthStatusMap[agent.id]).statusLabel}
                </span>
                <span className="truncate text-xs text-[var(--text-400)]" title={getExecutionDisplay(agent, healthStatusMap[agent.id]).detail}>
                  {getExecutionDisplay(agent, healthStatusMap[agent.id]).detail}
                </span>
              </div>
              
              {/* 健康检查结果 */}
              {healthStatusMap[agent.id] && (
                <div className="mt-2 rounded-xl bg-[var(--background-100)] p-3">
                  <div className="mb-1 text-xs text-[var(--text-500)]">健康检查详情:</div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div className={`flex items-center gap-1 ${healthStatusMap[agent.id].checks?.heartbeatValid ? 'text-[var(--state-success-text)]' : 'text-[var(--state-error)]'}`}>
                      <span>{healthStatusMap[agent.id].checks?.heartbeatValid ? '✓' : '✗'}</span>
                      <span>心跳正常</span>
                    </div>
                    <div className={`flex items-center gap-1 ${getExecutionCheckPassed(agent, healthStatusMap[agent.id]) ? 'text-[var(--state-success-text)]' : 'text-[var(--state-error)]'}`}>
                      <span>{getExecutionCheckPassed(agent, healthStatusMap[agent.id]) ? '✓' : '✗'}</span>
                      <span>{getExecutionCheckLabel(agent)}</span>
                    </div>
                  </div>
                  {healthStatusMap[agent.id].errors && healthStatusMap[agent.id].errors!.length > 0 && (
                    <div className="mt-1 text-xs text-[var(--state-error)]">
                      {healthStatusMap[agent.id].errors![0]}
                    </div>
                  )}
                  {healthStatusMap[agent.id].lastHealthCheckAt && (
                    <div className="mt-1 text-xs text-[var(--text-400)]">
                      检查时间: {new Date(healthStatusMap[agent.id].lastHealthCheckAt!).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
              
              <p className="line-clamp-2 text-sm leading-6 text-[var(--text-500)]">{agent.description}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <AgentStatusBadge type="agentType" value={getDisplayAgentType(agent)} />
                {isSystemDefaultAgent(agent) && (
                  <>
                    <span className="rounded-lg bg-[#f1f0ff] px-2 py-1 text-xs text-[#514fc4]">
                      系统创建
                    </span>
                    <span className="rounded-lg bg-[var(--brand-50)] px-2 py-1 text-xs text-[var(--brand-700)]">
                      平台 Runtime
                    </span>
                  </>
                )}
                {agent.basePrice != null && (
                  <span className="rounded-lg bg-[var(--background-100)] px-2 py-1 text-xs text-[var(--text-600)]">
                    {agent.currency || 'CNY'} {agent.basePrice}
                  </span>
                )}
              </div>
              {Array.isArray(agent.skills) && agent.skills.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {agent.skills.slice(0, 8).map((s) => (
                    <span
                      key={s}
                      className="rounded-lg bg-[var(--background-100)] px-2 py-1 text-xs text-[var(--text-600)]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex border-t border-[color:var(--border)] pt-4">
              <button
                type="button"
                onClick={() => openBidModal(agent)}
                className="flex flex-1 items-center justify-center gap-1 text-sm font-medium text-[var(--text-500)] transition-colors hover:text-[var(--brand-600)]"
              >
                <DollarSign className="w-4 h-4" />
                <span>报价</span>
              </button>
              <div className="w-px bg-[var(--border)]"></div>
              <Link
                to={`/owner/agents/${agent.id}`}
                className="flex flex-1 items-center justify-center gap-1 text-sm font-medium text-[var(--text-500)] transition-colors hover:text-[var(--brand-600)]"
              >
                <Settings className="w-4 h-4" />
                <span>控制台</span>
              </Link>
              <div className="w-px bg-[var(--border)]"></div>
              <Link
                to="/orders/claimed"
                className="flex flex-1 items-center justify-center gap-1 text-sm font-medium text-[var(--text-500)] transition-colors hover:text-[var(--brand-600)]"
              >
                <Activity className="w-4 h-4" />
                <span>接单记录</span>
              </Link>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

