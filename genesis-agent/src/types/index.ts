/**
 * Genesis Agent 类型定义
 */

// 技能相关
export interface Skill {
  name: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  keywords: string[];
  description?: string;
  maxTaskComplexity?: number;
  capabilities?: string[];
}

export interface MatchResult {
  skill: Skill;
  matchScore: number;
  matchedKeywords: string[];
  confidence: number;
}

// 任务相关
export type TaskStatus = 'DRAFT' | 'OPEN' | 'CLOSED';

export interface Task {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria?: string;
  budgetCny: number;
  expectedDeliveryAt: string;
  status: TaskStatus;
  clientUserId: string;
  complexity?: number;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskAnalysis {
  taskId: string;
  title: string;
  description: string;
  extractedKeywords: string[];
  estimatedComplexity: number | string;
  requiredSkills: string[];
  timeEstimate: number;
  confidence: number;
  suggestedPrice?: number;
}

// 报价配置
export interface PricingConfig {
  baseRateCny: number;
  complexityMultiplier: Record<string, number>;
  urgencyMultiplier: Record<string, number>;
  minProfitMargin: number;
  marketAdjustment: {
    enabled: boolean;
    maxDiscount: number;
    minCompetitors: number;
  };
}

// 报价相关
export interface Bid {
  id: string;
  taskId: string;
  agentId: string;
  priceCny: number;
  planSummary: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  createdAt: string;
  pricingMeta?: Record<string, any>;
}

export interface QuoteStrategy {
  minProfitMargin: number;
  maxDiscountRate: number;
  competitiveAdjustment: boolean;
  urgencyBonus: number;
  marketRate: number;
}

export interface QuoteContext {
  task: Task;
  analysis: TaskAnalysis;
  marketBids: Bid[];
  agentSkills: Skill[];
  historicalWinRate: number;
}

export interface QuoteResult {
  price: number;
  confidence: number;
  reasoning: string;
  breakdown: {
    basePrice: number;
    complexityMultiplier: number;
    marketAdjustment: number;
    urgencyBonus: number;
    finalPrice: number;
  };
}

// Agent 配置
export interface AgentConfig {
  agentId: string;
  ownerToken: string;
  agentApiKey?: string;
  genesisApi: string;
  openclawUrl: string;
  scanInterval: number;
  heartbeatInterval: number;
  skills: Skill[];
  quoteStrategy: QuoteStrategy;
}

// 扫描配置
export interface ScanConfig {
  intervalMs: number;
  batchSize: number;
  maxRetries: number;
  retryDelayMs: number;
  filters: {
    status: TaskStatus;
    minBudget?: number;
    maxBudget?: number;
    skills?: string[];
  };
  priorityRules: PriorityRule[];
}

export interface PriorityRule {
  field: 'budget' | 'deadline' | 'complexity';
  weight: number;
  direction: 'asc' | 'desc';
}

export interface ScanResult {
  tasks: Task[];
  totalCount: number;
  scanTime: number;
  nextCursor?: string;
}

// API 响应
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// 日志相关
export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  agentId?: string;
  event?: string;
  payload?: Record<string, unknown>;
  error?: Error;
}

// 错误类型
export class GenesisAgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GenesisAgentError';
  }
}

export class GenesisAPIError extends GenesisAgentError {
  constructor(
    code: string,
    message: string,
    public statusCode?: number,
    details?: Record<string, unknown>
  ) {
    super(code, message, details);
    this.name = 'GenesisAPIError';
  }
}

// 心跳相关
export interface HeartbeatStatus {
  success?: boolean;
  agentId: string;
  status: 'ONLINE' | 'OFFLINE';
  lastHeartbeatAt?: string;
  timestamp?: string;
  consecutiveFailures: number;
}

// Openclaw 相关
export interface OpenclawAnalysisResult {
  taskId: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  estimatedHours: number;
  requiredSkills: string[];
  technicalStack: string[];
  riskFactors: string[];
  confidence: number;
  reasoning: string;
}

export interface OpenclawQuoteRequest {
  taskId: string;
  analysis: OpenclawAnalysisResult;
  marketRate: { min: number; max: number; avg: number };
  budgetCny: number;
  urgency: 'normal' | 'urgent' | 'emergency';
}

export interface OpenclawQuoteResult {
  taskId: string;
  suggestedPrice: number;
  minPrice: number;
  maxPrice: number;
  confidence: number;
  reasoning: string;
  breakdown: {
    basePrice: number;
    complexityMultiplier: number;
    marketAdjustment: number;
    urgencyBonus: number;
    finalPrice: number;
  };
}

// 子任务类型
export type SubTaskType = 'analysis' | 'design' | 'development' | 'testing' | 'documentation' | 'delivery';
export type SubTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface SubTask {
  id: string;
  taskId: string;
  title: string;
  description: string;
  type: SubTaskType;
  status: SubTaskStatus;
  estimatedHours: number;
  order: number;
  dependencies?: string[];
  deliverables: string[];
  result?: any;
  completedAt?: string;
  startedAt?: string;
}

// 任务执行计划
export interface TaskExecutionPlan {
  taskId: string;
  subTasks: SubTask[];
  timeline: {
    subTaskId: string;
    startTime: string;
    endTime: string;
    milestone: boolean;
  }[];
  totalEstimatedHours: number;
  dependencies: Map<string, string[]>;
}

// 任务执行状态
export interface TaskExecutionState {
  taskId: string;
  plan: TaskExecutionPlan;
  currentSubTaskId?: string;
  startedAt: string;
  updatedAt: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  progress: number; // 0-100
  logs: ExecutionLog[];
}

export interface ExecutionLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  subTaskId?: string;
  metadata?: Record<string, any>;
}

// 交付物类型
export interface Deliverable {
  id: string;
  taskId: string;
  subTaskId?: string;
  name: string;
  type: 'code' | 'document' | 'demo' | 'package';
  content?: string;
  filePath?: string;
  downloadUrl?: string;
  description: string;
  createdAt: string;
}

// 验收状态
export interface AcceptanceStatus {
  taskId: string;
  status: 'pending_delivery' | 'delivered' | 'under_review' | 'accepted' | 'rejected' | 'revision_requested';
  deliveredAt?: string;
  reviewedAt?: string;
  feedback?: string;
  revisionCount: number;
  deliverables: Deliverable[];
}

// 容器执行配置
export interface ContainerExecutionConfig {
  image: string;
  workingDir: string;
  environment: Record<string, string>;
  volumes: string[];
  memoryLimit: string;
  cpuLimit: string;
  timeout: number;
  networkEnabled: boolean;
}

// 代码执行结果
export interface CodeExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  artifacts: string[];
  logs: string[];
}

// 订单类型
export interface Order {
  id: string;
  taskId?: string;
  bidId?: string;
  ownerId?: string;
  ownerUserId?: string;
  amountCny?: number;
  task?: Task;
  bid?: Bid;
  owner?: {
    id: string;
  };
}
