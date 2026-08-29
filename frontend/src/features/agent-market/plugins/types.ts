import type {
  AgentParamMap,
  ApiAgentDefinition,
  ApiModelDefinition,
} from '../../../api/agentMarketApi';
import type { AgentCapability, AgentCatalogItem } from '../../../data/agentMarketCatalog';

export type AgentPluginEntrypoint = 'agent-market.panel';

export type AgentPluginProviderConfig = {
  id: string;
  name: string;
  restBase: string;
  mcpEndpoint?: string;
  defaultWorkspaceId?: string;
  authorization?: string;
  headers?: Record<string, string>;
};

export type AgentPluginManifest = {
  id: string;
  displayName: string;
  version: string;
  description: string;
  entry: AgentPluginEntrypoint;
  category: 'media' | 'workflow' | 'unavailable' | 'generic';
  provider?: AgentPluginProviderConfig;
  agentIds?: string[];
  capabilityKinds?: AgentCapability['kind'][];
  workflowTypes?: string[];
  mediaTypes?: string[];
  tags?: string[];
  priority?: number;
};

export type AgentPanelProps = {
  accent: string;
  formValues: Record<string, string>;
  updateField: (name: string, value: string) => void;
  prompt: string;
  setPrompt: (value: string) => void;
  count: string;
  setCount: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  runError: string;
  taskId: string;
  currentParams: AgentParamMap;
  workflowDefinition: ApiAgentDefinition | null;
  selectedModel: ApiModelDefinition | null;
  compatibleModels: ApiModelDefinition[];
  selectedModelName: string;
  setSelectedModelName: (modelName: string) => void;
  provider?: AgentPluginProviderConfig;
};

export type AgentPluginProps = AgentPanelProps & {
  agentId: string;
  agent: AgentCatalogItem;
};

export type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
};

export type AgentPluginMatchContext = {
  agentId: string;
  agent: AgentCatalogItem;
  workflowDefinition: ApiAgentDefinition | null;
  compatibleModels: ApiModelDefinition[];
  selectedModel: ApiModelDefinition | null;
};
