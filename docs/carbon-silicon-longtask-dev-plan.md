# 碳硅（CSI）长任务业务 — 开发计划总览

> **文档状态**：v1.0（2026-08-31）
> **依据**：[PRD](../csi-longtask%20business-docs/design/prd.md) v0.3 ｜ [技术方案 TS v1.2.1](../csi-longtask%20business-docs/design/CSI-Agent-Owner-Console-Technical-Solution.md) ｜ [平台侧执行方案](./longtask-platform-execution-plan.md) v1.1 ｜ [平台侧落地实施方案](./longtask-platform-implementation-plan.md) v1.0
> **读者**：双侧研发（Console 侧 / 平台侧）与项目管理

---

## 1. 业务范围（PRD 四阶段）

| 阶段 | 内容 | 交付实体 |
|---|---|---|
| Phase 0 入驻准备 | Owner/雇主入驻、Workspace 初始化、Agent Runtime 注册心跳、Agent 配置、订阅套餐与 LLM 额度（DR-12） | Workspace / Agent / Runtime / Subscription |
| Phase 1 竞标 | 商机三模式投递（Push/Pull/手动派发）、席位机制（默认 20、满 72h 倒计时）、竞标工作流、综合分排序、雇主选标 | Opportunity / MarketplaceBid |
| Phase 2 签约 | Project 创建、Spec 生成与雇主确认、spec_hash 锁定、7 天超时重开 | Project / Spec |
| Phase 3 自主交付 | Orchestrator Plan 生成/审批、Task DAG 执行、质量五层防线（L0-L4）、14 天验收、修订协商、Goal Mode(P2)、Spec 变更(P2)、预算上限 30% | Plan / Task / Deliverable / Settlement |

## 2. 双侧分工与现状

| 系统 | 仓库 | 职责 | 现状（2026-08-31） |
|---|---|---|---|
| **Agent Owner Console** | 另一仓库（Go + chi + sqlc，Multica fork） | Opportunity 9 态、竞标工作流编排、Plan/Task 执行、质量防线、LLM 网关（DR-12 EntitlementPort） | M0~M3 ✅（场景一二三四 + 场景八骨架经 K8s 三路径 E2E）；M4 🔄 收尾 [11/13]；M5/M6 planning |
| **平台侧 Marketplace** | 本仓库 `backend/src/longtask/` + `frontend/src/pages/` | 任务大厅、席位竞标、订单、Spec 承载、验收计时、结算数据面、仲裁 | T1~T22 全部完成并回归通过（[汇总报告](./test-reports/overall-regression-summary.md)）；26 端点中 22 个 C→M 已按契约对齐 |

## 3. 本次代码更新（2026-08-31，联调未决项闭环）

| 项 | 更新 |
|---|---|
| 端点路径对齐（未决项 #4） | 场景六/七/八/九/十共 11 个端点按 `employer-integration-api.md` §2.2 嵌套 `orders/{order_id}/`：cancel-requests ×4、revision-negotiation ×2、revision-requests/classify、spec-changes ×3、settlement/trigger、disputes ×2（[marketplace-contract.controller.ts](../backend/src/longtask/contract/marketplace-contract.controller.ts)） |
| 服务层归属校验 | cancel/negotiation/spec-change/disputes 各方法补 `orderId` 归属校验，不匹配 → 404 |
| 校验错误码 | 参数校验由裸 500 改为 400 `VALIDATION_INVALID_PAYLOAD`（RFC 7807 渲染） |
| spec_hash 口径（未决项 #1） | 新增 [spec-hash.ts](../backend/src/longtask/contract/spec-hash.ts)：canonical JSON（键排序）+ SHA-256；Console 显式提交只记录不重算，未提供则补算。与 Console DB-canonical-JSONB 口径一致 |
| **AI 网关订阅权益计费（DR-12，2026-08-31 新增）** | 新增 [entitlement 模块](../backend/src/entitlement/entitlement.module.ts)：① 6 张表（套餐/模型目录/Org 订阅/额度周期/公测免费额度/用量明细）；② E1~E4 数据面 API（套餐/目录/额度/用量+增量游标，HMAC 鉴权，RFC 7807）；③ 计量上报原子扣减（免费额度优先、周期额度条件 UPDATE 防 TOCTOU，超限 402 `ENTITLEMENT_QUOTA_EXHAUSTED`）；④ 权益校验点（实例数上限/模型目录/RuntimeProfile 目录，B.6 403 错误码）；⑤ 订阅生命周期（激活含免费额度即赠、升级即时生效、降级 pending 下周期生效）；免费额度数值/有效期为运营参数（`ENTITLEMENT_FREE_TOKENS`/`ENTITLEMENT_FREE_VALID_DAYS`） |
| 文档同步 | 执行方案 §3.2/§7-2、回归汇总 §5 未决项 #1/#4 标记闭环 |
| **套餐运营管理界面（2026-08-31 新增）** | 后端 [entitlement-admin.controller.ts](../backend/src/entitlement/entitlement-admin.controller.ts)：`api/v1/admin/entitlement/*`（AdminGuard）：套餐列表/创建/更新/停用（软删，模型目录整体替换）+ **订阅生命周期操作**（激活/升级/降级）+ **预扣费冻结单管理**（冻结单列表 + 运营兜底结算/退款，幂等）+ **用量查询**（复用 E4）。前端 [AdminEntitlement.tsx](../frontend/src/pages/AdminEntitlement.tsx)：`/admin/entitlement` 页面（套餐 CRUD 表单、订阅操作面板与升级/降级按钮、冻结单管理表、用量查询），已接入管理员工作台导航 |
| **AI 订阅方案落地：credits 双维度计费（2026-08-31，依据 skill/onellm_media_skill.md）** | 按 OneLLM 真实计费口径补齐双维度：① **聊天按 token、媒体生成按 credits**（`billing_method` 按张/按秒）；② **媒体预扣费三段式**：提交冻结（`holdCredits`，可用额 = 周期剩余 + 免费 credits − 冻结占用，不足 402）→ 终态结算（`settleHold`，按实际 `cost` 入账 + media 用量落库，多退少补）→ 失败退款（`refundHold`，全额释放）；`task_id` 幂等（对应 OneLLM `GET /v1/media/tasks/{task_id}`）；③ 模型目录增加 `model_type`（chat/image/video/audio/tts/music，对齐 `/v1/media/models`），权益校验新增 `media_model` 类别；④ E3 额度状态增加 `remaining_credits`/`available_credits`/`frozen_credits`，E4 账单增加 credits 聚合；⑤ 运营参数 `ENTITLEMENT_FREE_CREDITS`（免费 credits，默认 200）；⑥ API：`POST/GET /v1/entitlement/credit-holds[/:taskId/settle|refund]` |
| 验证 | longtask 域 23 套件/154 用例 ✅；entitlement 17 用例（含冻结/结算/退款/幂等）✅；全项目 42 套件/216 用例 ✅；`nest build` 0 错误；前端 `vite build` ✅ |

## 4. 剩余工作分解

> **范围约定（2026-08-31）**：本仓库只开发碳硅业务平台侧（Marketplace + AI 网关订阅权益计费）代码；Console 侧（另一仓库）工作仅列为对齐依赖，不在本仓库开发。平台侧 P0/P1 代码项经核查已全部落地（22 个 C→M 端点、5/9/13 天催办 [delivery-reminders.ts](../backend/src/longtask/marketplace-orders/delivery-reminders.ts)、Pull 模式端点、spec_hash 默认口径、**AI 网关套餐/权益/额度/账单 [Entitlement 模块](../backend/src/entitlement/entitlement.service.ts)（2026-08-31 新增，见 §3）**）。

### P0 平台侧剩余事项（2026-08-31 更新：平台侧可独立推进的工作已全部完成，#1-3 与 #5-8 进入待联调状态，等待联调窗口开启）

| # | 事项 | 性质 | 状态 | 依赖 / 解锁条件 |
|---|---|---|---|---|
| 1 | 未决项 #2：与 Console 对齐 `workspace_id` 同步口径 | 协议 | ⏳ 联调中——平台侧提案已冻结（见 [Runbook §3.1](longtask-integration-runbook.md)：UUID v4 主键、入驻时建立、回调原样回传），待 Console 书面确认 | Console 团队 |
| 2 | 未决项 #5：状态枚举最终核对一次写入契约（英文符号已就绪） | 协议 | ⏳ 联调中——平台侧枚举冻结清单已提取（[Runbook §3.2](longtask-integration-runbook.md)，10 实体全量），待 Console 核对 | Console 团队 |
| 3 | 未决项 #3：与结算支付版块对结算单字段/`settlement.completed` 回写协议 | 协议 | ⏸ 待联调 | 结算版块；场景八联调前冻结 |
| 4 | ~~spec_hash 口径写入契约正文~~ ✅ **已完成（2026-08-31）**：[employer-integration-api.md](../csi-longtask%20business-docs/design/research/employer-integration-api.md) §13.4.1 落定——Console 显式提交只记录不重算（陷阱 16）；未传时平台按 canonical-JSON + SHA-256 补算；§13.4 示例字段由 `snapshot_hash` 更正为 `spec_hash` | 文档 | ✅ 已完成 | Console 侧按同口径实现即可 |
| 5 | 场景一二三四真实联调（契约替身已过，换真环境） | 联调 | ⏳ 联调中——[Runbook](longtask-integration-runbook.md) 已就绪：替身自测通过（验签/幂等/快照），等真实 Console 接入 | Console M2 ✅；#1/#2 确认后进入真环境 |
| 6 | 场景五~八真实联调（spec 签订/验收/修订/变更/协商取消全链路） | 联调 | ⏳ 联调中——Console M5 已闭合（指南(2) §2.1：10 场景 Console 侧全部实现 + E2E 四链路 K8s 全绿），场景五 14 天计时裁决已回写（暂停+重交重置）；依赖 #3 结算协议 |
| 7 | 套餐运营面收尾：正式版按量溢价、对账偏差阈值联动 watchdog（>0.5% 写日志 + urgent）——运营管理界面已完成（见 §3） | 代码（公测后） | ⏸ 待联调（公测后启动） | 结算版块 / 正式版节奏 |
| 8 | 与 Console 对齐 EntitlementPort 接入：`CSI_ENTITLEMENT_MODE=csi` 时 E1~E4/B.6 联调 | 联调 | ⏳ 联调中——**K1-K4 已实现**（[gateway 模块](../backend/src/gateway/gateway-keys.service.ts)：签发幂等/validate 验签注入/revoke/rotate，AES-GCM 加密存储 + sk-csi- 格式，5 单测 ✅，见 [Runbook §4b](longtask-integration-runbook.md)）；L2 计量面已由 recordUsage/credit-holds 承载；L1 代理转发归网关服务本体（skill 文档 API 口径），本仓库只做权益校验+计费；**E5/L1/L2 精确定义待 Console 仓库专属文档对齐**（唯一剩余） | Console M6 + 网关联调 task |

> **对照《集成指南(2)》（2026-08-31）核查结论**：§4.1 Marketplace 团队 5 项职责全部满足（26 C→M API / 17 webhook 投递器含本轮生产接线 / 状态机+席位+6 超时 / 对账 #35-#38 / 24 event_type 映射）；`project_id` 空窗容忍 ✓；§4.1 建议的契约替身互为镜像 ✓；§2.2 spec_hash 裁决一致 ✓、场景五跨版块待确认项已由平台侧裁决回写 ✓；§3.7 网关契约面 E1-E4/B.6/E6 已就绪，K1-K4 与 E5/L1/L2 待专属文档对齐。Console M5 闭合后**全场景联调的 Console 侧前置已全部解除**，剩余仅协议确认（#1/#2/#3）与真实环境接入。
>
> **§3.1 通用约定补齐（2026-08-31 第二轮核查后）**：① **nonce 唯一**（§3.1 验证流程第 3 步）——[HmacGuard](../backend/src/longtask/contract/hmac.guard.ts) 升级为四步（Bearer → timestamp ≤5min → nonce 唯一 → HMAC 重算），nonce 取 `X-Request-Id`，落 [hmac_nonces](../backend/src/longtask/contract/hmac-nonce.entity.ts) 去重表（TTL 10min，云库已建表），重复请求 401 `AUTH_NONCE_DUPLICATE`、缺头 401 `AUTH_NONCE_MISSING`，实测重放拒绝 ✓。② **契约头**（§3.1 通用请求头）——出站投递器 [webhook-dispatcher.cron.ts](../backend/src/longtask/contract/webhook-dispatcher.cron.ts) 补 `X-Request-Id`（[uuid-v7](../backend/src/longtask/contract/uuid7.ts)）+ `Idempotency-Key`（= outbox event_id）；42 套件/224 用例全绿 ✅。剩余仅 E5 接口面定义与 E6 逐字段核对（待 Console 专属文档）。

> **联调窗口开启（2026-08-31）**：本轮补齐了联调前置缺口——① 出站 Webhook 生产投递接线（此前 outbox 只入队不投递）：[webhook-dispatcher.cron.ts](../backend/src/longtask/contract/webhook-dispatcher.cron.ts) 每 10s 驱动 `processDue`，真实 sendFn 携带 Bearer + X-Signature（HMAC-SHA256(body+ts)），未配置令牌时空转跳过；3 用例单测 ✅。② Console 契约替身 [scripts/mock-console.mjs](../scripts/mock-console.mjs)（17 webhook + HMAC 验签 + (event_id,event_type) 去重 + 故障注入 `?fail=500|404|timeout` + `GET /__received` 快照），冒烟三链路验证通过。③ [联调 Runbook](longtask-integration-runbook.md)：环境变量、启动顺序、workspace_id 提案、枚举冻结清单、场景一~十验证步骤、可靠性 6 用例、窗口关闭验收清单。

> **产品方向变更（2026-08-31 晚，AI Token 配置化）**：用户侧「AI 订阅套餐」改为「**配置 AI Token**」（[MyPlan.tsx](../frontend/src/pages/MyPlan.tsx) 重写，/plan 路由不变）——**放弃平台内卖套餐与支付**（mock 支付等 portal 支付端点保留但前端下架），改为 BYOK 两种方式：① 用户自有网关（直接填网关地址 + API Key）；② 引导跳转 OneLLM 门户（`https://onellm.opennotebook.chat/portal/home`）购买 Token 套餐并创建 Key 后回填。后端新增 `user_llm_configs` 表（org_id 主键，[user-llm-config.entity.ts](../backend/src/entitlement/user-llm-config.entity.ts)，云库已建表）与 portal 三端点（`GET/POST/DELETE /api/v1/entitlement/portal/my/llm-config`，Key AES-256-GCM 加密存储仅回显前缀掩码）；端到端冒烟通过（保存/校验拒绝/upsert/清除），42 套件全绿 ✅。**执行链已接线**：① 新增 [llm-proxy 模块](../backend/src/llm-proxy/llm-proxy.service.ts)——用户态 `POST /api/v1/llm-proxy/chat/completions`（JWT）按当前用户配置解密 key 转发至用户网关（OpenAI 口径透传），usage 字段 best-effort 计量落库（workspace 非法/缺省跳过，BYOK 不拦截不硬断），未配置 409 `LLM_CONFIG_MISSING`；② 新增 E7 服务级数据面 `GET /v1/entitlement/llm-config/:orgId`（HMAC 通道，Console 执行引擎按 org 拉取用户网关凭证）。实测：代理调用 gpt-5.4 成功回复 + 计量自动落库（tokens 59→76）。注意：E1-E4/额度计量链路不变（服务端仍按额度计费），运营侧套餐模板数据保留。

### Console 侧对齐依赖（另一仓库，仅跟踪不开发）

| 里程碑 | 内容 | 状态 | 对平台侧的影响 |
|---|---|---|---|
| M4 收尾 | 编排引擎 + Plan 审批 + Task 执行 + 可靠性栈 L1-L3 | 🔄 [11/13] | 场景五~八联调前置 |
| M5 | 验收闭环 + 修订循环 + L4 + 场景五~七 handler；放开 counter_proposal 422 | planning | 场景六完整链路 |
| M6 | Dogfooding + 结算真实核验 + `CSIEntitlementAdapter` 接入平台计费 API（DR-12 商业化面平台侧已承载，Console 只做适配） | planning | 平台 entitlement API ✅ |
| Workspace 拉取商机定时器 / 手动派发 / 相似度 ≥85% 软警告 / Agent Team / 预算上限 30% 暂停 | PRD P1 Console 侧功能 | planning | 平台侧 Pull 端点已就绪，无需改动 |

### P2 公测后迭代（PRD §11.3，届时再评估归属）

- Goal Mode、Peer Review Team、Spec 变更管理增强
- 支付结算真实资金面、评价信誉体系、平台管理后台、移动端
- 工作流版本管理 / 模板市场 / A/B 测试（PRD 附录 A 排除项）

## 5. 排期建议（对齐 PRD §11.2）

| 阶段 | 内容 | 周期参考 | 前置 |
|---|---|---|---|
| 协议冻结 | 未决项 #2/#5/#3 + spec_hash 写入契约正文 | 0.5 周 | Console/结算版块响应 |
| 联调冲刺 1 | 场景一二三四（竞标 + 签约）真环境联调 | 1 周 | 协议冻结 |
| Console M4 闭合 | 编排 + 可靠性栈 L1-L3 收尾（Console 侧） | 按既有计划 | — |
| Console M5 | 验收闭环 + 场景五~七 handler（Console 侧） | ~1 周 | M4 |
| 联调冲刺 2 | 场景五~八全链路真环境联调 | 1 周 | M5 |
| M6 | 结算真实核验（场景九/十资金面）+ Dogfooding + 异常覆盖 | ~2 周 | 结算版块协议 |
| M7 | Beta 发布 | — | 全部 P0 |

## 6. 风险清单

1. 双侧枚举/口径类联调项（#2/#5）依赖 Console 团队响应速度，建议本周期内一次性书面冻结。
2. 结算资金面（场景九/十）涉外部版块，排期不确定性最高——平台侧「备数据」边界已就绪，可最后接入。
3. LLM 网关（DR-12）为 Console 侧独立验收项，不阻塞本仓库联调。
4. counter_proposal 完整链路依赖 Console M5 放开 422 限制。

## 7. Console 清单 v2 处置记录（2026-09-02，答复见 `csi-longtask business-docs/design/M侧待处理清单v2答复.md`）

| 组 | 项 | 处置 | 状态 |
|---|---|------|------|
| A1 | #42 仲裁 outcome 六值 | DISPUTE_RESOLUTION 扩六值（+resume_execution/closed）+ 零结算校验 + payload 补 outcome；云库实况单测覆盖 | ✅ 已落地 |
| A2 | 修订期 14 天计时语义 | 精确口径 = reset-on-resubmit（修订后再提交重新计满 14d，修订中等效暂停）；#14 payload 补 accept_deadline/after_sale_deadline；Console 侧待按"最新 submission +14d"对齐 | ✅ M 侧已闭账 / ⚠️ C 侧 patch 待评估 |
| A3 | 幂等键 9 条 | 结算 order_id UNIQUE 原已落；本轮补 cancel_requests.cancel_proposal_seq + UNIQUE（云库 DDL 已执行）；修订轮次由 submission_seq 等价承载 | ✅ 已落地 |
| B4 | skill 文档三处勘误 | 16 条唯一路径 / 席位满后 72h / 引用以 TS §12.2 为准 | ✅ 已回写 |
| C1 | 联调地址 | 122.51.51.177:4001（联调窗口）/ 5173（前端），待 C 侧验证 122 K8s 出向可达 | 已答复 |
| C2 | 方向分离密钥 | LONGTASK_INBOUND_TOKEN / LONGTASK_OUTBOUND_TOKEN 已实现（回落 SERVICE_TOKEN 兼容），联调期线下交换 | ✅ 已落地 |
| D | BYOK 契约冲突 5 处 | 处置意见已提交（公测挂起 E6/硬断与 K 线，保留 E1-E4 计量面，E7 请补登记）；待双方评审回写 TS/PRD，不阻断主链 | 🔄 决策通道 |
