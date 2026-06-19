// 交付相关类型定义

export type DeliveryStatus =
  | 'PENDING_REVIEW'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'SUPERSEDED';

export type RevisionType = 'SUBMIT' | 'MODIFY' | 'ACCEPT' | 'REJECT';

export interface DeliveryRevision {
  id: string;
  deliveryId: string;
  type: RevisionType;
  version: number;
  deliveryText: string | null;
  attachmentUrl: string | null;
  artifactUrls: string[] | null;
  evidenceBundle: Record<string, unknown> | null;
  commitHash: string | null;
  comment: string | null;
  createdById: string;
  createdAt: string;
}

export interface PreviewData {
  type: 'code' | 'text' | 'link' | 'image';
  content: string;
  language?: string;
}

export interface Delivery {
  id: string;
  orderId: string;
  ownerUserId: string;
  version: number;
  status: DeliveryStatus;
  deliveryText: string | null;
  attachmentUrl: string | null;
  artifactUrls: string[] | null;
  evidenceBundle: Record<string, unknown> | null;
  commitHash: string | null;
  previewData: PreviewData | null;
  rejectionReason: string | null;
  rejectedAt: string | null;
  acceptedAt: string | null;
  revisions: DeliveryRevision[];
  createdAt: string;
  updatedAt: string;
}

// 验收检查清单类型

export type ChecklistItemStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'NA';

export interface AcceptanceChecklist {
  id: string;
  orderId: string;
  itemIndex: number;
  criteriaText: string;
  status: ChecklistItemStatus;
  checkedById: string | null;
  checkedAt: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistStats {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  na: number;
  passRate: number;
}
