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
import { Delivery, DeliveryStatus } from '../../orders/entities/delivery.entity';
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
    @InjectRepository(Delivery)
    private readonly deliveriesRepository: Repository<Delivery>,
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
      this.getMyQuoteTool(),
      this.listMyOrdersTool(),
      this.getTaskStatusTool(),
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

  private firstStringArg(args: Args | undefined, keys: string[]) {
    for (const key of keys) {
      const value = this.stringArg(args, key);
      if (value) return value;
    }
    return undefined;
  }

  private firstNumberArg(args: Args, keys: string[], fallback?: number) {
    for (const key of keys) {
      const value = this.numberArg(args, key);
      if (value !== undefined) return value;
    }
    return fallback;
  }

  private error(code: string, message: string, details?: unknown, args?: Args): MCPResult {
    return {
      success: false,
      data: null,
      error: { code, message, details },
      request_id: this.stringArg(args, 'request_id') || null,
    };
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
    if (typeof value === 'string' && value.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed)
          ? parsed
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined;
      } catch {
        return undefined;
      }
    }
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

  private requireAnyString(args: Args, keys: string[]) {
    const value = this.firstStringArg(args, keys);
    if (!value) throw new BadRequestException(`${keys[0]} is required`);
    return value;
  }

  private requireAgentId(args: Args, ctx: MCPContext) {
    const argAgentId = this.firstStringArg(args, ['agentId', 'agent_id']);
    const ctxAgentId = ctx.agentId || undefined;
    const ctxExternalId = ctx.agentExternalId || undefined;
    if (argAgentId && ctxAgentId && argAgentId !== ctxAgentId && argAgentId !== ctxExternalId) {
      throw new BadRequestException('agentId must match X-SolForge-Agent-Id');
    }
    const agentId = ctxAgentId || argAgentId;
    if (!agentId) throw new BadRequestException('agentId is required');
    return agentId;
  }

  private responseAgentId(ctx: MCPContext, fallback: string) {
    return ctx.agentExternalId || ctx.agentId || fallback;
  }

  private async resolveOrderForAgentTask(params: {
    agentId: string;
    taskId: string;
  }) {
    const order = await this.ordersRepository.findOne({
      where: {
        task: { id: params.taskId },
        bid: { agent: { id: params.agentId } },
      },
      relations: ['task', 'bid', 'bid.agent', 'bid.agent.owner', 'owner', 'client'],
      order: { createdAt: 'DESC' },
    });
    if (!order) {
      throw new NotFoundException('Order not found for this task and agent');
    }
    return order;
  }

  private async bidCount(taskId: string) {
    return this.bidsRepository.count({ where: { task: { id: taskId } } });
  }

  private taskSkills(task: Partial<Task>) {
    return task.skillsRequired?.length ? task.skillsRequired : task.tags || [];
  }

  private mapTaskSummary(task: Task & { bidsCount?: number }) {
    return {
      taskId: task.id,
      title: task.title,
      description: task.description,
      skills: this.taskSkills(task),
      budgetCny: task.budgetCny,
      deadline: task.expectedDeliveryAt,
      employerRating: 5,
      bidCount: task.bidsCount ?? 0,
      postedAt: task.createdAt,
    };
  }

  private mapBidStatus(status?: string | null) {
    if (!status) return null;
    if (status === 'accepted') return 'ACCEPTED';
    if (status === 'submitted') return 'PENDING';
    return 'REJECTED';
  }

  private mapOrderStatus(order: Order, revisionRequested = false) {
    if (revisionRequested) return 'REVISION_REQUESTED';
    switch (order.status) {
      case OrderStatus.DELIVERED:
        return 'WAITING_ACCEPTANCE';
      case OrderStatus.PENDING_RELEASE:
      case OrderStatus.COMPLETED:
        return 'COMPLETED';
      case OrderStatus.CANCELED:
        return 'CANCELLED';
      case OrderStatus.REJECTED:
        return 'REVISION_REQUESTED';
      default:
        return 'IN_PROGRESS';
    }
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
          taskId: { type: 'string' },
          include_bids: { type: 'boolean', default: true },
          request_id: { type: 'string' },
        },
        required: [],
      },
      execute: async (args) => {
        const taskId = this.requireAnyString(args, ['taskId', 'task_id']);
        const task = await this.tasksService.findOne(taskId);
        if (!task) throw new NotFoundException('Task not found');
        const includeBids = args.include_bids !== false;
        const bids = includeBids ? await this.tasksService.findBids(taskId) : [];
        const attachments = (task.attachmentUrls || []).map((url, index) => ({
          name: `attachment-${index + 1}`,
          url,
          size: 0,
        }));
        return this.ok(
          {
            taskId: task.id,
            title: task.title,
            description: task.description,
            skills: this.taskSkills(task),
            budgetCny: task.budgetCny,
            deadline: task.expectedDeliveryAt,
            employerId: task.clientUserId || task.client?.id || null,
            employerRating: 5,
            bidCount: bids.length,
            postedAt: task.createdAt,
            status: task.status,
            attachments,
            task,
            bids,
          },
          args,
        );
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
          skills: { type: 'array', items: { type: 'string' } },
          page: { type: 'integer', default: 1 },
          pageSize: { type: 'integer', default: 20 },
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
        const pageSize = Math.min(
          this.firstNumberArg(args, ['pageSize', 'limit'], 20) || 20,
          50,
        );
        const explicitPage = this.numberArg(args, 'page');
        const offset = this.numberArg(args, 'offset', 0) || 0;
        const page = explicitPage || Math.floor(offset / pageSize) + 1;
        const skills =
          this.stringArrayArg(args, 'skills') ||
          this.stringArrayArg(filters, 'skills');
        const tags = this.stringArrayArg(filters, 'tags');
        const result = await this.tasksService.findMarketTasks({
          keyword: this.stringArg(filters, 'keyword'),
          minBudget: this.numberArg(filters, 'min_budget'),
          maxBudget: this.numberArg(filters, 'max_budget'),
          tags: skills ? undefined : tags,
          page,
          limit: pageSize,
        });
        const tasks = skills
          ? result.data.filter((task) => {
              const taskSkills = this.taskSkills(task).map((item) => item.toLowerCase());
              return skills.some((skill) => taskSkills.includes(skill.toLowerCase()));
            })
          : result.data;
        return this.ok(
          {
            tasks: tasks.map((task) => this.mapTaskSummary(task)),
            total: skills ? tasks.length : result.pagination.total,
            page,
            pageSize,
            data: result.data,
            pagination: result.pagination,
          },
          args,
        );
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
          taskId: { type: 'string' },
          task_id: { type: 'string' },
          phase: { type: 'string' },
          phase_id: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          progress: { type: 'integer', minimum: 0, maximum: 100 },
          message: { type: 'string' },
          metadata: { type: 'object' },
        },
        [],
      ),
      execute: async (args, ctx: MCPContext) => {
        const explicitOrderId = this.stringArg(args, 'order_id');
        const taskId = this.firstStringArg(args, ['taskId', 'task_id']);
        if (!explicitOrderId && !taskId) {
          throw new BadRequestException('order_id or taskId is required');
        }
        const agentId = taskId ? this.requireAgentId(args, ctx) : undefined;
        const order = explicitOrderId
          ? await this.ordersRepository.findOne({ where: { id: explicitOrderId } })
          : await this.resolveOrderForAgentTask({
              agentId: agentId as string,
              taskId: taskId as string,
            });
        if (!order) throw new NotFoundException('Order not found');

        const orderId = order.id;
        const status = (this.stringArg(args, 'status') || 'RUNNING').toUpperCase();
        const progress = Math.max(
          0,
          Math.min(100, this.numberArg(args, 'progress', status === 'COMPLETED' ? 100 : 0) || 0),
        );

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

        if (
          (status === 'RUNNING' || status === 'STARTED') &&
          order.status === OrderStatus.PENDING_PAYMENT
        ) {
          order.status = OrderStatus.IN_PROGRESS;
          await this.ordersRepository.save(order);
        }

        const execution = await this.executionService.getExecutionProgress(orderId);
        return this.ok({ orderId, progress, status, order, execution }, args);
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
          taskId: { type: 'string' },
          task_id: { type: 'string' },
          agentId: { type: 'string' },
          agent_id: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          type: { type: 'string' },
          description: { type: 'string' },
          previewUrl: { type: 'string', format: 'uri' },
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
          resultSummary: { type: 'string' },
          revision: { type: 'boolean' },
          evidence_bundle: { type: 'object' },
          commit_hash: { type: 'string' },
        },
        [],
      ),
      execute: async (args, ctx: MCPContext) => {
        const explicitOrderId = this.stringArg(args, 'order_id');
        const taskId = this.firstStringArg(args, ['taskId', 'task_id']);
        if (!explicitOrderId && !taskId) {
          throw new BadRequestException('order_id or taskId is required');
        }
        const agentId = taskId ? this.requireAgentId(args, ctx) : undefined;
        const order = explicitOrderId
          ? await this.ordersRepository.findOne({
              where: { id: explicitOrderId },
              relations: ['task', 'owner', 'bid', 'bid.agent', 'bid.agent.owner'],
            })
          : await this.resolveOrderForAgentTask({
              agentId: agentId as string,
              taskId: taskId as string,
            });
        if (!order) throw new NotFoundException('Order not found');
        const ownerUserId =
          order.ownerUserId || order.owner?.id || order.bid?.agent?.owner?.id;
        if (!ownerUserId) throw new BadRequestException('Order has no owner');

        const artifacts = Array.isArray(args.artifacts) ? [...args.artifacts] : [];
        const singleArtifactUrl = this.stringArg(args, 'url');
        if (singleArtifactUrl) {
          artifacts.push({
            url: singleArtifactUrl,
            type: this.stringArg(args, 'type'),
            description: this.stringArg(args, 'description'),
          });
        }
        const artifactUrls = artifacts
          .map((artifact) =>
            artifact && typeof artifact === 'object'
              ? (artifact as Record<string, unknown>).url
              : artifact,
          )
          .filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
        const previewUrl = this.stringArg(args, 'previewUrl');
        if (previewUrl) {
          artifactUrls.unshift(previewUrl);
        }
        const uniqueArtifactUrls = Array.from(new Set(artifactUrls));
        const deliverySummary =
          this.firstStringArg(args, ['resultSummary', 'delivery_summary']) ||
          'Artifacts attached by MCP';

        const result = await this.ordersService.deliver(order.id, ownerUserId, {
          deliverySummary,
          deliveryUrl: uniqueArtifactUrls[0],
          artifactUrls: uniqueArtifactUrls,
          evidenceBundle: {
            artifacts,
            revision: args.revision === true,
            ...(this.objectArg(args, 'evidence_bundle') || {}),
          },
          commitHash: this.stringArg(args, 'commit_hash'),
        });
        return this.ok(
          {
            accepted: true,
            taskId: order.task?.id || taskId || null,
            orderId: order.id,
            deliveryId: result.delivery?.id || null,
            artifactUrls: uniqueArtifactUrls,
            status: 'WAITING_ACCEPTANCE',
            ...result,
          },
          args,
        );
      },
    };
  }

  private submitQuoteTool(): IMCPTool {
    return {
      name: 'platform.quote.submit',
      description: 'Submit an Agent quote for an open task.',
      isWrite: true,
      inputSchema: this.writeToolBase(
        {
          task_id: { type: 'string', format: 'uuid' },
          taskId: { type: 'string' },
          agent_id: { type: 'string', format: 'uuid' },
          agentId: { type: 'string' },
          price: { type: 'number' },
          priceCny: { type: 'integer', minimum: 1 },
          plan_summary: { type: 'string' },
          planSummary: { type: 'string' },
          pricing_model: { type: 'string' },
          estimated_hours: { type: 'number' },
          estimatedHours: { type: 'number' },
          confidence_score: { type: 'number' },
          confidence: { type: 'number' },
          risk_notes: { type: 'string' },
        },
        [],
      ),
      execute: async (args, ctx: MCPContext) => {
        const taskId = this.requireAnyString(args, ['taskId', 'task_id']);
        const agentId = this.requireAgentId(args, ctx);
        const price = this.firstNumberArg(args, ['priceCny', 'price']);
        if (price === undefined || price <= 0) {
          throw new BadRequestException('priceCny must be greater than 0');
        }

        const existingBid = await this.bidsRepository.findOne({
          where: {
            task: { id: taskId },
            agent: { id: agentId },
          },
          relations: ['task', 'agent'],
        });
        if (existingBid) {
          return this.error(
            'DUPLICATE_BID',
            `Duplicate bid: Agent ${this.responseAgentId(ctx, agentId)} already bid on task ${taskId}`,
            {
              taskId,
              existingBidId: existingBid.id,
            },
            args,
          );
        }

        const bid = await this.bidsService.create({
          taskId,
          agentId,
          priceCny: price,
          planSummary: this.firstStringArg(args, ['planSummary', 'plan_summary']),
          pricingModel: this.stringArg(args, 'pricing_model') || 'quote',
          estimatedHours: this.firstNumberArg(args, ['estimatedHours', 'estimated_hours']),
          confidenceScore: this.firstNumberArg(args, ['confidence', 'confidence_score']),
          riskNotes: this.stringArg(args, 'risk_notes'),
        });
        return this.ok(
          {
            bidId: bid.id,
            taskId,
            agentId: this.responseAgentId(ctx, agentId),
            priceCny: bid.priceCny,
            status: this.mapBidStatus(bid.status),
            submittedAt: bid.createdAt,
            quote: bid,
          },
          args,
        );
      },
    };
  }

  private getMyQuoteTool(): IMCPTool {
    return {
      name: 'platform.quote.get_my',
      description: 'Get current HiClaw Agent quote status for a task.',
      isWrite: false,
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          task_id: { type: 'string' },
          request_id: { type: 'string' },
        },
      },
      execute: async (args, ctx: MCPContext) => {
        const taskId = this.requireAnyString(args, ['taskId', 'task_id']);
        const agentId = this.requireAgentId(args, ctx);
        const bid = await this.bidsRepository.findOne({
          where: {
            task: { id: taskId },
            agent: { id: agentId },
          },
          relations: ['task', 'agent'],
        });
        if (!bid) {
          return this.ok(
            {
              bidId: null,
              taskId,
              agentId: this.responseAgentId(ctx, agentId),
              status: null,
            },
            args,
          );
        }
        const order = await this.ordersRepository.findOne({
          where: {
            task: { id: taskId },
            bid: { agent: { id: agentId } },
          },
        });

        return this.ok(
          {
            bidId: bid.id,
            taskId,
            agentId: this.responseAgentId(ctx, agentId),
            priceCny: bid.priceCny,
            planSummary: bid.planSummary,
            status: this.mapBidStatus(bid.status),
            submittedAt: bid.createdAt,
            acceptedAt: bid.status === 'accepted' ? bid.updatedAt : null,
            orderId: order?.id || null,
          },
          args,
        );
      },
    };
  }

  private listMyOrdersTool(): IMCPTool {
    return {
      name: 'platform.order.list_my',
      description: 'List tasks accepted by the current HiClaw Agent.',
      isWrite: false,
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'array',
            items: { type: 'string', enum: ['in_progress', 'delivered', 'completed'] },
          },
          request_id: { type: 'string' },
        },
      },
      execute: async (args, ctx: MCPContext) => {
        const agentId = this.requireAgentId(args, ctx);
        const requested = this.stringArrayArg(args, 'status');
        const orders = await this.ordersRepository.find({
          where: { bid: { agent: { id: agentId } } },
          relations: ['task', 'bid', 'bid.agent'],
          order: { createdAt: 'DESC' },
        });
        const tasks = orders
          .map((order) => ({
            taskId: order.task?.id,
            title: order.task?.title,
            status: this.mapOrderStatus(order),
            bidStatus: this.mapBidStatus(order.bid?.status),
            bidPriceCny: order.bid?.priceCny,
            acceptedAt: order.createdAt,
            orderId: order.id,
          }))
          .filter((item) => this.matchesMyTaskFilter(item.status, requested));

        return this.ok({ tasks }, args);
      },
    };
  }

  private getTaskStatusTool(): IMCPTool {
    return {
      name: 'platform.task.get_status',
      description: 'Get acceptance or revision status for the current HiClaw Agent task.',
      isWrite: false,
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          task_id: { type: 'string' },
          request_id: { type: 'string' },
        },
      },
      execute: async (args, ctx: MCPContext) => {
        const taskId = this.requireAnyString(args, ['taskId', 'task_id']);
        const agentId = this.requireAgentId(args, ctx);
        const order = await this.resolveOrderForAgentTask({ agentId, taskId });
        const rejectedDelivery = await this.latestRejectedCurrentDelivery(order);
        const revisionRequested =
          order.status !== OrderStatus.COMPLETED &&
          order.status !== OrderStatus.PENDING_RELEASE &&
          Boolean(rejectedDelivery || order.disputeReason);
        const execution = await this.executionService.getExecutionProgress(order.id);
        const status = this.mapOrderStatus(order, revisionRequested);

        return this.ok(
          {
            taskId,
            status,
            hiclawStatus: status,
            progress: {
              phase: this.statusPhase(status),
              percent: status === 'COMPLETED' ? 100 : execution.totalProgress || 0,
            },
            completedAt:
              status === 'COMPLETED'
                ? order.releasedAt || order.acceptedAt || order.updatedAt
                : null,
            revisionReason: rejectedDelivery?.rejectionReason || order.disputeReason || undefined,
            revisionRequestedAt: rejectedDelivery?.rejectedAt || undefined,
            orderId: order.id,
          },
          args,
        );
      },
    };
  }

  private matchesMyTaskFilter(status: string, requested?: string[]) {
    if (!requested || requested.length === 0) return true;
    if (requested.includes('in_progress') && status === 'IN_PROGRESS') return true;
    if (
      requested.includes('delivered') &&
      ['DELIVERED', 'WAITING_ACCEPTANCE', 'REVISION_REQUESTED'].includes(status)
    ) {
      return true;
    }
    if (requested.includes('completed') && status === 'COMPLETED') return true;
    return false;
  }

  private async latestRejectedCurrentDelivery(order: Order) {
    if (order.status !== OrderStatus.IN_PROGRESS || !order.currentDeliveryId) {
      return null;
    }
    return this.deliveriesRepository.findOne({
      where: {
        id: order.currentDeliveryId,
        status: DeliveryStatus.REJECTED,
      },
      order: { rejectedAt: 'DESC' },
    });
  }

  private statusPhase(status: string) {
    if (status === 'COMPLETED') return '验收通过';
    if (status === 'REVISION_REQUESTED') return '等待修订';
    if (status === 'WAITING_ACCEPTANCE') return '等待验收';
    return '执行中';
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
