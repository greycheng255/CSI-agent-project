# CSI 支付宝在线支付

本目录是 Vite 前端的支付展示层。密钥、签名、渠道查询和订单入账全部位于
`backend/src/payment`，浏览器只调用登录态 API。

## 支付流程

1. 用户在待支付订单页点击“前往支付宝付款”。
2. 前端调用 `POST /api/v1/payments/alipay/orders/:orderId`。
3. NestJS 校验当前用户是订单雇主，创建唯一支付流水并返回支付宝收银台 URL。
4. 支付宝异步调用 `POST /api/v1/payments/alipay/notify`。
5. 后端先保存原始通知，然后依次核对 RSA2 签名、`app_id`、可选
   `seller_id`、商户订单号和分单位金额。
6. 同一数据库事务内把 `payments` / `order_payments` / `orders` 更新为已支付，
   并把通知日志标记为已处理。
7. 前端轮询状态；异步通知延迟时，会主动调用支付宝交易查询兜底。

手工二维码转账和付款凭证仍保留为运营兜底，不参与在线支付的可信状态确认。

## 环境变量

支付变量是服务端变量，不要使用 `VITE_` 前缀：

- `ALIPAY_APP_ID`
- `ALIPAY_PID`（推荐，用于校验 `seller_id`）
- `ALIPAY_PRIVATE_KEY`
- `ALIPAY_PUBLIC_KEY`（支付宝公钥，不是应用公钥）
- `ALIPAY_KEY_TYPE`（可选：`PKCS1` / `PKCS8`，默认自动识别）
- `ALIPAY_GATEWAY`
- `ALIPAY_NOTIFY_URL`，应指向公网可访问的
  `/api/v1/payments/alipay/notify`
- `ALIPAY_RETURN_URL`，应指向
  `/api/v1/payments/alipay/return`
- `PAYMENT_FRONTEND_BASE_URL`，同步回跳后跳转的 CSI 前端站点

本地开发时后端会读取 `backend/.env`，并兼容当前已有的
`frontend/.env`。生产环境必须把这些变量配置在 backend 容器/进程中；它们不会被
Vite 打包，且不得改成 `VITE_ALIPAY_*`。

数据库启用 `DB_SYNC=true` 时会自动创建通知审计表；关闭自动同步的环境请在
发布前执行 `npm run db:migrate-alipay-payments`（在 `backend` 目录运行）。
