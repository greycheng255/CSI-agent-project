import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Award,
  Bot,
  Clock,
  ExternalLink,
  Megaphone,
  RefreshCw,
  Save,
  Star,
  Store,
} from 'lucide-react';
import {
  createWorkspace,
  getWorkspaceByOwner,
  toNumber,
  updateWorkspaceShowcase,
} from '../api/longtaskApi';
import type {
  WorkspaceShowcaseCase,
  WorkspaceShowcaseData,
} from '../api/longtaskApi';
import { listOwnerAgents } from '../api/agentsApi';
import { useAuthStore } from '../store/authStore';
import type { Agent } from '../types/agent';

type PageState =
  | { status: 'loading'; workspace: null }
  | { status: 'missing'; workspace: null }
  | { status: 'ready'; workspace: WorkspaceShowcaseData }
  | { status: 'error'; workspace: null };

/**
 * 工作台 - 我的工作室（平台侧卖方主体升级改造的核心管理面）：
 * 承接「AI 工作室」概念点：门面编辑（简介/能力/服务承诺/公告/案例）、
 * 信用数据（平台生成只读）、名下 Agent、店铺门面预览入口。
 */
export default function MyWorkspace() {
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState<PageState>({ status: 'loading', workspace: null });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [notify, setNotify] = useState<string | null>(null);

  // 门面编辑表单（以当前数据为初始值）
  const [bio, setBio] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [responseTime, setResponseTime] = useState('');
  const [revisions, setRevisions] = useState('');
  const [refund, setRefund] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [cases, setCases] = useState<WorkspaceShowcaseCase[]>([]);

  const load = useCallback(async () => {
    if (!user) {
      setState({ status: 'missing', workspace: null });
      return;
    }
    setState({ status: 'loading', workspace: null });
    try {
      const workspace = await getWorkspaceByOwner(user.id);
      if (!workspace) {
        setState({ status: 'missing', workspace: null });
        return;
      }
      setState({ status: 'ready', workspace });
      syncForm(workspace);
      listOwnerAgents(user.id)
        .then(setAgents)
        .catch(() => setAgents([]));
    } catch {
      setState({ status: 'error', workspace: null });
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  function syncForm(workspace: WorkspaceShowcaseData) {
    setBio(workspace.bio ?? '');
    setTagsText((workspace.capabilityTags ?? []).join('，'));
    const commitments = workspace.serviceCommitments ?? {};
    setResponseTime(String(commitments.response_time ?? ''));
    setRevisions(String(commitments.revisions ?? ''));
    setRefund(String(commitments.refund ?? ''));
    setAnnouncement(workspace.announcement ?? '');
    setCases((workspace.showcaseCases ?? []).slice());
  }

  async function handleCreate() {
    if (!user) return;
    setSaving(true);
    try {
      const slug = `u-${user.id.replace(/-/g, '').slice(0, 10)}`;
      await createWorkspace({
        ownerUserId: user.id,
        name: `${user.displayName || user.phone} 的工作室`,
        slug,
      });
      await load();
    } catch (e) {
      setNotify(e instanceof Error ? e.message : '开通失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (state.status !== 'ready') return;
    setSaving(true);
    try {
      const updated = await updateWorkspaceShowcase(state.workspace.id, {
        bio,
        capabilityTags: tagsText
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 5),
        serviceCommitments: {
          response_time: responseTime.trim(),
          revisions: revisions.trim(),
          refund: refund.trim(),
        },
        announcement: announcement.trim().slice(0, 200) || null,
        showcaseCases: cases.slice(0, 6),
      });
      setState({ status: 'ready', workspace: updated });
      syncForm(updated);
      setSavedAt(new Date().toLocaleTimeString());
      setNotify('工作室门面已保存');
    } catch (e) {
      setNotify(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="card-cs flex flex-col items-center gap-4 p-10 text-center">
          <span className="icon-tile-cs">
            <Store className="h-6 w-6" />
          </span>
          <h1 className="text-lg font-bold text-[var(--text-900)]">我的工作室</h1>
          <p className="text-sm text-[var(--text-500)]">登录后即可开通与管理你的 AI 工作室</p>
          <Link to="/login" className="btn-cs btn-primary btn-sm mt-2">
            登录后查看
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="max-w-3xl space-y-4" aria-label="正在读取工作室">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-[var(--background-100)]" />
        <div className="h-64 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
      </div>
    );
  }

  if (state.status === 'missing') {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="card-cs flex flex-col items-center gap-4 p-10 text-center">
          <span className="icon-tile-cs">
            <Store className="h-6 w-6" />
          </span>
          <h1 className="text-lg font-bold text-[var(--text-900)]">开通你的 AI 工作室</h1>
          <p className="max-w-md text-sm leading-relaxed text-[var(--text-500)]">
            工作室是你运营智能体、参与竞标与交付的业务主体。开通后可配置门面信息（简介/能力/服务承诺/案例），雇主将通过工作室展示页了解你。
          </p>
          {notify && <p className="text-sm text-[var(--danger-600,#c0392b)]">{notify}</p>}
          <button onClick={handleCreate} disabled={saving} className="btn-cs btn-primary btn-sm mt-2">
            {saving ? '开通中…' : '立即开通'}
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="card-cs p-8 text-center text-sm text-[var(--text-500)]">
          读取工作室失败，请刷新重试。
          <button onClick={() => void load()} className="btn-cs btn-ghost btn-sm mt-3">
            重新加载
          </button>
        </div>
      </div>
    );
  }

  const ws = state.workspace;

  return (
    <div className="max-w-4xl space-y-6">
      {/* 头部 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--v3-grad-brand)] text-base font-bold text-white">
            {ws.name.slice(0, 2)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-[var(--text-900)]">{ws.name}</h1>
            <p className="text-xs text-[var(--text-500)]">@{ws.slug}</p>
          </div>
        </div>
        <Link
          to={`/longtask/workspaces/${ws.slug}`}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-white px-3 text-sm font-medium text-[var(--brand-600)] hover:bg-[var(--brand-50)]"
        >
          <ExternalLink className="h-4 w-4" />
          查看店铺门面
        </Link>
      </header>

      {/* 信用数据（只读，平台生成） */}
      <section className="card-cs p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-900)]">信用数据</h2>
          <span className="text-[10px] text-[var(--text-400)]">平台自动计算，不可修改</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CreditCard icon={Award} value={String(toNumber(ws.completedTasksCount))} label="完成任务" />
          <CreditCard icon={Star} value={toNumber(ws.avgRating).toFixed(1)} label="平均评分" />
          <CreditCard icon={Clock} value={`${Math.round(toNumber(ws.onTimeRate) * 100)}%`} label="按时交付率" />
          <CreditCard icon={RefreshCw} value={`${Math.round(toNumber(ws.disputeRate) * 100)}%`} label="纠纷率" />
        </div>
      </section>

      {/* 门面编辑 */}
      <section className="card-cs p-6">
        <h2 className="mb-4 text-base font-semibold text-[var(--text-900)]">门面信息</h2>
        <div className="space-y-4">
          <div>
            <label className="label-cs">工作室简介</label>
            <textarea
              className="input-cs min-h-24 resize-y"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="介绍你的工作室与交付能力"
            />
          </div>
          <div>
            <label className="label-cs">能力标签（≤5 个，逗号分隔）</label>
            <input
              className="input-cs"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="电商文案，SaaS 官网，数据分析报告"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label-cs">响应承诺</label>
              <input className="input-cs" value={responseTime} onChange={(e) => setResponseTime(e.target.value)} placeholder="24h 内响应" />
            </div>
            <div>
              <label className="label-cs">修订承诺</label>
              <input className="input-cs" value={revisions} onChange={(e) => setRevisions(e.target.value)} placeholder="2 次免费修订" />
            </div>
            <div>
              <label className="label-cs">退款承诺</label>
              <input className="input-cs" value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="14 天退款保障" />
            </div>
          </div>
          <div>
            <label className="label-cs flex items-center gap-1.5">
              <Megaphone className="h-3.5 w-3.5" />
              首页公告（≤200 字）
            </label>
            <textarea
              className="input-cs min-h-20 resize-y"
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              placeholder="近期的接单计划或品牌主张"
            />
          </div>

          <div>
            <label className="label-cs">历史交付案例（≤6 个）</label>
            {cases.length === 0 && (
              <p className="mb-3 text-sm text-[var(--text-400)]">暂无案例，添加案例可提升雇主信任。</p>
            )}
            <div className="space-y-2">
              {cases.map((item, index) => (
                <div key={index} className="flex items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[var(--background-25,var(--background))] px-3 py-2">
                  <div className="min-w-0 flex-1 text-sm text-[var(--text-700)]">{item.title}</div>
                  <span className="shrink-0 text-[10px] text-[var(--text-400)]">
                    {item.permission === 'review_only' ? '仅评审可见' : '公开'}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-[var(--danger-600,#c0392b)] hover:underline"
                    onClick={() => setCases(cases.filter((_, i) => i !== index))}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn-cs btn-ghost btn-sm mt-3"
              disabled={cases.length >= 6}
              onClick={() =>
                setCases([
                  ...cases,
                  {
                    title: `案例 ${cases.length + 1}`,
                    summary: '',
                    permission: 'public',
                  },
                ])
              }
            >
              + 添加案例
            </button>
          </div>

          <div className="flex items-center gap-3 border-t border-[color:var(--border)] pt-4">
            <button onClick={handleSave} disabled={saving} className="btn-cs btn-primary btn-sm">
              <Save className="h-4 w-4" />
              {saving ? '保存中…' : '保存门面'}
            </button>
            {savedAt && <span className="text-xs text-[var(--text-400)]">上次保存 {savedAt}</span>}
            {notify && <span className="text-xs text-[var(--brand-600)]">{notify}</span>}
          </div>
        </div>
      </section>

      {/* 名下 Agent（短任务 agentMarket 归属工作室） */}
      <section className="card-cs p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-900)]">名下 Agent</h2>
          <Link to="/owner/agents" className="text-sm font-medium text-[var(--brand-600)] hover:text-[var(--brand-700)]">
            管理智能体 →
          </Link>
        </div>
        {agents.length === 0 ? (
          <p className="text-sm text-[var(--text-400)]">
            名下暂无 Agent，前往「我的 Agent」接入你的第一个智能体。
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {agents.slice(0, 8).map((agent) => (
              <li key={agent.id} className="flex items-center gap-3 py-2.5">
                <Bot className="h-4 w-4 shrink-0 text-[var(--brand-600)]" />
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-700)]">{agent.name}</span>
                <span className="shrink-0 text-xs text-[var(--text-400)]">
                  {agent.runtimeStatus === 'online'
                    ? '在线'
                    : agent.runtimeStatus === 'offline'
                      ? '离线'
                      : agent.runtimeStatus ?? '未知'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CreditCard({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Award;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-xl bg-[var(--background-50)] p-3 text-center">
      <Icon className="mx-auto mb-1 h-4 w-4 text-[var(--brand-600)]" />
      <p className="text-lg font-bold text-[var(--text-900)]">{value}</p>
      <p className="mt-0.5 text-xs text-[var(--text-400)]">{label}</p>
    </div>
  );
}