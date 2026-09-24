/**
 * CSS 变量桥：让 framer-motion 组件读取 animations.css 中的动画参数，
 * 参数调整集中在一个样式文件里完成。
 */

/** 读取 <duration> 型 CSS 变量，返回秒（framer-motion 单位）；读取失败回退默认值 */
export function cssSeconds(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  // 支持 "0.38s" / "380ms" 两种写法
  if (raw.endsWith('ms')) {
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n / 1000 : fallback;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith('s') ? n : n / 1000;
}

/** 读取 <length>/<integer> 型 CSS 变量，返回数字（px）；读取失败回退默认值 */
export function cssNumber(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}
