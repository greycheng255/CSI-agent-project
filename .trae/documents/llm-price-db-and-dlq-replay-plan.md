# 计费价格表外置 DB + DLQ 死信重放端点

## Context（背景）

碳硅平台的 LLM 用量计费价格表目前是内建常量 `MODEL_UNIT_PRICES`（`llm-proxy/llm-proxy.service.ts` L111-L125），只登记了 `gpt-5.4`/`gpt-5.5`，其余模型全部回退按 `gpt-5.4` 计价。而实际网关跑的是 claude 系列（`claude-fable-5` 已有计量记录），导致 claude 调用被按 gpt-5.4 收费，**单价与真实上游成本错位、正在少收钱**。改价目前必须改代码重建，运营不友好。

同时，webhook 与微信通知的失败消息在最多次重试后进入死信（`status='dead'`），目前只有"落库+告警"，**没有管理员可见的明细列表和一键重放能力**，事件会静默滞留、难以补发（曾因 Console 400 缺 `project_id` 进死信的案例）。

**本期范围（已与用户确认）**：仅做两项高优先改动——① 计费价格表外置到 DB；② DLQ 死信重放端点。低成本降级池（deepseek）、财务维度、看板隔离**暂不做**。

**目标**：价格表 DB 化后管理员可在线改价、以网关实际模型为准；DLQ 管理员可查明细并一键重投。

---

## 改动 A：LLM 计费价格表外置 DB

### 新建文件
- `src/llm-proxy/llm-model-price.entity.ts`
  - 表 `llm_model_prices`：`model_name varchar(128) PK`、`input_price int NOT NULL DEFAULT 0`、`output_price int NOT NULL DEFAULT 0`、`created_at timestamptz NOT NULL DEFAULT now()`、`updated_at timestamptz NOT NULL DEFAULT now()`（单位：人民币分 / 百万 tokens）
- `src/llm-proxy/llm-model-price.service.ts`
  - `getPrice(model): {input,output}|null`：ModuleInit 加载全表入内存 `Map<string,{input,output}>`；每次写操作后重载失效。表空时用内建 `MODEL_UNIT_PRICES` seed（保持现价不变，避免行为突变）
  - 缓存策略：单实例+写时驱逐即可，无需 TTL
- `src/llm-proxy/llm-price-admin.controller.ts`
  - `@Controller('api/v1/admin/llm/price')` + `@UseGuards(AdminGuard)`
  - `GET`（列表）、`PUT :model`（upsert）、`DELETE :model`、`POST /seed-internal`（内建默认价 seed）、`POST /seed-gateway`（经 `proxy.forward(orgId, undefined, {endpoint:'models'})` 桥接网关 `GET /v1/models` 清单初始化，见 gateway-bridge.controller.js 现有 models 分支）
- `src/llm-proxy/llm-model-price.spec.ts`

### 修改
- `src/llm-proxy/llm-proxy.service.ts`
  - `estimateCostCents(model, ...)` 改为查注入的 `LlmModelPriceService.getPrice(model)`，未命中回退 `FALLBACK_PRICE`；计量上报链路 L276-L293 与暴露调用处不变
  - constructor 增加 `LlmModelPriceService`（**必须同步注册，否则运行期崩**）
- `src/llm-proxy/llm-proxy.module.ts`
  - imports 增加 `TypeOrmModule.forFeature([UserLlmConfig, LlmModelPrice])` 与 `AdminModule`
  - providers 增加 `LlmModelPriceService`、`LlmPriceAdminController`；exports 增加 `LlmModelPriceService`
- `src/app.module.ts`：`forRoot().entities` 数组新增 `LlmModelPrice`

### DDL（追加到 `backend/migrate.sql`，云上显式执行）
```sql
CREATE TABLE IF NOT EXISTS llm_model_prices (
  model_name VARCHAR(128) PRIMARY KEY,
  input_price INT NOT NULL DEFAULT 0,
  output_price INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 改动 B：DLQ 死信重放端点

### 新建文件
- `src/admin/dlq-admin.controller.ts`
  - `@Controller('api/v1/admin/dlq')` + `@UseGuards(AdminGuard)`
  - `GET /dead?type=webhook|notification&page&limit`：分页查询 `status='dead'` 明细（按 id desc），返回 targetUrl/payload/lastError/attempts/nextAttemptAt/createdAt
  - `POST /replay`（body `{type, ids[]}`）：仅对 `status='dead'` 记录（UPDATE 带 where 约束防并发误重放）置 `status='pending'`、`attempts=0`、`nextAttemptAt=now`、`lastError=null`，之后现有 cron/dispatcher 自动续投；批量，限制 `ids.length` 上限防重放风暴
- `src/admin/dlq-admin.module.ts`：imports `AdminModule`（AdminGuard） + `TypeOrmModule.forFeature([WebhookOutbox, NotificationOutbox])`；controllers/providers 注册；register 进 `app.module` imports

### 复用
- `AdminGuard`：`src/admin/admin.guard.ts`（Bearer adminToken），参照 `entitlement-admin.controller.ts` 的用法
- 实体 `WebhookOutbox`（webhook-outbox.entity.ts，status 枚举 pending/success/dead）、`NotificationOutbox`（notification-outbox.entity.ts，status pending/success/dead/skipped）——已在 app.module entities，无需新增迁移

### 不新增字段/表

---

## 关键风险（部署顺序）
1. **运行期崩溃**：改动 A 在 constructor 新增依赖 + app.module/forFeature 注册必须三处同步；漏注册即崩（项目已知教训）
2. **DDL 先行**：云上先执行 migrate.sql 新表，再发版；否则写库报 relation 不存在
3. **缓存一致性**：写价后即时失效重载
4. **重放洪峰**：`POST /replay` 限制单次 ids 数量；4xx 死信重投会再次快速进 dead（属预期）

---

## 测试与验证

### 测试适配
- `llm-proxy.service.spec.ts` L41 测试模块需补 `{provide: getRepositoryToken(LlmModelPrice), useValue:{...}}`（constructor 新增依赖否则崩）；新增用例：DB 价命中 / 未命中回退 FALLBACK
- 新增 `llm-model-price.spec.ts`、`dlq-admin.spec.ts`（仅 dead 可重放、字段重置、批量幂等）
- webhook/notification 现有 spec 不受影响

### 验证步骤
1. `npm test` 全量通过
2. 云上执行 DDL 后重启后端（4001 端口）
3. Curl（需 Admin token）：
   - `curl -H "Authorization: Bearer $ADMIN_TOKEN" localhost:4001/api/v1/admin/llm/price`
   - `curl -H "Authorization: Bearer $ADMIN_TOKEN" "localhost:4001/api/v1/admin/dlq/dead?type=webhook"`
   - `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"type":"webhook","ids":[...]}' localhost:4001/api/v1/admin/dlq/replay`
4. 触发一次真实 LLM 调用确认计量 cost 仍按价计算、`entitlement_usage_records` 入账正常
5. 重建后端容器并重上线（时间戳 tag，根目录 `.env`）