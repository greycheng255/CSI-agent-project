import { useState } from 'react';
import { Cloud, Copy, Check, X, Terminal, ExternalLink } from 'lucide-react';
import { API_BASE } from '../config/api';
import { useAuthStore } from '../store/authStore';
import { OpenclawBindGuide } from './OpenclawBindGuide';

interface OpenclawBindModalProps {
  agentId: string;
  agentName: string;
  onClose: () => void;
  onBindSuccess?: () => void;
}

export function OpenclawBindModal({ agentId, agentName, onClose, onBindSuccess }: OpenclawBindModalProps) {
  const [step, setStep] = useState<'generate' | 'token' | 'waiting' | 'success'>('generate');
  const [token, setToken] = useState('');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const authToken = useAuthStore((state) => state.token);

  const generateToken = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/v1/agent-bind/generate-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ agentId }),
      });

      const data = await response.json();

      if (data.success) {
        setToken(data.data.token);
        setExpiresAt(new Date(data.data.expiresAt));
        setStep('token');
      } else {
        setError(data.message || '生成令牌失败');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCommand = () => {
    const command = `curl -fsSL https://your-domain.com/openclaw-bind.sh | bash -s -- --token ${token}`;
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const checkStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/agent-bind/status/${agentId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      const data = await response.json();

      if (data.success && data.data.isBound) {
        setStep('success');
        onBindSuccess?.();
      }
    } catch {
      // 忽略错误
    }
  };

  const startWaiting = () => {
    setStep('waiting');
    // 每 3 秒检查一次状态
    const interval = setInterval(() => {
      checkStatus();
    }, 3000);

    // 5 分钟后自动停止
    setTimeout(() => {
      clearInterval(interval);
    }, 5 * 60 * 1000);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0a0a0a] border border-gray-800 rounded-xl max-w-lg w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <Cloud className="w-6 h-6 text-blue-500" />
            <div>
              <h3 className="text-lg font-bold text-gray-200">绑定 Openclaw</h3>
              <p className="text-xs text-gray-500">Agent: {agentName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'generate' && (
            <div className="space-y-4">
              {/* 说明文档 */}
              <OpenclawBindGuide />

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <button
                onClick={generateToken}
                disabled={isLoading}
                className="w-full py-3 bg-blue-500 text-black font-bold rounded-lg hover:bg-blue-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Cloud className="w-4 h-4" />
                    生成绑定令牌
                  </>
                )}
              </button>
            </div>
          )}

          {step === 'token' && (
            <div className="space-y-4">
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Terminal className="w-4 h-4 text-yellow-500" />
                  <span className="text-sm font-bold text-yellow-500">在 Openclaw 实例中执行</span>
                </div>
                <p className="text-xs text-gray-400 mb-3">
                  登录到您的 Openclaw 服务器，执行以下命令完成绑定：
                </p>

                <div className="bg-black rounded-lg p-3 font-mono text-xs text-gray-300 relative group">
                  <code>openclaw-bind --token {token}</code>
                  <button
                    onClick={copyCommand}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>

                <div className="mt-3 text-xs text-gray-500">
                  或者手动输入令牌：
                </div>

                <div className="mt-2 bg-black rounded-lg p-3 font-mono text-xs text-gray-300 relative group">
                  <code className="break-all">{token}</code>
                  <button
                    onClick={copyToken}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>

                {expiresAt && (
                  <p className="mt-3 text-xs text-gray-500">
                    令牌有效期至: {expiresAt.toLocaleString()}
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('generate')}
                  className="flex-1 py-2 border border-gray-700 text-gray-400 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  重新生成
                </button>
                <button
                  onClick={startWaiting}
                  className="flex-1 py-2 bg-blue-500 text-black font-bold rounded-lg hover:bg-blue-400 transition-colors"
                >
                  已执行，等待绑定
                </button>
              </div>
            </div>
          )}

          {step === 'waiting' && (
            <div className="text-center py-8">
              <div className="w-12 h-12 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
              <h4 className="text-lg font-bold text-gray-200 mb-2">等待绑定完成</h4>
              <p className="text-sm text-gray-400 mb-4">
                请在 Openclaw 实例中执行绑定命令...
              </p>
              <button
                onClick={checkStatus}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                手动检查状态
              </button>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-500" />
              </div>
              <h4 className="text-lg font-bold text-gray-200 mb-2">绑定成功!</h4>
              <p className="text-sm text-gray-400 mb-6">
                Agent 已成功绑定到 Openclaw 实例
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-green-500 text-black font-bold rounded-lg hover:bg-green-400 transition-colors"
              >
                完成
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'success' && (
          <div className="px-6 pb-6">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <ExternalLink className="w-3 h-3" />
              <span>需要先在 Openclaw 服务器上安装绑定工具</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
