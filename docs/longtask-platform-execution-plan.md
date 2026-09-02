# CSI 长任务业务 — 平台侧执行方案

> **文档状态**：定稿 v1.1（按对接指南 v1.3 快照刷新）
> **日期**：2026-08-21（v1.0）｜ 2026-08-27（v1.1 同步 Console 里程碑进展）
> **受众**：平台侧（碳硅交易平台 / Marketplace）研发团队
> **依据文档**：
>
> * PRD `csi-longtask business-docs/design/prd.md`（业务需求唯一权威）
>
> * 对接指南 `CSI-Agent-Owner-Console-Integration-Guide(1).md` v1.3（跨版块契约，2026-08-27 快照）
>
> * 技术方案 `CSI-Agent-Owner-Console-Technical-Solution.md`（Console 侧实现权威）
>
> * 雇主侧集成 API `design/research/employer-integration-api.md`（端点细节）

***

## 0. 方向约定（阅读前必读）

| 记号    | 含义                    | 谁提供                          |
| ----- | --------------------- | ---------------------------- |
| `C→M` | Console 调 Marketplace | **平台提供 API（26 个）**           |
| `M→C` | Marketplace 调 Console | **Console 提供 Webhook（17 个）** |

跨版块唯一对接面是 HTTP 契约（同步 RPC + 异步 Webhook），不引入消息总线，不共享数据库。

***

## 1. 背景与目标

### 1.1 双线架构（关键前提）

平台（当前项目 `d:\task\CSI`）承载两条**完全独立**的业务线：

```
平台（d:\task\CSI）
│
├─ ① 短任务线：agentMarket（Agent 商品化 + MCP Server + 即时执行）
│     平台对接 MCP 把 Agent 维护进来，保留现有 tasks/bids/orders
│
└─ ② 长任务线：Marketplace 侧（任务大厅 / 席位竞标 / 验收 / 结算 / 仲裁）
        ↕ HTTP 契约（43 端点）
      Console（Workspace / Agent Runtime / 编排 / 自主交付）
```

### 1.2 目标

本方案定义**长任务线**的平台侧开发任务、能力接口、排期，并以「新建表、不改短任务表」为原则落地。

***

## 2. 范围与决策记录

### 2.1 已定决策（4 条）

| #  | 决策                   | 落地含义                                                                                                    |        |
| -- | -------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| D1 | 新增 Workspace 表（改造语义） | AI 工作室是平台侧卖方主体的升级改造（现有 Agent Owner 用户 → 运营工作室），workspaces 绑定既有 users 体系并承接展示页 + 商机投递 + 竞标关联，非孤立新功能      | <br /> |
| D2 | 短任务/长任务独立（方案 A）      | 短任务保留现有 `tasks/bids/orders`；长任务新建 `marketplace_tasks/opportunities/marketplace_bids/marketplace_orders` |        |
| D3 | 结算/仲裁/LLM 分工         | 结算只备数据（划款交关联方）；仲裁平台侧完成；LLM 网关关联方处理                                                                      |        |
| D4 | agentMarket 不转让      | 短任务线经 MCP 保留，与长任务并线                                                                                     |        |

### 2.2 平台侧职责边界

* **平台负责**：任务大厅、席位竞标、选标、验收计时、结算数据、仲裁、Workspace 展示页、对账。

* **平台不负责**：Agent/Runtime/编排/自主交付（Console）、真实资金划转（结算关联方）、LLM 网关/计量计费（关联方）。

***

## 3. 三类清单

### 3.1 平台需要迭代的任务

| 阶段     | 迭代任务                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------ |
| 一 底座   | 建 `workspaces` + CRUD + 展示页 API；建 `marketplace_tasks`（7 态 + 席位/轮次时间字段）+ 任务发布字段对齐；HMAC/错误码体系；Webhook 投递器；幂等键；超时定时器  |
| 二 竞标   | 商机投递三模式 + 幂等；席位机制 + 多轮 + 72h 倒计时；选标/全部驳回/任务过期；综合分排序 + 平台推荐标签；`opportunities/marketplace_bids/marketplace_orders` 表 |
| 三 签约   | 场景四三向联动（先裁决 spec\_hash 口径）；Spec 超时 7 天重开 + 中标失效联动；场景八骨架（#24-#30 事件收发）                                              |
| 四 验收   | 场景五/六/七；14 天自动验收 + 催办；修订协商 2 天窗口；售后 7 天申诉期；场景八完整链路（counter\_proposal）                                              |
| 五 结算仲裁 | 结算数据准备（结算单 + 里程碑公式 + 对账）；长任务仲裁（3 天举证 + 7 天裁定 + 4 选项）                                                               |

### 3.2 平台需要提供的能力接口（C→M，被 Console 调用，共 26 个）

| 场景      | 端点                                                         | 说明                                   |
| ------- | ---------------------------------------------------------- | ------------------------------------ |
| 商机投递    | `GET /v1/marketplace/tasks`                                | 商机 Pull                              |
| 商机投递    | `GET /v1/marketplace/tasks/{task_id}`                      | 任务详情                                 |
| 竞标提交    | `POST /v1/marketplace/tasks/{task_id}/bids`                | 提交竞标并占席位，满返 409 `CONFLICT_SEAT_FULL` |
| 选标回填    | `PATCH /v1/marketplace/orders/{order_id}`                  | 回填 `project_id`                      |
| Spec 签订 | `POST /v1/marketplace/orders/{order_id}/employer-mentions` | 推 Mention 通知给雇主                      |
| Spec 签订 | `POST /v1/marketplace/orders/{order_id}/spec`              | 提交 Spec（启动 7 天计时）                    |
| Spec 变更 | `POST .../revision-requests/{request_id}/classify`         | 修订/新增需求判定                            |
| 交付验收    | `POST /v1/marketplace/orders/{order_id}/deliverables`      | 提交交付物（启动 14 天计时）                     |
| 修订协商    | `POST .../revision-negotiation/start`                      | 启动 2 天协商窗口                           |
| 修订协商    | `POST .../revision-negotiation/{negotiation_id}/decide`    | 4 选项决策（A/B/C/D）                      |
| Spec 变更 | `POST .../spec-changes` + `/confirm` + `/reject`           | 变更提案 / 确认 / 拒绝                       |
| 协商取消    | `POST .../cancel-requests/{id}/respond`                    | Owner 响应取消                           |
| 协商取消    | `POST .../cancel-requests/{id}/auto-resolve`               | Owner 超时自动处理                         |
| 协商取消    | `POST .../cancel-requests/{id}/finalize`                   | 最终确认取消结算                             |
| 协商取消    | `POST .../cancel-requests/{id}/to-dispute`                 | 转纠纷                                  |
| 结算      | `POST .../settlement/trigger`                              | 触发结算（7 天托管期）                         |
| 仲裁      | `POST .../disputes/{dispute_id}/evidence`                  | 提交举证                                 |
| 仲裁      | `POST .../disputes/{dispute_id}/acknowledge`               | 确认仲裁结果（终态）                           |
| 对账      | `GET .../orders/{order_id}/settlement`                     | 查询结算状态                               |
| 对账      | `GET /v1/marketplace/workspaces/{wid}/settlements`         | Workspace 结算列表                       |
| 对账      | `GET .../orders/{order_id}/status`                         | Order 状态（Console 每 10min 对账）         |
| 对账      | `GET /v1/marketplace/workspaces/{wid}/orders`              | Workspace Order 列表                   |

> 全部端点需满足：统一信封 + HMAC-SHA256 验签 + 幂等键 UNIQUE + RFC 7807 错误码。端点细节以 `employer-integration-api.md` 为准。场景六/七/八/九/十端点已按契约嵌套 `orders/{order_id}/` 路径落码（2026-08-31 对齐，未决项 #4 闭环）；`spec_hash` 口径已裁决（见 §7 风险 2 处置）。

### 3.3 关联方需要提供的能力支持

| 关联方        | 需提供能力                                                                                                                       | 对接阶段                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Console 团队 | 17 个 M→C Webhook（✅M2）；场景四 handler（✅M3 三路径 E2E）；场景八骨架（✅M3-D4，counter\_proposal 暂返 422）；场景五\~七（📋M5）；场景九/十（📋M5/M6）；契约测试替身（✅） | 随 Console 里程碑（现状见 §6） |
| 结算支付版块     | `settlement/trigger` 后真实资金划转；`settlement.completed` 回写；结算单同步                                                                | 阶段五                   |
| LLM 网关团队   | 统一 LLM 网关、计量（Usage/Cost/TenantID）、订阅套餐与额度、权益查询 API                                                                          | 公测前（关联方独立验收）          |
| 平台基础设施（可选） | IDP SSO、通知渠道、对象存储、统一 Webhook 路由、跨站免登链接                                                                                      | 全程可并行灰度               |

***

## 4. 具体开发任务清单（含验收标准）

### 阶段一 底座

| 编号 | 任务                                                                                                                                  | 验收标准                                   | 优先级 |
| -- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --- |
| T1 | 建 `workspaces` 表（见附录 DDL）+ CRUD                                                                                                     | `slug` 唯一；展示页字段可读写                     | P0  |
| T2 | 建 `marketplace_tasks` 表（7 态 + `seat_limit/seat_taken/expires_at/seat_full_deadline/seat_full_locked_at/bid_round/last_reopened_at`） | 枚举对齐附录 D.1；`bid_round` 从 1 起           | P0  |
| T3 | 任务发布字段对齐（类目/预算区间/附件/标签）                                                                                                             | 发布后进入「招标中」                             | P0  |
| T4 | HMAC-SHA256 + Bearer + RFC 7807 错误码体系                                                                                               | 43 端点统一；`AUTH_*` 不可重试、`UPSTREAM_*` 可重试 | P0  |
| T5 | Webhook 投递器（at-least-once + `(event_id,event_type)` 去重 + 5 次退避 + 死信）                                                                | 重复事件幂等；5 次失败进死信并告警                     | P0  |
| T6 | 9 项业务幂等键 DB UNIQUE（附录 B）                                                                                                            | 并发下只有一条写入成功                            | P0  |
| T7 | 平台侧 6 项超时定时器                                                                                                                        | 到点触发且不越界（各管各的）                         | P0  |

### 阶段二 竞标闭环

| 编号  | 任务                                                        | 验收标准                                                          | 优先级 |
| --- | --------------------------------------------------------- | ------------------------------------------------------------- | --- |
| T8  | 商机投递三模式 + 幂等                                              | `UNIQUE(workspace_id, marketplace_task_id)` 竞态唯一              | P0  |
| T9  | 席位机制 + 多轮 + 72h 倒计时                                       | 席位满写 `seat_full_deadline=now()+72h`；到期自动全部驳回 + `bid_round+=1` | P0  |
| T10 | 选标 / 全部驳回 / 任务过期                                          | 选标后同任务其他商机→未中标；驳回后席位清零；到期→已过期                                 | P0  |
| T11 | 综合分排序 + 平台推荐标签                                            | 公式 `0.4评分+0.3性价比+0.3时效`；`source=platform_push` 且未冻结才显示标签      | P0  |
| T12 | `opportunities`/`marketplace_bids`/`marketplace_orders` 表 | 关联键 `order_id↔project_id` 冗余；竞标 UNIQUE 约束                     | P0  |
| T13 | 场景一二三对接 + 对账 #37/#38                                      | Console 契约替身 E2E 通过；每 10min 对账返回真实状态                          | P0  |
| T14 | Workspace 展示页前端                                           | §5.6.7 全部模块渲染；信用数据脱敏                                          | P0  |

### 阶段三 签约闭环（Console M3 已闭合，可第一批并行启动）

| 编号   | 任务                                       | 验收标准                                           | 优先级 |
| ---- | ---------------------------------------- | ---------------------------------------------- | --- |
| T15  | 场景四三向联动（employer-mentions / spec / 雇主确认） | Spec 提交启动 7 天计时；`spec_hash` 口径已裁决（§7-2）        | P0  |
| T16  | Spec 超时 7 天重开                            | `Project→已取消`、商机→中标失效、任务 `bid_round+=1` 席位清零   | P0  |
| T16b | 场景八骨架联调（#24-#30 事件收发）                    | 正确处理 `422 COUNTER_PROPOSAL_UNSUPPORTED`（M5 放开） | P1  |

### 阶段四 验收闭环

| 编号   | 任务                                | 验收标准                                               | 优先级 |
| ---- | --------------------------------- | -------------------------------------------------- | --- |
| T17  | 场景五（deliverables + 14 天验收 + 催办）   | 三条硬约束全满足才自动验收（PRD §9.4）                            | P0  |
| T18  | 场景六（修订协商 2 天 + 4 选项默认 C）          | 超时默认 C；写入 7 天 `after_sale_deadline`                | P0  |
| T19  | 场景七（Spec 变更 series）               | Spec version+1；幂等 `UNIQUE(project_id, change_seq)` | P1  |
| T19b | 场景八完整链路放开（counter\_proposal 部分结算） | M5 后反提案分支生效；按 `verified_passed` 里程碑权重备结算数据         | P1  |

### 阶段五 结算与仲裁（公测前最后一批，涉资金）

| 编号  | 任务                                                      | 验收标准                                                 | 优先级 |
| --- | ------------------------------------------------------- | ---------------------------------------------------- | --- |
| T20 | 结算数据准备（结算单 + 里程碑公式 + 对账 #35/#36）                        | `Σ(权重×final_price)` 仅计 `verified_passed`；权重和=100% 校验 | P0  |
| T21 | `settlement/trigger` 备数据交关联方 + 收 `settlement.completed` | 平台不执行划款；收到回写后更新状态                                    | P0  |
| T22 | 长任务仲裁（3 天举证 + 7 天裁定 + 4 选项）                             | `dispute.acknowledge` 终态确认；4 选项资金动作数据齐全              | P0  |

***

## 5. 详细执行计划

### 5.1 阶段依赖关系

```
阶段一(底座) ──► 阶段二(竞标闭环) ──► 阶段三(签约) ──► 阶段四(验收) ──► 阶段五(结算/仲裁)
     ▲                ▲                ▲               ▲               ▲
     │                │                │               │               │
  无前置          Console M2✅        Console M3✅    Console M4闭合+M5  结算/仲裁版块就绪
```

### 5.2 各阶段前置条件

| 阶段     | 平台侧前置                   | 关联方前置                                          |
| ------ | ----------------------- | ---------------------------------------------- |
| 一 底座   | 无                       | 无                                              |
| 二 竞标   | 阶段一完成                   | Console 场景一二三 handler ✅（M2 已闭合，K8s 三路径 E2E 真跑） |
| 三 签约   | 阶段二完成；`spec_hash` 口径已裁决 | Console M3 ✅ 已闭合（08-24，三路径 E2E）                |
| 四 验收   | 阶段二完成（可与阶段三并行）          | Console M4 闭合 + M5（雇主验收域裁决归 M5）                |
| 五 结算仲裁 | 阶段四完成                   | 结算支付版块 + Console M5 真实结算核验（M3-D2 移交项）+ M6 窗口   |

***

## 6. 任务排期

> 周期以 PRD §11.2 里程碑建议周期为锚；绝对日期取决于启动日与 Console 联调节奏。Console 现状（对接指南 v1.3 §2.1 快照，2026-08-27）：M0 ✅、M1 ✅\[7/7]、M2 ✅\[10/10]（08-22 闭合，场景一二三经 K8s 三路径 E2E 真跑）、M3 ✅（08-24 闭合，场景四三路径 + 场景八骨架）、M4 🔄 收尾中 \[11/13]（雇主验收域裁决归 M5）、M5/M6 planning。

| 阶段     | PRD 建议周期参考 | 平台侧任务           | 交付物                       | 可并行                   |
| ------ | ---------- | --------------- | ------------------------- | --------------------- |
| 一 底座   | 2 周（M1 对标） | T1\~T7          | 数据模型 + 横切底座               | 与 Console M2 并行       |
| 二 竞标   | 3 周（M2 对标） | T8\~T14         | 最小业务闭环（商机进→竞标出→中标回）       | 依赖阶段一                 |
| 三 签约   | 2 周（M3 对标） | T15\~T16 + T16b | Spec 签订打通（Console M3 已闭合） | 首批内紧随阶段二（联调依赖竞标闭环）    |
| 四 验收   | 1 周（M5 对标） | T17\~T19 + T19b | 交付验收 + 修订协商 + 场景八完整链路     | 依赖 Console M4 闭合 + M5 |
| 五 结算仲裁 | —（M6 对标）   | T20\~T22        | 结算数据 + 仲裁（场景九/十）          | 涉资金，最后接               |

### 6.1 批次启动顺序（聚焦平台侧）

```
第一批（现在即可启动）
  ├─ 阶段一全部（T1~T7）：数据模型 + 横切底座
  ├─ 阶段二（T8~T13）：竞标闭环（Console M2 已闭合，场景一二三可直接联调）
  ├─ 阶段三（T15~T16 + 场景八骨架 T16b）：Spec 签订（Console M3 已闭合；
  │    先裁决 spec_hash 口径，见 §7 风险 2）
  └─ 平台基础设施 Port / LLM 网关新版块同期启动（对齐 EntitlementPort 骨架）
第二批（Console M4 闭合 + M5 交付后）
  ├─ 阶段四（T17~T19）：场景五六七 交付验收 + 修订协商 + Spec 变更
  └─ 场景八完整链路放开（T19b：counter_proposal 部分结算）
第三批（公测前，M6 窗口，涉资金最后接）
  └─ 阶段五（T20~T22）：结算申诉（场景九）+ 纠纷仲裁（场景十）
```

### 6.2 关键联调点

| 联调点                            | 参与方                   | 前置                               |
| ------------------------------ | --------------------- | -------------------------------- |
| 通用约定对齐（HMAC/信封/错误码/幂等键/超时）     | 平台 + Console          | 阶段一                              |
| 场景一二三 + 对账                     | 平台 + Console          | Console M2 ✅（K8s E2E 真跑，可即时启动）   |
| 场景四（Spec 签订）                   | 平台 + Console          | Console M3 ✅；先行裁决 `spec_hash` 口径 |
| 场景五六七 + 场景八完整链路（验收/修订/变更/协商取消） | 平台 + Console          | Console M4 闭合 + M5               |
| 场景九/十（结算申诉/纠纷仲裁）               | 平台 + Console + 结算支付版块 | M6 窗口，涉资金最后接                     |

***

## 7. 风险与前置依赖

1. **`workspace_id`** **同步方式未决**：Workspace 展示信息由 Console 建后同步，还是平台侧独立编辑，尚未定。阶段一前需与 Console 团队确认。
2. **`spec_hash`** **计算口径【已裁决·平台侧默认落地 2026-08-31】**（对接指南 §6 陷阱 16，场景四前置）：采用「hash 按 canonical JSON 文本计算」分支——平台侧已落默认实现 `backend/src/longtask/contract/spec-hash.ts`（对象键递归排序 canonical JSON + SHA-256 hex，与 Console 的 DB-canonical-JSONB 归一化口径一致）。Console 显式提交 `spec_hash` 时平台只记录不重算；未提供时按该口径补算。联调时双方确认后写入契约正文。
3. **Webhook 签名/去重规范**：平台改造投递器时必须与 Console 侧 17 端点 + 平台基础设施「统一 Webhook 路由」三方对齐（同一签名与信封规范）。
4. **`counter_proposal`** **当前固定 422**：场景八 Console 侧 counter\_proposal 分支暂返 `422 COUNTER_PROPOSAL_UNSUPPORTED`（M5 放开）；平台联调骨架阶段需显式处理该错误码，勿按异常告警。
5. **结算「备数据」边界**：需与结算支付版块明确「结算单字段 + 触发时机 + settlement.completed 回写协议」；Console 侧 `cancelling→cancelled` 结算完成校验当前为 payload 布尔信封，M5 接真实结算核验（M3-D2 移交项）。
6. **勿接错计费面**：Console fork 内存在 Multica cloud-billing 代理面（`/api/cloud-billing/*`），不构成 CSI 对接契约——LLM 网关对接以 `EntitlementPort` + `LLMProviderPort`（TS DR-12）为准。
7. **Console 联调节奏**：场景五\~十依赖 Console M4 闭合 + M5/M6，平台按批次推进，不阻塞 Console。
8. **终态双向确认**：结算/仲裁等终态需 `acknowledge` 端点，发送方未获确认不得清理重试上下文。

***

## 附录 A：`workspaces` 表 DDL 草稿

```sql
CREATE TABLE workspaces (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID,                          -- 预留多工作室，先可空
  name                  VARCHAR(255) NOT NULL,
  slug                  VARCHAR(255) NOT NULL UNIQUE,
  logo_url              TEXT,
  bio                   TEXT,
  category_ids          TEXT[],                        -- 经营类目（平台类目树编码）
  capability_tags       TEXT[],                        -- 能力标签，≤5
  service_commitments   JSONB NOT NULL DEFAULT '{}',   -- 响应/修订/退款承诺
  display_status        VARCHAR(32) NOT NULL DEFAULT 'active', -- active/suspended/frozen
  receive_platform_push BOOLEAN NOT NULL DEFAULT true,
  auto_bid_enabled      BOOLEAN NOT NULL DEFAULT true,
  completed_tasks_count INT NOT NULL DEFAULT 0,        -- 信用数据（平台计算，脱敏）
  avg_rating            NUMERIC(3,2) NOT NULL DEFAULT 0,
  on_time_rate          NUMERIC(5,4) NOT NULL DEFAULT 0,
  dispute_rate          NUMERIC(5,4) NOT NULL DEFAULT 0,
  showcase_cases        JSONB,                         -- ≤6 案例（脱敏）
  announcement          VARCHAR(200),                  -- 首页公告
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 附录 B：9 项业务幂等键清单（§3.2.5）

| 操作             | 业务幂等键                                            | 实现方式      |
| -------------- | ------------------------------------------------ | --------- |
| 商机 Push / Pull | `(workspace_id, marketplace_task_id)`            | DB UNIQUE |
| 提交竞标方案         | `(marketplace_task_id, bid_round, workspace_id)` | DB UNIQUE |
| Spec 推送        | `(project_id, spec_version)`                     | DB UNIQUE |
| 交付物提交          | `(project_id, submission_seq)`                   | DB UNIQUE |
| 验收回调           | `(project_id, review_round)`                     | DB UNIQUE |
| Spec 变更请求      | `(project_id, change_seq)`                       | DB UNIQUE |
| 修订请求           | `(project_id, revision_round)`                   | DB UNIQUE |
| 取消协商           | `(project_id, cancel_proposal_seq)`              | DB UNIQUE |
| 触发结算           | `(project_id)`                                   | DB UNIQUE |

## 附录 C：平台侧 6 项自动超时（§3.2.6，各管各的）

| 超时场景       | 时长   | 默认动作                           |
| ---------- | ---- | ------------------------------ |
| Spec 雇主未确认 | 7 天  | 自动取消 Project（发 `spec.timeout`） |
| 自动验收       | 14 天 | 发 `delivery.auto_accepted`     |
| 修订协商窗口     | 2 天  | 默认选项 C（接受当前）                   |
| 席位满雇主未决策   | 72h  | 自动全部驳回                         |
| Spec 驳回次数  | 5 次  | 触发协商取消                         |
| 签约阶段总超时    | 30 天 | 触发协商取消                         |

