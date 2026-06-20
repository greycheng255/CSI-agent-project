import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { createHash } from 'crypto';
import { Agent } from './entities/agent.entity';
import { AgentCard } from './entities/agent-card.entity';
import { AgentCapability } from './entities/agent-capability.entity';
import { AgentTag } from './entities/agent-tag.entity';
import {
  AgentCardDTO,
  validateAgentCard,
} from './schemas/agent-card.schema';

export type AgentCardJson = {
  schema_version?: string;
  agent_id?: string;
  name?: string;
  description?: string;
  version?: string;
  agent_type?: string;
  provider?: {
    owner?: string;
    contact_email?: string;
    homepage?: string;
  };
  endpoints?: {
    task?: string;
    webhook?: string;
    health?: string;
    callback?: string;
  };
  auth?: {
    type?: string;
    key_id?: string;
  };
  capabilities?: {
    domains?: string[];
    skills?: Array<string | { name?: string; proficiency?: string }>;
    tools?: string[];
    models?: string[];
    languages?: string[];
    input_formats?: string[];
    output_formats?: string[];
    max_concurrency?: number;
  };
  pricing?: {
    model?: string;
    currency?: string;
    minimum_price?: number;
  };
  metadata?: {
    tags?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

@Injectable()
export class AgentCardService {
  constructor(
    @InjectRepository(AgentCard)
    private readonly agentCardsRepository: Repository<AgentCard>,
    @InjectRepository(AgentCapability)
    private readonly capabilitiesRepository: Repository<AgentCapability>,
    @InjectRepository(AgentTag)
    private readonly tagsRepository: Repository<AgentTag>,
    private readonly httpService: HttpService,
  ) {}

  async fetchCard(cardUrl: string): Promise<AgentCardJson> {
    const response = await firstValueFrom(
      this.httpService.get(cardUrl, {
        timeout: Number(process.env.AGENT_CARD_FETCH_TIMEOUT_MS || 10000),
      }),
    );
    if (!response.data || typeof response.data !== 'object') {
      throw new BadRequestException('Agent Card URL must return JSON');
    }
    return response.data as AgentCardJson;
  }

  async fetchAndValidate(
    cardUrl: string,
    options?: { verifyHealth?: boolean },
  ): Promise<AgentCardDTO> {
    const card = this.validate(await this.fetchCard(cardUrl));
    if (options?.verifyHealth !== false) {
      const healthy = await this.verifyHealthEndpoint(card.endpoints.health);
      if (!healthy) {
        throw new BadRequestException('Agent Card health endpoint is unreachable');
      }
    }
    return card;
  }

  async verifyHealthEndpoint(healthUrl: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(healthUrl, { timeout: 5000 }),
      );
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  validate(card: AgentCardJson): AgentCardDTO {
    const result = validateAgentCard(card);
    if (!result.valid || !result.card) {
      throw new BadRequestException(
        `Agent Card validation failed: ${result.errors.join('; ')}`,
      );
    }
    return result.card;
  }

  async saveActiveCard(params: {
    agent: Agent;
    card: AgentCardJson;
    source: 'platform' | 'remote_fetch' | 'manual';
    fetchedAt?: Date | null;
  }) {
    const normalized = this.validate(params.card);

    await this.agentCardsRepository.update(
      { agent: { id: params.agent.id }, isActive: true },
      { isActive: false },
    );

    const contentHash = createHash('sha256')
      .update(JSON.stringify(normalized.raw_json || normalized))
      .digest('hex');

    return this.agentCardsRepository.save(
      this.agentCardsRepository.create({
        agent: params.agent,
        schemaVersion: normalized.schema_version,
        version: normalized.version,
        cardJson: (normalized.raw_json || normalized) as Record<string, unknown>,
        contentHash,
        signature:
          typeof normalized.signature === 'string'
            ? normalized.signature
            : null,
        source: params.source,
        isActive: true,
        fetchedAt: params.fetchedAt ?? null,
      }),
    );
  }

  async replaceExtractedMetadata(agent: Agent, card: AgentCardJson) {
    await this.capabilitiesRepository.delete({ agent: { id: agent.id } });
    await this.tagsRepository.delete({ agent: { id: agent.id } });

    const capabilities: AgentCapability[] = [];
    const addCapability = (
      capabilityType: string,
      name: string,
      value: Record<string, unknown> | null = null,
    ) => {
      if (!name) return;
      capabilities.push(
        this.capabilitiesRepository.create({
          agent,
          capabilityType,
          name,
          value,
        }),
      );
    };

    for (const domain of card.capabilities?.domains || []) {
      addCapability('domain', domain);
    }
    for (const skill of card.capabilities?.skills || []) {
      if (typeof skill === 'string') {
        addCapability('skill', skill);
      } else if (skill.name) {
        addCapability('skill', skill.name, skill as Record<string, unknown>);
      }
    }
    for (const tool of card.capabilities?.tools || []) addCapability('tool', tool);
    for (const model of card.capabilities?.models || [])
      addCapability('model', model);
    for (const language of card.capabilities?.languages || [])
      addCapability('language', language);
    for (const format of card.capabilities?.input_formats || [])
      addCapability('input_format', format);
    for (const format of card.capabilities?.output_formats || [])
      addCapability('output_format', format);

    if (capabilities.length > 0) {
      await this.capabilitiesRepository.save(capabilities);
    }

    const tags = new Map<string, 'domain' | 'custom' | 'pricing' | 'source'>();
    for (const domain of card.capabilities?.domains || []) tags.set(domain, 'domain');
    for (const tag of card.metadata?.tags || []) tags.set(tag, 'custom');
    if (card.pricing?.model) tags.set(card.pricing.model, 'pricing');
    if (card.agent_type) tags.set(card.agent_type, 'source');

    if (tags.size > 0) {
      await this.tagsRepository.save(
        Array.from(tags.entries()).map(([tag, tagType]) =>
          this.tagsRepository.create({ agent, tag, tagType }),
        ),
      );
    }
  }

  buildPlatformCard(input: {
    name: string;
    description?: string;
    version?: string;
    agentType?: string;
    endpointUrl?: string;
    webhookUrl?: string;
    healthUrl?: string;
    authType?: string;
    domains?: string[];
    skills?: string[];
    pricingModel?: string;
    currency?: string;
    minimumPrice?: number;
    tags?: string[];
  }): AgentCardJson {
    return {
      schema_version: '1.0',
      name: input.name,
      description: input.description || input.name,
      version: input.version || '1.0.0',
      agent_type: input.agentType || 'platform-managed',
      endpoints: {
        task: input.endpointUrl || input.webhookUrl || 'http://localhost/agent',
        webhook: input.webhookUrl,
        health: input.healthUrl || input.endpointUrl || input.webhookUrl || 'http://localhost/health',
      },
      auth: {
        type: input.authType || 'bearer',
      },
      capabilities: {
        domains: input.domains?.length ? input.domains : ['general'],
        skills: input.skills?.length ? input.skills : ['general'],
      },
      pricing: {
        model: input.pricingModel || 'quote',
        currency: input.currency || 'CNY',
        minimum_price: input.minimumPrice || 0,
      },
      metadata: {
        tags: input.tags || [],
      },
    };
  }
}
