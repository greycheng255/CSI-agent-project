import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  History,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { getDeliveryHistory } from '../api/deliveryApi';
import type { Delivery, DeliveryStatus, RevisionType } from '../types/delivery';
import { formatShanghaiDateTime } from '../utils/date';

interface DeliveryHistoryProps {
  orderId: string;
  initialDeliveries?: Delivery[];
  embedded?: boolean;
}

const statusConfig: Record<
  DeliveryStatus,
  { label: string; className: string; icon: typeof Clock }
> = {
  PENDING_REVIEW: {
    label: '待验收',
    className: 'bg-[color:var(--state-warning-surface)] text-[color:var(--state-warning)]',
    icon: Clock,
  },
  ACCEPTED: {
    label: '已接受',
    className: 'bg-[color:var(--state-success-surface)] text-[color:var(--state-success-text)]',
    icon: CheckCircle2,
  },
  REJECTED: {
    label: '已拒绝',
    className: 'bg-[color:var(--state-error-surface)] text-[color:var(--state-error)]',
    icon: XCircle,
  },
  SUPERSEDED: {
    label: '已被替代',
    className: 'bg-[color:var(--background-200)] text-[color:var(--text-500)]',
    icon: RotateCcw,
  },
};

const revisionLabels: Record<RevisionType, string> = {
  SUBMIT: '首次提交',
  MODIFY: '修改提交',
  ACCEPT: '验收通过',
  REJECT: '退回修改',
};

export default function DeliveryHistory({
  orderId,
  initialDeliveries,
  embedded = false,
}: DeliveryHistoryProps) {
  const [deliveries, setDeliveries] = useState<Delivery[]>(initialDeliveries ?? []);
  const [loading, setLoading] = useState(initialDeliveries === undefined);
  const [error, setError] = useState('');
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null);

  const loadDeliveries = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await getDeliveryHistory(orderId);
      setDeliveries(data);
    } catch {
      setError('交付记录暂时无法加载');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (initialDeliveries !== undefined) {
      setDeliveries(initialDeliveries);
      setError('');
      setLoading(false);
      return;
    }
    void loadDeliveries();
  }, [initialDeliveries, loadDeliveries]);

  const containerClass = embedded
    ? 'py-6'
    : 'rounded-2xl border border-[color:var(--border)] bg-white p-5 md:p-6';

  if (loading) {
    return (
      <section className={containerClass} aria-label="正在加载交付记录">
        <div className="space-y-3">
          <div className="h-5 w-24 animate-pulse rounded bg-[color:var(--background-200)]" />
          <div className="h-16 animate-pulse rounded-xl bg-[color:var(--background-100)]" />
          <div className="h-16 animate-pulse rounded-xl bg-[color:var(--background-100)]" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={containerClass}>
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[color:var(--brand-600)]" />
          <h2 className="font-semibold text-[color:var(--text-900)]">交付记录</h2>
        </div>
        <div className="mt-4 flex flex-col gap-3 border-y border-[color:var(--border)] py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-[color:var(--state-warning)]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}，订单其他信息不受影响。</span>
          </div>
          <button
            type="button"
            onClick={() => void loadDeliveries()}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-current px-3 text-sm font-medium"
          >
            <RefreshCw className="h-4 w-4" />
            重新加载
          </button>
        </div>
      </section>
    );
  }

  if (deliveries.length === 0) {
    return (
      <section className={containerClass}>
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[color:var(--brand-600)]" />
          <h2 className="font-semibold text-[color:var(--text-900)]">交付记录</h2>
        </div>
        <div className="mt-4 border-y border-[color:var(--border)] py-8 text-center">
          <p className="text-sm font-medium text-[color:var(--text-700)]">暂无单独的交付记录</p>
          <p className="mt-1 text-xs text-[color:var(--text-500)]">智能体提交成果后，版本与验收信息会显示在这里。</p>
        </div>
      </section>
    );
  }

  return (
    <section className={containerClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[color:var(--brand-600)]" />
          <h2 className="font-semibold text-[color:var(--text-900)]">交付记录</h2>
        </div>
        <span className="rounded-full bg-[color:var(--background-200)] px-2.5 py-1 text-xs text-[color:var(--text-secondary)]">
          共 {deliveries.length} 个版本
        </span>
      </div>

      <div className="mt-4 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
        {deliveries.map((delivery, index) => {
          const config = statusConfig[delivery.status];
          const StatusIcon = config.icon;
          const isExpanded = expandedDelivery === delivery.id;
          const isLatest = index === 0;

          return (
            <article
              key={delivery.id}
              className="overflow-hidden"
            >
              <button
                type="button"
                className={`flex min-h-16 w-full items-center justify-between gap-4 px-1 py-4 text-left transition-colors hover:bg-[color:var(--background-100)] ${
                  isLatest ? 'text-[color:var(--text-900)]' : ''
                }`}
                onClick={() => setExpandedDelivery(isExpanded ? null : delivery.id)}
                aria-expanded={isExpanded}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.className}`}>
                    <StatusIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-[color:var(--text-primary)]">版本 {delivery.version}</span>
                      {isLatest && (
                        <span className="rounded-full bg-[color:var(--brand-50)] px-2 py-0.5 text-xs font-medium text-[color:var(--brand-700)]">
                          最新
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-[color:var(--text-tertiary)]">
                      {formatShanghaiDateTime(delivery.createdAt)}
                    </span>
                  </span>
                </div>

                <span className="flex shrink-0 items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${config.className}`}>
                    {config.label}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-[color:var(--text-tertiary)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </span>
              </button>

              {isExpanded && (
                <div className="space-y-5 border-t border-[color:var(--border)] bg-[color:var(--background-100)] p-4">
                  {delivery.deliveryText && (
                    <DetailBlock title="交付说明">
                      <p className="whitespace-pre-wrap text-sm text-[color:var(--text-secondary)]">{delivery.deliveryText}</p>
                    </DetailBlock>
                  )}

                  {delivery.attachmentUrl && (
                    <DetailBlock title="附件">
                      <ResourceLink url={delivery.attachmentUrl} label="查看交付附件" />
                    </DetailBlock>
                  )}

                  {delivery.artifactUrls && delivery.artifactUrls.length > 0 && (
                    <DetailBlock title="交付材料">
                      <div className="space-y-2">
                        {delivery.artifactUrls.map((url, urlIndex) => (
                          <ResourceLink key={`${delivery.id}-${urlIndex}`} url={url} label={url} />
                        ))}
                      </div>
                    </DetailBlock>
                  )}

                  {delivery.commitHash && (
                    <DetailBlock title="Commit Hash">
                      <code className="block break-all rounded-lg border border-[color:var(--border-default)] bg-white p-3 text-sm text-[color:var(--text-secondary)]">
                        {delivery.commitHash}
                      </code>
                    </DetailBlock>
                  )}

                  {delivery.evidenceBundle && (
                    <DetailBlock title="证据包">
                      <pre className="overflow-x-auto rounded-lg bg-[#111827] p-3 text-xs text-slate-100">
                        {JSON.stringify(delivery.evidenceBundle, null, 2)}
                      </pre>
                    </DetailBlock>
                  )}

                  {delivery.previewData && (
                    <DetailBlock title="成果预览">
                      <Preview delivery={delivery} />
                    </DetailBlock>
                  )}

                  {delivery.rejectionReason && (
                    <DetailBlock title="退回原因">
                      <div className="rounded-lg bg-[color:var(--state-error-surface)] p-3 text-sm text-[color:var(--state-error)]">
                        {delivery.rejectionReason}
                      </div>
                    </DetailBlock>
                  )}

                  {delivery.revisions && delivery.revisions.length > 0 && (
                    <DetailBlock title="修订记录">
                      <div className="space-y-2">
                        {delivery.revisions.map((revision) => (
                          <div key={revision.id} className="rounded-lg border border-[color:var(--border-default)] bg-white p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-[color:var(--text-primary)]">
                                {revisionLabels[revision.type]}
                              </span>
                              <span className="text-xs text-[color:var(--text-tertiary)]">
                                {formatShanghaiDateTime(revision.createdAt)}
                              </span>
                            </div>
                            {revision.comment && (
                              <p className="mt-2 text-[color:var(--text-secondary)]">{revision.comment}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </DetailBlock>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-[color:var(--text-primary)]">{title}</h3>
      {children}
    </div>
  );
}

function ResourceLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-11 items-center gap-2 rounded-lg border border-[color:var(--border-default)] bg-white px-3 text-sm text-[color:var(--brand-700)] transition-colors hover:border-[color:var(--brand-300)] hover:bg-[color:var(--brand-50)]"
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

function Preview({ delivery }: { delivery: Delivery }) {
  const preview = delivery.previewData;
  if (!preview) return null;

  if (preview.type === 'code') {
    return (
      <pre className="overflow-x-auto rounded-lg bg-[#111827] p-3 text-sm text-slate-100">
        <code>{preview.content}</code>
      </pre>
    );
  }
  if (preview.type === 'text') {
    return <p className="whitespace-pre-wrap text-sm text-[color:var(--text-secondary)]">{preview.content}</p>;
  }
  if (preview.type === 'link') {
    return <ResourceLink url={preview.content} label={preview.content} />;
  }
  return (
                          <img
                            loading="lazy"
      src={preview.content}
      alt="交付成果预览"
      className="max-h-[480px] max-w-full rounded-lg border border-[color:var(--border-default)] object-contain"
    />
  );
}
