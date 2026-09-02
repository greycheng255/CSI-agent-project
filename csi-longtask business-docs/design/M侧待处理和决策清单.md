# Marketplace ↔ Console 真实联调启动前处理清单（v2，Console 团队 → Marketplace 团队）

> 依据：贵方 `console_marketplace_integration_skill.md`（2026-09-01 版）与我方 Integration Guide **v1.7** + TS 附录 B.4 逐条对照。
> 结论先行：**主链（场景一~十）契约对齐度高，第一批联调可启动**。A 组 3 项请联调启动前书面确认；B 组我方已处理完毕的部分无需动作；C 组为环境后勤；D 组（BYOK）走决策通道，不阻断主链。

## A. 需要联调启动前确认的（阻断项）

**A1. #42 仲裁结果 outcome 值域缺两值 —— G3/G6 出口会断链**

- 贵方文档写仲裁四选项（取消/履约/部分结算/退款），但 TS §12.2 场景十的 `outcome` 值域是**六值**，另有：
  - `resume_execution`：仲裁裁定取消不成立回执行（`dispute_in_progress→executing`，G6 主案例）
  - `closed`：平台裁定关闭（G3 `dispute_in_progress→closed`，零结算关闭）
- 我方 E2E 已验证这两条出口边（替身发送）。若贵方 webhook 发送器只实现四值，这两条边真实联调中永远触发不了。
- **请确认**：发送器按六值实现，或说明裁剪理由。

**A2. 场景五“修订期间计时暂停”的精确语义 —— 两侧 deadline 会分叉**
- 贵方文档称“平台侧已裁决回写”，但只回写了贵方文档，三点未闭账：
  1. **恢复规则**：修订完成回 `in_accept` 后，剩余时长续跑，还是重新计满 14 天？
  2. **Console 获知顺延后真实 deadline 的通道**：#14 payload 携带，还是我们走 #37 对账拉取？
  3. **催办口径**：我方 5/9/13 天催办锚定 `delivered_at`（revising 期间天然跳过），暂停语义下催办节奏需同口径。
- 我方数据面现状是“继续”语义（Edge #1 盖 `delivered_at/auto_accept_after`，Edge #4 再提交不重盖）。若贵方做“暂停+顺延”，两侧 `auto_accept_after` 会对不上，展示/催办全漂。
- **请提供**：①该裁决的原始决策文本；②上述三点精确定义。我方拿到后评估是否需数据面对齐小 patch（预计改动很小，不拖排期）。

**A3. 业务幂等键 9 条落库确认 —— 含一条钱面约束**
- 贵方文档只列 6 条，缺以下 3 条，请确认 DB UNIQUE 已落齐：

| 操作         | 业务幂等键                          | 备注                                          |
| ------------ | ----------------------------------- | --------------------------------------------- |
| 修订请求     | `(project_id, revision_round)`      |                                               |
| 取消协商     | `(project_id, cancel_proposal_seq)` |                                               |
| **触发结算** | **`(project_id)`**                  | **一个 Project 仅一次结算——钱面约束，必须落** |

## B. 我方已处理完毕 / 无需对方动作的

**B1. 错误码词汇已对齐（我方 patch，2026-09-01 交付）**
- 我方 16 个 webhook 入站端点的 error_code 已全量对齐 TS 附录 B.4 契约词汇（40 处站点）：401 族 `AUTH_TOKEN_INVALID` / `AUTH_HMAC_SIGNATURE_MISMATCH` / `AUTH_TIMESTAMP_EXPIRED`（时钟漂移与签名错误已拆分为两个专词）；400 族 `VALIDATION_PAYLOAD_INVALID` / `VALIDATION_EVENT_TYPE_UNSUPPORTED`；413 `PAYLOAD_TOO_LARGE`；503 `UPSTREAM_CONSOLE_UNAVAILABLE`；500 `INTERNAL_UNKNOWN`。
- TS B.4 恢复为活权威并增补 3 词条：`AUTH_NONCE_DUPLICATE`、`VALIDATION_EVENT_TYPE_UNSUPPORTED`、`PAYLOAD_TOO_LARGE`（均带 2026-09-01 注记）。**贵方断言脚本可直接按 B.4 词表编码，无需兼容旧词。**

**B2. nonce 语义已入册契约（原“待回写”已闭）**
- nonce = `X-Request-Id` 的定义已正式落 TS B.4 + 指南 §3.1（v1.7）：每次请求必带、缺头 401、重放 401 `AUTH_NONCE_DUPLICATE`。
- 双方纪律（请写进贵方联调 checklist）：**HTTP 重试必须携带新的 X-Request-Id**（否则 nonce 去重会把合法重试判为重放，破坏 at-least-once）；`Idempotency-Key` 同一逻辑写内保持不变。
- 我方已实测验证三面：重放命中 401 / 重试携新 id 穿透守卫 / 收到 401 NONCE_DUPLICATE 不重试直接浮出。请求头 uuid 版本已核实为 v7（贵方 nonce 唯一性校验无版本位冲突）。
- 一个可选澄清（联调期观察即可，不阻断）：贵方 nonce 守卫在**签名校验失败**的请求上是否也消耗该 nonce（“用过即废”语义）？我方客户端因重试恒换新 id，两种语义均兼容，仅用于双方排障时的归因对齐。

**B3. 替身已同步对齐**
- 我方 `marketplacestub`（M 侧镜像替身）已同步 B.4 鉴权词汇 + nonce 重放守卫——贵方 mock-console 与我方 stub 的 auth 行为面现在互为镜像。沿用既定做法：点对点联调前双方先各自与替身跑通并交换自测报告，我方 stub 可借贵方参考。

**B4. 贵方文档三处小误（勘误即可）**
- “席位 72h 未满” → 应为“**席位满后** 72h 未决策”；
- “17 个 Webhook”是 TS §12.2 行计数口径，**唯一路径 16 条**，联调用例请按 16 路径枚举；
- employer-integration-api.md §2.2 只列 14 webhook / 22 API（缺场景十），以 TS §12.2 为准——贵方引用时同此口径。

## C. 环境与后勤（联调排期前敲定）

**C1. 部署与网络**：我方 Console 测试实例跑在 122 K8s。请提供贵方 backend 真实联调部署地址、网络可达性（122 → 贵方服务是否放行）、双方 Base URL/端口规划（贵方文档目前只给 localhost:4001 本地窗口）。

**C2. 凭证交换**：联调环境请**按方向分离 HMAC 密钥**（M→C 与 C→M 各一把）——贵方文档“双向同一把 `st-local`”仅限本地替身自测；生产口径按契约走 K8s Secret + 提前 7 天双发轮换。请提供联调期凭证交换方式。

**C3. 文档共享**：请提供 `docs/longtask-integration-runbook.md` 与 `carbon-silicon-longtask-dev-plan.md` 的访问权限或副本，联调用例以 Runbook §6 验收清单为窗口关闭条件。

**C4. 联调批次建议**（与我方指南 §5 一致）：
- **第一批（现在即可启动）**：场景一/二/三 + 场景四 + 对账 API #35-#38 + 可靠性 6 用例（重复投递去重 / 5xx 退避 / 死信告警 / 4xx 不重试 / 超时中断 / nonce 重放拒绝）
- **第二批**：场景五/六/七/八（场景五待 A2 闭账）
- **第三批（公测前）**：场景九/十（涉及资金，最后接）+ 网关线收口（待 D 组裁决）

## D. LLM 网关线：BYOK 是重大契约变更，需走决策通道（不阻断主链）

贵方文档 §7 的“BYOK 变更（2026-08-31 产品裁决）：平台放弃站内套餐售卖与支付，改为用户自带网关 Key”——与双方已冻结契约（我方指南 §3.7 + `CSI-LLM-Gateway-Billing-Team-Requirements.md` + TS DR-12 + PRD §4.6）存在 **5 处硬冲突**：

| #    | 冻结契约                                                     | BYOK 做法                                                    |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 1    | 平台**永不存储、永不下发** owner 的 LLM key                  | key 存 `user_llm_configs`，经 runtime-env 下发               |
| 2    | K2 终裁：key **永不落入 Runtime 环境变量**、永不进 CLI 子进程 | `OPENAI_API_KEY` 直接注入环境变量                            |
| 3    | 云端托管 Runtime 不开放自定义 provider（陷阱 15）            | BYOK 即自定义 provider 入口                                  |
| 4    | 订阅套餐 + 额度硬断 + E6 免费额度激活（PRD §4.6/DR-12）      | “放弃卖套餐与支付”                                           |
| 5    | K1-K4 为唯一凭证通道                                         | K1-K4 / E7 / runtime-env(JWT) / llm-proxy(JWT) 四套凭证面并存，无权威声明 |

且贵方文档**内部自相矛盾**：同节既宣布 BYOK，又列“K1-K4 已实现（gateway-keys.controller.ts）”、§9.5 还排“E6 免费额度激活 + K1-K4 daemon 通道”收口。`E7`（`GET /v1/entitlement/llm-config/:orgId`）为双方文档未登记的新端点。

- 该变更属 DR-12/PRD §4.6 级架构 pivot，按契约治理（我方指南 §7.1）需**双方评审回写 TS/PRD 后再实现**，目前仅贵方单方“产品裁决”落在 skill 文档。
- **请提供**：①2026-08-31 产品裁决的决策原文（范围、动因、K1-K4/E1-E6 存废结论）；②贵方对上述 5 处冲突的处置意见。
- 我方动作：已提交我方 Owner 裁决（drift-handling 大决策路径）。**裁决落地前，网关线一律按既有冻结契约执行**；我方 in_progress 的网关联调 task 已挂警示，对齐前不按旧方向继续推进。

---

**我方状态声明**（供贵方排期参考）：Console 侧 10 大场景全部实现（M2-M5，E2E 四链路 122 K8s 真跑全绿）；16 个 webhook 端点注册齐备且鉴权/错误码已按契约词汇对齐（B.4 活权威）；10 分钟对账器在跑。联调排期不受我方里程碑约束，取决于 A/C 组闭账节奏。

