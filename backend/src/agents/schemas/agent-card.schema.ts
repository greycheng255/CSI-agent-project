import Ajv from 'ajv';

// ============================================
// Agent Card JSON Schema v1.0
// 用于校验外部 Agent 提交的 agent-card.json
// ============================================

export const AGENT_CARD_JSON_SCHEMA = {
  type: 'object',
  required: [
    'schema_version',
    'name',
    'description',
    'version',
    'endpoints',
    'auth',
    'capabilities',
    'pricing',
  ],
  properties: {
    schema_version: {
      type: 'string',
      enum: ['1.0'],
      description: 'Agent Card 规范版本',
    },
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Agent 名称',
    },
    description: {
      type: 'string',
      minLength: 1,
      maxLength: 2000,
      description: 'Agent 简介',
    },
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
      description: '语义化版本号，如 0.1.0',
    },
    provider: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        homepage: { type: 'string', format: 'uri' },
        contact_email: { type: 'string', format: 'email' },
      },
    },
    endpoints: {
      type: 'object',
      required: ['task', 'health'],
      properties: {
        task: {
          type: 'string',
          format: 'uri',
          description: '任务交互端点 (A2A tasks endpoint)',
        },
        health: {
          type: 'string',
          format: 'uri',
          description: '健康检查端点',
        },
        callback: {
          type: 'string',
          format: 'uri',
          description: '回调端点（可选）',
        },
      },
    },
    auth: {
      type: 'object',
      required: ['type'],
      properties: {
        type: {
          enum: ['none', 'api_key', 'bearer', 'signature', 'mtls'],
          description: '鉴权方式',
        },
        key_id: {
          type: 'string',
          description: '密钥标识',
        },
      },
    },
    capabilities: {
      type: 'object',
      required: ['domains', 'skills'],
      properties: {
        domains: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: '业务领域，如 ["carbon", "report"]',
        },
        skills: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: '技能标签，如 ["python", "数据分析"]',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: '支持的 MCP 工具',
        },
        models: {
          type: 'array',
          items: { type: 'string' },
          description: '使用的 AI 模型',
        },
        input_formats: {
          type: 'array',
          items: { type: 'string' },
          description: '支持的输入格式',
        },
        output_formats: {
          type: 'array',
          items: { type: 'string' },
          description: '支持的输出格式',
        },
      },
    },
    pricing: {
      type: 'object',
      required: ['model'],
      properties: {
        model: {
          enum: ['fixed', 'hourly', 'token', 'quote'],
          description: '定价模式',
        },
        currency: {
          enum: ['CNY', 'USD'],
          default: 'CNY',
        },
        minimum_price: {
          type: 'number',
          minimum: 0,
          description: '最低价格（元）',
        },
        unit_price: {
          type: 'number',
          minimum: 0,
          description: '单价',
        },
        description: {
          type: 'string',
          description: '定价说明',
        },
      },
    },
    limits: {
      type: 'object',
      properties: {
        max_concurrent_tasks: {
          type: 'integer',
          minimum: 1,
          default: 3,
          description: '最大并发任务数',
        },
        timeout_seconds: {
          type: 'integer',
          minimum: 60,
          default: 3600,
          description: '单任务超时（秒）',
        },
      },
    },
  },
};

// ============================================
// 校验结果类型
// ============================================
export interface AgentCardValidationResult {
  valid: boolean;
  errors: string[];
  card: AgentCardDTO | null;
}

// ============================================
// 标准化 Agent Card DTO
// ============================================
export interface AgentCardDTO {
  schema_version: string;
  name: string;
  description: string;
  version: string;
  provider?: {
    owner?: string;
    homepage?: string;
    contact_email?: string;
  };
  endpoints: {
    task: string;
    health: string;
    callback?: string;
  };
  auth: {
    type: 'none' | 'api_key' | 'bearer' | 'signature' | 'mtls';
    key_id?: string;
  };
  capabilities: {
    domains: string[];
    skills: string[];
    tools?: string[];
    models?: string[];
    input_formats?: string[];
    output_formats?: string[];
  };
  pricing: {
    model: 'fixed' | 'hourly' | 'token' | 'quote';
    currency?: string;
    minimum_price?: number;
    unit_price?: number;
    description?: string;
  };
  limits?: {
    max_concurrent_tasks?: number;
    timeout_seconds?: number;
  };
  raw_json?: Record<string, unknown>;
}

// ============================================
// AJV 校验器（单例）
// ============================================
let _validator: any | null = null;

function getValidator(): any {
  if (!_validator) {
    _validator = new Ajv({ allErrors: true, verbose: true });
    // 注册自定义 format
    _validator.addFormat('uri', /^https?:\/\/.+/);
    _validator.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  }
  return _validator;
}

/**
 * 校验 Agent Card JSON
 * @param raw - 原始 JSON 对象
 * @returns 校验结果（含标准化 DTO 或错误列表）
 */
export function validateAgentCard(raw: unknown): AgentCardValidationResult {
  const ajv = getValidator();
  const valid = ajv.validate(AGENT_CARD_JSON_SCHEMA, raw);

  if (!valid) {
    const errors = (ajv.errors || []).map(
      (e: any) => `[${e.keyword}] ${e.dataPath || '(root)'} ${e.message}`,
    );
    return { valid: false, errors, card: null };
  }

  // 提取为标准 DTO
  const data = raw as Record<string, any>;
  const card: AgentCardDTO = {
    schema_version: data.schema_version,
    name: data.name,
    description: data.description,
    version: data.version,
    provider: data.provider
      ? {
          owner: data.provider.owner,
          homepage: data.provider.homepage,
          contact_email: data.provider.contact_email,
        }
      : undefined,
    endpoints: {
      task: data.endpoints.task,
      health: data.endpoints.health,
      callback: data.endpoints.callback,
    },
    auth: {
      type: data.auth.type,
      key_id: data.auth.key_id,
    },
    capabilities: {
      domains: data.capabilities.domains || [],
      skills: data.capabilities.skills || [],
      tools: data.capabilities.tools || [],
      models: data.capabilities.models || [],
      input_formats: data.capabilities.input_formats || [],
      output_formats: data.capabilities.output_formats || [],
    },
    pricing: {
      model: data.pricing.model,
      currency: data.pricing.currency || 'CNY',
      minimum_price: data.pricing.minimum_price,
      unit_price: data.pricing.unit_price,
      description: data.pricing.description,
    },
    limits: data.limits
      ? {
          max_concurrent_tasks: data.limits.max_concurrent_tasks,
          timeout_seconds: data.limits.timeout_seconds,
        }
      : undefined,
    raw_json: data,
  };

  return { valid: true, errors: [], card };
}
