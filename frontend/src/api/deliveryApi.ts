import { API_BASE } from '../config/api';
import type { Delivery, AcceptanceChecklist, ChecklistStats } from '../types/delivery';

const apiBase = API_BASE;

// 获取交付历史
export async function getDeliveryHistory(orderId: string): Promise<Delivery[]> {
  const res = await fetch(`${apiBase}/api/v1/orders/${orderId}/delivery-history`);
  if (!res.ok) throw new Error('Failed to fetch delivery history');
  return res.json();
}

// 提交交付物
export async function submitDelivery(
  orderId: string,
  userId: string,
  data: {
    deliverySummary?: string;
    deliveryUrl?: string;
    previewData?: {
      type: 'code' | 'text' | 'link' | 'image';
      content: string;
      language?: string;
    };
  }
): Promise<{ order: any; delivery: Delivery }> {
  const res = await fetch(`${apiBase}/api/v1/orders/${orderId}/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...data }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || 'Failed to submit delivery');
  }
  return res.json();
}

// 接受交付
export async function acceptDelivery(orderId: string, userId: string): Promise<any> {
  const res = await fetch(`${apiBase}/api/v1/orders/${orderId}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || 'Failed to accept delivery');
  }
  return res.json();
}

// 拒绝/退回交付
export async function rejectDelivery(
  orderId: string,
  userId: string,
  data: {
    reason?: string;
    requireRevision?: boolean;
  }
): Promise<{ order: any; action: string }> {
  const res = await fetch(`${apiBase}/api/v1/orders/${orderId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...data }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || 'Failed to reject delivery');
  }
  return res.json();
}

// 获取验收检查清单
export async function getChecklist(orderId: string): Promise<AcceptanceChecklist[]> {
  const res = await fetch(`${apiBase}/api/v1/orders/${orderId}/checklist`);
  if (!res.ok) throw new Error('Failed to fetch checklist');
  return res.json();
}

// 获取检查清单统计
export async function getChecklistStats(orderId: string): Promise<ChecklistStats> {
  const res = await fetch(`${apiBase}/api/v1/orders/${orderId}/checklist/stats`);
  if (!res.ok) throw new Error('Failed to fetch checklist stats');
  return res.json();
}

// 生成检查清单
export async function generateChecklist(orderId: string): Promise<AcceptanceChecklist[]> {
  const res = await fetch(`${apiBase}/api/v1/orders/${orderId}/checklist/generate`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to generate checklist');
  return res.json();
}

// 更新检查清单
export async function updateChecklist(
  orderId: string,
  userId: string,
  items: { itemId: string; status: string; comment?: string }[]
): Promise<AcceptanceChecklist[]> {
  const res = await fetch(`${apiBase}/api/v1/orders/${orderId}/checklist/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, items }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || 'Failed to update checklist');
  }
  return res.json();
}
