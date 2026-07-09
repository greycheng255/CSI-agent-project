# 20260709 业务流程改造实施方案

## 背景

当前平台的长任务执行已经转向“平台 MCP + HiClaw Controller”模式：

- 平台负责发布任务、报价、中标、订单、执行进度、交付物、事件 ACK、Agent 凭证与健康上报等 MCP 能力。
- HiClaw Controller 使用 `X-SolForge-Agent-Id` 与 `X-SolForge-API-Key` 访问平台 `/mcp`，主动拉取任务、报价、查询中标订单、回写进度与交付物。
- 平台不再通过本地 `genesis-agent` 实例、`openclaw-bridge` 或 heartbeat sidecar 主动驱动系统创建 Agent 执行任务。

## 改造目标

1. 保留平台现有任务、报价、订单、交付、执行记录、Agent 凭证、MCP 工具体系。
2. 断开旧执行链路：
   - 任务创建后不再默认向旧 Agent webhook 推送任务。
   - 支付完成后不再默认通过 webhook 触发旧 Agent 自动执行。
   - 手动重试不再调用 `openclaw-bridge`，也不再回退到旧 webhook。
3. 启动与部署配置不再启动 `genesis-agent`、`openclaw-bridge`、`genesis-agent-heartbeat`。
4. 后续外部自管 Agent 的 webhook 模式保留为显式兼容能力，由独立开关开启，不作为平台系统 Agent 默认执行路径。

## 实施范围

### 后端业务流

- `TasksService`
  - 增加旧任务 webhook 投递开关，默认关闭。
  - 任务发布后只进入平台任务市场/MCP 可发现状态，不主动推送给旧 runtime。

- `WebhooksService`
  - 保留 webhook 投递记录与失败重试能力。
  - 增加旧 runtime webhook 总开关，默认关闭。
  - `notifyOrderPaid` 在默认情况下只记录跳过日志，不再触发旧 Agent 执行。

- `ExecutionService`
  - `retryExecution` 只重置订单和执行计划状态，记录“等待 HiClaw 通过 MCP 重新拉取/回写”的审计轨迹。
  - 移除 `OPENCLAW_BRIDGE_URL` 调用与 direct webhook fallback。

### 启动与部署

- 根目录 `docker-compose.yml`
  - 移除 `genesis-agent` 与 `openclaw-bridge` 服务。
  - 移除后端 `OPENCLAW_BRIDGE_URL`。
  - `AUTO_EXECUTION_ENABLED` 默认改为 `false`。

- `docker-images/docker-compose.yml`
  - 与根目录 compose 保持一致。

- `docker-images/deploy/deploy.sh`
  - 不再 apply `05-bridge.yaml`、`06-agent-main.yaml`、`07-agent-heartbeat.yaml`。

- `docker-images/deploy/03-backend.yaml`
  - 移除 `OPENCLAW_BRIDGE_URL`。
  - `AUTO_EXECUTION_ENABLED` 默认改为 `false`。

- `k8s/backend-deployment.yaml`
  - 移除 `OPENCLAW_BRIDGE_URL`。
  - `AUTO_EXECUTION_ENABLED` 默认改为 `false`。

- `build-and-deploy.sh`
  - 构建包只包含 backend/frontend。
  - 不再构建、导出、更新 bridge/agent 镜像。

## 保留能力

- MCP endpoint：`POST /mcp`
- HiClaw 鉴权头：
  - `X-SolForge-Agent-Id`
  - `X-SolForge-API-Key`
- MCP 工具：
  - `platform.task.list_open`
  - `platform.task.get`
  - `platform.quote.submit`
  - `platform.quote.get_my`
  - `platform.event.list_my`
  - `platform.event.ack`
  - `platform.order.list_my`
  - `platform.order.get`
  - `platform.order.update_execution`
  - `platform.artifact.attach`
  - `platform.task.get_status`
  - `platform.agent.report_health`
  - `platform.agent.search`
  - `platform.agent.get`

## 验证计划

1. 后端构建通过。
2. 前端构建通过。
3. 检查配置中不再有默认启用的 `openclaw-bridge`、`genesis-agent`、`genesis-agent-heartbeat` 启动路径。
4. 检查 MCP HiClaw 工具测试仍可执行：
   - 报价幂等
   - 中标订单查询
   - 事件 ACK 防重
   - 执行进度回写
   - 交付物上传/绑定
