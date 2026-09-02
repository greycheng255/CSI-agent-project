import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bot,
  CircleAlert,
  ClipboardList,
  DollarSign,
  Inbox,
  Loader2,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { WorkbenchPageHeader, WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';
import { API_BASE } from '../config/api';
import { getActiveToken, useAuthStore } from '../store/authStore';

interface DashboardData {
  summary: {
    totalRevenue: number;
    totalTasks: number;
    totalBids: number;
    totalOrders: number;
    onlineAgents: number;
    completionRate: number;
  };
  trends: {
    tasks: Array<{ date: string; count: number }>;
    bids: Array<{ date: string; count: number; avgPrice: number }>;
    orders: Array<{ date: string; count: number; revenue: number }>;
  };
  agents: {
    total: number;
    online: number;
    offline: number;
    agents: Array<{ id: string; name: string; bidCount: number; avgPrice: number }>;
  };
  period: { start: string; end: string };
}

type TrendChartProps = {
  data: Array<{ date: string; count: number }>;
  label: string;
  color: string;
};

function TrendChart({ data, label, color }: TrendChartProps) {
  const maxValue = Math.max(...data.map((item) => item.count), 1);

  return (
    <section className="min-w-0 px-5 py-5 first:pl-0 last:pr-0 lg:border-l lg:border-[color:var(--border)] lg:first:border-l-0 lg:first:pl-0">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text-800)]">{label}</h3>
        <span className="text-xs text-[var(--text-400)]">近 {data.length || 0} 个数据点</span>
      </div>
      {data.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-[var(--text-400)]">暂无趋势数据</div>
      ) : (
        <div className="flex h-36 items-end gap-2" aria-label={`${label}柱状图`}>
          {data.map((item) => (
            <div key={`${label}-${item.date}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
              <div
                className={`w-full max-w-8 rounded-t-md ${color}`}
                style={{ height: `${Math.max((item.count / maxValue) * 100, 5)}%` }}
                title={`${item.date}: ${item.count}`}
              />
              <span className="whitespace-nowrap text-[10px] text-[var(--text-400)]">
                {new Date(item.date).getDate()}日
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, admin } = useAuthStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/metrics/dashboard`, {
        headers: { Authorization: `Bearer ${getActiveToken()}` },
      });
      if (res.status === 401) {
        // 本地登录态是在旧数据库（dev.db）时期签发的，后端切换数据库后哈希查不到
        setError('登录状态已失效，请退出后重新登录');
        return;
      }
      if (!res.ok) throw new Error('获取数据失败');
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user && !admin) {
      navigate('/login');
      return;
    }
    void fetchDashboardData();
  }, [admin, fetchDashboardData, navigate, user]);

  const periodText = data
    ? `${new Date(data.period.start).toLocaleDateString()} - ${new Date(data.period.end).toLocaleDateString()}`
    : '正在读取当前数据周期';
  const isAdminWorkspace = Boolean(admin && !user);

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={BarChart3}
        eyebrow={isAdminWorkspace ? '数据概览' : '工作台概览'}
        title={isAdminWorkspace ? '平台运营概览' : '经营与执行概览'}
        description={`${isAdminWorkspace ? '集中查看全平台' : '集中查看'}任务、报价、订单和 Agent 的运行情况。数据周期：${periodText}`}
        actions={
          <button type="button" onClick={() => void fetchDashboardData()} disabled={loading} className="btn-cs btn-ghost-dark btn-sm disabled:cursor-not-allowed disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新数据
          </button>
        }
      />

      {loading && !data ? (
        <div className="flex min-h-72 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white text-sm text-[var(--text-500)]">
          <Loader2 className="mr-3 h-5 w-5 animate-spin text-[var(--brand-500)]" />
          正在汇总工作台数据...
        </div>
      ) : error && !data ? (
        <WorkbenchStatePanel
          icon={CircleAlert}
          title="概览数据暂时无法加载"
          description={`${error}。请检查服务状态后重新尝试。`}
          tone="error"
          action={
            error.includes('重新登录') ? (
              <button type="button" onClick={() => navigate('/login')} className="btn-cs btn-primary btn-sm">去登录</button>
            ) : (
              <button type="button" onClick={() => void fetchDashboardData()} className="btn-cs btn-primary btn-sm">重新加载</button>
            )
          }
        />
      ) : !data ? (
        <WorkbenchStatePanel icon={Inbox} title="暂无概览数据" description="当前账号还没有可汇总的任务、订单或 Agent 数据。" />
      ) : (
        <>
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-[color:var(--state-error)] bg-[var(--state-error-surface)] px-4 py-3 text-sm text-[var(--state-error)]">
              <CircleAlert className="h-4 w-4 shrink-0" />
              本次刷新失败，页面仍展示上一次成功读取的数据。
            </div>
          )}

          <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
            <div className="border-b border-[color:var(--border)] px-5 py-4">
              <h2 className="font-semibold text-[var(--text-800)]">核心指标</h2>
              <p className="mt-1 text-xs text-[var(--text-500)]">用于快速判断当前业务规模与执行健康度</p>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-[color:var(--border)] md:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
              {[
                { label: '总营收', value: `¥${data.summary.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign, tone: 'text-[var(--state-success-text)] bg-[var(--state-success-surface)]' },
                { label: '总任务', value: data.summary.totalTasks, icon: ClipboardList, tone: 'text-[var(--brand-600)] bg-[var(--brand-50)]' },
                { label: '总报价', value: data.summary.totalBids, icon: TrendingUp, tone: 'text-[#5856d6] bg-[#f1f0ff]' },
                { label: '总订单', value: data.summary.totalOrders, icon: Activity, tone: 'text-[var(--state-warning)] bg-[var(--state-warning-surface)]' },
                { label: '在线 Agent', value: data.summary.onlineAgents, icon: Bot, tone: 'text-[var(--brand-600)] bg-[var(--brand-50)]' },
                { label: '完成率', value: `${data.summary.completionRate}%`, icon: BarChart3, tone: 'text-[var(--state-success-text)] bg-[var(--state-success-surface)]' },
              ].map((metric) => (
                <div key={metric.label} className="min-w-0 p-5">
                  <span className={`mb-5 flex h-9 w-9 items-center justify-center rounded-lg ${metric.tone}`}>
                    <metric.icon className="h-4 w-4" />
                  </span>
                  <p className="truncate text-2xl font-bold tabular-nums text-[var(--text-900)]">{metric.value}</p>
                  <p className="mt-1 text-xs text-[var(--text-500)]">{metric.label}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[color:var(--border)] bg-white px-5 py-4">
            <div className="border-b border-[color:var(--border)] pb-4">
              <h2 className="font-semibold text-[var(--text-800)]">业务趋势</h2>
              <p className="mt-1 text-xs text-[var(--text-500)]">对比任务供给、Agent 报价与订单转化变化</p>
            </div>
            <div className="grid lg:grid-cols-3">
              <TrendChart data={data.trends.tasks} label="任务趋势" color="bg-[var(--brand-500)]" />
              <TrendChart data={data.trends.bids} label="报价趋势" color="bg-[#5856d6]" />
              <TrendChart data={data.trends.orders} label="订单趋势" color="bg-[var(--state-success)]" />
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
            <div className="flex flex-col gap-2 border-b border-[color:var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-[var(--text-800)]">Agent 报价排行</h2>
                <p className="mt-1 text-xs text-[var(--text-500)]">按当前周期内的报价次数排序</p>
              </div>
              <p className="text-xs text-[var(--text-500)]">共 {data.agents.total} 个 · 在线 {data.agents.online} · 离线 {data.agents.offline}</p>
            </div>
            {data.agents.agents.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-[var(--text-500)]">暂无 Agent 报价数据</div>
            ) : (
              <div className="divide-y divide-[color:var(--border)]">
                {data.agents.agents.slice(0, 10).map((agent, index) => (
                  <div key={agent.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:items-center">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--background-100)] text-sm font-semibold text-[var(--text-500)]">{index + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--text-800)]">{agent.name || '未命名 Agent'}</p>
                      <p className="mt-0.5 truncate font-mono text-xs text-[var(--text-400)]">{agent.id}</p>
                    </div>
                    <div className="flex items-baseline gap-4 sm:text-right">
                      <span className="text-sm font-semibold text-[var(--brand-600)]">{agent.bidCount} 次报价</span>
                      <span className="text-xs text-[var(--text-500)]">均价 ¥{agent.avgPrice.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
