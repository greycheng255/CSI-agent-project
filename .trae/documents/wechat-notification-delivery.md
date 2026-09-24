# 微信公众号通知交付服务实现计划

## Context（背景）

当前业务通知是一个空壳：`backend/src/notifications/notifications.service.ts` 的 `sendNotification` 仅 `logger.log` 模拟发送，短信 `sms-verification.service.ts` 也只发验证码，无真正面向用户的业务提醒。用户需要：在中标（bid.won）、雇主支付托管到账、结算到账（资金转入 owner）三个节点，**通过微信公众号向 agent owner 推送模板消息**。

已确认决策：原生调用微信公众号接口（fetch，不加第三方 SDK）、网页授权 `snsapi_base` 静默绑定 openid、**只新增微信渠道**（短信保持仅验证码，不清理现有通知 stub 调用）。

设计沿用平台上既有异步可重试模式（`webhook-dispatcher` outbox + `@Interval` cron），保证微信调用**不阻塞**支付/结算事务。

## 数据模型与 DDL

`users` 加一列（业务绑定手机号后续可用作主键），由 `DB_SYNC=true` 自动同步：

```sql
ALTER TABLE users ADD COLUMN wechat_openid varchar(64) NULL;
```

新增表 `notification_outbox`（由实体注册后自动建）：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | |
| no_key | varchar | 去重 key（业务幂等，unique） |
| user_id | uuid | 收件用户 |
| event_type | varchar | bid.won / escrow.paid / settlement.completed |
| channel | varchar | 'wechat' |
| payload | jsonb | 模板数据 |
| template_id | varchar | 对应模板 ID |
| status | varchar | pending / success / dead / skipped |
| attempts | int | 重试次数 |
| next_attempt_at | timestamptz | |
| last_error | varchar | |
| created_at | timestamptz | |

索引：`(status, next_attempt_at)`，唯一 `no_key`。

## 新增文件（backend/src/wechat/）

- `wechat-token.service.ts`：进程内缓存 access_token（`expires_in=7200s`，提前 120s 过期，单例互斥防并发刷新）；`getAccessToken()`、`getOpenIdByCode(code)`（snsapi_base：sns/oauth2/access_token）；appid/appsecret 未配置时短路并 skip；刷新失败指数退避。
- `wechat-template.service.ts`：`send({openid, templateId, data})` 调 `POST /cgi-bin/message/template/send`（用已缓存 access_token）；模板缺失/未启用返回 skip。
- `notification-outbox.entity.ts`：`@Entity('notification_outbox')`，字段如上。
- `notification-dispatcher.service.ts`：`enqueue({userId,eventType,templateId,payload})`（反查 openid 写 request、种 next_attempt_at=now）；`processDue(now)`：无 openid→skipped；成功→success；4xx（invalid openid/模板未配）→dead；网络/5xx→退避重试（复用 `contract/backoff.ts` 与 `MAX_WEBHOOK_ATTEMPTS`）后转 dead 并 logger.error。
- `notification-dispatcher.cron.ts`：`@Interval(10_000)` 调 `processDue`；env 开关 `WECHAT_NOTIFY_ENABLED==='false'` 或 appid 缺失短路。
- `notification-delivery.service.ts`：渠道抽象；暴露 `notifyBidWon/notifyEscrowPaid/notifySettlement`，内部由 workspaceId/order 反查 owner → enqueue（不 await 微信调用）。
- `wechat-bind.controller.ts`：`GET /api/v1/wechat/bind-url`（拼授权 URL）、`GET /api/v1/wechat/callback?code=`（AuthGuard 取 req.user.id，换 openid 写回 users）、`GET /api/v1/wechat/status`。
- `wechat.module.ts`：组装上述，`TypeOrmModule.forFeature([NotificationOutbox, User])`，export delivery/dispatcher。

## 修改文件

- `backend/src/users/entities/user.entity.ts`：加 `@Column({name:'wechat_openid', nullable:true}) wechatOpenid`。
- `backend/src/users/users.service.ts`：`getUserInfo` 返回 `wechatOpenid`（布尔态供前端展示绑定状态）。
- `backend/src/app.module.ts`：entities 注册 `NotificationOutbox`；imports 加 `WechatModule`。
- `backend/src/longtask/marketplace-bids/selection.service.ts`：注入 delivery；`selectBid` 建订单后（原 85 行附近）按 `bid.workspaceId` → owner enqueue `bid.won`。
- `backend/src/longtask/marketplace-orders/marketplace-orders.service.ts`：注入 delivery；`payWithBalance` 在 `repo.save(order)` 成功后按 `order.workspaceId` → owner enqueue `escrow.paid`。
- `backend/src/longtask/settlements/settlements.service.ts`：注入 delivery；`consumeSettlementCompleted` 在 `settleRepo.save(saved)` 后按 `workspace.ownerUserId` enqueue `settlement.completed`。

## 前端

- `frontend/src/pages/WechatBind.tsx`：绑定入口 + 回调落地页（读 URL `code` 调后端，展示绑定状态），路径 `/wechat-bind`。
- `frontend/src/pages/Profile.tsx`：用户区块新增"微信通知"卡片（已/未绑定，未绑定跳 `/wechat-bind`）。
- `frontend/src/App.tsx`：注册 `/wechat-bind` 路由（lazy import）。

## env 新增

```
WECHAT_APPID=
WECHAT_APPSECRET=
WECHAT_NOTIFY_ENABLED=true
WECHAT_BIND_REDIRECT_URI=https://<host>/wechat-bind
WECHAT_TMPL_BID_WON=           # 中标模板 ID，缺失跳过
WECHAT_TMPL_ESCROW=            # 支付到账模板 ID
WECHAT_TMPL_SETTLEMENT=        # 结算到账模板 ID
```

## 验证

1. `NODE_ENV=development` 且 `WECHAT_APPID` 缺失时：cron 空转不报错、不卡（短路测试）。
2. 配真实公众号凭证：登录后 GET `/api/v1/wechat/bind-url` → OAuth 授权 → 回调写 openid → GET `/me` 见 `wechatOpenid` 非空；`GET /api/v1/wechat/status` 返回已绑定。
3. 手工注入 openid 后依次触发 `selectBid` / `payWithBalance` / `consumeSettlementCompleted` → 查 `notification_outbox` status=success，公众号收到模板消息。
4. 用不存在 openid 验证 5 次退避后进 dead 且告警；模板 ID 留空跳过不重试。
5. 前端 `/wechat-bind` 完成绑定后"/me"显示"已绑定"。
6. 单元测试：`dispatcher.processDue` 的 success / skipped / dead / 退避 分支 + 三个触发点 enqueue 被调用。