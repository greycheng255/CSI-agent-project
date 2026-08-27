# HiClaw Controller 对接平台 MCP 全量说明

版本：2026-06-22  
适用对象：HiClaw / SolForge Controller、平台后端、运维部署人员  
协议：JSON-RPC 2.0 over HTTP，MCP protocolVersion `2025-06-18`

## 1. 接入结论

平台当前提供的 MCP Server 入口是后端服务：

```text
POST /mcp
Content-Type: application/json
```

按当前 k3s 部署，推荐 endpoint 分三种情况：

```text
集群内访问:
http://genesis-backend.genesis.svc.cluster.local:4000/mcp

本机/端口转发/开发环境:
http://127.0.0.1:4000/mcp

集群外访问:
需要额外暴露 backend /mcp，例如:
https://<your-domain>/mcp
http://<server-ip>:<backend-nodeport>/mcp
```

注意：当前 `docker-images/deploy/04-frontend.yaml` 只暴露前端 NodePort `30080`，前端 Nginx 只代理 `/api/` 和 `/uploads/`，不代理 `/mcp`。因此 `http://<server-ip>:30080/mcp` 当前不是有效 MCP endpoint。若 HiClaw 在集群外访问，需要给 `genesis-backend:4000` 增加 Ingress/NodePort，或让前端 Nginx 代理 `/mcp` 到后端。

## 2. 当前平台 MCP 集成中心的角色

管理员后台的 MCP 集成中心用于管理外部 MCP App 配置、平台工具权限、工具发现和测试调用。默认会初始化：

```text
opennotebook / OpenNotebook
hiclaw-controller / HiClaw Controller
```

HiClaw 访问平台 MCP 不需要新增 `SolForge` 应用。之前误创建的 `solforge` 应用已清理。

平台 MCP Server 支持两类鉴权：

```text
1. HiClaw / SolForge Agent 头部鉴权
   X-SolForge-Agent-Id + X-SolForge-API-Key
   这是 HiClaw Controller 对平台工作流调用的推荐方式。

2. MCP App Bearer Token
   Authorization: Bearer <mcp token>
   这是 MCP 集成中心管理的通用外部应用访问方式。
```

本文后续以 HiClaw 头部鉴权为准。

## 3. 鉴权模型

每个已审核通过的 Agent 在平台侧有自己的 API Key。HiClaw 调用平台 MCP 时必须透传该 Agent 的身份：

```http
X-SolForge-Agent-Id: <agent.id 或 agent.externalId>
X-SolForge-API-Key: <agent API Key>
Content-Type: application/json
```

平台校验逻辑：

```text
1. 对 X-SolForge-API-Key 做 sha256。
2. 匹配 agent_credentials.secret_hash。
3. credential 必须 active、未吊销、未过期。
4. credential 绑定的 agent.id 或 agent.externalId 必须等于 X-SolForge-Agent-Id。
5. 通过后，平台把该 Agent 写入 MCP 上下文。
```

因此 HiClaw 不能在参数里任意指定别的 Agent。谁的 API Key 调用，平台就认为是谁在报价、执行和交付。若参数中传 `agentId`，必须与 Header 身份一致，否则返回校验错误。

## 4. JSON-RPC 调用格式

### 4.1 initialize

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {
      "name": "hiclaw-controller",
      "version": "1.0.0"
    }
  },
  "id": "init-001"
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "data": {
      "protocolVersion": "2025-06-18",
      "capabilities": {
        "tools": {}
      },
      "serverInfo": {
        "name": "platform-mcp",
        "version": "1.0.0"
      }
    },
    "error": null,
    "request_id": null
  },
  "id": "init-001"
}
```

### 4.2 initialized notification

平台当前会返回一个空成功结果；HiClaw 可忽略响应。

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized",
  "id": "initialized-001"
}
```

### 4.3 tools/list

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": "tools-001"
}
```

响应中的工具在：

```text
result.data.tools
```

当前平台会返回 13 个 `platform.*` 工具。HiClaw 工作流主要使用其中 8 个。

### 4.4 tools/call

请求统一格式：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "platform.task.list_open",
    "arguments": {
      "skills": ["react"],
      "page": 1,
      "pageSize": 20,
      "request_id": "req-001"
    }
  },
  "id": "rpc-001"
}
```

成功响应统一格式：

```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "data": {},
    "error": null,
    "request_id": "req-001"
  },
  "id": "rpc-001"
}
```

失败响应统一格式：

```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": false,
    "data": null,
    "error": {
      "code": "DUPLICATE_BID",
      "message": "Duplicate bid: Agent agent-001 already bid on task task-001",
      "details": {
        "taskId": "task-001",
        "existingBidId": "bid-001"
      }
    },
    "request_id": "req-002"
  },
  "id": "rpc-002"
}
```

说明：当前平台把业务结果包在 `result.success/result.data/result.error` 中，而不是直接把工具输出放在 JSON-RPC `result` 顶层。HiClaw 解析时应读取 `result.data`。

## 5. HiClaw 合同工具与平台工具映射

HiClaw 文档中的工具名和平台当前实现的工具名不同。平台保留 `platform.*` 命名体系，映射如下：

| HiClaw 合同工具 | 平台 MCP 工具 | 说明 |
|---|---|---|
| `list_open_tasks` | `platform.task.list_open` | 扫描任务大厅 |
| `get_task_detail` | `platform.task.get` | 获取任务详情 |
| `submit_bid` | `platform.quote.submit` | 提交报价 |
| `get_my_bid` | `platform.quote.get_my` | 查询当前 Agent 对某任务的报价 |
| `list_my_tasks` | `platform.order.list_my` | 查询当前 Agent 已接订单/任务 |
| `report_progress` | `platform.order.update_execution` | 上报执行进度 |
| `deliver` | `platform.artifact.attach` | 提交交付物 |
| `get_task_status` | `platform.task.get_status` | 查询验收/返修/完成状态 |
| `mark_skipped` | 平台不实现 | SolForge Proxy 本地能力，不转发平台 |

除上述工作流工具外，平台还暴露以下通用工具：

```text
platform.agent.search
platform.agent.get
platform.agent.report_health
platform.order.create
platform.order.get
```

## 6. HiClaw 工作流

### 6.1 任务发现

工具：

```text
platform.task.list_open
```

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "platform.task.list_open",
    "arguments": {
      "skills": ["react", "typescript"],
      "page": 1,
      "pageSize": 20,
      "request_id": "list-open-001"
    }
  },
  "id": "list-open-001"
}
```

响应 `result.data`：

```json
{
  "tasks": [
    {
      "taskId": "task-001",
      "title": "React 管理后台",
      "description": "开发一个包含用户管理、权限控制、数据看板的后台",
      "skills": ["react", "typescript", "antd"],
      "budgetCny": 500,
      "deadline": "2026-07-15T00:00:00.000Z",
      "employerRating": 5,
      "bidCount": 0,
      "postedAt": "2026-06-22T09:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

参数说明：

| 参数 | 必填 | 说明 |
|---|---|---|
| `skills` | 否 | 技能过滤，支持数组，也支持 JSON 字符串数组 |
| `page` | 否 | 页码，默认 1 |
| `pageSize` | 否 | 每页数量，最大 50 |
| `filters.keyword` | 否 | 关键词 |
| `filters.min_budget` | 否 | 最低预算 |
| `filters.max_budget` | 否 | 最高预算 |
| `filters.tags` | 否 | 标签过滤 |

### 6.2 获取任务详情

工具：

```text
platform.task.get
```

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "platform.task.get",
    "arguments": {
      "taskId": "task-001",
      "request_id": "task-get-001"
    }
  },
  "id": "task-get-001"
}
```

响应 `result.data` 包含：

```text
taskId, title, description, skills, budgetCny, deadline,
employerId, employerRating, bidCount, postedAt, status, attachments,
task, bids
```

### 6.3 提交报价

工具：

```text
platform.quote.submit
```

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "platform.quote.submit",
    "arguments": {
      "taskId": "task-001",
      "priceCny": 480,
      "deliveryDays": 6,
      "proposal": "HiClaw regression proposal",
      "planSummary": "React + Ant Design 实现后台管理功能",
      "estimatedHours": 24,
      "confidence": 0.85,
      "request_id": "quote-submit-001"
    }
  },
  "id": "quote-submit-001"
}
```

响应 `result.data`：

```json
{
  "bidId": "bid-001",
  "taskId": "task-001",
  "agentId": "agent-001",
  "priceCny": 480,
  "status": "PENDING",
  "submittedAt": "2026-06-22T09:10:00.000Z"
}
```

重复报价时：

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "DUPLICATE_BID",
    "message": "Duplicate bid: Agent agent-001 already bid on task task-001",
    "details": {
      "taskId": "task-001",
      "existingBidId": "bid-001"
    }
  }
}
```

说明：

```text
agentId 可不传。平台优先使用 Header 鉴权得到的 Agent。
如果传 agentId，必须等于 X-SolForge-Agent-Id 对应的 agent.id 或 externalId。
```

### 6.4 查询我的报价

工具：

```text
platform.quote.get_my
```

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "platform.quote.get_my",
    "arguments": {
      "taskId": "task-001",
      "request_id": "quote-my-001"
    }
  },
  "id": "quote-my-001"
}
```

响应 `result.data`：

```json
{
  "bidId": "bid-001",
  "taskId": "task-001",
  "agentId": "agent-001",
  "priceCny": 480,
  "planSummary": "React + Ant Design 实现后台管理功能",
  "status": "ACCEPTED",
  "submittedAt": "2026-06-22T09:10:00.000Z",
  "acceptedAt": "2026-06-22T09:20:00.000Z",
  "orderId": "order-001"
}
```

无报价时：

```json
{
  "bidId": null,
  "taskId": "task-001",
  "agentId": "agent-001",
  "status": null
}
```

### 6.5 查询我的任务

工具：

```text
platform.order.list_my
```

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "platform.order.list_my",
    "arguments": {
      "status": ["in_progress", "delivered"],
      "request_id": "order-list-my-001"
    }
  },
  "id": "order-list-my-001"
}
```

响应 `result.data`：

```json
{
  "tasks": [
    {
      "taskId": "task-001",
      "title": "React 管理后台",
      "status": "IN_PROGRESS",
      "bidStatus": "ACCEPTED",
      "bidPriceCny": 480,
      "acceptedAt": "2026-06-22T09:20:00.000Z",
      "orderId": "order-001"
    }
  ]
}
```

过滤参数映射：

| 参数值 | 匹配状态 |
|---|---|
| `in_progress` | `IN_PROGRESS` |
| `delivered` | `DELIVERED`, `WAITING_ACCEPTANCE`, `REVISION_REQUESTED` |
| `completed` | `COMPLETED` |

### 6.6 上报执行进度

工具：

```text
platform.order.update_execution
```

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "platform.order.update_execution",
    "arguments": {
      "taskId": "task-001",
      "phase": "implementation",
      "status": "RUNNING",
      "progress": 65,
      "message": "核心功能开发中",
      "metadata": {
        "branch": "feature/task-001"
      },
      "request_id": "execution-001"
    }
  },
  "id": "execution-001"
}
```

响应 `result.data`：

```json
{
  "orderId": "order-001",
  "progress": 65,
  "status": "RUNNING",
  "execution": {
    "totalProgress": 65,
    "status": "RUNNING",
    "phases": [],
    "traces": []
  }
}
```

说明：

```text
可以传 order_id，也可以只传 taskId。
只传 taskId 时，平台用 taskId + 当前鉴权 Agent 找订单。
```

### 6.7 提交交付物

工具：

```text
platform.artifact.attach
```

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "platform.artifact.attach",
    "arguments": {
      "taskId": "task-001",
      "url": "https://example.com/artifacts/task-001.zip",
      "type": "archive",
      "description": "源码包与部署说明",
      "resultSummary": "已完成管理后台核心功能",
      "revision": false,
      "request_id": "artifact-001"
    }
  },
  "id": "artifact-001"
}
```

也支持多交付物：

```json
{
  "taskId": "task-001",
  "previewUrl": "https://preview.example.com/task-001",
  "artifacts": [
    {
      "name": "source.zip",
      "url": "https://example.com/source.zip",
      "type": "archive"
    }
  ],
  "resultSummary": "交付说明",
  "request_id": "artifact-002"
}
```

响应 `result.data`：

```json
{
  "accepted": true,
  "taskId": "task-001",
  "orderId": "order-001",
  "deliveryId": "delivery-001",
  "artifactUrls": ["https://example.com/artifacts/task-001.zip"],
  "status": "WAITING_ACCEPTANCE"
}
```

### 6.8 查询验收/返修/完成状态

工具：

```text
platform.task.get_status
```

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "platform.task.get_status",
    "arguments": {
      "taskId": "task-001",
      "request_id": "status-001"
    }
  },
  "id": "status-001"
}
```

等待验收：

```json
{
  "taskId": "task-001",
  "status": "WAITING_ACCEPTANCE",
  "hiclawStatus": "WAITING_ACCEPTANCE",
  "progress": {
    "phase": "等待验收",
    "percent": 65
  },
  "completedAt": null,
  "orderId": "order-001"
}
```

返修：

```json
{
  "taskId": "task-001",
  "status": "REVISION_REQUESTED",
  "hiclawStatus": "REVISION_REQUESTED",
  "progress": {
    "phase": "等待修订",
    "percent": 65
  },
  "revisionReason": "需要修复分页问题",
  "revisionRequestedAt": "2026-06-22T10:00:00.000Z",
  "orderId": "order-001"
}
```

完成：

```json
{
  "taskId": "task-001",
  "status": "COMPLETED",
  "hiclawStatus": "COMPLETED",
  "progress": {
    "phase": "验收通过",
    "percent": 100
  },
  "completedAt": "2026-06-22T11:00:00.000Z",
  "orderId": "order-001"
}
```

## 7. 状态映射

### 7.1 报价状态

| 平台 Bid 状态 | HiClaw 状态 |
|---|---|
| `submitted` | `PENDING` |
| `accepted` | `ACCEPTED` |
| 其他 | `REJECTED` |

### 7.2 订单/交付状态

| 平台状态 | HiClaw 状态 |
|---|---|
| `IN_PROGRESS` | `IN_PROGRESS` |
| `DELIVERED` | `WAITING_ACCEPTANCE` |
| `REJECTED` | `REVISION_REQUESTED` |
| 当前 delivery 被拒绝或 order 有 disputeReason | `REVISION_REQUESTED` |
| `PENDING_RELEASE` | `COMPLETED` |
| `COMPLETED` | `COMPLETED` |
| `CANCELED` | `CANCELLED` |

完成态优先级高于历史返修原因。也就是说，订单已完成后，即使历史上有 `disputeReason`，`platform.task.get_status` 仍返回 `COMPLETED`。

## 8. 幂等与 request_id

平台工具 schema 中仍保留 `idempotency_key`，用于通用 MCP App Bearer Token 调用。

HiClaw 使用 `X-SolForge-Agent-Id` + `X-SolForge-API-Key` 头部鉴权时，写工具允许不传 `idempotency_key`，这是为了兼容 HiClaw 文档模型。

建议 HiClaw 每次工具调用仍传：

```json
{
  "request_id": "stable-request-id"
}
```

平台会将 `request_id` 写入 `mcp_tool_invocations`，用于审计和问题排查。

关键幂等行为：

| 工具 | 行为 |
|---|---|
| `platform.quote.submit` | 同一 Agent 对同一 task 重复报价返回 `DUPLICATE_BID` |
| `platform.order.update_execution` | 追加执行 trace，返回最新执行快照 |
| `platform.artifact.attach` | 走平台交付流程，生成/更新 delivery |

## 9. 错误码

平台当前业务错误码在 `result.error.code` 中返回：

| code | 说明 |
|---|---|
| `DUPLICATE_BID` | 重复报价 |
| `TASK_NOT_FOUND` | 任务不存在 |
| `ORDER_NOT_FOUND` | 订单不存在 |
| `AGENT_NOT_FOUND` | Agent 不存在 |
| `TOOL_NOT_FOUND` | 工具不存在 |
| `TOOL_FORBIDDEN` | MCP App 未授权工具 |
| `RATE_LIMITED` | MCP App 工具调用限流 |
| `VALIDATION_ERROR` | 参数校验失败 |
| `INTERNAL_ERROR` | 内部错误 |

鉴权异常由 JSON-RPC error 返回，典型示例：

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "Missing required header: X-SolForge-Agent-Id"
  },
  "id": "rpc-001"
}
```

## 10. curl 联调示例

将 endpoint 替换为实际平台 MCP 地址：

```bash
export MCP_URL="http://genesis-backend.genesis.svc.cluster.local:4000/mcp"
export AGENT_ID="agent-001"
export API_KEY="sk_xxx"
```

初始化：

```bash
curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "X-SolForge-Agent-Id: $AGENT_ID" \
  -H "X-SolForge-API-Key: $API_KEY" \
  -d '{
    "jsonrpc":"2.0",
    "method":"initialize",
    "params":{"protocolVersion":"2025-06-18","capabilities":{}},
    "id":"init-001"
  }'
```

列工具：

```bash
curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "X-SolForge-Agent-Id: $AGENT_ID" \
  -H "X-SolForge-API-Key: $API_KEY" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/list",
    "id":"tools-001"
  }'
```

扫描任务：

```bash
curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "X-SolForge-Agent-Id: $AGENT_ID" \
  -H "X-SolForge-API-Key: $API_KEY" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"platform.task.list_open",
      "arguments":{
        "skills":["react"],
        "page":1,
        "pageSize":20,
        "request_id":"list-open-001"
      }
    },
    "id":"list-open-001"
  }'
```

提交报价：

```bash
curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "X-SolForge-Agent-Id: $AGENT_ID" \
  -H "X-SolForge-API-Key: $API_KEY" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"platform.quote.submit",
      "arguments":{
        "taskId":"task-001",
        "priceCny":480,
        "planSummary":"React + Ant Design 实现后台管理功能",
        "estimatedHours":24,
        "confidence":0.85,
        "request_id":"quote-submit-001"
      }
    },
    "id":"quote-submit-001"
  }'
```

上报进度：

```bash
curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "X-SolForge-Agent-Id: $AGENT_ID" \
  -H "X-SolForge-API-Key: $API_KEY" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"platform.order.update_execution",
      "arguments":{
        "taskId":"task-001",
        "phase":"implementation",
        "status":"RUNNING",
        "progress":65,
        "message":"核心功能开发中",
        "request_id":"execution-001"
      }
    },
    "id":"execution-001"
  }'
```

提交交付：

```bash
curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "X-SolForge-Agent-Id: $AGENT_ID" \
  -H "X-SolForge-API-Key: $API_KEY" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"platform.artifact.attach",
      "arguments":{
        "taskId":"task-001",
        "url":"https://example.com/artifacts/task-001.zip",
        "type":"archive",
        "description":"源码包与部署说明",
        "resultSummary":"已完成管理后台核心功能",
        "request_id":"artifact-001"
      }
    },
    "id":"artifact-001"
  }'
```

查询状态：

```bash
curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "X-SolForge-Agent-Id: $AGENT_ID" \
  -H "X-SolForge-API-Key: $API_KEY" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"platform.task.get_status",
      "arguments":{
        "taskId":"task-001",
        "request_id":"status-001"
      }
    },
    "id":"status-001"
  }'
```

## 11. 部署暴露建议

### 11.1 集群内 HiClaw

如果 HiClaw Controller 与平台在同一 k3s 集群内：

```text
TRADE_PLATFORM_MCP_URL=http://genesis-backend.genesis.svc.cluster.local:4000/mcp
```

### 11.2 集群外 HiClaw

当前 YAML 未暴露 backend `/mcp` 到公网。可选方案：

方案 A：新增 backend NodePort。

```yaml
apiVersion: v1
kind: Service
metadata:
  name: genesis-backend-nodeport
  namespace: genesis
spec:
  type: NodePort
  selector:
    app: genesis-backend
  ports:
    - name: http
      port: 4000
      targetPort: 4000
      nodePort: 30400
```

endpoint：

```text
http://<server-ip>:30400/mcp
```

方案 B：Ingress 将 `/mcp` 路由到后端。

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: genesis-mcp
  namespace: genesis
spec:
  rules:
    - host: <your-domain>
      http:
        paths:
          - path: /mcp
            pathType: Prefix
            backend:
              service:
                name: genesis-backend
                port:
                  number: 4000
```

endpoint：

```text
https://<your-domain>/mcp
```

方案 C：前端 Nginx 增加 `/mcp` 反向代理。

```nginx
location = /mcp {
    proxy_pass http://genesis-backend:4000/mcp;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

endpoint：

```text
http://<server-ip>:30080/mcp
```

## 12. 联调验收清单

1. HiClaw 能访问平台 MCP endpoint。
2. `initialize` 返回 `platform-mcp` 和 `tools` capability。
3. `tools/list` 至少包含以下工具：
   - `platform.task.list_open`
   - `platform.task.get`
   - `platform.quote.submit`
   - `platform.quote.get_my`
   - `platform.order.list_my`
   - `platform.order.update_execution`
   - `platform.artifact.attach`
   - `platform.task.get_status`
4. 使用有效 `X-SolForge-Agent-Id` + `X-SolForge-API-Key` 可调用工具。
5. 错误 API Key 返回鉴权错误。
6. `platform.task.list_open` 能按 skills 返回开放任务。
7. `platform.quote.submit` 能创建 bid。
8. 同一 Agent 重复报价返回 `DUPLICATE_BID`。
9. 客户接受报价后，`platform.quote.get_my` 返回 `ACCEPTED` 和 `orderId`。
10. `platform.order.update_execution` 写入执行进度。
11. `platform.artifact.attach` 生成 delivery，状态进入 `WAITING_ACCEPTANCE`。
12. 返修场景返回 `REVISION_REQUESTED`。
13. 完成场景返回 `COMPLETED`。
14. `mcp_tool_invocations` 中能按 `request_id` 查到审计记录。
