# WP-2: 数据库式 Agent 注册中心 — 实现方案

> 基于: carbon-silicon-platform-plan-final.md | 日期: 2026-06-18  
> 目标: 替代 Nacos，Agent 元数据/能力/状态全部落库，由平台提供注册、发现、心跳、审核能力

---

## 1. 现状分析

### 1.1 已有文件

```
backend/src/agents/
├── agents.module.ts              ← 需要重构
├── agents.controller.ts          ← 13 个路由，需扩展
├── agents.service.ts             ← CRUD + 心跳 + API Key
├── agent-manager.controller.ts   ← Agent 生命周期管理
├── agent-manager.service.ts      ← K8s Pod 创建/销毁
├── agent-bind.controller.ts      ← Openclaw 绑定
└── entities/
    ├── agent.entity.ts           ← 需大幅扩展字段
    └── agent-api-key.entity.ts   ← 需重构为 agent_credentials
```

### 1.2 现有 agents 表字段（26 列）

| 分类 | 字段 | 保留/废弃 |
|------|------|----------|
| 基础 | id, owner_user_id, name, description | ✅ 保留 |
| 状态 | status (ONLINE/OFFLINE) | ❌ 拆分为 approval_status + runtime_status |
| 接入 | webhook_url, external_id, agent_mode | 🔄 重命名/合并 |
| 技能 | skills (text[]) | ❌ 迁移至 agent_capabilities |
| Openclaw | openclaw_url, openclaw_status, last_health_check_at, health_check_result | 🔄 合并到 endpoint_url |
| 支付 | payment_qr_url, payment_qr_type, payment_account | 🔄 移至 metadata |
| 心跳 | last_heartbeat_at, heartbeat_interval_ms, consecutive_failures | 🔄 保留并扩展 |
| 其他 | pod_name, is_active, created_at | 🔄 保留 |

### 1.3 核心问题

- 字段职责混乱：审核状态、运行状态、接入信息、定价信息全挤在一张表
- 没有 AgentCard 版本管理
- 能力标签用 text[] 无法支撑语义搜索
- API Key 管理过于简单（无 scope、无过期）
- 心跳只有时间戳，没有历史记录和负载信息

---

## 2. 目标架构

### 2.1 表结构全景

```
agents (主表，扩展后)
  ├── 1:1 ── agent_capabilities (能力)
  ├── 1:N ── agent_cards (版本)
  ├── 1:N ── agent_tags (标签)
  ├── 1:N ── agent_credentials (密钥)
  ├── 1:N ── agent_heartbeats (心跳历史)
  ├── 1:1 ── agent_embeddings (向量)
  └── 1:N ── agent_audit_logs (审计)
```

### 2.2 状态机设计

```
approval_status (审核状态):
  draft ──→ pending_review ──→ approved ──→ disabled
                 │                  │
                 └──→ rejected      └──→ disabled

runtime_status (运行状态，由心跳驱动):
  unknown ──→ online ←──→ degraded ←──→ offline
               │           │              │
              心跳正常    90s无心跳      180s无心跳
```

匹配条件: `approval_status = 'approved' AND runtime_status IN ('online', 'degraded')`

### 2.3 目标目录结构

```
backend/src/agents/
├── agents.module.ts              ← 重构，注册所有 Entity + Service
├── agents.controller.ts          ← 用户端 API（Agent CRUD + 心跳）
├── agents-admin.controller.ts    ← 管理端 API（审核 + 管理）
├── agents.service.ts             ← 核心业务逻辑
├── agents-discovery.service.ts   ← 发现/搜索（pgvector + 标签）
├── agents-health.service.ts      ← 心跳处理 + 状态计算
├── agent-card.service.ts         ← Agent Card 抓取/解析/版本管理
├── agent-credential.service.ts   ← API Key 创建/验证/轮换
├── agent-manager.controller.ts   ← Agent 生命周期（保留）
├── agent-manager.service.ts      ← K8s 部署（保留）
├── agent-bind.controller.ts      ← Openclaw 绑定（保留）
├── dto/
│   ├── create-agent.dto.ts
│   ├── update-agent.dto.ts
│   ├── agent-search.dto.ts
│   └── agent-card.dto.ts
└── entities/
    ├── agent.entity.ts           ← 扩展
    ├── agent-capability.entity.ts ← 新建
    ├── agent-card.entity.ts       ← 新建
    ├── agent-tag.entity.ts        ← 新建
    ├── agent-credential.entity.ts ← 替换 agent-api-key.entity.ts
    ├── agent-heartbeat.entity.ts  ← 新建
    ├── agent-embedding.entity.ts  ← 新建
    └── agent-audit-log.entity.ts  ← 新建
```

---

## 3. 数据库迁移

### 3.1 扩展 `agents` 表

```sql
-- 新增审核状态（废弃旧 status 字段）
ALTER TABLE agents ADD COLUMN IF NOT EXISTS approval_status VARCHAR DEFAULT 'draft';
UPDATE agents SET approval_status = 'approved' WHERE status = 'ONLINE';
UPDATE agents SET approval_status = 'draft' WHERE status = 'OFFLINE';

-- 新增运行状态
ALTER TABLE agents ADD COLUMN IF NOT EXISTS runtime_status VARCHAR DEFAULT 'unknown';

-- 新增 Agent 类型
ALTER TABLE agents ADD COLUMN IF NOT EXISTS type VARCHAR DEFAULT 'external';

-- 新增可见性
ALTER TABLE agents ADD COLUMN IF NOT EXISTS visibility VARCHAR DEFAULT 'public';

-- 新增版本
ALTER TABLE agents ADD COLUMN IF NOT EXISTS version VARCHAR DEFAULT '1.0.0';

-- 新增接入端点（统一外部地址）
ALTER TABLE agents ADD COLUMN IF NOT EXISTS endpoint_url TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS health_url TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS card_url TEXT;

-- 新增认证方式
ALTER TABLE agents ADD COLUMN IF NOT EXISTS auth_type VARCHAR DEFAULT 'bearer';

-- 新增定价（从 AgentCard 抽取）
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pricing_model VARCHAR DEFAULT 'quote';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS base_price DECIMAL(10,2);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS currency VARCHAR DEFAULT 'CNY';

-- 新增信誉
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reputation_score DECIMAL(3,2) DEFAULT 5.00;

-- 新增审核时间
ALTER TABLE agents ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 新增联系方式
ALTER TABLE agents ADD COLUMN IF NOT EXISTS contact_email VARCHAR;

-- 扩展元数据
ALTER TABLE agents ADD COLUMN IF NOT EXISTS metadata JSONB;
```

### 3.2 新建 5 张关联表

```sql
-- 能力表
CREATE TABLE IF NOT EXISTS agent_capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    domain_tags TEXT[],
    skill_names TEXT[],
    model_names TEXT[],
    tool_names TEXT[],
    input_formats TEXT[],
    output_formats TEXT[],
    extra JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_cap_agent ON agent_capabilities(agent_id);
CREATE INDEX idx_agent_cap_skills ON agent_capabilities USING GIN(skill_names);
CREATE INDEX idx_agent_cap_domains ON agent_capabilities USING GIN(domain_tags);

-- 标签表
CREATE TABLE IF NOT EXISTS agent_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tag VARCHAR NOT NULL,
    tag_type VARCHAR DEFAULT 'custom',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, tag)
);
CREATE INDEX idx_agent_tags_agent ON agent_tags(agent_id);
CREATE INDEX idx_agent_tags_tag ON agent_tags(tag);

-- 版本表（Agent Card）
CREATE TABLE IF NOT EXISTS agent_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    version VARCHAR NOT NULL,
    card_json JSONB NOT NULL,
    content_hash VARCHAR NOT NULL,
    signature TEXT,
    source VARCHAR DEFAULT 'manual',
    is_active BOOLEAN DEFAULT TRUE,
    fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_cards_agent ON agent_cards(agent_id);

-- 凭证表（替代 agent_api_keys）
CREATE TABLE IF NOT EXISTS agent_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    key_id VARCHAR NOT NULL UNIQUE,
    secret_hash VARCHAR NOT NULL,
    scopes JSONB DEFAULT '["*"]',
    status VARCHAR DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_agent_cred_agent ON agent_credentials(agent_id);

-- 心跳记录表
CREATE TABLE IF NOT EXISTS agent_heartbeats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    status VARCHAR NOT NULL,
    latency_ms INTEGER,
    load_metric DECIMAL(5,2),
    metadata JSONB,
    reported_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_hb_agent ON agent_heartbeats(agent_id);
CREATE INDEX idx_agent_hb_time ON agent_heartbeats(reported_at DESC);
```

### 3.3 数据迁移策略

```
1. 执行 ALTER TABLE agents 新增字段（不影响现有数据）
2. 执行 CREATE TABLE 新建 5 张表
3. 编写迁移脚本:
   - 将 agents.skills → agent_capabilities.skill_names
   - 将 agents.openclaw_url → agents.endpoint_url
   - 将 agent_api_keys → agent_credentials
4. 验证新表数据完整性
5. 废弃旧字段（暂不删除，保留一个版本）
```

---

## 4. API 设计

### 4.1 用户端 (AgentsController)

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `POST` | `/api/v1/agents/register` | 注册 Agent（平台托管 OR 外部） | 需要登录 |
| `POST` | `/api/v1/agents/register-external` | 注册外部 Agent（提供 Card URL） | 需要登录 |
| `GET` | `/api/v1/agents` | 获取我的 Agent 列表 | 需要登录 |
| `GET` | `/api/v1/agents/:id` | 获取 Agent 详情 | 公开（脱敏） |
| `PUT` | `/api/v1/agents/:id` | 更新 Agent 信息 | Owner |
| `POST` | `/api/v1/agents/:id/heartbeat` | Agent 心跳上报 | Agent Key |
| `POST` | `/api/v1/agents/:id/disable` | 手动下线 | Owner |
| `POST` | `/api/v1/agents/:id/enable` | 手动上线 | Owner |
| `POST` | `/api/v1/agents/:id/credentials` | 创建 API Key | Owner |
| `GET` | `/api/v1/agents/:id/credentials` | 查看 API Key 列表（脱敏） | Owner |
| `POST` | `/api/v1/agents/:id/credentials/:keyId/revoke` | 吊销 API Key | Owner |

### 4.2 发现端 (AgentDiscoveryController)

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `GET` | `/api/v1/agents/discover` | 标签+关键词搜索 | 公开 |
| `POST` | `/api/v1/agents/search` | 语义搜索（pgvector） | 公开 |
| `GET` | `/api/v1/agents/tags` | 获取所有可用标签 | 公开 |


### 4.3 管理端 (AgentsAdminController)

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `GET` | `/api/v1/admin/agents/pending` | 待审核列表 | Admin |
| `POST` | `/api/v1/admin/agents/:id/approve` | 审核通过 | Admin |
| `POST` | `/api/v1/admin/agents/:id/reject` | 审核驳回 | Admin |
| `GET` | `/api/v1/admin/agents` | 全部 Agent 列表 | Admin |
| `POST` | `/api/v1/admin/agents/:id/force-disable` | 强制下线 | Admin |

---

## 5. 核心业务逻辑

### 5.1 Agent 注册流程

```
POST /api/v1/agents/register
  │
  ├─ 外部自托管:
  │  ① 验证 Agent Card URL 可达
  │  ② GET card_url → 解析 JSON → 校验 Schema
  │  ③ 提取 capabilities / endpoints / pricing
  │  ④ 创建 agents 行 (type=external, approval_status=pending_review)
  │  ⑤ 写入 agent_cards (source=remote_fetch)
  │  ⑥ 写入 agent_capabilities
  │  ⑦ 写入 agent_tags
  │
  └─ 平台托管:
     ① 验证必填字段 (name, skills, domains)
     ② 创建 agents 行 (type=hosted, approval_status=pending_review)
     ③ 平台生成 Agent Card JSON
     ④ 写入 agent_cards (source=platform)
     ⑤ 写入 agent_capabilities
     ⑥ 写入 agent_tags
     ⑦ 后续由 AgentManagerService 部署 K8s Pod
```

### 5.2 心跳处理

```
POST /api/v1/agents/:id/heartbeat
  │
  ├─ 验证 Agent API Key
  ├─ 写入 agent_heartbeats 记录
  ├─ 更新 agents.last_heartbeat_at
  ├─ 计算运行状态:
  │   ├─ 上次心跳 < 90s  → runtime_status = 'online'
  │   ├─ 上次心跳 90-180s → runtime_status = 'degraded'
  │   └─ 上次心跳 > 180s → runtime_status = 'offline'
  └─ 返回 { status: 'ack' }
```

### 5.3 Agent 发现（语义搜索）

```
GET /api/v1/agents/discover?query=python爬虫&tags=paid,data
  │
  ├─ 过滤: approval_status='approved' AND runtime_status IN ('online','degraded')
  ├─ 标签过滤: agent_tags.tag IN ('paid','data')
  ├─ 语义搜索:
  │   ① 将 query 转为 embedding (调用 text-embedding-3-small)
  │   ② SELECT ... FROM agent_embeddings ORDER BY embedding <=> $1 LIMIT $topK
  │   ③ JOIN agents 获取基础信息
  ├─ 综合排序: 语义相似度 × 0.6 + reputation_score × 0.3 + response_speed × 0.1
  └─ 返回 Agent[] 列表
```

---

## 6. 与现有代码的迁移对照

| 现有 | 新设计 | 操作 |
|------|--------|------|
| `agents.skills` (text[]) | `agent_capabilities.skill_names` | 数据迁移 → 废弃旧列 |
| `agents.status` (ONLINE/OFFLINE) | `agents.approval_status` + `agents.runtime_status` | 新增两列，旧列保留兼容 |
| `agents.agent_mode` | `agents.type` (hosted/external) | 重命名 |
| `agents.openclaw_url` | `agents.endpoint_url` | 统一 |
| `agents.webhook_url` | `agents.endpoint_url` | 统一 |
| `agent_api_keys` 表 | `agent_credentials` 表 | 新建 + 迁移 |
| `agents.controller.ts` 的 `@Roles()` | 移除 | 已完成 ✅ |

---

## 7. 实施任务拆解

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| **Day 1** | | | |
| 1 | 执行数据库迁移（DDL） | SQL 脚本 | 0.5h |
| 2 | 新建 5 个 Entity | `entities/*.entity.ts` | 1.5h |
| 3 | 重构 `agent.entity.ts`（新增字段） | `agent.entity.ts` | 1h |
| 4 | 数据迁移脚本（skills → capabilities 等）| migration script | 1h |
| **Day 2** | | | |
| 5 | 新建 `AgentCardService`（抓取/解析/版本） | `agent-card.service.ts` | 2h |
| 6 | 新建 `AgentCredentialService`（密钥管理） | `agent-credential.service.ts` | 1h |
| 7 | 新建 `AgentHealthService`（心跳+状态计算） | `agents-health.service.ts` | 1.5h |
| 8 | 新建 `AgentDiscoveryService`（搜索+排序） | `agents-discovery.service.ts` | 2h |
| **Day 3** | | | |
| 9 | 重构 `AgentsController`（注册/心跳/管理） | `agents.controller.ts` | 2h |
| 10 | 新建 `AgentsAdminController`（审核） | `agents-admin.controller.ts` | 1.5h |
| 11 | 重构 `AgentsModule` | `agents.module.ts` | 0.5h |
| 12 | 编写单元测试 | `*.spec.ts` | 2h |
| **Day 4** | | | |
| 13 | 前端 Agent 注册页 | `RegisterAgent.tsx` | 2h |
| 14 | 前端智能体广场 | `AgentMarket.tsx` | 2h |
| 15 | 前端 Agent 详情页 | `AgentDetail.tsx` | 1h |
| 16 | 端到端联调测试 | — | 1h |

---

## 8. 验收标准

- [ ] 9 张表全部建好，索引覆盖
- [ ] Agent 注册双模式可用（平台托管 + 外部自托管）
- [ ] Agent Card 可抓取、解析、版本化存储
- [ ] 心跳可上报，30/90/180s 状态计算正确
- [ ] 标签搜索 + pgvector 语义搜索可用
- [ ] API Key 可创建/轮换/吊销，密钥仅返回一次
- [ ] 审核流程可走通（注册→审核→通过→上线）
- [ ] 前端 Agent 注册页 + 智能体广场可用
- [ ] 无 Nacos 依赖
