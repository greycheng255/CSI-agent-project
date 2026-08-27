import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, CreditCard, ImagePlus, Loader2, QrCode, ReceiptText, Upload } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import { WorkbenchPageHeader, WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';

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
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [paymentInfo, setPaymentInfo] = useState<OrderPaymentInfo | null>(null);
  const [selectedCodeId, setSelectedCodeId] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState('');
  const previewUrlRef = useRef('');
  const [submitting, setSubmitting] = useState(false);

  const fetchPaymentInfo = useCallback(async () => {
    if (!orderId || !token) return;
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch(`${API_BASE}/api/v1/payments/order/${orderId}/create`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || '获取支付信息失败');
      const info = payload.data as OrderPaymentInfo;
      setPaymentInfo(info);
      setSelectedCodeId(info.platformCodes[0]?.id || '');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '获取支付信息失败');
    } finally {
      setLoading(false);
    }
  }, [orderId, token]);

  useEffect(() => {
    fetchPaymentInfo();
  }, [fetchPaymentInfo]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const selectedCode = useMemo(
    () => paymentInfo?.platformCodes.find((code) => code.id === selectedCodeId) || null,
    [paymentInfo, selectedCodeId],
  );

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextPreview = file ? URL.createObjectURL(file) : '';
    previewUrlRef.current = nextPreview;
    setProofFile(file);
    setProofPreviewUrl(nextPreview);
    setFormError('');
  };

  const handleSubmit = async () => {
    if (!proofFile) {
      setFormError('请先上传支付成功页面的截图。');
      return;
    }
    if (!selectedCodeId) {
      setFormError('请选择本次使用的支付方式。');
      return;
    }
    if (!orderId || !token) return;

    setSubmitting(true);
    setFormError('');
    const formData = new FormData();
    formData.append('file', proofFile);
    formData.append('platformCodeId', selectedCodeId);

    try {
      const response = await fetch(`${API_BASE}/api/v1/payments/order/${orderId}/confirm-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || '提交失败');
      navigate(`/orders/${orderId}`, { replace: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) return <Navigate to="/login" replace />;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-5" aria-label="正在加载支付信息">
        <div className="h-20 animate-pulse rounded-2xl bg-[var(--background-100)]" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="h-[520px] animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
          <div className="h-80 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
        </div>
      </div>
    );
  }

  if (loadError || !paymentInfo) {
    return (
      <div className="mx-auto w-full max-w-3xl py-8">
        <WorkbenchStatePanel
          icon={CreditCard}
          title="支付信息无法加载"
          description={loadError || '当前订单没有可用的支付信息。'}
          tone="error"
          action={<button type="button" onClick={fetchPaymentInfo} className="btn-cs btn-primary btn-sm">重新加载</button>}
        />
      </div>
    );
  }

  const { orderPayment, platformCodes } = paymentInfo;
  const amount = (value: number) => `¥${(value / 100).toFixed(2)}`;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={CreditCard}
        eyebrow="订单支付"
        title="完成付款并提交凭证"
        description="选择平台收款方式完成转账，然后上传支付成功截图供平台核验。"
        actions={<Link to={`/orders/${orderId}`} className="btn-cs btn-ghost-dark btn-sm"><ArrowLeft className="h-4 w-4" />返回订单</Link>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="flex flex-col gap-4 border-b border-[color:var(--border)] px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div><p className="text-sm text-[var(--text-500)]">本次应付</p><p className="mt-1 text-3xl font-bold tabular-nums text-[var(--text-900)]">{amount(orderPayment.amountCny)}</p></div>
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div><dt className="text-xs text-[var(--text-500)]">平台服务费</dt><dd className="mt-1 font-medium text-[var(--text-700)]">{amount(orderPayment.platformFeeCny)}</dd></div>
              <div><dt className="text-xs text-[var(--text-500)]">开发者实收</dt><dd className="mt-1 font-medium text-[var(--text-700)]">{amount(orderPayment.payoutCny)}</dd></div>
            </dl>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="flex items-center gap-2"><QrCode className="h-4 w-4 text-[var(--brand-600)]" /><h2 className="font-semibold text-[var(--text-900)]">选择收款方式</h2></div>
            {platformCodes.length === 0 ? (
              <div className="mt-4 rounded-xl bg-[var(--state-warning-surface)] p-4 text-sm text-[var(--state-warning)]">平台暂未配置可用的收款方式，请联系管理员后再试。</div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-3" role="radiogroup" aria-label="支付方式">
                {platformCodes.map((code) => {
                  const checked = selectedCodeId === code.id;
                  return (
                    <button
                      key={code.id}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => { setSelectedCodeId(code.id); setFormError(''); }}
                      className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-left transition-colors ${checked ? 'border-[var(--brand-400)] bg-[var(--brand-50)] text-[var(--brand-700)]' : 'border-[color:var(--border)] text-[var(--text-600)] hover:border-[var(--brand-300)]'}`}
                    >
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${checked ? 'border-[var(--brand-500)]' : 'border-[var(--background-500)]'}`}>{checked && <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand-500)]" />}</span>
                      <span><span className="block text-sm font-medium">{code.type === 'ALIPAY' ? '支付宝' : '微信支付'}</span><span className="mt-0.5 block text-xs opacity-75">{code.accountName}</span></span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedCode && (
            <div className="border-t border-[color:var(--border)] px-5 py-6 sm:px-6">
              <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                  <h2 className="font-semibold text-[var(--text-900)]">扫码完成付款</h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-500)]">使用{selectedCode.type === 'ALIPAY' ? '支付宝' : '微信'}扫描右侧二维码，核对收款账号与金额后完成转账。</p>
                  <div className="mt-5 rounded-xl bg-[var(--background-100)] p-4 text-sm">
                    <div className="flex justify-between gap-4"><span className="text-[var(--text-500)]">收款账号</span><span className="text-right font-medium text-[var(--text-800)]">{selectedCode.accountName}</span></div>
                    <div className="mt-3 flex justify-between gap-4"><span className="text-[var(--text-500)]">转账金额</span><span className="text-lg font-bold text-[var(--state-error)]">{amount(orderPayment.amountCny)}</span></div>
                  </div>
                </div>
                <img src={selectedCode.qrCodeUrl} alt={`${selectedCode.type === 'ALIPAY' ? '支付宝' : '微信'}平台收款码`} className="mx-auto aspect-square w-full max-w-[220px] rounded-xl border border-[color:var(--border)] bg-white object-contain p-3" />
              </div>
            </div>
          )}
        </section>

        <aside className="h-fit overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white lg:sticky lg:top-20">
          <div className="border-b border-[color:var(--border)] px-5 py-5"><h2 className="flex items-center gap-2 font-semibold text-[var(--text-900)]"><ReceiptText className="h-4 w-4 text-[var(--brand-600)]" />提交支付凭证</h2><p className="mt-1 text-sm leading-6 text-[var(--text-500)]">上传支付成功页面，平台确认后订单进入执行阶段。</p></div>
          <div className="space-y-4 px-5 py-5">
            {formError && <div className="rounded-xl border border-[#ffc6c1] bg-[var(--state-error-surface)] p-3 text-sm text-[var(--state-error)]">{formError}</div>}
            <label htmlFor="payment-proof" className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[color:var(--border)] px-4 text-center text-[var(--text-500)] transition-colors hover:border-[var(--brand-300)] hover:text-[var(--brand-600)]">
              {proofPreviewUrl ? <img src={proofPreviewUrl} alt="支付凭证预览" className="max-h-52 max-w-full rounded-lg object-contain" /> : <><ImagePlus className="mb-2 h-7 w-7" /><span className="text-sm font-medium">选择支付截图</span><span className="mt-1 text-xs">支持常见图片格式</span></>}
              <input id="payment-proof" type="file" accept="image/*" onChange={handleFileChange} className="sr-only" />
            </label>
            {proofFile && <div className="flex items-center gap-2 text-xs text-[var(--state-success-text)]"><CheckCircle2 className="h-4 w-4" /><span className="min-w-0 truncate">{proofFile.name}</span></div>}
            <button type="button" onClick={handleSubmit} disabled={submitting || !proofFile || !selectedCodeId} className="btn-cs btn-primary btn-sm w-full disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{submitting ? '正在提交...' : '确认已支付'}
            </button>
            <p className="text-xs leading-5 text-[var(--text-500)]">请勿上传包含无关隐私信息的图片。平台仅使用凭证核验本次订单付款。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
