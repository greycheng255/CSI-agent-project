import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 主题模式：
 * - light  强制浅色
 * - dark   强制深色
 * - system 跟随系统（首访默认）
 */
export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'csi-theme' },
  ),
);

/** 把模式解析为实际生效的主题（system → 读系统偏好） */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return mode;
}
