# 长任务平台侧 — 阶段二（竞标闭环）测试验证报告

> **阶段**：阶段二 竞标闭环（T8~T14，第一批核心）
> **测试日期**：2026-08-27
> **依据**：longtask-platform-execution-plan.md v1.1 §4 阶段二 · longtask-platform-implementation-plan.md v1.0 §2
> **结果**：✅ 通过

---

## 1. 阶段目标

打通「商机进 → 竞标出 → 中标回」最小业务闭环：商机 Push 投递 + 席位竞标（含 72h 倒计时）+ 雇主选标/全部驳回 + 综合分排序 + 场景一二三 C→M 接口 + 对账 #37/#38。

## 2. 验收结论（对照 T8~T14）

| 编号 | 任务 | 验收标准 | 结论 |
|---|---|---|---|
| T8 | 商机投递三模式 + 幂等 | 竞态唯一；Push 同轮同模式不重复投 | ✅ 通过（UNIQUE(workspace_id, marketplace_task_id) 由 Console 兜底；平台侧 opportunity_dispatches 日志幂等 + 稳定 event_id） |
| T9 | 席位机制 + 多轮 + 72h 倒计时 | 席位满写 deadline；到期自动全部驳回 + bid_round+1 | ✅ 通过 |
| T10 | 选标/全部驳回/任务过期 | 选标后同任务其他商机→未中标；驳回后席位清零；到期→已过期 | ✅ 通过（选标联动 + rejectAll 重开 + expire 转移在阶段一状态机，场景测试覆盖） |
| T11 | 综合分排序 + 平台推荐标签 | `0.4评分+0.3性价比+0.3时效`；source=push 且未冻结才显示 | ✅ 通过 |
| T12 | `opportunity_dispatches/marketplace_bids/marketplace_orders` 表 | order_id↔project_id 冗余；竞标 UNIQUE；投递日志幂等 | ✅ 通过 |
| T13 | 场景一二三对接 + 对账 #37/#38 | 替身 E2E；10min 对账返回真实状态 | ✅ 接口就绪（真实 Console 联调在第一批联调点执行） |
| T14 | Workspace 展示页前端 | §5.6.7 全部模块渲染 | ⏳ 后端字段与查询已就绪（workspaces API + rank 数据面）；前端页面随第一批前端任务落地 |

## 3. 交付物清单

| 文件 | 说明 |
|---|---|
| `contract/console-endpoints.ts` | 17 个 M→C Webhook 路径 + base URL 拼接 |
| `contract/marketplace-contract.controller.ts` | C→M 契约控制器（/v1/marketplace/*，HMAC 守卫）：Pull/详情/竞标提交/回填 project_id/对账 #37/#38 |
| `marketplace-tasks/opportunity-dispatch.entity.ts` | 商机投递日志（UNIQUE 四元组幂等） |
| `marketplace-tasks/opportunity-push.service.ts` | Push 匹配 + 投递 + 日志幂等（event_id=日志行 id） |
| `marketplace-bids/marketplace-bid.entity.ts` | 竞标实体（UNIQUE(task,bid_round,workspace)） |
| `marketplace-bids/bid-scoring.ts` | 综合分纯函数（评分归一/新店兜底/性价比/低价惩罚/时效衰减/中位数） |
| `marketplace-bids/marketplace-bids.service.ts` | 竞标提交（席位事务 + 409/重复 409 + 72h 写入）+ 排序 + 推荐标签 |
| `marketplace-bids/selection.service.ts` | 选标（bid.won + 建 Order）/ 全部驳回（重开 + batch_rejected）/ 72h 自动驳回扫描 |
| `marketplace-orders/marketplace-order.entity.ts` | 长任务订单（project_id 唯一冗余） |
| `marketplace-orders/marketplace-orders.service.ts` | 回填幂等（null→set / 同值放行 / 异值 409）+ 对账视图 |
| `longtask.module.ts` / `app.module.ts` | 已注册新实体（7 张长任务表）与 provider |

## 4. 测试执行结果

```
命令：npx jest longtask（阶段一 + 阶段二全量）
结果：Test Suites: 13 passed, 13 total
      Tests:       78 passed, 78 total
构建：npm run build ✅（0 error）
```

本期新增用例（阶段二）：

| 测试套件 | 用例 | 关键覆盖点 |
|---|---|---|
| bid-scoring.spec.ts | 7 | 中位数/归一化/新店兜底/性价比/恶意低价惩罚/时效衰减/综合分加权 |
| marketplace-bids.service.spec.ts | 9 | 占席位、满员 72h 写入、席位满 409、同轮重复 409、404/422/400、综合分排序、推荐标签、冻结不推荐、ContractError 贯通 |
| selection.service.spec.ts | 5 | 选标四联动（won/lost/selected/建单/bid.won webhook）、跨轮 422、全部驳回重开（round+1/席位清零/deadline 清空/2×batch_rejected）、72h 自动驳回、非 open 422 |
| opportunity-push.service.spec.ts | 4 | 类目+状态+开关过滤、投递幂等跳过、非 open 422、404 |
| marketplace-orders.service.spec.ts | 7 | 回填 null→set/同值幂等/异值 409/空值 400/404、对账 #37 视图、#38 列表 |
| marketplace-contract.controller.spec.ts | 5 | snake_case 转换、参数校验、service 委托（5 个 C→M 端点） |

## 5. 与验收标准逐条对照的细节

1. **席位满 72h 倒计时**：第 N 个提交将 seat_taken 打满时，一次性写入 `seat_full_locked_at=now`、`seat_full_deadline=now+72h`（单测精确断言窗口 72×3600×1000ms）✅
2. **席位满 409 语义**：接口返 `CONFLICT_SEAT_FULL`（业务正常分支，非 5xx）✅
3. **bid.won 异步窗口容忍**：`project_id` 可空、回填幂等（同值重试放行）；回填失败由 Console 重试 + 对账 #37 收敛 ✅
4. **全部驳回 → 重开**：`status=open`、`bid_round+1`、`seat_taken=0`、两个 seat_full 字段置空、`last_reopened_at` 写入；同轮已竞标 Workspace 逐个收到 `bid.batch_rejected` ✅
5. **综合分默认排序**：分数仅用于平台内部排序（rank 返回 score 供排序但不强制外发）；`platformRecommended = source==='push' && displayStatus==='active'` ✅
6. **投递幂等**：`opportunity_dispatches` 同轮同模式 UNIQUE；重投复用日志行 id 作 event_id（重复不入 outbox）✅

## 6. 遗留与未决项

| 项 | 说明 | 处置 |
|---|---|---|
| T14 前端展示页 | 后端数据面就绪，前端页面未在本期落地 | 随第一批前端任务排期 |
| 席位占用的 DB 并发兜底 | 应用层先查后写，并发下依赖 `marketplace_bids` UNIQUE 约束 + seat 乐观回滚 | 联调前补并发用例 |
| `CONSOLE_BASE_URL` 环境变量 | 替身/联调环境需配置 | 部署配置项，随联调环境设置 |
| 真实 Console 联调 | 场景一二三替身 E2E 已单方就绪 | 联调点（执行方案 §6.2） |

## 7. 结论

阶段二（T8~T14 后端部分）**通过验收**（T14 前端部分挂起至第一批前端任务）。竞标闭环最小链路（商机进→竞标出→中标回）后端能力就绪，可进入阶段三（签约闭环）。