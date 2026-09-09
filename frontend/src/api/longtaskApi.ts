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
  /** 经营类目（PRD §4.1 引导配置「选择经营类目」；接收该类目商机推送） */
  categoryIds?: string[] | null;
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
  /** 当前 Workspace 平均评分（0-5；pg numeric 可能返回字符串），用于「评分」排序 */
  avgRating?: number | string;
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
  /** 任务发布者（雇主），用于席位页判断当前用户是否可执行选标/全部驳回 */
  employerUserId?: string | null;
}

export async function getMarketplaceTask(
  taskId: string,
): Promise<MarketplaceTaskInfo> {
  return requestJson<MarketplaceTaskInfo>(
    `/api/v1/longtask/marketplace-tasks/${encodeURIComponent(taskId)}`,
  );
}

/** 雇主选标结果（MarketplaceOrder 投影） */
export interface SelectBidResult {
  id: string;
  workspaceId: string;
  marketplaceTaskId: string;
  contractStatus: string;
  finalPriceCny: number | null;
}

/**
 * 雇主选标（PRD §5.6.2）：仅任务发布者本人可调用。
 * 选标后立即锁定：winner=won、其余=lost、任务→selected，并创建 Order。
 */
export async function selectMarketplaceBid(
  token: string,
  input: { taskId: string; bidId: string },
): Promise<SelectBidResult> {
  return requestJson<SelectBidResult>(
    `/api/v1/longtask/marketplace-tasks/${encodeURIComponent(input.taskId)}/select`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bidId: input.bidId }),
    },
  );
}

/**
 * 雇主全部驳回并重开竞标（PRD §5.6.3）：仅任务发布者本人可调用。
 * 当前轮 submitted → rejected，bid_round +1、席位清零。
 */
export async function rejectAllMarketplaceBids(
  token: string,
  taskId: string,
): Promise<{ rejectedCount: number }> {
  return requestJson<{ rejectedCount: number }>(
    `/api/v1/longtask/marketplace-tasks/${encodeURIComponent(taskId)}/reject-all`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: '{}',
    },
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

/** 默认工作室自动开通结果 */
export interface EnsureDefaultWorkspaceResult {
  created: boolean;
  workspace: WorkspaceShowcaseData;
}

/**
 * 默认 Workspace 自动开通（PRD §4.1/§4.2）：Owner 登录态无工作室时自动创建默认工作室；
 * 已有则幂等返回现有。前端在「我的工作室」/ 手动参与竞标等无工作室场景调用。
 */
export async function ensureDefaultWorkspace(
  token: string,
  displayName?: string | null,
): Promise<EnsureDefaultWorkspaceResult> {
  return requestJson<EnsureDefaultWorkspaceResult>(
    '/api/v1/longtask/workspaces/ensure-default',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(displayName ? { displayName } : {}),
    },
  );
}

export interface OwnerMarketplaceBidInput {
  taskId: string;
  workspaceId: string;
  priceCny: number;
  planSummary?: string | null;
  estimatedDeliveryAt?: string | null;
}

/** 提交竞标后响应（后端 MarketplaceBidsService.submit 返回） */
export interface OwnerMarketplaceBidResult {
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
  seatTaken: number;
  seatLimit: number;
  seatFull: boolean;
  seatFullDeadline: string | null;
}

/**
 * Agent Owner 手动参与竞标（不等 Console 5min 轮询）：workspace owner 登录态立即占席位。
 * 后端校验 workspace.ownerUserId === 登录用户；source 记 manual_assign。
 */
export async function submitOwnerMarketplaceBid(
  token: string,
  input: OwnerMarketplaceBidInput,
): Promise<OwnerMarketplaceBidResult> {
  return requestJson<OwnerMarketplaceBidResult>('/api/v1/longtask/owner/bids', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}