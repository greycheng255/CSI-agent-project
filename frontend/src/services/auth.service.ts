import { API_BASE } from '../config/api';
import { useAuthStore, type User, type Admin } from '../store/authStore';

/**
 * 用户注册
 */
export async function registerUser(
  phone: string,
  password: string,
  displayName?: string,
): Promise<{ user: User; token: string }> {
  const response = await fetch(`${API_BASE}/api/v1/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password, displayName }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || '注册失败');
  }

  // 注册成功后自动登录
  return loginUser(phone, password);
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
    const error = await response.json();
    throw new Error(error.message || '登录失败');
  }

  const data = await response.json();
  
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
  logout: logoutUser,
  getCurrentUser,
};

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
    const error = await response.json();
    throw new Error(error.message || '登录失败');
  }

  const data = await response.json();
  
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
