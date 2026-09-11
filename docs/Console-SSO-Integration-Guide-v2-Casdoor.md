# Console 接入 Casdoor SSO（OIDC）对接指南

> **版本**:v2.0(2026-09-11,SSO IdP 已从 Marketplace 自研端点迁移至 Casdoor,本文**完全取代** v1.0)
> **受众**:Agent Owner Console 团队(AuthPort CSIAdapter 实现者)
> **维护方**:Marketplace 平台基础设施团队
> **本文性质**:Console 作为 RP(Relying Party)接入 Casdoor(统一 IdP)的单点登录对接规范。所有端点与 claim 均经过**真实授权码流程实测**(2026-09-11)。

---

## ⚠️ v1 → v2 破坏性变更(先读这个)

v1.0 文档描述的 Marketplace 自研 SSO 端点**已于 2026-09-11 全部下线**(`404`),对接方式发生结构性变化:

| 项目 | v1.0(已废弃) | v2.0(当前) |
|---|---|---|
| IdP | Marketplace 后端自研 | **Casdoor** `http://122.51.51.177:28000` |
| authorize | `/api/v1/sso/authorize` ❌ | `/login/oauth/authorize` |
| token | `/api/v1/sso/token`(JSON body)❌ | `/api/login/oauth/access_token`(**form-urlencoded**) |
| userinfo | `/api/v1/sso/userinfo` ❌ | `/api/userinfo`(注意:**不再返回 org_id**) |
| 登出 | `/api/v1/sso/logout` ❌ | `/api/logout` |
| org 解析 | `GET /api/v1/orgs/me`、`/api/v1/orgs/resolve` ❌ | **已下线**,org_id 只从 token claim 取 |
| id_token 签名 | HS256(共享 `SSO_OIDC_SIGNING_SECRET`)❌ | **RS256**(公钥从 `/.well-known/jwks` 获取,**无需共享密钥**) |
| org_id claim 位置 | id_token 顶层 `org_id` ❌ | **id_token(及 access_token)内嵌 `properties.org_id`**(嵌套对象) |
| `sub` 语义 | Marketplace user_id ❌ | **Casdoor 用户 id**;关联平台用户请用 `properties.genesis_user_id` |
| 客户端类型 | 公开客户端(纯 PKCE)❌ | **机密客户端**(client_id + client_secret;PKCE 可叠加) |

---

## 1. 接入参数(已配置完成,无需申请)

### 1.1 IdP 元数据

| 项目 | 值 |
|---|---|
| Issuer | `http://122.51.51.177:28000` |
| Discovery | `http://122.51.51.177:28000/.well-known/openid-configuration` |
| JWKS(验签公钥) | `http://122.51.51.177:28000/.well-known/jwks` |
| 授权端点 | `http://122.51.51.177:28000/login/oauth/authorize` |
| Token 端点 | `http://122.51.51.177:28000/api/login/oauth/access_token` |
| Userinfo 端点 | `http://122.51.51.177:28000/api/userinfo` |
| 登出端点 | `http://122.51.51.177:28000/api/logout` |
| 签名算法 | **RS256**(discovery 中 `id_token_signing_alg_values_supported` 首选) |

### 1.2 Console 应用凭据(Casdoor 应用 `genesis-console`)

| 项目 | 值 |
|---|---|
| `client_id` | `8558111a9d4e85b7a17e` |
| `client_secret` | `jpAjj5Cgr-bh53s8JJ5XCW2BO8qh8gza` |
| `redirect_uri`(白名单) | `http://www.csi.shopping/callback`、`https://www.csi.shopping/callback`(精确匹配;如需预发/本地等额外环境回调,联系平台追加) |
| 允许的 grant | `authorization_code`、`refresh_token` |
| scope | `openid profile email` |
| 用户组织 | `csi` |

### 1.3 用户账号口径

- Casdoor 用户 `name` = **平台手机号**;97 个存量用户已全量导入,初始密码 `Csi#2026Genesis`(bcrypt 存储,要求用户首登改密)
- 平台新注册用户**自动增量同步**至 Casdoor(注册后即时可见)
- `sub`(Casdoor 用户 id)≠ 平台 user_id;平台用户主键在 `properties.genesis_user_id`

### 1.4 Console 侧配置建议

```dotenv
# 启用 CSIAdapter(替换 LocalAdapter)
AUTH_PORT_ADAPTER=csi

# IdP 元数据(discovery 自动发现)
SSO_OIDC_ISSUER=http://122.51.51.177:28000
SSO_OIDC_CLIENT_ID=8558111a9d4e85b7a17e
SSO_OIDC_CLIENT_SECRET=jpAjj5Cgr-bh53s8JJ5XCW2BO8qh8gza
SSO_OIDC_REDIRECT_URI=http://www.csi.shopping/callback
```

> v1 的 `SSO_OIDC_SIGNING_SECRET` 配置项**作废**,改为从 JWKS 端点取 RS256 公钥验签。

---

## 2. OIDC 流程总览(已实测打通)

```
┌──────────┐                    ┌──────────────┐                ┌──────────┐
│ Console  │                    │ Casdoor(IdP) │                │ Console  │
│ 浏览器   │                    │ 28000        │                │ 后端     │
└────┬─────┘                    └──────┬───────┘                └────┬─────┘
     │ 1. 跳转 authorize(code + state,机密客户端可选 PKCE)         │
     ├────────────────────────────────►│                             │
     │ 2. Casdoor 登录页(应用上下文自动带出)                         │
     │◄────────────────────────────────┤                             │
     │ 3. 用户输账号密码(csi 组织用户)登录并授权                     │
     │                                 │                             │
     │ 4. 302 回 redirect_uri?code=xxx&state=xxx                     │
     │◄────────────────────────────────┤                             │
     │ 5. POST code 换 token(form-urlencoded)                      │
     │ ├────────────────────────────────────────────────────────────►│
     │                                 │      6. 验签 id_token(RS256)│
     │                                 │      提取 properties.org_id  │
     │ 7. Console 签发自己的会话 Cookie/JWT                          │
     │◄──────────────────────────────────────────────────────────────┤
```

### 2.1 关键约束(实测)

| 约束 | 值 |
|---|---|
| `response_type` | `code` |
| `grant_type` | `authorization_code`(不支持 password/device 等,已关闭) |
| PKCE | 支持 `S256`(机密客户端可选用,叠加更安全) |
| scope | `openid profile email` |
| id_token 算法 | **RS256** |
| token TTL | **7 天(604800s)**;Console 应自建短时会话,不要把 7 天令牌直接当登录态 |
| 授权码 | 一次性,短时效 |
| redirect_uri | **精确匹配**白名单(协议/域名/路径完全一致) |

---

## 3. 逐端点契约(实测值)

### 3.1 OIDC Discovery

```
GET http://122.51.51.177:28000/.well-known/openid-configuration
```

CSIAdapter 启动时拉取即可,无需硬编码端点。要点:

- `token_endpoint_auth_methods_supported`:机密客户端用 `client_secret_post`(form 中带 client_id/client_secret)
- `code_challenge_methods_supported`: `["S256"]`
- `end_session_endpoint`: `/api/logout`

### 3.2 第 1 步:浏览器跳转 authorize

```
GET http://122.51.51.177:28000/login/oauth/authorize?
    client_id=8558111a9d4e85b7a17e
    &redirect_uri=http%3A%2F%2Fwww.csi.shopping%2Fcallback
    &response_type=code
    &scope=openid%20profile%20email
    &state=<随机字符串>
```

浏览器侧生成并保存:

```typescript
const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
sessionStorage.setItem('oidc_state', state);
// 若启用 PKCE,另生成 verifier/challenge 并保存 verifier
```

> 未登录用户会看到 Casdoor 登录页(应用上下文自动带出,标题显示 "CSI Genesis Console");已登录用户静默放行。**不要**用 `/login/<应用名>` 直链(Casdoor 会把单段路径当组织名)。

### 3.3 第 2 步:回调端点接收 code

```
GET http://www.csi.shopping/callback?code=<授权码>&state=<原样回传>
```

Console 必校验:`state` 与 sessionStorage 一致(防 CSRF)。

### 3.4 第 3 步:换 token(**form-urlencoded,不是 JSON**)

```
POST http://122.51.51.177:28000/api/login/oauth/access_token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id=8558111a9d4e85b7a17e
&client_secret=jpAjj5Cgr-bh53s8JJ5XCW2BO8qh8gza
&code=<上一步的 code>
&redirect_uri=http://www.csi.shopping/callback
```

**成功响应**(HTTP 200):

```json
{
  "access_token": "<RS256 JWT>",
  "expires_in": 604800,
  "refresh_token": "<刷新令牌>",
  "token_type": "Bearer",
  "scope": "openid profile email"
}
```

### 3.5 id_token 结构与验签(RS256)

解码 id_token payload(**实测样例**):

```json
{
  "iss": "http://122.51.51.177:28000",
  "sub": "b169c740-73af-483d-845e-4eacd0aec4d1",      // Casdoor 用户 id(≠平台 user_id)
  "aud": ["8558111a9d4e85b7a17e"],                     // 数组,含你的 client_id
  "iat": 1789115710,
  "exp": 1789719710,                                    // TTL 7 天
  "name": "13911110000",
  "displayName": "示例用户",
  "email": "xxx@noop.csi.shopping",
  "phone": "",
  "properties": {                                       // ★ 计费口径在这里
    "org_id": "8b3381fd-ef45-4d4c-a4ad-a1b630f7f5f0",
    "genesis_user_id": "1f876d2c-e4c8-4abb-ae97-bd3321be9c55",
    "genesis_phone": "13911110000"
  }
}
```

**Console 侧验签(jwks RS256)**:

```typescript
// 推荐 jose 库
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(new URL('http://122.51.51.177:28000/.well-known/jwks'));

const { payload } = await jwtVerify(idToken, JWKS, {
  issuer: 'http://122.51.51.177:28000',
  audience: '8558111a9d4e85b7a17e',
  algorithms: ['RS256'],
});
// payload.properties.org_id 即计费主体键
```

必校验:`iss` / `aud`(含 client_id)/ `exp`。v1 的 `nonce` 校验在 Casdoor 标准流程中不强制,若启用 PKCE 则防重放由 PKCE 承担。

### 3.6 org_id 消费口径(**与 v1 的重大差异**)

- 计费主体键 = **`id_token.properties.org_id`**(嵌套 claim,顶层 `org_id` 不存在)
- **`GET /api/userinfo` 不返回 properties**——只有标准 claims(`sub/name/preferred_username/email`),因此 **org_id 只能在 token 验签时一次性取出并缓存**,不存在 userinfo 兜底路径(v1 §5.2 作废)
- `properties.genesis_user_id` 用于把 Casdoor 账号关联回平台 users 表主键
- Console 侧不要对 `org_id` 做结构假设(不透明键,口径不变)
- org_id 缺失(理论上不会发生,平台注册即分配)→ 拒绝计费相关操作,引导重新登录

### 3.7 刷新令牌

```
POST /api/login/oauth/access_token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&client_id=8558111a9d4e85b7a17e
&client_secret=jpAjj5Cgr-bh53s8JJ5XCW2BO8qh8gza
&refresh_token=<之前获得的 refresh_token>
```

---

## 4. 建立本地登录态(与 v1 一致,微调)

1. `sub`(Casdoor id)作为 Console 本地影子用户的外部键;**如需回链平台用户,映射 `properties.genesis_user_id`**
2. 所有按组织计费/限流/配额的判断以 `id_token.properties.org_id` 为不透明键
3. Console 用自己的密钥签发会话 JWT/Cookie(**不要复用 id_token 当会话**,其 TTL 长达 7 天且含敏感用户字段)

---

## 5. 登出

```
GET http://122.51.51.177:28000/api/logout
   (?id_token_hint=<id_token>&post_logout_redirect_uri=<回跳地址>)
```

Console 行为:
1. 清除本地 session
2. 跳转 Casdoor logout 端点(可带 `post_logout_redirect_uri` 回跳)
3. 回到 Console 登录入口

> v1 的 `POST /api/v1/sso/logout`(带 client_id 定向撤销)已下线。

---

## 6. 回退与灰度

| 阶段 | Console 配置 | 行为 |
|---|---|---|
| 当前(公测前) | `AUTH_PORT_ADAPTER=local` | LocalAdapter,不露出 SSO 入口 |
| 灰度 | `AUTH_PORT_ADAPTER=csi` + Casdoor 配置 | OIDC 登录按灰度开关放量 |
| 全量 | 同上 | 默认 OIDC,LocalAdapter 仅降级 |

- Casdoor 不可达 / discovery 失败 → CSIAdapter 回退 LocalAdapter
- 验签失败 → 拒绝登录,重走授权流程,**不降级到无验签**
- `properties.org_id` 缺失 → 拒绝计费操作,引导重登

---

## 7. 联调清单(逐项确认)

- [ ] discovery 可拉取且 `issuer` 与配置一致
- [ ] 授权跳转后 Casdoor 登录页显示应用名 "CSI Genesis Console"
- [ ] 用 csi 组织用户(平台手机号)登录成功并 302 回 `redirect_uri?code=...&state=...`
- [ ] `state` 校验通过
- [ ] code 换 token 成功(form-urlencoded;错用 JSON 会得到 `unsupported_grant_type`)
- [ ] JWKS 验签 id_token 通过(RS256,iss/aud/exp 全校验)
- [ ] 从 `properties.org_id` 取到计费主体键
- [ ] Console 本地会话签发,Cookie `httpOnly+secure+sameSite=lax`
- [ ] 登出后 Casdoor 会话与本地 session 同步失效
- [ ] Casdoor 宕机时回退 LocalAdapter 验证通过

---

## 8. 常见问题

### Q1:为什么换掉自研 SSO?
统一身份源、免维护自研 IdP、获得标准 OIDC(refresh token、introspection、标准登出等)。Console 只需标准 OIDC 客户端库即可接入。

### Q2:为什么验签方式从 HS256 改成 RS256?
Casdoor 标准签发为 RS256 + JWKS。Console 不再需要线下保管共享密钥,公钥开放获取,密钥轮转由 Casdoor 管理。

### Q3:`org_id` 去哪了?userinfo 里没有!
v2 中 org_id 只在 **id_token / access_token 的 `properties` 嵌套 claim** 里;userinfo 返回的是标准 OIDC claims(无 properties)。请在 token 验签时一次性取出缓存。

### Q4:token TTL 7 天太长怎么办?
`id_token/access_token` 是 Casdoor 侧令牌,Console **应基于验签结果签发自己的短时会话**(如 2-8h),并保管 refresh_token 用于续期;不要把 7 天令牌暴露给前端。

### Q5:测试账号密码是什么?
存量 97 用户统一初始密码 `Csi#2026Genesis`(bcrypt 存储)。请通知用户首登改密;后续新注册用户自动同步。

### Q6:callback 支持 http 和 https 吗?
两个版本都已在白名单:`http://www.csi.shopping/callback` 与 `https://www.csi.shopping/callback`(精确匹配,协议/域名/路径完全一致)。预发、本地开发等其他环境回调联系平台追加。

---

## 9. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v2.0 | 2026-09-11 | IdP 迁移至 Casdoor:端点全量替换;RS256+JWKS 取代 HS256 共享密钥;org_id 迁至 `properties` 嵌套 claim;下线 orgs/me、resolve-org、自研 logout;机密客户端取代纯 PKCE 公开客户端;全程实测校准 |
| v1.0 | 2026-09-09 | 首版(已废弃,对应自研 SSO 端点) |
