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
  /** PRD §4.1 引导配置：名称 / logo / 简介 / 类目 / 标签 / 公告 / 承诺 */
  name?: string | null;
  logoUrl?: string | null;
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

// ===== 雇主「我的长任务」（工作台「我的任务」页展示竞标动态与签约入口）=====

/** 我的长任务当前轮竞标摘要（来自席位 rank 投影） */
export interface MyMarketplaceTaskBid {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  workspaceLogoUrl: string | null;
  priceCny: number;
  planSummary: string | null;
  estimatedDeliveryAt: string | null;
  source: 'push' | 'pull' | 'manual_assign';
  status: string;
  platformRecommended: boolean;
  createdAt: string;
}

/** 我发布的长任务任务（含竞标动态与选标结果） */
export interface MyMarketplaceTask {
  id: string;
  title: string;
  description: string | null;
  status: 'draft' | 'open' | 'selected' | 'completed' | 'expired' | 'closed' | 'cancelled';
  seatTaken: number;
  seatLimit: number;
  bidRound: number;
  createdAt: string;
  expiresAt: string | null;
  bids: MyMarketplaceTaskBid[];
  /** 已选标生成的签约订单（长任务线），用于跳转签约订单详情 */
  orderId: string | null;
  orderContractStatus: string | null;
}

/** 我发布的长任务列表（仅登录雇主本人名下，按发布时间倒序） */
export async function listMyMarketplaceTasks(
  token: string,
): Promise<MyMarketplaceTask[]> {
  return requestJson<MyMarketplaceTask[]>(
    '/api/v1/longtask/marketplace-tasks/mine',
    { headers: { Authorization: `Bearer ${token}` } },
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
  /** PRD §5.6.8 差异化提示：与同任务已提交方案相似度（≥85% → warning，不阻断提交） */
  similarity?: {
    maxSimilarity: number;
    similarCount: number;
    warning: boolean;
    threshold: number;
  };
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

// ===== 雇主订单 / 签约（长任务线内部读取端点 + 雇主动作）=====

/** Spec 里程碑（Console 推送快照，权重合计 100%） */
export interface EmployerOrderMilestone {
  key?: string;
  name?: string;
  weight?: number;
  status?: string;
}

/** 长任务订单（MarketplaceOrder 投影；列表附带任务标题与中标工作室名） */
export interface EmployerOrder {
  id: string;
  projectId: string | null;
  workspaceId: string;
  marketplaceTaskId: string;
  employerUserId: string | null;
  finalPriceCny: number | null;
  contractStatus: string;
  specSnapshot: { content?: unknown } | null;
  specHash: string | null;
  specVersion: number;
  milestones: EmployerOrderMilestone[] | null;
  specDeadline: string | null;
  specRejectionCount: number;
  deliveryStatus: string | null;
  settlementStatus: string | null;
  /** 雇主签约托管支付：unpaid / paid（金额语义统一为元） */
  paymentStatus?: string;
  paidAt?: string | null;
  afterSaleDeadline: string | null;
  createdAt: string;
  updatedAt: string;
  /** 列表投影；详情由 task/workspace 字段提供 */
  taskTitle?: string | null;
  workspaceName?: string | null;
}

/** 交付物（场景五；平台只存 metadata + 签名 URL） */
export interface EmployerOrderDelivery {
  id: string;
  orderId: string;
  submissionSeq: number;
  metadata: Record<string, unknown> | null;
  artifactUrls: string[] | null;
  status: 'submitted' | 'accepted' | 'rejected' | 'revision_requested' | 'auto_accepted';
  reviewRound: number;
  submittedAt: string | null;
  acceptDeadline: string | null;
  createdAt: string;
}

/** 协商取消请求（场景八） */
export interface EmployerOrderCancelRequest {
  id: string;
  orderId: string;
  cancelProposalSeq: number;
  status: 'open' | 'accepted' | 'rejected' | 'counter_proposed' | 'finalized' | 'to_dispute';
  trigger: string | null;
  ownerResponse: string | null;
  resolution: string | null;
  createdAt: string;
}

/** 纠纷（场景十） */
export interface EmployerOrderDispute {
  id: string;
  orderId: string;
  status: 'evidence_open' | 'arbitrating' | 'resolved' | 'acknowledged';
  evidenceDeadline: string | null;
  arbitrationDeadline: string | null;
  resolution: string | null;
  resolutionAmountCny: number | null;
  createdAt: string;
}

export interface EmployerOrderTaskBrief {
  id: string;
  title: string;
  description: string | null;
  status: string;
}

export interface EmployerOrderWorkspaceBrief {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

/** 订单详情（Spec 快照与里程碑、交付物、最新协商/纠纷） */
export interface EmployerOrderDetail {
  order: EmployerOrder;
  task: EmployerOrderTaskBrief | null;
  workspace: EmployerOrderWorkspaceBrief | null;
  deliveries: EmployerOrderDelivery[];
  latestCancelRequest: EmployerOrderCancelRequest | null;
  latestDispute: EmployerOrderDispute | null;
}

/** 我的订单列表（仅当前登录雇主名下订单） */
export async function listEmployerOrders(
  token: string,
): Promise<EmployerOrder[]> {
  return requestJson<EmployerOrder[]>('/api/v1/longtask/employer/orders', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** 订单详情（读取即认领无主订单，非雇主 → 403） */
export async function getEmployerOrderDetail(
  token: string,
  orderId: string,
): Promise<EmployerOrderDetail> {
  return requestJson<EmployerOrderDetail>(
    `/api/v1/longtask/employer/orders/${encodeURIComponent(orderId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

/** 场景四 #12：雇主确认 / 驳回 Spec */
export async function employerSpecAction(
  token: string,
  orderId: string,
  action: 'confirmed' | 'rejected',
  reason?: string | null,
): Promise<EmployerOrder> {
  return requestJson<EmployerOrder>(
    `/api/v1/longtask/employer/orders/${encodeURIComponent(orderId)}/spec-action`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, reason: reason ?? null }),
    },
  );
}

/** 场景五 #14：雇主验收（accepted / rejected / revision_requested） */
export async function employerReviewDelivery(
  token: string,
  orderId: string,
  action: 'accepted' | 'rejected' | 'revision_requested',
  reason?: string | null,
): Promise<EmployerOrderDelivery> {
  return requestJson<EmployerOrderDelivery>(
    `/api/v1/longtask/employer/orders/${encodeURIComponent(orderId)}/review`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, reason: reason ?? null }),
    },
  );
}

/** 场景八 #24：雇主发起协商取消 */
export async function employerRequestCancel(
  token: string,
  orderId: string,
): Promise<EmployerOrderCancelRequest> {
  return requestJson<EmployerOrderCancelRequest>(
    `/api/v1/longtask/employer/orders/${encodeURIComponent(orderId)}/cancel-requests`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: '{}',
    },
  );
}

/**
 * 签约托管支付（余额）：按订单价（元）扣款入平台托管。
 * 服务端按订单价计费，无需传金额；余额不足时后端返回 400，可引导雇主去充值。
 */
export async function employerPayWithBalance(
  token: string,
  orderId: string,
): Promise<EmployerOrder> {
  return requestJson<EmployerOrder>(
    `/api/v1/longtask/employer/orders/${encodeURIComponent(orderId)}/pay-with-balance`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: '{}',
    },
  );
}

// ===== Agent Owner 接单履约（名下工作室的中标订单与交付）=====

/** Owner 视角中标订单（列表投影） */
export interface OwnerLongtaskOrder {
  id: string;
  projectId: string | null;
  workspaceId: string;
  marketplaceTaskId: string;
  finalPriceCny: number | null;
  contractStatus: string;
  paymentStatus: string;
  specVersion: number;
  deliveryStatus: string | null;
  settlementStatus: string | null;
  settlementAmountCny: number | null;
  settledAt: string | null;
  afterSaleDeadline: string | null;
  createdAt: string;
  taskTitle: string | null;
  workspaceName: string | null;
}

/** Owner 订单详情（交付历史 + 结算单） */
export interface OwnerLongtaskOrderDetail {
  order: EmployerOrder;
  task: EmployerOrderTaskBrief | null;
  workspace: EmployerOrderWorkspaceBrief | null;
  deliveries: EmployerOrderDelivery[];
  settlement: {
    order_id: string;
    settlement_status: string;
    amount_cny: number | null;
    completed_at: string | null;
  } | null;
}

/** 名下工作室的中标订单列表（按下单时间倒序） */
export async function listOwnerLongtaskOrders(
  token: string,
): Promise<OwnerLongtaskOrder[]> {
  return requestJson<OwnerLongtaskOrder[]>(
    '/api/v1/longtask/owner/orders',
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

/** Owner 订单详情 */
export async function getOwnerLongtaskOrderDetail(
  token: string,
  orderId: string,
): Promise<OwnerLongtaskOrderDetail> {
  return requestJson<OwnerLongtaskOrderDetail>(
    `/api/v1/longtask/owner/orders/${encodeURIComponent(orderId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

/** Owner 提交交付物（启动雇主 14 天验收计时） */
export async function ownerSubmitDeliverable(
  token: string,
  orderId: string,
  input: { note?: string | null; artifactUrls?: string[] | null },
): Promise<EmployerOrderDelivery> {
  return requestJson<EmployerOrderDelivery>(
    `/api/v1/longtask/owner/orders/${encodeURIComponent(orderId)}/deliverables`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        metadata: input.note ? { note: input.note } : null,
        artifact_urls: input.artifactUrls ?? [],
      }),
    },
  );
}

/** 场景十 #33/#39：雇主发起纠纷（进入 3 天举证窗口） */
export async function employerRaiseDispute(
  token: string,
  orderId: string,
  reason?: string | null,
): Promise<EmployerOrderDispute> {
  return requestJson<EmployerOrderDispute>(
    `/api/v1/longtask/employer/orders/${encodeURIComponent(orderId)}/disputes`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason: reason ?? null }),
    },
  );
}
