import { createContext, useContext } from 'react';

/**
 * 全局确认弹窗上下文。替代原生 window.confirm：
 * 可定制标题/描述/按钮文案/危险语气，并支持「必填原因」内联输入。
 */

export type ConfirmTone = 'default' | 'danger';

export type ConfirmReasonField = {
  label: string;
  placeholder?: string;
  /** 是否必填，默认 true */
  required?: boolean;
  /** 输入框初始值 */
  defaultValue?: string;
};

export type ConfirmOptions = {
  title: string;
  description?: string;
  tone?: ConfirmTone;
  confirmText?: string;
  cancelText?: string;
  /** 需要用户填写原因时传入；确认后通过 result.reason 取回 */
  requireReason?: ConfirmReasonField;
};

export type ConfirmResult = {
  confirmed: boolean;
  /** 仅当传入 requireReason 且用户填写时存在 */
  reason?: string;
};

export type ConfirmApi = (options: ConfirmOptions) => Promise<ConfirmResult>;

export const ConfirmContext = createContext<ConfirmApi | null>(null);

export function useConfirm(): ConfirmApi {
  const api = useContext(ConfirmContext);
  if (!api) {
    throw new Error('useConfirm 必须在 <ConfirmProvider> 内使用');
  }
  return api;
}
