import { Search, Filter, Clock, ChevronRight, Loader2, UserCircle2, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { API_BASE } from '../config/api';

// 定义后端的 Task 类型
interface Task {
  id: string;
  title: string;
  description: string;
  budgetCny: number;
  expectedDeliveryAt: string;
  status: string;
  client?: { id: string; phone?: string };
  tags?: string[]; // 假设前端目前使用这个，虽然实体里没存
  bidsCount?: number;
  latestBid?: number;
}

export default function Market() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const apiBase = API_BASE;

  useEffect(() => {
    fetch(`${apiBase}/api/v1/tasks/market`)
      .then((res) => {
        if (!res.ok) throw new Error('网络请求失败');
        return res.json();
      })
      .then((response) => {
        // 处理分页格式 { data: [], pagination: {} }
        const tasksData = response.data || response;
        setTasks(tasksData);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('获取任务列表失败，请检查后端服务是否正常运行。');
        setLoading(false);
      });
  }, [apiBase]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingBag className="text-green-400 w-6 h-6" />
          <span>任务大厅</span>
        </h1>
        <Link to="/tasks/new" className="px-4 py-2 bg-green-500 text-black font-bold rounded hover:bg-green-400 transition-colors text-sm">
          发布新任务
        </Link>
      </div>

      {/* 搜索与筛选 */}
      <div className="flex flex-col md:flex-row gap-4 p-4 border border-gray-800 bg-gray-900/50 rounded-lg">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input 
            type="text" 
            placeholder="搜索任务关键词..." 
            className="w-full bg-black border border-gray-700 rounded-md py-2 pl-10 pr-4 focus:outline-none focus:border-green-500 text-gray-300 placeholder-gray-600"
          />
        </div>
        <div className="flex space-x-2">
          <button className="flex items-center space-x-2 px-4 py-2 bg-black border border-gray-700 rounded-md hover:border-gray-500 transition-colors text-gray-300">
            <Filter className="w-4 h-4" />
            <span>预算筛选</span>
          </button>
          <button className="flex items-center space-x-2 px-4 py-2 bg-black border border-gray-700 rounded-md hover:border-gray-500 transition-colors text-gray-300">
            <Clock className="w-4 h-4" />
            <span>最新发布</span>
          </button>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="space-y-4">
        {loading && (
          <div className="flex justify-center items-center py-12 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin mr-3 text-green-500" />
            正在加载任务列表...
          </div>
        )}
        
        {error && (
          <div className="p-4 border border-red-900/50 bg-red-900/10 text-red-400 rounded-lg text-center">
            {error}
          </div>
        )}

        {!loading && !error && tasks.length === 0 && (
          <div className="text-center py-12 text-gray-500 border border-gray-800 border-dashed rounded-lg">
            目前还没有任务，去发布一个吧！
          </div>
        )}

        {tasks.map((task) => (
          <div key={task.id} className="group border border-gray-800 bg-[#0a0a0a] rounded-lg p-5 hover:border-green-500/50 transition-colors relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-gray-800 group-hover:bg-green-500 transition-colors"></div>
            
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="flex items-center space-x-3 mb-2">
                  <span className="text-xs font-mono text-gray-500">TASK#{task.id.slice(0, 8)}</span>
                  <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded text-xs">{task.status || 'OPEN'}</span>
                  <span className="px-2 py-0.5 bg-gray-800/50 text-gray-300 rounded text-xs flex items-center gap-1" title="雇主">
                    <UserCircle2 className="w-3 h-3 text-green-500" />
                    <span className="text-gray-500">雇主:</span>
                    <span className="text-gray-300">{task.client?.phone || task.client?.id?.slice(0, 8) || '未知'}</span>
                  </span>
                </div>
                <h3 className="text-lg font-bold text-gray-200 group-hover:text-green-400 transition-colors">
                  {task.title}
                </h3>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-green-500">¥{task.budgetCny || 0}</div>
                <div className="text-xs text-gray-500 mt-1">最高预算</div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-800/50">
              <div className="flex items-center space-x-4 text-sm text-gray-400">
                <div className="flex space-x-2">
                  {(task.tags || ['通用', '开发']).map(tag => (
                    <span key={tag} className="px-2 py-1 bg-gray-800/50 rounded text-xs">{tag}</span>
                  ))}
                </div>
                <div className="flex items-center space-x-1">
                  <Clock className="w-4 h-4" />
                  <span>截止: {task.expectedDeliveryAt ? new Date(task.expectedDeliveryAt).toLocaleString() : '未指定'}</span>
                </div>
              </div>
              
              <div className="flex items-center space-x-6">
                <div className="text-sm">
                  <span className="text-gray-500">当前竞标: </span>
                  <span className="text-gray-300 font-bold">{task.bidsCount || 0} 个</span>
                  {task.latestBid && (
                    <span className="ml-2 text-gray-500">
                      (最低 <span className="text-green-400">¥{task.latestBid}</span>)
                    </span>
                  )}
                </div>
                <Link to={`/tasks/${task.id}`} className="flex items-center space-x-1 text-green-500 hover:text-green-400 font-medium">
                  <span>查看详情</span>
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
