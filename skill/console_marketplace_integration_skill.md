---
name: "console-marketplace-integration"
description: "CSI Agent Owner Console 开发者对接 Marketplace（长任务平台侧）的完整集成技能：16 条唯一 Webhook 路径（24 event_type）承接、26 个 Marketplace API 调用、HMAC-SHA256 四步验签（方向分离密钥）、幂等键 9 条、状态机与超时归属、仲裁六值 outcome、LLM 网关计费对接（E1-E7/K1-K4）、BYOK 公测口径、联调步骤与验收场景，并附 M 侧平台实现代码地图（契约层/业务域/网关计量/联调窗口）。开发 Console 侧对接代码或联调排障时调用。"
---

# Console 开发者对接 Marketplace 集成技能

**目标**
- 让 Console 侧开发者按已冻结契约完成与 Marketplace（平台侧）的全部对接：Webhook 承接、API 调用、验签/幂等/超时、LLM 网关计费、BYOK 全局配置，并通过 10 大场景联调验收。

**触发时机**
- Console 侧开发 /api 对接代码、联调排障、契约字段确认、验收场景复测时调用本技能。

**权威文档（单一真相源，本文为导览）**

| 文档 | 用途 |
|------|------|
| `csi-longtask business-docs/design/employer-integration-api.md` | API/payload 细节权威（§2.2 端点清单、§7.4 终态确认） |
| `csi-longtask business-docs/design/CSI-Agent-Owner-Console-Technical-Solution.md` | Console 技术方案（TS §12 雇主侧集成 API、§17 Ports、附录 A 状态机、附录 B 错误码） |
| `csi-longtask business-docs/design/CSI-Agent-Owner-Console-Integration-Guide(2).md` | 跨版块集成总纲（§3 契约、§5 启动顺序、§6 陷阱） |
| `csi-longtask business-docs/design/prd.md` | 产品需求（§4.6 订阅套餐、附录 D 状态机单一真相表） |
| `csi-longtask business-docs/design/CSI-LLM-Gateway-Billing-Team-Requirements.md` | 网关团队专属逐接口对接文档（E1-E6/L1-L3/K1-K4/D1-D6） |
| `csi-longtask business-docs/design/M侧待处理清单v2答复.md` | Console 清单 v2 的 M 侧逐条答复（A 组闭账、C 组后勤、D 组 BYOK 处置意见） |
| `docs/longtask-integration-runbook.md` | 平台侧联调 Runbook（环境、启动顺序、场景验证、验收清单） |
| `docs/carbon-silicon-longtask-dev-plan.md` | 平台侧实现现状与裁决记录（§7 清单处置） |

**版本**：2026-09-02（对齐 Integration Guide v1.7 + 清单 v2 处置）

---

## 0. 致 Console 团队对接消息（2026-09-02，可直接转发）

> 附：①本文档 §1-§12（对接全量蓝本，Console 交付规格见 §11，M 侧实现参考见 §12）②`csi-longtask business-docs/design/M侧待处理清单v2答复.md`

各位好，

贵方《M侧待处理和决策清单 v2》已逐条处置完毕，**A 组 3 项阻断项全部闭账并落地代码**（均过平台侧 42 套件 / 224 用例回归），联调第一批可按贵方建议启动。要点如下：

**1. A 组闭账摘要**
- **A1**：#42 仲裁结果已按六值实现（新增 `resume_execution`/`closed` 两个零结算出口，`amount_cny` 必为 null），payload 同时携带 `outcome` 与 `resolution`（过渡期双写）。见 §4。
- **A2**：14 天验收计时精确口径 = **reset-on-resubmit**（修订完成后再提交即新 `submission_seq`、重新计满 14 天；修订期间无计时在跑）。#14 payload 已补 `accept_deadline`/`after_sale_deadline`，Console 无需对账拉取。见 §6。请贵方评估数据面对齐（贵方现状"继续"语义 → "最新 submission + 14d"）。
- **A3**：幂等键 9 条已全部落库（取消协商本轮补 `(order_id, cancel_proposal_seq)` UNIQUE，云库已执行 DDL；结算 `(project_id)` 钱面约束原已落）。见 §5。

**2. 需贵方提供/确认（详见 §11 交付清单）**
- 16 条 webhook 路径注册确认 + 与 marketplacestub 的替身自测报告；
- `CONSOLE_BASE_URL`（122 K8s 具体地址端口）+ **122 → 122.51.51.177:4001 出向可达性验证**；
- 联调期两把方向密钥（`LONGTASK_INBOUND_TOKEN` / `LONGTASK_OUTBOUND_TOKEN`，已按方向分离实现）的交换方式确认；
- 重试纪律入 checklist：**HTTP 重试必须携带新 X-Request-Id**（nonce 去重，见 §2）。

**3. E7 端点补登记**：`GET /v1/entitlement/llm-config/:orgId` 为本轮新增端点，请贵方按 §10 契约治理确认后补登记 TS §12.2/附录 B.4。

**4. BYOK 决策通道**：2026-08-31 产品决策的 5 处冲突处置意见已随附件②提交贵方 Owner 裁决。**裁决落地前网关线按冻结契约执行**：E6 激活与 K1-K4 公测挂起，E1-E4 计量对账面保留，主链联调不受影响。见 §7。

**5. 联调排期（对齐贵方 C4）**
- **第一批（即启）**：场景一/二/三/四 + 对账 #35-#38 + 可靠性 6 用例；
- **第二批**：场景五/六/七/八（场景五待 A2 对齐闭账；`settlement.completed` 投递点我方在第二批前接线）；
- **第三批（公测前）**：场景九/十 + 网关线收口（E7 + 计量对账）。

联调蓝本以本文档（2026-09-02 版）为准，验收窗口关闭条件按 Runbook §6。有任何口径出入请直接在答复文档上批注回传。

—— Marketplace 团队

---

## 1. 对接总览

混合模式：**同步 RPC + 异步 Webhook**，双方实现可全程并行（唯一硬依赖是契约文本，已冻结）。

- `M→C`（Marketplace → Console）：Console 提供 **16 条唯一 Webhook 路径**（TS §12.2 行计数 17 含端点复用；24 种 event_type），平台出站投递器每 10s 驱动，at-least-once。
- `C→M`（Console → Marketplace）：Marketplace 提供 **26 个 API 端点**（去重后 24 个唯一路径，平台侧已全部实现）。
- 引用口径注意：`employer-integration-api.md` §2.2 只列 14 webhook / 22 API（缺场景十），以 TS §12.2 清单为准。
- Console 侧现状：M2-M5 里程碑全部闭合（场景一~十 Console 侧已交付并经契约替身 E2E 真跑）。

## 2. 环境变量与联调环境

```bash
# HMAC 密钥按方向分离（清单 C2 闭账；未设方向密钥时回落 LONGTASK_SERVICE_TOKEN 兼容）
LONGTASK_OUTBOUND_TOKEN=<m2c-secret>     # M→C 出站投递（平台投递器 → Console webhook 的 Bearer + HMAC）
LONGTASK_INBOUND_TOKEN=<c2m-secret>      # C→M 入站验签（Console → 平台 API 的 Bearer + HMAC，含 E 面/K 面服务级）
# 生产口径：K8s Secret 注入；提前 7 天双发轮换，旧 token 24h 过渡；联调期密钥经加密渠道线下交换

CONSOLE_BASE_URL=http://<console-k8s>:8800    # 平台投递器 → Console（122 K8s）
MARKETPLACE_BASE_URL=http://122.51.51.177:4001  # Console → 平台（联调窗口；待 Console 验证 122 出向可达）

# 平台侧替身自测（先各自与替身跑通，再点对点联调；Console 替身 marketplacestub 与我方 mock-console auth 行为互为镜像）
node scripts/mock-console.mjs 8800       # 16 webhook 路径 + 四步验签 + nonce 去重 + 故障注入 ?fail=500|404|timeout
```

**nonce 纪律（清单 B2，联调 checklist 必含）**：HTTP 重试必须携带**新的 X-Request-Id**（否则 nonce 去重会把合法重试判为重放，破坏 at-least-once）；`Idempotency-Key` 同一逻辑写内保持不变。M 侧守卫为验签成功后才消耗 nonce（验签失败不消耗），重试恒换新 id 的客户端两种语义均兼容。

## 3. 通用契约（双方一致，§3.1）

| 约定 | 规格 |
|------|------|
| 通用请求头 | `Authorization: Bearer <service_token>`、`X-Signature: t=<unix_ts>,v1=<hmac_sha256(body原文+ts)>`、`X-Request-Id: <uuid-v7>`、`Idempotency-Key: <uuid-v7>`（写操作） |
| 接收方验证流程（四步） | Bearer 比对 → timestamp 偏差 ≤ 5min → **nonce 唯一**（X-Request-Id，去重表防重放）→ HMAC-SHA256 重算。**每次请求必须带 X-Request-Id，缺头即 401** |
| Webhook 投递 | at-least-once；2xx 成功；4xx 不重试；5xx 重试 5 次（5s/30s/2min/10min/1h）后进死信表 + 告警 |
| 幂等 | 入站按 `(event_id, event_type)` 去重 + `Idempotency-Key` 兜底 + 业务自然键 DB UNIQUE（§1.6 清单） |
| 超时分级 | 短 5s（GET/轻写）/ 中 15s（一般写）/ 长 60s（大文件/批量） |
| 错误响应 | RFC 7807 + 扩展（error_code/details/retry_after_seconds）；`AUTH_*` 不可重试，`RATE_LIMIT_*`/`UPSTREAM_*`/`INTERNAL_*` 按 retry_after 退避 |
| 版本化 | URL 前缀 `/v1/`；接收方必须忽略未知字段 |

**平台侧参考实现**：`backend/src/longtask/contract/hmac.guard.ts`（四步守卫）、`hmac-sign.ts`（签名/验签）、`uuid7.ts`。

## 4. Console 必须实现的 16 条 Webhook 路径（M→C，24 event_type）

统一路径风格 `POST /v1/webhooks/<domain>/<event>`，全部需要四步验签 + `(event_id, event_type)` 去重 + 200 ACK。按场景：

| 场景 | Webhook | event_type / 说明 |
|------|---------|------------------|
| 一 商机投递 | `/v1/webhooks/opportunity/pushed` | 商机推送 |
| 三 选标 | `/v1/webhooks/bid/result` | `bid.won`（先 200 ACK 再异步建 Project，随后回填 project_id）/ `bid.lost` / `bid.batch_rejected` |
| 四 Spec 签订 | `/v1/webhooks/task/employer-reply` | 雇主回复 Mention |
| | `/v1/webhooks/spec/employer-action` | `spec.confirmed` / `spec.rejected` / `spec.timeout` |
| 五 交付验收 | `/v1/webhooks/delivery/employer-review` | `delivery.accepted` / `delivery.rejected` / `delivery.revision_requested` / `delivery.auto_accepted` |
| 六 修订协商 | `/v1/webhooks/revision/negotiation-action` | 协商通知（2 天超时默认 C） |
| 七 Spec 变更 | `/v1/webhooks/spec-change/request` | 雇主发起变更（Console 24h 判定） |
| | `/v1/webhooks/spec-change/employer-confirmation` | 雇主二次确认 |
| 八 取消结算 | `/v1/webhooks/project/cancel-request` | 协商取消（3 天 Owner 响应计时） |
| | `/v1/webhooks/project/cancel-counter-response` | 雇主对部分结算方案响应 |
| | `/v1/webhooks/project/cancel-resolution` | auto_settled / to_dispute |
| 九 结算申诉 | `/v1/webhooks/settlement/result` | `settlement.completed` |
| | `/v1/webhooks/project/dispute-raised` | 纠纷发起（7 天申诉期内） |
| | `/v1/webhooks/settlement/appeal-period-closed` | 申诉期关闭 → 终态 |
| 十 纠纷仲裁 | `/v1/webhooks/dispute/arbitration-started` | 平台受理 |
| | `/v1/webhooks/dispute/arbitration-result` | `dispute.resolved`——**outcome 六值**（A1 闭账）：`cancel / fulfill / partial_settlement / refund`（资金处置）+ `resume_execution`（G6 回执行）/ `closed`（G3 零结算关闭）；两零结算出口 `amount_cny` 必为 null，payload 同时携带 `outcome` 与 `resolution`（过渡期双写） |

## 5. Console 要调用的 26 个 Marketplace API（C→M）

统一前缀 `POST/GET/PATCH /v1/marketplace/...`，写操作带 `Idempotency-Key`。关键端点（完整 payload 见 employer-integration-api.md §2.2）：

| 场景 | 端点 | 要点 |
|------|------|------|
| 一 | `GET /v1/marketplace/tasks`、`GET .../tasks/{task_id}` | 商机 Pull（5min 定时 + 手动） |
| 二 | `POST .../tasks/{task_id}/bids` | 占席位；满席 `409 CONFLICT_SEAT_FULL` 是业务正常分支 |
| 三 | `PATCH /v1/marketplace/orders/{order_id}` | 回填 `project_id`（有界重试 5 次 + 对账修复） |
| 四 | `POST .../orders/{order_id}/employer-mentions`、`POST .../orders/{order_id}/spec` | Spec 提交启动 7 天计时；`spec_hash` **仅作记录不重算**（陷阱 16） |
| 五 | `POST .../orders/{order_id}/deliverables` | Evidence Gates 全 passed 才提交；只传 metadata + 签名 URL；启动 14 天验收计时 |
| 六 | `POST .../revision-negotiation/start`、`POST .../revision-negotiation/{negotiation_id}/decide` | 4 选项决策（A/B 需双方同意，C 按现状验收，D 转纠纷） |
| 七 | `POST .../revision-requests/{request_id}/classify`、`POST .../spec-changes`、`.../confirm`、`.../reject` | 24h 判定 + 3 天对方响应计时 |
| 八 | `POST .../cancel-requests/{request_id}/respond`、`.../auto-resolve`、`.../finalize`、`.../to-dispute` | counter_proposal 部分结算按 `verified_passed` 公式（E2E 断言 600 = 60% × 1000） |
| 九 | `POST .../settlement/trigger` | 结算金额 = Σ(里程碑权重 × Spec.final_price)，仅计 `verified_passed` |
| 十 | `POST .../disputes/{dispute_id}/evidence`、`.../acknowledge` | 举证 + 终态确认（未获确认前发送方不得清理重试上下文） |
| 对账 | `GET .../orders/{order_id}/settlement`、`.../status`、`GET /v1/marketplace/workspaces/{workspace_id}/settlements`、`.../orders` | Console 每 10min 对账 |

**业务幂等键 9 条**（Marketplace 侧 DB UNIQUE 全部落库，Console 侧重试安全，清单 A3 闭账）：

| 操作 | 业务幂等键 |
|------|-----------|
| 商机 Push/Pull | `(workspace_id, marketplace_task_id)` |
| 提交竞标 | `(marketplace_task_id, bid_round, workspace_id)` |
| Spec 推送 | `(project_id, spec_version)` |
| 交付物提交 | `(project_id, submission_seq)` |
| 验收回调 | `(project_id, review_round)`——平台以 `submission_seq` 等价承载轮次 |
| Spec 变更请求 | `(project_id, change_seq)` |
| 修订请求 | `(project_id, revision_round)`——由 `submission_seq` 等价承载 |
| 取消协商 | `(project_id, cancel_proposal_seq)`（本轮新增，云库约束已落） |
| **触发结算** | **`(project_id)`**——一个 Project 仅一次结算，钱面约束 |

## 6. 状态机与超时归属（§3.3 / TS 附录 A）

- 状态映射以 TS 附录 A.1 为准，**API payload 只用英文符号**（如 `revision_negotiation`），PRD 中文标签不入 API。
- **超时各管各的，不代劳**。Marketplace 归属 6 项：席位满后 72h 未决策 / Spec 7 天未确认 / 交付后 14 天自动验收 / 修订协商 2 天 / Spec 驳回 5 次 / 取消签约 30 天——平台侧 `timeout-scanner.service.ts` 已全部注册。Console 归属：Spec 变更 24h 判定、取消 3 天响应等（deadline_scanner 驱动）。
- 14 天验收计时精确语义（A2 闭账口径）：**修订期间（revising，无 pending 记录）无计时在跑（等效暂停）；修订完成后再提交 = 新 submission_seq，`accept_deadline` 重新计满 14 天（reset-on-resubmit，非剩余顺延）**。`delivery.revision_requested/rejected` 未耗尽（`count <= limit`）进入 revising，第 limit+1 次链式升级修订协商。#14 payload 已携带 `accept_deadline` / `after_sale_deadline`，Console 无需对账拉取。5/9/13 天催办锚定最新一次提交的 accept_deadline。

## 7. LLM 网关与计费对接面（§3.7 + DR-12）

Console 侧对接钩子（均已落地）：

| 钩子 | 说明 |
|------|------|
| `LLMProviderPort`（TS §17.3.3） | 网关作为新 CSIAdapter（`GatewayProvider`）接入，`CSI_LLM_MODE=gateway` 切换；`Chat/ChatStream/Embed/Capabilities` 调用面零新增契约 |
| `EntitlementPort`（TS §17.3.5，第 10 Port） | `GetPlan/GetCatalog/GetQuota/GetUsage/Capabilities` 五方法；LocalAdapter 全放行；`CSI_ENTITLEMENT_MODE=csi` 切换 |
| Pre-dispatch 校验 | 套餐外模型 → `PREDISPATCH_MODEL_NOT_ENTITLED`；额度耗尽 → `PREDISPATCH_LLM_QUOTA_EXHAUSTED`（4xx 业务态，**不得按 5xx 重试**）——**公测挂起**（BYOK 下额度在用户网关侧），契约词汇保留、恢复时启用 |
| 计量落账 | `agent_runs.token_usage_input/output/total + cost_cents` 是网关数据的**落账副本**（项目成本风控），计费权威在网关 |
| 对账 | 每小时增量 + 每日全量；偏差 > 0.5%（可配）写 `watchdog_logs` + urgent 通知 |
| 错误族 | `ENTITLEMENT_*`（TS 附录 B.6）：额度耗尽/套餐外模型/实例超限 = 4xx 业务拒绝 |

**网关接口面**（细节以网关专属文档为准；实现状态见下方 BYOK 公测口径）：

- `E1-E4`：订阅/权益/额度/用量（HMAC 服务级，平台已实现 `entitlement.controller.ts`）——**保留**，作为 BYOK 用量的平台侧计量对账与展示面（`/settings/billing` 数据源）
- `E6`：公测免费额度激活——**公测挂起**（BYOK 下无平台额度可赠；待支付版块就绪后随套餐售卖恢复）
- `E7`：用户网关凭证数据面 `GET /v1/entitlement/llm-config/:orgId`（HMAC，返回 `{org_id, base_url, api_key}`）——**新增端点，已请 Console 确认后补登记 TS §12.2/B.4**（按 §10 契约治理流程）
- `L1-L2`：网关代理转发 + 计量上报 `POST /v1/entitlement/usage-records`（网关权威计量 → 平台原子扣减记录；签名同 §3 口径，含 X-Request-Id/nonce）
- `K1-K4`：workspace key 签发（K1 幂等）/ run 标识注入（K2）/ 吊销（K3）/ 轮换（K4）——平台侧 `gateway-keys.controller.ts` 已实现，**公测挂起不切**，保留为正式版 daemon 通道（联调第三批的"K 线收口"改为"E7 + 计量对账收口"）
- 归集键：`TenantID = workspace_id`（uuid）；run 级明细用 `agent_run_id` 关联

**BYOK 公测口径（2026-08-31 产品决策 + 清单 D 组处置意见，最终以双方评审回写 TS/PRD 为准）**：

平台已放弃站内套餐售卖与支付，公测期改为用户自带网关 Key（BYOK）。与冻结契约（指南 §3.7 / DR-12 / PRD §4.6）的 5 处冲突处置：

1. **key 存储/下发**：owner 主动配置自有凭证（AES-256-GCM 加密存储 `user_llm_configs`），仅经用户态 JWT（runtime-env）或服务级 HMAC（E7）下发；"永不存不发"收敛为"不存不发平台签发的 key"
2. **K2 环境变量**：公测接受偏离（owner 知情配置自己的 key）；K2 daemon 本地代理为正式版目标形态
3. **自定义 provider**（陷阱 15 公测修订）：BYOK 即受控的自定义 provider 入口；自托管 Runtime 仍不开放
4. **套餐/额度硬断/E6**：公测挂起；E1-E4 计量对账面保留，额度扣减只记不断（BYOK 额度在用户网关侧）
5. **凭证通道权威**：公测 = `user_llm_configs` + runtime-env（JWT 全局引导）+ E7（服务级批量）；K1-K4 保留不切

**runtime 全局配置引导**：`GET /api/v1/llm-proxy/runtime-env`（用户 JWT）→ `{env: {OPENAI_BASE_URL, OPENAI_API_KEY, LLM_PROXY_MODE}}`，runtime 启动时拉取注入环境变量，Agent 用标准 OpenAI SDK 即可调用用户网关；`OPENAI_BASE_URL` 自动归一到 `/v1`。平台直连代理 `POST /api/v1/llm-proxy/chat/completions`（JWT + `X-Workspace-Id` 头）按 usage 字段自动计量落库。

## 8. 已知陷阱（§6 全 16 条，按踩坑概率）

1. Webhook 至少一次投递是常态，接收方必须幂等——重复投递不是 bug。
2. `bid.won` 异步窗口：先 200 ACK 再建 Project 再回填 project_id，不得假设发完即得。
3. 超时各管各的，越界计时会产生双触发。
4. 状态枚举两套语言，API 只出现英文符号。
5. 多轮竞标不新建 Opportunity（`bid_round+1` 归并）。
6. `CONFLICT_SEAT_FULL` 是业务正常分支，勿按 5xx 告警。
7. 交付物提交有 Evidence Gates 前置门，保留 `VALIDATION_GATE_NOT_PASSED` 防御性校验。
8. 里程碑权重和 = 100%，部分结算只认 `verified_passed`，勿发明按比例估算。
9. 终态操作双向确认（acknowledge），未确认前不得清理重试上下文。
10. 签名时间窗 5 分钟，`AUTH_TIMESTAMP_EXPIRED` 先查 NTP 时钟漂移。
11. 错误码按可重试性处置，勿盲目重试 401。
12. Console 内部 REST 不是对接面，跨版块只依赖 `/v1/webhooks/*` 与 `/v1/marketplace/*`。
13. 额度耗尽是业务态不是故障，勿按 5xx 重试放大。
14. 计量争议以网关为准，`agent_runs` 列只是落账副本。
15. 云端托管 Runtime 不开放自定义 LLM provider——**公测修订**：BYOK 是受控例外（用户自有 key 经 runtime-env 注入自有网关）；除 BYOK 通道外 owner key 仍不得进托管环境。
16. `spec_hash` 仅作记录不重算——Marketplace 不得对 `spec_content` 重算 SHA-256（JSONB 归一化差异永不匹配），传输完整性由 HMAC 通道保障。

## 9. 联调步骤与验收

1. **替身自测**：Console 与平台各自对契约替身跑通并交换自测报告（平台替身 `scripts/mock-console.mjs` 支持 16 webhook 路径验签 + nonce 去重 + 故障注入；Console 替身 `marketplacestub` 互为镜像）。
2. **点对点联调**：按 Runbook 启动顺序（替身 → 平台后端方向分离密钥 `LONGTASK_INBOUND/OUTBOUND_TOKEN` + `CONSOLE_BASE_URL=http://122.51.51.177:4001`）。
3. **场景验收**：按三批推进（清单 C4 一致）——
   - **第一批（即启）**：场景一/二/三 + 场景四 + 对账 API #35-#38 + 可靠性 6 用例
   - **第二批**：场景五/六/七/八（场景五按 §6 A2 闭账口径对齐后再接）
   - **第三批（公测前）**：场景九/十（资金面，最后接）+ 网关线收口（E7 + 计量对账收口，K 线挂起待 BYOK 决策回写）
4. **可靠性 6 用例**（联调必测）：重复投递去重、5xx 退避重试、死信告警、4xx 不重试、超时中断、nonce 重放拒绝（401 `AUTH_NONCE_DUPLICATE`）。
5. **网关联调收口（M6，BYOK 公测口径）**：`CSI_ENTITLEMENT_MODE=csi` 切换 + **E7 凭证数据面接入 runtime**（`runtime-env` 全局引导或服务级拉取）+ E4 计量对账收口（额度只记不断）；E6 激活与 K1-K4 daemon 通道**公测挂起**，待 BYOK 决策双方评审回写 TS/PRD 后恢复。
6. **验收清单**：以 `docs/longtask-integration-runbook.md` §6 为窗口关闭条件。

## 10. 协作机制（§7）

- 契约冻结点：Integration Guide §3 + employer-integration-api.md；字段级变更须双方评审后同步 TS §12 + 源文档再实现。
- 破坏性变更走 `/v2/` 并行期；非破坏性新增可直接演进。
- PRD 与 TS 冲突以 TS 为准；指南与 TS/源文档冲突以后者为准并回写修正。
- 文档计数以 §12.2 清单为准（TS §0.4「38 API」为已知文案偏差，附录 D.3 #19 登记）。
- **治理实例（清单 v2 轮）**：A 组阻断项经《M侧待处理清单v2答复.md》书面闭账后代码落地（A1 六值 outcome / A2 计时口径 reset-on-resubmit / A3 幂等键 9 条落库）；架构级变更（D 组 BYOK）未达共识前**一律按冻结契约执行、不阻断主链**，走双方 Owner 决策通道并回写 TS/PRD 后生效。

## 11. Console 侧需提供的接口与环境变量（交付清单）

> Console 团队需向 Marketplace 侧提供/确认的对接物全量规格（依据平台投递代码实况逐条核对）。

### 11.1 Webhook 承接端点（16 条唯一路径，24 event_type）

统一规格：`POST {CONSOLE_BASE_URL}/v1/webhooks/<domain>/<event>`；请求头四件套 `Authorization: Bearer <LONGTASK_OUTBOUND_TOKEN>`、`X-Signature: t=<unix_ts>,v1=<hmac_sha256(body原文+ts)>`、`X-Request-Id`（uuid-v7，每次投递新生成）、`Idempotency-Key`（= outbox event_id，重投不变）。

接收方要求：四步验签（Bearer → ts≤5min → nonce 唯一 → HMAC）、`(event_id, event_type)` 去重、2xx ACK、错误码按 TS 附录 B.4 词汇。**HTTP 重试需换新 X-Request-Id**（nonce 纪律）。时间字段 ISO 8601 UTC；金额口径以 mock-console 联调实际值为准。

| # | 路径 | event_type | M→C payload 字段 |
|---|------|-----------|------------------|
| 1 | `/v1/webhooks/opportunity/pushed` | `opportunity.pushed` | `marketplace_task_id`、`workspace_id`、`bid_round`、`title`、`category_id`、`budget_min_cny`、`budget_max_cny`、`expires_at`（可 null） |
| 2 | `/v1/webhooks/bid/result` | `bid.won` | `marketplace_task_id`、`workspace_id`、`order_id`（中标生成的平台订单 id）、`bid_round` |
| 2 | 同上（复用） | `bid.batch_rejected` | `marketplace_task_id`、`workspace_id`、`bid_round`（平台单选标场景，无独立 `bid.lost` 投递） |
| 3 | `/v1/webhooks/task/employer-reply` | `task.employer_reply` | `order_id`、`reply` |
| 4 | `/v1/webhooks/spec/employer-action` | `spec.confirmed` | `order_id`、`project_id`、`spec_version` |
| 4 | 同上（复用） | `spec.rejected` | `order_id`、`project_id`、`rejection_count`、`reason`（可 null） |
| 4 | 同上（复用） | `spec.timeout` | `order_id`、`project_id`（7 天未确认，任务重开竞标） |
| 5 | `/v1/webhooks/delivery/employer-review` | `delivery.accepted` / `rejected` / `revision_requested` / `auto_accepted` | `order_id`、`project_id`、`submission_seq`、`reason`、`accept_deadline`（A2 闭账字段）、`after_sale_deadline`（accepted/auto_accepted 携带） |
| 6 | `/v1/webhooks/revision/negotiation-action` | `revision.negotiation_action` | `negotiation_id`、`order_id`、`action`（`started`/`decided`/`expired_default_c`）、`reason`、`deadline`、`decision`（A/B/C/D，仅 decided） |
| 7 | `/v1/webhooks/spec-change/request` | `spec_change.request` | `request_id`、`order_id`、`project_id`、`change_seq` |
| 7 | `/v1/webhooks/spec-change/employer-confirmation` | `spec_change.employer_confirmation` | `request_id`、`order_id` |
| 8 | `/v1/webhooks/project/cancel-request` | `project.cancel_request` | `request_id`、`order_id`、`project_id`（可 null）、`trigger`（`owner_request`/`spec_rejected_5`） |
| 8 | `/v1/webhooks/project/cancel-counter-response` | `project.cancel_counter_response` | `request_id`、`order_id`、`owner_response` |
| 8 | `/v1/webhooks/project/cancel-resolution` | `project.cancel_resolution` | `request_id`、`order_id`、`resolution`（`auto_settled`/`to_dispute`） |
| 9 | `/v1/webhooks/settlement/result` | `settlement.completed` | `order_id`、`project_id`、`amount_cny`、`breakdown`（⚠️ 投递点待结算完成链接线，第二批前接线） |
| 9 | `/v1/webhooks/project/dispute-raised` | `project.dispute_raised` | `dispute_id`、`order_id`、`reason` |
| 9 | `/v1/webhooks/settlement/appeal-period-closed` | `settlement.appeal_period_closed` | `order_id`、`project_id` |
| 10 | `/v1/webhooks/dispute/arbitration-started` | `dispute.arbitration_started` | `dispute_id`、`order_id` |
| 10 | `/v1/webhooks/dispute/arbitration-result` | `dispute.arbitration_result` | `dispute_id`、`order_id`、`outcome`（**六值**）、`resolution`（过渡期双写）、`amount_cny`（零结算出口必为 null） |

### 11.2 环境变量

| 变量 | 方向 | 说明 |
|------|------|------|
| `MARKETPLACE_BASE_URL` | Console → M | 平台联调地址 `http://122.51.51.177:4001`（生产 K8s 地址另行提供） |
| `LONGTASK_INBOUND_TOKEN` | Console → M | C→M 方向密钥：调平台 API 的 Bearer + HMAC 签名共用（平台 `hmac.guard` 同密钥比对），联调期线下交换 |
| `LONGTASK_OUTBOUND_TOKEN` | M → Console | M→C 方向密钥：校验平台投递的 Bearer 与 `X-Signature`。**与上行不是同一把**（方向分离） |
| `CONSOLE_BASE_URL` | 告知 M | Console 测试实例基址（122 K8s），平台投递器拼接目标；请提供地址端口并验证互通 |
| `CSI_ENTITLEMENT_MODE=csi` | Console 内部 | EntitlementPort 切平台通道（M6 启用；此前 LocalAdapter） |
| `CSI_LLM_MODE=gateway` | Console 内部 | LLMProviderPort 切网关 CSIAdapter（M6 启用） |
| 网关凭证获取 | M6 | BYOK 公测口径：runtime 启动调 `GET /api/v1/llm-proxy/runtime-env`（JWT）注入 `OPENAI_BASE_URL`/`OPENAI_API_KEY`；或服务级 `GET /v1/entitlement/llm-config/:orgId`（HMAC） |

**密钥交换**：联调期两把方向密钥经加密渠道线下交换（双方确认方式）；生产 K8s Secret + 提前 7 天双发轮换、旧 token 24h 过渡。

### 11.3 C→M API 调用参数约定

- 基址：`MARKETPLACE_BASE_URL` + `/v1/marketplace/...`（26 端点见 §5）
- 通用头：`Authorization: Bearer <LONGTASK_INBOUND_TOKEN>`、`X-Signature`（同口径 HMAC）、`X-Request-Id`（uuid-v7，**每次请求新生成，重试必须更换**）、写操作加 `Idempotency-Key`（同一逻辑写内不变）
- 幂等键：按 §5 九条业务键（商机/竞标/Spec/交付/验收/变更/修订/取消协商/结算）
- 超时：短 5s（GET/轻写）/ 中 15s（一般写）/ 长 60s（大文件/批量）
- 错误处置：`AUTH_*` 不可重试；`VALIDATION_*` 修正后重发；`RATE_LIMIT_*`/`UPSTREAM_*`/`INTERNAL_*` 按 `retry_after_seconds` 退避；`CONFLICT_SEAT_FULL`(409) 是业务正常分支
- 对账：Console 每 10min 拉取 #35-#38 四个对账端点，修复 #3 project_id 回填缺口

### 11.4 联调交付核验单（启动条件）

- [ ] 16 条 webhook 路径（含复用端点映射）全部注册且四步验签通过（错误码 B.4 词汇）
- [ ] 与 `marketplacestub` 替身自测报告（含 nonce 重放、重复投递去重）
- [ ] `CONSOLE_BASE_URL` 地址提供 + 122 K8s → `122.51.51.177:4001` 出向可达验证结果
- [ ] 联调期密钥交换方式确认（两把方向密钥）
- [ ] `settlement.completed` 端点到位（我方第二批前接线）
- [ ] M6 收口项确认：`CSI_ENTITLEMENT_MODE=csi`、E7/runtime-env 凭证接入、E4 计量对账（额度只记不断口径）

## 12. M 侧（Marketplace 平台侧）实现参考——代码地图与对接方式

Console 排障或对口径时，可对照我方以下实现（NestJS，仓库 `backend/src/`）：

### 12.1 契约层（`longtask/contract/`，双方对接的行为面）

| 文件 | 职责 | 对接要点 |
|------|------|---------|
| `hmac.guard.ts` | C→M 入站四步验签守卫（Bearer → ts≤5min → nonce 唯一 → HMAC 重算） | 密钥 `LONGTASK_INBOUND_TOKEN`（回落 `LONGTASK_SERVICE_TOKEN`）；**验签成功才消耗 nonce**；nonce TTL 10min（2× 时间窗） |
| `hmac-nonce.entity.ts` | nonce 去重表（PG 主键冲突判重放 / SQLite 双方言） | 重放返回 401 `AUTH_NONCE_DUPLICATE`，缺 `X-Request-Id` 返回 401 `AUTH_NONCE_MISSING` |
| `hmac-sign.ts` | HMAC-SHA256 签名/验签（body 原文 + ts） | 与 Console 侧签名口径必须逐字节一致（JSON.stringify 后原文） |
| `uuid7.ts` | uuid-v7 生成（48bit 时间戳 + version 7 + variant 10） | `X-Request-Id` 每次投递新生成；`Idempotency-Key` = outbox event_id（重投稳定不变） |
| `webhook-dispatcher.cron.ts` | M→C 出站投递器 | `@Interval(10s)` 驱动 outbox；Bearer 用 `LONGTASK_OUTBOUND_TOKEN`；投递前订单侧状态先落库再拼 payload |
| `webhook-dispatcher.service.ts` | outbox 状态机 + 入站去重（`webhook_inbound_events` 按 `(event_id, event_type)`） | 2xx success / 4xx 不重试 / 5xx 走退避 |
| `backoff.ts` | 退避序列 `[5s, 30s, 2min, 10min, 1h]`，5 次后进死信（`status='dead'`） | 死信即告警条件（可靠性用例 3） |
| `console-endpoints.ts` | 16 条 webhook 路径常量（`CONSOLE_WEBHOOK`） | 目标 URL = `CONSOLE_BASE_URL` + 路径 |
| `timeout-scanner.service.ts` | 超时注册表 + `scanDue` | 由 **5min cron** 驱动；到期项交各域处理器执行默认动作 |

### 12.2 业务域（M→C 事件源头 + C→M 端点实现）

| 模块 | 平台职责 | 触发的 webhook（→ 路径见 §11.1） |
|------|---------|--------------------------------|
| `marketplace-tasks/` | 商机发布/Pull（`GET /v1/marketplace/tasks`）、轮次重开 | `opportunity.pushed`（投递日志行 id 作稳定 event_id） |
| `marketplace-bids/` | 竞标占席（`409 CONFLICT_SEAT_FULL` 业务分支）、选标、席位满 72h 自动驳回 | `bid.won` / `bid.batch_rejected` |
| `marketplace-orders/` | 订单、Spec 签订（7 天计时）、交付/验收（14 天 reset-on-resubmit）、修订协商（2 天默认 C）、Spec 变更（24h 判定归 Console）、取消协商骨架、**5/9/13 天催办（锚最新 submission 的 accept_deadline）** | `spec.confirmed/rejected/timeout`、`task.employer_reply`、`delivery.accepted/rejected/revision_requested/auto_accepted`、`revision.negotiation_action`、`spec_change.request/employer_confirmation`、`project.cancel_request/counter_response/resolution` |
| `settlements/` | 结算触发（`(order_id)` UNIQUE 钱面约束）、7 天申诉期关闭、对账 4 端点 #35-#38 | `settlement.appeal_period_closed`；`settlement.completed` 投递点第二批前接线 |
| `disputes/` | 纠纷发起（7 天申诉期内）、举证、受理、仲裁六值结果 | `project.dispute_raised`、`dispute.arbitration_started/result` |

C→M 24 个唯一路径统一前缀 `@Controller('v1/marketplace')`（`marketplace-contract.controller.ts`），orderId 归属校验 + 400 `VALIDATION_INVALID_PAYLOAD` 口径全量覆盖。

### 12.3 网关与计量（`gateway/` + `entitlement/` + `llm-proxy/`）

| 模块 | 对接端点 | 说明 |
|------|---------|------|
| `entitlement.controller.ts` | E1-E4（订阅/权益/额度/用量）、L2 计量上报 `POST /v1/entitlement/usage-records`、E6（公测挂起）、**E7** `GET /v1/entitlement/llm-config/:orgId` | HMAC 服务级（`LONGTASK_INBOUND_TOKEN` 作 HMAC secret）；额度三段式预扣费（hold→settle→refund），BYOK 公测下**只记不断** |
| `gateway/gateway-keys.controller.ts` | K1-K4（签发/注入/吊销/轮换） | 已实现，公测挂起不切（BYOK 决策通道） |
| `llm-proxy/llm-proxy.service.ts` | `GET /api/v1/llm-proxy/runtime-env`（JWT，BYOK 全局引导）、`POST /api/v1/llm-proxy/chat/completions`（直连代理 + usage 自动计量落库，输入/输出分开计价） | key AES-256-GCM 加密存 `user_llm_configs`；BYOK 计量进 E1-E4 同一套 `entitlement_usage_records` |

### 12.4 联调窗口与运行口径

- 平台地址：`http://122.51.51.177:4001`（后端，连云库 PG，`DB_SYNC=false`）；前端 `:5173`
- 启动：`PORT=4001 npm run start:dev`（backend/，根目录 `.env` 加载 DB/密钥配置）
- 替身自测：`node scripts/mock-console.mjs 8800`（16 路径 + 四步验签 + nonce 去重 + `?fail=500|404|timeout` 故障注入）
- 排障入口：`webhook_outbox`（投递状态/attempts/lastError）、`webhook_inbound_events`（入站去重）、`hmac_nonces`（nonce 消耗）、超时注册表（5min cron 驱动，重启即恢复）
- 数据一致性：幂等键 9 条 DB UNIQUE（§5）；金额 `*_cny`；时间 ISO 8601 UTC
- 回归基线：42 套件 / 224 用例（`npx jest`），契约行为变更必须过全量再联调
