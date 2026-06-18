# WP-5: 碳硅交易平台 MCP Server — 实现方案

> 基于: carbon-silicon-platform-plan-final.md | 日期: 2026-06-18  
> 目标: 将碳硅交易平台封装为 MCP Server，供 HiClaw Controller 通过标准 JSON-RPC 协议查询和写入平台业务数据

---

## 1. MCP 协议概述

### 1.1 什么是 MCP

Model Context Protocol (MCP) 是 Anthropic 发布的开放标准，基于 JSON-RPC 2.0，定义了 AI 应用与外部工具/数据源之间的通信协议。

```
HiClaw Controller (MCP Client)
        │
        │ POST /mcp  (JSON-RPC 2.0)
        ▼
碳硅交易平台 MCP Server (NestJS 内置)
        │
        │ 调用内部 Service
        ▼
PostgreSQL (agents / tasks / orders / bids)
```

### 1.2 协议交互

```
Client                          Server
  │                               │
  │── tools/list ────────────────→│  查询可用工具列表
  │←─ { tools: [{name, schema}] }─│
  │                               │
  │── tools/call ────────────────→│  调用具体工具
  │   { name: "platform.agent.search", arguments: {...} }  │
  │←─ { result: { success, data } }─│
```

### 1.3 为什么用 MCP

| 对比 | REST API | MCP |
|------|----------|-----|
| 协议 | HTTP 自定义 | JSON-RPC 2.0 标准 |
| 发现 | Swagger 文档 | `tools/list` 自动发现 |
| 类型安全 | 手动定义 | JSON Schema 入参/出参 |
| 流式 | 需额外 SSE | 原生支持 streaming |
| HiClaw 兼容 | 需适配 | Controller 原生 MCP Client |

---

## 2. 架构设计

### 2.1 模块结构

```
backend/src/mcp/
├── mcp.module.ts                   ← 模块注册
├── mcp.controller.ts               ← POST /mcp 唯一入口
├── mcp.server.ts                   ← MCP Server 实例（协议处理）
├── mcp-auth.guard.ts               ← MCP Token 验证
├── mcp-idempotency.interceptor.ts  ← 幂等拦截器
├── mcp-audit.interceptor.ts        ← 审计拦截器
├── dto/
│   ├── mcp-request.dto.ts          ← 入参验证
│   └── mcp-response.dto.ts         ← 统一响应格式
├── tools/
│   ├── agent/
│   │   ├── search-agents.tool.ts   ← platform.agent.search
│   │   ├── get-agent.tool.ts       ← platform.agent.get
│   │   └── report-health.tool.ts   ← platform.agent.report_health
│   ├── task/
│   │   ├── get-task.tool.ts        ← platform.task.get
│   │   └── list-open-tasks.tool.ts ← platform.task.list_open
│   ├── order/
│   │   ├── create-order.tool.ts    ← platform.order.create
│   │   ├── get-order.tool.ts       ← platform.order.get
│   │   └── update-execution.tool.ts ← platform.order.update_execution
│   ├── artifact/
│   │   └── attach-artifact.tool.ts ← platform.artifact.attach
│   └── quote/
│       └── submit-quote.tool.ts    ← platform.quote.submit
└── registry/
    └── tool-registry.ts            ← 工具注册表（所有 Tool 集中注册）
```

### 2.2 请求流程

```
POST /mcp
  │
  ├─ ① MCPAuthGuard — 验证 Header: Authorization: Bearer <token>
  │     token = 环境变量 MCP_SERVER_TOKEN
  │
  ├─ ② MCPController — 解析 JSON-RPC 2.0 请求体
  │     { jsonrpc, method, params, id }
  │
  ├─ ③ ToolRegistry — 路由到对应 Tool
  │     method = "tools/list" → 返回所有注册工具的 schema
  │     method = "tools/call"  → 调用具体 Tool 的 execute()
  │
  ├─ ④ Tool.execute() — 执行业务逻辑
  │     调用 AgentsService / TasksService / OrdersService
  │
  ├─ ⑤ MCPIdempotencyInterceptor — 写操作检查幂等键
  │
  ├─ ⑥ MCPAuditInterceptor — 写入 mcp_tool_invocations 表
  │
  └─ ⑦ 返回 MCPResponseDto
       { jsonrpc: "2.0", result: { success, data, error, request_id }, id }
```

---

## 3. 核心代码设计

### 3.1 Tool 接口定义

```typescript
// registry/tool-registry.ts
export interface IMCPTool {
  name: string;                    // 工具名: "platform.agent.search"
  description: string;             // 描述
  inputSchema: JSONSchema;         // 入参 JSON Schema
  isWrite: boolean;                // 是否写操作（用于幂等判断）
  execute(args: any, ctx: MCPContext): Promise<MCPResult>;
}

export class ToolRegistry {
  private tools = new Map<string, IMCPTool>();

  register(tool: IMCPTool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): IMCPTool | undefined {
    return this.tools.get(name);
  }

  listTools(): Array<{ name: string; description: string; inputSchema: JSONSchema }> {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }
}
```

### 3.2 Tool 实现示例

```typescript
// tools/agent/search-agents.tool.ts
@Injectable()
export class SearchAgentsTool implements IMCPTool {
  name = 'platform.agent.search';
  description = '按能力、标签、健康状态搜索可用 Agent';
  isWrite = false;

  inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词（语义匹配）' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签筛选' },
      filters: {
        type: 'object',
        properties: {
          agent_type: { type: 'string', enum: ['hosted', 'external'] },
          pricing_model: { type: 'string', enum: ['fixed', 'hourly', 'token', 'quote'] },
          min_reputation: { type: 'number' },
        },
      },
      topK: { type: 'integer', default: 10 },
      request_id: { type: 'string' },
    },
    required: ['query'],
  };

  constructor(private readonly discoveryService: AgentDiscoveryService) {}

  async execute(args: any, ctx: MCPContext): Promise<MCPResult> {
    const agents = await this.discoveryService.search({
      query: args.query,
      tags: args.tags || [],
      filters: args.filters || {},
      topK: args.topK || 10,
    });

    return { success: true, data: { agents, total: agents.length }, error: null };
  }
}
```

```typescript
// tools/order/create-order.tool.ts
@Injectable()
export class CreateOrderTool implements IMCPTool {
  name = 'platform.order.create';
  description = '基于选中报价创建订单';
  isWrite = true;  // ← 写操作，需要幂等

  inputSchema = {
    type: 'object',
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      agent_id: { type: 'string', format: 'uuid' },
      bid_id: { type: 'string', format: 'uuid' },
      idempotency_key: { type: 'string' },
      request_id: { type: 'string' },
    },
    required: ['task_id', 'agent_id', 'bid_id', 'idempotency_key'],
  };

  constructor(private readonly tasksService: TasksService) {}

  async execute(args: any, ctx: MCPContext): Promise<MCPResult> {
    const order = await this.tasksService.selectBid(args.task_id, {
      bidId: args.bid_id,
      userId: ctx.caller,  // HiClaw Controller 标识
    });
    return { success: true, data: { order }, error: null };
  }
}
```

### 3.3 控制器

```typescript
// mcp.controller.ts
@Controller('mcp')
export class MCPController {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly idempotency: MCPIdempotencyService,
    private readonly audit: MCPAuditService,
  ) {}

  @Post()
  @UseGuards(MCPAuthGuard)
  async handle(@Body() body: MCPRequestDto): Promise<MCPResponseDto> {
    const startTime = Date.now();

    try {
      if (body.method === 'tools/list') {
        return this.buildResponse(body.id, {
          success: true,
          data: { tools: this.registry.listTools() },
          error: null,
        });
      }

      if (body.method === 'tools/call') {
        const { name, arguments: args } = body.params;
        const tool = this.registry.get(name);
        if (!tool) {
          return this.buildResponse(body.id, {
            success: false, data: null,
            error: { code: 'TOOL_NOT_FOUND', message: `Tool '${name}' not found` },
          });
        }

        // 写操作：幂等检查
        if (tool.isWrite && args?.idempotency_key) {
          const cached = await this.idempotency.check(args.idempotency_key);
          if (cached) {
            return this.buildResponse(body.id, { success: true, data: cached, error: null });
          }
        }

        const result = await tool.execute(args, { caller: 'hiclaw-controller' });

        // 审计记录
        const durationMs = Date.now() - startTime;
        await this.audit.record({
          toolName: name,
          caller: 'hiclaw-controller',
          requestId: args?.request_id,
          idempotencyKey: args?.idempotency_key,
          input: args,
          output: result,
          status: 'success',
          durationMs,
        });

        // 写操作：缓存结果
        if (tool.isWrite && args?.idempotency_key) {
          await this.idempotency.save(args.idempotency_key, result.data);
        }

        return this.buildResponse(body.id, result);
      }

      return this.buildResponse(body.id, {
        success: false, data: null,
        error: { code: 'INVALID_METHOD', message: `Unknown method: ${body.method}` },
      });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      await this.audit.record({
        toolName: body.params?.name || 'unknown',
        caller: 'hiclaw-controller',
        requestId: body.params?.arguments?.request_id,
        idempotencyKey: body.params?.arguments?.idempotency_key,
        input: body.params?.arguments,
        output: null,
        status: 'failed',
        errorMessage: (err as Error).message,
        durationMs,
      });

      return this.buildResponse(body.id, {
        success: false, data: null,
        error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
      });
    }
  }

  private buildResponse(id: string | number, result: MCPResult): MCPResponseDto {
    return { jsonrpc: '2.0', result, id };
  }
}
```

### 3.4 认证 Guard

```typescript
// mcp-auth.guard.ts
@Injectable()
export class MCPAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing MCP token');
    }
    const token = auth.slice('Bearer '.length);
    const expected = process.env.MCP_SERVER_TOKEN;
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Invalid MCP token');
    }
    return true;
  }
}
```

### 3.5 幂等服务

```typescript
// mcp-idempotency.service.ts
@Injectable()
export class MCPIdempotencyService {
  private cache = new Map<string, { data: any; ts: number }>();
  private readonly TTL = 24 * 60 * 60 * 1000; // 24小时

  async check(key: string): Promise<any | null> {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.ts < this.TTL) {
      return entry.data;
    }
    // 也查数据库
    const db = await this.repo.findOne({ where: { idempotencyKey: key } });
    return db?.output_json ?? null;
  }

  async save(key: string, data: any): Promise<void> {
    this.cache.set(key, { data, ts: Date.now() });
  }
}
```

---

## 4. MCP Tools 完整清单

### 4.1 Agent 域

| Tool | 类型 | 入参 | 出参 |
|------|------|------|------|
| `platform.agent.search` | 读 | query, tags[], filters{}, topK | Agent[], total |
| `platform.agent.get` | 读 | agent_id | AgentCard 完整信息 |
| `platform.agent.report_health` | 写 | agent_id, status, latency_ms, load | void |

### 4.2 Task 域

| Tool | 类型 | 入参 | 出参 |
|------|------|------|------|
| `platform.task.get` | 读 | task_id | Task 详情（含验收标准、附件） |
| `platform.task.list_open` | 读 | limit, offset, filters{} | Task[], pagination |

### 4.3 Order 域

| Tool | 类型 | 入参 | 出参 |
|------|------|------|------|
| `platform.order.create` | 写 ✅ | task_id, agent_id, bid_id, idempotency_key | Order |
| `platform.order.get` | 读 | order_id | Order 完整信息 |
| `platform.order.update_execution` | 写 ✅ | order_id, phase, status, progress, idempotency_key | Order |

### 4.4 Artifact 域

| Tool | 类型 | 入参 | 出参 |
|------|------|------|------|
| `platform.artifact.attach` | 写 ✅ | order_id, artifacts[], idempotency_key | Artifact[] |

### 4.5 Quote 域

| Tool | 类型 | 入参 | 出参 |
|------|------|------|------|
| `platform.quote.submit` | 写 ✅ | task_id, agent_id, price, plan_summary, idempotency_key | Quote |

---

## 5. 错误码

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `TOOL_NOT_FOUND` | 400 | 工具名不存在 |
| `INVALID_METHOD` | 400 | 未知 JSON-RPC 方法 |
| `VALIDATION_ERROR` | 400 | 入参不符合 JSON Schema |
| `AUTH_FAILED` | 401 | MCP Token 无效 |
| `AGENT_NOT_FOUND` | 404 | Agent 不存在 |
| `AGENT_OFFLINE` | 400 | Agent 已离线 |
| `TASK_NOT_FOUND` | 404 | 任务不存在 |
| `ORDER_NOT_FOUND` | 404 | 订单不存在 |
| `DUPLICATE_REQUEST` | 409 | 重复请求 |
| `INTERNAL_ERROR` | 500 | 服务内部错误 |

---

## 6. 环境变量

```bash
# MCP Server 配置
MCP_SERVER_TOKEN=hiclaw-mcp-secret-token-change-in-production
# HiClaw Controller 使用此 Token 调用 MCP
```

---

## 7. 实施任务

### Day 1 — 框架搭建 + 读 Tools

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| 1 | 安装 `@modelcontextprotocol/sdk` | `package.json` | 0.5h |
| 2 | 创建 `MCPModule` + `MCPController` | `mcp.module.ts` / `mcp.controller.ts` | 1.5h |
| 3 | 实现 `ToolRegistry` + `IMCPTool` 接口 | `tool-registry.ts` | 1h |
| 4 | 实现 `MCPAuthGuard` | `mcp-auth.guard.ts` | 0.5h |
| 5 | 实现 `MCPIdempotencyService` | `mcp-idempotency.service.ts` | 1h |
| 6 | 实现 `MCPAuditService` + DTO | `mcp-audit.service.ts` / dto | 1h |
| 7 | 实现 5 个读 Tool: `search` `get agent` `get task` `list_open` `get order` | `tools/` | 2h |

### Day 2 — 写 Tools + 测试

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| 8 | 实现 5 个写 Tool: `create_order` `update_execution` `attach_artifact` `submit_quote` `report_health` | `tools/` | 3h |
| 9 | 幂等逻辑全覆盖 + 数据库写入测试 | `mcp-idempotency.service.ts` | 1h |
| 10 | 审计日志验证 | `mcp-audit.service.ts` | 0.5h |
| 11 | MCP Client 模拟测试（curl / Postman） | — | 1.5h |

---

## 8. 测试脚本

```bash
# 1. 查看可用工具
curl -X POST http://localhost:4000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer hiclaw-mcp-secret" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":"1"}'

# 2. 搜索 Agent
curl -X POST http://localhost:4000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer hiclaw-mcp-secret" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"platform.agent.search","arguments":{"query":"python 爬虫","tags":["paid"],"topK":5,"request_id":"req-001"}},"id":"2"}'

# 3. 创建订单（写操作，带幂等键）
curl -X POST http://localhost:4000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer hiclaw-mcp-secret" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"platform.order.create","arguments":{"task_id":"uuid","agent_id":"uuid","bid_id":"uuid","idempotency_key":"hiclaw_order_001","request_id":"req-002"}},"id":"3"}'
```

---

## 9. 验收标准

- [ ] MCP Server 启动在 `POST /mcp`
- [ ] `tools/list` 返回所有 10 个 Tool 的 schema
- [ ] 5 个读 Tool 可正常查询数据
- [ ] 5 个写 Tool 可正常写入 + 幂等保护生效
- [ ] MCPAuthGuard 拒绝无 Token 请求
- [ ] 所有调用写入 `mcp_tool_invocations` 表
- [ ] 重复请求（相同 idempotency_key）返回已缓存结果
- [ ] HiClaw Controller 可成功调用所有 Tool
