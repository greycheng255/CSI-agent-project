# 碳硅交易平台 — 审计日志方案 v2.0

> 版本: v2.0 | 日期: 2026-06-18  
> 原则: 按功能模块分表，表名以 `_log` 结尾，每个模块独立管理自己的日志

---

## 1. 日志表设计

### 1.1 `user_log` — 用户操作日志

```sql
CREATE TABLE IF NOT EXISTS user_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    action VARCHAR NOT NULL,        -- register | login_success | login_failed | password_change | profile_update | password_reset
    ip_address VARCHAR,             -- 登录/操作 IP
    user_agent TEXT,                -- 客户端信息
    detail JSONB,                   -- { phone, displayName, reason }
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_user_log_user ON user_log(user_id);
CREATE INDEX idx_user_log_action ON user_log(action);
CREATE INDEX idx_user_log_time ON user_log(created_at DESC);
```

### 1.2 `agent_log` — Agent 操作日志

```sql
CREATE TABLE IF NOT EXISTS agent_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    operator_id UUID,               -- 操作人（Owner / Admin）
    operator_type VARCHAR DEFAULT 'USER',  -- USER | ADMIN | SYSTEM
    action VARCHAR NOT NULL,        -- register | approve | reject | enable | disable | online | offline_timeout | api_key_create | api_key_revoke | update
    detail JSONB,                   -- { agent_name, reason, changes }
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agent_log_agent ON agent_log(agent_id);
CREATE INDEX idx_agent_log_action ON agent_log(action);
CREATE INDEX idx_agent_log_time ON agent_log(created_at DESC);
```

### 1.3 `task_log` — 任务操作日志

```sql
CREATE TABLE IF NOT EXISTS task_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL,
    operator_id UUID NOT NULL,      -- 操作人
    action VARCHAR NOT NULL,        -- create | update | close | reopen | delete
    detail JSONB,                   -- { title, budget, before, after }
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_task_log_task ON task_log(task_id);
CREATE INDEX idx_task_log_action ON task_log(action);
CREATE INDEX idx_task_log_time ON task_log(created_at DESC);
```

### 1.4 `bid_log` — 报价操作日志

```sql
CREATE TABLE IF NOT EXISTS bid_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bid_id UUID NOT NULL,
    task_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    action VARCHAR NOT NULL,        -- submit | update | accept | reject | expire
    detail JSONB,                   -- { price_cny, plan_summary }
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bid_log_bid ON bid_log(bid_id);
CREATE INDEX idx_bid_log_task ON bid_log(task_id);
CREATE INDEX idx_bid_log_agent ON bid_log(agent_id);
```

### 1.5 `order_log` — 订单操作日志

```sql
CREATE TABLE IF NOT EXISTS order_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL,
    operator_id UUID,
    operator_type VARCHAR DEFAULT 'SYSTEM',  -- USER | AGENT | ADMIN | SYSTEM
    action VARCHAR NOT NULL,        -- pay | execute_start | execute_progress | deliver | accept | reject | dispute | cancel | release | refund
    detail JSONB,                   -- { from_status, to_status, amount, reason }
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_order_log_order ON order_log(order_id);
CREATE INDEX idx_order_log_action ON order_log(action);
CREATE INDEX idx_order_log_time ON order_log(created_at DESC);
```

### 1.6 `admin_log` — 管理员操作日志

```sql
CREATE TABLE IF NOT EXISTS admin_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL,         -- 操作者
    target_type VARCHAR,            -- user | agent | admin | order
    target_id UUID,
    action VARCHAR NOT NULL,        -- login | create_admin | change_permission | review_kyc | review_agent | force_close_order
    detail JSONB,
    ip_address VARCHAR,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_admin_log_admin ON admin_log(admin_id);
CREATE INDEX idx_admin_log_action ON admin_log(action);
CREATE INDEX idx_admin_log_time ON admin_log(created_at DESC);
```

### 1.7 `payment_log` — 支付/提现日志

```sql
CREATE TABLE IF NOT EXISTS payment_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID,
    user_id UUID,
    action VARCHAR NOT NULL,        -- payment_create | payment_confirm | payout_request | payout_complete | withdraw_request | withdraw_approve | withdraw_reject
    amount_cny DECIMAL(10,2),
    detail JSONB,                   -- { payment_method, transaction_id }
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_payment_log_order ON payment_log(order_id);
CREATE INDEX idx_payment_log_user ON payment_log(user_id);
CREATE INDEX idx_payment_log_time ON payment_log(created_at DESC);
```

### 1.8 `login_log` — 登录日志（独立高频表）

```sql
CREATE TABLE IF NOT EXISTS login_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,                   -- 成功时关联用户，失败时为 NULL
    login_type VARCHAR NOT NULL,    -- user | admin
    phone_or_username VARCHAR,      -- 登录标识
    status VARCHAR NOT NULL,        -- success | failed
    fail_reason VARCHAR,            -- wrong_password | user_not_found | account_disabled
    ip_address VARCHAR,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_login_log_user ON login_log(user_id);
CREATE INDEX idx_login_log_status ON login_log(status);
CREATE INDEX idx_login_log_time ON login_log(created_at DESC);
```

---

## 2. 日志表总览

| # | 表名 | 记录内容 | 写入模块 |
|---|------|---------|---------|
| 1 | `user_log` | 注册、改密、更新资料 | UsersService |
| 2 | `login_log` | 登录成功/失败（用户+管理员） | UsersService / AdminAuthService |
| 3 | `agent_log` | 注册、审核、上下线、密钥 | AgentsService |
| 4 | `task_log` | 创建、编辑、关闭 | TasksService |
| 5 | `bid_log` | 报价、选标 | BidsService |
| 6 | `order_log` | 支付、执行、交付、验收、争议 | OrdersService |
| 7 | `payment_log` | 支付流水、提现、放款 | PaymentService / BalanceService |
| 8 | `admin_log` | 管理员敏感操作 | AdminAuthService |

> `login_log` 独立出来是因为登录是最高频操作，不适合混在其他表中。

---

## 3. 架构设计

### 3.1 目录结构

```
backend/src/logging/
├── logging.module.ts              ← 全局模块（@Global()）
├── logging.service.ts             ← 统一日志入口（路由到各 Repo）
├── entities/
│   ├── user-log.entity.ts
│   ├── login-log.entity.ts
│   ├── agent-log.entity.ts
│   ├── task-log.entity.ts
│   ├── bid-log.entity.ts
│   ├── order-log.entity.ts
│   ├── payment-log.entity.ts
│   └── admin-log.entity.ts
└── dto/
    └── log-query.dto.ts           ← 通用查询 DTO
```

### 3.2 统一入口服务

```typescript
// logging.service.ts
@Injectable()
export class LoggingService {
  constructor(
    @InjectRepository(UserLog) private userLogRepo: Repository<UserLog>,
    @InjectRepository(LoginLog) private loginLogRepo: Repository<LoginLog>,
    @InjectRepository(AgentLog) private agentLogRepo: Repository<AgentLog>,
    @InjectRepository(TaskLog) private taskLogRepo: Repository<TaskLog>,
    @InjectRepository(BidLog) private bidLogRepo: Repository<BidLog>,
    @InjectRepository(OrderLog) private orderLogRepo: Repository<OrderLog>,
    @InjectRepository(PaymentLog) private paymentLogRepo: Repository<PaymentLog>,
    @InjectRepository(AdminLog) private adminLogRepo: Repository<AdminLog>,
  ) {}

  /** fire-and-forget，不阻塞业务 */
  private write<T extends { created_at?: Date }>(
    repo: Repository<T>,
    data: T,
  ): void {
    Promise.resolve().then(async () => {
      try {
        await repo.save(repo.create(data as any));
      } catch (err) {
        console.error(`[LoggingService] 写入失败:`, err);
      }
    });
  }

  logUser(data: Partial<UserLog>) { this.write(this.userLogRepo, data as UserLog); }
  logLogin(data: Partial<LoginLog>) { this.write(this.loginLogRepo, data as LoginLog); }
  logAgent(data: Partial<AgentLog>) { this.write(this.agentLogRepo, data as AgentLog); }
  logTask(data: Partial<TaskLog>) { this.write(this.taskLogRepo, data as TaskLog); }
  logBid(data: Partial<BidLog>) { this.write(this.bidLogRepo, data as BidLog); }
  logOrder(data: Partial<OrderLog>) { this.write(this.orderLogRepo, data as OrderLog); }
  logPayment(data: Partial<PaymentLog>) { this.write(this.paymentLogRepo, data as PaymentLog); }
  logAdmin(data: Partial<AdminLog>) { this.write(this.adminLogRepo, data as AdminLog); }
}
```

### 3.3 全局模块

```typescript
// logging.module.ts
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([
    UserLog, LoginLog, AgentLog, TaskLog,
    BidLog, OrderLog, PaymentLog, AdminLog,
  ])],
  providers: [LoggingService],
  exports: [LoggingService],
})
export class LoggingModule {}
```

### 3.4 调用示例

```typescript
// UsersService
export class UsersService {
  constructor(private readonly logger: LoggingService) {}

  async login(data: AuthDto) {
    // ... 业务逻辑 ...
    if (success) {
      this.logger.logLogin({
        user_id: user.id,
        login_type: 'user',
        phone_or_username: data.phone,
        status: 'success',
        ip_address: ip,
        user_agent: ua,
      });
    } else {
      this.logger.logLogin({
        user_id: null,
        login_type: 'user',
        phone_or_username: data.phone,
        status: 'failed',
        fail_reason: 'wrong_password',
        ip_address: ip,
      });
    }
  }
}
```

---

## 4. 各模块埋点清单

### UsersService
| 方法 | 写入表 | 数据 |
|------|--------|------|
| `register()` | `user_log` | action=register |
| `login()` 成功 | `login_log` | status=success |
| `login()` 失败 | `login_log` | status=failed, fail_reason |
| `changePassword()` | `user_log` | action=password_change |
| `updateUser()` | `user_log` | action=profile_update |

### AgentsService
| 方法 | 写入表 | 数据 |
|------|--------|------|
| `create()` | `agent_log` | action=register |
| `heartbeat()` 首次上线 | `agent_log` | action=online |
| `consecutiveFailures >= 3` | `agent_log` | action=offline_timeout |
| `createApiKey()` | `agent_log` | action=api_key_create |
| `revokeApiKey()` | `agent_log` | action=api_key_revoke |

### TasksService
| 方法 | 写入表 | 数据 |
|------|--------|------|
| `create()` | `task_log` | action=create |
| `update()` | `task_log` | action=update, detail={before,after} |
| 关闭/删除 | `task_log` | action=close |

### BidsService
| 方法 | 写入表 | 数据 |
|------|--------|------|
| `createBid()` | `bid_log` | action=submit |
| `selectBid()` | `bid_log` | action=accept |

### OrdersService
| 方法 | 写入表 | 数据 |
|------|--------|------|
| 支付 | `order_log` + `payment_log` | 各一条 |
| 执行状态变更 | `order_log` | action=execute_progress |
| `deliver()` | `order_log` | action=deliver |
| `accept()` | `order_log` | action=accept |
| `reject()` / 争议 | `order_log` | action=dispute |
| 放款 | `order_log` + `payment_log` | action=release |

### AdminAuthService
| 方法 | 写入表 | 数据 |
|------|--------|------|
| `login()` | `login_log` | login_type=admin |
| `createAdmin()` | `admin_log` | action=create_admin |

---

## 5. 管理后台查询

每个日志表提供独立接口：

| 接口 | 表 | 筛选条件 |
|------|-----|---------|
| `GET /api/v1/admin/logs/user` | `user_log` | user_id, action, 时间范围 |
| `GET /api/v1/admin/logs/login` | `login_log` | status, login_type, 时间范围 |
| `GET /api/v1/admin/logs/agent` | `agent_log` | agent_id, action, 时间范围 |
| `GET /api/v1/admin/logs/task` | `task_log` | task_id, action |
| `GET /api/v1/admin/logs/order` | `order_log` | order_id, action, 时间范围 |
| `GET /api/v1/admin/logs/payment` | `payment_log` | user_id, order_id, 时间范围 |
| `GET /api/v1/admin/logs/admin` | `admin_log` | admin_id, action |

统一查询参数：`?page=1&limit=50&from=2026-01-01&to=2026-06-30`

---

## 6. 改动文件汇总

| # | 文件 | 改动 |
|---|------|------|
| **新建** | | |
| 1 | `backend/src/logging/logging.module.ts` | 全局模块 |
| 2 | `backend/src/logging/logging.service.ts` | 统一日志服务 |
| 3-10 | `backend/src/logging/entities/*.entity.ts` | 8 个 Entity |
| 11 | `backend/src/logging/logging-admin.controller.ts` | 管理端查询接口 |
| **修改** | | |
| 12 | `backend/src/app.module.ts` | 注册 LoggingModule |
| 13 | `backend/src/users/users.service.ts` | 注入 LoggingService，5 处埋点 |
| 14 | `backend/src/agents/agents.service.ts` | 注入 LoggingService，6 处埋点 |
| 15 | `backend/src/tasks/tasks.service.ts` | 注入 LoggingService，3 处埋点 |
| 16 | `backend/src/bids/bids.service.ts` | 注入 LoggingService，2 处埋点 |
| 17 | `backend/src/orders/orders.service.ts` | 替换为 LoggingService |
| 18 | `backend/src/admin/admin-auth.service.ts` | 注入 LoggingService，2 处埋点 |
| **废弃** | | |
| 19 | `backend/src/audit/` | 删除旧的 audit 模块 |

共 **19 个文件**（11 新建 + 7 修改 + 1 删除）。

---

## 7. 验收标准

- [ ] 8 张日志表建好，索引覆盖查询字段
- [ ] 6 个业务模块全部接入 LoggingService
- [ ] fire-and-forget 模式，日志写入失败不影响业务
- [ ] 管理后台可按模块查询日志
- [ ] 旧 `audit_logs` 表处理完毕（数据迁移或直接废弃）
