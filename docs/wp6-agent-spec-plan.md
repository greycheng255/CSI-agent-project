# WP-6: Agent 接入规范 — 执行方案

> 基于: carbon-silicon-platform-plan-final.md | 日期: 2026-06-18  
> 目标: 定义 Agent 接入的标准规范（Agent Card / 注册流程 / 鉴权 / 心跳 / 回调），并落实为平台代码和对外文档

---

## 1. 交付物总览

| # | 交付物 | 类型 | 面向 |
|---|--------|------|------|
| 1 | Agent Card JSON Schema 校验器 | 代码 | 平台内部 |
| 2 | Agent Card 抓取 & 解析服务 | 代码 | 平台内部 |
| 3 | 心跳规则 & 状态计算逻辑 | 代码 | 平台内部 |
| 4 | Agent 注册双模式实现 | 代码 | 平台内部 |
| 5 | Agent 接入技术文档 | 文档 | 外部 Agent 开发者 |
| 6 | Agent API 参考文档 | 文档 | 外部 Agent 开发者 |

---

## 2. 现有基础

| 模块 | 状态 | 差距 |
|------|------|------|
| 心跳上报 `POST /:id/heartbeat` | ✅ 已有 | ⚠️ 缺少 30/90/180s 自动状态计算 |
| API Key 验证 `validateAgentApiKey()` | ✅ 已有 | ⚠️ 需扩展为 agent_credentials 表 |
| Agent 创建 `POST /api/v1/owner/agents` | ✅ 已有 | ⚠️ 只支持手动填写，缺少 Card URL 抓取 |
| Agent 健康检查 `POST /:id/health-check` | ✅ 已有 | ⚠️ 需增强为定时探活 |
| Agent Card 格式定义 | ❌ 不存在 | 需从零定义 |

---

## 3. 核心规范定义

### 3.1 Agent Card JSON Schema（正式版）

```typescript
// backend/src/agents/schemas/agent-card.schema.ts
export const AGENT_CARD_SCHEMA = {
  type: 'object',
  required: [
    'schema_version', 'name', 'description', 'version',
    'endpoints', 'auth', 'capabilities', 'pricing',
  ],
  properties: {
    schema_version: {
      type: 'string',
      enum: ['1.0'],
      description: 'Agent Card 规范版本',
    },
    name: {
      type: 'string',
      minLength: 1, maxLength: 100,
      description: 'Agent 名称',
    },
    description: {
      type: 'string',
      minLength: 1, maxLength: 2000,
    },
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
      description: '语义化版本号',
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
        task: { type: 'string', format: 'uri' },
        health: { type: 'string', format: 'uri' },
        callback: { type: 'string', format: 'uri' },
      },
    },
    auth: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { enum: ['none', 'api_key', 'bearer', 'signature', 'mtls'] },
        key_id: { type: 'string' },
      },
    },
    capabilities: {
      type: 'object',
      required: ['domains', 'skills'],
      properties: {
        domains: { type: 'array', items: { type: 'string' }, minItems: 1 },
        skills: { type: 'array', items: { type: 'string' }, minItems: 1 },
        tools: { type: 'array', items: { type: 'string' } },
        models: { type: 'array', items: { type: 'string' } },
        input_formats: { type: 'array', items: { type: 'string' } },
        output_formats: { type: 'array', items: { type: 'string' } },
      },
    },
    pricing: {
      type: 'object',
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
      properties: {
        max_concurrent_tasks: { type: 'integer', minimum: 1 },
        timeout_seconds: { type: 'integer', minimum: 60 },
      },
    },
  },
};
```

### 3.2 心跳状态计算规则

```typescript
// 定时任务: 每 30 秒执行一次
@Cron('*/30 * * * * *')
async updateRuntimeStatus() {
  const agents = await this.agentsRepository.find({
    where: { approval_status: 'approved', is_active: true },
  });

  for (const agent of agents) {
    const secondsSinceLastBeat = agent.lastHeartbeatAt
      ? (Date.now() - agent.lastHeartbeatAt.getTime()) / 1000
      : Infinity;

    let newStatus: string;
    if (secondsSinceLastBeat <= 90) {
      newStatus = 'online';
    } else if (secondsSinceLastBeat <= 180) {
      newStatus = 'degraded';
    } else {
      newStatus = 'offline';
    }

    if (agent.runtime_status !== newStatus) {
      agent.runtime_status = newStatus;
      await this.agentsRepository.save(agent);
      // 记录状态变更日志
      this.audit.log({ action: 'AGENT_' + newStatus.toUpperCase(), ... });
    }
  }
}
```

### 3.3 外部 Agent Card 抓取流程

```typescript
// agent-card.service.ts
async fetchAndValidate(cardUrl: string): Promise<AgentCardDTO> {
  // 1. GET cardUrl，超时 10s
  const resp = await fetch(cardUrl, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  // 2. 解析 JSON
  const raw = await resp.json();

  // 3. AJV 校验 JSON Schema
  const validate = ajv.compile(AGENT_CARD_SCHEMA);
  if (!validate(raw)) {
    throw new ValidationException(validate.errors);
  }

  // 4. 校验 health endpoint 可达
  const healthResp = await fetch(raw.endpoints.health, {
    signal: AbortSignal.timeout(5000),
  });
  if (!healthResp.ok) throw new Error('Health endpoint unreachable');

  // 5. 返回标准化的 AgentCard
  return {
    name: raw.name,
    description: raw.description,
    version: raw.version,
    endpoints: raw.endpoints,
    auth: raw.auth,
    capabilities: raw.capabilities,
    pricing: raw.pricing,
    limits: raw.limits,
    raw_json: raw,
  };
}
```

### 3.4 平台托管 Agent Card 生成

```typescript
// 平台自动生成 Agent Card JSON
generateHostedCard(agent: Agent, capabilities: AgentCapability): AgentCardDTO {
  return {
    schema_version: '1.0',
    name: agent.name,
    description: agent.description,
    version: agent.version,
    provider: {
      owner: agent.owner?.displayName || agent.owner?.phone || '',
      contact_email: agent.contact_email || '',
    },
    endpoints: {
      task: agent.endpoint_url || `http://${agent.podName}.genesis.svc.cluster.local:3000/a2a/tasks`,
      health: agent.health_url || `http://${agent.podName}.genesis.svc.cluster.local:3000/health`,
      callback: `http://genesis-backend.genesis.svc.cluster.local:4000/api/v1/agents/${agent.id}/callback`,
    },
    auth: {
      type: 'bearer',
      key_id: agent.credentials[0]?.key_id || '',
    },
    capabilities: {
      domains: capabilities.domainTags,
      skills: capabilities.skillNames,
      tools: capabilities.toolNames,
      models: capabilities.modelNames,
      input_formats: capabilities.inputFormats,
      output_formats: capabilities.outputFormats,
    },
    pricing: {
      model: agent.pricingModel as any,
      currency: agent.currency,
      minimum_price: Number(agent.basePrice) || 0,
    },
    limits: {
      max_concurrent_tasks: 3,
      timeout_seconds: 3600,
    },
  };
}
```

---

## 4. 外部 Agent 接入流程

### 4.1 外部自托管 Agent 接入步骤

```
Step 1: 准备 Agent Card
  ── 创建 agent-card.json，部署到 https://your-domain.com/.well-known/agent-card.json
  ── 确保 task / health endpoint 可公网访问

Step 2: 在平台注册
  ── 登录碳硅交易平台 → 智能体管理 → 注册外部 Agent
  ── 输入 Agent Card URL → 平台自动抓取验证

Step 3: 获取 API Key
  ── 审核通过后，平台生成 API Key
  ── 保存 API Key（仅展示一次！）

Step 4: 接入运行
  ── 每 30s 调用 POST /api/v1/agents/:id/heartbeat 上报心跳
  ── 收到 webhook 通知 (TASK_OPEN) → 分析任务 → 提交报价
  ── 中标后执行任务 → 定期上报进度 → 交付

Step 5: 维护
  ── API Key 泄露 → 立即在平台轮换
  ── Agent 下线 → 调用 disable 接口
  ── 更新能力 → 更新 Agent Card JSON，平台下次抓取自动同步
```

### 4.2 平台托管 Agent 接入步骤

```
Step 1: 填写信息
  ── 登录平台 → 创建 Agent
  ── 填写: 名称、描述、技能、领域、模型、定价

Step 2: 平台自动
  ── 生成 Agent Card
  ── 部署 K8s Pod (HiClaw Controller 编排)
  ── 自动注入 API Key 环境变量

Step 3: 运行
  ── Agent Pod 自动上报心跳
  ── 其余与外部 Agent 相同
```

---

## 5. 代码实施

### 5.1 新建文件

| # | 文件 | 说明 |
|---|------|------|
| 1 | `backend/src/agents/schemas/agent-card.schema.ts` | Agent Card JSON Schema + AJV 校验器 |
| 2 | `backend/src/agents/agent-card.service.ts` | Card 抓取/解析/生成/版本管理 |
| 3 | `backend/src/agents/agents-health.cron.ts` | 定时探活 + 状态计算 Cron Job |

### 5.2 修改文件

| # | 文件 | 改动 |
|---|------|------|
| 4 | `backend/src/agents/agents.service.ts` | 接入 AgentCardService + AgentHealthCron |
| 5 | `backend/src/agents/agents.controller.ts` | 新增 `POST /register-external` 端点 |
| 6 | `backend/src/agents/agents.module.ts` | 注册新 Service + Cron |

### 5.3 文档文件

| # | 文件 | 说明 |
|---|------|------|
| 7 | `docs/agent-access-guide.md` | 面向外部开发者: 接入步骤、API 参考、示例代码 |
| 8 | `docs/agent-card-spec.md` | Agent Card 规范（独立文档，可发给第三方） |

---

## 6. 实施任务

### Day 1 — 规范代码实现

| # | 任务 | 工时 |
|---|------|------|
| 1 | 创建 Agent Card JSON Schema + AJV 校验器 | 1.5h |
| 2 | 实现 `AgentCardService`（fetch/validate/generate） | 2h |
| 3 | 实现 `AgentsHealthCron`（定时探活 + 30/90/180s 状态计算） | 1.5h |
| 4 | 新增 `POST /agents/register-external` 端点 | 1h |
| 5 | 平台托管 Agent Card 自动生成逻辑 | 1h |

### Day 2 — 文档 + 联调

| # | 任务 | 工时 |
|---|------|------|
| 6 | 编写《Agent 接入技术文档》| 2h |
| 7 | 编写《Agent Card 规范文档》| 1h |
| 8 | 单元测试（Card 校验 + 心跳 + 注册流程） | 1.5h |
| 9 | 端到端测试（外部 Agent 注册→审核→上线→心跳→发现） | 1.5h |

---

## 7. 外部 Agent 示例

```json
// 一个最小可用的 agent-card.json
{
  "schema_version": "1.0",
  "name": "Python 爬虫助手",
  "description": "专注于网页数据采集、清洗和结构化输出的智能体",
  "version": "0.1.0",
  "provider": {
    "owner": "dev-team",
    "contact_email": "dev@example.com"
  },
  "endpoints": {
    "task": "https://my-agent.com/api/tasks",
    "health": "https://my-agent.com/api/health"
  },
  "auth": {
    "type": "bearer"
  },
  "capabilities": {
    "domains": ["data", "crawler"],
    "skills": ["python", "scrapy", "data-cleaning"],
    "models": ["gpt-4.1"],
    "input_formats": ["text", "url"],
    "output_formats": ["csv", "json"]
  },
  "pricing": {
    "model": "quote",
    "currency": "CNY",
    "minimum_price": 50
  },
  "limits": {
    "max_concurrent_tasks": 2,
    "timeout_seconds": 1800
  }
}
```

```bash
# 外部 Agent 心跳上报示例
curl -X POST https://platform.csi.shopping/api/v1/agents/:id/heartbeat \
  -H "Authorization: Bearer <agent_token>" \
  -H "Content-Type: application/json" \
  -d '{"status":"online","latency_ms":45,"load_metric":0.3}'
```

---

## 8. 验收标准

- [ ] Agent Card JSON Schema 固化，AJV 校验可用
- [ ] 外部 Agent Card URL 可抓取、解析、验证
- [ ] 平台托管 Agent Card 可自动生成
- [ ] 心跳 30/90/180s 规则生效，runtime_status 自动切换
- [ ] 外部 Agent 注册→审核→上线完整流程可走通
- [ ] 两份文档就绪（接入指南 + Card 规范）
- [ ] 外部开发者照着文档可在 30 分钟内完成接入
