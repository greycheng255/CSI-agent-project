import { API_BASE } from '../config/api';

/** 历史交付案例（PRD §5.6.7：≤6 个，支持公开/仅评审可见） */
export interface WorkspaceShowcaseCase {
  title?: string;
  summary?: string;
  permission?: 'public' | 'review_only';
  imageUrl?: string;
}

/** Workspace 展示页数据（长任务线，后端 workspaces 实体投影） */
export interface WorkspaceShowcaseData {
  id: string;
  orgId: string | null;
  name: string;
  slug: string;
  logoUrl: string | null;
  bio: string | null;
  categoryIds: string[] | null;
  capabilityTags: string[] | null;
  serviceCommitments: Record<string, unknown>;
  displayStatus: 'active' | 'suspended' | 'frozen';
  receivePlatformPush: boolean;
  autoBidEnabled: boolean;
  completedTasksCount: number;
  avgRating: number | string; // pg numeric 可能返回字符串
  onTimeRate: number | string;
  disputeRate: number | string;
  showcaseCases: WorkspaceShowcaseCase[] | null;
  announcement: string | null;
  createdAt: string;
  updatedAt: string;
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    const data = text ? (JSON.parse(text) as { message?: string } | null) : null;
    throw new Error(data?.message || `Request failed: ${response.status}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** 按 slug 查询 Workspace 展示数据（公开页） */
export async function getWorkspaceBySlug(
  slug: string,
): Promise<WorkspaceShowcaseData | null> {
  return requestJson<WorkspaceShowcaseData | null>(
    `/api/v1/longtask/workspaces/slug/${encodeURIComponent(slug)}`,
  );
}

/** 按 id 查询（预留：从竞标列表跳转） */
export async function getWorkspaceById(
  id: string,
): Promise<WorkspaceShowcaseData | null> {
  return requestJson<WorkspaceShowcaseData | null>(
    `/api/v1/longtask/workspaces/${encodeURIComponent(id)}`,
  );
}

/** 按归属 Agent Owner（既有用户）查询其 AI 工作室——改造语义：工作室绑定现有用户 */
export async function getWorkspaceByOwner(
  ownerUserId: string,
): Promise<WorkspaceShowcaseData | null> {
  return requestJson<WorkspaceShowcaseData | null>(
    `/api/v1/longtask/workspaces/owner/${encodeURIComponent(ownerUserId)}`,
  );
}

export interface CreateWorkspaceInput {
  ownerUserId?: string | null;
  name: string;
  slug: string;
  bio?: string | null;
}

/** 开通 AI 工作室（工作台改造：Agent Owner 升级为工作室运营者） */
export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<WorkspaceShowcaseData> {
  return requestJson<WorkspaceShowcaseData>('/api/v1/longtask/workspaces', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface UpdateWorkspaceShowcaseInput {
  bio?: string | null;
  capabilityTags?: string[] | null;
  announcement?: string | null;
  showcaseCases?: WorkspaceShowcaseCase[] | null;
  serviceCommitments?: Record<string, unknown>;
}

/** 更新工作室门面（展示页数据，工作台管理面入口） */
export async function updateWorkspaceShowcase(
  id: string,
  patch: UpdateWorkspaceShowcaseInput,
): Promise<WorkspaceShowcaseData> {
  return requestJson<WorkspaceShowcaseData>(
    `/api/v1/longtask/workspaces/${encodeURIComponent(id)}/showcase`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
}

/** 数值归一（pg numeric 可能返回字符串） */
export function toNumber(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 竞标席位项（后端 rank 输出，含 workspace 名称/头像快照——答复文档六.3） */
export interface MarketplaceSeatBid {
  bid: {
    id: string;
    marketplaceTaskId: string;
    bidRound: number;
    workspaceId: string;
    workspaceName: string | null;
    workspaceLogoUrl: string | null;
    priceCny: number;
    planSummary: string | null;
    estimatedDeliveryAt: string | null;
    status: string;
    source: 'push' | 'pull' | 'manual_assign';
    createdAt: string;
  };
  score: number;
  workspaceName: string | null;
  workspaceLogoUrl: string | null;
  platformRecommended: boolean;
}

/** 查询任务竞标席位（综合分排序；分数不展示，仅用于排序） */
export async function getTaskSeatBids(
  taskId: string,
): Promise<MarketplaceSeatBid[]> {
  return requestJson<MarketplaceSeatBid[]>(
    `/api/v1/longtask/marketplace-tasks/${encodeURIComponent(taskId)}/bids`,
  );
}

/** 长任务任务详情（席位页头部展示） */
export interface MarketplaceTaskInfo {
  id: string;
  title: string;
  description?: string | null;
  categoryId?: string | null;
  budgetMinCny?: number | null;
  budgetMaxCny?: number | null;
  status?: string;
  seatTaken?: number;
  seatLimit?: number;
  expiresAt?: string | null;
}

export async function getMarketplaceTask(
  taskId: string,
): Promise<MarketplaceTaskInfo> {
  return requestJson<MarketplaceTaskInfo>(
    `/api/v1/longtask/marketplace-tasks/${encodeURIComponent(taskId)}`,
  );
}

/** 已入驻工作室画廊条目（公开档案白名单字段，仅 active） */
export interface WorkspaceGalleryItem {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  bio: string | null;
  categoryIds: string[] | null;
  capabilityTags: string[] | null;
  completedTasksCount: number;
  avgRating: number | string;
  announcement: string | null;
}

/** 查询已入驻工作室画廊 */
export async function listWorkspaceGallery(): Promise<
  WorkspaceGalleryItem[]
> {
  return requestJson<WorkspaceGalleryItem[]>(
    '/api/v1/longtask/workspaces/gallery',
  );
}