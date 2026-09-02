# CSI Agent Owner Console 跨版块对接集成指南

> **版本**：v1.5（2026-08-31 快照刷新：M4 闭合 08-27、M5 A1-A8 全 done 08-29~31——10 大场景 Console 侧全部实现完毕并经 122 K8s E2E 四链路真跑，网关联调线独立推进并产出网关团队专属对接文档；v1.4 2026-08-28 网关 task drift 修文【凭证形态 daemon 本地代理 + org 口径 + NetworkPolicy 公测延期】；v1.3 快照刷新；v1.1 新增 §3.7；v1.2 完成 §3.7 全部待裁断项裁决并回写 TS DR-12 + PRD）
> **受众**：CSI 其它版块开发团队——Marketplace（雇主侧交易平台）、平台基础设施（IDP/通知/存储/Webhook 网关）、结算支付、平台运营仲裁等
> **维护方**：Agent Owner Console 团队（本 repo）
> **本文性质**：跨版块集成契约的导览与边界声明。逐字段级 payload 契约以 §0.4 列出的权威文档为准；本文与权威文档冲突时，以权威文档为准。

---

## 0. 阅读指引

### 0.1 本文回答四个问题

1. Agent Owner Console 是什么、负责什么、不负责什么（§1）
2. 它当前已交付什么能力、后续什么时候就绪（§2）
3. 你的团队要与它对接，需要消费什么、提供什么（§3、§4）
4. 按什么顺序启动对接、有哪些坑（§5、§6）

### 0.2 名词速览

| 术语 | 含义 |
|------|------|
| CSI | 碳硅交易平台——AI Agent 自主任务交付市场，交易双方是碳基雇主与硅基 AI Agent |
| Workspace | AI 工作室，平台多租户的最外层边界，由 Agent Owner 运营 |
| Agent Owner | Workspace 的人类运营者，只在关键决策点介入 |
| Agent | AI 员工（Orchestrator/PM/Architect/Dev/Tester/Reviewer 等角色），是平台一等公民 |
| Marketplace Task | 雇主在 Marketplace 发布的任务（其它版块实体） |
| Opportunity | 商机——Marketplace Task 投递到某个 Workspace 后的 Console 侧投影 |
| Project | 中标后创建的交付容器，绑定 Spec/Plan/Budget |
| Project Task | 统一任务模型，竞标/签约/交付三阶段共用 |
| Spec | 需求契约，版本化，雇主确认后锁定快照 |
| Routine | 事件驱动的 Task 模板序列（竞标 Bidding / 签约 Signing） |
| Runtime | Agent 的执行环境（K8s Pod + PVC） |

完整术语表见技术方案 §0.6。

### 0.3 CSI 业务闭环中的位置

```
雇主发布任务（Marketplace）
   │
   ▼
Phase 1 竞标报价 ────── 商机投递 → Agent 自主分析/报价 → 雇主选标
   │（Console ↔ Marketplace 对接面）
   ▼
Phase 2 Spec 契约签订 ── 需求澄清 → Spec 生成 → 雇主确认 → 契约锁定
   │（Console ↔ Marketplace 对接面）
   ▼
Phase 3 自主交付 ────── Orchestrator 规划 → Agent 执行 → 质量门 → 交付
   │（Console 内部为主，交付验收/结算 ↔ Marketplace）
   ▼
雇主验收 → 结算 → 7 天申诉期 → 终态
```

Agent Owner Console 覆盖卖方（AI 工作室）全旅程；雇主侧的任务发布、选标、确认、验收、支付动作发生在 Marketplace 及平台侧版块，通过本文档定义的契约与 Console 交互。

### 0.4 权威文档入口

| 文档 | 地位 | 什么时候读 |
|------|------|-----------|
| `docs/design/prd.md` | **业务权威**：需求/规则/流程。附录 D 是全实体状态机单一真相 | 理解业务语义、状态含义、超时规则 |
| `docs/design/CSI-Agent-Owner-Console-Technical-Solution.md`（下称 TS） | **技术权威**：PRD 的唯一技术实现权威。核心章节：§12 集成 API、§17 Ports & Adapters、附录 A 状态机、附录 B 错误码、附录 D 研发门禁 | 对接实现时逐条核对 |
| `docs/design/research/employer-integration-api.md` | §12 的源文档，含逐端点 payload 级契约（信封/字段/示例） | 写对接代码前必读 |
| `docs/design/research/state-transition-edges.json` | 状态转移边机器可测试注册表 | 实现状态机/校验转移时引用 |
| `docs/design/research/schema-unified.sql` | Console 数据模型目标态 DDL | 仅供理解概念，**不对外开放直连** |

**冲突仲裁**：PRD 的技术性描述与 TS 冲突时，以 TS 为准。

---

## 1. 版块定位与对接边界

### 1.1 Console 负责什么

Agent Owner Console 是 CSI 长任务业务版块的**卖方执行控制面**，负责 AI 工作室接到任务后的全流程：

- 商机接收与本地投影（Push/Pull/手动派发三种模式）
- 竞标工作流（Bidding Routine：商机分析 → 方案生成 → Owner 审批 → 提交竞标）
- 签约工作流（Signing Routine：需求澄清 → Spec 生成 → 雇主确认循环）
- 自主交付（Orchestrator 制定 Plan → Task DAG 依赖自动解锁 → Agent 签出执行 → 多层质量防线）
- Agent / Runtime / Skills / Team 的资源层管理（Workspace 自管域）
- 交付物发布与 Evidence Gates 质量证据链
- 与 Marketplace 的全部交互（竞标提交、Spec 提交、交付物提交、结算触发、对账）

### 1.2 Console 不负责什么

| 领域 | 归属方 |
|------|--------|
| 雇主注册、任务发布、任务大厅、选标界面 | Marketplace 版块 |
| Marketplace Task 生命周期与竞标席位管理 | Marketplace 版块 |
| 平台统一身份认证（IDP SSO / OIDC） | 平台基础设施版块 |
| 短信等外部通知渠道、平台统一 Webhook 路由分发 | 平台基础设施版块 |
| 支付、资金托管、真实结算 | 结算支付版块 |
| 纠纷仲裁受理与裁定 | 平台运营/仲裁 |
| 评价信誉体系的计算任务（Console 侧已备 `workspace_credit_summary` 表承接结果） | 平台侧（公测后方向，见 PRD §11.3） |
| LLM 模型网关、订阅套餐与计量计费（含公测入驻赠送额度、套餐权益管理） | **平台 LLM 网关与计费版块**（新版块，契约面见 §3.7） |

### 1.3 对接边界总原则

1. **唯一对接面是 TS §12 定义的 HTTP 契约**（同步 RPC + 异步 Webhook 混合模式，不引入消息总线）。跨版块**禁止直连 Console 数据库**，Console 内部 REST API 仅服务 Console 自身 UI，不是跨版块 API。
2. **跨版块共享的关联键只有五个**：`marketplace_task_id`、`order_id`、`workspace_id`、`project_id`、`bid_round`。Console 内部实体（Agent/Runtime/Project Task/Routine 等）的 ID 不外泄、不对接。
3. **独立优先**：Console 在 Local 模式下可独立运行完整内部交付闭环（竞标/支付走契约测试替身），其它版块不被 Console 阻塞；反之亦然——双方按契约文本并行开发，到联调点才汇合。
4. **超时各管各的**：每个自动超时都有唯一归属方（见 §3.2.6），归属方负责计时与触发默认动作，另一方消费结果事件。

---

## 2. 能力现状与交付节奏

### 2.1 里程碑状态快照（2026-08-31）

| 里程碑 | 内容 | 状态 | 对其它版块的意义 |
|--------|------|------|-----------------|
| M0 Sprint 0 基线 | 数据模型迁移、状态机真相源、Atomic Checkout SQL 契约、质检 Task 生命周期、超时扫描器 schema、产物存储边界 | ✅ 已闭合 | 契约基线已冻结，可放心对齐 |
| M1 底座 | RBAC + Auth、Workspace/Agent/Runtime/Skills CRUD、Port 化基础设施、Opportunity 本地投影 | ✅ 已闭合 [7/7]（08-18） | 卖方资源层就绪 |
| M2 竞标闭环 | Schema 落地、执行拦截框架 + MCP 工具、**Marketplace 集成（场景一/二/三 + bid.won 完整 handler）**、Agent 执行链路、Routine 引擎、竞标 E2E、Console 商机前端 | ✅ 已闭合 [10/10]（08-22） | 场景一/二/三 Console 侧实现 + 竞标三路径 E2E 真跑 |
| M3 签约闭环 | Project 状态机（33 边注册）、**Spec 工作流（场景四全链）**、**协商取消骨架（场景八端点）**、Signing Routine、前端 Projects、三路径 E2E | ✅ 已闭合（08-24） | 场景四全链 + 场景八骨架 |
| M4 交付引擎 | 质量防线栈 L0-L4、Evidence Gates G1-G6、Harness Loop、四层上下文注入、Plan 全链 + Task DAG 演进、编排监控、Runtime 可靠性、前端交付面、E2E、测试治理、EntitlementPort 骨架 | ✅ 已闭合（08-27 final-review PASS 附债清单：AC 14 条 12 PASS / 1 带债放行 / 1 附观察；双域门禁零新红；TS 修文 8 处落位） | Console 内部交付引擎主体就绪 |
| M5 验收结算闭环 | **场景五**（submit_deliverables + 雇主验收域）/ **场景六**（修订协商 4 选项 + 超时默认 C）/ **场景七**（Spec 变更 + 24h 判定）/ **场景八完整链**（counter_proposal 部分结算）/ **场景九**（结算 + 申诉期）/ **场景十**（纠纷仲裁 + acknowledge + G3）/ 前端操作面 / E2E 四链路 | ✅ child 全 done [8/8]（A1-A8，08-29~31）；parent final-review 待启动 | **10 大场景 Console 侧全部实现完毕**，E2E 四链路（验收主链/修订协商/counter 取消/纠纷仲裁）在 122 K8s 真跑全绿——Marketplace 全场景联调的 Console 侧前置已就绪 |
| 网关联调（独立并行线） | EntitlementPort CSIAdapter、LLM 网关 GatewayProvider、daemon 本地 LLM 代理通道、ENTITLEMENT_* 错误族、计量对账 + 滥用检测、3 判例处置（TS DR-12 实施主体） | 🔄 in_progress（08-28 立项；对接文档已产出：`docs/design/CSI-LLM-Gateway-Billing-Team-Requirements.md`） | LLM 网关与计费版块的**专属对接文档已就绪**（接口面 E1-E6/L1-L3/K1-K4 + 测试数据 + 联调节奏五阶段），可直接作为该版块的启动输入；外部依赖 = 网关侧契约确认 |
| M6 内测打磨 | 性能优化 + 异常场景 + Dogfooding | 📋 planning | 公测前收尾 |

### 2.2 关键解读

- **Console 侧 10 大场景全部实现（截至 08-31）**：场景一/二/三（M2）、场景四 + 场景八骨架（M3）、场景五/六/七/八完整链/九/十（M5 A1-A6）。全部场景均有对应 E2E 证据：M2 三路径竞标、M3 三路径签约、M5-A8 四链路（验收主链含修订循环 / 修订协商 4 选项+超时默认 C / counter 取消 600 公式断言 / 仲裁 B/C/G3 三路 + acknowledge）在 122 K8s 真跑全绿。**Marketplace 团队的联调排期不再受 Console 侧里程碑约束**——只剩契约对齐与双方各自的实现节奏（见 §5）。
- **一处跨版块待确认项**（场景五，A2 登记）：~~修订期间（`in_accept→revising` 循环中）Marketplace 侧 14 天验收计时行为（暂停/重置/继续）TS 未定义~~ **已裁决（Marketplace 侧，2026-08-31 回写）**：修订期间计时**暂停**，修订后重新提交时**重置**为新的 14 天窗口。实现依据：平台自动验收扫描仅命中 `delivery.status='submitted'` 的记录，雇主 `revision_requested` 后状态脱离 `submitted`，计时天然失效（暂停）；Console 修订完成经 #13 重新提交（submissionSeq 递增）时新建记录并重算 `accept_deadline`（重置）。`rejected` 同理暂停。revising 僵局不落入 14 天自动验收范畴，由修订协商（场景六）与雇主侧响应机制兜底。
- **spec_hash 口径已裁决闭合**（M5-A2，08-29）：`spec_hash` 为记录/审计/对账锚（DB-canonical-JSONB 归一化摘要），Marketplace **不得**对 `spec_content` 原始字节重算 SHA-256 校验；传输完整性由 webhook HMAC 签名保障（见 §6 陷阱 16）。
- **网关联调线独立推进**（不在 M5 序列）：Console 侧骨架（EntitlementPort + LocalAdapter + Pre-dispatch 额度校验器，M4-D7）已交付；联调 task 覆盖 CSIAdapter / GatewayProvider / daemon 本地代理（Owner 08-28 终裁形态：key 仅存 daemon 内存，不注入 CLI 子进程 env）/ ENTITLEMENT_* 错误族 / 计量对账兼滥用检测。**网关与计费版块的接口契约已固化为专属对接文档**（接口面 E1-E6/L1-L3/K1-K4、错误语义、测试数据 D1-D6、联调节奏五阶段、§6 回写区）——本文 §3.7 仍是导览，**逐接口对接以该文档为准**。org 分配/解析归平台统一账户体系（§4.2 第 6 项）；联调期身份面未就绪可以约定 org_id 测试值直测网关沙箱（不被身份面阻塞）。
- **E4 两红移交警示**（网关 task 收口方注意）：Go 基线外两新红 `TestCSIEntitlementReconcileJob_*` 经三步甄别归属网关联调 task 域存量（三个 commit 全为该 task），且从 A4 时的"并行负载环境红"**恶化为稳定红**（run-level drift 误判触发 revocation）——收口时按恶化形态处置，M5 各 task 均按"不修不入基线"口径挂账。
- **边界警示**（沿 v1.3）：fork 代码库内存在上游 Multica 遗留的 cloud-billing 代理面（`/api/cloud-billing/*`，Stripe，feature flag 默认关闭），**不构成 CSI 对接契约**——LLM 网关对接以 `CSI-LLM-Gateway-Billing-Team-Requirements.md` + 本文 §3.7 为准。

---

## 3. 对接契约清单

### 3.1 集成总模式与通用约定

混合模式：**同步 RPC + 异步 Webhook**。方向标识：`M→C` = Marketplace 调 Console（Console 提供 Webhook 端点）；`C→M` = Console 调 Marketplace（Marketplace 提供 API）。

| 约定 | 规格 |
|------|------|
| 鉴权 | 服务级长期 Token + HMAC-SHA256 签名（K8s Secret 注入；提前 7 天双发轮换，旧 token 24h 过渡） |
| 通用请求头 | `Authorization: Bearer <service_token>` / `X-Signature: t=<unix_ts>,v1=<hmac_sha256(body+ts)>` / `X-Request-Id: <uuid-v7>` / `Idempotency-Key: <uuid-v7>`（写操作） |
| 接收方验证流程 | Bearer 比对 → timestamp 偏差 ≤ 5min → nonce 唯一 → HMAC-SHA256 重算 |
| Webhook 投递语义 | At-least-once；HTTP 2xx 成功，4xx 不重试，5xx 重试；退避 5s/30s/2min/10min/1h 共 5 次；5 次失败进死信表 + 告警 |
| 幂等机制 | `(event_id, event_type)` 去重 + `Idempotency-Key` 头兜底 + 业务自然键 DB UNIQUE（清单见 §3.2.5） |
| 超时分级 | 短 5s（GET、轻量写）/ 中 15s（一般写）/ 长 60s（大文件、批量） |
| 一致性模型 | 最终一致 + 四层兜底：①Webhook 重试 ②主动对账（Console 每 10min）③死信告警 ④业务容忍（关键操作必须等 ACK 后才对外展示"已完成"） |
| 错误响应体 | RFC 7807 + 业务扩展（`type/title/status/detail/instance/request_id/error_code/details/retry_after_seconds`） |
| 版本化 | URL 前缀 `/v1/` |

错误码族（可重试性已标注，完整清单见 TS 附录 B.4）：

- `AUTH_*`（401/403，**不可重试**）：TOKEN_INVALID / HMAC_SIGNATURE_MISMATCH / TIMESTAMP_EXPIRED
- `VALIDATION_*`（400/422）、`NOT_FOUND_*`（404）、`CONFLICT_*`（409，含 SEAT_FULL / SPEC_VERSION_CONFLICT / SETTLEMENT_ALREADY_TRIGGERED 等）
- `STATE_*`（422，业务状态不允许，如 STATE_PROJECT_NOT_DELIVERABLE）
- `RATE_LIMIT_*`（429，可重试）、`UPSTREAM_*`（502/503，可重试）、`INTERNAL_*`（500，可重试）

### 3.2 Marketplace ↔ Console API 全景

共 **43 个端点 = 17 个 Console Webhook（M→C）+ 26 个 Marketplace API（C→M），24 种 event_type**，覆盖 10 大场景（TS §12.2 为清单权威；payload 细节见 `employer-integration-api.md`）。

> 注：TS §0.4/§16.1 的计数标签（38 API）与 §12.2（43 端点）存在已知文案偏差，**以 §12.2 清单为准**（TS 附录 D.3 #19 已登记修正）。

#### 场景一：商机投递

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 1 | M→C | `POST /v1/webhooks/opportunity/pushed` | 商机 Push（event_type: `opportunity.pushed`） |
| 2 | C→M | `GET /v1/marketplace/tasks` | 商机 Pull（Console 每 5min 定时器 + 手动） |
| 3 | C→M | `GET /v1/marketplace/tasks/{task_id}` | 任务详情查询 |

#### 场景二：竞标方案提交

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 4 | C→M | `POST /v1/marketplace/tasks/{task_id}/bids` | 提交竞标方案并占席位；席位满返回 `409 CONFLICT_SEAT_FULL` |

#### 场景三：雇主选标通知

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 5 | M→C | `POST /v1/webhooks/bid/result` | `bid.won`——Console 先 200 ACK，再异步创建 Project |
| 6 | C→M | `PATCH /v1/marketplace/orders/{order_id}` | Console 回填 `project_id` |
| 7 | M→C | 同上端点 | `bid.lost`（未中标） |
| 8 | M→C | 同上端点 | `bid.batch_rejected`（全部驳回 / 席位满 72h 超时） |

#### 场景四：Spec 签订（Project Task + @mention Comment 为唯一真相源）

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 9 | C→M | `POST /v1/marketplace/orders/{order_id}/employer-mentions` | Console 推 Mention 通知给雇主 |
| 10 | M→C | `POST /v1/webhooks/task/employer-reply` | 雇主回复 Mention（写回 task_comments） |
| 11 | C→M | `POST /v1/marketplace/orders/{order_id}/spec` | 提交 Spec 给雇主确认（7 天计时） |
| 12 | M→C | `POST /v1/webhooks/spec/employer-action` | `spec.confirmed` / `spec.rejected` / `spec.timeout` |

> **Console 侧状态**：已实现（M3，2026-08-24 闭合）——三路径（confirmed / rejected / timeout）经契约替身 E2E 在测试 K8s 真跑。**契约口径已裁决（M5-A2，2026-08-29）**：`spec_hash` 按 canonical JSON 归一化文本计算、`spec_content` 为原始字节——裁决为"hash 仅作记录不重算"（详见 §6 陷阱 16）。

#### 场景五：交付验收

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 13 | C→M | `POST /v1/marketplace/orders/{order_id}/deliverables` | 提交交付物（Evidence Gates 全 passed 才提交；仅传 metadata + 对象存储签名 URL；启动 14 天验收计时） |
| 14 | M→C | `POST /v1/webhooks/delivery/employer-review` | `delivery.accepted` / `delivery.rejected` / `delivery.revision_requested` / `delivery.auto_accepted` |

> **Console 侧状态（M5-A2，2026-08-29 交付；当晚按 A3 契约对齐更新）**：#13 提交链全通（`submit_deliverables` MCP 工具拦截三件 + gates_status 聚合 + runner HTTP 端点 `/csi/tasks/{runID}/submit-deliverables` + wire 契约 `gates_status/workspace_id/project_id/deliverables[{path,checksum,storage,url}]/spec_hash(记录不重算)`——url 为时间受限签名访问链接）；#14 四 event_type 承接全通（accepted / auto_accepted → `completed_pending_appeal`；revision_requested / rejected 未耗尽（`count <= limit`，M5-A3 勘误语义）→ `revising`；**第 limit+1 次请求过边 3（count→limit+1）后链式升级协商**——A3 `EnterRevisionNegotiation`（边 5 + #15 + negotiation_id 持久化；A2 侧预留 seam，合并后接线；`in_accept`+严格超限的 D1 新边为防御性直连出口，四方同步注册）；revising 再提交走同一工具的边 4 通道（trigger `revision.completed` + `gates_status`/`deliverables_published` evidence——`delivery.rejected` 的消费路径 TS 未定义，M5-A2 design D1/D13 裁决）；14 天计时数据面（`delivered_at` / `auto_accept_after`）由边 1 落列；5/9/13 天催办由 Console `deadline_scanner` item 8 经 #9 通道推送（`CSI_ACCEPTANCE_REMINDER_DAYS` 可配）。
>
> **待 Marketplace 确认（一处）**：修订期间（`in_accept→revising` 循环中）M 侧 14 天验收计时行为（暂停 / 重置 / 继续）TS 未定义——修订期间计时继续跑会导致"正在修订却自动验收"的语义混乱，请 Marketplace 侧确认计时暂停/重置规则后回写本节。

#### 场景六：修订协商

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 15 | C→M | `POST .../revision-negotiation/start` | 启动修订协商窗口（2 天） |
| 16 | 双向 | `POST .../revision-negotiation/{negotiation_id}/decide` | 4 选项决策：A 追加修订 / B Spec 变更 / C 按现状验收 / D 转纠纷（A/B 需双方同意） |
| 17 | M→C | `POST /v1/webhooks/revision/negotiation-action` | 协商通知（含 2 天超时默认 C） |

> **Console 侧状态**：已实现（M5-A3，08-29）——#15 启动 2 天窗口（`revision_negotiation_deadline` 落列）+ #16 四选项决策（A 追加修订/B 转 Spec 变更/C 按现状验收/D 转纠纷，A/B 双方同意路径）+ #17 三 event_type 承接（negotiation_started / decided / auto_accepted）；超时默认 C 由 `deadline_scanner` item 5 驱动（`revision_negotiation_decisions` 落档 + 2d 落窗断言）。E2E 五路（A/B/C/D + timeout）122 K8s 真跑全绿（M5-A8）。

#### 场景七：Spec 变更

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 18 | M→C | `POST /v1/webhooks/spec-change/request` | 雇主发起修订/变更请求（启动 Console 24h 判定） |
| 19 | C→M | `POST .../revision-requests/{request_id}/classify` | 修订 / 新增需求判定（24h 超时 Console 侧 escalate） |
| 20 | M→C | `POST /v1/webhooks/spec-change/employer-confirmation` | 雇主二次确认 |
| 21-23 | 双向 | `POST .../spec-changes`、`.../spec-changes/{change_id}/confirm`、`.../reject` | 变更提案（3 天对方响应计时）/ 确认（Spec version+1）/ 拒绝 |

> **Console 侧状态**：已实现（M5-A4，08-30）——`spec_change_requests` 表 + #18-#23 全链 + 24h 判定超时 escalate（`deadline_scanner` item 3）+ 与场景六 B 选项交叠衔接（修订协商 decide B → 转 Spec 变更流程，handoff 契约 `status=employer_confirmed + classification=new_requirement` 已有 E2E 断言）；3 天对方响应计时按 A6 降级口径（单测短路实证）。

#### 场景八：协商取消与结算

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 24 | M→C | `POST /v1/webhooks/project/cancel-request` | 雇主发起协商取消（含 Spec 驳回 5 次自动触发；3 天 Owner 响应计时） |
| 25 | C→M | `POST .../cancel-requests/{request_id}/respond` | Owner 响应：accept / counter_proposal / reject |
| 26 | C→M | `POST .../cancel-requests/{request_id}/auto-resolve` | Owner 3 天超时自动处理（执行中→同意取消+部分结算；待验收→拒绝） |
| 27 | M→C | `POST /v1/webhooks/project/cancel-counter-response` | 雇主对部分结算方案响应 |
| 28 | C→M | `POST .../cancel-requests/{request_id}/finalize` | 最终确认取消结算 |
| 29 | M→C | `POST /v1/webhooks/project/cancel-resolution` | 取消协商结果：auto_settled / to_dispute |
| 30 | C→M | `POST .../cancel-requests/{request_id}/to-dispute` | 转纠纷（无可结算里程碑） |

> **Console 侧状态**：完整链已实现（骨架 M3-D4 → **counter_proposal 部分结算由 M5-A5 于 08-30 放开**）——#25 counter_proposal 不再返回 422：真实部分结算按 `verified_passed` 公式（E2E 断言 600 = 60% × 1000）→ #27 雇主响应 → #28 finalize → `cancelled` 终态；`cancelling→cancelled` 边的结算完成校验已按 M3-D2 移交要求接入真实核验；真实页面链（#25 点击 → #27 回投 → cancelled）经 Playwright 实跑（M5-A8 Chain 3）。

**里程碑结算金额公式**：`结算金额 = Σ(里程碑权重 × Spec.final_price)`，仅计 `status="verified_passed"` 的里程碑；Spec 生成时校验所有 milestones 权重之和 = 100%。

#### 场景九：结算与申诉

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 31 | C→M | `POST .../settlement/trigger` | 触发结算（Project 完成时；7 天托管期） |
| 32 | M→C | `POST /v1/webhooks/settlement/result` | `settlement.completed` |
| 33 | M→C | `POST /v1/webhooks/project/dispute-raised` | 纠纷发起（7 天申诉期内） |
| 34 | M→C | `POST /v1/webhooks/settlement/appeal-period-closed` | 申诉期关闭 → Project 终态 |

> **Console 侧状态**：已实现（M5-A5，08-30）——#31 结算触发（`completed_pending_appeal` 进入时）+ #32 settlement.completed 承接 + #34 申诉期关闭 → `completed_final` 不可逆终态；7 天申诉期计时窗口 env 短路跑通（`after_sale_deadline` 落列断言）。E2E 验收主链含本场景（M5-A8 Chain 1：#14 → appeal countdown → #32 → #34 → completed_final 全程观察面）。

#### 场景十：纠纷仲裁

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 39 | M→C | `POST /v1/webhooks/project/dispute-raised` | 雇主发起纠纷（Project → 纠纷处理中，冻结后续动作） |
| 40 | C→M | `POST .../disputes/{dispute_id}/evidence` | Agent Owner 提交举证（交付记录/Spec 对比/Comment 历史） |
| 41 | M→C | `POST /v1/webhooks/dispute/arbitration-started` | 平台受理纠纷，启动仲裁 |
| 42 | M→C | `POST /v1/webhooks/dispute/arbitration-result` | `dispute.resolved`：仲裁取消 / 仲裁履约 / 仲裁部分结算 / 仲裁退款 |
| 43 | C→M | `POST .../disputes/{dispute_id}/acknowledge` | Agent Owner 确认仲裁结果（终态） |

> **Console 侧状态**：已实现（M5-A6，08-30；Q1 裁决仲裁段整体归 M5）——#39 入口 + 边 10（`dispute_in_progress` 冻结）+ #40 举证（evidence wire 契约）+ #41/#42 承接 + 四选项出口边 11-13 + #43 acknowledge 终态 + G3 `dispute_in_progress→closed` 路径。E2E 三路（B 全额 + C 部分结算 600 公式 + G3 零结算关闭）+ acknowledge 解锁 122 K8s 真跑全绿（M5-A8 Chain 4）；页面链含终态面 acknowledge 交互（Playwright）。

仲裁流程：纠纷发起 → 双方举证（3 天窗口）→ 平台仲裁（最多 7 天）→ 仲裁结果 → 终态。

#### 对账 API

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 35 | C→M | `GET .../orders/{order_id}/settlement` | 查询结算状态 |
| 36 | C→M | `GET /v1/marketplace/workspaces/{workspace_id}/settlements` | Workspace 结算列表 |
| 37 | C→M | `GET .../orders/{order_id}/status` | Order 状态查询（Console 每 10min 对账调用） |
| 38 | C→M | `GET /v1/marketplace/workspaces/{workspace_id}/orders` | Workspace Order 列表 |

#### 3.2.5 业务幂等键清单（Marketplace 侧建表/校验必须对齐）

| 操作 | 业务幂等键 | 实现方式 |
|------|-----------|---------|
| 商机 Push / Pull | `(workspace_id, marketplace_task_id)` | DB UNIQUE |
| 提交竞标方案 | `(marketplace_task_id, bid_round, workspace_id)` | DB UNIQUE |
| Spec 推送 | `(project_id, spec_version)` | DB UNIQUE |
| 交付物提交 | `(project_id, submission_seq)` | DB UNIQUE |
| 验收回调 | `(project_id, review_round)` | DB UNIQUE |
| Spec 变更请求 | `(project_id, change_seq)` | DB UNIQUE |
| 修订请求 | `(project_id, revision_round)` | DB UNIQUE |
| 取消协商 | `(project_id, cancel_proposal_seq)` | DB UNIQUE |
| 触发结算 | `(project_id)` | DB UNIQUE（一个 Project 仅一次结算） |

#### 3.2.6 自动超时归属（"各管各的"原则）

| 超时场景 | 时长 | 归属方 | 默认动作 |
|---------|------|--------|---------|
| Spec 雇主未确认 | 7 天 | **Marketplace** | 自动取消 Project（发 `spec.timeout`） |
| 自动验收 | 14 天 | **Marketplace** | 发 `delivery.auto_accepted` |
| 修订协商窗口 | 2 天 | **Marketplace** | 默认选项 C（接受当前） |
| 席位满雇主未决策 | 72h | **Marketplace** | 自动全部驳回 |
| Spec 驳回次数 | 5 次 | **Marketplace** | 触发协商取消 |
| 签约阶段总超时 | 30 天 | **Marketplace** | 触发协商取消 |
| 修订/新增需求判定 | 24h | **Console** | escalate（urgent 通知 Owner + 冻结直至判定） |
| 取消请求响应 | 3 天 | **Console** | 按阶段自动处理（执行中→部分结算；待验收→拒绝） |

### 3.3 状态机约定

跨版块对接只涉及三个对外状态机；Console 内部状态机列在最后仅供理解事件语义，**不要求其它版块实现**。

#### 3.3.1 Marketplace Task（Marketplace 版块实现，Console 消费）

7 状态：待发布 → 招标中 → 已选标；终态：已完成 / 已过期 / 已关闭 / 已取消。单一真相见 PRD 附录 D.1。要点：

- **多轮竞标**：`bid_round` 从 1 开始，任务重开（全部驳回 / Spec 超时重开）时 +1，上一轮席位归档清零，新一轮从 `0 / seat_limit` 重新累计。
- **席位机制**：`seat_limit` / `seat_taken` / `seat_full_locked_at` / `seat_full_deadline`（席位满自动写 72h 倒计时，到期未选标自动全部驳回）；`expires_at` 到期未选标 → 已过期。
- **与 Project 联动**：已选标 → 触发 bid.won；关联 Project 终态 → Marketplace Task 已完成/已取消。

#### 3.3.2 Opportunity（Console 侧投影，Marketplace 团队需理解其语义）

9 状态：待处理 / 竞标分析中 / 已竞标 / 不予竞标 / 中标 / 中标失效 / 未中标 / 已驳回 / 已过期（PRD 附录 D.2）。要点：

- **幂等原则**：`UNIQUE(workspace_id, marketplace_task_id)`——同一 Workspace 对同一 Marketplace Task 永远只有一条 Opportunity；多轮竞标复用该记录，历史存 `bid_history[]`，当前轮次由 `bid_round` 标识。
- Marketplace 的"全部驳回"映射到该 Workspace 的 Opportunity = 已驳回；"任务过期/关闭"批量映射为已过期。
- 雇主重开任务后，原 Opportunity 可再次进入竞标（不新建记录）。

#### 3.3.3 Project（Console 实现，其状态对外可见）

16 状态符号（TS 附录 A.1，与 PRD 附录 D.3 中文业务标签一一对应）：

```
spec_nego → planning → plan_review → executing → in_accept
  → completed_pending_appeal → completed_final（终态）
横切：revising / revision_negotiation / budget_paused / paused_exception
      / manual_handling / cancelling / dispute_in_progress
终态：completed_final / cancelled / closed
```

- Project **不使用"已过期"**：所有时效性终止统一归 `cancelled`；不可恢复异常归 `closed`。
- 进入 `completed_pending_appeal` 时写 `after_sale_deadline = now() + 7d`，申诉期内可转 `dispute_in_progress`。
- Marketplace 侧 Order 状态应与 Project 状态保持最终一致——靠 webhook 事件 + Console 10 分钟主动对账（调用对账 API #37/#38）双向收敛。

#### 3.3.4 Console 内部状态机（仅供理解，不对外）

- **Project Task 11 值枚举**：`planning / queued / ready / dispatched / running / in_review / done / blocked / reopened / failed / skipped`（终态 done/skipped）。已废弃的 8 值旧模型（含 in_progress/cancelled）禁止使用。
- 转移边机器可读注册表：`docs/design/research/state-transition-edges.json`（每条边含 trigger/guard/gate/side 语义）。
- 另有 Routine Run / Agent Run / Spec Revision / 文档锁等内部状态机，见 TS 附录 A.3。

### 3.4 平台能力 Port 清单（平台基础设施版块的对接点）

Console 工程架构是 Ports & Adapters 六边形（TS §17）：业务核心只依赖 9 个 Port 接口，每个 Port 有 LocalAdapter（当前默认）+ CSIAdapter（平台就绪后切换），配置驱动逐 Port 灰度切换、业务代码零改动。

| # | Port | 职责 | 当前（LocalAdapter） | CSI 平台侧需提供 | 切换开关 |
|---|------|------|---------------------|-----------------|---------|
| 1 | `AuthPort` | 用户登录/会话/深链 token | 本地账户 JWT | **IDP SSO（OIDC）** | `CSI_AUTH_MODE` |
| 2 | `OpportunitySourcePort` | 商机来源/创建/同步 | 手动新建 | Marketplace API（即 §3.2 场景一） | `CSI_OPPORTUNITY_MODE` |
| 3 | `SettlementPort` | 结算记录/查询/触发 | 本地 settlements 表 | **结算单同步（结算支付版块）** | `CSI_SETTLEMENT_MODE` |
| 4 | `NotificationChannelPort` | 外部通知渠道 | Console 内置 SMTP + PWA Push | **平台通知服务（短信等）** | `CSI_NOTIFICATION_MODE` |
| 5 | `CrossModuleLinkPort` | 跨版块链接生成 | 返回 null（隐藏入口） | **一次性 sid 跨站免登链接** | `CSI_CROSS_MODULE_MODE` |
| 6 | `RuntimeProvisionerPort` | Runtime 创建/销毁/扩缩容 | K8s API | K8s API（不变，无需对接） | `CSI_RUNTIME_MODE` |
| 7 | `ObjectStoragePort` | 产物/附件/Spec 文档存储 | PVC（工作目录）+ MinIO（发布产物） | **S3 / OSS 对象存储** | `CSI_STORAGE_MODE` |
| 8 | `LLMProviderPort` | LLM 调用（Layer 1 系统 Prompt + Agent 推理） | OpenAI / Anthropic API | **平台统一 LLM 网关**（模型目录 + 多模型路由 + 计量 + 计费，契约面见 §3.7） | `CSI_LLM_MODE` |
| 9 | `WebhookInboundPort` | 接收外部 Webhook | Console 直接暴露 17 个端点 | **平台统一 Webhook 路由分发**（Console 改为订阅平台事件入口） | `CSI_WEBHOOK_MODE` |

硬约束（平台侧设计时必须知道）：

- **发布产物强制耐久存储**：`artifact_type ∈ {deliverable, evidence}` 的 `PublishArtifact` 必须路由到 MinIO/S3/OSS，PVC 仅作工作目录，不受 `CSI_STORAGE_MODE=local` 影响。平台提供对象存储时要保证 deliverable/evidence 的持久性等级。
- 每个 Port 的方法级契约（入参/返回/错误/幂等/降级语义）见 TS §17.3；Port 契约补齐（方法/错误/OpenAPI 契约测试）在 TS 附录 D.2 #16 有登记，平台团队启动对接时与 Console 团队逐 Port 核对最新接口定义。

### 3.5 事件与通知约定

**Console 内部事件机制**（其它版块无需对接，仅供理解语义来源）：PostgreSQL LISTEN/NOTIFY + Outbox，`event_outbox` 表为权威真相源，at-least-once + `event_handled` 幂等账本，12 类内部事件（`task.status_changed` / `opportunity.created` / `project.created` 等，TS §11.2）。

**跨版块事件**：即 §3.2 中 M→C webhook 的 24 种 event_type。对 Marketplace 团队的要求：

- 每个事件分配全局唯一 `event_id`（uuid-v7），同一事件重投时 `event_id` 不变（Console 按 `(event_id, event_type)` 去重）。
- 事件仅在业务状态提交后发出；失败/被拒绝的操作不发事件。
- Webhook payload 统一信封规范见 `employer-integration-api.md` §8.3。

**通知分级**（Console 侧消费规则，影响 Marketplace 事件的内容设计）：info（知晓即可）/ reminder（SLA 内行动，如 Spec 确认 7 天、审批 24h）/ urgent（立即行动，否则触发自动后果）。urgent 不受静默时段限制。

### 3.6 数据边界与 Schema 约定

- **不共享数据库**。Console 私有 PostgreSQL（目标态 54 表 + 2 视图，TS §1.2）；Marketplace 及其它版块自建存储。
- 跨版块数据只通过 §3.2 的 API/Webhook 流动；关联靠 §1.3 的五个键。
- **交付物大文件不走 HTTP body**：`deliverables` API 仅传 metadata + 对象存储签名 URL（TTL 临时访问），文件本体在对象存储。
- Opportunity 是 Marketplace Task 的 Workspace 维度投影：一个 Marketplace Task 对应 N 个 Opportunity（每个被投递的 Workspace 一条）。
- Spec 以快照锁定：雇主确认时 Console 落 `spec_snapshot` + `spec_snapshot_hash`，后续变更走场景七使 Spec version+1，历史版本不可改。
- Console 内部存在"文档逻辑名 ↔ 物理表名"映射（14 组，如 `project_tasks → issue`）——这是 Console 内部实现细节，对其它版块不可见，仅说明为何跨版块契约里不出现 Console 表名。

### 3.7 LLM 模型网关与计量计费（平台新版块契约面）

> **本节状态（2026-08-20 已裁决）**：本节全部条目已经 Owner + Console 团队裁决并回写权威文档——TS 侧走 drift-handling 路径 C（大决策）落 **DR-12**（§17.2 第 10 个 Port / §17.3.5 接口定义 / §17.4 切换矩阵 / §2.4 云端托管网络边界 / 附录 B.3+B.6 错误码），PRD 侧落 §4.3 托管策略 / §4.4 模型选择步骤 / §4.6 订阅套餐与 LLM 额度。TS §17.3.3 的 `LLMProviderPort` 是对接统一 LLM 网关的预留扩展点——网关作为该 Port 的新 CSIAdapter 接入，调用面与计量面零新增契约；商业化面（套餐/权益/额度/账单）由新增的第 10 个 Port `EntitlementPort` 承载。

#### 3.7.1 版块职责与 Console 侧已有钩子

新版块（下称"LLM 网关与计费服务"）的职责：

1. **统一模型接入**：平台级模型目录（多厂商/多规格），Console 侧 Agent 全部经网关调用 LLM，不直连模型厂商。
2. **计量**：按 workspace 维度归集 token 用量与成本（输入/输出/总计 + 按模型单价折算）。
3. **计费与额度**：订阅套餐管理（套餐内含 token 额度或积分 + 其它权益）、公测入驻赠送免费额度、额度耗尽的处置。
4. **权益管理**：套餐决定的可创建云端 RuntimeInstance 数量上限、可选 RuntimeProfile/Version 范围、可用模型目录范围。

Console 侧已就绪的对接钩子（TS 已落地，新版块可直接对齐）：

| 钩子 | 位置 | 说明 |
|------|------|------|
| **网关团队专属对接文档** | `docs/design/CSI-LLM-Gateway-Billing-Team-Requirements.md` | **逐接口对接以此为准**（本节仅为导览）：接口面 E1-E6（E6=免费额度激活）/ L1-L3（L3=模型目录）/ K1-K4（workspace key 签发/轮换/吊销 + run 标识注入）+ 错误语义 + 认证与安全 + 调用频率画像 + 测试数据 D1-D6 + 对账口径 + 联调节奏五阶段 + §6 网关团队回写区（2026-08-28 定稿，可直接转发网关团队） |
| `LLMProviderPort` 接口 | TS §17.3.3 | `Chat` / `ChatStream` / `Embed` / `Capabilities`；CSIAdapter 切换点就是网关接入点 |
| **`EntitlementPort` 骨架** | TS §17.3.5（DR-12）；代码 `server/internal/ports/entitlement_port.go` | **M4-D7 已落地**（commit 62a82da42）：`GetPlan`/`GetCatalog`/`GetQuota`/`GetUsage`/`Capabilities` 五方法接口 + LocalAdapter（全放行：`Models ["*"]`、实例上限 -1）+ 容器接线（`CSI_ENTITLEMENT_MODE`）；CSIAdapter 由网关联调 task（08-28，in_progress）落地 |
| 计量返回结构 | `ChatResponse` | `Usage`（prompt/completion/total tokens）+ `Cost`（按定价表折算）+ `Model`（实际响应模型版本）+ `TenantID`（**多租户成本归集键**，对齐 workspace_id） |
| 多模型路由方向 | `MultiModelRouter`（CSIAdapter 预研） | 按 Agent 角色 + 任务类型路由（Orchestrator 旗舰 / Dev 标准 / Tester lite）——网关侧路由策略可与此对齐 |
| 逐 run 计量落账 | `agent_runs`（物理 `agent_task_queue`） | `token_usage_input/output/total` + `cost_cents`，M2-C1 已建列 |
| 模型选择字段 | `agents.provider` | Agent 创建时指定模型提供方/模型；可选范围应由网关按套餐权益下发 |
| 成本风控体系 | TS §2.1/§2.2/§3.2 | workspace `monthly_budget_cents`、agent `budget_monthly_cents`、project `compute_cost_used` + `project_compute_budget_ratio`（默认 0.300）+ `budget_incidents` 表 |
| 预算前置拦截 | Pre-dispatch 动态校验 | 余额不足拒绝派发（`PREDISPATCH_BUDGET_INSUFFICIENT`）；**LLM 额度校验器已随 EntitlementPort 骨架落地**（`server/internal/dispatcher/entitlement_checker.go`，额度耗尽 → `PREDISPATCH_LLM_QUOTA_EXHAUSTED` 4xx 业务态） |
| 费用展示位 | Console `/settings/billing` 路由 | TS §13.1 已预留，数据源即新版块 |
| **计量对账 + 滥用检测** | 网关联调 task（08-28，in_progress） | `TestCSIEntitlementReconcileJob_*` 已在库（对账 job 代码已落；两测试红为该 task 域存量，收口时处置——见 §2.2 E4 警示）；对账差值→滥用告警→key 轮换链路（Owner 08-28 裁决新增语义） |

**两条资金流不要混淆**（新版块建模时的关键边界）：

- **雇主 → 平台/Marketplace → 工作室**：项目款结算（§3.2 场景八/九，SettlementPort 域）。
- **Agent Owner → 平台**：LLM 用量与套餐订阅费（本节新版块域）。
- Console 的 budget 体系（`compute_cost_used` vs 报价 × 30%）是**项目成本风控**（防止交付亏损），与平台计费的**商业化收费**（owner 为 token 付费）是两个独立维度：套餐额度管"能不能调"，项目预算管"该不该花"。

#### 3.7.2 运行时托管模型与 LLM 接入安全边界

Runtime 托管策略（公测口径，2026-08-18 已拍板）：

| 阶段 | Runtime 形态 | LLM 接入约束 |
|------|-------------|--------------|
| 公测（当前） | **平台云端托管**：RuntimeInstance 由 Console 通过 `RuntimeProvisionerPort` 在平台 K8s 创建（TS §2.4），owner 不自建 | **强制走平台 LLM 网关**；云端托管 Runtime **不支持** owner 自定义 LLM provider——owner 的 LLM API key 等敏感凭证不进入平台托管环境 |
| 后续版本（按市场反馈与 roadmap 排期） | 支持 owner **自托管注册** Runtime（类似 Multica 原生的本地机器注册为 Runtime） | 自托管 Runtime 内可配置自定义 LLM provider（Multica 原生即支持 runtime 级自定义模型配置）；其 LLM 流量不经平台网关——平台**不计量不收费**，daemon 按本地价格表自报成本，仅用于项目预算风控与展示（已裁决，TS §2.4） |

安全边界的工程含义：

- 平台**永不存储、永不下发** owner 的 LLM API key；云端 Runtime 的 LLM 调用凭证走 **daemon 本地代理 + workspace 级 LLM key**（K1-K4 终裁形态，2026-08-28 Owner 裁决、网关 task 落地，记录性修文）：网关按 workspace 签发 key（K1，幂等），Console 经 daemon llm-key 端点转发，daemon 仅在**进程内存**持有（401 重取一次 + 24h 顺带轮换 + 销毁/滥用 K3 吊销）；Agent CLI 的 provider base_url 强制指向 daemon 的 per-run 本地代理（127.0.0.1 随机端口），代理剥换凭证为网关 key 并注入 run/workspace 归集头（K2）后转发网关——key 永不落入 Runtime 环境变量明文、永不进入 CLI 子进程。
- `agents.provider` 的可选值由网关按套餐下发目录；云端 Runtime 的 Pod 出向 K8s NetworkPolicy 白名单（仅放行平台 LLM 网关 + Console API + 平台对象存储 + DNS），封禁 Agent 绕过网关直连外部模型端点——**公测阶段已裁决延期**（Owner 2026-08-28：非硬性要求，后续迭代再议，移出网关 task 验收范围；反向隧道出向滥用向量公测接受，由额度硬断 + 对账滥用检测兜底，预案留档 TS §2.4 / 网关 task design §2.10）。
- Console Pre-dispatch 动态校验与网关对齐：套餐外模型 → `PREDISPATCH_MODEL_NOT_ENTITLED`；额度耗尽 → `PREDISPATCH_LLM_QUOTA_EXHAUSTED`（已裁决，TS 附录 B.3；不复用 `PREDISPATCH_BUDGET_INSUFFICIENT`——后者是项目预算风控语义，处置动作不同）。

#### 3.7.3 订阅套餐与权益模型

商业化方向（参照 Codex / Claude / Trae 的订阅制），套餐包含两类内容：

1. **LLM token 额度或积分**：周期（月）内可用的计量额度；公测免费额度**随入驻账号（org）发放**（拉新福利；2026-08-28 Owner 裁决统一为账号级口径——账号入驻时由平台统一账户体系【基础设施团队，§4.2 第 6 项】默认分配绑定 org，其下 Workspace 共享权益，激活由 Console 入驻编排触发计费侧幂等激活端点；原"每个 Workspace 赠送"表述废止，记录性修文）。
2. **其它权益**：
   - 可创建注册的云端 RuntimeInstance 数量上限；
   - 可部署的 RuntimeProfile / RuntimeProfileVersion 范围（TS §2.4 四层实体模型中，Profile 目录由平台管理员维护——套餐决定目录的可见子集，如基础规格 vs GPU 规格）；
   - 可用模型目录范围（旗舰模型是否开放）；
   - 并发、支持等级等（可演进）。

对 Console 的契约要求（权益校验点，已裁决）——订阅主体为 **Org/账号级**：权益校验键 = `org_id`（由平台统一账户体系分配解析，§4.2 第 6 项），计量按 `workspace_id` 落账拆解：

| 动作 | 校验点 | 建议契约 |
|------|--------|---------|
| 创建云端 RuntimeInstance | 实例数是否超套餐上限 | 新版块提供权益查询 API，Console 创建前校验；超限返回业务态拒绝 |
| 选择 RuntimeProfile/Version | 该规格是否在套餐目录内 | 创建页可选列表由权益 API 下发 |
| 创建 Agent 选模型 | 模型是否在套餐目录内 | `agents.provider` 可选值由权益 API 下发 |
| Agent 运行消耗 token | 额度余额 | 网关侧实时扣减 + 余额不足拒绝；Console 展示用量与预警（`/settings/billing`） |

业务规则（2026-08-20 已拍板，PRD §4.6）：**订阅主体** = Org/账号级（一份套餐覆盖全部 Workspace，额度共享）；**公测免费额度** = 入驻即赠、有有效期、不可转让、耗尽即停，数值与有效期为平台运营参数配置化，不写死契约；**耗尽处置** = 公测硬断（4xx 业务拒绝 + urgent 通知 Owner 充值/升级），正式版支持 owner 可选按量溢价；**升降级** = 升级即时生效（按剩余周期折算差价）、降级下个计费周期生效。

#### 3.7.4 计量口径与对账

- **计量权威在网关**：每次调用的 token 用量与成本以网关返回的 `Usage`/`Cost` 为准（Console 的 `ChatResponse` 已含该结构）；Console 侧 `agent_runs.token_usage_*`/`cost_cents` 是网关数据的落账副本，用于项目成本风控与展示，不作为计费依据。
- **归集键**：`TenantID` = `workspace_id`；run 级明细可用 `agent_run_id` 关联，支持"按项目/按 Agent"的用量拆解展示。
- **对账**（已裁决）：Console 周期性拉取网关用量汇总（`EntitlementPort.GetUsage`）与本地落账比对——每小时增量 + 每日全量；偏差超阈值（默认 0.5%，可配置）写 `watchdog_logs` + reminder 通知 Owner，防止流式中断导致的漏计/重计。
- **时间口径**（已裁决）：套餐额度按**订阅周期**滚动（业界订阅制惯例）；Console 的 `monthly_budget_cents` 按自然月重置，属内部风控口径——两者独立，展示层分别标注。

#### 3.7.5 裁决记录（2026-08-20，Owner + Console 团队）

本节全部待裁断项已裁决并回写权威文档（TS 侧走 drift-handling 路径 C 大决策流程，落 DR-12；PRD 侧落 §4.3/§4.4/§4.6）：

1. **Port 归属（DR-12，TS 附录 C.2）**：调用面与计量面**无新 Port**——网关作为 `LLMProviderPort` 的新 CSIAdapter（`GatewayProvider`）接入，`CSI_LLM_MODE` 增加 `gateway` 模式值，`MultiModelRouter` 预研的角色路由策略由网关服务端吸收；商业化面（套餐/权益目录/免费额度/账单）新增第 10 个 Port `EntitlementPort`（只读+校验，LocalAdapter 全放行），不并入 `SettlementPort`（雇主项目结算 ≠ owner 订阅计费，两领域隔离）。已回写 TS §17.2/§17.3.5/§17.4/§17.5。
2. **PRD 口径对齐（已落实）**：PRD §4.3 增补托管策略（公测云端托管优先、自托管后续演进）；§4.4 Agent 创建流程新增模型选择步骤；新增 §4.6"订阅套餐与 LLM 额度"（订阅主体/免费额度/耗尽处置/升降级 + 四权益校验点）。
3. **错误语义（已落实）**：额度耗尽/套餐外模型/实例数超限 = 4xx 业务态拒绝（不可重试）——新增 `ENTITLEMENT_*` 错误码族（TS 附录 B.6）+ Pre-dispatch 两个错误码 `PREDISPATCH_LLM_QUOTA_EXHAUSTED` / `PREDISPATCH_MODEL_NOT_ENTITLED`（TS 附录 B.3）。

**实施归属与进展（2026-08-31 更新）**：`EntitlementPort` 接口 + LocalAdapter + Pre-dispatch 额度校验器由 M4-D7 落地；**网关联调 task（08-28，in_progress）承接全部剩余切面**——CSIAdapter 实现（含 org 映射与死分支消除）、`GatewayProvider`、daemon 本地 LLM 代理通道（K1-K4 终裁形态）、`ENTITLEMENT_*` 完整错误族、计量对账兼滥用检测、M4-D7 留档 3 判例；NetworkPolicy 公测延期（预案留档）。该 task 的**硬前置是网关侧契约确认**（endpoint/认证/联调环境）——网关团队就绪节奏直接决定公测开园时间；其专属对接文档已定稿（见 §3.7.1 首行）。网关服务端与计费系统本体属平台新版块。

---

## 4. 各版块对接任务分解

### 4.1 Marketplace 团队（核心对接方，工作量最大）

**需要提供的能力**：

1. **26 个 C→M API 全量实现**（§3.2 清单），含统一信封、HMAC 验签、幂等键 UNIQUE 约束、错误码族按 §3.1 语义返回。
2. **17 类事件的 Webhook 投递器**：at-least-once + 5 次退避（5s/30s/2min/10min/1h）+ 死信处理；`(event_id, event_type)` 唯一标识；先 200 ACK 后异步处理的语义兼容（尤其 `bid.won`：Console ACK 后异步建 Project 再回填 `project_id`，Marketplace 的 Order 模型必须容忍 `project_id` 为空的窗口期）。
3. **Marketplace Task 状态机 + 席位机制 + 多轮竞标**（§3.3.1），含 72h 席位满倒计时、有效期过期、全部驳回等自动动作，并按 §3.2.6 承担归属 Marketplace 的 6 项超时。
4. **对账 API 数据面**（#35-#38）：接受 Console 每 10 分钟对账调用，返回 Order/结算的真实状态。
5. **雇主侧操作到事件的映射**：选标、Spec 确认/驳回、验收、修订协商决策、取消请求、纠纷申诉等雇主动作都要触发对应 webhook（24 种 event_type 的发送方主要是 Marketplace）。

**需要消费的能力**：Console 的 17 个 webhook 端点（已实现，M2 经替身验证）+ Console 在各场景下的主动调用。

**建议同步建立**：Marketplace 侧契约测试替身（模拟 Console 收发），与 Console 侧已有的 Marketplace 替身互为镜像，联调前双方各自先与替身跑通。

### 4.2 平台基础设施团队

按 §3.4 的 Port 表逐能力提供，全部可并行、可独立灰度：

1. **IDP SSO（OIDC）** → 替换 `AuthPort` LocalAdapter；涉及 Console UI 登录态与深链 token。
2. **平台通知服务**（短信为公测版预留渠道，PWA Push 已在 Console 内置）→ `NotificationChannelPort`。
3. **对象存储（S3/OSS）** → `ObjectStoragePort`；必须满足 deliverable/evidence 强制耐久存储约束。
4. **统一 Webhook 路由分发** → `WebhookInboundPort` 的 CSI 模式：平台统一入口验签/路由，Console 从"直接暴露 17 端点"切换为"订阅平台分发"。此项与 Marketplace 的投递器实现需三方对齐（同一签名与信封规范）。
5. **跨版块免登链接**（一次性 sid）→ `CrossModuleLinkPort`，用于雇主从 Marketplace 跳入 Console 项目页等场景；当前 Local 模式返回 null（入口隐藏），平台能力就绪后开启。
6. **统一账户体系 org 模型**（2026-08-28 Owner 裁决归属）：账号注册时默认分配生成并绑定一个 org（该账号在此 org 为 owner 角色，一账号多 Workspace 共享权益）；账号→org 解析（OIDC 登录态 claim 首选，解析 API 兜底）；多 org/成员邀请/角色分配/切换为演进预留（IAM 域，公测不建）。计费版块（§4.5）与 Console 均以 `org_id` 为消费方（不透明计费主体键，§3.7.3）。

### 4.3 结算支付团队

1. 承接 `settlement/trigger`（场景九）：7 天资金托管期、结算执行、回发 `settlement/result` webhook。
2. 实现里程碑结算公式（§3.2 场景八）：按 `verified_passed` 里程碑权重 × `Spec.final_price` 结算。
3. 协商取消的部分结算（按里程碑权重）、仲裁四选项的资金动作（取消/全额/部分/退款）。
4. 结算数据面支持对账 API（#35/#36），并向 Console `SettlementPort` 提供结算单同步。

### 4.4 平台运营/仲裁团队

1. 纠纷受理流程：接收雇主纠纷发起 → `arbitration-started` webhook → 举证窗口（3 天）→ 仲裁（最多 7 天）→ `arbitration-result` webhook（四选项语义见 §3.2 场景十）。
2. Spec 驳回 5 次、签约 30 天总超时等平台级治理动作的触发与通知。
3. 平台管理后台（公测后方向，PRD §11.3）：含"平台推荐"标签管理、Workspace 展示页内容下架权。

### 4.5 LLM 模型网关与计费团队（新版块）

**需要提供的能力**（契约面详见 §3.7）：

1. **统一 LLM 网关**：模型目录 + 统一调用入口（对齐 Console `LLMProviderPort` 的 `Chat`/`ChatStream`/`Embed`/`Capabilities` 四方法语义），按角色/任务类型的多模型路由策略。
2. **计量服务**：逐调用返回 `Usage`/`Cost`/`Model`/`TenantID`（`TenantID` = workspace_id），作为计费与归集的唯一权威口径。
3. **订阅套餐与额度**：套餐定义（token 额度/积分 + RuntimeInstance 数上限 + RuntimeProfile/Version 目录范围 + 模型目录范围）、公测免费额度激活端点（幂等；由 Console 在 agent owner 入驻流程触发，org 分配本身归基础设施团队统一账户体系，见 §4.2 第 6 项）、额度扣减与耗尽处置（业务态 4xx 拒绝，非 5xx）。
4. **权益查询 API**：供 Console 在创建 RuntimeInstance、选择 Profile/Version、创建 Agent 选模型、运行期余额检查四个校验点调用（§3.7.3 表）。
5. **用量/账单数据面**：供 Console `/settings/billing` 页展示用量、额度余量、账单；支持周期性对账拉取。
6. **凭证安全**：云端托管 Runtime 的 LLM 调用凭证由网关按 workspace 签发（K1；daemon 本地代理进程内存持有，key 永不进入 CLI 子进程，详见 §3.7.2 终裁形态），owner 的 LLM key 不进入平台；出向封禁的 K8s NetworkPolicy 公测阶段已裁决延期（额度硬断 + 对账滥用检测兜底，§3.7.2）。

**需要消费的能力**：Console 侧 `agents.provider` 模型选择、`agent_runs` 计量落账、Pre-dispatch 预算/额度校验（含 M4-D7 已落的 `EntitlementPort` 骨架与额度校验器）——均已就绪（§3.7.1 钩子表）。

### 4.6 Console 团队为各版块提供什么（反向清单）

| 提供物 | 状态 | 说明 |
|--------|------|------|
| 17 个 Webhook 入站端点 | ✅ 已实现（M2，替身验证） | 验签/去重/重试兜底/死信全套 |
| bid.won 完整处理链 | ✅ 已实现（M2） | 异步建 Project + Spec draft + 事件 + 回填 project_id |
| 10 分钟主动对账调用 | ✅ 已实现（M2） | 消费 Marketplace 对账 API |
| 场景四 Console 侧 handler | ✅ 已实现（M3，替身 E2E 三路径：confirmed/rejected/timeout） | `submit_spec` 7 天计时 + 澄清/驳回双计数 + Signing Routine；spec_hash 口径已裁决（记录不重算，§6 陷阱 16，M5-A2） |
| 场景五 Console 侧 handler | ✅ 已实现（M5-A2，2026-08-29；当晚 A3 契约对齐） | #13 提交链（工具+HTTP 端点+wire 契约+签名 URL）+ #14 四 verdict 承接 + 未耗尽→revising / 第 limit+1 次请求链式升级协商 + revising 再提交边 4 通道 + 14 天计时数据面 + 5/9/13 催办（scanner item 8 经 #9）；E2E：M5-A8 验收主链 |
| 场景六/七 Console 侧 handler | ✅ 已实现（M5-A3/A4，08-29/30） | 修订协商 #15-#17（4 选项 + 超时默认 C，E2E 五路）/ Spec 变更 #18-#23（24h 判定 escalate + B 选项 handoff 契约） |
| 场景八完整链（含 counter_proposal 部分结算） | ✅ 已实现（骨架 M3-D4 → M5-A5 于 08-30 放开） | #25 counter_proposal 真实部分结算（verified_passed 公式，600=60%×1000 E2E 断言）+ 真实结算核验（M3-D2 移交闭环）+ 页面链 Playwright 实跑 |
| 场景九/十 结算与纠纷 Console 侧 handler | ✅ 已实现（M5-A5/A6，08-30） | 结算触发 + settlement.completed + 申诉期→completed_final（E2E Chain 1）/ 仲裁 #39-#43 全链 + 四选项出口 + G3 + acknowledge（E2E Chain 4 三路） |
| 前端操作面（验收/协商/举证） | ✅ 已实现（M5-A7） | 结构化操作路径（Q4 裁决），非跨 Project 汇总 Dashboard |
| Workspace 展示页与信用数据表 | ✅ 页面与表已建 | `workspace_credit_summary` 由平台 job 计算写入——计算输入（交付/评价数据）的跨版块取数方式待评价信誉体系立项时共议 |
| 契约测试替身（Marketplace mock） | ✅ 存在 | 可借给 Marketplace 团队参考其对 Console 行为的假设 |
| LLM 接入/计量钩子（`LLMProviderPort` + `ChatResponse.Usage/Cost/TenantID` + `agent_runs` 计量列） | ✅ 已就绪 | LLM 网关与计费版块的接入点与计量口径，见 §3.7.1 |
| `EntitlementPort` 骨架（接口 + LocalAdapter + Pre-dispatch 额度校验器） | ✅ 已落地（M4-D7） | TS DR-12 Console 侧切面；CSIAdapter/GatewayProvider/daemon 本地代理/错误族/计量对账由网关联调 task（in_progress）落地 |
| 网关团队专属对接文档 | ✅ 已定稿（08-28） | `CSI-LLM-Gateway-Billing-Team-Requirements.md`——可直接作为网关与计费版块的启动输入 |

---

## 5. 启动对接顺序建议

唯一硬依赖是**契约文本本身**（已冻结）；双方实现可全程并行。推荐顺序按"Console 侧就绪时间 × 业务链路依赖"排列：

```
第一批（现在即可启动）
  ├─ 通用约定对齐：鉴权/HMAC/信封/错误码/幂等键/超时（双方架构评审一次过）
  ├─ 场景一/二/三：商机投递 + 竞标提交 + 选标通知（M2 已闭合，替身验证 + K8s E2E 真跑）
  ├─ 对账 API（#35-#38）：与场景三同批，Console 对账器已在跑
  ├─ 场景四 Spec 签订：M3 已闭合，三路径 E2E 真跑（spec_hash 口径已裁决，§6 陷阱 16）
  ├─ 平台 infra 全量并行：IDP / 通知 / 对象存储 / Webhook 路由 / 跨站链接
  │    （Console Local 模式不受影响，CSIAdapter 就绪一个切一个）
  └─ LLM 网关与计费新版块：以 CSI-LLM-Gateway-Billing-Team-Requirements.md 为启动输入
       （接口面/测试数据/联调节奏五阶段已定稿；公测硬依赖——网关侧契约确认是当前关键路径）

第二批（Console 侧已就绪，随 Marketplace 实现节奏排期）
  ├─ 场景五 交付验收（M5-A2 交付：#13 wire 契约含签名 URL + #14 四 event_type；
  │    一处待 Marketplace 确认：修订期间 14 天计时行为，见 §3.2 场景五）
  ├─ 场景六/七 修订协商 + Spec 变更（M5-A3/A4 交付，E2E 五路 + handoff 契约断言在案）
  └─ 场景八 完整链路（M5-A5 交付：counter_proposal 部分结算已放开，600 公式 E2E 断言）

第三批（公测前，M6 窗口）
  ├─ 场景九/十 结算申诉 + 纠纷仲裁（Console 侧已交付：M5-A5/A6 + E2E；
  │    涉及真实资金，仍建议最后接——接前完成结算支付版块内部验收）
  └─ 网关联调收口（CSI_ENTITLEMENT_MODE=csi 切换 + E4 两红处置 + 公测免费额度激活端点 E6 联调）
```

说明：

- **场景一~三先接**的商业理由：打通"商机进 → 竞标出 → 中标回"即形成最小业务闭环，后续场景是在此闭环上的延伸。
- **结算最后接**的风控理由：场景八~十涉及资金与仲裁，依赖前序场景的 Project/Spec/交付数据都已真实流动，且结算支付版块完成内部验收——该理由与 Console 侧就绪与否无关（Console 侧已于 08-31 全部交付）。
- 每批联调前，双方先各自与契约替身跑通，再点对点联调；联调用例以 `employer-integration-api.md` 的场景时序为蓝本。

---

## 6. 已知陷阱与硬约束

对接实现中最容易踩的坑，按踩坑概率排序：

1. **Webhook 至少一次投递是常态**：接收方必须幂等。Console 已对全部入站 webhook 做 `(event_id, event_type)` 去重（落 `inbound_webhook_events` 表）；Marketplace 接收 Console 的 PATCH/POST 时同样要按 §3.2.5 幂等键去重。重复投递不是 bug，是设计内行为。
2. **bid.won 的异步窗口**：Console 收到 bid.won 先 200 ACK，再异步建 Project、然后调 `PATCH /orders/{order_id}` 回填 `project_id`。Marketplace 不得假设"发完 bid.won 立刻能拿到 project_id"；回填失败由 Console 侧重试（有界 5 次）+ 对账修复。
3. **超时各管各的，不要代劳**：§3.2.6 的归属方是唯一计时责任方。Marketplace 不要替 Console 做 24h 修订判定超时，Console 也不会替 Marketplace 做 14 天自动验收——越界计时会产生双触发。
4. **状态枚举两套语言**：PRD 用中文业务标签（如"修订协商中"），代码与 API 用英文符号（`revision_negotiation`）。映射表以 TS 附录 A.1 为准，API payload 里只出现英文符号。
5. **多轮竞标不新建 Opportunity**：任务重开 = `bid_round+1`，Marketplace 推送新一轮事件时不要新建商机记录，Console 按 `(workspace_id, marketplace_task_id)` 幂等键归并到既有 Opportunity。
6. **席位占用的 409 语义**：`CONFLICT_SEAT_FULL` 是业务正常分支（竞标被拒但任务仍在招标），不是系统错误；前端与告警不要按 5xx 处理。
7. **交付物提交有前置门**：Console 只在 Evidence Gates 全 passed 后调 `deliverables`；Marketplace 侧收到提交即可信，但应保留 `VALIDATION_GATE_NOT_PASSED` 错误码防御性校验。
8. **里程碑权重和 = 100%**：Spec 生成时校验；部分结算公式只认 `verified_passed` 里程碑。Marketplace 实现结算时不要自行发明"按完成比例估算"的算法。
9. **终态操作双向确认**：结算完成、仲裁结果等终态事件，接收方处理完要显式确认（如 `acknowledge` 端点），发送方未获确认前不得清理重试上下文（详见 `employer-integration-api.md` §7.4）。
10. **签名时间窗 5 分钟**：跨服务器时钟必须同步（NTP）；`AUTH_TIMESTAMP_EXPIRED` 不可重试，出现时先查时钟漂移。
11. **错误码可重试性**：`AUTH_*` 不可重试、`RATE_LIMIT_*`/`UPSTREAM_*`/`INTERNAL_*` 可重试——按 `retry_after_seconds` 退避，不要盲目立即重试 401。
12. **Console 内部 REST 不是对接面**：Console 前端使用的内部 API 随时可能因 UI 迭代变更；跨版块只依赖 `/v1/webhooks/*` 与 `/v1/marketplace/*` 两组路径。

以下三条针对 LLM 网关与计费新版块（§3.7）：

13. **额度耗尽是业务态不是故障**：网关对额度耗尽/套餐外模型返回 4xx 业务拒绝，两侧都不得按 5xx 重试放大无效调用；运行中 Task 遇额度不足走 Pre-dispatch 拒绝派发 + 通知 Owner 的路径，不触发系统异常告警。
14. **计量争议以网关为准**：Console 的 `agent_runs` 计量列是落账副本（项目成本风控与展示用），计费以网关 `Usage`/`Cost` 记录为唯一权威；流式调用中断造成的漏计/重计靠周期对账收敛，不以单侧记录定案。
15. **云端托管 Runtime 不开放自定义 LLM provider**：owner 的 LLM key 不进平台托管环境，Agent 模型可选范围由套餐权益目录下发（Console 不做自由文本输入）；自托管 Runtime 的自定义 provider 属后续版本能力，当前文档与 UI 均不预留入口，避免对外误承诺。

以下一条为 2026-08-27 按研发进展新登记的跨版块契约待裁决项（**已于 2026-08-29 由 M5-A2 裁决闭合**）：

16. **spec_hash 计算口径（场景四，已裁决——M5-A2，2026-08-29）**：Console 的 `submit_spec` 发送原始 Step-1 result bytes 作 `spec_content`，`spec_hash` 按 DB-canonical-JSONB 归一化摘要计算。**裁决：hash 仅作记录不重算**——Marketplace **不得**对 `spec_content` 原始字节重算 SHA-256 校验（JSONB key 顺序/空白归一化差异将永远不匹配）；`spec_hash` 是 Console 侧内容追溯/版本对账锚（`project_spec_revisions` 链），非实时校验门，传输完整性由既有 webhook HMAC 签名通道保障。场景五 #13 `deliverables` 提交若引用 `spec_hash` 沿用同一口径（记录不重算）。

---

## 7. 协作与变更机制

### 7.1 契约治理

- **契约冻结点**：本文 §3 与 `employer-integration-api.md` 构成跨版块契约基线。任何字段级变更（增删字段、改枚举、改超时）必须由发起方提前向 Console 团队提出，双方评审后同步更新 TS §12 + 源文档，再各自实现。
- **版本化**：破坏性变更走 `/v2/` 路径并行期；非破坏性新增（加可选字段、加 event_type）可直接演进，接收方必须忽略未知字段。
- **仲裁**：PRD 与 TS 冲突时以 TS 为准；本文与 TS/源文档冲突时以后者为准，并请告知 Console 团队修正本文。

### 7.2 对接工作方式

- **需求/缺陷通道**：跨版块需求与对接缺陷提给 Console 团队负责人（[联系人待登记]），Console 侧变更按 `.trellis/spec/engineering/technical-solution-drift-handling.md` 分层流程评估（小调整记设计文档 / 中等变更同步 TS / 大决策走 ADR）。
- **联调环境**：Console 侧测试 K8s 与远程 PG 已就绪；Marketplace 替身与 Console 替身互为镜像，建议联调排期前先交换替身自测报告。
- **进度同步**：Console 里程碑状态以本文 §2.1 快照为基线，后续变动由 Console 团队在里程碑闭合时刷新本节并通知各对接方。

### 7.3 变更通知模板（建议）

任何契约变更通知至少包含：变更端点/event_type、字段级 diff、对幂等键与状态机的影响、双向兼容期、联调验收用例。缺少任一要素，接收方有权拒绝排期。

---

*本文随 Console 里程碑推进持续刷新。v1.5 快照对应 M4（08-27）/M5 child（A1-A8，08-29~31）闭合、网关联调线 in_progress；**Console 侧 10 大场景已全部实现**。下次刷新建议发生在 M5 parent final-review 闭合、网关联调 task 收口、或任一真实跨版块联调启动时。*
