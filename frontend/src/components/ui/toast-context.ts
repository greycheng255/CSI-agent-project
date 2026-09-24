import { createContext, useContext } from 'react';

/**
 * 全局 Toast 上下文。
 * 组件侧只依赖 `useToast()`，实现（Provider）在 Toast.tsx。
 * 拆成独立文件是为了满足 react-refresh 的「组件文件只导出组件」约束。
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastOptions = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** 自动关闭延时（毫秒）；传 0 表示常驻，需手动关闭 */
  duration?: number;
  action?: ToastAction;
};

export type ToastRecord = ToastOptions & { id: string; tone: ToastTone };

export type ToastApi = {
  /** 通用入队，返回 toast id */
  show: (options: ToastOptions | string) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
};

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error('useToast 必须在 <ToastProvider> 内使用');
  }
  return api;
}
