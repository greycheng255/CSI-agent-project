# Console 接入 Marketplace SSO（OIDC）对接指南

> **版本**：v1.0（2026-09-09 首版，对齐平台 §3.4 AuthPort CSIAdapter 的 IDP SSO 能力）
> **受众**：Agent Owner Console 团队（Console 前后端 / AuthPort 实现者）
> **维护方**：Marketplace 平台基础设施团队（IdP 侧）
> **本文性质**：Console 作为 RP（Relying Party，OIDC 接入方）接入 Marketplace 作为 IdP（Identity Provider）的单点登录对接规范。逐端点 payload 与本文冲突时，以代码实现为准；本文与 TS §3.4 Port 表冲突时以 TS 为准。

---

## 0. 阅读指引

### 0.1 本文回答三个问题

1. Console 要登入 Marketplace 账号体系，应该走什么流程（§2、§3）
2. 拿到 id_token 后如何验签、如何用 `org_id` claim 建立本地登录态（§4、§5）
3. 对接前的准备、灰度策略、回退路径（§6、§7）

### 0.2 角色与术语

| 术语 | 在本文中的角色 |
|------|---------------|
| IdP（Identity Provider） | Marketplace 后端，签发 id_token 的平台 IDP |
| RP（Relying Party） | Console，消费 id_token 建立登录态的接入方 |
| AuthPort | Console 的六边形端口（§3.4），CSIAdapter 走本流程，LocalAdapter 为开发兜底 |
| client_id | Console 在 IdP 注册的接入方标识 |
| redirect_uri | Console 处理 IdP 回调的端点 |
| org_id | 统一账户体系的计费主体键（§3.7.3），id_token 必备 claim |
| PKCE | RFC 7636，公开客户端防授权码劫持 |

### 0.3 设计原则

- **OIDC 授权码 + PKCE**：Console 是公开客户端（前端 SPA + 后端代理），必须使用 PKCE，不依赖 client_secret
- **HS256 对称签名**：平台与 Console 同属 CSI 内部信任域，共享 `SSO_OIDC_SIGNING_SECRET`；不暴露 `jwks_uri`
- **org_id 两条路径同源**：登录态 claim（id_token.org_id）首选，解析 API（`GET /orgs/me`）兜底
- **零配置开发可用**：Console 在本地开发环境可继续用 LocalAdapter；CSIAdapter 仅在配置了 IdP issuer 后激活

---

## 1. 接入前置条件

### 1.1 向 Marketplace 平台运营申请

| 项目 | 说明 | 由谁提供 |
|------|------|---------|
| `client_id` | Console 的接入方标识（如 `agent-owner-console`） | Marketplace 平台运营（超管后台注册） |
| `redirect_uris` | Console 回调白名单（生产 / 预发 / 本地） | Console 团队提交，平台审核 |
| `confidential` | `false`（公开客户端，仅 PKCE） | Console 声明 |
| `SSO_OIDC_SIGNING_SECRET` | HS256 共享签名密钥（与 IdP 同一密钥才能验签 id_token） | 平台运营线下分发，不入 Git |
| `SSO_OIDC_ISSUER` | IdP issuer，如 `https://idp.csi.example.com` | 平台运营 |

**注册接口**（仅超管可用，详见 [sso.controller.ts](file:///workspace/backend/src/auth/sso.controller.ts) `POST /api/v1/sso/clients`）：

```bash
curl -X POST ${MARKETPLACE_API}/api/v1/sso/clients \
  -H "Authorization: Bearer ${SUPER_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "agent-owner-console",
    "name": "Agent Owner Console",
    "redirectUris": [
      "https://console.csi.example.com/auth/callback",
      "http://localhost:5174/auth/callback"
    ],
    "confidential": false
  }'
```

> ⚠️ 公开客户端（`confidential=false`）不会签发 `client_secret`，全部靠 PKCE 保护。请勿把 Console 注册为机密客户端。

### 1.2 Console 侧配置

在 Console 后端环境变量中（对应 `AuthPort` 的 CSIAdapter 配置）：

```dotenv
# 启用 CSIAdapter（替换 LocalAdapter）
AUTH_PORT_ADAPTER=csi

# IdP 元数据
SSO_OIDC_ISSUER=https://idp.csi.example.com
SSO_OIDC_CLIENT_ID=agent-owner-console
SSO_OIDC_REDIRECT_URI=https://console.csi.example.com/auth/callback

# HS256 共享密钥（与 IdP 同一密钥）
SSO_OIDC_SIGNING_SECRET=<由平台运营线下分发>

# 可选：手动覆盖 discovery 文档（一般留空，走自动发现）
# SSO_OIDC_DISCOVERY_OVERRIDE=
```

---

## 2. OIDC 流程总览

```
┌──────────┐                ┌─────────────┐              ┌──────────┐
│ Console  │                │ IdP(Market  │              │ Console  │
│ 浏览器   │                │  place)     │              │ 后端     │
└────┬─────┘                └──────┬──────┘              └────┬─────┘
     │                             │                          │
     │ 1. 跳转 authorize（带 PKCE challenge + scope=openid + nonce） │
     ├────────────────────────────►│                          │
     │                             │                          │
     │ 2. 302 到 Console 已登录？未登录→登录页（marketplace 内）│
     │◄────────────────────────────┤                          │
     │                             │                          │
     │ 3. 已登录用户授权，签发授权码（POST /sso/authorize）    │
     │────────────────────────────────────────────────────────►│
     │                             │                          │
     │ 4. 携带 code + state 回跳 redirect_uri                  │
     │◄─────────────────────────────────────────────────────────┤
     │                             │                          │
     │ 5. 用 code + verifier 换 token（含 id_token）            │
     │─────────────────────────────────────────────────────────►│
     │                             │                          │
     │ 6. Console 后端验签 id_token，提取 org_id，建登录态       │
     │                             │                          │
     │ 7. Set-Cookie / 跳回 Console 业务页                     │
     │◄────────────────────────────────────────────────────────┤
```

### 2.1 关键约束

| 约束 | 值 |
|------|---|
| `response_type` | `code`（仅支持授权码） |
| `grant_type` | `authorization_code` |
| `code_challenge_method` | `S256`（仅支持 S256） |
| `scope` | `openid profile`（含 `openid` 才签发 id_token） |
| `id_token` 算法 | `HS256` |
| `id_token` TTL | 1h（短时令牌，Console 校验后建立本地登录态） |
| 授权码 TTL | 10 分钟，一次性 |

---

## 3. 逐端点契约

> 完整源码：[oidc.service.ts](file:///workspace/backend/src/auth/oidc.service.ts) / [sso.controller.ts](file:///workspace/backend/src/auth/sso.controller.ts)

### 3.1 OIDC Discovery

```
GET ${SSO_OIDC_ISSUER}/.well-known/openid-configuration
```

**用途**：CSIAdapter 启动时拉取，自动发现 authorize / token / userinfo 端点与签名算法。

**响应示例**：

```json
{
  "issuer": "https://idp.csi.example.com",
  "authorization_endpoint": "https://idp.csi.example.com/api/v1/sso/authorize",
  "token_endpoint": "https://idp.csi.example.com/api/v1/sso/token",
  "userinfo_endpoint": "https://idp.csi.example.com/api/v1/sso/userinfo",
  "end_session_endpoint": "https://idp.csi.example.com/api/v1/sso/logout",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "subject_types_supported": ["public"],
  "scopes_supported": ["openid", "profile", "email"],
  "id_token_signing_alg_values_supported": ["HS256"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "none"],
  "code_challenge_methods_supported": ["S256"],
  "claims_supported": ["sub", "name", "email", "phone", "org_id", "org_slug", "nonce"]
}
```

> ⚠️ HS256 对称签名：discovery **不暴露 `jwks_uri`**。Console 必须用 `SSO_OIDC_SIGNING_SECRET` 本地验签，**不要去找 jwks_uri**。

### 3.2 第 1 步：浏览器跳转 authorize（GET）

```
GET ${SSO_OIDC_ISSUER}/api/v1/sso/authorize?
    client_id=agent-owner-console
    &redirect_uri=https://console.csi.example.com/auth/callback
    &response_type=code
    &scope=openid%20profile
    &state=<随机字符串>
    &nonce=<随机字符串>
    &code_challenge=<S256(verifier)>
    &code_challenge_method=S256
```

**IdP 行为**：校验 `client_id` / `redirect_uri` 白名单通过后，**302 跳到 Marketplace 前端授权页**（`SSO_WEB_URL/sso/authorize`），透传所有参数。

- 未登录：前端授权页跳 Marketplace 登录页，登录后回跳本页继续授权
- 已登录：前端授权页用 Bearer 调 `POST /api/v1/sso/authorize` 签发授权码，再跳回 Console `redirect_uri`

**Console 浏览器侧生成 verifier / challenge**（必须）：

```typescript
// 生成 PKCE verifier（≥43 字符，推荐 48 字节 base64url）
const verifier = crypto.getRandomValues(new Uint8Array(48));
const verifierStr = base64url(verifier);

// challenge = BASE64URL(SHA256(verifier))
const hashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifierStr));
const challenge = base64url(hashBytes);

// state / nonce 各自随机生成
const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));

// 把 verifier / state / nonce 存 sessionStorage，回调时取出
sessionStorage.setItem('pkce_verifier', verifierStr);
sessionStorage.setItem('oidc_state', state);
sessionStorage.setItem('oidc_nonce', nonce);
```

### 3.3 第 2 步：Console 回调端点接收 code

IdP 把浏览器带回 Console 的 `redirect_uri`：

```
GET https://console.csi.example.com/auth/callback?
    code=<授权码>
    &state=<原样回传>
```

**Console 必校验**：
- `state` 与 sessionStorage 中的一致（防 CSRF）
- 取出 `pkce_verifier`、`oidc_nonce`，进入第 3 步

### 3.4 第 3 步：换 token（POST /sso/token）

```
POST ${SSO_OIDC_ISSUER}/api/v1/sso/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "<上一步的 code>",
  "client_id": "agent-owner-console",
  "redirect_uri": "https://console.csi.example.com/auth/callback",
  "code_verifier": "<第 1 步生成的 verifier>"
}
```

**成功响应**（HTTP 201）：

```json
{
  "access_token": "<Marketplace 用户令牌>",
  "token_type": "Bearer",
  "expires_in": null,
  "scope": "openid profile",
  "id_token": "<HS256 JWT，含 org_id claim>",
  "user": {
    "id": "uuid",
    "phone": "138****0000",
    "email": null,
    "displayName": "示例",
    "kycStatus": "NONE"
  }
}
```

> Console 作为 RP，**主要消费 `id_token`**；`access_token` 仅用于调 userinfo 兜底（§5.2），不要把它当作 Console 自身的会话凭证。Console 应基于验签通过的 `id_token` 建立自己的会话（Cookie / JWT）。

### 3.5 id_token 结构与验签

**id_token 是 HS256 JWT**，三段式 `header.payload.signature`。

#### 3.5.1 标准 claim

| claim | 说明 |
|-------|------|
| `iss` | IdP issuer，等于 `${SSO_OIDC_ISSUER}` |
| `sub` | Marketplace 用户 ID（Console 端以此关联本地用户影子） |
| `aud` | `client_id`（Console 校验 aud 必须等于自己） |
| `exp` | 过期时间（unix 秒）；TTL 1h |
| `iat` | 签发时间 |
| `nonce` | 第 1 步传入的 nonce，原样回填；Console **必须**校验一致 |

#### 3.5.2 scope → claim 映射

| scope 触发 | 写入的 claim |
|-----------|-------------|
| `openid` | 触发 id_token 签发本身 |
| `profile` | `name`（来自 `displayName`） |
| `email` | `email` |

#### 3.5.3 平台自定义 claim（内部信任域）

| claim | 说明 | 何时写入 |
|-------|------|---------|
| `phone` | Marketplace 账号手机号 | 始终写入（可能为 null） |
| `org_id` | 统一账户体系计费主体键（§3.7.3 不透明键） | OrgService 解析到 org 时写入 |
| `org_slug` | org 的 slug（人类可读） | 同上 |

> ⚠️ 若用户尚未绑定 org（极少见，注册时自动绑定），`org_id` 会缺省。Console 应走 §5.2 兜底解析。

#### 3.5.4 Console 侧验签示意（TypeScript）

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function verifyIdToken(idToken: string, expected: {
  issuer: string;
  clientId: string;
  nonce: string;
}): Record<string, unknown> | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  // 1. 用同一 SSO_OIDC_SIGNING_SECRET 复算 HS256 签名
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', process.env.SSO_OIDC_SIGNING_SECRET!)
    .update(signingInput)
    .digest('base64url');
  const sigBuf = Buffer.from(sigB64);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null; // 签名不匹配
  }

  // 2. 解析 payload 并校验 claim
  const payload = JSON.parse(
    Buffer.from(payloadB64, 'base64url').toString('utf8'),
  );
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== expected.issuer) return null;
  if (payload.aud !== expected.clientId) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (payload.nonce !== expected.nonce) return null; // 防 CSRF/重放
  return payload;
}
```

> ⚠️ Console 务必校验 `nonce` 一致，否则无法防御授权码注入。`state` 在第 2 步浏览器侧校验，`nonce` 在第 3.5 步后端校验，两者职责不同。

---

## 4. 建立本地登录态

验签通过后，Console 后端应基于 `id_token.sub` + `org_id` 建立本地会话：

### 4.1 用户影子同步

- `sub`（Marketplace user_id）作为 Console 本地用户表的外部键
- 首次登录：在 Console 本地创建影子用户记录（`external_user_id` = `sub`）
- 后续登录：按 `external_user_id` 关联，刷新登录态

### 4.2 org_id 消费口径（§3.7.3 不透明计费主体键）

- Console 内部所有"按组织计费/限流/配额"的判断，统一以 `org_id` 作为不透明键
- **不要**对 `org_id` 做结构假设（不解析、不拼接、不试图反查 Marketplace）
- `org_id` 缺省时（用户未绑定 org，理论不会发生）→ 走 §5.2 兜底

### 4.3 Console 本地会话签发

Console 后端用自己的密钥签发会话 JWT / Cookie（**不复用 id_token** 作为会话凭证，id_token TTL 仅 1h）：

```typescript
// 示意：Console 签发自己的会话 JWT
const sessionJwt = sign(
  {
    sub: idToken.sub,
    org_id: idToken.org_id,
    ext_user_id: idToken.sub,
    iss: 'console',
    exp: Math.floor(Date.now() / 1000) + 8 * 3600, // Console 自己定 TTL
  },
  process.env.CONSOLE_SESSION_SECRET!,
  { algorithm: 'HS256' },
);
res.cookie('console_session', sessionJwt, {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 8 * 3600 * 1000,
});
```

---

## 5. org_id 解析兜底（解析 API）

### 5.1 优先级

| 优先级 | 来源 | 何时使用 |
|--------|------|---------|
| 1 | id_token.org_id claim（OIDC 登录态） | 正常 SSO 登录路径 |
| 2 | `GET /api/v1/orgs/me`（用户自助） | id_token 缺 org_id / Console 后续刷新 |
| 3 | `GET /api/v1/orgs/resolve?user_id=xxx`（管理员兜底） | Console 后台任务无登录态（需超管 token） |

### 5.2 GET /api/v1/orgs/me（用户自助）

```
GET ${SSO_OIDC_ISSUER}/api/v1/orgs/me
Authorization: Bearer <access_token（第 3 步获得）>
```

**响应**（HTTP 200）：

```json
{
  "org_id": "uuid",
  "slug": "org-abc12345",
  "name": "示例组织",
  "owner_user_id": "uuid",
  "created_at": "2026-09-09T07:00:00.000Z"
}
```

> Console 本地会话过期时若需刷新 `org_id`，**优先**用此端点（用户登录态仍在即可调）；不要每次请求都调，应在 id_token 验签时一次性拿到并缓存。

### 5.3 GET /api/v1/orgs/resolve（管理员兜底）

```
GET ${SSO_OIDC_ISSUER}/api/v1/orgs/resolve?user_id=<uuid>
Authorization: Bearer <SUPER_ADMIN_TOKEN>
```

**用途**：Console 后台批处理任务（无用户登录态）需要按 `user_id` 反查 `org_id` 时使用。需要 Marketplace 超管令牌，**不在前端调用**。

---

## 6. 登出（单点登出）

```
POST ${SSO_OIDC_ISSUER}/api/v1/sso/logout
Authorization: Bearer <access_token>
Content-Type: application/json

{}  // 不带 client_id：撤销该用户全部登录/SSO 令牌（全端失效）
```

或定向登出（仅撤销指定接入方令牌）：

```json
{ "client_id": "agent-owner-console" }
```

**Console 行为**：
1. 清除本地 session Cookie / JWT
2. 调 IdP `/sso/logout`（无 `client_id` 全局登出 / 带 `client_id` 单应用登出）
3. 跳回 Marketplace 登录页或 Console 登录入口

---

## 7. 灰度与回退

### 7.1 灰度策略（与 §3.4 一致，可独立灰度）

| 阶段 | Console 配置 | 行为 |
|------|--------------|------|
| 当前（公测前） | `AUTH_PORT_ADAPTER=local` | 走 LocalAdapter，登录入口隐藏跨版块跳转 |
| 灰度 | `AUTH_PORT_ADAPTER=csi` + 完整 IdP 配置 | 走 OIDC，按用户/租户灰度开关决定是否启用 |
| 全量 | 同上 | 默认 OIDC，LocalAdapter 仅作降级 |

### 7.2 回退路径

- IdP 不可达 / discovery 拉取失败：CSIAdapter 自动回退 LocalAdapter（Console 配置 `AUTH_PORT_FALLBACK=local`）
- id_token 验签失败 / `nonce` 不匹配：拒绝登录，引导用户重走授权流程，**不降级到无验签**
- `org_id` 缺失：登录仍可成功，但 Console 业务层应阻止计费相关操作直至 §5.2 兜底拿到 `org_id`

---

## 8. 常见问题

### Q1：为什么用 HS256 而不是 RS256？

平台与 Console 同属 CSI 内部信任域。HS256 对称签名避免 jwks 公私钥管理与密钥轮转复杂度，Console 仅需配置同一 `SSO_OIDC_SIGNING_SECRET` 即可验签。若未来出现跨信任域接入（外部合作伙伴），平台会另开 RS256 + `jwks_uri` 接入面，不影响本流程。

### Q2：access_token 和 id_token 有什么区别？

- `id_token`：**给 Console 验身份用**（RP 消费），含 `sub/org_id/nonce` 等 claim，TTL 1h
- `access_token`：**给 Console 调 Marketplace API 用**（如 userinfo 兜底），是 Marketplace 用户令牌，不要当 Console 会话凭证

Console 应基于验签通过的 `id_token` 建立自己的会话，不要把 `access_token` 直接塞 Cookie 当会话。

### Q3：Console 前端是 SPA，能纯前端完成 OIDC 流程吗？

**不建议**。`code_verifier` 与 `nonce` 必须在浏览器生成并存 sessionStorage，但 `id_token` 验签必须用 `SSO_OIDC_SIGNING_SECRET`（**密钥绝不能下发到前端**）。推荐架构：

- 浏览器生成 verifier/nonce/state → 跳 IdP
- IdP 回跳 Console `/auth/callback`（前端路由）
- 前端把 `code + verifier + nonce` POST 给 Console 后端 `/api/auth/exchange`
- Console 后端调 IdP `/sso/token`、验签 id_token、签发 Console 自己的 session Cookie
- 后端 302 回业务页

### Q4：用户在 Marketplace 已登录，Console 还要再登录一次吗？

不需要。IdP 检测到 Marketplace 登录态后会自动签发授权码（前端授权页对已登录用户是"透明"的，仅显示一次"正在授权…"），用户体验接近"免登跳转"。

### Q5：跨版块免登链接（§3.4 第 5 项 CrossModuleLinkPort）和 SSO 是一回事吗？

不是。SSO 解决"Console 用 Marketplace 账号登录"；CrossModuleLinkPort 解决"雇主从 Marketplace 已登录态跳到 Console 项目页等深链时的一次性免登"。CrossModuleLinkPort 依赖 SSO 已建立，是更上层的"深链 token 一次性 sid"机制。本流程只覆盖 SSO；CrossModuleLinkPort 待平台能力就绪后单独对接。

---

## 9. 联调清单

对接前请逐项确认：

- [ ] 已向平台运营申请 `client_id` 与 `SSO_OIDC_SIGNING_SECRET`
- [ ] Console 后端可访问 `${SSO_OIDC_ISSUER}/.well-known/openid-configuration`，返回 issuer 与配置一致
- [ ] Console 前端能生成合规 PKCE（verifier ≥43 字符，challenge = BASE64URL(SHA256(verifier))）
- [ ] Console 后端 `id_token` 验签通过（同一 `SSO_OIDC_SIGNING_SECRET`）
- [ ] `nonce` / `state` / `aud` / `iss` / `exp` 全部校验
- [ ] `org_id` claim 可从 id_token 拿到；拿不到时走 `GET /orgs/me` 兜底成功
- [ ] Console 本地会话签发后，前端 Cookie 设置 `httpOnly + secure + sameSite=lax`
- [ ] 登出 `/sso/logout` 调用成功，Console 本地 session 同步清除
- [ ] 灰度开关 `AUTH_PORT_ADAPTER=local|csi` 可热切换
- [ ] IdP 故障时回退 LocalAdapter 路径验证通过

---

## 10. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-09-09 | 首版：覆盖 OIDC 授权码 + PKCE + HS256 + org_id claim + 解析 API 兜底 + 灰度/回退 |
