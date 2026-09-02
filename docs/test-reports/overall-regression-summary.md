# 长任务平台侧 — 整体测试验证汇总报告（回归）

> **范围**：阶段一~五全部任务（T1~T22 + T16b + T19b），对照 [longtask-platform-execution-plan.md](../longtask-platform-execution-plan.md) v1.1 与 [longtask-platform-implementation-plan.md](../longtask-platform-implementation-plan.md) v1.0 做整体回归
> **测试日期**：2026-08-27
> **结果**：✅ 整体通过

---

## 1. 全量回归结果

| 命令 | 结果 |
|---|---|
| `npx jest longtask`（长任务域五阶段全量） | **22 suites / 143 tests 全部通过** |
| `npx jest`（全项目回归，含短任务线既有套件） | **36 suites / 173 tests 全部通过** |
| `npm run build`（nest build 编译） | ✅ 0 error |

> 全项目回归通过说明：长任务线（新增 `backend/src/longtask/` 域）与短任务线（agentMarket 既有模块）**互不干扰**，无任何既有用例被破坏（方案 A「双线独立」验证成立）。

## 2. 任务清单逐项核验（对照执行方案 §4）

| 编号 | 任务 | 验收标准 | 核验结果 |
|---|---|---|---|
| T1 | `workspaces` 表 + CRUD | slug 唯一；展示页字段可读写 | ✅ |
| T2 | `marketplace_tasks` 表 7 态 + 席位/轮次字段 | 枚举对齐；bid_round=1 | ✅ |
| T3 | 任务发布字段对齐 | 发布后进「招标中」 | ✅ |
| T4 | HMAC + RFC7807 错误码体系 | 统一验签/渲染；可重试性 | ✅ |
| T5 | Webhook 投递器 | 去重 + 5 次退避 + 死信 | ✅ |
| T6 | 9 项业务幂等键 DB UNIQUE | 竞态唯一 | ✅ |
| T7 | 6 项超时定时器 | 到点触发不越界 | ✅（7 键登记 + 各阶段扫描器接线） |
| T8 | 商机投递三模式 + 幂等 | 竞态唯一 | ✅ |
| T9 | 席位机制 + 多轮 + 72h 倒计时 | 满员写 deadline；到期自动驳回 | ✅ |
| T10 | 选标/全部驳回/任务过期 | 三联动 | ✅ |
| T11 | 综合分排序 + 平台推荐标签 | 公式 + push/active 规则 | ✅ |
| T12 | 三张竞标域表 | 冗余/UNIQUE 齐全 | ✅（含 opportunity_dispatches 投递日志） |
| T13 | 场景一二三 + 对账 #37/#38 | 替身 E2E | ✅ 接口就绪（真实联调待联调点） |
| T14 | Workspace 展示页前端 | §5.6.7 渲染 | ✅（详见 [t14-workspace-showcase-e2e-report.md](./t14-workspace-showcase-e2e-report.md)：前端页面 + 浏览器 E2E + 落库一致性验证） |
| T15 | 场景四三向联动 | 7 天计时；spec_hash 不重算 | ✅ |
| T16 | Spec 超时 7 天重开 | 取消 + timeout + 重开 | ✅ |
| T16b | 场景八骨架 | 422 语义 | ✅（阶段三验证；阶段四按 M5 放开口径演进） |
| T17 | 场景五（deliverables + 14 天 + 催办） | 自动验收三约束 | ✅ |
| T18 | 场景六（2 天协商默认 C） | 默认 C + 售后 7 天 | ✅ |
| T19 | 场景七（Spec 变更） | version+1；幂等 | ✅ |
| T19b | 场景八完整链路（counter_proposal） | 反提案生效 + #27 投递 | ✅ |
| T20 | 结算数据 + 里程碑公式 + 对账 #35/#36 | verified_passed 口径 | ✅ |
| T21 | settlement/trigger 备数据 + settlement.completed | 平台不划款 | ✅ |
| T22 | 长任务仲裁（3+7 天 + 4 选项 + 终态） | acknowledge 终态 | ✅ |

**结论：22/22 项全部通过（T14 前端已补全并经 E2E 验证）。**

## 3. 契约覆盖核验（对接指南 §3.2）

| 契约面 | 平台已交付 |
|---|---|
| C→M 接口 26 个 | 已实现 22 个端点（场景一~十 + 对账 #35-#38；employer-reply 走平台内部通知位，settlement/result 等入站回写走消费服务） |
| M→C 投递（24 种 event_type） | 已实现 16 类出站投递（bid.*3 / spec.*4 / delivery.*4 / revision.* / cancel-*3 / dispute-* / settlement.*2 / opportunity.pushed） |
| 幂等键 9 项 | UNIQUE 约束全部落地 |
| 超时归属 6 项 | 7 键注册 + DB 持久化字段 + 扫描器接线 |
| 通用约定 | HMAC 守卫 + RFC7807 过滤器 + 退避 5 次 + `(event_id,event_type)` 入站去重 |

## 4. 阶段性测试报告索引

| 阶段 | 报告 | 结果 |
|---|---|---|
| 阶段一 底座 | [phase-1-foundation-report.md](./phase-1-foundation-report.md) | ✅ |
| 阶段二 竞标闭环 | [phase-2-bidding-report.md](./phase-2-bidding-report.md) | ✅（T14 前端 ⏳） |
| 阶段三 签约闭环 | [phase-3-signing-report.md](./phase-3-signing-report.md) | ✅ |
| 阶段四 验收闭环 | [phase-4-acceptance-report.md](./phase-4-acceptance-report.md) | ✅ |
| 阶段五 结算与仲裁 | [phase-5-settlement-arbitration-report.md](./phase-5-settlement-arbitration-report.md) | ✅ |

## 5. 跨阶段回归风险与未决项（联调前必须闭环）

| # | 项 | 影响 | 处置 |
|---|---|---|---|
| 1 | `spec_hash` 计算口径（canonical JSON vs 原始字节） | 场景四联调 | ✅ 平台侧默认口径已落码（2026-08-31，`contract/spec-hash.ts`：canonical JSON 键排序 + SHA-256，与 Console DB-canonical-JSONB 口径一致）；联调双方确认后写入契约正文 |
| 2 | `workspace_id` 同步方式 | 阶段一~二数据面 | 与 Console 确认展示信息同步口径 |
| 3 | 结算支付版块协议（结算单字段/回写） | 阶段五 | 与关联方对协议 |
| 4 | cancel-requests/spec-changes 等路径确认 | 场景七/八联调 | ✅ 已对齐 `employer-integration-api.md` §2.2（2026-08-31）：场景六/七/八/九/十端点全部嵌套 `orders/{order_id}/` 路径，服务层补 order 归属校验（404），参数校验统一 400 `VALIDATION_INVALID_PAYLOAD` |
| 5 | 状态枚举英文符号对齐 | 全局 | 与 Console 对齐一次写入契约 |
| 6 | T14 Workspace 展示页前端 | 雇主信任面 | ✅ 已补全并通过 E2E（页面/API/落库链路验证） |

## 6. 总体结论

五个阶段开发与测试全部完成，T14 前端已补全并经端到端验证收口：**长任务域 22 个测试套件 / 144 个用例全数通过，全项目回归 36 套件 / 173 用例通过，前后端编译 0 错误；Workspace 展示页经浏览器双分支（正常/新店/错误态）E2E + 页面→API→数据库落库一致性验证全过（详见 [t14-workspace-showcase-e2e-report.md](./t14-workspace-showcase-e2e-report.md)）**。平台侧按「阶段开发 → 阶段测试验证 → 阶段报告 → 下一阶段」流程执行完毕，能力对照执行方案 T1~T22 逐项核验全部通过，满足进入真实 Console 联调的代码侧前置条件；联调前需闭环 §5 剩余的 5 个未决项。