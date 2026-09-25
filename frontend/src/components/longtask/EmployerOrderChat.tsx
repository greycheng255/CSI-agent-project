import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
} from 'lucide-react';
import {
  employerReplyMention,
  listEmployerOrderMessages,
  sendEmployerOrderMessage,
} from '../../api/longtaskApi';
import type { EmployerThreadItem } from '../../api/longtaskApi';
import { Skeleton } from '../ui/Skeleton';

interface EmployerOrderChatProps {
  orderId: string;
  token: string | null;
}

/** 轮询间隔：Agent 在 Console 侧提问后无需手动刷新即可看到 */
const POLL_INTERVAL_MS = 30_000;

/** 发起方展示名：入站显示 Agent/Owner，出站统一显示「你（雇主）」 */
function senderLabel(item: EmployerThreadItem): string {
  if (item.direction === 'outbound') return '你（雇主）';
  return item.from.displayName ?? (item.from.type === 'agent_owner' ? 'Agent Owner' : 'Agent');
}

/**
 * 生成合法 uuid v4 作为幂等键：`crypto.randomUUID` 仅在安全上下文（HTTPS / localhost）
 * 可用，纯 HTTP 域名或 IP 访问时为 undefined，直接调用会抛 TypeError 导致发送按钮静默失效。
 * 故退回基于 `crypto.getRandomValues`（非安全上下文亦可用）的 uuid v4 实现。
 */
function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 订单沟通区块（场景四 #9/#10 + 雇主主动发起）：
 * Console 侧 Agent / Agent Owner 在 Task Comment 里 @employer 提问后，
 * 提问进入本收件箱；雇主可逐条回复，也可主动发起新消息。
 * 两类出站都经 §13.3 employer-reply 写回 Console，Console 是唯一真相源。
 */
export default function EmployerOrderChat({ orderId, token }: EmployerOrderChatProps) {
  const [items, setItems] = useState<EmployerThreadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  /** 幂等键：提交失败重试复用同一值，避免重复落库 */
  const clientMessageIdRef = useRef<string>('');

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setError('');
    try {
      setItems(await listEmployerOrderMessages(token, orderId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取沟通记录失败');
    } finally {
      setLoading(false);
    }
  }, [orderId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // 轻量轮询：页面可见且无提交进行中时刷新
  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !busy) void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [token, busy, load]);

  async function submit(action: () => Promise<void>, successText: string) {
    setBusy(true);
    setMsg('');
    try {
      await action();
      setMsgOk(true);
      setMsg(successText);
      await load();
      return true;
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : '发送失败，请稍后重试');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    if (!token) return;
    const text = draft.trim();
    if (!text) return;
    const ok = await submit(
      () => {
        // 幂等键在动作内生成，异常可被 submit 捕获并提示（而非静默失效）
        if (!clientMessageIdRef.current) clientMessageIdRef.current = newClientMessageId();
        return sendEmployerOrderMessage(token, orderId, {
          text,
          clientMessageId: clientMessageIdRef.current,
        });
      },
      '已发送，Agent / Agent Owner 将在 Console 侧收到。',
    );
    if (ok) {
      setDraft('');
      clientMessageIdRef.current = '';
    }
  }

  async function handleReply(mentionId: string) {
    if (!token) return;
    const text = replyDraft.trim();
    if (!text) return;
    const ok = await submit(
      () => employerReplyMention(token, orderId, mentionId, text),
      '已回复，回复已写回 Console 任务评论。',
    );
    if (ok) {
      setReplyDraft('');
      setReplyTo(null);
    }
  }

  const pendingCount = items.filter(
    (item) => item.kind === 'question' && item.status === 'pending',
  ).length;

  return (
    <section className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-[var(--text-800)]">
          <MessageSquare className="h-5 w-5 text-[var(--brand-600)]" />
          沟通
        </h2>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="rounded-full bg-[var(--state-warning-surface)] px-2.5 py-0.5 text-xs font-medium text-[var(--state-warning)]">
              {pendingCount} 条待你回复
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="刷新沟通记录"
            className="btn-cs min-h-9 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`mt-3 flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[var(--background-100)] px-4 py-3 text-sm ${
            msgOk ? 'text-[var(--state-success-text)]' : 'text-[var(--state-error)]'
          }`}
        >
          {msgOk ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <CircleAlert className="h-4 w-4 shrink-0" />
          )}
          {msg}
        </div>
      )}

      {loading ? (
        <div className="mt-3 space-y-3" aria-busy="true" aria-label="正在读取沟通记录">
          <Skeleton className="h-16 w-full" rounded="lg" />
          <Skeleton className="h-16 w-4/5" rounded="lg" />
        </div>
      ) : error ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--background-100)] px-4 py-3">
          <span className="text-sm text-[var(--state-error)]">{error}</span>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="btn-cs min-h-9 px-3 text-sm"
          >
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-500)]">
          暂无沟通记录。Agent / Agent Owner 在 Console 侧 @你 提问后会出现在这里，你也可以主动发起消息。
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((item) => {
            const outbound = item.direction === 'outbound';
            return (
              <li
                key={item.id}
                className={`rounded-xl p-4 ${
                  item.kind === 'reply'
                    ? 'ml-6 bg-[var(--background-100)]'
                    : outbound
                      ? 'bg-[var(--brand-50)]'
                      : 'bg-[var(--background-100)]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--text-700)]">
                    {senderLabel(item)}
                    {item.kind === 'reply' && (
                      <span className="ml-2 text-xs font-normal text-[var(--text-400)]">
                        回复提问
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-[var(--text-400)]">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>

                {item.kind === 'question' && item.status === 'pending' && (
                  <span className="mt-1.5 inline-block rounded-full bg-[var(--state-warning-surface)] px-2 py-0.5 text-xs font-medium text-[var(--state-warning)]">
                    待你回复
                  </span>
                )}

                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-[var(--text-700)]">
                  {item.text}
                </p>

                {item.attachments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {item.attachments.map((file, index) =>
                      file.url ? (
                        <li key={`${item.id}-${index}`}>
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-xs text-[var(--brand-600)] hover:underline"
                          >
                            {file.name ?? file.url}
                          </a>
                        </li>
                      ) : (
                        <li key={`${item.id}-${index}`} className="text-xs text-[var(--text-500)]">
                          {file.name ?? '附件'}
                        </li>
                      ),
                    )}
                  </ul>
                )}

                {item.kind === 'question' && item.status === 'pending' && (
                  <div className="mt-3">
                    {replyTo === item.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={replyDraft}
                          onChange={(event) => setReplyDraft(event.target.value)}
                          rows={3}
                          maxLength={4000}
                          placeholder="回复这个问题…"
                          className="w-full rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)]"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={busy || !replyDraft.trim()}
                            onClick={() => void handleReply(item.id)}
                            className="btn-cs btn-primary min-h-10 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            发送回复
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setReplyTo(null);
                              setReplyDraft('');
                            }}
                            className="btn-cs min-h-10 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            取消
                          </button>
                          {busy && (
                            <Loader2 className="h-4 w-4 animate-spin text-[var(--text-400)]" />
                          )}
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setReplyTo(item.id);
                          setReplyDraft('');
                        }}
                        className="btn-cs min-h-10 text-sm"
                      >
                        回复
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 主动发起新消息 */}
      <div className="mt-4 space-y-2 border-t border-[color:var(--border)] pt-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[var(--text-600)]">
            主动发起消息（发给 Agent / Agent Owner）
          </span>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="例如：请在交付里补充移动端适配的说明"
            className="w-full rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)]"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !draft.trim() || !token}
            onClick={() => void handleSend()}
            className="btn-cs btn-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            发送
          </button>
          {busy && <Loader2 className="h-4 w-4 animate-spin text-[var(--text-400)]" />}
        </div>
        <p className="text-xs text-[var(--text-400)]">
          消息会写回 Console 任务评论；Agent / Agent Owner 在 Console 侧查看与回复。
        </p>
      </div>
    </section>
  );
}
