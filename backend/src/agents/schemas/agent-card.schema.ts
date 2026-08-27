import Ajv from 'ajv';

export const AGENT_CARD_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: true,
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
    },
    agent_id: { type: 'string' },
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
    },
    description: {
      type: 'string',
      minLength: 1,
      maxLength: 2000,
    },
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
    },
    provider: {
      type: 'object',
      additionalProperties: true,
      properties: {
        owner: { type: 'string' },
        homepage: { type: 'string', format: 'uri' },
        contact_email: { type: 'string', format: 'email' },
      },
    },
    endpoints: {
      type: 'object',
      additionalProperties: true,
      required: ['task', 'health'],
      properties: {
        task: { type: 'string', format: 'uri' },
        webhook: { type: 'string', format: 'uri' },
        health: { type: 'string', format: 'uri' },
        callback: { type: 'string', format: 'uri' },
      },
    },
    auth: {
      type: 'object',
      additionalProperties: true,
      required: ['type'],
      properties: {
        type: { enum: ['none', 'api_key', 'bearer', 'signature', 'mtls'] },
        key_id: { type: 'string' },
      },
    },
    capabilities: {
      type: 'object',
      additionalProperties: true,
      required: ['domains', 'skills'],
      properties: {
        domains: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
        skills: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
        },
        models: {
          type: 'array',
          items: { type: 'string' },
        },
        languages: {
          type: 'array',
          items: { type: 'string' },
        },
        input_formats: {
          type: 'array',
          items: { type: 'string' },
        },
        output_formats: {
          type: 'array',
          items: { type: 'string' },
        },
        max_concurrency: {
          type: 'integer',
          minimum: 1,
        },
      },
    },
    pricing: {
      type: 'object',
      additionalProperties: true,
      required: ['model'],
      properties: {
        model: { enum: ['fixed', 'hourly', 'token', 'quote'] },
        currency: { enum: ['CNY', 'USD'] },
        minimum_price: { type: 'number', minimum: 0 },
        unit_price: { type: 'number', minimum: 0 },
        description: { type: 'string' },
      },
    },
    limits: {
      type: 'object',
      additionalProperties: true,
      properties: {
        max_concurrent_tasks: { type: 'integer', minimum: 1 },
        timeout_seconds: { type: 'integer', minimum: 60 },
      },
    },
    metadata: {
      type: 'object',
      additionalProperties: true,
    },
    signature: { type: 'string' },
  },
} as const;

export interface AgentCardValidationResult {
  valid: boolean;
  errors: string[];
  card: AgentCardDTO | null;
}

export interface AgentCardDTO {
  [key: string]: unknown;
  schema_version: '1.0';
  agent_id?: string;
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
    webhook?: string;
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
    languages?: string[];
    input_formats?: string[];
    output_formats?: string[];
    max_concurrency?: number;
  };
  pricing: {
    model: 'fixed' | 'hourly' | 'token' | 'quote';
    currency?: 'CNY' | 'USD';
    minimum_price?: number;
    unit_price?: number;
    description?: string;
  };
  limits?: {
    max_concurrent_tasks?: number;
    timeout_seconds?: number;
  };
  metadata?: Record<string, unknown>;
  signature?: string;
  raw_json: Record<string, unknown>;
}

type AjvValidationError = {
  instancePath?: string;
  dataPath?: string;
  keyword?: string;
  message?: string;
};

let validator: any | null = null;

function getValidator() {
  if (!validator) {
    validator = new Ajv({ allErrors: true });
    validator.addFormat('uri', /^https?:\/\/.+/);
    validator.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  }
  return validator;
}

function normalizeErrors(errors: AjvValidationError[] | null | undefined) {
  return (errors || []).map((error) => {
    const path = error.instancePath || error.dataPath || '(root)';
    return `[${error.keyword || 'schema'}] ${path} ${error.message || ''}`.trim();
  });
}

export function validateAgentCard(raw: unknown): AgentCardValidationResult {
  const ajv = getValidator();
  const valid = ajv.validate(AGENT_CARD_JSON_SCHEMA, raw);
  if (!valid) {
    return {
      valid: false,
      errors: normalizeErrors(ajv.errors as AjvValidationError[] | null),
      card: null,
    };
  }

  const data = raw as Record<string, any>;
  const card: AgentCardDTO = {
    schema_version: '1.0',
    agent_id: data.agent_id,
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
      webhook: data.endpoints.webhook,
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
      tools: data.capabilities.tools || undefined,
      models: data.capabilities.models || undefined,
      languages: data.capabilities.languages || undefined,
      input_formats: data.capabilities.input_formats || undefined,
      output_formats: data.capabilities.output_formats || undefined,
      max_concurrency: data.capabilities.max_concurrency,
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
    metadata: data.metadata,
    signature: data.signature,
    raw_json: data,
  };

  return { valid: true, errors: [], card };
}
