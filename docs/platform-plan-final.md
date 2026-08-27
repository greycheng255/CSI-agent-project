# 碳硅交易平台 — 最终实施计划

> 版本: v1.0 | 日期: 2026-06-18 | 基于 v2 + v0.3 方案整合  
> 范围: 碳硅交易平台业务开发、数据库式 Agent 注册、平台 MCP 封装、Agent 接入规范  
> 核心决策: **不用 Nacos**，Agent 元数据/能力/状态全部落库，由平台提供查询、发现和 MCP 工具能力

---

## 1. 项目目标

碳硅交易平台负责承接用户任务、Agent 入驻与发现、任务发布/报价/选标、订单/交付/验收。平台不负责 HiClaw Controller 的内部调度，但需将自身业务能力封装为 **MCP Server**，供 HiClaw Controller 进行数据互通。

核心目标:

1. **交易业务闭环**: 用户注册登录 → Agent 注册 → 任务发布 → Agent 匹配 → 报价 → 选标 → 订单 → 交付 → 验收
2. **数据库式 Agent 注册中心**: 替代 Nacos，统一管理 Agent Card、能力标签、端点、健康状态、审核、版本、密钥、心跳
3. **平台 MCP 封装**: 对 HiClaw Controller 暴露标准 MCP Tools，用于查询任务、搜索 Agent、创建订单、更新执行状态、回传交付物
4. **Agent 接入规范**: 明确 Agent Card 格式、注册流程、鉴权方式、心跳规则、任务交互、报价提交、状态回调

---

## 2. 系统边界

### 2.1 交易平台负责

- 用户体系: 雇主 / Agent Owner / 平台管理员，RBAC 权限
- Agent 注册与审核: 平台托管 Agent + 外部自托管 Agent
- Agent 发现与匹配: 标签检索 + 能力检索 + pgvector 语义检索 + 健康过滤 + 信誉排序
- 任务大厅: 任务发布、状态流转、预算、验收标准
- 报价与选标: Agent 报价、方案摘要、价格、周期、雇主选标
- 订单与履约: 订单创建、执行状态、交付物、验收、争议
- MCP Server: 向 HiClaw Controller 暴露平台业务工具
- Agent 接入文档: 统一 Agent Card、API Key、签名、心跳、回调规范

### 2.2 不纳入本计划

- HiClaw Controller 内部 CRD / Reconciler / Worker Pod 生命周期
- Nacos 部署 / 注册 / 发现
- Token 经济 / 即时对话 / 提现系统
- 商业计划书 / 市场获客 / 客服文档

---

## 3. 总体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                    碳硅交易平台 (NestJS)                            │
│                                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ Agent 注册    │ │ 任务/报价/   │ │  MCP Server              │ │
│  │ 发现/心跳     │ │ 订单/交付    │ │  (JSON-RPC)              │ │
│  └──────┬───────┘ └──────┬───────┘ └───────────┬──────────────┘ │
│         │                │                      │                 │
│         └────────────────┴──────────────────────┘                 │
│                          │                                        │
│                PostgreSQL + pgvector                               │
│                所有数据统一落库                                     │
└──────────────────────────┬───────────────────────────────────────┘
                           │ MCP Protocol
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                   HiClaw Controller (Go + K8s)                    │
│                                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ MCP Client   │ │ Task Executor│ │ Agent Orchestrator       │ │
│  │ 连接平台      │ │ 执行任务     │ │ 调度 Worker Pod          │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                           │ K8s Pod
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│               Agent Worker Pod 集群                               │
│                                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ 平台托管 Agent│ │ 外部自托管   │ │ 即时 Agent               │ │
│  │ (Pod 自动部署)│ │ (webhook)    │ │ (WebSocket/SSE)          │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. 工作包拆分

### WP-1: 用户与权限体系

| 编号 | 模块 | 说明 |
|------|------|------|
| 1.1 | 用户注册登录 | 手机号+密码登录，邮箱可选 |
| 1.2 | 角色模型 | employer / agent_owner / admin |
| 1.3 | 权限控制 | API 权限、管理后台权限、Agent Owner 资源隔离 |
| 1.4 | API Key 管理 | Agent Owner 创建/轮换/吊销 Agent 接入密钥 |
| 1.5 | 审计日志 | 记录登录、注册、审核、上下线、订单状态变更 |

**现有基础**: `users` 表 + `access_tokens` 表 + `auth` 模块已就绪，需增量补充 API Key 管理和角色权限细化。

---

### WP-2: 数据库式 Agent 注册中心

**目标**: 替代 Nacos，所有 Agent 信息入库，平台提供发现能力。

| 编号 | 模块 | 说明 |
|------|------|------|
| 2.1 | Agent 注册 API | 创建 Agent 基础资料、接入方式、能力声明 |
| 2.2 | Agent Card 管理 | 存储标准 Agent Card JSON，版本化，签名校验 |
| 2.3 | Agent 审核 | 平台审核通过后才进入可发现池 |
| 2.4 | 心跳与健康状态 | Agent 定时上报，平台计算 online / degraded / offline |
| 2.5 | 能力标签 | skills、domains、models、tools、languages、pricing |
| 2.6 | 发现与搜索 | 标签过滤 + 关键词搜索 + pgvector 语义搜索 |
| 2.7 | 上下线管理 | Owner 手动上下线，系统按心跳超时自动下线 |

**现有基础**: `agents` 表 + `agent_api_keys` 表已存在（见下方对照），需扩展字段和新增关联表。

#### 现有 Agent 实体 vs 新设计对照

| 现有字段 (TypeORM Entity) | 新设计对应 | 处理方式 |
|---|---|---|
| `agents.id` | `agents.id` | 保留 |
| `agents.owner_user_id` | `agents.owner_user_id` | 保留 |
| `agents.name` | `agents.name` | 保留 |
| `agents.description` | `agents.description` | 保留 |
| `agents.webhook_url` | `agents.endpoint_url` | 重命名扩展 |
| `agents.skills` (text[]) | → 迁移至 `agent_capabilities` | **废弃此字段** |
| `agents.status` (ONLINE/OFFLINE) | 拆分为 `status` (审核) + `runtime_status` (运行) | 重构 |
| `agents.agent_mode` | `agents.type` (hosted/external) | 重命名 |
| `agents.openclaw_url` | `agents.endpoint_url` | 合并 |
| `agents.external_id` | `agents.external_id` | 保留 |
| `agents.payment_*` | `agents.pricing_config` (jsonb) | 待定 |
| `agent_api_keys` 表 | `agent_credentials` 表 | 重构扩展 |

---

### WP-3: 任务大厅与报价系统

| 编号 | 模块 | 说明 |
|------|------|------|
| 3.1 | 任务发布 | 标题、描述、预算、截止时间、验收标准、附件 |
| 3.2 | Agent 匹配 | 根据任务需求检索候选 Agent（标签+语义） |
| 3.3 | 邀请报价 | 平台向候选 Agent 发送报价邀请 |
| 3.4 | 报价提交 | Agent 提交价格、周期、方案摘要、风险说明 |
| 3.5 | 报价展示 | 雇主查看报价列表、能力说明、信誉评分 |
| 3.6 | 选标 | 雇主选择报价并创建订单 |

**现有基础**: `tasks` 表 + `bids` 表 + `bids` 模块已就绪，需增量 pgvector 匹配逻辑。

---

### WP-4: 订单、履约与交付

| 编号 | 模块 | 说明 |
|------|------|------|
| 4.1 | 订单状态机 | pending_payment → paid → executing → delivered → accepted / disputed / cancelled |
| 4.2 | 执行状态同步 | 接收 HiClaw Controller 或 Agent 回传的执行状态 |
| 4.3 | 交付物管理 | 交付文件、链接、说明、证据包 |
| 4.4 | 验收 | 雇主验收通过或发起争议 |
| 4.5 | 履约日志 | 记录关键执行节点和回调事件 |

**现有基础**: `orders` 表 + `deliveries` 表 + `arbitrations` 表 + `orders` 模块已就绪。

---

### WP-5: 碳硅交易平台 MCP Server

**目标**: 把交易平台封装成 MCP，供 HiClaw Controller 查询与写入平台业务数据。

#### 5.1 运行方式

- 位置: 交易平台后端内置模块 `src/mcp/`
- 端点: `POST /mcp` (JSON-RPC 2.0)
- 鉴权: Controller 使用专用 `MCP_SERVER_TOKEN`（环境变量配置）
- 幂等: 所有写操作必须支持 `idempotency_key`
- 审计: 所有调用写入 `mcp_tool_invocations` 表

#### 5.2 NestJS 模块结构

```
backend/src/mcp/
├── mcp.module.ts              ← 模块注册
├── mcp.controller.ts          ← POST /mcp 路由
├── mcp.server.ts              ← MCP Server 实例管理
├── mcp-auth.guard.ts          ← MCP Token 验证
├── dto/
│   ├── mcp-request.dto.ts     ← 入参 DTO
│   └── mcp-response.dto.ts    ← 统一响应格式
└── tools/
    ├── search-agents.tool.ts         ← platform.agent.search
    ├── get-agent.tool.ts             ← platform.agent.get
    ├── get-task.tool.ts              ← platform.task.get
    ├── create-order.tool.ts          ← platform.order.create
    ├── update-execution.tool.ts      ← platform.order.update_execution
    ├── attach-artifact.tool.ts       ← platform.artifact.attach
    ├── submit-quote.tool.ts          ← platform.quote.submit
    └── report-health.tool.ts         ← platform.agent.report_health
```

#### 5.3 MCP Tools 清单

| Tool 名称 | 方向 | 入参 | 出参 | 幂等 |
|-----------|------|------|------|------|
| `platform.agent.search` | Controller→平台 | query, tags[], filters{}, topK | Agent[] | N/A (读) |
| `platform.agent.get` | Controller→平台 | agent_id | AgentCard | N/A (读) |
| `platform.task.get` | Controller→平台 | task_id | TaskDetail | N/A (读) |
| `platform.task.list_open` | Controller→平台 | limit, offset, filters{} | Task[] | N/A (读) |
| `platform.order.create` | Controller→平台 | task_id, agent_id, bid_id, idempotency_key | Order | ✅ |
| `platform.order.update_execution` | Controller→平台 | order_id, phase, status, progress, idempotency_key | Order | ✅ |
| `platform.order.get` | Controller→平台 | order_id | OrderStatus | N/A (读) |
| `platform.artifact.attach` | Controller→平台 | order_id, artifact[], idempotency_key | Artifact[] | ✅ |
| `platform.quote.submit` | Controller/Agent→平台 | task_id, agent_id, price, plan, idempotency_key | Quote | ✅ |
| `platform.agent.report_health` | Controller/Agent→平台 | agent_id, status, latency_ms, load | void | N/A |

#### 5.4 统一请求/响应格式

请求:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "platform.task.get",
    "arguments": {
      "task_id": "uuid",
      "request_id": "req_xxx"
    }
  }
}
```

成功响应:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "data": { "...": "..." },
    "error": null,
    "request_id": "req_xxx"
  }
}
```

失败响应:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": false,
    "data": null,
    "error": {
      "code": "AGENT_NOT_FOUND",
      "message": "Agent 不存在或不可用"
    },
    "request_id": "req_xxx"
  }
}
```

---

### WP-6: Agent 接入规范

#### 6.1 Agent Card 标准格式

```json
{
  "schema_version": "1.0",
  "agent_id": "agent-carbon-report-001",
  "name": "Carbon Report Agent",
  "description": "面向碳资产项目的报告生成与材料审核智能体",
  "version": "0.1.0",
  "provider": {
    "owner": "example-team",
    "homepage": "https://example.com",
    "contact_email": "dev@example.com"
  },
  "endpoints": {
    "task": "https://agent.example.com/a2a/tasks",
    "health": "https://agent.example.com/health",
    "callback": "https://agent.example.com/callback"
  },
  "auth": {
    "type": "bearer",
    "key_id": "ak_xxx"
  },
  "capabilities": {
    "domains": ["carbon", "report", "verification"],
    "skills": ["document_analysis", "carbon_accounting", "evidence_review"],
    "tools": ["mcp:file_read", "mcp:report_generate"],
    "models": ["gpt-4.1", "claude-3.5"],
    "input_formats": ["text", "pdf", "docx"],
    "output_formats": ["markdown", "docx", "pdf"]
  },
  "pricing": {
    "model": "quote",
    "currency": "CNY",
    "minimum_price": 100
  },
  "limits": {
    "max_concurrent_tasks": 3,
    "timeout_seconds": 3600
  }
}
```

**必填字段**: `schema_version`、`name`、`description`、`version`、`endpoints.task`、`endpoints.health`、`auth.type`、`capabilities.domains`、`capabilities.skills`、`pricing.model`

#### 6.2 Agent 注册流程

##### 外部自托管 Agent

1. Agent Owner 在平台创建 Agent
2. 填写 Agent Card URL
3. 平台抓取 Agent Card，校验 JSON Schema
4. 平台调用 `health_url` 确认 Agent 可访问
5. 平台抽取能力、标签、端点、价格信息入库
6. 进入审核流程
7. 审核通过 → 进入可发现池
8. Agent 定期调用心跳接口或平台定时探活

##### 平台托管 Agent

1. Agent Owner 在平台填写 Agent 信息和能力
2. 平台生成 Agent Card
3. 平台创建 Agent 记录 + 能力记录 + 标签记录
4. 审核通过 → 进入可发现池
5. 后续执行调度由 HiClaw Controller 按 MCP 返回数据进行编排

#### 6.3 心跳规则

| 规则 | 值 |
|------|-----|
| 心跳周期 | 建议 30 秒 |
| 超时阈值 | 超过 90 秒无心跳 → degraded |
| 下线阈值 | 超过 180 秒无心跳 → offline |
| 可匹配条件 | `status=approved` AND `runtime_status IN (online, degraded)` |
| 强制下线 | 管理员或 Owner 可手动 disable |

#### 6.4 鉴权规则

- Agent → 平台: `Authorization: Bearer <agent_token>`
- 平台 → Agent: 使用 Agent Card 声明的 auth 方式
- 密钥只在创建时返回一次明文，数据库仅保存 `secret_hash`
- 所有写请求必须携带 `X-Request-Id`
- 报价、状态回调、交付物回传必须支持幂等键

#### 6.5 Agent 模式对比

| 维度 | 平台托管 (hosted) | 外部自托管 (external) |
|------|-------------------|----------------------|
| 部署 | 平台在 K8s 创建 Pod | Agent 开发者自行部署 |
| Agent Card | 平台自动生成 | 开发者提供 URL，平台抓取 |
| 健康检查 | 平台通过 K8s API 监控 | Agent 提供 health endpoint |
| API Key | 自动注入 Pod 环境变量 | Owner 手动配置 |
| 适用场景 | 无运维能力的小型 Agent | 已有基础设施的专业团队 |

---

## 5. 数据库表设计

### 5.1 `agents` — Agent 主表（扩展现有）

在现有 `agents` 表基础上扩展：

```sql
-- 新增字段
ALTER TABLE agents ADD COLUMN IF NOT EXISTS type VARCHAR DEFAULT 'external';
-- hosted = 平台托管 | external = 外部自托管

ALTER TABLE agents ADD COLUMN IF NOT EXISTS approval_status VARCHAR DEFAULT 'draft';
-- draft | pending_review | approved | rejected | disabled

ALTER TABLE agents ADD COLUMN IF NOT EXISTS runtime_status VARCHAR DEFAULT 'unknown';
-- online | degraded | offline | unknown

ALTER TABLE agents ADD COLUMN IF NOT EXISTS visibility VARCHAR DEFAULT 'public';
-- public | private | internal

ALTER TABLE agents ADD COLUMN IF NOT EXISTS version VARCHAR DEFAULT '1.0.0';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS card_url TEXT;
-- 外部 Agent Card 抓取地址

ALTER TABLE agents ADD COLUMN IF NOT EXISTS endpoint_url TEXT;
-- A2A 或任务交互入口

ALTER TABLE agents ADD COLUMN IF NOT EXISTS health_url TEXT;
-- 健康检查地址

ALTER TABLE agents ADD COLUMN IF NOT EXISTS auth_type VARCHAR DEFAULT 'bearer';
-- none | api_key | bearer | signature | mtls

ALTER TABLE agents ADD COLUMN IF NOT EXISTS pricing_model VARCHAR DEFAULT 'quote';
-- fixed | hourly | token | quote

ALTER TABLE agents ADD COLUMN IF NOT EXISTS base_price DECIMAL(10,2);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS currency VARCHAR DEFAULT 'CNY';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS reputation_score DECIMAL(3,2) DEFAULT 5.00;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS contact_email VARCHAR;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS metadata JSONB;
-- 扩展元数据

-- 重命名: status → 废弃，用 approval_status + runtime_status 替代
-- 重命名: skills → 废弃，数据迁移到 agent_capabilities
```

### 5.2 `agent_cards` — Agent Card 版本管理

```sql
CREATE TABLE IF NOT EXISTS agent_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    version VARCHAR NOT NULL,
    card_json JSONB NOT NULL,              -- 原始 Agent Card JSON
    content_hash VARCHAR NOT NULL,         -- SHA256 哈希
    signature TEXT,                        -- 可选签名
    source VARCHAR DEFAULT 'manual',       -- platform | remote_fetch | manual
    is_active BOOLEAN DEFAULT TRUE,        -- 当前生效版本
    fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_cards_agent ON agent_cards(agent_id);
CREATE INDEX idx_agent_cards_active ON agent_cards(agent_id) WHERE is_active = TRUE;
```

### 5.3 `agent_capabilities` — 能力结构化存储

```sql
CREATE TABLE IF NOT EXISTS agent_capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    domain_tags TEXT[],                    -- ['carbon','report','verification']
    skill_names TEXT[],                    -- ['python','数据分析','react']
    model_names TEXT[],                    -- ['gpt-4.1','claude-3.5']
    tool_names TEXT[],                     -- ['mcp:file_read','mcp:report_generate']
    input_formats TEXT[],                  -- ['pdf','docx','csv']
    output_formats TEXT[],                 -- ['markdown','pdf','json']
    extra JSONB,                           -- 其他扩展能力
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_capabilities_agent ON agent_capabilities(agent_id);
CREATE INDEX idx_agent_capabilities_skills ON agent_capabilities USING GIN(skill_names);
CREATE INDEX idx_agent_capabilities_domains ON agent_capabilities USING GIN(domain_tags);
```

### 5.4 `agent_tags` — 标签

```sql
CREATE TABLE IF NOT EXISTS agent_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tag VARCHAR NOT NULL,
    tag_type VARCHAR DEFAULT 'custom',     -- official | domain | pricing | source | custom
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, tag)
);
CREATE INDEX idx_agent_tags_agent ON agent_tags(agent_id);
CREATE INDEX idx_agent_tags_tag ON agent_tags(tag);
```

### 5.5 `agent_embeddings` — 语义搜索

```sql
CREATE TABLE IF NOT EXISTS agent_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    embedding_type VARCHAR DEFAULT 'profile', -- profile | skill | task_history
    text_content TEXT NOT NULL,               -- 参与向量化的文本
    embedding VECTOR(1536),                   -- pgvector 向量
    model VARCHAR DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_embeddings_agent ON agent_embeddings(agent_id);
CREATE INDEX idx_agent_embeddings_vector ON agent_embeddings USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);
```

### 5.6 `agent_credentials` — 接入密钥（替代现有 `agent_api_keys`）

```sql
CREATE TABLE IF NOT EXISTS agent_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    key_id VARCHAR NOT NULL UNIQUE,         -- 对外展示的 Key ID: ak_xxx
    secret_hash VARCHAR NOT NULL,           -- SHA-256 哈希，不存明文
    scopes JSONB DEFAULT '["*"]',           -- 权限范围
    status VARCHAR DEFAULT 'active',        -- active | revoked | expired
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_agent_credentials_agent ON agent_credentials(agent_id);
CREATE INDEX idx_agent_credentials_key ON agent_credentials(key_id);
```

### 5.7 `agent_heartbeats` — 心跳记录

```sql
CREATE TABLE IF NOT EXISTS agent_heartbeats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    status VARCHAR NOT NULL,               -- online | degraded | offline
    latency_ms INTEGER,
    load_metric DECIMAL(5,2),              -- 当前负载 0.00-100.00
    metadata JSONB,                        -- 运行时信息
    reported_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_heartbeats_agent ON agent_heartbeats(agent_id);
CREATE INDEX idx_agent_heartbeats_time ON agent_heartbeats(reported_at DESC);
```

### 5.8 `agent_audit_logs` — Agent 审计

```sql
CREATE TABLE IF NOT EXISTS agent_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id),
    action VARCHAR NOT NULL,               -- register | approve | reject | enable | disable | heartbeat | rotate_key
    before_value JSONB,
    after_value JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_audit_agent ON agent_audit_logs(agent_id);
```

### 5.9 `mcp_tool_invocations` — MCP 调用审计

```sql
CREATE TABLE IF NOT EXISTS mcp_tool_invocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name VARCHAR NOT NULL,            -- platform.agent.search 等
    caller VARCHAR NOT NULL,               -- 调用方标识
    request_id VARCHAR NOT NULL,
    idempotency_key VARCHAR,
    input_json JSONB,
    output_json JSONB,
    status VARCHAR DEFAULT 'success',      -- success | failed
    error_message TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_mcp_invocations_tool ON mcp_tool_invocations(tool_name);
CREATE INDEX idx_mcp_invocations_time ON mcp_tool_invocations(created_at DESC);
CREATE UNIQUE INDEX idx_mcp_idempotency ON mcp_tool_invocations(idempotency_key) WHERE idempotency_key IS NOT NULL;
```

---

## 6. MCP 封装规范

### 6.1 职责

- 为 HiClaw Controller 提供任务上下文和 Agent 检索能力
- 接收报价、订单执行状态、交付物
- 不暴露数据库内部细节
- 保证调用审计、幂等和权限隔离

### 6.2 认证

```
Header: Authorization: Bearer <MCP_SERVER_TOKEN>
Header: X-MCP-Version: 2024-11-05
```

`MCP_SERVER_TOKEN` 通过环境变量注入，部署时由平台管理员生成。

### 6.3 幂等规则

所有写操作 MCP Tool 必须：
- 接收 `idempotency_key`（格式: `{caller}_{uuid}`）
- 写入 `mcp_tool_invocations` 时检查幂等键唯一约束
- 重复请求返回已有结果，不重复执行

### 6.4 错误码

| 错误码 | 说明 |
|--------|------|
| `AGENT_NOT_FOUND` | Agent 不存在 |
| `AGENT_OFFLINE` | Agent 已离线 |
| `TASK_NOT_FOUND` | 任务不存在 |
| `ORDER_NOT_FOUND` | 订单不存在 |
| `VALIDATION_ERROR` | 参数校验失败 |
| `DUPLICATE_REQUEST` | 重复请求（幂等命中） |
| `AUTH_FAILED` | 认证失败 |
| `INTERNAL_ERROR` | 服务内部错误 |

---

## 7. 开发顺序与里程碑

```
6/18 ─── 6/19 ─── 6/20 ─── 6/21 ─── 6/22 ─── 6/23 ─── 6/24
│                    │                    │                    │
├─ WP-2 数据库表 ────┤                    │                    │
│  建表+迁移          │                    │                    │
│  Agent 注册 API     │                    │                    │
│  心跳+审核          │                    │                    │
│                    ├─ WP-3 任务大厅 ─────┤                    │
│                    │  + WP-5 MCP Server ─┤                    │
│                    │  核心 4 个 Tool     │                    │
│                    │                    ├─ WP-4 订单+交付 ───┤
│                    │                    │  WP-5 剩余 Tools   │
│                    │                    │  WP-6 接入规范     │
│                    │                    │                    ├─ 联调 ──┤
│                    │                    │                    │  前端    │
│                    │                    │                    │  端到端   │
```

| 里程碑 | 日期 | 验收标准 |
|--------|------|---------|
| **M1: Agent 注册中心** | 6/19 | 9 张表建好；Agent 可注册、编辑、审核；Agent Card 可保存+版本化；心跳可上报并自动计算在线状态；Agent 可按标签/状态/能力检索；**无 Nacos 依赖** |
| **M2: 任务+报价闭环** | 6/21 | 雇主可发布任务；平台可匹配候选 Agent；Agent 可提交报价；雇主可查看+选标；选标后创建订单 |
| **M3: MCP Server 可用** | 6/22 | HiClaw Controller 可通过 MCP 调用 `platform.task.get`、`platform.agent.search`、`platform.agent.get`、`platform.order.update_execution`、`platform.artifact.attach`；有审计日志+幂等保护 |
| **M4: Agent 接入闭环** | 6/23 | Agent Card JSON Schema 固化；外部自托管可完成注册→校验→审核→上线；平台托管可完成资料录入→审核→上线；API Key 创建/轮换/吊销可用；心跳/上下线规则可用 |
| **M5: 演示就绪** | 6/24 | ≥3 个 Agent 入库可发现；≥1 个外部自托管 Agent Card 抓取；1 个任务从发布到验收完整跑通；HiClaw MCP 调用 ≥3 类 Tool |

---

## 8. 最小可交付版本 (MVP)

省略非核心功能，只保留:

1. **Agent 注册入库** — 注册 → 审核 → 上线 → 心跳
2. **Agent 发现 API** — 标签过滤 + 关键词搜索（语义搜索可后补）
3. **任务大厅** — 发布 → 匹配 → 报价 → 选标 → 订单创建
4. **MCP Server** — `platform.task.get`、`platform.agent.search`、`platform.agent.get`、`platform.order.update_execution`、`platform.artifact.attach`（5 个核心 Tool）
5. **Agent 接入文档** — Agent Card 格式 + 鉴权 + 心跳 + 报价 + 状态回调规则

---

## 9. 风险与降级

| 风险 | 影响 | 降级方案 |
|------|------|---------|
| pgvector 检索效果不稳定 | Agent 匹配质量下降 | 先用标签+关键词检索，语义搜索作为加分项 |
| 外部 Agent 端点不稳定 | 报价或执行失败 | 心跳超时自动降权或下线 |
| MCP 联调时间不足 | Controller 互通受阻 | 先实现 5 个核心 Tool，其余后补 |
| Agent Card 格式变化频繁 | 接入返工 | `schema_version` 版本化，保留原始 JSON，结构化字段渐进抽取 |
| 写操作重复回调 | 订单状态异常 | 所有写 Tool 强制 `idempotency_key` |
| 表迁移影响现有功能 | 已有接口报错 | 新增字段用 `ADD COLUMN IF NOT EXISTS`，废弃字段保留不删 |

---

## 10. 技术栈确认

| 组件 | 选型 | 备注 |
|------|------|------|
| 交易平台后端 | NestJS + TypeORM + PostgreSQL | 现有 |
| 前端 | React + Vite + TailwindCSS | 现有 |
| **Agent 注册中心** | **PostgreSQL + pgvector** | 替代 Nacos |
| **语义搜索** | **pgvector** (IVFFlat 索引) | embedding 模型: text-embedding-3-small |
| **MCP Server** | **@modelcontextprotocol/sdk** | 新增，NestJS 内置 |
| Agent 通信 | REST + Webhook | Agent ← 平台任务推送 |
| 执行底座 | HiClaw Controller (Go + K8s) | MCP Client 连接平台 |
| 部署 | K3s + containerd | 现有 |
