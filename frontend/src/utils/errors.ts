/**
 * 面向用户的错误文案统一出口：
 * 后端 error_code / 英文技术信息 → 中文可行动文案，未命中时回退调用方 fallback。
 */

const ERROR_CODE_MESSAGES: Record<string, string> = {
  // 通用
  INVALID_ARGUMENT: '请求参数有误，请检查填写内容后重试',
  UNAUTHORIZED: '登录已过期，请重新登录',
  AUTH_TOKEN_INVALID: '登录已过期，请重新登录',
  AUTH_HMAC_SIGNATURE_MISMATCH: '请求校验失败，请刷新页面后重试',
  AUTH_TIMESTAMP_EXPIRED: '请求已超时，请重试',
  NOT_FOUND: '内容不存在或已被删除',
  CONFLICT: '操作冲突，请刷新后重试',
  FORBIDDEN: '没有权限执行此操作',
  // 账号 / 认证
  USER_NOT_FOUND: '账号不存在，请先注册',
  PASSWORD_INVALID: '密码不正确',
  VERIFICATION_CODE_INVALID: '验证码不正确或已过期',
  VERIFICATION_CODE_EXPIRED: '验证码已过期，请重新获取',
  SMS_SEND_TOO_FREQUENT: '验证码发送过于频繁，请稍后再试',
  PHONE_ALREADY_REGISTERED: '该手机号已注册，可直接登录',
  KYC_NOT_VERIFIED: '请先完成实名认证',
  // 任务 / 订单
  TASK_NOT_FOUND: '任务不存在或已被删除',
  BID_NOT_FOUND: '报价不存在或已被撤回',
  ORDER_NOT_FOUND: '订单不存在',
  NOT_TASK_EMPLOYER: '只有任务发布者可以执行此操作',
  INVALID_STATE_TRANSITION: '当前状态不支持该操作，请刷新页面',
  // 支付 / 额度
  ENTITLEMENT_QUOTA_EXHAUSTED: '额度已用完，可在套餐页升级或充值',
  LLM_CONFIG_MISSING: '尚未配置 AI 服务，请先前往「配置 AI 服务」完成设置',
  LLM_CONFIG_DECRYPT_FAILED: '服务暂时不可用，请稍后重试',
  LLM_UPSTREAM_ERROR: 'AI 服务暂时不可用，请稍后重试',
  PAYMENT_FAILED: '支付未成功，请重试或更换支付方式',
  INSUFFICIENT_BALANCE: '余额不足，请先充值',
};

/** 基础设施类技术字符串 → 人话 */
const RAW_MESSAGE_OVERRIDES: Array<[RegExp, string]> = [
  [/^Request failed$/i, '请求失败，请检查网络后重试'],
  [/Failed to fetch|NetworkError/i, '网络连接失败，请检查网络后重试'],
  [/API returned non-JSON response/i, '服务暂时不可用，请稍后重试'],
  [/API returned invalid JSON/i, '服务暂时不可用，请稍后重试'],
];

const looksLikeErrorCode = (value: string) => /^[A-Z][A-Z0-9_]{3,}$/.test(value);

/**
 * 把任意后端 message / error_code / Error 对象翻译成用户可读文案。
 * @param raw 后端返回的 message、error_code 或 catch 到的 Error
 * @param fallback 未命中映射时的兜底文案
 */
export function friendlyError(raw: unknown, fallback: string): string {
  let message = '';
  if (typeof raw === 'string') {
    message = raw.trim();
  } else if (raw instanceof Error) {
    message = raw.message.trim();
  }

  if (!message) return fallback;

  if (looksLikeErrorCode(message) && ERROR_CODE_MESSAGES[message]) {
    return ERROR_CODE_MESSAGES[message];
  }

  for (const [pattern, text] of RAW_MESSAGE_OVERRIDES) {
    if (pattern.test(message)) return text;
  }

  // 全大写下划线但未登记的 code，不直接展示给用户
  if (looksLikeErrorCode(message)) return fallback;

  return message || fallback;
}

/** 从响应体中取 error_code 或 message 字段（RFC 7807 / NestJS 双口径） */
export async function extractApiError(
  response: Response,
): Promise<{ code?: string; message?: string }> {
  try {
    const data = await response.clone().json();
    return {
      code: typeof data?.error_code === 'string' ? data.error_code : undefined,
      message: Array.isArray(data?.message)
        ? data.message.join('；')
        : typeof data?.message === 'string'
          ? data.message
          : undefined,
    };
  } catch {
    return {};
  }
}

/** 组合：响应 → 友好文案（优先 error_code 映射） */
export async function apiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const { code, message } = await extractApiError(response);
  if (code && ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code];
  return friendlyError(message, fallback);
}
