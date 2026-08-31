import { API_BASE } from '../config/api';
import { useAuthStore, type User, type Admin } from '../store/authStore';

const parseApiJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!text) {
    return null as T;
  }

  if (contentType.toLowerCase().includes('application/json')) {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('API returned invalid JSON');
    }
  }

  const preview = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const suffix = preview ? `: ${preview.slice(0, 120)}` : '';
  throw new Error(
    `API returned non-JSON response (${response.status} ${response.statusText || 'HTTP error'})${suffix}`,
  );
}

const getErrorMessage = async (response: Response, fallback: string) => {
  try {
    const data = await parseApiJson<{ message?: string | string[] }>(response);
    const message = data?.message;
    if (Array.isArray(message)) return message.join(', ');
    return message || fallback;
  } catch (error) {
    return error instanceof Error ? error.message : fallback;
  }
};

/**
 * 用户注册
 */
export async function registerUser(
  phone: string,
  password: string,
  verificationCode: string,
  displayName?: string,
): Promise<{ user: User; token: string }> {
  const response = await fetch(`${API_BASE}/api/v1/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password, verificationCode, displayName }),
  });

  if (!response.ok) {
    const error = { message: await getErrorMessage(response, 'Request failed') };
    throw new Error(error.message || '注册失败');
  }

  // 注册成功后自动登录
  return loginUser(phone, password);
}

export type SmsVerificationScene = 'login' | 'register';

export type SmsCodeResponse = {
  message: string;
  expiresInSeconds: number;
  retryAfterSeconds: number;
  debugCodeEnabled: boolean;
};

export async function sendSmsCode(
  phone: string,
  scene: SmsVerificationScene,
): Promise<SmsCodeResponse> {
  const response = await fetch(`${API_BASE}/api/v1/users/sms-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, scene }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, '验证码发送失败'));
  }

  return parseApiJson<SmsCodeResponse>(response);
}

export async function loginWithSms(
  phone: string,
  verificationCode: string,
): Promise<{ user: User; token: string; isNewUser: boolean }> {
  const response = await fetch(`${API_BASE}/api/v1/users/login/sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, verificationCode }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, '验证码登录失败'));
  }

  const data = await parseApiJson<{
    user: User;
    token: string;
    isNewUser: boolean;
  }>(response);
  useAuthStore.getState().login(data.user, data.token);
  return data;
}

/**
 * 用户登录
 */
export async function loginUser(
  phone: string,
  password: string
): Promise<{ user: User; token: string }> {
  const response = await fetch(`${API_BASE}/api/v1/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });

  if (!response.ok) {
    const error = { message: await getErrorMessage(response, 'Request failed') };
    throw new Error(error.message || '登录失败');
  }

  const data = await parseApiJson<{ user: User; token: string }>(response);
  
  // 保存到 store
  const { login } = useAuthStore.getState();
  login(data.user, data.token);
  
  return { user: data.user, token: data.token };
}

/**
 * 用户登出
 */
export async function logoutUser(): Promise<void> {
  const { token, logout } = useAuthStore.getState();
  
  if (token) {
    try {
      await fetch(`${API_BASE}/api/v1/users/logout`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
  }
  
  logout();
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(): Promise<User | null> {
  const { token } = useAuthStore.getState();
  
  if (!token) {
    return null;
  }

  const response = await fetch(`${API_BASE}/api/v1/users/me`, {
    headers: { 
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Token 过期，清除登录状态
      const { logout } = useAuthStore.getState();
      logout();
    }
    return null;
  }

  return response.json();
}

/**
 * 管理员认证服务
 */
export const adminAuthService = {
  login: loginAdmin,
  logout: logoutAdmin,
  getCurrentAdmin,
};

/**
 * 用户认证服务
 */
export const userAuthService = {
  register: registerUser,
  login: loginUser,
  loginWithSms,
  sendSmsCode,
  logout: logoutUser,
  getCurrentUser,
};

export type UnifiedLoginResult =
  | { type: 'user'; user: User; token: string }
  | { type: 'admin'; admin: Admin; token: string };

const isInfrastructureError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('non-JSON response') ||
    error.message.includes('invalid JSON') ||
    error.message.includes('Failed to fetch') ||
    error.message.includes('NetworkError')
  );
};

export async function loginWithAccount(
  account: string,
  password: string,
): Promise<UnifiedLoginResult> {
  let userError: unknown;

  try {
    const result = await loginUser(account, password);
    return { type: 'user', ...result };
  } catch (error) {
    userError = error;
    if (isInfrastructureError(error)) {
      throw error;
    }
  }

  try {
    const result = await loginAdmin(account, password);
    return { type: 'admin', ...result };
  } catch (adminError) {
    if (isInfrastructureError(adminError)) {
      throw adminError;
    }
    if (isInfrastructureError(userError)) {
      throw userError;
    }
    throw new Error('账号或密码不正确');
  }
}

/**
 * 管理员登录（独立系统）
 */
export async function loginAdmin(
  username: string,
  password: string
): Promise<{ admin: Admin; token: string }> {
  const response = await fetch(`${API_BASE}/api/v1/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const error = { message: await getErrorMessage(response, 'Request failed') };
    throw new Error(error.message || '登录失败');
  }

  const data = await parseApiJson<{ admin: Admin; token: string }>(response);
  
  // 保存到 store
  const { adminLogin } = useAuthStore.getState();
  adminLogin(data.admin, data.token);
  
  return { admin: data.admin, token: data.token };
}

/**
 * 管理员登出
 */
export async function logoutAdmin(): Promise<void> {
  const { adminToken, adminLogout } = useAuthStore.getState();
  
  if (adminToken) {
    try {
      await fetch(`${API_BASE}/api/v1/admin/logout`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
      });
    } catch (error) {
      console.error('Admin logout error:', error);
    }
  }
  
  adminLogout();
}

/**
 * 获取当前管理员信息
 */
export async function getCurrentAdmin(): Promise<Admin | null> {
  const { adminToken } = useAuthStore.getState();
  
  if (!adminToken) {
    return null;
  }

  const response = await fetch(`${API_BASE}/api/v1/admin/me`, {
    headers: { 
      'Authorization': `Bearer ${adminToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Token 过期，清除登录状态
      const { adminLogout } = useAuthStore.getState();
      adminLogout();
    }
    return null;
  }

  return response.json();
}
