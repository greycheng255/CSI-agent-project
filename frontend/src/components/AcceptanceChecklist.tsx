/* eslint-disable react-hooks/exhaustive-deps -- checklist reloads are intentionally keyed only by orderId */
import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, MinusCircle, Circle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { getChecklist, getChecklistStats, generateChecklist, updateChecklist } from '../api/deliveryApi';
import type { AcceptanceChecklist, ChecklistStats, ChecklistItemStatus } from '../types/delivery';

interface AcceptanceChecklistProps {
  orderId: string;
  userId: string;
  isClient: boolean;
  orderStatus: string;
  onStatusChange?: () => void;
  embedded?: boolean;
}

const statusConfig: Record<ChecklistItemStatus, { label: string; icon: typeof Circle; color: string }> = {
  PENDING: { label: '待检查', icon: Circle, color: 'text-gray-400' },
  PASSED: { label: '通过', icon: CheckCircle, color: 'text-green-500' },
  FAILED: { label: '未通过', icon: XCircle, color: 'text-red-500' },
  NA: { label: '不适用', icon: MinusCircle, color: 'text-gray-400' },
};

export default function AcceptanceChecklistComponent({
  orderId,
  userId,
  isClient,
  orderStatus,
  onStatusChange,
  embedded = false,
}: AcceptanceChecklistProps) {
  const [checklist, setChecklist] = useState<AcceptanceChecklist[]>([]);
  const [stats, setStats] = useState<ChecklistStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const containerClass = embedded
    ? 'py-6'
    : 'rounded-2xl border border-[color:var(--border)] bg-white p-5 md:p-6';

  useEffect(() => {
    loadChecklist();
  }, [orderId]);

  const loadChecklist = async () => {
    try {
      setLoading(true);
      const [items, statsData] = await Promise.all([
        getChecklist(orderId),
        getChecklistStats(orderId),
      ]);
      setChecklist(items);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      await generateChecklist(orderId);
      await loadChecklist();
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdateStatus = async (itemId: string, status: ChecklistItemStatus, comment?: string) => {
    if (!isClient || orderStatus !== 'DELIVERED') return;

    try {
      setUpdating(true);
      await updateChecklist(orderId, userId, [{ itemId, status, comment }]);
      await loadChecklist();
      onStatusChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setUpdating(false);
    }
  };

  const toggleExpand = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  if (loading) {
    return (
      <section className={containerClass}>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--brand-600)]" aria-hidden="true" />
          <span className="ml-2 text-[var(--text-500)]">加载检查清单...</span>
        </div>
      </section>
    );
  }

  if (checklist.length === 0) {
    return (
      <section className={containerClass}>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">验收检查清单</h3>
        <div className="text-center py-8">
          <p className="text-gray-500 mb-4">暂无验收检查清单</p>
          {isClient && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {generating ? '生成中...' : '从验收标准生成'}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={containerClass}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">验收检查清单</h3>
        {stats && (
          <div className="flex items-center space-x-4 text-sm">
            <div className="flex items-center">
              <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all"
                  style={{ width: `${stats.passRate}%` }}
                ></div>
              </div>
              <span className="text-gray-600">{stats.passRate}% 通过</span>
            </div>
            <span className="text-gray-500">
              {stats.passed}/{stats.total - stats.na} 项通过
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-600 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {checklist.map((item, index) => {
          const config = statusConfig[item.status];
          const StatusIcon = config.icon;
          const isExpanded = expandedItems.has(item.id);
          const canEdit = isClient && orderStatus === 'DELIVERED' && !updating;

          return (
            <div
              key={item.id}
              className={`border rounded-lg transition-all ${
                item.status === 'FAILED' ? 'border-red-200 bg-red-50' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start p-4">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-gray-100 rounded-full text-sm text-gray-600 mr-3">
                  {index + 1}
                </span>

                <div className="flex-grow">
                  <div className="flex items-center justify-between">
                    <p className="text-gray-800">{item.criteriaText}</p>
                    <button
                      onClick={() => toggleExpand(item.id)}
                      className="ml-2 p-1 text-gray-400 hover:text-gray-600"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* 状态按钮 */}
                  {canEdit && (
                    <div className="flex items-center space-x-2 mt-2">
                      {(['PASSED', 'FAILED', 'NA'] as ChecklistItemStatus[]).map((status) => {
                        const btnConfig = statusConfig[status];
                        const BtnIcon = btnConfig.icon;
                        return (
                          <button
                            key={status}
                            onClick={() => handleUpdateStatus(item.id, status)}
                            disabled={updating}
                            className={`flex items-center px-3 py-1 rounded-full text-sm transition-colors ${
                              item.status === status
                                ? `${btnConfig.color} bg-gray-100`
                                : 'text-gray-500 hover:bg-gray-50'
                            }`}
                          >
                            <BtnIcon className="w-4 h-4 mr-1" />
                            {btnConfig.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* 展开详情 */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="flex items-center text-sm text-gray-500 mb-2">
                        <StatusIcon className={`w-4 h-4 mr-1 ${config.color}`} />
                        <span>当前状态: {config.label}</span>
                        {item.checkedAt && (
                          <span className="ml-4">
                            检查时间: {new Date(item.checkedAt).toLocaleString('zh-CN')}
                          </span>
                        )}
                      </div>

                      {item.comment && (
                        <div className="bg-gray-50 p-2 rounded text-sm text-gray-600">
                          <span className="font-medium">备注:</span> {item.comment}
                        </div>
                      )}

                      {canEdit && (
                        <div className="mt-2">
                          <input
                            type="text"
                            placeholder="添加备注..."
                            className="w-full px-3 py-2 border rounded text-sm"
                            onBlur={(e) => {
                              if (e.target.value) {
                                handleUpdateStatus(item.id, item.status, e.target.value);
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 统计摘要 */}
      {stats && (
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="grid grid-cols-5 gap-4 text-center">
            <div className="p-3 bg-gray-50 rounded">
              <div className="text-2xl font-bold text-gray-700">{stats.total}</div>
              <div className="text-xs text-gray-500">总计</div>
            </div>
            <div className="p-3 bg-green-50 rounded">
              <div className="text-2xl font-bold text-green-600">{stats.passed}</div>
              <div className="text-xs text-green-600">通过</div>
            </div>
            <div className="p-3 bg-red-50 rounded">
              <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
              <div className="text-xs text-red-600">未通过</div>
            </div>
            <div className="p-3 bg-yellow-50 rounded">
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
              <div className="text-xs text-yellow-600">待检查</div>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <div className="text-2xl font-bold text-gray-500">{stats.na}</div>
              <div className="text-xs text-gray-500">不适用</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
