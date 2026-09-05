<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

Genesis Marketplace 后端（NestJS）。除常规业务模块外，作为 **SSO 身份提供方（IdP）**，为子应用（Web、openclaw-cli、genesis-agent 等）提供统一认证。详见下方「SSO 统一认证」。

## Project setup

```bash
$ npm install
```

## 短信验证码配置

后端使用阿里云短信服务发送验证码，需要在服务端运行环境配置：

```dotenv
ALIBABA_CLOUD_ACCESS_KEY_ID=
ALIBABA_CLOUD_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=
ALIYUN_SMS_TEMPLATE_CODE=SMS_330310524
ALIYUN_SMS_REGION_ID=cn-hangzhou
ALIYUN_SMS_ENDPOINT=dysmsapi.aliyuncs.com
# 模板中的验证码变量名，默认 code
ALIYUN_SMS_TEMPLATE_PARAM_KEY=code
```

本地开发默认启用调试验证码 `121212`。生产环境默认禁用；也可通过
`SMS_DEBUG_CODE_ENABLED=true|false` 显式控制。AccessKey 变量不得添加 `VITE_`
前缀，否则可能被前端构建暴露。

## SSO 统一认证

Marketplace 作为中心用户体系（IdP），子应用通过精简 OAuth2 授权码模式接入。用户在 Marketplace 登录一次，即可在所有接入方通行；`user.id` 为全局唯一身份键。

### 认证流程（授权码 + PKCE）

```
子应用                          Marketplace (IdP)
  │ ① GET /api/v1/sso/authorize?client_id&redirect_uri&state&code_challenge
  │ ────────────────────────────────────────────────────────────►
  │ ◄── 302 → 前端 /sso/authorize 页面 ──────────────────────────
  │
  │ ② 前端授权页：已登录 → 直接 POST /sso/authorize 签发 code
  │              未登录 → /login?redirect=/sso/authorize?...（登录后自动续跳）
  │
  │ ◄── 302 redirect_uri?code=xxx&state=yyy ────────────────────
  │
  │ ③ POST /api/v1/sso/token { code, client_id, code_verifier | client_secret, redirect_uri }
  │ ────────────────────────────────────────────────────────────►
  │ ◄── { access_token, token_type: "Bearer", user: {...} } ────
  │
  │ ④ GET /api/v1/sso/userinfo  (Authorization: Bearer <access_token>)
```

### 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/v1/sso/authorize` | 无 | 浏览器入口。校验 `client_id`/`redirect_uri` 后 302 到前端 `/sso/authorize` 授权页 |
| POST | `/api/v1/sso/authorize` | Bearer 用户令牌 | 为已登录用户签发一次性授权码，返回 `{ code, state, redirect_uri }` |
| POST | `/api/v1/sso/token` | 无（client_secret / PKCE） | 授权码换 `access_token`，响应含用户信息 |
| GET | `/api/v1/sso/userinfo` | Bearer access_token | 返回 `{ id, phone, email, displayName, kycStatus }` |
| POST | `/api/v1/sso/logout` | Bearer access_token | 单点登出：不带 `client_id` 撤销该用户全部登录/SSO 令牌（PAT 保留）；带 `client_id` 仅撤销该接入方的令牌 |
| POST | `/api/v1/sso/clients` | 超级管理员 | 注册接入方（机密/公开客户端）。机密客户端的 `client_secret` 仅在创建响应中返回一次 |
| GET | `/api/v1/sso/clients` | 超级管理员 | 接入方列表 |

### 数据模型

- **`sso_clients`**（[sso-client.entity.ts](src/auth/entities/sso-client.entity.ts)）：接入方注册表。`client_secret_hash` 为 SHA-256（仅存哈希，机密客户端）；`redirect_uris` 存 JSON 数组白名单；`client_secret_hash` 为空即公开客户端（必须走 PKCE）
- **`sso_authorization_codes`**（[sso-authorization-code.entity.ts](src/auth/entities/sso-authorization-code.entity.ts)）：一次性授权码。仅存 SHA-256 哈希，绑定 `user_id`/`client_id`/`redirect_uri`/`code_challenge`，10 分钟过期，使用后立即作废
- **`access_tokens`**（[access-token.entity.ts](src/auth/entities/access-token.entity.ts)）：在原有基础上新增 `name`（PAT 名称）与 `client_id`（签发来源：SSO client_id / `'pat'` / 空 = 普通登录）列

Postgres 环境执行 `migrate.sql` 追加的 DDL；SQLite 开发库依赖 `DB_SYNC=true` 自动建表。

### 安全机制

- 授权码一次性 + 10 分钟 TTL，重放直接拒绝
- `redirect_uri` 与注册白名单精确匹配；回环地址（`127.0.0.1`/`localhost`/`::1`）允许任意端口（RFC 8252，本地回调场景）
- 公开客户端强制 PKCE（S256）；机密客户端校验 `client_secret`（timing-safe 比较）
- access_token 为 32 字节随机不透明令牌，仅存 SHA-256 哈希；撤销（`revoked_at`）即时生效，支持过期时间（`expires_at`）
- 子应用间不共享 token，各自独立会话

### 内置客户端

服务启动时（`SsoService.onModuleInit`）自动注册公开客户端 `openclaw-cli`（回环回调，仅 PKCE）。其他接入方由超级管理员通过 `POST /api/v1/sso/clients` 注册。

### 个人访问令牌（PAT）

无人值守场景（CI、genesis-agent 等）无需走浏览器流程，直接使用 PAT：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/users/pat` | 创建，body `{ name, expiresInDays? }`，token 仅本次返回 |
| GET | `/api/v1/users/pat` | 列表（仅元数据，不含 token 值） |
| DELETE | `/api/v1/users/pat/:id` | 撤销，立即失效 |
| POST | `/api/v1/users/logout` | 撤销当前 Bearer 令牌（单设备登出） |

PAT 权限与用户账号一致，前端管理入口在 **个人中心 → 安全设置 → 个人访问令牌**。genesis-agent 通过环境变量 `OWNER_TOKEN` / `MARKETPLACE_PAT` / `PAT` 使用。

过期的 SSO 授权码由每小时定时任务（[sso-code-cleanup.cron.ts](src/auth/sso-code-cleanup.cron.ts)）自动清理。

### 环境变量

```dotenv
# GET /sso/authorize 302 目标（前端地址），按顺序回退：
# SSO_WEB_URL > WEB_BASE_URL > PAYMENT_FRONTEND_BASE_URL > http://localhost:5173
SSO_WEB_URL=http://localhost:5173
```

### 子应用接入指引

- **Web 子应用**：引导用户跳转 `${API}/api/v1/sso/authorize?...`（PKCE），回调地址用 `code` 换 token
- **openclaw-cli**：`openclaw login` 命令已内置完整流程（本地回环回调 + PKCE），详见 [openclaw-cli/README.md](../openclaw-cli/README.md)
- **genesis-agent**：使用 PAT，详见 [genesis-agent/README.md](../genesis-agent/README.md)

前端侧实现：`/sso/authorize` 授权页（`frontend/src/pages/SsoAuthorize.tsx`）+ 登录页 `?redirect=` 链式续跳（`frontend/src/pages/UnifiedLogin.tsx`），已登录用户跳过登录表单直接完成授权。超管接入方管理页位于 `frontend/src/pages/AdminSsoClients.tsx`（`/admin/sso-clients`）。

### 测试

```bash
# 单元测试（SsoService / AuthService / 清理 cron，共 41 例）
$ npx jest src/auth/

# e2e 测试（临时 SQLite 起完整应用，覆盖授权码/登出/PAT/超管接口，共 12 例）
$ npx jest --config ./test/jest-e2e.json test/sso.e2e-spec.ts
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
