import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, ShieldAlert } from 'lucide-react';
import {
  ConfirmContext,
  type ConfirmApi,
  type ConfirmOptions,
  type ConfirmResult,
} from './confirm-context';

/** 焦点陷阱：只在弹窗内的可聚焦元素间循环 Tab */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<((result: ConfirmResult) => void) | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const confirm = useCallback<ConfirmApi>(
    (nextOptions) =>
      new Promise<ConfirmResult>((resolve) => {
        resolveRef.current = resolve;
        setReason(nextOptions.requireReason?.defaultValue ?? '');
        setError(null);
        setOptions(nextOptions);
      }),
    [],
  );

  const close = useCallback((result: ConfirmResult) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setOptions(null);
  }, []);

  const handleCancel = useCallback(() => close({ confirmed: false }), [close]);

  const handleConfirm = useCallback(() => {
    if (!options) return;
    const field = options.requireReason;
    const trimmed = reason.trim();
    if (field && field.required !== false && trimmed.length === 0) {
      setError(`请填写${field.label}`);
      reasonRef.current?.focus();
      return;
    }
    close({ confirmed: true, reason: trimmed || undefined });
  }, [options, reason, close]);

  // Esc 关闭 + 滚动锁 + 焦点陷阱 + 打开时聚焦首个操作元素
  useEffect(() => {
    if (!options) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      (options.requireReason ? reasonRef.current : confirmButtonRef.current)?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [options, handleCancel]);

  const tone = options?.tone ?? 'default';
  const Icon = tone === 'danger' ? ShieldAlert : CircleAlert;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div
          className="dialog-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) handleCancel();
          }}
        >
          <div
            ref={dialogRef}
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby={options.description ? 'confirm-dialog-desc' : undefined}
          >
            <span className={`dialog-icon dialog-icon--${tone}`}>
              <Icon aria-hidden="true" />
            </span>
            <h2 id="confirm-dialog-title" className="dialog-title">
              {options.title}
            </h2>
            {options.description && (
              <p id="confirm-dialog-desc" className="dialog-desc">
                {options.description}
              </p>
            )}

            {options.requireReason && (
              <label className="dialog-reason">
                <span>{options.requireReason.label}</span>
                <textarea
                  ref={reasonRef}
                  className={`field-input${error ? ' field-input--invalid' : ''}`}
                  rows={3}
                  placeholder={options.requireReason.placeholder}
                  value={reason}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'confirm-dialog-error' : undefined}
                  onChange={(event) => {
                    setReason(event.target.value);
                    if (error) setError(null);
                  }}
                />
                {error && (
                  <span id="confirm-dialog-error" className="field-error" role="alert">
                    {error}
                  </span>
                )}
              </label>
            )}

            <div className="dialog-actions">
              <button type="button" className="btn-cs btn-ghost-dark btn-sm" onClick={handleCancel}>
                {options.cancelText ?? '取消'}
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                className={`btn-cs btn-sm ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                onClick={handleConfirm}
              >
                {options.confirmText ?? '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
