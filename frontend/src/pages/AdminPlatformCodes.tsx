import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config/api';
import { QrCode, Plus, Trash2, Edit2, Eye, EyeOff } from 'lucide-react';


interface PlatformCode {
  id: string;
  type: 'ALIPAY' | 'WECHAT';
  qrCodeUrl: string;
  accountName: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

export default function AdminPlatformCodes() {
  const { adminToken, admin } = useAuthStore();
  const navigate = useNavigate();
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
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-6 py-8 rounded-lg text-center">
          <h2 className="text-xl font-bold mb-2">访问被拒绝</h2>
          <p>请先登录管理员账号。</p>
          <button
            onClick={() => navigate('/admin/login')}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            前往登录
          </button>
        </div>
      </div>
    );
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
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <QrCode className="w-6 h-6" />
        平台收款码管理
      </h1>

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* 添加/编辑表单 */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          {editingCode ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          {editingCode ? '编辑收款码' : '添加平台收款码'}
        </h2>

        <form onSubmit={editingCode ? handleUpdate : handleUpload} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                收款码类型
              </label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as 'ALIPAY' | 'WECHAT')}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                disabled={!!editingCode}
              >
                <option value="ALIPAY">支付宝</option>
                <option value="WECHAT">微信支付</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                账号名称
              </label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="例如：Genesis平台支付宝"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {editingCode ? '更新收款码图片（可选）' : '收款码图片'}
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
              required={!editingCode}
            />
            {selectedFile && (
              <p className="text-sm text-gray-400 mt-1">
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
              <label htmlFor="isActive" className="text-sm text-gray-300">
                启用此收款码
              </label>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={uploading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
            >
              {uploading ? '处理中...' : editingCode ? '更新' : '上传'}
            </button>
            {editingCode && (
              <button
                type="button"
                onClick={cancelEdit}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg"
              >
                取消
              </button>
            )}
          </div>
        </form>
      </div>

      {/* 收款码列表 */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">类型</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">账号名称</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">收款码</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">状态</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {codes.map((code) => (
              <tr key={code.id} className="hover:bg-gray-700/50">
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                    code.type === 'ALIPAY' 
                      ? 'bg-blue-900/50 text-blue-300' 
                      : 'bg-green-900/50 text-green-300'
                  }`}>
                    {code.type === 'ALIPAY' ? '支付宝' : '微信支付'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-300">{code.accountName}</td>
                <td className="px-4 py-3">
                  <img 
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
                        ? 'bg-green-900/50 text-green-300 hover:bg-green-900/70'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
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
                      className="p-1 text-blue-400 hover:text-blue-300 transition-colors"
                      title="编辑"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(code.id)}
                      className="p-1 text-red-400 hover:text-red-300 transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {codes.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            暂无平台收款码，请添加一个。
          </div>
        )}
      </div>
    </div>
  );
}
