# MCP 接入对接文档

本文档用于指导外部应用通过平台的 MCP 集成中心接入 Genesis 平台。关联方需按本文要求提供 MCP 能力、鉴权信息、工具定义、任务状态接口和联调材料，平台侧完成注册、发现工具、授权、联调、验收和上线。

## 1. 接入目标

外部应用接入平台后，应支持以下一种或两种集成模式：

1. 平台调用外部应用：外部应用提供 MCP Server，平台通过 `tools/list` 发现能力，通过 `tools/call` 调用外部工具。
2. 外部应用调用平台：平台为外部应用签发 MCP Token，外部应用调用平台 `/mcp`，使用授权后的平台工具查询任务、提交报价、更新执行进度、上传交付物。

如业务涉及平台任务外包执行，推荐采用双向集成：

1. 平台向外部应用提交任务。
2. 外部应用返回外部任务 ID。
3. 平台定期轮询外部任务状态。
4. 外部任务完成后，平台将结果写入订单交付记录。

## 2. 关联方必须提供的信息

### 2.1 应用基础信息

关联方需提供：

| 字段 | 是否必填 | 说明 | 示例 |
| --- | --- | --- | --- |
| `code` | 是 | 应用唯一编码，只允许稳定标识，不建议频繁变更 | `external-runner` |
| `name` | 是 | 应用展示名称 | `External Runner` |
| `description` | 是 | 应用能力说明 | `代码执行与结果生成服务` |
| `owner` | 是 | 技术负责人姓名、邮箱、联系方式 | `张三 / zhangsan@example.com` |
| `env` | 是 | 环境说明 | `test`、`prod` |
| `callback_contact` | 是 | 故障联络方式 | 企业微信群、邮箱、电话 |

### 2.2 MCP Server 信息

关联方需提供可访问的 MCP Server endpoint：

| 字段 | 是否必填 | 说明 |
| --- | --- | --- |
| `endpointUrl` | 是 | MCP Server 地址，必须为 `http` 或 `https` URL，生产环境必须使用 `https` |
| `transport` | 是 | 当前平台支持 `streamable-http` 或 `http-jsonrpc` |
| `authMode` | 是 | 当前平台支持 `none`、`bearer`、`headers` |
| `testAuthConfig` | 测试环境必填 | 测试环境鉴权参数 |
| `prodAuthConfig` | 生产环境必填 | 生产环境鉴权参数，应通过安全渠道传递 |
| `timeoutSla` | 是 | 单次调用最大耗时建议，平台侧调用超时上限为 30 秒 |

### 2.3 MCP 协议要求

外部 MCP Server 必须支持 JSON-RPC 2.0：

#### 工具发现

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": "tools-list-001"
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      {
        "name": "external_task_submit",
        "description": "Submit a platform task to external system.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "task_id": { "type": "string" },
            "order_id": { "type": "string" },
            "payload": { "type": "object" }
          },
          "required": ["task_id", "payload"]
        }
      }
    ]
  },
  "id": "tools-list-001"
}
```

#### 工具调用

请求：

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "external_task_submit",
    "arguments": {
      "task_id": "platform-task-id",
      "order_id": "platform-order-id",
      "payload": {
        "title": "任务标题",
        "description": "任务描述"
      }
    }
  },
  "id": "tools-call-001"
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "result": {
    "task_id": "external-task-id",
    "status": "submitted"
  },
  "id": "tools-call-001"
}
```

## 3. 关联方必须提供的工具能力

### 3.1 最小工具集

如外部应用只提供普通能力调用，至少提供：

| 工具 | 是否必填 | 用途 |
| --- | --- | --- |
| `tools/list` | 是 | 平台发现外部应用工具 |
| `tools/call` | 是 | 平台调用外部工具 |
| 至少一个业务工具 | 是 | 例如生成、分析、执行、查询等能力 |

### 3.2 任务型接入工具集

如外部应用要承接平台任务，必须提供：

| 工具建议命名 | 是否必填 | 用途 | 响应要求 |
| --- | --- | --- | --- |
| `{app_code}_task_submit` | 是 | 接收平台任务并创建外部任务 | 必须返回 `task_id`、`taskId`、`external_task_id` 或 `externalTaskId` 之一 |
| `{app_code}_task_status` | 是 | 查询外部任务状态 | 必须返回 `status`，建议返回 `is_final`、`progress`、`result_url`、`result_data`、`cost`、`error` |
| `{app_code}_agent_catalog` | 可选 | 同步外部应用能力目录 | 返回 models、agents 或 workflows |

任务状态响应示例：

```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "completed",
    "is_final": true,
    "progress": "100",
    "result_url": "https://example.com/results/external-task-id",
    "result_data": {
      "summary": "任务已完成",
      "artifacts": [
        {
          "name": "result.zip",
          "url": "https://example.com/artifacts/result.zip"
        }
      ]
    },
    "cost": 12.5,
    "error": null
  },
  "id": "tools-call-002"
}
```

平台会将以下状态视为终态：

| 状态 | 含义 |
| --- | --- |
| `done` | 已完成 |
| `completed` | 已完成 |
| `success` | 成功 |
| `failed` | 失败 |
| `error` | 错误 |

## 4. 外部应用调用平台的能力

平台可为外部应用签发 MCP Token。外部应用使用 Bearer Token 调用平台 MCP endpoint：

```http
POST /mcp
Authorization: Bearer <mcp_token>
Content-Type: application/json
```

### 4.1 查询可用平台工具

```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": "platform-tools-001"
}
```

平台只返回当前应用已授权的工具。

### 4.2 调用平台工具

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "platform.order.update_execution",
    "arguments": {
      "order_id": "platform-order-id",
      "status": "RUNNING",
      "progress": 30,
      "message": "外部应用已开始执行",
      "idempotency_key": "external-runner-update-001",
      "request_id": "req-001"
    }
  },
  "id": "call-001"
}
```

写操作必须传 `idempotency_key`。建议格式：

```text
{app_code}-{business_type}-{uuid}
```

### 4.3 平台可授权工具

| 工具名 | 类型 | 用途 |
| --- | --- | --- |
| `platform.agent.search` | 读 | 搜索平台 Agent |
| `platform.agent.get` | 读 | 获取 Agent 详情 |
| `platform.agent.report_health` | 写 | 上报 Agent 健康状态 |
| `platform.task.get` | 读 | 获取任务详情 |
| `platform.task.list_open` | 读 | 查询开放任务列表 |
| `platform.quote.submit` | 写 | 为开放任务提交报价 |
| `platform.order.create` | 写 | 基于已选报价创建订单 |
| `platform.order.get` | 读 | 获取订单详情 |
| `platform.order.update_execution` | 写 | 回写订单执行状态和进度 |
| `platform.artifact.attach` | 写 | 上传或关联订单交付物 |

实际授权范围以集成中心配置为准。生产环境按最小权限原则开通。

## 5. 平台侧配置流程

### 5.1 创建应用

```http
POST /api/v1/admin/mcp-integrations/apps
```

请求示例：

```json
{
  "code": "external-runner",
  "name": "External Runner",
  "description": "外部任务执行系统",
  "direction": "bidirectional",
  "transport": "streamable-http",
  "endpointUrl": "https://example.com/mcp",
  "authMode": "bearer",
  "enabled": true
}
```

### 5.2 发现外部工具

```http
POST /api/v1/admin/mcp-integrations/apps/:id/discover-tools
```

请求示例：

```json
{
  "authConfig": {
    "bearerToken": "external-test-token"
  }
}
```

### 5.3 审核和启停外部工具

```http
GET /api/v1/admin/mcp-integrations/apps/:id/tools
PATCH /api/v1/admin/mcp-integrations/tools/:toolId
```

### 5.4 配置外部应用可调用的平台工具

```http
GET /api/v1/admin/mcp-integrations/apps/:id/platform-tools
PATCH /api/v1/admin/mcp-integrations/apps/:id/platform-tools/:toolName
```

请求示例：

```json
{
  "enabled": true,
  "rateLimitPerMinute": 60
}
```

### 5.5 签发外部应用调用平台的 Token

```http
POST /api/v1/admin/mcp-integrations/apps/:id/token
```

Token 只展示一次，关联方必须安全保存。泄露后需重新签发并替换。

### 5.6 联调外部工具

```http
POST /api/v1/admin/mcp-integrations/apps/:id/test/external-call
```

请求示例：

```json
{
  "name": "external_task_submit",
  "arguments": {
    "task_id": "platform-task-id",
    "payload": {
      "title": "测试任务"
    }
  },
  "timeoutMs": 30000,
  "authConfig": {
    "bearerToken": "external-test-token"
  }
}
```

### 5.7 联调平台工具

```http
POST /api/v1/admin/mcp-integrations/apps/:id/test/platform-call
```

请求示例：

```json
{
  "name": "platform.task.list_open",
  "arguments": {
    "limit": 10,
    "offset": 0,
    "request_id": "req-list-open-001"
  }
}
```

## 6. 任务绑定流程

### 6.1 提交外部任务

```http
POST /api/v1/admin/mcp-integrations/apps/:id/task-bindings/submit
```

请求示例：

```json
{
  "platformTaskId": "platform-task-id",
  "platformOrderId": "platform-order-id",
  "toolName": "external_task_submit",
  "arguments": {
    "task_id": "platform-task-id",
    "order_id": "platform-order-id",
    "payload": {
      "title": "任务标题",
      "description": "任务需求"
    }
  },
  "timeoutMs": 30000,
  "authConfig": {
    "bearerToken": "external-test-token"
  }
}
```

平台会记录：

| 字段 | 说明 |
| --- | --- |
| `platformTaskId` | 平台任务 ID |
| `platformOrderId` | 平台订单 ID |
| `externalTaskId` | 外部应用返回的任务 ID |
| `externalToolName` | 外部提交工具名 |
| `status` | 外部任务状态 |

### 6.2 轮询外部任务状态

```http
POST /api/v1/admin/mcp-integrations/task-bindings/:id/poll
```

请求示例：

```json
{
  "statusToolName": "external_task_status",
  "arguments": {
    "task_id": "external-task-id"
  },
  "timeoutMs": 30000,
  "authConfig": {
    "bearerToken": "external-test-token"
  },
  "deliverOnFinal": true
}
```

当 `deliverOnFinal` 不为 `false`，且外部任务首次进入成功终态并绑定了 `platformOrderId` 时，平台会根据返回结果创建订单交付记录。

## 7. 错误码和异常要求

关联方应稳定返回错误结构，便于平台审计和排查。

错误响应示例：

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "External task not found"
  },
  "id": "tools-call-003"
}
```

或：

```json
{
  "jsonrpc": "2.0",
  "result": {
    "isError": true,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "payload is required"
    }
  },
  "id": "tools-call-004"
}
```

建议至少定义：

| 错误码 | 场景 |
| --- | --- |
| `UNAUTHORIZED` | 鉴权失败 |
| `FORBIDDEN` | 权限不足 |
| `VALIDATION_ERROR` | 参数校验失败 |
| `TASK_NOT_FOUND` | 外部任务不存在 |
| `TASK_FAILED` | 外部任务执行失败 |
| `RATE_LIMITED` | 触发限流 |
| `INTERNAL_ERROR` | 服务内部错误 |
| `TIMEOUT` | 执行超时 |

## 8. 安全要求

1. 生产 endpoint 必须使用 `https`。
2. 生产 token、header secret、访问密钥必须通过安全渠道传递，不得写入普通文档或聊天记录。
3. 外部应用调用平台时必须使用平台签发的 MCP Token。
4. 写操作必须传 `idempotency_key`，避免重复执行。
5. 平台只为外部应用开通必要工具，禁止默认开放全部写权限。
6. 关联方需提供限流建议和熔断策略。
7. 关联方需保留请求日志，至少包含 `request_id`、`jsonrpc id`、工具名、耗时、状态、错误信息。

## 9. 联调验收清单

| 项目 | 验收标准 | 结果 |
| --- | --- | --- |
| 应用注册 | 集成中心可创建并查询应用 | 待验收 |
| 工具发现 | `discover-tools` 能正确拉取工具列表 | 待验收 |
| 外部工具调用 | `test/external-call` 成功返回业务结果 | 待验收 |
| 平台工具授权 | 外部应用只能看到已授权工具 | 待验收 |
| 平台工具调用 | 外部应用可调用授权读工具 | 待验收 |
| 写工具幂等 | 写工具不传 `idempotency_key` 会失败，重复 key 不重复执行业务 | 待验收 |
| 任务提交 | 外部应用返回可识别的 `externalTaskId` | 待验收 |
| 状态轮询 | 平台能获取进度、终态、结果或错误 | 待验收 |
| 交付回写 | 成功终态可生成订单交付记录 | 待验收 |
| 鉴权失败 | 错误 token 无法访问 | 待验收 |
| 超时失败 | 超时场景有明确错误并可审计 | 待验收 |
| 调用审计 | 集成中心可查看调用记录和错误详情 | 待验收 |

## 10. 上线流程

1. 关联方提交本文第 2、3、7、8 节要求的材料。
2. 平台在测试环境创建应用并配置 endpoint。
3. 平台执行工具发现和 schema 审核。
4. 双方完成读工具、写工具、任务提交、状态轮询、交付回写联调。
5. 平台配置最小权限和限流。
6. 关联方提供生产 endpoint 和生产鉴权信息。
7. 平台生产环境灰度开启。
8. 观察调用成功率、错误率、平均耗时和任务完成率。
9. 灰度稳定后扩大使用范围。

## 11. 交付物清单

关联方最终需交付：

1. 应用基础信息表。
2. 测试和生产 MCP endpoint。
3. 鉴权方式说明及密钥交付方式。
4. 完整工具清单和 JSON Schema。
5. 任务提交工具说明。
6. 任务状态查询工具说明。
7. 成功、失败、超时、鉴权失败响应样例。
8. 错误码表。
9. 限流、超时、重试、幂等策略说明。
10. 联调负责人和故障升级路径。

