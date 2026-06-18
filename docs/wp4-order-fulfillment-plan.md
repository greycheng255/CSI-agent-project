# WP-4: 订单、履约与交付 — 实现方案

> 基于: carbon-silicon-platform-plan-final.md | 日期: 2026-06-18  
> 目标: 完成选标后订单创建 → 支付 → 执行 → 交付 → 验收的完整履约闭环

---

## 1. 现状分析

### 1.1 已有能力（成熟度: 85%）

| 模块 | 能力 | 状态 |
|------|------|------|
| 订单状态机 | 10 个状态: PENDING_PAYMENT → IN_PROGRESS → DELIVERED → PENDING_RELEASE → COMPLETED / REJECTED → ARBITRATING → REFUNDED / CANCELED | ✅ 完整 |
| 支付 | 模拟支付宝担保交易（资金托管 → 放款） | ✅ 逻辑就绪，待接入真实支付 |
| 交付 | 多版本迭代交付 (version 1..N)，交付历史 | ✅ 完整 |
| 验收检查清单 | 自动生成 + 逐项打勾 + 统计 | ✅ 完整 |
| 拒绝/争议 | 退回修改 / 直接拒绝 → 仲裁 | ✅ 完整 |
| 审计日志 | ORDER_STATUS_CHANGED / FUNDS_RELEASED | ✅ 部分 |
| Webhook 通知 | 支付 → Agent 开工 / 交付 → 雇主 / 验收 → Agent / 放款 → 各方 | ✅ 完整 |
| 余额系统 | 放款后自动增加开发者余额、扣除平台服务费 | ✅ 完整 |
| 收款码 | 支持上传付款截图、关联收款码 | ✅ 完整 |

### 1.2 待补充

| # | 缺口 | 优先级 |
|---|------|--------|
| 1 | 执行状态同步 — 缺少 `execution_phases` / `execution_sub_tasks` 的 API 对接 | 🔴 高 |
| 2 | 验收检查清单强制校验 — accept 时未检查 checklist 是否全部通过 | 🟡 中 |
| 3 | 平台放款审批流 — release 无审批，直接放款 | 🟡 中 |
| 4 | 交付物管理 — delivery 只有文本+链接，缺少结构化 artifact | 🟢 低 |
| 5 | 真实支付接入 — 当前全为模拟 | 🟢 低（后续 WP） |

---

## 2. 订单状态机（当前已实现）

```
                  ┌──────────────┐
                  │ PENDING_PAYMENT │ ← 选标后创建
                  └──────┬───────┘
                         │ pay()
                         ▼
                  ┌──────────────┐
                  │ IN_PROGRESS  │ ← Agent 正在开发
                  └──────┬───────┘
                         │ deliver() ────────────┐
                         ▼                        │ (多次迭代)
                  ┌──────────────┐               │
                  │  DELIVERED   │ ←─────────────┘
                  └──┬────────┬──┘
              accept()│        │reject()
                     ▼        ▼
          ┌──────────────┐  ┌──────────────────────────┐
          │PENDING_RELEASE│  │ requireRevision=true?     │
          └──────┬───────┘  │   → IN_PROGRESS (退回修改) │
                 │          │ requireRevision=false?     │
          release()│        │   → REJECTED → ARBITRATING│
                 ▼          └──────────────────────────┘
          ┌──────────────┐
          │  COMPLETED   │
          └──────────────┘

  任意状态可 cancel() → CANCELED
  仲裁结果可 refund → REFUNDED
```

---

## 3. 目标改进

### 3.1 执行状态同步

当前 `execution` 模块已有表 (`execution_phases` / `execution_sub_tasks` / `execution_traces`) 和 API，但在订单履约流程中未被调用。

**改进**: 在 `deliver()` 之前增加执行状态更新节点：

```
IN_PROGRESS
  │
  ├─ POST /api/v1/execution/plans          ← Agent 提交执行计划
  ├─ PUT  /api/v1/execution/phases/:id     ← 阶段推进
  ├─ POST /api/v1/execution/progress/report ← 进度上报
  │
  └─ 全部阶段完成 → deliver()
```

### 3.2 验收检查清单强制校验

```typescript
// accept() 方法增强
async accept(id: string, clientUserId: string) {
  // 新增: 检查 checklist 是否全部通过
  const stats = await this.getChecklistStats(id);
  const hasFailed = stats.items.some((i: any) => i.status === 'FAILED');
  const hasPending = stats.items.some((i: any) => i.status === 'PENDING');
  
  if (hasFailed) {
    throw new BadRequestException('存在未通过的验收项，请先要求 Agent 修改');
  }
  if (hasPending) {
    throw new BadRequestException('存在未检查的验收项，请完成所有检查后再验收');
  }
  
  // ... 原有逻辑
}
```

### 3.3 平台放款审批

```typescript
// release() 方法增强
async release(id: string, adminUserId: string, data: ReleaseDto) {
  // 新增: 验证管理员权限（已有 AdminPermissionGuard）
  // 新增: 放款金额校验
  if (order.payoutCny <= 0) {
    throw new BadRequestException('无可放款金额');
  }
  
  // 新增: 放款前二次确认记录
  await this.adminLogService.log({
    adminId: adminUserId,
    action: 'release_funds',
    targetType: 'order',
    targetId: id,
    detail: { amount: order.payoutCny, notes: data.notes }
  });
  
  // ... 原有逻辑（更新状态 + 增加余额 + 扣服务费）
}
```

### 3.4 交付物结构化

```sql
-- 扩展 deliveries 表
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS artifact_urls TEXT[];
-- 多文件支持

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS evidence_bundle JSONB;
-- 证据包: { log_url, screenshot_urls[], test_report_url }

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS commit_hash VARCHAR;
-- 代码提交哈希
```

---

## 4. 现有代码评估

### 4.1 OrdersService 方法清单

| 方法 | 行数 | 复杂度 | 状态 |
|------|------|--------|------|
| `findOne` | 30 | 中 | ✅ |
| `findAll` / `findByClient` / `findByOwner` / `findByAgent` / `findByTask` | 各15 | 低 | ✅ |
| `pay` | 72 | 中 | ✅ 逻辑正确，缺真实支付 |
| `deliver` | 83 | 中 | ✅ 多版本支持 |
| `accept` | 35 | 低 | ⚠️ 缺 checklist 强制校验 |
| `reject` | 93 | 高 | ✅ 支持退回修改 + 仲裁 |
| `release` | 95 | 高 | ✅ 余额+费用完整 |
| `cancel` | 24 | 低 | ✅ |
| `startArbitration` / `resolveArbitration` | 各40 | 中 | ✅ |
| `uploadPaymentProof` | 50 | 中 | ✅ |
| `getDeliveryHistory` | 8 | 低 | ✅ |
| `getChecklist` / `getChecklistStats` / `generateChecklistFromTask` / `updateChecklistBatch` | 各25 | 低 | ✅ |
| `getMyReceipts` | 20 | 低 | ✅ |

### 4.2 Controller 路由清单（18 个端点）

| 端点 | 方法 | 说明 |
|------|------|------|
| `GET /` | `findAll` | 全部订单 |
| `GET /client/:userId` | `findByClient` | 雇主的订单 |
| `GET /owner/:userId` | `findByOwner` | 开发者的订单 |
| `GET /agent/:agentId` | `findByAgent` | Agent 的订单 |
| `GET /task/:taskId` | `findByTask` | 任务的订单 |
| `GET /:id` | `findOne` | 订单详情 |
| `GET /:id/deliveries` | `listDeliveries` | 交付列表 |
| `GET /:id/delivery-history` | `getDeliveryHistory` | 交付历史 |
| `GET /:id/checklist` | `getChecklist` | 验收清单 |
| `GET /:id/checklist/stats` | `getChecklistStats` | 清单统计 |
| `POST /:id/pay` | `pay` | 支付 |
| `POST /:id/deliver` | `deliver` | 提交交付 |
| `POST /:id/accept` | `accept` | 验收 |
| `POST /:id/reject` | `reject` | 拒绝/退回 |
| `POST /:id/release` | `release` | 平台放款 (Admin) |
| `POST /:id/cancel` | `cancel` | 取消 |
| `POST /:id/payment-proof` | `uploadPaymentProof` | 上传付款凭证 |
| `POST /:id/checklist/generate` | `generateChecklist` | 生成清单 |
| `POST /:id/checklist/update` | `updateChecklist` | 更新清单 |

---

## 5. 实施任务

### Day 1 — 执行状态集成 + 验收加强

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| 1 | 扩展 `deliveries` 表（artifact_urls, evidence_bundle, commit_hash） | SQL + Entity | 0.5h |
| 2 | `accept()` 增加 checklist 强制校验 | `orders.service.ts` | 1h |
| 3 | `release()` 增加审批记录 | `orders.service.ts` | 0.5h |
| 4 | 执行状态 API 联调（phases/subtasks → order） | `execution` + `orders` | 2h |
| 5 | 扩展 `GET /orders/:id` 返回执行状态信息 | `orders.service.ts` | 1h |

### Day 2 — 前端 + 端到端测试

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| 6 | 订单详情页优化（执行状态展示、交付历史时间线） | `OrderDetail.tsx` | 2h |
| 7 | 交付物上传页（多文件 + 预览） | 新页面 | 1.5h |
| 8 | 验收清单交互增强（批量打勾、状态提示） | `AcceptanceChecklist.tsx` | 1.5h |
| 9 | 端到端测试（支付→执行→交付→验收→放款） | — | 1h |

---

## 6. 验收标准

- [ ] 订单全状态流转正确: PENDING_PAYMENT → IN_PROGRESS → DELIVERED → PENDING_RELEASE → COMPLETED
- [ ] 交付支持多版本迭代 (v1 → reject → v2 → accept)
- [ ] 验收清单全部通过后才允许 accept
- [ ] 平台放款有管理员操作记录
- [ ] 执行状态可通过订单详情查看
- [ ] 交付历史完整展示（含修订记录）
- [ ] 余额正确增减（放款加余额、扣服务费）
- [ ] Webhook 在关键节点正确触发
- [ ] 前端订单详情页可查看完整履约状态
