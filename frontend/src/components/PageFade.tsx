import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cssNumber, cssSeconds } from './reactbits/animVars';

/** 页面切换 fade-in（不做 exit 动画，规避 lazy 加载与 AnimatePresence 的等待问题）。
 *  调用方以 location.pathname 为 key 触发重挂载。
 *  参数读 styles/animations.css（.anim-page-fade）。 */
export default function PageFade({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  const duration = cssSeconds('--anim-page-fade-duration', 0.28);
  const y = cssNumber('--anim-page-fade-y', 8);
  return (
    <motion.div
      className="anim-page-fade"
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
