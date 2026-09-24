import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'framer-motion';
import { cssSeconds } from './animVars';

/** AnimatedNumber：数字滚动入场（CountUp 风格，灵感来自 react-bits）。
 *  进入视口后从 0 缓动到目标值；reduced-motion 直接显示终值。
 *  时长默认读 styles/animations.css 的 --anim-number-duration（.anim-number）。 */

type AnimatedNumberProps = {
  value: number;
  /** 动画时长（秒）；默认读 --anim-number-duration */
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** 千分位分组 */
  grouping?: boolean;
  className?: string;
};

export default function AnimatedNumber({
  value,
  duration,
  prefix = '',
  suffix = '',
  decimals = 0,
  grouping = true,
  className,
}: AnimatedNumberProps) {
  const reduce = useReducedMotion();
  const effDuration = duration ?? cssSeconds('--anim-number-duration', 1.2);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -8% 0px' });
  const [display, setDisplay] = useState(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    if (!inView) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / (effDuration * 1000), 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, effDuration, reduce]);

  const formatted = display.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  });

  return (
    <span ref={ref} className={`anim-number ${className ?? ''}`}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
