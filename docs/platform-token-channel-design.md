# 平台 Token 渠道设计方案

## 1. 背景

当前交易平台中，Agent 在执行任务时需要调用大模型完成分析、规划、工具调用决策或结果总结。平台需要同时支持两种模型调用路径：

1. 用户的 Agent 使用用户自己的 Token，并通过用户自有 API 调用模块执行任务。
2. 用户的 Agent 使用平台本身的 Token 渠道，由平台统一调用大模型执行任务。

因此，平台需要将模型调用能力抽象为统一基础设施，避免不同 Agent 各自直接集成模型供应商，同时保证平台 Token 渠道具备额度、计费、风控、审计和多模型路由能力。

## 2. 设计目标

- 支持用户自有 Token 渠道和平台 Token 渠道。
- Agent 调用模型时使用统一入口，不直接感知底层 Token 来源。
- 支持多模型供应商、多模型、多 Key 池和模型 fallback。
- 平台 Token 渠道可限流、可计费、可审计、可风控。
- 用户自有 Token 渠道支持安全托管、加密存储和调用隔离。
- 交易类 Agent 的模型调用必须纳入权限控制和风险控制，防止模型输出直接触发高风险交易行为。

## 3. 总体架构

建议建设统一的 `Model Gateway`，所有 Agent 的模型调用都必须经过该网关。

```text
Agent Runtime
   |
   v
Model Gateway
   |
   +-- User Token Channel
   |      |
   |      +-- 用户自有 API Key / Provider / Model
   |
   +-- Platform Token Channel
          |
          +-- 平台 API Key 池
          +-- 模型路由
          +-- 额度控制
          +-- 计费系统
          +-- 风控审计
```

Agent 不直接调用 OpenAI、Anthropic、Gemini、DeepSeek 或私有模型服务，而是统一调用平台接口：

```text
POST /api/model/chat
POST /api/model/embed
POST /api/model/tool-call
```

`Model Gateway` 根据 Agent 配置、用户账户状态、任务类型、风险等级和平台策略决定最终走用户 Token 渠道还是平台 Token 渠道。

## 4. 渠道模式

每个 Agent 应维护独立的模型调用配置。

```text
agent_model_config
- agent_id
- user_id
- channel_mode: user_token | platform_token | auto
- provider
- model
- temperature
- max_tokens
- fallback_model
- monthly_limit
- task_risk_level
```

渠道模式建议分为三类：

| 模式 | 说明 |
| --- | --- |
| `user_token` | 强制使用用户自己的 API Key |
| `platform_token` | 强制使用平台 Token |
| `auto` | 优先用户 Token，未配置或失败时使用平台 Token，需用户授权 |

建议默认策略：

- 普通用户、试用用户默认使用平台 Token 渠道。
- 专业用户、机构用户可优先使用用户自有 Token。
- 高风险交易任务必须经过 `Model Gateway` 和平台风控，即使使用用户 Token，也不能绕过平台审计。

## 5. 用户自有 Token 渠道

用户自有 Token 渠道主要解决用户自带模型账号、私有模型服务或机构自控成本的问题。

### 5.1 配置模型

```text
user_model_credentials
- id
- user_id
- provider
- api_key_encrypted
- base_url
- available_models
- status
- created_at
- last_used_at
```

### 5.2 关键要求

- API Key 必须加密存储，建议使用 KMS、Vault 或等价密钥管理系统。
- 后端仅在调用时短暂解密使用 API Key，不向前端返回明文。
- 支持用户进行连通性测试。
- 支持用户设置默认供应商、默认模型和模型参数。
- 支持用户设置每日、每月调用上限。
- 调用失败时需要区分错误类型，包括 Key 无效、余额不足、模型不存在、请求超限和供应商不可用。
- 用户 Token 渠道不计入平台模型成本，但仍需要记录审计日志和任务链路日志。

## 6. 平台 Token 渠道

平台 Token 渠道是平台统一提供的大模型调用能力，需要管理平台 API Key 池、模型路由、额度、计费、风控和审计。

### 6.1 平台 Key 池

```text
platform_model_keys
- id
- provider
- api_key_encrypted
- base_url
- supported_models
- priority
- weight
- qps_limit
- rpm_limit
- tpm_limit
- status
- tenant_scope
```

Key 池可以支持多个供应商和多个 Key：

```text
OpenAI Key A
OpenAI Key B
Claude Key A
DeepSeek Key A
Gemini Key A
私有模型服务 Key A
```

### 6.2 模型路由

```text
model_routing_rules
- task_type
- risk_level
- preferred_provider
- preferred_model
- fallback_models
- max_cost_per_request
- latency_priority
```

示例路由策略：

| 任务类型 | 推荐模型策略 |
| --- | --- |
| 普通问答 | 低成本模型 |
| 策略解释 | 中高推理模型 |
| 风险分析 | 高可靠模型 |
| 交易前检查 | 稳定、低幻觉模型 |
| 代码生成 Agent | 强代码模型 |

### 6.3 fallback 机制

平台 Token 渠道应支持模型 fallback：

```text
primary_model -> fallback_model_1 -> fallback_model_2
```

触发 fallback 的常见条件：

- 模型供应商请求失败。
- 当前 Key 达到限流。
- 模型延迟超过阈值。
- 模型成本超过当前任务预算。
- 模型返回内容未通过安全校验。

## 7. 额度与计费

平台 Token 渠道必须可计量、可扣费、可追溯。

### 7.1 模型调用记录

```text
model_usage_records
- id
- user_id
- agent_id
- task_id
- channel_mode
- provider
- model
- prompt_tokens
- completion_tokens
- total_tokens
- input_cost
- output_cost
- platform_markup
- final_charge
- latency_ms
- status
- error_code
- created_at
```

### 7.2 用户模型额度

```text
user_model_quota
- user_id
- plan_type
- monthly_token_limit
- monthly_cost_limit
- used_tokens
- used_cost
- reset_at
```

### 7.3 计费模式

平台可支持三类计费方式：

1. 订阅包含额度：例如每月包含固定模型 Token 或模型点数。
2. 按量计费：按照实际模型消耗成本加平台服务费。
3. 任务包计费：一次策略回测、一次 Agent 分析、一次交易报告消耗固定点数。

建议内部使用统一的 `model_credit` 记账，避免直接暴露不同供应商的复杂价格体系。

```text
1 model_credit = 平台定义的统一模型消耗单位
```

## 8. Agent 调用流程

### 8.1 平台 Token 渠道流程

```text
1. Agent 发起模型请求
2. Model Gateway 验证用户身份和 Agent 权限
3. 判断任务类型和风险等级
4. 检查用户平台额度
5. 选择供应商、模型和平台 API Key
6. 执行 Prompt 安全检查
7. 调用模型供应商
8. 返回模型结果
9. 记录 Token 用量、成本、延迟和错误
10. 扣减用户额度或生成账单
11. 将结果交给 Agent Runtime 继续执行
```

### 8.2 用户 Token 渠道流程

```text
1. Agent 发起模型请求
2. Model Gateway 验证用户身份和 Agent 权限
3. 读取用户模型配置
4. 解密用户 API Key
5. 执行 Prompt 安全检查
6. 调用用户指定模型
7. 返回模型结果
8. 记录审计日志，但不计入平台模型成本
```

## 9. 交易场景安全控制

交易平台中的模型调用不能仅作为文本生成能力处理，必须纳入 Agent 行为控制体系。

### 9.1 模型不能直接下单

模型只能生成建议、分析、计划或工具调用意图。真实下单、撤单、调仓等操作必须经过交易权限系统和 Agent 工具权限系统。

### 9.2 高风险操作二次确认

以下操作建议强制二次确认或策略审批：

- 实盘下单
- 调仓
- 撤单
- 修改杠杆
- 提现
- 开启自动交易
- 调整高风险策略参数

### 9.3 Agent 工具权限

```text
agent_tool_permissions
- agent_id
- can_read_market_data
- can_read_account
- can_place_order
- can_cancel_order
- can_trade_live
- max_order_value
- requires_user_confirmation
```

### 9.4 Prompt 与输出审计

```text
agent_model_audit_logs
- user_id
- agent_id
- task_id
- prompt_hash
- response_hash
- tool_call_intent
- risk_score
- decision_trace
```

敏感内容不建议长期明文保存。可以保存摘要、脱敏内容、风险评分、工具调用意图和必要审计字段。

## 10. 权限与套餐策略

| 用户类型 | 可用渠道 | 限制 |
| --- | --- | --- |
| 免费用户 | 平台 Token | 低额度、低成本模型 |
| 订阅用户 | 平台 Token + 用户 Token | 中等额度 |
| 专业用户 | 用户 Token + 平台高级模型 | 高额度 |
| 机构用户 | 私有模型 / 独立 Key 池 | 独立限流、独立审计 |

平台 Token 渠道可作为商业化能力：

- 基础模型额度
- 高级推理模型额度
- 交易 Agent 专用模型额度
- 机构独享模型通道

## 11. 落地阶段

### 第一阶段：统一网关

- 建立 `Model Gateway`。
- Agent 全部通过统一接口调用模型。
- 支持 `user_token` 和 `platform_token` 两种模式。
- 记录基础 usage 日志。

### 第二阶段：平台 Token 计费

- 建立额度系统。
- 建立 Token 统计和成本计算。
- 支持套餐、用量限制和失败回退。

### 第三阶段：模型路由

- 支持多供应商。
- 支持模型 fallback。
- 支持按任务类型选择模型。
- 支持成本优先、质量优先和延迟优先策略。

### 第四阶段：交易风控增强

- 建立 Agent 工具权限。
- 支持高风险任务审批。
- 建立 Prompt 审计。
- 增加模型输出风险评分。
- 增加实盘交易保护机制。

## 12. 核心结论

平台应该将大模型调用设计为基础设施能力，而不是散落在各个 Agent 的内部实现中。

最关键的抽象是：

```text
Agent 不拥有模型调用细节
Agent 只声明模型需求
Model Gateway 决定调用路径、模型、额度、风控和计费
```

这样后续无论接入新模型、做平台计费、支持企业私有化部署，还是加强交易安全，都不会破坏 Agent 的核心执行逻辑。
