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

/* eslint-disable react-hooks/exhaustive-deps -- payment-code refresh is intentionally driven by the authenticated account effect */
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
      <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white">
        <div className="text-sm text-[var(--text-500)]">加载中...</div>
      </div>
    );
  }

  return (
    <div className={embedded ? 'space-y-6' : 'min-h-screen bg-white py-8'}>
      <div className={embedded ? '' : 'max-w-4xl mx-auto px-4'}>
        {!embedded && <h1 className="mb-6 text-2xl font-bold text-[var(--text-900)]">我的收款码</h1>}

        {error && (
          <div className="mb-4 rounded-xl border border-[color:var(--state-error)] bg-[var(--state-error-surface)] p-4 text-[var(--state-error)]">{error}</div>
        )}

        {/* 上传新收款码 */}
        <section className="rounded-2xl border border-[color:var(--border)] bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-900)]">上传收款码</h2>
          
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--text-600)]">
                收款方式
              </label>
              <div className="flex gap-4">
                <button
                  onClick={() => setSelectedType('ALIPAY')}
                  className={`px-4 py-2 rounded-lg border ${
                    selectedType === 'ALIPAY'
                      ? 'bg-[var(--brand-50)] border-[var(--brand-400)] text-[var(--brand-700)]'
                      : 'border-[color:var(--border)] text-[var(--text-500)] hover:border-[var(--brand-300)]'
                  }`}
                >
                  支付宝
                </button>
                <button
                  onClick={() => setSelectedType('WECHAT')}
                  className={`px-4 py-2 rounded-lg border ${
                    selectedType === 'WECHAT'
                      ? 'bg-[var(--state-success-surface)] border-[var(--state-success)] text-[var(--state-success-text)]'
                      : 'border-[color:var(--border)] text-[var(--text-500)] hover:border-[var(--brand-300)]'
                  }`}
                >
                  微信
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--text-600)]">
                收款人姓名（可选）
              </label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="请输入收款人真实姓名"
                className="field-input"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--text-600)]">
                收款码图片
              </label>
              <div className="flex items-center gap-4">
                <label className="btn-cs btn-primary btn-sm cursor-pointer">
                  <span>{uploading ? '上传中...' : '选择图片'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
                <span className="text-sm text-[var(--text-500)]">
                  支持 JPG、PNG 格式，建议尺寸 400x400
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 收款码列表 */}
        <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="border-b border-[color:var(--border)] px-5 py-4 sm:px-6">
            <h2 className="font-semibold text-[var(--text-900)]">已保存的收款码</h2>
            <p className="mt-1 text-xs text-[var(--text-500)]">共 {codes.length} 个收款方式</p>
          </div>
          
          {codes.length === 0 ? (
            <div className="px-5 py-12 text-center text-[var(--text-500)]">
              <p>还没有上传收款码</p>
              <p className="text-sm mt-2">上传收款码后，雇主完成任务验收后可以通过扫码向您付款</p>
            </div>
          ) : (
            <div className="divide-y divide-[color:var(--border)]">
              {codes.map((code) => (
                <div
                  key={code.id}
                  className={`flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6 ${code.isDefault ? 'bg-[var(--brand-50)]' : 'bg-white'}`}
                >
                  <img
                    src={code.qrCodeUrl}
                    alt={`${getTypeLabel(code.type)}收款码`}
                    loading="lazy"
                    className="h-24 w-24 shrink-0 rounded-lg border border-[color:var(--border)] bg-white object-contain"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-block rounded px-2 py-1 text-xs ${
                          code.type === 'ALIPAY'
                            ? 'bg-[var(--brand-50)] text-[var(--brand-700)]'
                            : 'bg-[var(--state-success-surface)] text-[var(--state-success-text)]'
                        }`}
                      >
                        {getTypeLabel(code.type)}
                      </span>
                      {code.isDefault && (
                        <span className="inline-block rounded bg-[var(--state-warning-surface)] px-2 py-1 text-xs text-[var(--state-warning)]">
                          默认
                        </span>
                      )}
                    </div>
                    <p className="mt-3 truncate text-sm font-medium text-[var(--text-700)]">{code.accountName || '未填写收款人'}</p>
                    <p className="mt-1 text-xs text-[var(--text-500)]">添加时间：{new Date(code.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:self-start">
                      {!code.isDefault && (
                        <button
                          type="button"
                          onClick={() => setDefaultCode(code.id)}
                          className="btn-cs btn-ghost-dark btn-sm"
                        >
                          设为默认
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteCode(code.id)}
                        className="btn-cs btn-sm border border-[#ffc6c1] bg-[var(--state-error-surface)] text-[var(--state-error)]"
                      >
                        删除
                      </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 说明 */}
        <div className="rounded-xl border border-[#f3d79a] bg-[var(--state-warning-surface)] p-4">
          <h3 className="mb-2 text-sm font-medium text-[var(--state-warning)]">使用说明</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-[var(--text-600)]">
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
