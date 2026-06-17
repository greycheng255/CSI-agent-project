import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 用户角色
 * 所有普通用户都是 CLIENT
 * ADMIN 角色已废弃，管理员使用独立的 admin 系统
 */
export type UserRole = 'CLIENT' | 'OWNER';

/**
 * 实名认证状态
 */
export type KycStatus = 'NONE' | 'PENDING' | 'VERIFIED';

/**
 * 用户信息
 */
export interface User {
  id: string;
  phone: string;
  displayName?: string;
  email?: string;
  kycStatus: KycStatus;
  role: UserRole;
}

/**
 * 管理员信息
 * 完全独立于用户系统
 */
export interface Admin {
  id: string;
  username: string;
  displayName?: string;
  level: 'SUPER' | 'ADMIN' | 'OPERATOR';
  permissions: string[];
}

/**
 * 认证状态
 */
interface AuthState {
  // 用户认证状态
  user: User | null;
  token: string | null;
  
  // 管理员认证状态（完全独立）
  admin: Admin | null;
  adminToken: string | null;
  
  // 用户相关操作
  login: (user: User, token: string) => void;
  logout: () => void;
  updateKyc: (status: KycStatus) => void;
  updateUser: (user: Partial<User>) => void;
  
  // 管理员相关操作
  adminLogin: (admin: Admin, token: string) => void;
  adminLogout: () => void;
  
  // 工具方法
  isLoggedIn: () => boolean;
  isAdminLoggedIn: () => boolean;
  clearAll: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // 初始状态
      user: null,
      token: null,
      admin: null,
      adminToken: null,
      
      /**
       * 用户登录
       */
      login: (user, token) => set({ 
        user, 
        token,
        // 用户登录时清除管理员状态（避免混淆）
        admin: null,
        adminToken: null,
      }),
      
      /**
       * 用户登出
       */
      logout: () => set({ user: null, token: null }),
      
      /**
       * 更新实名认证状态
       */
      updateKyc: (status) => set((state) => ({ 
        user: state.user ? { ...state.user, kycStatus: status } : null 
      })),
      
      /**
       * 更新用户信息
       */
      updateUser: (userData) => set((state) => ({ 
        user: state.user ? { ...state.user, ...userData } : null 
      })),
      
      /**
       * 管理员登录（独立系统）
       */
      adminLogin: (admin, token) => set({ 
        admin, 
        adminToken: token,
        // 管理员登录时清除用户状态
        user: null,
        token: null,
      }),
      
      /**
       * 管理员登出
       */
      adminLogout: () => set({ admin: null, adminToken: null }),
      
      /**
       * 是否已登录（用户）
       */
      isLoggedIn: () => {
        const state = get();
        return !!(state.user && state.token);
      },
      
      /**
       * 是否已登录（管理员）
       */
      isAdminLoggedIn: () => {
        const state = get();
        return !!(state.admin && state.adminToken);
      },
      
      /**
       * 清除所有认证状态
       */
      clearAll: () => set({ 
        user: null, 
        token: null, 
        admin: null, 
        adminToken: null 
      }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ 
        user: state.user, 
        token: state.token,
        admin: state.admin,
        adminToken: state.adminToken,
      }),
    }
  )
);

/**
 * 判断用户是否是 Agent 主人（开发者）
 * 基于用户角色判断
 */
export const isAgentOwner = (user: User | null): boolean => {
  if (!user) return false;
  return user.role === 'OWNER';
};

/**
 * 判断用户是否是普通客户
 */
export const isClient = (user: User | null): boolean => {
  if (!user) return false;
  return user.role === 'CLIENT';
};

/**
 * 获取当前活跃的认证 Token
 * 优先返回用户 Token，其次管理员 Token
 */
export const getActiveToken = (): string | null => {
  const { token, adminToken } = useAuthStore.getState();
  return token || adminToken || null;
};

/**
 * 判断是否有任意身份登录（用户或管理员）
 */
export const isAnyLoggedIn = (): boolean => {
  const { user, admin } = useAuthStore.getState();
  return !!(user || admin);
};
