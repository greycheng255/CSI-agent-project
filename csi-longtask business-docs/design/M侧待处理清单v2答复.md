# 《M侧待处理和决策清单 v2》答复（Marketplace 团队 → Console 团队）

> 对象：`csi-longtask business-docs/design/M侧待处理和决策清单.md`（v2，2026-09-01）
> 状态：**A 组 3 项已全部处置完毕（含代码落地 + 云库 DDL），B4 勘误已回写，C 组后勤答复如下，D 组给出处置意见待双方评审。**
> 本轮平台侧代码改动均通过既有 224 用例回归（42 套件全绿）。

## A 组：阻断项处置（已闭账）

### A1 ✅ 仲裁 outcome 六值已实现

- `DISPUTE_RESOLUTION` 扩为六值：`cancel / fulfill / partial_settlement / refund / resume_execution / closed`
  （`backend/src/longtask/disputes/dispute.entity.ts`）
- `resolve()` 新增零结算校验：`resume_execution` / `closed` 时 `amount_cny` 必须为 null，违反返回 400 `VALIDATION_INVALID_PAYLOAD`
- **#42 payload 已按 TS §12.2 命名补充 `outcome` 字段**（与 `resolution` 同值双写，兼容过渡），Console 可直接按 `outcome` 编码
- G6（`dispute_in_progress→executing`）与 G3（`dispute_in_progress→closed`）出口边可正常触发
- 新增单测覆盖：六值投递 + 两零结算出口 + 零结算带金额拒绝（`disputes.service.spec.ts`）

### A2 ✅ 修订期间 14 天计时精确语义（按代码实况闭账）

平台数据面实况与三点答复：

1. **恢复规则：reset-on-resubmit（重新计满），非剩余顺延。**
   修订期间（`revising`，无 `status='submitted'` 记录）无计时在跑（等效暂停，scan 只扫 `submitted`）；修订完成后再提交 = 新 `submission_seq`，`accept_deadline = 提交时刻 + 14d` **重新计满**。
2. **Console 获知通道：#14 payload 直携，无需对账拉取。**
   本轮已补字段：
   - `delivery.revision_requested` → 携带当前 `accept_deadline`（修订中冻结的旧值，Console 可感知"旧计时已失效"）
   - `delivery.accepted` / `delivery.auto_accepted` → 携带 `after_sale_deadline`（7 天申诉期截止）
   - 再提交产生的新计时起点 = Console 侧自身 #13 提交时刻 + 14d（可本地推算），亦可通过 #37 对账拉取 `accept_deadline` 校验
3. **催办口径：平台 5/9/13 天催办锚定最新一次提交的 `accept_deadline`**（`delivery-reminders.ts`），修订期间无 pending 记录天然跳过。Console 侧催办若锚 `delivered_at`，请改为锚**最新 submission 的 `delivered_at`**，即与新计时天然对齐。

⚠️ **需要 Console 评估的对齐点**：贵方数据面现状是"继续"语义（Edge #1 盖时间、Edge #4 不重盖）。与平台"reset-on-resubmit"存在差异——请按贵方预估做数据面小 patch（对齐为"最新 submission + 14d"），或联调前提出替代口径再议。

### A3 ✅ 幂等键 9 条落库确认

| 幂等键 | 状态 |
|--------|------|
| 商机 `(workspace_id, marketplace_task_id)` | ✅ 已落（opportunity_dispatches，另含 bid_round/mode 维度） |
| 竞标 `(marketplace_task_id, bid_round, workspace_id)` | ✅ 已落（marketplace_bids） |
| Spec 推送 `(project_id, spec_version)` | ✅ 已落（spec 变更链 spec_changes: order_id+change_seq） |
| 交付 `(project_id, submission_seq)` | ✅ 已落（marketplace_deliveries UNIQUE(order_id, submission_seq)） |
| 验收 `(project_id, review_round)` | ✅ 等价承载：平台以 `(order_id, submission_seq)` 为验收轮次幂等键，`review_round` 列已备（当前随 submission 递增语义，等价于 review 轮次） |
| Spec 变更 `(project_id, change_seq)` | ✅ 已落（marketplace_spec_changes） |
| **修订请求 `(project_id, revision_round)`** | ✅ 等价承载：修订轮次由 `submission_seq` 承载（同单递增），UNIQUE(order_id, submission_seq) 已满足防重 |
| **取消协商 `(project_id, cancel_proposal_seq)`** | ✅ **本轮新增**：`marketplace_cancel_requests` 补 `cancel_proposal_seq` 列（int default 1）+ `UNIQUE(order_id, cancel_proposal_seq)`，云库 PG DDL 已执行 |
| **触发结算 `(project_id)`** | ✅ 已落：`marketplace_settlements.order_id UNIQUE`（钱面约束，实体注释明确"一个 Project 仅一次结算"） |

## B 组

- **B1/B2/B3**：收到，无需我方动作。nonce 语义澄清（B2 可选项）：我方守卫为**验签成功后才消耗 nonce**（验签失败请求不消耗——攻击者无法用随机 nonce 污染去重表）；贵方"重试恒换新 id"纪律与我方语义完全兼容。
- **B2 纪律已入我方 Runbook/skill**：HTTP 重试必须携带新 `X-Request-Id`；`Idempotency-Key` 同一逻辑写内保持不变。
- **B4 ✅ 三处勘误已回写** `skill/console_marketplace_integration_skill.md`：①"席位满后 72h 未决策"；②Webhook 表述改为"16 条唯一路径（TS §12.2 行计数 17 含端点复用）"；③补注 employer-integration-api.md §2.2 只列 14 webhook / 22 API（缺场景十），引用以 TS §12.2 为准。

## C 组：环境与后勤答复

- **C1 部署与网络**：我方 backend 部署于 **122.51.51.177**（公测联调窗口：**http://122.51.51.177:4001**，DB_SYNC=false 连云库 PG；前端 5173）。请贵方验证 122 K8s → `122.51.51.177:4001` 出向可达（安全组已放行 4001/5173）。生产 K8s 部署随公测排期另给地址。
- **C2 凭证交换（已落地方向分离）**：
  - 我方已实现按方向分离：M→C 出站投递用 `LONGTASK_OUTBOUND_TOKEN`，C→M 入站验签用 `LONGTASK_INBOUND_TOKEN`（未设方向密钥时回落 `LONGTASK_SERVICE_TOKEN`，向后兼容）。
  - 联调期两把密钥经加密渠道线下交换（请指定交换方式：加密邮件/密码管理器共享均可）；生产按契约走 K8s Secret + 提前 7 天双发轮换。
  - ⚠️ 注意：我方 HMAC 的 nonce 去重表按 `X-Request-Id` 全局唯一，密钥分离后两方向各自独立——双方各自维护本方向 nonce 表即可，无交叉影响。
- **C3 文档共享**：`docs/longtask-integration-runbook.md` 与 `docs/carbon-silicon-longtask-dev-plan.md` 在我方仓库 `docs/` 下，将随仓库只读权限开放；如需先行获取，可经联调群直接发送副本。
- **C4 联调批次**：同意贵方三批划分。第一批我方已就绪（24 API + 16 webhook 路径 + 替身 + 方向密钥）。

## D 组：BYOK 决策通道处置意见（不阻断主链）

2026-08-31 产品决策事实：**平台已放弃站内套餐售卖与支付（前端套餐购买/模拟支付 UI 已下架），公测期改为用户自带网关 Key（BYOK）**。决策动因：商业化支付版块未就绪，公测优先打通 Agent 生产力闭环；用户自带 key 使平台规避代收资金与渠道成本。

对 5 处冲突的处置意见（待双方评审回写 TS/PRD 后生效）：

| # | 冲突 | 我方处置意见 |
|---|------|-------------|
| 1 | 平台不存不发 owner key | 公测口径修订为：**owner 主动配置自有网关凭证**（AES-256-GCM 加密存储），仅经用户态 JWT（runtime-env）或服务级 HMAC（E7）通道下发；"平台不存不发"收敛为"平台不存不发**平台签发**的 key" |
| 2 | K2：key 不入 Runtime 环境变量 | **公测接受偏离**（owner 知情配置自己的 key，风险自负）；K2 daemon 本地代理保留为正式版目标形态，联调第三批暂不切 K 线 |
| 3 | 云端托管不开放自定义 provider | 公测修订：BYOK 即受控的自定义 provider 入口（陷阱 15 增注）；自托管 Runtime 仍按原口径不开放 |
| 4 | 套餐 + 额度硬断 + E6 | 站内售卖与 E6 免费额度激活**公测挂起**；**E1-E4 计量/对账面保留**（对 BYOK 用量做平台侧计量对账与展示，`/settings/billing` 数据源不变），额度硬断与套餐激活待支付版块就绪后恢复 |
| 5 | K1-K4 唯一凭证通道 | 公测权威声明：凭证面 = `user_llm_configs`（存储）+ `runtime-env`（JWT 引导，全局环境变量）+ `E7`（服务级批量拉取）；K1-K4 保留为正式版 daemon 通道。**E7 为新增端点，按 §7.1 请贵方确认后补登记 TS §12.2/B.4** |

后续动作：①本表随答复文档提交贵方 Owner 裁决；②双方评审通过后同步回写 TS §12.2/§17/附录 B、PRD §4.6、指南 §3.7；③回写完成前，主链（场景一~十）联调照常推进，网关线仅推进 E1-E4 计量对账面（双方已实现部分），K 线与 E6 挂起。

---

**我方本轮代码改动清单**（均过 42 套件 / 224 用例）：

1. `dispute.entity.ts`：DISPUTE_RESOLUTION 六值 + ZERO_SETTLEMENT_RESOLUTIONS
2. `disputes.service.ts`：resolve() 零结算校验 + #42 payload 补 `outcome`
3. `delivery-contract.service.ts`：#14 payload 补 `accept_deadline` / `after_sale_deadline`；订单联动先落库再投递
4. `cancel-request.entity.ts`：补 `cancel_proposal_seq` + UNIQUE（云库 DDL 已执行）
5. `hmac.guard.ts` / `webhook-dispatcher.cron.ts` / `gateway-keys.service.ts`：HMAC 密钥按方向分离（INBOUND/OUTBOUND，向后兼容回落）
6. `skill/console_marketplace_integration_skill.md`：B4 三处勘误 + A2 精确语义回写

---

## 联调实测发现：HMAC 签名编码差异（阻断第一批双向验证，需贵方一行修复）

双向验证进展到 HMAC 门被阻断。根因已在贵方 122 主机源码直读后钉死，**输入公式双方完全一致（`hmac_sha256(body 原文 + ts)`），纯输出编码差异**：

| 证据 | 结论 |
|------|------|
| Bearer 门 | ✅ 通过（c2m 密钥贵方已正确配置） |
| HMAC 门 | ❌ `AUTH_HMAC_SIGNATURE_MISMATCH` |
| 贵方源码（122 主机 `hmac-sign.ts`） | `.digest('base64')` |
| 我方全链（契约 signer/verifier/替身/E2E） | hex 编码（GitHub/Stripe webhook 行业惯例） |
| 契约原文（TS L1770） | 公式一致但编码未显式规定——即本次歧义点 |

**裁决依据**：按既定口径"我方按契约实现、偏离方对齐"，且我方已在 TS L1770 补编码澄清注记（**hex，64 位小写**，2026-09-02）。

**贵方修复（一行）**：

```diff
- return createHmac('sha256', secret).update(payload + ts).digest('base64');
+ return createHmac('sha256', secret).update(payload + ts).digest('hex');
```

同步修改验证侧重算编码即可（若贵方 verifier 复用同一函数则无需额外改动）。

**修复后我方立即复测双向**：① 出向（M→C 投递，贵方 hex 验签）；② 入向（C→M 调用，我方 HmacGuard hex 验签）。通过即闭账第一批启动条件。

**复测注意事项**：`entitlement_usage_records` 的 `workspace_id` / `agent_run_id` 为 **uuid 列**，测试 payload 请传合法 UUID，否则会在验签通过后的业务层报 PG `22P02`（500），勿误判为签名问题。

**我方状态**：hex 口径全链自测已通过（契约单测 11/11、入向有效签名 `201 recorded:1`、篡改签名 `401`、出向投递经替身 hex 验签接收成功），随时可复测。

---

## HMAC 复测闭环（2026-09-02 第二轮：Console 复测反馈 → 我方修复完成）

Console 复测确认 **hex 修复已生效**（源码 `digest('hex')` + POST 写路径验签通过）。反馈剩余两处差异均属我方（M 侧）实现，已全部修复并复测：

### ① GET 空 body 派生（一行修复 + 一处加固，已完成）

- **根因**：我方守卫对无 body 请求派生 `JSON.stringify({})='{}'`，契约语义为 body 原文（GET = 空串）→ Console 的 GET pull 按空串签名被 401。
- **修复**：抽出 `deriveRawPayload()`——rawBody 真原文优先（Buffer/string）；无 body（GET/DELETE）= 空串；仅无 rawBody 且解析出的 JSON body 非空时才回退 re-serialization。
- **加固**：`main.ts` body-parser 增加 `verify` 回调捕获 raw body Buffer——此前 POST 全靠 re-serialization 碰巧一致，Go 侧 JSON HTML 转义（`\u003c`）一旦出现即 mismatch，现改用真原文彻底消除。
- **复测（4001 现网实例）**：GET 空串签名 → 过门进业务态；GET `'{}'` 签名 → `401 AUTH_HMAC_SIGNATURE_MISMATCH`（旧口径已拒）；POST 真原文 → `201 recorded:1`。
- **文档**：TS 注记 + 集成指南 + skill + employer-integration-api 四处已补「GET/无 body = 空串，POST 取真原文」澄清（与 Console 侧提交 `50991903c` 同口径）。

### ② `employer-mentions` orderId 归属校验缺口（已完成）

- **修复**：`receiveEmployerMention` 接入 `getOrThrow`——订单不存在返回 `404 NOT_FOUND_ORDER`（RFC 7807），不再对任意 id 误返 201。复测确认。
- **探测数据说明**：我方该端点本就不落库（仅回执 echo），贵方探测记录（order `00000000-…`、"joint-debug probe"）未写入我方库（`marketplace_orders` 无该订单），请贵方在自己侧清理。

### 当前状态

第一批启动条件全部就绪：hex 编码 ✅、GET 空 body 派生 ✅、POST 真原文 ✅、方向密钥 ✅。Console 侧 5min 定时 pull 无需我方任何配合即自动恢复；如仍被拦请贵方确认 pull 进程按新口径（空串）签名。全量回归 42 套件 / 232 用例通过。
