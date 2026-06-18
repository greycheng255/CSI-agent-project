# 碳硅交易平台 — 企业级实名认证方案 (KYC)

> 版本: v1.0 | 日期: 2026-06-18  
> 适用: 生产环境落地，符合中国《网络安全法》实名制要求

---

## 1. 方案选型

推荐 **支付宝身份验证 API**，理由：

| 维度 | 支付宝 | 微信支付 | 自建 |
|------|--------|---------|------|
| 覆盖率 | ~10亿用户 | ~12亿用户 | 0 |
| 接入难度 | API 直连 | 需服务商 | 极高 |
| 成本 | 0.5-1元/次 | 类似 | 自建 OCR + 人工 |
| 合规性 | 银联认证 | 银联认证 | 需自证 |
| 开发周期 | 3-5天 | 5-7天 | 2-4周 |

**推荐组合**: 支付宝为主 + 人工审核兜底

---

## 2. 数据库设计

### 2.1 扩展现有 `users` 表

```sql
-- 已有字段 kyc_status (NONE/PENDING/VERIFIED) 保留
-- 新增字段
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_card_name VARCHAR;       -- 身份证姓名
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_card_number VARCHAR;     -- 身份证号（加密存储）
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_card_front_url TEXT;     -- 身份证正面照
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_card_back_url TEXT;      -- 身份证反面照
ALTER TABLE users ADD COLUMN IF NOT EXISTS face_verified_at TIMESTAMPTZ; -- 人脸验证时间
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ;  -- 认证通过时间
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_expires_at TIMESTAMPTZ;   -- 认证有效期
```

### 2.2 新建 `kyc_records` 表

```sql
CREATE TABLE IF NOT EXISTS kyc_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    request_id VARCHAR NOT NULL UNIQUE,        -- 外部请求流水号
    verify_type VARCHAR NOT NULL,              -- alipay_identity | manual_review | wechat_face
    id_card_name VARCHAR NOT NULL,             -- 提交的姓名
    id_card_number_encrypted VARCHAR NOT NULL, -- 加密身份证号
    id_card_front_url TEXT,                    -- 证件正面
    id_card_back_url TEXT,                     -- 证件反面
    verify_result JSONB,                       -- 第三方返回原始结果
    status VARCHAR NOT NULL DEFAULT 'pending', -- pending | passed | failed | expired
    fail_reason TEXT,                          -- 失败原因
    reviewed_by UUID REFERENCES admins(id),    -- 审核人（人工审核时）
    reviewed_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX idx_kyc_user ON kyc_records(user_id);
CREATE INDEX idx_kyc_status ON kyc_records(status);
```

### 2.3 新建 `kyc_config` 表

```sql
CREATE TABLE IF NOT EXISTS kyc_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key VARCHAR NOT NULL UNIQUE,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初始配置
INSERT INTO kyc_config (config_key, config_value, description) VALUES
('kyc_limits', '{
    "max_attempts_per_day": 3,
    "min_age": 18,
    "id_card_reuse_limit": 3,
    "face_verify_timeout_seconds": 300
}', 'KYC 限制策略');

INSERT INTO kyc_config (config_key, config_value, description) VALUES
('kyc_required_scopes', '{
    "publish_task": true,
    "own_agent": true,
    "receive_payment": true,
    "withdraw_balance": true
}', '哪些操作需要实名认证');
```

---

## 3. 后端模块设计

### 3.1 目录结构

```
backend/src/kyc/
├── kyc.module.ts                ← 模块注册
├── kyc.controller.ts            ← 用户端 API
├── kyc-admin.controller.ts      ← 管理端 API
├── kyc.service.ts               ← 核心业务逻辑
├── kyc-crypto.service.ts        ← 身份证加密/解密
├── providers/
│   ├── alipay-identity.provider.ts   ← 支付宝身份验证
│   └── wechat-face.provider.ts       ← 微信人脸（预留）
├── dto/
│   ├── submit-kyc.dto.ts
│   ├── kyc-query.dto.ts
│   └── admin-review.dto.ts
└── entities/
    ├── kyc-record.entity.ts
    └── kyc-config.entity.ts
```

### 3.2 API 设计

#### 用户端

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/kyc/submit` | 提交实名认证（姓名+身份证号） |
| `POST` | `/api/v1/kyc/upload-id-card` | 上传身份证照片 |
| `POST` | `/api/v1/kyc/face-verify` | 人脸验证（支付宝刷脸） |
| `GET` | `/api/v1/kyc/status` | 查询当前认证状态 |
| `GET` | `/api/v1/kyc/records` | 查询认证历史 |

#### 管理端

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/admin/kyc/pending` | 待审核列表 |
| `POST` | `/api/v1/admin/kyc/:recordId/approve` | 审核通过 |
| `POST` | `/api/v1/admin/kyc/:recordId/reject` | 审核驳回 |
| `GET` | `/api/v1/admin/kyc/stats` | KYC 统计数据 |

### 3.3 核心流程

```
用户提交认证
  │
  ├─→ ① POST /kyc/submit
  │     提交姓名 + 身份证号
  │     校验格式 → 加密存储 → 创建 kyc_record (status=pending)
  │
  ├─→ ② POST /kyc/upload-id-card
  │     上传身份证正反面照片
  │     上传到 OSS/COS → 保存 URL
  │
  ├─→ ③ POST /kyc/face-verify
  │     调用支付宝身份验证 API
  │     ├─ 通过 → kyc_record status=passed
  │     │         → users.kyc_status=VERIFIED
  │     │         → users.face_verified_at=NOW()
  │     └─ 失败 → kyc_record status=failed
  │               → 提示用户重试（每日最多3次）
  │
  └─→ 兜底：人工审核
       管理员在后台查看证件照片
       人工比对 → 通过/驳回
```

---

## 4. 加密方案

身份证号属于敏感个人信息，必须加密存储：

```
存储流程:
  明文身份证号
    → AES-256-GCM 加密（密钥存储在环境变量 KYC_ENCRYPTION_KEY）
    → Base64 编码
    → 存入 kyc_records.id_card_number_encrypted

读取流程（仅管理员审核时）:
  Base64 解码
    → AES-256-GCM 解密
    → 明文展示（前端脱敏：320***********1234）
```

```typescript
// kyc-crypto.service.ts
import * as crypto from 'crypto';

export class KycCryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key = Buffer.from(process.env.KYC_ENCRYPTION_KEY!, 'hex');

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decrypt(ciphertext: string): string {
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  /** 前端展示用脱敏 */
  mask(plaintext: string): string {
    if (plaintext.length !== 18) return '***';
    return plaintext.slice(0, 3) + '***********' + plaintext.slice(-4);
  }
}
```

---

## 5. 支付宝身份验证接入

### 5.1 前提条件

- 支付宝开放平台账号（企业认证）
- 签约「身份验证」产品
- 获取 AppID + 应用私钥 + 支付宝公钥

### 5.2 调用流程

```typescript
// alipay-identity.provider.ts
import AlipaySdk from 'alipay-sdk';

export class AlipayIdentityProvider {
  private sdk: AlipaySdk;

  constructor() {
    this.sdk = new AlipaySdk({
      appId: process.env.ALIPAY_APP_ID!,
      privateKey: process.env.ALIPAY_PRIVATE_KEY!,
      alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY!,
      gateway: 'https://openapi.alipay.com/gateway.do',
    });
  }

  /**
   * 身份证二要素验证（姓名 + 身份证号）
   * 文档: https://opendocs.alipay.com/apis/api_2/alipay.user.certify.open.initialize
   */
  async verifyIdentity(userId: string, name: string, idCard: string) {
    const requestId = `KYC-${userId.slice(0, 8)}-${Date.now()}`;

    // 1. 初始化认证
    const initResult = await this.sdk.exec('alipay.user.certify.open.initialize', {
      bizContent: {
        outerOrderNo: requestId,
        bizCode: 'FACE',                    // 人脸验证模式
        identityParam: {
          identityType: 'CERT_INFO',
          certType: 'IDENTITY_CARD',
          certName: name,
          certNo: idCard,
        },
        merchantConfig: {
          returnUrl: `${process.env.BASE_URL}/api/v1/kyc/alipay-callback`,
        },
      },
    });

    // 2. 返回认证链接给前端（前端跳转支付宝 APP 或 H5）
    return {
      certifyId: initResult.certifyId,
      certifyUrl: initResult.certifyUrl,    // 用户打开此链接完成刷脸
      requestId,
    };
  }

  /**
   * 查询认证结果
   */
  async queryResult(certifyId: string) {
    const result = await this.sdk.exec('alipay.user.certify.open.query', {
      bizContent: { certifyId },
    });

    return {
      passed: result.passed === 'true',
      failReason: result.failReason || null,
      identityInfo: result.identityInfo,
    };
  }
}
```

### 5.3 前端集成

```typescript
// 用户点击"去认证" →
//   ① POST /kyc/submit 提交姓名+身份证号
//   ② 后端返回 certifyUrl
//   ③ 前端 window.location.href = certifyUrl（跳转支付宝 H5 刷脸）
//   ④ 支付宝回调 → 后端验证结果 → 更新 kyc_status
```

---

## 6. 安全策略

| 规则 | 说明 |
|------|------|
| 每日次数限制 | 同一用户每天最多 3 次认证尝试 |
| 同身份证限制 | 同一身份证最多绑定 3 个账号 |
| 前端脱敏 | 展示时只显示 `320***********1234` |
| 传输加密 | 身份证号通过 HTTPS 传输，日志不打印 |
| 存储加密 | AES-256-GCM 加密落库 |
| 密钥管理 | 加密密钥通过环境变量注入，不写死在代码中 |
| 操作审计 | 所有 KYC 操作写入 `audit_logs` |

---

## 7. 实名后权限控制

通过 Guard 拦截，未实名用户无法执行敏感操作：

```typescript
// kyc.guard.ts
@Injectable()
export class KycGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('请先登录');
    if (user.kycStatus !== 'VERIFIED') {
      throw new ForbiddenException('请先完成实名认证');
    }
    return true;
  }
}

// 在需要实名的接口上加 @UseGuards(KycGuard)
@Post('tasks')
@UseGuards(AuthGuard, KycGuard)
createTask() { ... }
```

---

## 8. 与现有系统集成改动清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `backend/src/kyc/` | **新增** 完整 KYC 模块 |
| 2 | `users` 表 | 新增 6 个 KYC 相关字段 |
| 3 | `backend/src/users/entities/user.entity.ts` | 新增字段映射 |
| 4 | `backend/src/app.module.ts` | 注册 KycModule |
| 5 | `frontend/src/pages/Profile.tsx` | "去认证"按钮改为调用真实 API |
| 6 | `frontend/src/store/authStore.ts` | `updateKyc` 改为调后端接口 |
| 7 | 环境变量 | 新增 `ALIPAY_APP_ID`、`ALIPAY_PRIVATE_KEY`、`KYC_ENCRYPTION_KEY` |

---

## 9. 分阶段落地建议

| 阶段 | 内容 | 工时 |
|------|------|------|
| **Phase 1** | 建表 + 后端 CRUD + 前端页面（人工审核模式） | 2天 |
| **Phase 2** | 支付宝 API 接入 + 自动化验证 | 2天 |
| **Phase 3** | 加密方案 + 安全审计 + KYC Guard 拦截 | 1天 |
| **Phase 4** | 管理后台审核页面 + 统计面板 | 1天 |

**Phase 1 即可上线**（人工审核模式），后续逐步自动化。
