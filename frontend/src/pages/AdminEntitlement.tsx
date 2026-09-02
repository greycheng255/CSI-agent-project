import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { Navigate } from 'react-router-dom';
import { API_BASE } from '../config/api';
import { CircleAlert, Loader2, Plus, Pencil, Ban, Package } from 'lucide-react';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';

interface PlanModel {
  model_id: string;
  tier: string | null;
  model_type: string;
  flagship: boolean;
}

interface Plan {
  id: string;
  code: string;
  name: string;
  status: string;
  period_days: number;
  total_tokens: number;
  total_credits: number;
  max_runtime_instances: number;
  runtime_profiles: string[];
  price_cents: number;
  models: PlanModel[];
}

interface Subscription {
  id: string;
  org_id: string;
  status: string;
  plan_code: string | null;
  plan_name: string | null;
  pending_plan: string | null;
  period_end: string;
  quota:
    | {
        total_tokens: number;
        used_tokens: number;
        total_credits: number;
        used_credits: number;
      }
    | null;
  free_quota:
    | {
        total_tokens: number;
        used_tokens: number;
        total_credits: number;
        used_credits: number;
        valid_until: string;
      }
    | null;
}

interface CreditHold {
  task_id: string;
  org_id: string;
  workspace_id: string;
  agent_run_id: string | null;
  model: string;
  estimated_credits: number;
  settled_credits: number | null;
  status: string;
  created_at: string;
}

interface UsageReport {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  credits: number;
  cost_cents: number;
  cursor: string;
}

const emptyForm = {
  code: '',
  name: '',
  period_days: '30',
  total_tokens: '-1',
  total_credits: '-1',
  max_runtime_instances: '-1',
  runtime_profiles: '*',
  price_cents: '0',
  models: '',
};

/** AI 网关套餐运营管理（开发计划 §4-P0 #7）：套餐/目录维护 + Org 订阅查看 */
export default function AdminEntitlement() {
  const { adminToken, admin } = useAuthStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [creditHolds, setCreditHolds] = useState<CreditHold[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [actionOrg, setActionOrg] = useState('');
  const [actionPlan, setActionPlan] = useState('');
  const [usageWorkspace, setUsageWorkspace] = useState('');
  const [usageReport, setUsageReport] = useState<UsageReport | null>(null);

  const authHeaders = { Authorization: `Bearer ${adminToken}` };

  const fetchData = useCallback(async () => {
    try {
      const [plansRes, subsRes, holdsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/admin/entitlement/plans`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/v1/admin/entitlement/subscriptions`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/v1/admin/entitlement/credit-holds?status=frozen`, {
          headers: authHeaders,
        }),
      ]);
      if (plansRes.ok) setPlans((await plansRes.json()).data || []);
      if (subsRes.ok) setSubscriptions((await subsRes.json()).data || []);
      if (holdsRes.ok) setCreditHolds((await holdsRes.json()).data || []);
      if (!plansRes.ok || !subsRes.ok || !holdsRes.ok) setError('获取套餐数据失败');
    } catch {
      setError('获取套餐数据失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  useEffect(() => {
    if (admin) fetchData();
  }, [admin, fetchData]);

  if (!admin) {
    return <Navigate to="/login" replace />;
  }

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (plan: Plan) => {
    setEditing(plan);
    setForm({
      code: plan.code,
      name: plan.name,
      period_days: String(plan.period_days),
      total_tokens: String(plan.total_tokens),
      total_credits: String(plan.total_credits),
      max_runtime_instances: String(plan.max_runtime_instances),
      runtime_profiles: plan.runtime_profiles.join(','),
      price_cents: String(plan.price_cents),
      models: plan.models
        .map((m) =>
          [m.model_id, m.model_type, m.tier ?? '', m.flagship ? '1' : '']
            .join(',')
            .replace(/,$/, ''),
        )
        .join('\n'),
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code || !form.name) {
      setError('请填写套餐编码与名称');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      code: form.code,
      name: form.name,
      period_days: Number(form.period_days) || 30,
      total_tokens: Number(form.total_tokens) || -1,
      total_credits: Number(form.total_credits) || -1,
      max_runtime_instances: Number(form.max_runtime_instances) || -1,
      runtime_profiles: form.runtime_profiles
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      price_cents: Number(form.price_cents) || 0,
      models: form.models
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [model_id, model_type, tier, flagship] = line
            .split(',')
            .map((s) => s.trim());
          return {
            model_id,
            model_type: model_type || 'chat',
            tier: tier || null,
            flagship: flagship === '1',
          };
        }),
    };
    try {
      const url = editing
        ? `${API_BASE}/api/v1/admin/entitlement/plans/${editing.id}/update`
        : `${API_BASE}/api/v1/admin/entitlement/plans`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowForm(false);
        await fetchData();
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.message || errData.error || '保存失败');
      }
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDeprecate = async (plan: Plan) => {
    if (!window.confirm(`确认停用套餐「${plan.name}」？存量订阅保留至周期结束。`)) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/entitlement/plans/${plan.id}/deprecate`,
        { method: 'POST', headers: authHeaders },
      );
      if (res.ok) await fetchData();
      else setError('停用失败');
    } catch {
      setError('停用失败，请重试');
    }
  };

  const postJson = async (url: string, body?: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.ok;
  };

  const handleLifecycle = async (action: 'activate' | 'upgrade' | 'downgrade', sub?: Subscription) => {
    const orgId = sub ? sub.org_id : actionOrg.trim();
    if (!orgId) {
      setError('请填写 Org ID');
      return;
    }
    let planCode = actionPlan || undefined;
    if (action !== 'activate' && !planCode) {
      const input = window.prompt(
        `目标套餐编码（升级即时生效；降级下周期生效）：`,
        sub?.plan_code ?? '',
      );
      if (!input) return;
      planCode = input.trim();
    }
    if (action === 'activate') {
      if (!(await postJson(`${API_BASE}/api/v1/admin/entitlement/subscriptions/activate`, { org_id: orgId, plan_code: planCode }))) {
        setError('激活失败');
        return;
      }
    } else if (sub) {
      const ok = await postJson(
        `${API_BASE}/api/v1/admin/entitlement/subscriptions/${sub.id}/${action}`,
        { plan_code: planCode },
      );
      if (!ok) {
        setError(action === 'upgrade' ? '升级失败' : '降级失败');
        return;
      }
    }
    setError('');
    await fetchData();
  };

  const handleHoldSettle = async (hold: CreditHold) => {
    const actual = window.prompt(
      `结算冻结单 ${hold.task_id}（预扣 ${hold.estimated_credits} credits）\n实际扣费 credits：`,
      String(hold.estimated_credits),
    );
    if (actual === null) return;
    const ok = await postJson(
      `${API_BASE}/api/v1/admin/entitlement/credit-holds/${hold.task_id}/settle`,
      { actual_credits: Number(actual) || 0 },
    );
    if (!ok) {
      setError('结算失败');
      return;
    }
    setError('');
    await fetchData();
  };

  const handleHoldRefund = async (hold: CreditHold) => {
    if (!window.confirm(`确认退款释放冻结单 ${hold.task_id}（${hold.estimated_credits} credits）？`)) return;
    const ok = await postJson(
      `${API_BASE}/api/v1/admin/entitlement/credit-holds/${hold.task_id}/refund`,
    );
    if (!ok) {
      setError('退款失败');
      return;
    }
    setError('');
    await fetchData();
  };

  const handleUsageQuery = async () => {
    const wsId = usageWorkspace.trim();
    if (!wsId) {
      setError('请填写 Workspace ID');
      return;
    }
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86_400_000);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/entitlement/workspaces/${wsId}/usage?period_start=${start.toISOString()}&period_end=${end.toISOString()}`,
        { headers: authHeaders },
      );
      if (res.ok) {
        setUsageReport((await res.json()).data || null);
        setError('');
      } else {
        setError('用量查询失败');
      }
    } catch {
      setError('用量查询失败，请重试');
    }
  };

  const formatTokens = (n: number) => (n === -1 ? '无限' : n.toLocaleString());

  return (
    <div className="min-h-screen bg-gray-50">
      <WorkbenchPageHeader
        icon={Package}
        eyebrow="运营管理"
        title="AI 网关套餐"
        description="订阅套餐、模型目录与 Org 额度查看（DR-12 商业化面）"
        actions={
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> 新建套餐
          </button>
        }
      />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            <CircleAlert className="h-4 w-4" /> {error}
          </div>
        )}

        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h3 className="text-base font-semibold text-gray-900">
              {editing ? `编辑套餐：${editing.name}` : '新建套餐'}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">套餐编码 *</span>
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="pro"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">名称 *</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="专业版"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">周期（天）</span>
                <input
                  type="number"
                  value={form.period_days}
                  onChange={(e) => setForm({ ...form, period_days: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Token 额度（-1 无限）
                </span>
                <input
                  type="number"
                  value={form.total_tokens}
                  onChange={(e) => setForm({ ...form, total_tokens: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Credits 额度（媒体生成，-1 无限）
                </span>
                <input
                  type="number"
                  value={form.total_credits}
                  onChange={(e) => setForm({ ...form, total_credits: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  实例数上限（-1 无限）
                </span>
                <input
                  type="number"
                  value={form.max_runtime_instances}
                  onChange={(e) =>
                    setForm({ ...form, max_runtime_instances: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Profile 目录（逗号分隔，* 通配）
                </span>
                <input
                  value={form.runtime_profiles}
                  onChange={(e) => setForm({ ...form, runtime_profiles: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">价格（分）</span>
                <input
                  type="number"
                  value={form.price_cents}
                  onChange={(e) => setForm({ ...form, price_cents: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm sm:col-span-2 lg:col-span-4">
                <span className="mb-1 block font-medium text-gray-700">
                  模型目录（每行一条：model_id, model_type, tier, 旗舰填 1）
                </span>
                <textarea
                  value={form.models}
                  onChange={(e) => setForm({ ...form, models: e.target.value })}
                  rows={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
                  placeholder={
                    'gpt-5.5, chat, flagship, 1\ndoubao-seedream-4-5-251128, image\ngrok-video-3, video\n'
                  }
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                保存
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </form>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">套餐列表</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : plans.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              暂无套餐，点击「新建套餐」创建
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">套餐</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">周期</th>
                    <th className="px-4 py-3">Token 额度</th>
                    <th className="px-4 py-3">实例上限</th>
                    <th className="px-4 py-3">模型目录</th>
                    <th className="px-4 py-3">价格</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {plans.map((plan) => (
                    <tr key={plan.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{plan.name}</div>
                        <div className="font-mono text-xs text-gray-500">{plan.code}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            plan.status === 'active'
                              ? 'bg-green-50 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {plan.status === 'active' ? '启用' : '已停用'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{plan.period_days} 天</td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatTokens(plan.total_tokens)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatTokens(plan.total_credits)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {plan.max_runtime_instances === -1
                          ? '无限'
                          : plan.max_runtime_instances}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {plan.models.length} 个模型
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        ¥{(plan.price_cents / 100).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => openEdit(plan)}
                            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-blue-600"
                            title="编辑"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {plan.status === 'active' && (
                            <button
                              onClick={() => handleDeprecate(plan)}
                              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-red-600"
                              title="停用"
                            >
                              <Ban className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">订阅操作</h2>
            <select
              value={actionPlan}
              onChange={(e) => setActionPlan(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="">默认套餐（free）</option>
              {plans
                .filter((p) => p.status === 'active')
                .map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.name}（{p.code}）
                  </option>
                ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <input
              value={actionOrg}
              onChange={(e) => setActionOrg(e.target.value)}
              className="w-72 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
              placeholder="Org ID（激活新订阅）"
            />
            <button
              onClick={() => handleLifecycle('activate')}
              className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              激活订阅
            </button>
            <span className="text-xs text-gray-400">
              升级即时生效（差价折算由结算版块承担）；降级下个计费周期生效
            </span>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Org 订阅</h2>
          {subscriptions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              暂无订阅
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Org</th>
                    <th className="px-4 py-3">套餐</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">周期结束</th>
                    <th className="px-4 py-3">额度用量</th>
                    <th className="px-4 py-3">Credits 用量</th>
                    <th className="px-4 py-3">免费额度</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {subscriptions.map((sub) => (
                    <tr key={sub.id}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {sub.org_id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {sub.plan_name}
                        {sub.pending_plan && (
                          <span className="ml-1 text-xs text-amber-600">
                            （降级 → {sub.pending_plan} 下周期生效）
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          {sub.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {new Date(sub.period_end).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {sub.quota
                          ? `${sub.quota.used_tokens.toLocaleString()} / ${formatTokens(sub.quota.total_tokens)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {sub.quota
                          ? `${sub.quota.used_credits.toLocaleString()} / ${formatTokens(sub.quota.total_credits)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {sub.free_quota
                          ? `${sub.free_quota.used_tokens.toLocaleString()} / ${formatTokens(sub.free_quota.total_tokens)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => handleLifecycle('upgrade', sub)}
                            className="rounded-lg px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                          >
                            升级
                          </button>
                          <button
                            onClick={() => handleLifecycle('downgrade', sub)}
                            className="rounded-lg px-2 py-1 text-xs text-amber-600 hover:bg-amber-50"
                          >
                            降级
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">
            预扣费冻结单
            <span className="ml-2 text-sm font-normal text-gray-500">
              媒体生成提交时冻结 credits，终态结算/退款（对账兜底）
            </span>
          </h2>
          {creditHolds.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              暂无冻结中的冻结单
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Task</th>
                    <th className="px-4 py-3">Org</th>
                    <th className="px-4 py-3">模型</th>
                    <th className="px-4 py-3">预扣 credits</th>
                    <th className="px-4 py-3">提交时间</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {creditHolds.map((hold) => (
                    <tr key={hold.task_id}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {hold.task_id}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {hold.org_id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {hold.model}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{hold.estimated_credits}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {new Date(hold.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => handleHoldSettle(hold)}
                            className="rounded-lg px-2 py-1 text-xs text-green-700 hover:bg-green-50"
                          >
                            结算
                          </button>
                          <button
                            onClick={() => handleHoldRefund(hold)}
                            className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          >
                            退款
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">用量查询</h2>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <input
              value={usageWorkspace}
              onChange={(e) => setUsageWorkspace(e.target.value)}
              className="w-80 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
              placeholder="Workspace ID（近 30 天）"
            />
            <button
              onClick={handleUsageQuery}
              className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              查询
            </button>
            {usageReport && (
              <span className="text-sm text-gray-700">
                请求数 {usageReport.requests} · 输入 {usageReport.input_tokens.toLocaleString()} ·
                输出 {usageReport.output_tokens.toLocaleString()} · credits{' '}
                {usageReport.credits.toLocaleString()} · 金额 ¥
                {(usageReport.cost_cents / 100).toFixed(2)}
              </span>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
