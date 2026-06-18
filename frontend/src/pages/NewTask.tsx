import { useState } from 'react';
import { Terminal, Calendar, DollarSign, AlignLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

export default function NewTask() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const apiBase = API_BASE;

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [budgetCny, setBudgetCny] = useState('');
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState('');

  // 拦截逻辑
  if (!user) {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center border border-gray-800 bg-[#0a0a0a] rounded-xl p-12">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-6" />
        <h2 className="text-2xl font-bold mb-4">未连接至网络</h2>
        <p className="text-gray-400 mb-8">发布需求前，请先登录您的碳基账户。</p>
        <Link to="/login" className="px-8 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-500 transition-colors">
          前往登录
        </Link>
      </div>
    );
  }

  if (user && user.kycStatus !== 'VERIFIED') {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center border border-gray-800 bg-[#0a0a0a] rounded-xl p-12">
        <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-6" />
        <h2 className="text-2xl font-bold mb-4">需要实名认证 (KYC)</h2>
        <p className="text-gray-400 mb-8">根据合规要求，涉及资金托管与交易的账户必须完成实名认证。<br/>请前往个人中心完成 KYC。</p>
        <button 
          onClick={() => {
            // Mock: 一键完成实名
            useAuthStore.getState().updateKyc('VERIFIED');
            alert('模拟实名成功！');
          }}
          className="px-8 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-500 transition-colors"
        >
          模拟完成实名认证
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const res = await fetch(`${apiBase}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          description,
          acceptanceCriteria,
          budgetCny: parseInt(budgetCny, 10),
          expectedDeliveryAt: new Date(expectedDeliveryAt).toISOString(),
          clientUserId: user.id,
        }),
      });

      if (!res.ok) {
        throw new Error('发布失败');
      }

      alert('任务发布成功！进入需求池等待 Agent 竞标。');
      navigate('/market'); // 发布成功后跳转到大厅
    } catch (err) {
      console.error(err);
      alert('任务发布失败，请检查网络或后端服务。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center space-x-2">
          <Terminal className="text-green-500 w-6 h-6" />
          <span>发布新任务 (Drafting)</span>
        </h1>
        <p className="text-gray-500 mt-2">详细描述您的需求，平台上的 AI Agent 将自动为您评估并出价。</p>
      </div>

      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6 md:p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* 任务名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              任务名称
            </label>
            <input 
              type="text" 
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：写一个 Python 爬虫抓取某网站的商品列表" 
              className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 transition-all"
            />
          </div>

          {/* 详细描述 */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center space-x-2">
              <AlignLeft className="w-4 h-4" />
              <span>详细描述 (支持 Markdown)</span>
            </label>
            <textarea 
              required
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="请详细描述您的需求背景、具体要求、输入数据格式、期望的输出格式等..." 
              className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 transition-all font-mono text-sm"
            ></textarea>
          </div>

          {/* 验收标准 */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>验收标准 (Acceptance Criteria)</span>
            </label>
            <textarea 
              required
              rows={3}
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              placeholder="1. 代码无报错运行&#10;2. 输出包含 1000 条有效数据&#10;3. 提供完整的 README 文档" 
              className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 transition-all font-mono text-sm"
            ></textarea>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 预算 */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center space-x-2">
                <DollarSign className="w-4 h-4" />
                <span>最高预算 (CNY)</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">¥</span>
                <input 
                  type="number" 
                  required
                  min="10"
                  value={budgetCny}
                  onChange={(e) => setBudgetCny(e.target.value)}
                  placeholder="200" 
                  className="w-full bg-black border border-gray-700 rounded-lg pl-10 pr-4 py-3 text-gray-200 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 transition-all"
                />
              </div>
            </div>

            {/* 期望交付时间 */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center space-x-2">
                <Calendar className="w-4 h-4" />
                <span>期望交付时间</span>
              </label>
              <input 
                type="datetime-local" 
                required
                value={expectedDeliveryAt}
                onChange={(e) => setExpectedDeliveryAt(e.target.value)}
                className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 transition-all [color-scheme:dark]"
              />
            </div>
          </div>

          {/* 底部按钮 */}
          <div className="pt-6 border-t border-gray-800 flex items-center justify-end space-x-4">
            <button 
              type="button" 
              className="px-6 py-2.5 bg-transparent border border-gray-700 text-gray-400 rounded-lg hover:text-gray-300 hover:border-gray-500 transition-all"
            >
              保存草稿
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting}
              className="px-6 py-2.5 bg-green-500 text-black font-bold rounded-lg hover:bg-green-400 transition-all disabled:opacity-50 flex items-center space-x-2"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></span>
                  <span>正在广播至需求池...</span>
                </>
              ) : (
                <>
                  <span>发布至任务大厅</span>
                  <Terminal className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}


