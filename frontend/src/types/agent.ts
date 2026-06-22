export type AgentApprovalStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'disabled';

export type AgentRuntimeStatus =
  | 'unknown'
  | 'online'
  | 'offline'
  | 'degraded'
  | 'timeout';

export type AgentType =
  | 'platform-managed'
  | 'self-hosted'
  | 'platform_managed'
  | 'self_hosted'
  | 'platform'
  | 'external';

export interface AgentCapability {
  id: string;
  capabilityType?: string;
  name: string;
  value?: Record<string, unknown> | null;
}

export interface AgentTag {
  id: string;
  tag?: string;
  name?: string;
  tagType?: string;
  type?: string;
}

export interface AgentCardSummary {
  id: string;
  schemaVersion?: string;
  version?: string;
  cardJson?: Record<string, unknown>;
  contentHash?: string;
  source?: string;
  isActive?: boolean;
  fetchedAt?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  webhookUrl?: string | null;
  status?: 'ONLINE' | 'OFFLINE';
  skills?: string[];
  owner?: {
    id?: string;
    phone?: string;
    displayName?: string;
  };
  agentType?: AgentType;
  approvalStatus?: AgentApprovalStatus;
  runtimeStatus?: AgentRuntimeStatus;
  visibility?: 'public' | 'private';
  version?: string;
  cardUrl?: string | null;
  endpointUrl?: string | null;
  healthUrl?: string | null;
  authType?: string | null;
  pricingModel?: string | null;
  basePrice?: number | null;
  currency?: string | null;
  reputationScore?: number | null;
  approvedAt?: string | null;
  contactEmail?: string | null;
  createdAt?: string;
  updatedAt?: string;
  isActive?: boolean;
  capabilities?: AgentCapability[];
  tags?: AgentTag[];
  cards?: AgentCardSummary[];
  metadata?: Record<string, unknown> | null;
}

export interface AgentTagCount {
  tag: string;
  tagType?: string;
  count: number;
}

export interface AgentListResult {
  items: Agent[];
  total: number;
}

export interface RegisterAgentPayload {
  name: string;
  description?: string;
  skills?: string[];
  domains?: string[];
  tags?: string[];
  endpointUrl?: string;
  webhookUrl?: string;
  healthUrl?: string;
  authType?: string;
  pricingModel?: string;
  basePrice?: number | null;
  currency?: string;
  contactEmail?: string;
}

export interface RegisterExternalAgentPayload {
  cardUrl?: string;
  cardJson?: Record<string, unknown>;
  contactEmail?: string;
  metadata?: Record<string, unknown>;
}

export interface DiscoverAgentsParams {
  query?: string;
  tags?: string[] | string;
  skills?: string[] | string;
  domains?: string[] | string;
  runtimeStatus?: string;
  limit?: number;
  offset?: number;
}
