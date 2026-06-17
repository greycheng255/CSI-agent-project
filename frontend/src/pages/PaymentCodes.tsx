import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

interface PaymentCode {
  id: string;
  type: 'ALIPAY' | 'WECHAT';
  qrCodeUrl: string;
  qr_code_url?: string;
  accountName: string | null;
  account_name?: string;
  isDefault: boolean;
  is_default?: boolean;
  createdAt: string;
  created_at?: string;
}

interface ApiPaymentCode {
  id: string;
  type: 'ALIPAY' | 'WECHAT';
  qrCodeUrl?: string;
  qr_code_url?: string;
  accountName?: string | null;
  account_name?: string | null;
  isDefault?: boolean;
  is_default?: boolean;
  createdAt?: string;
  created_at?: string;
}

export default function PaymentCodes({ embedded }: { embedded?: boolean }) {
  const { token } = useAuthStore();
  const [codes, setCodes] = useState<PaymentCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState<'ALIPAY' | 'WECHAT'>('ALIPAY');
  const [accountName, setAccountName] = useState('');

  useEffect(() => {
    fetchPaymentCodes();
  }, []);

  const fetchPaymentCodes = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/my-codes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        // 转换蛇形命名为驼峰命名
        const formattedCodes = (data.data || []).map((code: ApiPaymentCode) => ({
          ...code,
          qrCodeUrl: code.qrCodeUrl || code.qr_code_url || '',
          accountName: code.accountName || code.account_name || null,
          isDefault: code.isDefault !== undefined ? code.isDefault : (code.is_default || false),
          createdAt: code.createdAt || code.created_at || '',
        }));
        setCodes(formattedCodes);
      }
    } catch {
      setError('获取收款码失败');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', selectedType);
    if (accountName) {
      formData.append('accountName', accountName);
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/my-codes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (res.ok) {
        await fetchPaymentCodes();
        setAccountName('');
        alert('收款码上传成功！');
      } else {
        const errorData = await res.json();
        setError(errorData.message || '上传失败');
      }
    } catch {
      setError('上传失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  const setDefaultCode = async (codeId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/my-codes/${codeId}/default`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        await fetchPaymentCodes();
      }
    } catch {
      setError('设置默认收款码失败');
    }
  };

  const deleteCode = async (codeId: string) => {
    if (!confirm('确定要删除这个收款码吗？')) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/my-codes/${codeId}/delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        await fetchPaymentCodes();
      }
    } catch {
      setError('删除失败');
    }
  };

  const getTypeLabel = (type: string) => {
    return type === 'ALIPAY' ? '支付宝' : '微信';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className={embedded ? '' : 'min-h-screen bg-black py-8'}>
      <div className={embedded ? '' : 'max-w-4xl mx-auto px-4'}>
        {!embedded && <h1 className="text-2xl font-bold text-gray-100 mb-6">我的收款码</h1>}

        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-700 text-red-300 rounded-lg">{error}</div>
        )}

        {/* 上传新收款码 */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-100 mb-4">上传收款码</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                收款方式
              </label>
              <div className="flex gap-4">
                <button
                  onClick={() => setSelectedType('ALIPAY')}
                  className={`px-4 py-2 rounded-lg border ${
                    selectedType === 'ALIPAY'
                      ? 'bg-blue-900/30 border-blue-500 text-blue-400'
                      : 'border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  支付宝
                </button>
                <button
                  onClick={() => setSelectedType('WECHAT')}
                  className={`px-4 py-2 rounded-lg border ${
                    selectedType === 'WECHAT'
                      ? 'bg-green-900/30 border-green-500 text-green-400'
                      : 'border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  微信
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                收款人姓名（可选）
              </label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="请输入收款人真实姓名"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                收款码图片
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition-colors">
                  <span>{uploading ? '上传中...' : '选择图片'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
                <span className="text-sm text-gray-500">
                  支持 JPG、PNG 格式，建议尺寸 400x400
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 收款码列表 */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-100 mb-4">已保存的收款码</h2>
          
          {codes.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>还没有上传收款码</p>
              <p className="text-sm mt-2">上传收款码后，雇主完成任务验收后可以通过扫码向您付款</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {codes.map((code) => (
                <div
                  key={code.id}
                  className={`border rounded-lg p-4 ${
                    code.isDefault ? 'border-blue-500 bg-blue-900/20' : 'border-gray-700 bg-gray-800/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <span
                        className={`inline-block px-2 py-1 text-xs rounded ${
                          code.type === 'ALIPAY'
                            ? 'bg-blue-900/50 text-blue-400'
                            : 'bg-green-900/50 text-green-400'
                        }`}
                      >
                        {getTypeLabel(code.type)}
                      </span>
                      {code.isDefault && (
                        <span className="ml-2 inline-block px-2 py-1 text-xs rounded bg-yellow-900/50 text-yellow-400">
                          默认
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {!code.isDefault && (
                        <button
                          onClick={() => setDefaultCode(code.id)}
                          className="text-sm text-blue-400 hover:text-blue-300"
                        >
                          设为默认
                        </button>
                      )}
                      <button
                        onClick={() => deleteCode(code.id)}
                        className="text-sm text-red-400 hover:text-red-300"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <img
                      src={code.qrCodeUrl}
                      alt={`${getTypeLabel(code.type)}收款码`}
                      className="w-24 h-24 object-contain border border-gray-700 rounded bg-white"
                    />
                    <div className="flex-1">
                      {code.accountName && (
                        <p className="text-sm text-gray-400">
                          收款人: {code.accountName}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        添加时间: {new Date(code.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 说明 */}
        <div className="mt-6 bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-yellow-400 mb-2">使用说明</h3>
          <ul className="text-sm text-yellow-300/80 space-y-1 list-disc list-inside">
            <li>请上传清晰的支付宝或微信收款码图片</li>
            <li>建议设置默认收款码，方便雇主付款</li>
            <li>收款码仅用于接收任务款项，请确保账号可正常收款</li>
            <li>平台会在雇主验收完成后，将款项打入您的收款账户</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
