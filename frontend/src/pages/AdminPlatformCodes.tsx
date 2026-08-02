import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { Navigate } from 'react-router-dom';
import { API_BASE } from '../config/api';
import { CircleAlert, Inbox, Loader2, QrCode, Plus, Trash2, Edit2, Eye, EyeOff } from 'lucide-react';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';


interface PlatformCode {
  id: string;
  type: 'ALIPAY' | 'WECHAT';
  qrCodeUrl: string;
  accountName: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

/* eslint-disable react-hooks/exhaustive-deps -- the initial platform-code fetch is intentionally keyed only by the admin session */
export default function AdminPlatformCodes() {
  const { adminToken, admin } = useAuthStore();
  const [codes, setCodes] = useState<PlatformCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editingCode, setEditingCode] = useState<PlatformCode | null>(null);

  // 上传表单状态
  const [selectedType, setSelectedType] = useState<'ALIPAY' | 'WECHAT'>('ALIPAY');
  const [accountName, setAccountName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    if (admin) {
      fetchPlatformCodes();
    }
  }, [admin]);

  // 检查是否为管理员
  if (!admin) {
    return <Navigate to="/login" replace />;
  }

  const fetchPlatformCodes = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/platform-codes/all`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCodes(data.data || []);
      } else {
        const errorData = await res.json();
        setError(errorData.message || '获取平台收款码失败');
      }
    } catch {
      setError('获取平台收款码失败');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !accountName) {
      setError('请填写完整信息并选择图片');
      return;
    }

    setUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('type', selectedType);
    formData.append('accountName', accountName);

    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/platform-codes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: formData,
      });

      if (res.ok) {
        await fetchPlatformCodes();
        setSelectedFile(null);
        setAccountName('');
        alert('平台收款码上传成功！');
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

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCode) return;

    setUploading(true);
    setError('');

    const formData = new FormData();
    if (selectedFile) {
      formData.append('file', selectedFile);
    }
    formData.append('accountName', accountName);
    formData.append('isActive', editingCode.isActive.toString());
    formData.append('sortOrder', editingCode.sortOrder.toString());

    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/platform-codes/${editingCode.id}/update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: formData,
      });

      if (res.ok) {
        await fetchPlatformCodes();
        setEditingCode(null);
        setSelectedFile(null);
        setAccountName('');
        alert('更新成功！');
      } else {
        const errorData = await res.json();
        setError(errorData.message || '更新失败');
      }
    } catch {
      setError('更新失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (codeId: string) => {
    if (!confirm('确定要删除这个收款码吗？')) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/platform-codes/${codeId}/delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      if (res.ok) {
        await fetchPlatformCodes();
        alert('删除成功！');
      } else {
        const errorData = await res.json();
        setError(errorData.message || '删除失败');
      }
    } catch {
      setError('删除失败，请重试');
    }
  };

  const toggleActive = async (code: PlatformCode) => {
    try {
      const formData = new FormData();
      formData.append('accountName', code.accountName);
      formData.append('isActive', (!code.isActive).toString());
      formData.append('sortOrder', code.sortOrder.toString());

      const res = await fetch(`${API_BASE}/api/v1/payments/platform-codes/${code.id}/update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: formData,
      });

      if (res.ok) {
        await fetchPlatformCodes();
      } else {
        const errorData = await res.json();
        setError(errorData.message || '操作失败');
      }
    } catch {
      setError('操作失败，请重试');
    }
  };

  const startEdit = (code: PlatformCode) => {
    setEditingCode(code);
    setAccountName(code.accountName);
    setSelectedType(code.type);
    setSelectedFile(null);
  };

  const cancelEdit = () => {
    setEditingCode(null);
    setAccountName('');
    setSelectedFile(null);
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white text-sm text-[var(--text-500)]">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-[var(--brand-500)]" />正在读取平台收款码...
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader icon={QrCode} eyebrow="平台收款码" title="平台收款配置" description="维护订单支付环节向雇主展示的平台支付宝与微信收款码。" />

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-[color:var(--state-error)] bg-[var(--state-error-surface)] px-4 py-3 text-sm text-[var(--state-error)]"><CircleAlert className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* 添加/编辑表单 */}
      <section className="rounded-2xl border border-[color:var(--border)] bg-white p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[var(--text-900)]">
          {editingCode ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          {editingCode ? '编辑收款码' : '添加平台收款码'}
        </h2>

        <form onSubmit={editingCode ? handleUpdate : handleUpload} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--text-600)]">
                收款码类型
              </label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as 'ALIPAY' | 'WECHAT')}
                className="field-input"
                disabled={!!editingCode}
              >
                <option value="ALIPAY">支付宝</option>
                <option value="WECHAT">微信支付</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--text-600)]">
                账号名称
              </label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="例如：Genesis平台支付宝"
                className="field-input"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--text-600)]">
              {editingCode ? '更新收款码图片（可选）' : '收款码图片'}
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="field-input"
              required={!editingCode}
            />
            {selectedFile && (
              <p className="mt-1 text-sm text-[var(--text-500)]">
                已选择: {selectedFile.name}
              </p>
            )}
          </div>

          {editingCode && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={editingCode.isActive}
                onChange={(e) => setEditingCode({ ...editingCode, isActive: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor="isActive" className="text-sm text-[var(--text-600)]">
                启用此收款码
              </label>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={uploading}
              className="btn-cs btn-primary btn-sm disabled:opacity-50"
            >
              {uploading ? '处理中...' : editingCode ? '更新' : '上传'}
            </button>
            {editingCode && (
              <button
                type="button"
                onClick={cancelEdit}
                className="btn-cs btn-ghost-dark btn-sm"
              >
                取消
              </button>
            )}
          </div>
        </form>
      </section>

      {/* 收款码列表 */}
      <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
        <div className="border-b border-[color:var(--border)] px-5 py-4"><h2 className="font-semibold text-[var(--text-800)]">已配置收款码</h2><p className="mt-1 text-xs text-[var(--text-500)]">共 {codes.length} 条配置</p></div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="bg-[var(--background-100)]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-500)]">类型</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-500)]">账号名称</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-500)]">收款码</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-500)]">状态</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-500)]">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border)]">
            {codes.map((code) => (
              <tr key={code.id} className="hover:bg-[var(--background-100)]">
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                    code.type === 'ALIPAY' 
                      ? 'bg-[var(--brand-50)] text-[var(--brand-700)]'
                      : 'bg-[var(--state-success-surface)] text-[var(--state-success-text)]'
                  }`}>
                    {code.type === 'ALIPAY' ? '支付宝' : '微信支付'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-[var(--text-700)]">{code.accountName}</td>
                <td className="px-4 py-3">
                      <img
                        loading="lazy"
                    src={code.qrCodeUrl} 
                    alt="收款码" 
                    className="w-16 h-16 object-cover rounded"
                  />
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleActive(code)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                      code.isActive
                        ? 'bg-[var(--state-success-surface)] text-[var(--state-success-text)]'
                        : 'bg-[var(--background-100)] text-[var(--text-500)]'
                    }`}
                  >
                    {code.isActive ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {code.isActive ? '启用中' : '已禁用'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEdit(code)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--brand-600)] hover:bg-[var(--brand-50)]"
                      title="编辑"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(code.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--state-error)] hover:bg-[var(--state-error-surface)]"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        
        {codes.length === 0 && (
          <div className="flex flex-col items-center px-6 py-12 text-center"><span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--background-100)] text-[var(--text-400)]"><Inbox className="h-5 w-5" /></span><p className="font-medium text-[var(--text-700)]">暂无平台收款码</p><p className="mt-1 text-sm text-[var(--text-500)]">请先添加支付宝或微信收款码，供订单支付流程使用。</p></div>
        )}
      </section>
    </div>
  );
}
