import { motion, useReducedMotion } from 'framer-motion';
import { cssNumber, cssSeconds } from './animVars';

/** BlurText 灵感来自 react-bits（MIT + Commons Clause），按碳硅前端需要适配：
 *  支持分段（每段可带 className，如首页 hero 的渐变字），逐字模糊浮现；
 *  参数默认值读 styles/animations.css 的 CSS 变量（.anim-hero-title），
 *  prefers-reduced-motion 时静态渲染。 */

export type BlurTextSegment = {
  text: string;
  className?: string;
};

type BlurTextProps = {
  segments: BlurTextSegment[];
  /** 每字动画时长（秒）；默认读 --anim-hero-char-duration */
  duration?: number;
  /** 字与字之间的出场间隔（秒）；默认读 --anim-hero-char-stagger */
  stagger?: number;
  delay?: number;
  className?: string;
};

export default function BlurText({
  segments,
  duration,
  stagger,
  delay,
  className,
}: BlurTextProps) {
  const reduce = useReducedMotion();

  const effDuration = duration ?? cssSeconds('--anim-hero-char-duration', 0.38);
  const effStagger = stagger ?? cssSeconds('--anim-hero-char-stagger', 0.028);
  const effDelay = delay ?? cssSeconds('--anim-hero-char-delay', 0.1);
  const charY = cssNumber('--anim-hero-char-y', 6);
  const charBlur = cssNumber('--anim-hero-char-blur', 5);

  const chars: Array<{ ch: string; segClass?: string }> = [];
  for (const seg of segments) {
    for (const ch of seg.text) {
      chars.push({ ch, segClass: seg.className });
    }
  }

  if (reduce) {
    return (
      <span className={className}>
        {segments.map((seg, i) => (
          <span key={i} className={seg.className}>{seg.text}</span>
        ))}
      </span>
    );
  }

  return (
    <motion.span className={`anim-hero-title ${className ?? ''}`} aria-label={segments.map((s) => s.text).join('')}>
      {chars.map((item, i) => (
        <motion.span
          key={i}
          className={item.segClass}
          aria-hidden="true"
          initial={{ opacity: 0, filter: `blur(${charBlur}px)`, y: charY }}
          animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
          transition={{
            duration: effDuration,
            delay: effDelay + i * effStagger,
            ease: 'easeOut',
          }}
          style={{ display: 'inline-block', whiteSpace: 'pre' }}
        >
          {item.ch}
        </motion.span>
      ))}
    </motion.span>
  );
}
