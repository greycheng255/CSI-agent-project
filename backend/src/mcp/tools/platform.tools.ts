import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentsDiscoveryService } from '../../agents/agents-discovery.service';
import { AgentsHealthService } from '../../agents/agents-health.service';
import { Agent } from '../../agents/entities/agent.entity';
import { Bid } from '../../bids/entities/bid.entity';
import { BidsService } from '../../bids/bids.service';
import { ExecutionService } from '../../execution/execution.service';
import { ExecutionPhase } from '../../execution/entities';
import { Order, OrderStatus } from '../../orders/entities/order.entity';
import { OrdersService } from '../../orders/orders.service';
import { Task } from '../../tasks/entities/task.entity';
import { TasksService } from '../../tasks/tasks.service';
import { IMCPTool, MCPContext } from '../mcp.types';
import { MCPResult } from '../dto/mcp-response.dto';

type Args = Record<string, unknown>;

@Injectable()
export class MCPToolsProvider {
  constructor(
    private readonly agentsDiscoveryService: AgentsDiscoveryService,
    private readonly agentsHealthService: AgentsHealthService,
    private readonly tasksService: TasksService,
    private readonly ordersService: OrdersService,
    private readonly bidsService: BidsService,
    private readonly executionService: ExecutionService,
    @InjectRepository(Agent)
    private readonly agentsRepository: Repository<Agent>,
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectRepository(Bid)
    private readonly bidsRepository: Repository<Bid>,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(ExecutionPhase)
    private readonly phasesRepository: Repository<ExecutionPhase>,
  ) {}

  getTools(): IMCPTool[] {
    return [
      this.searchAgentsTool(),
      this.getAgentTool(),
      this.reportHealthTool(),
      this.getTaskTool(),
      this.listOpenTasksTool(),
      this.createOrderTool(),
      this.getOrderTool(),
      this.updateExecutionTool(),
      this.attachArtifactTool(),
      this.submitQuoteTool(),
    ];
  }

  private ok(data: unknown, args?: Args): MCPResult {
    return {
      success: true,
      data,
      error: null,
      request_id: this.stringArg(args, 'request_id') || null,
    };
  }

  private stringArg(args: Args | undefined, key: string) {
    const value = args?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private numberArg(args: Args, key: string, fallback?: number) {
    const value = args[key];
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private stringArrayArg(args: Args, key: string) {
    const value = args[key];
    if (!Array.isArray(value)) return undefined;
    const normalized = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  }

  private objectArg(args: Args, key: string) {
    const value = args[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private requireString(args: Args, key: string) {
    const value = this.stringArg(args, key);
    if (!value) throw new BadRequestException(`${key} is required`);
    return value;
  }

  private writeToolBase(properties: Record<string, unknown>, required: string[]) {
    return {
      type: 'object',
      properties: {
        ...properties,
        idempotency_key: {
          type: 'string',
          description: 'Write idempotency key. Format recommendation: caller_uuid.',
        },
        request_id: { type: 'string' },
      },
      required: [...required, 'idempotency_key'],
    };
  }

  private searchAgentsTool(): IMCPTool {
    return {
      name: 'platform.agent.search',
      description: 'Search discoverable Agents by keyword, tags, capabilities, and health.',
      isWrite: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          filters: {
            type: 'object',
            properties: {
              skills: { type: 'array', items: { type: 'string' } },
              domains: { type: 'array', items: { type: 'string' } },
              runtime_status: { type: 'string', enum: ['online', 'degraded'] },
            },
          },
          topK: { type: 'integer', default: 10 },
          request_id: { type: 'string' },
        },
      },
      execute: async (args) => {
        const filters = this.objectArg(args, 'filters') || {};
        const result = await this.agentsDiscoveryService.discover({
          query: this.stringArg(args, 'query'),
          tags: this.stringArrayArg(args, 'tags'),
          skills: this.stringArrayArg(filters, 'skills'),
          domains: this.stringArrayArg(filters, 'domains'),
          runtimeStatus: this.stringArg(filters, 'runtime_status'),
          limit: Math.min(this.numberArg(args, 'topK', 10) || 10, 50),
          offset: 0,
        });
        return this.ok({ agents: result.items, total: result.total }, args);
      },
    };
  }

  private getAgentTool(): IMCPTool {
    return {
      name: 'platform.agent.get',
      description: 'Get an Agent card, capabilities, tags, and runtime status.',
      isWrite: false,
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', format: 'uuid' },
          request_id: { type: 'string' },
        },
        required: ['agent_id'],
      },
      execute: async (args) => {
        const agentId = this.requireString(args, 'agent_id');
        const agent = await this.agentsRepository.findOne({
          where: { id: agentId },
          relations: ['cards', 'capabilities', 'tags', 'owner'],
        });
        if (!agent) throw new NotFoundException('Agent not found');
        const activeCard = agent.cards?.find((card) => card.isActive);
        return this.ok({ agent, card: activeCard?.cardJson || null }, args);
      },
    };
  }

  private reportHealthTool(): IMCPTool {
    return {
      name: 'platform.agent.report_health',
      description: 'Report Agent runtime health from HiClaw Controller or Agent gateway.',
      isWrite: true,
      inputSchema: this.writeToolBase(
        {
          agent_id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['online', 'degraded', 'offline'] },
          latency_ms: { type: 'integer' },
          load: { type: 'number' },
          metadata: { type: 'object' },
        },
        ['agent_id'],
      ),
      execute: async (args) => {
        const result = await this.agentsHealthService.recordHeartbeat(
          this.requireString(args, 'agent_id'),
          {
            status: this.stringArg(args, 'status'),
            latencyMs: this.numberArg(args, 'latency_ms'),
            load: this.numberArg(args, 'load'),
            metadata: this.objectArg(args, 'metadata'),
          },
        );
        return this.ok(result, args);
      },
    };
  }

  private getTaskTool(): IMCPTool {
    return {
      name: 'platform.task.get',
      description: 'Get task details, bids, acceptance criteria, and attachments.',
      isWrite: false,
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', format: 'uuid' },
          include_bids: { type: 'boolean', default: true },
          request_id: { type: 'string' },
        },
        required: ['task_id'],
      },
      execute: async (args) => {
        const taskId = this.requireString(args, 'task_id');
        const task = await this.tasksService.findOne(taskId);
        if (!task) throw new NotFoundException('Task not found');
        const includeBids = args.include_bids !== false;
        const bids = includeBids ? await this.tasksService.findBids(taskId) : [];
        return this.ok({ task, bids }, args);
      },
    };
  }

  private listOpenTasksTool(): IMCPTool {
    return {
      name: 'platform.task.list_open',
      description: 'List open marketplace tasks.',
      isWrite: false,
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 20 },
          offset: { type: 'integer', default: 0 },
          filters: {
            type: 'object',
            properties: {
              keyword: { type: 'string' },
              min_budget: { type: 'number' },
              max_budget: { type: 'number' },
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
          request_id: { type: 'string' },
        },
      },
      execute: async (args) => {
        const filters = this.objectArg(args, 'filters') || {};
        const limit = Math.min(this.numberArg(args, 'limit', 20) || 20, 100);
        const offset = this.numberArg(args, 'offset', 0) || 0;
        const page = Math.floor(offset / limit) + 1;
        const result = await this.tasksService.findMarketTasks({
          keyword: this.stringArg(filters, 'keyword'),
          minBudget: this.numberArg(filters, 'min_budget'),
          maxBudget: this.numberArg(filters, 'max_budget'),
          tags: this.stringArrayArg(filters, 'tags'),
          page,
          limit,
        });
        return this.ok(result, args);
      },
    };
  }

  private createOrderTool(): IMCPTool {
    return {
      name: 'platform.order.create',
      description: 'Create an order from a selected bid.',
      isWrite: true,
      inputSchema: this.writeToolBase(
        {
          task_id: { type: 'string', format: 'uuid' },
          agent_id: { type: 'string', format: 'uuid' },
          bid_id: { type: 'string', format: 'uuid' },
          user_id: { type: 'string', format: 'uuid' },
        },
        ['task_id', 'agent_id', 'bid_id'],
      ),
      execute: async (args) => {
        const taskId = this.requireString(args, 'task_id');
        const bidId = this.requireString(args, 'bid_id');
        const agentId = this.requireString(args, 'agent_id');

        const bid = await this.bidsRepository.findOne({
          where: { id: bidId },
          relations: ['agent'],
        });
        if (!bid) throw new NotFoundException('Bid not found');
        if (bid.agent?.id !== agentId) {
          throw new BadRequestException('Bid does not belong to this agent');
        }

        const task = await this.tasksRepository.findOne({
          where: { id: taskId },
          relations: ['client'],
        });
        if (!task) throw new NotFoundException('Task not found');

        const userId =
          this.stringArg(args, 'user_id') || task.clientUserId || task.client?.id;
        if (!userId) throw new BadRequestException('Task has no publisher');

        const order = await this.tasksService.selectBid(taskId, { bidId, userId });
        return this.ok({ order }, args);
      },
    };
  }

  private getOrderTool(): IMCPTool {
    return {
      name: 'platform.order.get',
      description: 'Get order details, execution snapshot, delivery history, and checklist stats.',
      isWrite: false,
      inputSchema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', format: 'uuid' },
          request_id: { type: 'string' },
        },
        required: ['order_id'],
      },
      execute: async (args) => {
        const order = await this.ordersService.findOne(
          this.requireString(args, 'order_id'),
        );
        return this.ok({ order }, args);
      },
    };
  }

  private updateExecutionTool(): IMCPTool {
    return {
      name: 'platform.order.update_execution',
      description: 'Report order execution phase/status/progress from HiClaw Controller.',
      isWrite: true,
      inputSchema: this.writeToolBase(
        {
          order_id: { type: 'string', format: 'uuid' },
          phase: { type: 'string' },
          phase_id: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          progress: { type: 'integer', minimum: 0, maximum: 100 },
          message: { type: 'string' },
          metadata: { type: 'object' },
        },
        ['order_id', 'status'],
      ),
      execute: async (args, ctx: MCPContext) => {
        const orderId = this.requireString(args, 'order_id');
        const status = this.requireString(args, 'status').toUpperCase();
        const progress = Math.max(
          0,
          Math.min(100, this.numberArg(args, 'progress', status === 'COMPLETED' ? 100 : 0) || 0),
        );

        const order = await this.ordersRepository.findOne({ where: { id: orderId } });
        if (!order) throw new NotFoundException('Order not found');

        const phaseId = await this.resolvePhaseId(orderId, args);
        await this.executionService.reportProgress({
          orderId,
          phaseId,
          progress,
          event: this.toExecutionEvent(status),
          message: this.stringArg(args, 'message') || `MCP execution status: ${status}`,
          metadata: {
            ...(this.objectArg(args, 'metadata') || {}),
            mcpRequestId: ctx.requestId,
          },
          reportedBy: ctx.caller,
          componentType: 'HICLAW',
        });

        if (status === 'RUNNING' && order.status === OrderStatus.PENDING_PAYMENT) {
          order.status = OrderStatus.IN_PROGRESS;
          await this.ordersRepository.save(order);
        }

        const execution = await this.executionService.getExecutionProgress(orderId);
        return this.ok({ order, execution }, args);
      },
    };
  }

  private attachArtifactTool(): IMCPTool {
    return {
      name: 'platform.artifact.attach',
      description: 'Attach delivery artifacts to an order.',
      isWrite: true,
      inputSchema: this.writeToolBase(
        {
          order_id: { type: 'string', format: 'uuid' },
          artifacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                name: { type: 'string' },
                type: { type: 'string' },
              },
            },
          },
          delivery_summary: { type: 'string' },
          evidence_bundle: { type: 'object' },
          commit_hash: { type: 'string' },
        },
        ['order_id', 'artifacts'],
      ),
      execute: async (args) => {
        const orderId = this.requireString(args, 'order_id');
        const order = await this.ordersRepository.findOne({
          where: { id: orderId },
          relations: ['owner', 'bid', 'bid.agent', 'bid.agent.owner'],
        });
        if (!order) throw new NotFoundException('Order not found');
        const ownerUserId =
          order.ownerUserId || order.owner?.id || order.bid?.agent?.owner?.id;
        if (!ownerUserId) throw new BadRequestException('Order has no owner');

        const artifacts = Array.isArray(args.artifacts) ? args.artifacts : [];
        const artifactUrls = artifacts
          .map((artifact) =>
            artifact && typeof artifact === 'object'
              ? (artifact as Record<string, unknown>).url
              : artifact,
          )
          .filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
        if (artifactUrls.length === 0) {
          throw new BadRequestException('artifacts must include at least one url');
        }

        const result = await this.ordersService.deliver(orderId, ownerUserId, {
          deliverySummary:
            this.stringArg(args, 'delivery_summary') || 'Artifacts attached by MCP',
          deliveryUrl: artifactUrls[0],
          artifactUrls,
          evidenceBundle: {
            artifacts,
            ...(this.objectArg(args, 'evidence_bundle') || {}),
          },
          commitHash: this.stringArg(args, 'commit_hash'),
        });
        return this.ok(result, args);
      },
    };
  }

  private submitQuoteTool(): IMCPTool {
    return {
      name: 'platform.quote.submit',
      description: 'Submit or update an Agent quote for an open task.',
      isWrite: true,
      inputSchema: this.writeToolBase(
        {
          task_id: { type: 'string', format: 'uuid' },
          agent_id: { type: 'string', format: 'uuid' },
          price: { type: 'number' },
          plan_summary: { type: 'string' },
          pricing_model: { type: 'string' },
          estimated_hours: { type: 'number' },
          confidence_score: { type: 'number' },
          risk_notes: { type: 'string' },
        },
        ['task_id', 'agent_id', 'price'],
      ),
      execute: async (args) => {
        const price = this.numberArg(args, 'price');
        if (price === undefined || price <= 0) {
          throw new BadRequestException('price must be greater than 0');
        }
        const bid = await this.bidsService.create({
          taskId: this.requireString(args, 'task_id'),
          agentId: this.requireString(args, 'agent_id'),
          priceCny: price,
          planSummary: this.stringArg(args, 'plan_summary'),
          pricingModel: this.stringArg(args, 'pricing_model') || 'quote',
          estimatedHours: this.numberArg(args, 'estimated_hours'),
          confidenceScore: this.numberArg(args, 'confidence_score'),
          riskNotes: this.stringArg(args, 'risk_notes'),
        });
        return this.ok({ quote: bid }, args);
      },
    };
  }

  private async resolvePhaseId(orderId: string, args: Args) {
    const explicitPhaseId = this.stringArg(args, 'phase_id');
    if (explicitPhaseId) return explicitPhaseId;

    const phase = this.stringArg(args, 'phase');
    if (!phase) return undefined;

    const found = await this.phasesRepository.findOne({
      where: { orderId, phaseKey: phase },
    });
    return found?.id;
  }

  private toExecutionEvent(status: string) {
    if (status === 'COMPLETED') return 'COMPLETED';
    if (status === 'FAILED') return 'FAILED';
    if (status === 'RUNNING' || status === 'STARTED') return 'STARTED';
    return 'PROGRESS';
  }
}
