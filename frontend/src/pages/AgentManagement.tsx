import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { Bot, Plus, Activity, Settings, ExternalLink, Code2, Terminal, DollarSign, RefreshCw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '../config/api';

type AgentStatus = 'ONLINE' | 'OFFLINE';
type OpenclawStatus = 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN';

type Agent = {
  id: string;
  name: string;
  description?: string;
  webhookUrl?: string;
  status?: AgentStatus;
  skills?: string[];
  podName?: string;
  owner?: {
    phone?: string;
  };
  openclawUrl?: string;
  openclawStatus?: OpenclawStatus;
  lastHealthCheckAt?: string;
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

export default function AgentManagement() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const apiBase = API_BASE;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  // 创建 Agent 表单
  const [showCreate, setShowCreate] = useState(false);
  const [showApiGuide, setShowApiGuide] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');

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
  const [healthStatusMap, setHealthStatusMap] = useState<Record<string, {
    status: AgentStatus;
    openclawStatus: OpenclawStatus;
    lastHealthCheckAt?: string;
    checks?: {
      podRunning: boolean;
      heartbeatValid: boolean;
      openclawReachable: boolean;
      configurationValid: boolean;
    };
    errors?: string[];
  }>>({});

  const fetchAgents = useCallback(() => {
    if (!user?.id) return;
    setLoading(true);
    const token = localStorage.getItem('token');
    fetch(`${apiBase}/api/v1/owner/agents/user/${user.id}`, {
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

  // 刷新单个 Agent 状态
  const refreshAgentStatus = async (agentId: string) => {
    setRefreshingAgent(agentId);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${apiBase}/api/v1/owner/agents/${agentId}/status`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('Failed to fetch agent status');
      const data = await res.json();
      // 更新该 Agent 的状态
      setAgents(prev => prev.map(agent => 
        agent.id === agentId ? { ...agent, status: data.status } : agent
      ));
    } catch (err) {
      console.error('Refresh agent status error:', err);
    } finally {
      setRefreshingAgent(null);
    }
  };

  // 执行健康检查（探测 Openclaw 关联状态）
  const performHealthCheck = async (agentId: string) => {
    setHealthCheckingAgent(agentId);
    try {
      const token = localStorage.getItem('token');
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
          openclawStatus: data.openclawStatus,
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
          openclawStatus: data.openclawStatus,
          lastHealthCheckAt: data.lastHealthCheckAt,
        } : agent
      ));
      
      // 显示检查结果
      if (data.errors && data.errors.length > 0) {
        alert(`健康检查完成，发现问题：\n${data.errors.join('\n')}`);
      } else {
        alert('健康检查完成：Agent 和 Openclaw 连接正常');
      }
    } catch (err) {
      console.error('Health check error:', err);
      alert('健康检查失败：' + (err instanceof Error ? err.message : '请检查网络'));
    } finally {
      setHealthCheckingAgent(null);
    }
  };

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchAgents();
  }, [fetchAgents, navigate, user]);

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${apiBase}/api/v1/owner/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          description,
          webhookUrl,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to create agent');
      }

      alert('硅基劳动力注册成功！');
      setShowCreate(false);
      setName('');
      setDescription('');
      setWebhookUrl('');
      fetchAgents();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '请检查网络';
      alert('创建失败: ' + errorMessage);
    }
  };

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
            <span>硅基劳动力管理 (Agent Console)</span>
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
            <span>手动注册</span>
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
{`# 使用开发者账号登录获取 Token (默认: 13900000002 / 123456)
curl -X POST http://122.51.51.177:30001/api/v1/users/login \\
  -H "Content-Type: application/json" \\
  -d '{"phone": "13900000002", "password": "123456"}'`}
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
              <li>• 开发者账号: <span className="text-gray-300">13900000002 / 123456</span></li>
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
        <div className="border border-purple-900/50 bg-purple-900/10 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-bold text-purple-400 mb-4">注册新的硅基劳动力</h2>
          <form onSubmit={handleCreateAgent} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Agent 名称</label>
                <input required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Openclaw-01" className="w-full bg-black border border-gray-700 rounded px-3 py-2 focus:border-purple-500 outline-none text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Webhook URL (接收平台派单)</label>
                <input required value={webhookUrl} onChange={e=>setWebhookUrl(e.target.value)} placeholder="https://your-server.com/webhook" className="w-full bg-black border border-gray-700 rounded px-3 py-2 focus:border-purple-500 outline-none text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">能力描述</label>
              <input value={description} onChange={e=>setDescription(e.target.value)} placeholder="擅长 Python 爬虫与数据清洗..." className="w-full bg-black border border-gray-700 rounded px-3 py-2 focus:border-purple-500 outline-none text-sm" />
            </div>
            <div className="flex justify-end space-x-3 pt-2">
              <button type="button" onClick={()=>setShowCreate(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">取消</button>
              <button type="submit" className="px-6 py-2 bg-purple-500 text-black font-bold rounded hover:bg-purple-400 text-sm">提交注册</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.length === 0 && !showCreate && (
          <div className="col-span-2 border border-gray-800 border-dashed rounded-xl p-12 text-center text-gray-500">
            您还没有注册任何 Agent。
          </div>
        )}
        
        {agents.map((agent) => (
          <div key={agent.id} className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-5 hover:border-purple-500/30 transition-colors">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
                  <Bot className="w-6 h-6 text-purple-400" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-200">{agent.name}</h3>
                  <span className="text-xs font-mono text-gray-500">ID: {agent.id.slice(0,8)}</span>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => performHealthCheck(agent.id)}
                  disabled={healthCheckingAgent === agent.id}
                  className="p-1.5 rounded bg-blue-500/10 text-blue-400 hover:text-blue-300 hover:bg-blue-500/20 transition-colors"
                  title="健康检查（探测 Openclaw 关联）"
                >
                  <Activity className={`w-3.5 h-3.5 ${healthCheckingAgent === agent.id ? 'animate-pulse' : ''}`} />
                </button>
                <button
                  onClick={() => refreshAgentStatus(agent.id)}
                  disabled={refreshingAgent === agent.id}
                  className="p-1.5 rounded bg-gray-800/50 text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 transition-colors"
                  title="刷新状态"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingAgent === agent.id ? 'animate-spin' : ''}`} />
                </button>
                <span className={`px-2 py-0.5 rounded text-xs border ${agent.status === 'ONLINE' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                  {agent.status}
                </span>
              </div>
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
              <div className="text-xs text-gray-400 flex items-center">
                <ExternalLink className="w-3 h-3 mr-1" />
                <span className="truncate">{agent.webhookUrl}</span>
              </div>
              
              {/* Openclaw 连接状态 */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-gray-500">Openclaw:</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  agent.openclawStatus === 'CONNECTED' 
                    ? 'bg-green-500/10 text-green-400' 
                    : agent.openclawStatus === 'DISCONNECTED'
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-gray-800 text-gray-500'
                }`}>
                  {agent.openclawStatus || 'UNKNOWN'}
                </span>
                {agent.openclawUrl && (
                  <span className="text-xs text-gray-600 truncate">{agent.openclawUrl}</span>
                )}
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
                    <div className={`flex items-center gap-1 ${healthStatusMap[agent.id].checks?.openclawReachable ? 'text-green-400' : 'text-red-400'}`}>
                      <span>{healthStatusMap[agent.id].checks?.openclawReachable ? '✓' : '✗'}</span>
                      <span>Openclaw 可达</span>
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
