import { useState, useEffect } from 'react';
import { Clock, CheckCircle, XCircle, RotateCcw, FileText, ExternalLink } from 'lucide-react';
import { getDeliveryHistory } from '../api/deliveryApi';
import type { Delivery } from '../types/delivery';

interface DeliveryHistoryProps {
  orderId: string;
}

const statusConfig = {
  PENDING_REVIEW: { label: '待审核', color: 'text-yellow-600', bg: 'bg-yellow-50', icon: Clock },
  ACCEPTED: { label: '已接受', color: 'text-green-600', bg: 'bg-green-50', icon: CheckCircle },
  REJECTED: { label: '已拒绝', color: 'text-red-600', bg: 'bg-red-50', icon: XCircle },
  SUPERSEDED: { label: '已替代', color: 'text-gray-600', bg: 'bg-gray-50', icon: RotateCcw },
};

export default function DeliveryHistory({ orderId }: DeliveryHistoryProps) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null);

  useEffect(() => {
    loadDeliveries();
  }, [orderId]);

  const loadDeliveries = async () => {
    try {
      setLoading(true);
      const data = await getDeliveryHistory(orderId);
      setDeliveries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-gray-600">加载交付历史中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-red-600 text-center py-4">{error}</div>
        <button
          onClick={loadDeliveries}
          className="w-full py-2 text-blue-600 hover:text-blue-800 text-sm"
        >
          重新加载
        </button>
      </div>
    );
  }

  if (deliveries.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">交付历史</h3>
        <div className="text-gray-500 text-center py-8">暂无交付记录</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        交付历史
        <span className="ml-2 text-sm font-normal text-gray-500">
          共 {deliveries.length} 个版本
        </span>
      </h3>

      <div className="space-y-4">
        {deliveries.map((delivery, index) => {
          const config = statusConfig[delivery.status];
          const StatusIcon = config.icon;
          const isExpanded = expandedDelivery === delivery.id;
          const isLatest = index === 0;

          return (
            <div
              key={delivery.id}
              className={`border rounded-lg overflow-hidden transition-all ${
                isLatest ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200'
              }`}
            >
              {/* 头部信息 */}
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedDelivery(isExpanded ? null : delivery.id)}
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-full ${config.bg}`}>
                    <StatusIcon className={`w-5 h-5 ${config.color}`} />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-medium text-gray-900">
                        版本 {delivery.version}
                      </span>
                      {isLatest && (
                        <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                          最新
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-gray-500">
                      {new Date(delivery.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.color}`}>
                    {config.label}
                  </span>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* 展开详情 */}
              {isExpanded && (
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  {/* 交付说明 */}
                  {delivery.deliveryText && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">交付说明</h4>
                      <div className="bg-white p-3 rounded border text-gray-700 whitespace-pre-wrap">
                        {delivery.deliveryText}
                      </div>
                    </div>
                  )}

                  {/* 附件链接 */}
                  {delivery.attachmentUrl && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">附件</h4>
                      <a
                        href={delivery.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-4 py-2 bg-white border border-gray-300 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        查看附件
                        <ExternalLink className="w-3 h-3 ml-2" />
                      </a>
                    </div>
                  )}

                  {/* 预览数据 */}
                  {delivery.previewData && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">预览</h4>
                      <div className="bg-white p-3 rounded border">
                        {delivery.previewData.type === 'code' && (
                          <pre className="text-sm bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto">
                            <code>{delivery.previewData.content}</code>
                          </pre>
                        )}
                        {delivery.previewData.type === 'text' && (
                          <p className="text-gray-700 whitespace-pre-wrap">{delivery.previewData.content}</p>
                        )}
                        {delivery.previewData.type === 'link' && (
                          <a
                            href={delivery.previewData.content}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {delivery.previewData.content}
                          </a>
                        )}
                        {delivery.previewData.type === 'image' && (
                          <img
                            src={delivery.previewData.content}
                            alt="交付预览"
                            className="max-w-full h-auto rounded"
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* 拒绝原因 */}
                  {delivery.rejectionReason && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium text-red-700 mb-2">拒绝原因</h4>
                      <div className="bg-red-50 border border-red-200 p-3 rounded text-red-700">
                        {delivery.rejectionReason}
                      </div>
                    </div>
                  )}

                  {/* 修订历史 */}
                  {delivery.revisions && delivery.revisions.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">修订记录</h4>
                      <div className="space-y-2">
                        {delivery.revisions.map((revision) => (
                          <div
                            key={revision.id}
                            className="bg-white p-3 rounded border text-sm"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-gray-700">
                                {revision.type === 'SUBMIT' && '初始提交'}
                                {revision.type === 'MODIFY' && '修改提交'}
                                {revision.type === 'ACCEPT' && '接受'}
                                {revision.type === 'REJECT' && '拒绝'}
                              </span>
                              <span className="text-gray-500">
                                {new Date(revision.createdAt).toLocaleString('zh-CN')}
                              </span>
                            </div>
                            {revision.comment && (
                              <p className="text-gray-600">{revision.comment}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
