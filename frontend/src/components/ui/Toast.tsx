import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import {
  ToastContext,
  type ToastApi,
  type ToastOptions,
  type ToastRecord,
  type ToastTone,
} from './toast-context';

/** 每种语气对应的图标（成功/错误/警告/信息） */
const TONE_ICON: Record<ToastTone, typeof Info> = {
  success: CheckCircle2,
  error: CircleAlert,
  warning: AlertTriangle,
  info: Info,
};

const DEFAULT_DURATION = 4000;
/** 同屏最多保留的 toast 条数，超出时挤掉最早的 */
const MAX_VISIBLE = 5;

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const Icon = TONE_ICON[toast.tone];

  return (
    <div className={`toast-item toast-item--${toast.tone}`}>
      <Icon className="toast-item-icon" aria-hidden="true" />
      <div className="toast-item-body">
        <p className="toast-item-title">{toast.title}</p>
        {toast.description && <p className="toast-item-desc">{toast.description}</p>}
        {toast.action && (
          <button
            type="button"
            className="toast-item-action"
            onClick={() => {
              toast.action?.onClick();
              onDismiss(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        className="toast-item-close"
        aria-label="关闭提示"
        onClick={() => onDismiss(toast.id)}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * 全局轻量反馈。挂在路由之外，页面跳转不会丢提示。
 * 容器固定右上角，z-index 300（高于导航 100 / 抽屉 200）。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (options: ToastOptions | string) => {
      const normalized: ToastOptions = typeof options === 'string' ? { title: options } : options;
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const record: ToastRecord = { ...normalized, tone: normalized.tone ?? 'info', id };
      setToasts((prev) => [...prev, record].slice(-MAX_VISIBLE));

      const duration = normalized.duration ?? DEFAULT_DURATION;
      if (duration > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) => show({ title, description, tone: 'success' }),
      error: (title, description) => show({ title, description, tone: 'error' }),
      warning: (title, description) => show({ title, description, tone: 'warning' }),
      info: (title, description) => show({ title, description, tone: 'info' }),
      dismiss,
    }),
    [show, dismiss],
  );

  // 卸载时清掉所有待触发的定时器，避免内存泄漏
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
