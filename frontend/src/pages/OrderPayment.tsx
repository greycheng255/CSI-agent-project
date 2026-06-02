import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

interface PlatformCode {
  id: string;
  type: 'ALIPAY' | 'WECHAT';
  qrCodeUrl: string;
  accountName: string;
}

interface OrderPaymentInfo {
  orderPayment: {
    id: string;
    amountCny: number;
    platformFeeCny: number;
    payoutCny: number;
    paymentStatus: string;
  };
  platformCodes: PlatformCode[];
}

export default function OrderPayment() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { token } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paymentInfo, setPaymentInfo] = useState<OrderPaymentInfo | null>(null);
  const [selectedCodeId, setSelectedCodeId] = useState<string>('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (orderId) {
      fetchPaymentInfo();
    }
  }, [orderId]);

  const fetchPaymentInfo = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/order/${orderId}/create`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setPaymentInfo(data.data);
        if (data.data.platformCodes.length > 0) {
          setSelectedCodeId(data.data.platformCodes[0].id);
        }
      } else {
        const errorData = await res.json();
        setError(errorData.message || '获取支付信息失败');
      }
    } catch {
      setError('获取支付信息失败');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProofFile(file);
    }
  };

  const handleSubmit = async () => {
    if (!proofFile) {
      alert('请上传支付凭证截图');
      return;
    }
    if (!selectedCodeId) {
      alert('请选择支付方式');
      return;
    }

    setSubmitting(true);
    setError('');

    const formData = new FormData();
    formData.append('file', proofFile);
    formData.append('platformCodeId', selectedCodeId);

    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/order/${orderId}/confirm-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (res.ok) {
        alert('支付凭证已提交，请等待平台确认');
        navigate('/orders');
      } else {
        const errorData = await res.json();
        setError(errorData.message || '提交失败');
      }
    } catch {
      setError('提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const formatAmount = (amount: number) => {
    return (amount / 100).toFixed(2);
  };

  const getTypeLabel = (type: string) => {
    return type === 'ALIPAY' ? '支付宝' : '微信';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-2xl mx-auto px-4">
          <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error}</div>
        </div>
      </div>
    );
  }

  if (!paymentInfo) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-2xl mx-auto px-4">
          <div className="text-center text-gray-500">支付信息不存在</div>
        </div>
      </div>
    );
  }

  const { orderPayment, platformCodes } = paymentInfo;

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">订单支付</h1>

        {/* 订单金额信息 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">支付金额</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">订单金额</span>
              <span className="text-xl font-bold text-gray-900">
                ¥{formatAmount(orderPayment.amountCny)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">平台服务费</span>
              <span className="text-gray-500">¥{formatAmount(orderPayment.platformFeeCny)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">开发者实收</span>
              <span className="text-gray-500">¥{formatAmount(orderPayment.payoutCny)}</span>
            </div>
          </div>
        </div>

        {/* 选择支付方式 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">选择支付方式</h2>
          
          {platformCodes.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>暂无可用的支付方式</p>
              <p className="text-sm mt-2">请联系平台管理员</p>
            </div>
          ) : (
            <div className="space-y-4">
              {platformCodes.map((code) => (
                <div
                  key={code.id}
                  onClick={() => setSelectedCodeId(code.id)}
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedCodeId === code.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        selectedCodeId === code.id
                          ? 'border-blue-500'
                          : 'border-gray-300'
                      }`}
                    >
                      {selectedCodeId === code.id && (
                        <div className="w-3 h-3 rounded-full bg-blue-500" />
                      )}
                    </div>
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        code.type === 'ALIPAY'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {getTypeLabel(code.type)}
                    </span>
                    <span className="text-gray-700">{code.accountName}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 扫码支付 */}
        {selectedCodeId && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">扫码支付</h2>
            
            {platformCodes.find(c => c.id === selectedCodeId) && (
              <div className="text-center">
                <p className="text-gray-600 mb-4">
                  请使用{getTypeLabel(platformCodes.find(c => c.id === selectedCodeId)!.type)}扫描下方二维码完成支付
                </p>
                <div className="inline-block border-2 border-gray-200 rounded-lg p-4">
                  <img
                    src={platformCodes.find(c => c.id === selectedCodeId)!.qrCodeUrl}
                    alt="收款码"
                    className="w-64 h-64 object-contain"
                  />
                </div>
                <p className="text-sm text-gray-500 mt-4">
                  支付金额: <span className="text-xl font-bold text-red-600">¥{formatAmount(orderPayment.amountCny)}</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* 上传支付凭证 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">上传支付凭证</h2>
          
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              完成支付后，请截图上传支付成功页面，以便平台确认收款
            </p>
            
            <div className="flex items-center gap-4">
              <label className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition-colors">
                <span>{proofFile ? '更换图片' : '选择图片'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              {proofFile && (
                <span className="text-sm text-green-600">
                  已选择: {proofFile.name}
                </span>
              )}
            </div>

            {proofFile && (
              <div className="mt-4">
                <img
                  src={URL.createObjectURL(proofFile)}
                  alt="支付凭证预览"
                  className="max-w-xs border rounded-lg"
                />
              </div>
            )}
          </div>
        </div>

        {/* 提交按钮 */}
        <div className="flex gap-4">
          <button
            onClick={() => navigate(-1)}
            className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            返回
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !proofFile || !selectedCodeId}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? '提交中...' : '确认已支付'}
          </button>
        </div>

        {/* 说明 */}
        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-yellow-800 mb-2">支付说明</h3>
          <ul className="text-sm text-yellow-700 space-y-1 list-disc list-inside">
            <li>请使用支付宝或微信扫描上方二维码完成支付</li>
            <li>支付完成后，请截图并上传支付成功页面</li>
            <li>平台确认收款后，订单将开始执行</li>
            <li>如有问题，请联系平台客服</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
