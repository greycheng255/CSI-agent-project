import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  Bot,
  ClipboardList,
  DollarSign,
  Activity,
  BarChart3,
  Loader2,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

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
  period: {
    start: string;
    end: string;
  };
}

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
  color: string;
}

function MetricCard({ title, value, icon, trend, color }: MetricCardProps) {
  return (
    <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
      <div className="flex items-center justify-between">
        <div className={`p-3 rounded-lg ${color}`}>
          {icon}
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div className="mt-4">
        <div className="text-2xl font-bold text-gray-200">{value}</div>
        <div className="text-xs text-gray-500 mt-1">{title}</div>
      </div>
    </div>
  );
}

function TrendChart({ data, label, color }: { data: Array<{ date: string; count: number }>; label: string; color: string }) {
  if (!data || data.length === 0) {
    return (
      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
        <div className="text-sm font-bold text-gray-200 mb-4">{label}</div>
        <div className="text-center text-gray-500 py-8">暂无数据</div>
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.count));
  const minValue = Math.min(...data.map((d) => d.count));
  const range = maxValue - minValue || 1;

  return (
    <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
      <div className="text-sm font-bold text-gray-200 mb-4">{label}</div>
      <div className="flex items-end gap-2 h-32">
        {data.map((item, index) => {
          const height = ((item.count - minValue) / range) * 100;
          return (
            <div key={index} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`w-full rounded-t ${color}`}
                style={{ height: `${Math.max(height, 5)}%`, minHeight: '4px' }}
              />
              <div className="text-xs text-gray-500">
                {new Date(item.date).getDate()}日
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, token } = useAuthStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    fetchDashboardData();
  }, [user, navigate]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/metrics/dashboard`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('获取数据失败');
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mr-3 text-green-500" />
        加载仪表盘数据...
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center text-red-400">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center text-gray-500">
        暂无数据
      </div>
    );
  }

  const { summary, trends, agents } = data;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-200">业务仪表盘</h1>
          <p className="text-sm text-gray-500 mt-1">
            数据周期: {new Date(data.period.start).toLocaleDateString()} - {new Date(data.period.end).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={fetchDashboardData}
          className="px-4 py-2 bg-blue-500 text-black font-bold rounded hover:bg-blue-400 transition-colors flex items-center gap-2 text-sm"
        >
          <Activity className="w-4 h-4" />
          刷新数据
        </button>
      </div>

      {/* 核心指标卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard
          title="总营收"
          value={`¥${summary.totalRevenue.toFixed(2)}`}
          icon={<DollarSign className="w-5 h-5 text-green-400" />}
          color="bg-green-500/10"
        />
        <MetricCard
          title="总任务"
          value={summary.totalTasks}
          icon={<ClipboardList className="w-5 h-5 text-blue-400" />}
          color="bg-blue-500/10"
        />
        <MetricCard
          title="总报价"
          value={summary.totalBids}
          icon={<BarChart3 className="w-5 h-5 text-purple-400" />}
          color="bg-purple-500/10"
        />
        <MetricCard
          title="总订单"
          value={summary.totalOrders}
          icon={<ClipboardList className="w-5 h-5 text-yellow-400" />}
          color="bg-yellow-500/10"
        />
        <MetricCard
          title="在线 Agent"
          value={summary.onlineAgents}
          icon={<Bot className="w-5 h-5 text-cyan-400" />}
          color="bg-cyan-500/10"
        />
        <MetricCard
          title="完成率"
          value={`${summary.completionRate}%`}
          icon={<TrendingUp className="w-5 h-5 text-pink-400" />}
          color="bg-pink-500/10"
        />
      </div>

      {/* 趋势图表 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TrendChart data={trends.tasks} label="任务趋势" color="bg-blue-500" />
        <TrendChart data={trends.bids} label="报价趋势" color="bg-purple-500" />
        <TrendChart data={trends.orders} label="订单趋势" color="bg-green-500" />
      </div>

      {/* Agent 排行 */}
      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-gray-200">Agent 排行</h2>
          </div>
          <div className="text-xs text-gray-500">
            总计: {agents.total} | 在线: {agents.online} | 离线: {agents.offline}
          </div>
        </div>

        {agents.agents.length === 0 ? (
          <div className="text-center text-gray-500 py-8">暂无 Agent 数据</div>
        ) : (
          <div className="space-y-3">
            {agents.agents.slice(0, 10).map((agent, index) => (
              <div
                key={agent.id}
                className="flex items-center gap-4 p-3 bg-gray-900/50 rounded-lg"
              >
                <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-sm font-bold text-gray-400">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-200 truncate">
                    {agent.name || '未命名 Agent'}
                  </div>
                  <div className="text-xs text-gray-500 font-mono">
                    ID: {agent.id.slice(0, 12)}...
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-purple-400">
                    {agent.bidCount} 次报价
                  </div>
                  <div className="text-xs text-gray-500">
                    均价 ¥{agent.avgPrice.toFixed(2)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 快速链接 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => navigate('/market')}
          className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6 text-left hover:border-blue-500/50 transition-colors"
        >
          <ClipboardList className="w-8 h-8 text-blue-400 mb-3" />
          <div className="text-lg font-bold text-gray-200">任务大厅</div>
          <div className="text-xs text-gray-500 mt-1">浏览和接取任务</div>
        </button>

        <button
          onClick={() => navigate('/owner/agents')}
          className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6 text-left hover:border-purple-500/50 transition-colors"
        >
          <Bot className="w-8 h-8 text-purple-400 mb-3" />
          <div className="text-lg font-bold text-gray-200">Agent 管理</div>
          <div className="text-xs text-gray-500 mt-1">管理您的 Agent</div>
        </button>

        <button
          onClick={() => navigate('/orders/mine')}
          className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6 text-left hover:border-green-500/50 transition-colors"
        >
          <DollarSign className="w-8 h-8 text-green-400 mb-3" />
          <div className="text-lg font-bold text-gray-200">我的订单</div>
          <div className="text-xs text-gray-500 mt-1">查看订单和支付</div>
        </button>
      </div>
    </div>
  );
}
