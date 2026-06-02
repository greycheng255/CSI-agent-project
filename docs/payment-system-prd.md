# Genesis 支付收款系统 PRD

## 1. 文档信息

- **文档版本**: v1.0
- **创建日期**: 2026-04-17
- **产品名称**: Genesis 支付收款系统
- **目标平台**: Web (React + Node.js)

---

## 2. 产品概述

### 2.1 产品背景
Genesis 平台目前实现了任务发布、报价、订单流转等核心功能，但缺乏完整的资金管理体系。为了保障交易安全、提升用户体验，需要建设一套完整的支付收款系统，实现资金托管、余额管理、提现等功能。

### 2.2 产品目标
1. **资金安全**: 实现平台资金托管，保障雇主和开发者双方权益
2. **交易透明**: 提供清晰的收支明细，每笔资金变动可追溯
3. **提现便捷**: 支持多种提现方式，简化开发者收款流程
4. **合规运营**: 建立风控体系，防范洗钱、欺诈等风险

### 2.3 核心术语

| 术语 | 定义 |
|------|------|
| 雇主 | 发布任务并支付费用的用户（CLIENT） |
| 开发者 | 承接任务并完成任务的用户（OWNER/AGENT） |
| 平台服务费 | 平台收取的交易手续费，默认 5% |
| 托管资金 | 雇主支付后，平台代为保管的资金 |
| 可用余额 | 用户可自由支配、可提现的资金 |
| 冻结余额 | 因提现申请或争议被暂时冻结的资金 |

---

## 3. 功能需求

### 3.1 资金托管流程

#### 3.1.1 支付流程
```
雇主下单 → 雇主支付 → 资金进入平台托管 → 开发者开始工作
```

**详细步骤：**
1. 雇主选择中标报价，创建订单
2. 订单状态变为 PENDING_PAYMENT（待支付）
3. 雇主通过支付宝/微信支付订单金额
4. 支付成功后，资金进入平台托管账户
5. 订单状态变为 IN_PROGRESS（进行中）
6. 平台记录托管金额、服务费、开发者 payout 金额

#### 3.1.2 结算流程
```
开发者交付 → 雇主验收 → 资金释放到开发者余额
```

**详细步骤：**
1. 开发者完成任务并提交交付物
2. 订单状态变为 DELIVERED（待验收）
3. 雇主验收通过，点击"确认完成"
4. 订单状态变为 ACCEPTED（已接受）
5. 系统自动将 payout 金额转入开发者可用余额
6. 订单状态变为 COMPLETED（已完成）

#### 3.1.3 争议处理
```
雇主拒绝 → 进入协商/仲裁 → 根据结果分配资金
```

**详细步骤：**
1. 雇主验收不通过，可发起协商或仲裁
2. 协商达成一致，按协商结果分配资金
3. 仲裁由平台介入，根据证据判定资金归属

---

### 3.2 余额系统

#### 3.2.1 余额类型

| 余额类型 | 说明 | 是否可提现 |
|---------|------|-----------|
| 可用余额 | 用户可自由支配的资金 | 是 |
| 冻结余额 | 提现申请中或争议中的资金 | 否 |
| 总余额 | 可用余额 + 冻结余额 | - |

#### 3.2.2 余额变动场景

**收入场景：**
- 任务完成，payout 金额转入
- 退款退回
- 平台奖励/补偿

**支出场景：**
- 提现申请
- 支付任务费用
- 平台扣款（违规处罚等）

#### 3.2.3 余额查询

**前端展示：**
- 个人中心显示总余额和可用余额
- 点击余额进入收支明细页面

**API 接口：**
```
GET /api/v1/wallet/balance
Response: {
  "totalBalance": 1000.00,
  "availableBalance": 800.00,
  "frozenBalance": 200.00,
  "totalEarned": 5000.00,
  "totalWithdrawn": 4200.00
}
```

---

### 3.3 收支明细

#### 3.3.1 交易记录

**记录字段：**
- 交易 ID
- 交易时间
- 交易类型（收入/支出/冻结/解冻）
- 交易金额
- 余额变动后金额
- 关联订单 ID
- 交易描述

**交易类型：**

| 类型 | 说明 | 示例 |
|------|------|------|
| TASK_EARNED | 任务收入 | 完成任务获得 ¥100 |
| WITHDRAWAL | 提现支出 | 提现 ¥500 |
| WITHDRAWAL_FEE | 提现手续费 | 手续费 ¥5 |
| REFUND | 退款收入 | 任务取消退款 ¥200 |
| FROZEN | 资金冻结 | 提现申请冻结 ¥500 |
| UNFROZEN | 资金解冻 | 提现失败解冻 ¥500 |

#### 3.3.2 筛选和分页

**筛选条件：**
- 时间范围（近7天/30天/自定义）
- 交易类型
- 收入/支出

**分页：**
- 默认每页 20 条
- 支持加载更多

**API 接口：**
```
GET /api/v1/wallet/transactions?page=1&limit=20&type=TASK_EARNED
```

---

### 3.4 提现系统

#### 3.4.1 提现方式

**支持的提现方式：**

| 方式 | 到账时间 | 手续费 | 限额 |
|------|---------|--------|------|
| 支付宝 | 实时/1-3工作日 | 0.6% | 单笔最低 ¥10，最高 ¥50,000 |
| 微信 | 实时/1-3工作日 | 0.6% | 单笔最低 ¥10，最高 ¥50,000 |
| 银行卡 | 1-3工作日 | 1% | 单笔最低 ¥100，最高 ¥100,000 |

#### 3.4.2 提现流程

```
开发者申请提现 → 平台审核 → 打款 → 到账
```

**详细步骤：**

1. **申请提现**
   - 开发者进入提现页面
   - 选择提现方式（支付宝/微信/银行卡）
   - 输入提现金额
   - 确认手续费和实际到账金额
   - 提交提现申请

2. **资金冻结**
   - 系统冻结对应金额
   - 生成提现记录，状态为 PENDING（待审核）
   - 发送通知给开发者

3. **平台审核**
   - 后台运营人员审核提现申请
   - 审核通过：状态变为 APPROVED（已通过）
   - 审核拒绝：状态变为 REJECTED（已拒绝），资金解冻

4. **执行打款**
   - 财务人员或系统自动打款
   - 打款成功：状态变为 COMPLETED（已完成）
   - 打款失败：状态变为 FAILED（失败），资金解冻

#### 3.4.3 提现限制

**风控规则：**
- 新用户首次提现需完成实名认证
- 单日提现总额不超过 ¥50,000
- 单笔提现不超过 ¥100,000
- 提现频率限制：每日最多 3 次
- 异常账户需人工审核

#### 3.4.4 提现记录

**记录字段：**
- 提现单号
- 申请时间
- 提现方式
- 提现金额
- 手续费
- 实际到账
- 收款账号（脱敏显示）
- 状态
- 审核备注

**状态流转：**
```
PENDING → APPROVED → COMPLETED
   ↓
REJECTED / FAILED
```

---

### 3.5 收款账号管理

#### 3.5.1 账号绑定

**支付宝绑定：**
- 输入支付宝账号（手机号/邮箱）
- 输入真实姓名
- 发送验证金额（0.01-0.99 元）
- 用户输入验证金额完成绑定

**微信绑定：**
- 跳转微信授权
- 获取微信 openid
- 绑定完成

**银行卡绑定：**
- 输入银行卡号
- 自动识别银行名称
- 输入开户行信息
- 输入持卡人姓名
- 短信验证

#### 3.5.2 账号管理

**功能：**
- 查看已绑定的收款账号
- 设置默认收款账号
- 解绑收款账号（需验证）
- 修改收款账号信息

**安全要求：**
- 修改/解绑需验证登录密码或短信验证码
- 新设备登录需二次验证

---

## 4. 非功能需求

### 4.1 性能要求

- 余额查询响应时间 < 100ms
- 交易记录查询响应时间 < 200ms
- 支持并发提现申请处理

### 4.2 安全要求

- 所有资金操作需记录审计日志
- 敏感操作需二次验证（密码/短信/邮箱）
- 提现账号变更需 24 小时冷静期
- 异常交易自动触发风控预警

### 4.3 合规要求

- 保存交易记录至少 5 年
- 大额交易上报（单笔超过 5 万元）
- 反洗钱监控（识别可疑交易模式）
- 用户实名认证（姓名+身份证+人脸识别）

---

## 5. 数据库设计

### 5.1 用户余额表 (user_balances)

```sql
CREATE TABLE user_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  available_balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  frozen_balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  total_earned DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  total_withdrawn DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 5.2 交易记录表 (transactions)

```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type VARCHAR(50) NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  balance_after DECIMAL(15, 2) NOT NULL,
  order_id UUID REFERENCES orders(id),
  withdrawal_id UUID REFERENCES withdrawals(id),
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
```

### 5.3 提现记录表 (withdrawals)

```sql
CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount DECIMAL(15, 2) NOT NULL,
  fee DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  actual_amount DECIMAL(15, 2) NOT NULL,
  method VARCHAR(20) NOT NULL, -- ALIPAY, WECHAT, BANK
  account_info JSONB NOT NULL, -- 收款账号信息
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  completed_at TIMESTAMP,
  remark TEXT,
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);
```

### 5.4 收款账号表 (payment_accounts)

```sql
CREATE TABLE payment_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type VARCHAR(20) NOT NULL, -- ALIPAY, WECHAT, BANK
  account_name VARCHAR(100) NOT NULL,
  account_number VARCHAR(100) NOT NULL,
  bank_name VARCHAR(100),
  bank_branch VARCHAR(200),
  is_default BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_accounts_user_id ON payment_accounts(user_id);
```

---

## 6. API 接口设计

### 6.1 余额相关

```typescript
// 获取余额
GET /api/v1/wallet/balance
Response: {
  totalBalance: number;
  availableBalance: number;
  frozenBalance: number;
  totalEarned: number;
  totalWithdrawn: number;
}

// 获取收支明细
GET /api/v1/wallet/transactions?page&limit&type&startDate&endDate
Response: {
  items: Transaction[];
  pagination: Pagination;
}
```

### 6.2 提现相关

```typescript
// 申请提现
POST /api/v1/wallet/withdrawals
Body: {
  amount: number;
  method: 'ALIPAY' | 'WECHAT' | 'BANK';
  accountId: string;
}
Response: Withdrawal

// 获取提现记录
GET /api/v1/wallet/withdrawals?page&limit&status
Response: {
  items: Withdrawal[];
  pagination: Pagination;
}

// 取消提现申请（仅 PENDING 状态）
POST /api/v1/wallet/withdrawals/:id/cancel
```

### 6.3 收款账号相关

```typescript
// 获取收款账号列表
GET /api/v1/wallet/accounts
Response: PaymentAccount[]

// 添加收款账号
POST /api/v1/wallet/accounts
Body: {
  type: 'ALIPAY' | 'WECHAT' | 'BANK';
  accountName: string;
  accountNumber: string;
  bankName?: string;
  bankBranch?: string;
}

// 设置默认账号
PUT /api/v1/wallet/accounts/:id/default

// 删除收款账号
DELETE /api/v1/wallet/accounts/:id
```

---

## 7. 前端页面设计

### 7.1 个人中心 - 余额卡片

```
┌─────────────────────────────────────┐
│  我的余额                    [去提现] │
│                                     │
│  ¥ 1,250.00                        │
│  可用余额: ¥1,000  冻结中: ¥250     │
│                                     │
│  [收支明细]  [提现记录]              │
└─────────────────────────────────────┘
```

### 7.2 收支明细页面

```
┌─────────────────────────────────────┐
│  收支明细                    [筛选] │
│                                     │
│  本月收支: +¥2,500  -¥500           │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ 任务收入          +¥500       │  │
│  │ 完成任务: 抖音爬虫脚本        │  │
│  │ 04-15 14:30       余额: ¥1250│  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 提现支出          -¥500       │  │
│  │ 提现至支付宝                  │  │
│  │ 04-14 10:20       余额: ¥750 │  │
│  └───────────────────────────────┘  │
│                                     │
└─────────────────────────────────────┘
```

### 7.3 提现页面

```
┌─────────────────────────────────────┐
│  提现                               │
│                                     │
│  可提现余额: ¥1,000.00              │
│                                     │
│  提现金额                           │
│  ┌─────────────────────────────┐    │
│  │  ¥ [        500        ]    │    │
│  └─────────────────────────────┘    │
│  全部提现                           │
│                                     │
│  提现方式                           │
│  ┌─────────────────────────────┐    │
│  │ ○ 支付宝 (138****0001)      │    │
│  │ ● 微信   (已绑定)           │    │
│  │ ○ 银行卡 (招商银行 8888)    │    │
│  └─────────────────────────────┘    │
│                                     │
│  提现手续费: ¥3.00                  │
│  实际到账: ¥497.00                  │
│                                     │
│  [确认提现]                         │
│                                     │
│  预计到账时间: 1-3 个工作日         │
└─────────────────────────────────────┘
```

---

## 8. 管理后台需求

### 8.1 提现审核

**功能：**
- 查看待审核提现列表
- 查看提现详情（用户信息、收款账号、历史提现记录）
- 审核通过/拒绝
- 标记已打款
- 批量操作

**审核要点：**
- 用户实名认证状态
- 账户是否存在异常
- 提现金额是否异常
- 历史提现记录

### 8.2 资金报表

**报表类型：**
- 平台资金总览（托管中、已结算、手续费收入）
- 每日收支统计
- 提现统计
- 用户余额分布

---

## 9. 风险管控

### 9.1 风控规则

| 场景 | 规则 | 处理 |
|------|------|------|
| 新用户大额提现 | 首次提现超过 ¥1000 | 人工审核 |
| 频繁提现 | 单日提现超过 3 次 | 限制提现 |
| 异常金额 | 单笔提现超过 ¥50,000 | 人工审核 |
| 账户异常 | 登录地异常、IP 异常 | 二次验证 |
| 关联账户 | 多个账户使用相同收款账号 | 风控预警 |

### 9.2 反洗钱

- 监控大额交易（单笔 5 万以上）
- 监控频繁小额交易（疑似拆分）
- 监控快进快出（资金不过夜）
- 上报可疑交易报告

---

## 10. 实施计划

### 第一阶段（MVP - 2 周）
- [ ] 数据库表设计
- [ ] 余额系统基础功能
- [ ] 订单完成自动结算
- [ ] 收支明细页面

### 第二阶段（核心功能 - 2 周）
- [ ] 提现申请功能
- [ ] 收款账号管理
- [ ] 管理后台审核
- [ ] 提现记录页面

### 第三阶段（优化 - 1 周）
- [ ] 接入真实支付接口
- [ ] 风控系统
- [ ] 测试和优化

---

## 11. 附录

### 11.1 相关文档
- 订单系统文档
- 用户系统文档
- 支付渠道对接文档

### 11.2 变更记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|---------|------|
| v1.0 | 2026-04-17 | 初稿 | - |
