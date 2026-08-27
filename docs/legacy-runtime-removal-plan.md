# 旧执行链路清理与新链路保护方案

更新时间：2026-06-28

## 1. 背景

当前平台同时存在两类任务链路：

1. 智能体集市的即时任务  
   这部分来自 noteBook 前端迁移。当前执行层通过 OpenNotebook API 调用完成，配置入口在前端环境变量中，例如 `VITE_AGENT_OPENNOTEBOOK_REST_BASE` 和 `VITE_AGENT_OPENNOTEBOOK_MCP_ENDPOINT`。它不走任务大厅，也不需要长任务的竞标、接单流程。

2. 任务大厅的长任务  
   这部分是平台主链路。任务发布后，由智能体广场中的长任务 agent 参与报价、接单和执行。当前目标链路是通过平台 `/mcp` 能力与 HiClaw 或外部自管 agent 交互，而不是旧的本地 `genesis-agent runtime` 绑定 `OpenClaw bridge` 执行。

旧链路中的 `genesis-agent runtime`、`OpenClaw bridge`、OpenClaw 实例绑定、K8s agent 部署逻辑，已经不属于当前目标执行链路。后续可以分阶段清理，但必须确保不影响：

- 智能体集市即时任务
- 任务大厅长任务
- 智能体广场 agent 展示
- MCP 报价、执行进度、交付物回传
- 我的任务详情页的数据展示

## 2. 新链路保护边界

清理旧链路时，以下能力必须保留。

### 2.1 智能体集市即时任务

保留：

- `frontend/src/pages/AgentMarketHub.tsx`
- `frontend/src/pages/AgentRun.tsx`
- `frontend/src/features/agent-market/plugins/*`
- `frontend/src/data/agentMarketCatalog.ts`
- `frontend/src/api/agentMarketApi.ts`
- OpenNotebook API 相关环境变量

保护目标：

- 集市页面能打开
- agent 卡片能进入运行页
- 可用的 OpenNotebook agent 能正常请求远端 API
- 不引入任务大厅竞标逻辑

### 2.2 任务大厅长任务 MCP 链路

保留平台 `/mcp` 入口及核心工具：

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

保护目标：

- HiClaw 可以通过 MCP 获取任务、报价、查询中标结果
- HiClaw 可以通过 MCP 回传执行进度
- HiClaw 可以通过 MCP 提交交付物
- 外部自管 agent 仍可通过 agent id 和 api key 接入

### 2.3 智能体广场展示

保留：

- agent 注册、审核、启用状态
- agent 凭证
- agent 心跳数据
- `GET /api/v1/agents/discover`
- 前端智能体广场页面

当前展示条件应继续保持：

```text
approvalStatus = approved
isActive = true
visibility = public
runtimeStatus in (online, degraded)
```

清理旧链路后，心跳来源应逐步收敛到：

- HiClaw 通过 MCP `platform.agent.report_health` 上报
- 外部自管 agent 通过 MCP `platform.agent.report_health` 上报

不再依赖 `genesis-agent runtime` 心跳。

### 2.4 任务详情页数据

保留：

- execution phases
- execution traces
- delivery history
- acceptance checklist

数据来源原则：

- 执行计划和执行进度应来自平台后端真实执行数据，后续由 HiClaw 通过 MCP 写入
- 交付历史来自平台 delivery 表，由 `platform.artifact.attach` 或平台交付接口生成
- 验收检查清单来自平台根据 task acceptance criteria 生成和维护，不属于旧 OpenClaw 链路

前端不应把旧的本地 mock 执行计划伪装成真实进度。这个点后续应单独安排修复。

## 3. 可清理范围

以下内容属于旧链路，原则上可以分阶段移除。

### 3.1 独立旧模块

- `genesis-agent/`
- `openclaw-bridge/`
- `openclaw-cli/`
- `openclaw-bind-cli/`

说明：

- `genesis-agent/` 是旧的本地 agent runtime，负责扫描任务、提交报价、心跳、接收 webhook、调用 OpenClaw bridge。
- `openclaw-bridge/` 是旧的 OpenClaw HTTP 适配层，提供 `/health`、`/api/v1/analyze`、`/api/v1/execute`。
- 当前新链路中，长任务执行由 HiClaw 或外部自管 agent 负责，不再需要平台内置这两个 runtime。

### 3.2 后端旧入口

候选清理文件：

- `backend/src/agents/agent-manager.controller.ts`
- `backend/src/agents/agent-manager.service.ts`
- `backend/src/agents/agent-bind.controller.ts`

候选清理能力：

- K8s 部署 genesis-agent
- 销毁、重启、查看 agent pod
- 绑定、解绑 OpenClaw 实例
- OpenClaw URL 更新
- OpenClaw 实例健康检查

### 3.3 后端旧执行通知

候选清理点：

- task 创建后自动创建 webhook delivery 并推送给旧 agent
- order 支付后通过 webhook 推送旧 agent 执行
- delivery、accepted、completed、rejected 等旧 webhook 通知
- `ExecutionService` 中直接调用 `OPENCLAW_BRIDGE_URL` 的重试逻辑

注意：

`WebhookDelivery` 表和历史数据先不要直接删除。它可能还被后台详情页、审计或历史数据查看引用。第一阶段只断开旧执行入口，不急着删表。

### 3.4 前端旧管理界面

候选清理文件：

- `frontend/src/components/OpenclawBindModal.tsx`
- `frontend/src/components/OpenclawBindGuide.tsx`

候选清理点：

- Agent 管理页中的 OpenClaw 绑定状态
- Agent 管理页中的 K8s runtime 操作说明
- Agent 详情页中的 webhook/OpenClaw 状态
- API 文档页中的旧 webhook/OpenClaw 接入说明

### 3.5 部署文件

候选清理文件：

- `k8s/genesis-agent-template.yaml`
- `k8s/genesis-agent-deployment.yaml`
- `k8s/openclaw-bridge.yaml`
- `k8s/openclaw-bridge-rbac.yaml`
- `k8s/openclaw-agent-deployment.yaml`
- `k8s/openclaw-bidding.yaml`
- `k8s/agent-heartbeat.yaml`
- `k8s/agent-heartbeat-cronjob.yaml`
- `docker-images/deploy/05-bridge.yaml`
- `docker-images/deploy/06-agent-main.yaml`
- `docker-images/deploy/07-agent-heartbeat.yaml`

后续新链路部署重点应回到普通平台部署：

- frontend
- backend
- database
- redis 或队列，如果当前环境需要
- object storage，如果交付物上传依赖它

HiClaw 自身如何部署由 HiClaw 侧负责，平台只暴露 MCP 与 REST 能力。

## 4. 暂不删除范围

以下内容先保留，直到确认没有新链路依赖。

### 4.1 Agent 基础模型

保留：

- Agent entity
- AgentCredential entity
- AgentHeartbeat entity
- agent runtimeStatus
- agent approvalStatus
- agent isActive
- agent visibility

原因：

智能体广场展示、MCP 鉴权、HiClaw 心跳、外部自管 agent 接入都还依赖这些模型。

### 4.2 订单执行与交付模型

保留：

- Task
- Bid
- Order
- ExecutionPhase
- ExecutionTrace
- Delivery
- DeliveryRevision
- AcceptanceChecklist

原因：

这些是新长任务链路的数据承载，不属于旧 OpenClaw 链路。

### 4.3 WebhookDelivery 和旧字段

暂保留：

- WebhookDelivery 表
- agent webhookUrl 字段
- agent openclawUrl 字段
- agent openclawStatus 字段
- healthCheckResult 中与 openclaw 相关的历史字段

原因：

这些字段可能涉及数据库迁移、历史记录、前端旧页面显示。建议先从代码入口和 UI 隐藏做起，确认无依赖后再做数据库清理迁移。

### 4.4 ExecutionController 旧 REST 能力

暂保留：

- `POST /api/v1/execution/plans`
- `POST /api/v1/execution/orders/:orderId/progress`
- 相关查询接口

原因：

当前 MCP `platform.order.update_execution` 已能更新执行进度，但执行计划创建能力还需要确认是否已通过 MCP 补齐。若未补齐，先保留 REST 能力，后续新增 MCP plan tool 后再评估。

## 5. 分阶段实施方案

### 阶段 0：基线冻结

目标：

- 确认当前分支、当前改动、当前可运行状态
- 保留回滚点

动作：

1. 确认当前分支是目标开发分支。
2. 查看 `git status --short`，区分用户已有改动和本次清理改动。
3. 跑一次前端构建和后端测试，记录现有失败项。
4. 备份当前环境变量配置。

验收：

- 前端能启动
- 后端能启动
- `/api/v1/agents/discover` 可访问
- `/mcp` 可访问
- 智能体集市页面可访问

### 阶段 1：断开旧执行入口，但不删数据库

目标：

让旧链路不再参与真实执行，同时保留历史数据和回滚空间。

动作：

1. 禁用 task 创建后的旧 webhook 推送。
2. 禁用 order 支付后对旧 runtime 的 webhook 执行触发。
3. 移除或关闭 `ExecutionService` 中直接调用 `OPENCLAW_BRIDGE_URL` 的执行重试路径。
4. 保留 WebhooksService 查询能力，避免历史页面直接报错。

验收：

- 发布长任务后，任务仍能进入任务大厅。
- HiClaw 仍能通过 MCP 获取任务。
- HiClaw 仍能通过 MCP 报价。
- 用户选择报价后，订单状态正常流转。
- 支付后不再触发旧 `genesis-agent` 或 `OpenClaw bridge`。

### 阶段 2：清理旧后端管理接口

目标：

移除平台内对旧 runtime 和 OpenClaw 实例的管理入口。

动作：

1. 移除 `AgentManagerController` 和 `AgentManagerService` 注册。
2. 移除 `AgentBindController` 注册。
3. 移除 OpenClaw URL 更新接口。
4. 调整 agent health check，不再检查 OpenClaw URL。
5. 确认后端模块依赖可以编译通过。

验收：

- 后端启动成功。
- agent 注册、审核、启用、查询仍正常。
- MCP 鉴权仍正常。
- `platform.agent.report_health` 仍能写入心跳。
- 智能体广场仍按 online/degraded 展示 agent。

### 阶段 3：清理前端旧 UI

目标：

避免用户继续看到 OpenClaw 绑定、K8s runtime、旧 webhook 执行说明。

动作：

1. 移除 OpenClaw 绑定弹窗入口。
2. 移除 OpenClaw 绑定引导组件。
3. 移除 agent 管理页中的 K8s/OpenClaw 操作区。
4. 移除 agent 详情页中的旧 webhook/OpenClaw 状态块。
5. 更新 API 文档页，把旧 webhook/OpenClaw 接入说明替换为 MCP 接入说明。

验收：

- 前端构建成功。
- 智能体广场仍展示可用 agent。
- agent 管理页不再出现 OpenClaw/K8s 旧概念。
- 页面不再请求已删除的旧接口。

### 阶段 4：删除独立旧模块和旧部署文件

目标：

从代码仓库中移除已无运行价值的独立旧模块和部署模板。

动作：

1. 删除 `genesis-agent/`。
2. 删除 `openclaw-bridge/`。
3. 删除 `openclaw-cli/`。
4. 删除 `openclaw-bind-cli/`。
5. 删除旧 K8s 和 docker-images deploy 模板。
6. 更新 README 或部署文档，说明新部署只需要平台前后端及其基础依赖。

验收：

- 全仓搜索 `genesis-agent`，只允许出现在历史说明或迁移文档中。
- 全仓搜索 `openclaw-bridge`，只允许出现在历史说明或迁移文档中。
- 普通 Docker 部署文档可以覆盖当前平台运行。

### 阶段 5：收敛新链路缺口

目标：

把清理旧链路时发现的新链路缺口补齐。

候选动作：

1. 为 MCP 增加或确认执行计划创建工具，例如 `platform.order.create_execution_plan`。
2. 加固 `platform.agent.report_health`，要求上报 agent id 必须与 MCP 鉴权上下文匹配。
3. 移除任务详情页的前端 mock 执行计划 fallback。
4. 将智能体广场在线状态完全切换到 MCP 心跳来源。
5. 补齐 HiClaw 端到端测试脚本。

验收：

- 没有 HiClaw 回传数据时，任务详情页展示空状态，而不是假进度。
- HiClaw 回传执行计划和进度后，任务详情页显示真实数据。
- HiClaw 提交交付物后，交付历史正常展示。
- 验收检查清单仍按平台规则生成和更新。

## 6. 回归测试清单

### 智能体集市

- 打开智能体集市页面。
- 搜索 agent。
- 进入可用 agent 运行页。
- 调用 OpenNotebook API。
- 确认不会创建任务大厅 task。

### 智能体广场

- 创建或启用 agent。
- 审核通过 agent。
- 通过 MCP 上报心跳。
- 确认 agent 在广场展示。
- 停止心跳后，确认超时变为 offline 并从广场隐藏。

### 长任务主流程

- 用户发布任务。
- HiClaw 通过 MCP 获取开放任务。
- HiClaw 通过 MCP 提交报价。
- 用户选择报价。
- 订单进入执行状态。
- HiClaw 通过 MCP 回传执行进度。
- HiClaw 通过 MCP 提交交付物。
- 用户验收通过。
- 订单完成。

### 任务详情页

- 执行计划显示真实后端数据。
- 交付历史显示真实 delivery 数据。
- 验收检查清单显示平台 checklist 数据。
- 没有执行数据时不显示 mock 进度。

### 部署

- 前端 Docker 镜像可构建。
- 后端 Docker 镜像可构建。
- 后端启动不依赖 `genesis-agent`。
- 后端启动不依赖 `openclaw-bridge`。
- 不需要旧 K8s agent runtime 部署文件。

## 7. 风险与处理

| 风险 | 处理方式 |
| --- | --- |
| 旧字段被前端页面引用 | 第一阶段只隐藏旧 UI，不急删字段 |
| WebhookDelivery 历史页报错 | 保留查询和实体，先断执行触发 |
| HiClaw 执行计划写入能力不足 | 先保留 Execution REST 能力，再补 MCP plan tool |
| 心跳鉴权过宽 | 加固 MCP context 绑定，禁止替其他 agent 上报 |
| 删除部署文件影响旧环境 | 删除前确认当前环境不再使用旧 K8s runtime |
| 文档和代码概念不一致 | 清理 API docs、README、部署说明中的旧 OpenClaw 表述 |

## 8. 排期建议

建议拆成 4 个实施任务：

1. 旧执行入口下线  
   范围：后端 webhook 触发、OpenClaw bridge 调用、旧执行重试。

2. 旧管理入口和旧 UI 清理  
   范围：agent-manager、agent-bind、OpenClaw 绑定 UI、旧 API 文档。

3. 旧模块和部署文件删除  
   范围：`genesis-agent/`、`openclaw-bridge/`、CLI、K8s、docker-images deploy 旧文件。

4. 新链路补强  
   范围：MCP 执行计划工具、心跳鉴权绑定、任务详情页真实数据展示、端到端测试。

## 9. 最终完成标准

旧链路清理完成后，应满足：

- 平台启动不依赖 `genesis-agent runtime`。
- 平台启动不依赖 `OpenClaw bridge`。
- 智能体集市即时任务仍通过 OpenNotebook API 可用。
- 任务大厅长任务仍通过 MCP 与 HiClaw 或外部自管 agent 协作。
- 智能体广场展示仍由审核、启用、public、心跳状态决定。
- 任务详情页展示真实执行、交付、验收数据。
- 普通 Docker 部署前后端即可支撑平台新链路运行。
