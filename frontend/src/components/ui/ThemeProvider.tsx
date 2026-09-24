import { useEffect, type ReactNode } from 'react';
import { resolveTheme, useThemeStore } from '../../store/themeStore';

/**
 * 把主题模式落到 <html data-theme>，供 index.css 的 [data-theme='dark'] 令牌块消费。
 * mode === 'system' 时监听系统偏好变化，实时跟随。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useThemeStore((state) => state.mode);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.setAttribute('data-theme', resolveTheme(mode));
    };
    apply();

    if (mode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [mode]);

  return <>{children}</>;
}
