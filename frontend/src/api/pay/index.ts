import { API_BASE } from '../../config/api';
import type {
  AlipayPaymentState,
  CreateAlipayPaymentResult,
} from '../../features/pay/types';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string | string[];
}

async function request<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | null;
  if (!response.ok || !payload?.success) {
    const message = payload?.message;
    throw new Error(
      Array.isArray(message)
        ? message.join('；')
        : message || `支付请求失败 (${response.status})`,
    );
  }
  return payload.data;
}

export function createAlipayPayment(
  orderId: string,
  token: string,
): Promise<CreateAlipayPaymentResult> {
  return request<CreateAlipayPaymentResult>(
    `/api/v1/payments/alipay/orders/${encodeURIComponent(orderId)}`,
    token,
    { method: 'POST' },
  );
}

export function getAlipayPaymentStatus(
  orderId: string,
  token: string,
  refresh = false,
): Promise<AlipayPaymentState> {
  const suffix = refresh ? '?refresh=1' : '';
  return request<AlipayPaymentState>(
    `/api/v1/payments/alipay/orders/${encodeURIComponent(orderId)}/status${suffix}`,
    token,
  );
}
