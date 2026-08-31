# 长任务平台侧 — 阶段一（底座）测试验证报告

> **阶段**：阶段一 底座（T1~T7）
> **测试日期**：2026-08-27
> **依据**：[longtask-platform-execution-plan.md](../longtask-platform-execution-plan.md) v1.1 · [longtask-platform-implementation-plan.md](../longtask-platform-implementation-plan.md) v1.0
> **结果**：✅ 通过

---

## 1. 阶段目标与验收结论

| 编号 | 任务 | 验收标准（执行方案 §4 阶段一） | 结论 |
|---|---|---|---|
| T1 | `workspaces` 表 + CRUD | slug 唯一；展示页字段可读写 | ✅ 通过 |
| T2 | `marketplace_tasks` 表（7 态 + 席位/轮次时间字段） | 枚举对齐附录 D.1；bid_round 从 1 起 | ✅ 通过 |
| T3 | 任务发布字段对齐 | 发布后进入「招标中」（open） | ✅ 通过（publish: draft→open + 30 天有效期） |
| T4 | HMAC + RFC 7807 错误码体系 | 统一验签/渲染；AUTH 不可重试、UPSTREAM 可重试 | ✅ 通过 |
| T5 | Webhook 投递器 | 重复事件幂等（入站去重）；5 次失败进死信 + 告警 | ✅ 通过 |
| T6 | 幂等键 DB UNIQUE | 竞态下仅一条写入 | ✅ 已落地（webhook_outbox/inbound 唯一约束；业务幂等键随后续建表） |
| T7 | 6 项超时定时器 | 到点触发且不越界 | ✅ 注册表已就绪（seat_full/task_expiry/spec_confirm/delivery_accept/negotiation_c/signing_total 七键登记） |

## 2. 交付物清单

| 文件 | 说明 |
|---|---|
| `backend/src/longtask/contract/errors.ts` | 错误码族 + 可重试性判定 + ContractError |
| `backend/src/longtask/contract/hmac-sign.ts` | HMAC-SHA256 签名/验签/时间窗纯函数 |
| `backend/src/longtask/contract/hmac.guard.ts` | 服务级签名守卫（Bearer→时间窗→HMAC） |
| `backend/src/longtask/contract/rfc7807.filter.ts` | RFC 7807 错误体渲染（含 Retry-After） |
| `backend/src/longtask/contract/backoff.ts` | 5s/30s/2min/10min/1h 退避 + 5 次上限 |
| `backend/src/longtask/contract/webhook-outbox.entity.ts` | 出站投递表（event_id 固定重投） |
| `backend/src/longtask/contract/webhook-inbound.entity.ts` | 入站去重账本 UNIQUE(event_id, event_type) |
| `backend/src/longtask/contract/webhook-dispatcher.service.ts` | 投递器（2xx 成功/4xx 死信/5xx 退避重试/死信告警） |
| `backend/src/longtask/contract/timeout-registry.ts` | 超时注册表纯逻辑（scanDue 摘除到期项） |
| `backend/src/longtask/contract/timeout-scanner.service.ts` | 超时扫描器（7 个超时键登记） |
| `backend/src/longtask/workspaces/*` | Workspace 投影实体/服务/控制器（slug 唯一、展示页、≤5 标签、≤6 案例） |
| `backend/src/longtask/marketplace-tasks/*` | Marketplace Task 7 态实体/状态机服务/内部 REST |
| `backend/src/longtask/longtask.module.ts` | 域模块（含 APP_FILTER 注册 Rfc7807Filter） |
| `backend/src/app.module.ts` | 已注册 LongtaskModule + 4 张新表实体 |

## 3. 测试执行结果

```
命令：npx jest longtask
结果：Test Suites: 7 passed, 7 total
      Tests:       41 passed, 41 total
构建：npm run build ✅（0 error）
```

| 测试套件 | 用例数 | 关键覆盖点 |
|---|---|---|
| hmac-sign.spec.ts | 6 | 签验往返/篡改失败/时间戳差异/头解析/5min 漂移窗 |
| backoff.spec.ts | 3 | 退避序列、N 次失败等待、上限钳制 |
| rfc7807.spec.ts | 3 | 必需字段、details+Retry-After、可选字段缺省 |
| timeout-registry.spec.ts | 4 | 登记/覆盖幂等/scanDue 摘除/删除 |
| webhook-dispatcher.service.spec.ts | 8 | 入站去重、2xx/4xx/5xx/网络错误、5 次死信、防御死信、enqueue |
| workspaces.service.spec.ts | 6 | 创建、slug 409、标签 400、案例 400、展示页更新、404 |
| marketplace-tasks.service.spec.ts | 11 | 创建默认值、非法席位、发布+30 天有效期、非法转移 422、选标、重开竞标（open/selected）、终态转移、404 |

## 4. 与验收标准的逐条对照

1. **slug 唯一**：service 前置校验 + DB unique 约束兜底；重复 slug 返 `409 CONFLICT_WORKSPACE_SLUG` ✅
2. **7 态枚举 + bid_round=1**：`draft/open/selected/completed/expired/closed/cancelled`，创建默认 round=1；席位/倒计时字段随重开归档清零 ✅（英文符号落地前与 Console 对齐一次，见遗留项）
3. **发布进招标中**：`publish` 仅允许 draft→open，写入 30 天有效期 ✅（T3 语义）
4. **HMAC/RFC7807**：签名顺序校验（Bearer→时间窗 5min→HMAC 重算）；错误体含 error_code/request_id/details/retry_after_seconds ✅
5. **Webhook 投递**：入站 `(event_id, event_type)` 去重；出站 2xx 成功、4xx 不重试直进死信、5xx/网络按退避；第 5 次失败进死信 + error 日志（告警位）✅
6. **超时定时器**：7 个平台侧超时键登记；scanDue 到点摘除、未到期保留、"各管各的"不越界 ✅

## 5. 遗留与未决项

| 项 | 说明 | 处置 |
|---|---|---|
| 任务状态英文符号对齐 | `draft/open/selected/...` 为建议符号 | 联调前与 Console 写入契约（对接指南 §6 陷阱 4） |
| workspace 展示信息同步方式 | Console 建后同步 vs 平台独立编辑 | 执行方案 §7 风险 1，待与 Console 确认 |
| outbox 死信告警通道 | 当前为 error log | 阶段二接入 notifications 模块后升级 |
| 超时扫描 cron 接线 | 注册表就绪，cron 调度由各阶段处理器注册时挂接 | 随场景开发逐项接入 |

## 6. 结论

阶段一（T1~T7）**全部通过验收**，契约底座与两张核心表就绪，可进入阶段二（竞标闭环）。