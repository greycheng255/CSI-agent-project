import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Copy, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import BlurText from '../components/reactbits/BlurText';
import AnimatedNumber from '../components/reactbits/AnimatedNumber';
import PageFade from '../components/PageFade';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';

/**
 * 动画调参台（内部工具，不进主导航，直接访问 /anim-tuning）。
 * 滑块实时改写 documentElement 上的 CSS 变量 → 立即预览；
 * 改动只存在浏览器内存（刷新即恢复），满意后复制导出的 :root 块
 * 贴回 src/styles/animations.css 持久化。
 */

type Unit = 's' | 'ms' | 'px' | 'num';

type AnimVarDef = {
  name: string;
  label: string;
  unit: Unit;
  min: number;
  max: number;
  step: number;
};

const GROUPS: Array<{ title: string; hint: string; vars: AnimVarDef[] }> = [
  {
    title: '首页 Hero 标题（.anim-hero-title）',
    hint: '逐字模糊浮现',
    vars: [
      { name: '--anim-hero-char-duration', label: '每字时长', unit: 's', min: 0.1, max: 1.5, step: 0.02 },
      { name: '--anim-hero-char-stagger', label: '字间隔', unit: 'ms', min: 0, max: 120, step: 2 },
      { name: '--anim-hero-char-delay', label: '起始延迟', unit: 'ms', min: 0, max: 600, step: 10 },
      { name: '--anim-hero-char-y', label: '上移幅度', unit: 'px', min: 0, max: 30, step: 1 },
      { name: '--anim-hero-char-blur', label: '模糊量', unit: 'px', min: 0, max: 20, step: 1 },
    ],
  },
  {
    title: '任务卡入场（.anim-card-enter）',
    hint: '交错上浮淡入',
    vars: [
      { name: '--anim-card-duration', label: '单卡时长', unit: 's', min: 0.1, max: 1.5, step: 0.02 },
      { name: '--anim-card-stagger', label: '错开间隔', unit: 'ms', min: 0, max: 150, step: 5 },
      { name: '--anim-card-max-stagger-count', label: '拖尾上限（张）', unit: 'num', min: 0, max: 20, step: 1 },
      { name: '--anim-card-y', label: '上移幅度', unit: 'px', min: 0, max: 40, step: 1 },
    ],
  },
  {
    title: '任务卡 hover（.anim-card-hover）',
    hint: '悬停上浮',
    vars: [
      { name: '--anim-card-hover-lift', label: '上浮距离', unit: 'px', min: -12, max: 0, step: 1 },
      { name: '--anim-card-hover-ease', label: '过渡时长', unit: 's', min: 0.05, max: 1, step: 0.05 },
    ],
  },
  {
    title: '路由切换（.anim-page-fade）',
    hint: '页面淡入',
    vars: [
      { name: '--anim-page-fade-duration', label: '时长', unit: 's', min: 0.05, max: 1, step: 0.02 },
      { name: '--anim-page-fade-y', label: '位移', unit: 'px', min: 0, max: 30, step: 1 },
    ],
  },
  {
    title: '数字滚动（.anim-number）',
    hint: '工作台统计数字',
    vars: [
      { name: '--anim-number-duration', label: '滚动时长', unit: 's', min: 0.2, max: 4, step: 0.1 },
    ],
  },
  {
    title: '空状态浮动（.state-icon-float）',
    hint: '空态图标缓浮',
    vars: [
      { name: '--anim-state-float-duration', label: '浮动周期', unit: 's', min: 1, max: 8, step: 0.2 },
      { name: '--anim-state-float-distance', label: '浮动距离', unit: 'px', min: -15, max: 0, step: 1 },
    ],
  },
  {
    title: '区块交错入场（.anim-rise）',
    hint: '首页各区块标题/内容逐级模糊浮现',
    vars: [
      { name: '--anim-rise-duration', label: '单个时长', unit: 's', min: 0.1, max: 1.5, step: 0.02 },
      { name: '--anim-rise-stagger', label: '出场间隔', unit: 'ms', min: 0, max: 300, step: 10 },
      { name: '--anim-rise-y', label: '上移幅度', unit: 'px', min: 0, max: 60, step: 1 },
      { name: '--anim-rise-blur', label: '模糊量', unit: 'px', min: 0, max: 20, step: 1 },
    ],
  },
  {
    title: '滚动 reveal（.reveal）',
    hint: '首页卡片与整块内容滚入视口时上浮',
    vars: [
      { name: '--anim-reveal-duration', label: '时长', unit: 's', min: 0.1, max: 1.5, step: 0.02 },
      { name: '--anim-reveal-y', label: '上移幅度', unit: 'px', min: 0, max: 60, step: 1 },
      { name: '--anim-reveal-blur', label: '模糊量', unit: 'px', min: 0, max: 20, step: 1 },
    ],
  },
];

const ALL_VARS = GROUPS.flatMap((g) => g.vars);

const fmtValue = (unit: Unit, v: number) => (unit === 'num' ? String(v) : `${v}${unit}`);

/** 解析 computed 值（"0.38s"/"28ms"/"-4px"/"8"）为数值 */
const parseValue = (raw: string, unit: Unit): number | null => {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  if (unit === 'ms' && raw.trim().endsWith('s') && !raw.trim().endsWith('ms')) return n * 1000;
  return n;
};

/** 预览舞台：挂载后补上 .in-view，驱动 CSS 过渡型动画入场（父级 key 变化即重播） */
function PreviewStage({
  containerClass,
  itemClass,
  items,
}: {
  containerClass: string;
  itemClass?: string;
  items: string[];
}) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setInView(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className={`${containerClass}${inView ? ' in-view' : ''}`}>
      {items.map((text, i) => (
        <p
          key={text}
          className={`${itemClass ? `${itemClass} ` : ''}text-xs text-[var(--text-600)]`}
          style={{ '--i': i } as CSSProperties}
        >
          {text}
        </p>
      ))}
    </div>
  );
}

export default function AnimTuning() {
  const [values, setValues] = useState<Record<string, number>>({});
  const [initials, setInitials] = useState<Record<string, number>>({});
  const [replayKey, setReplayKey] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const computed = getComputedStyle(document.documentElement);
    const init: Record<string, number> = {};
    for (const v of ALL_VARS) {
      const def = GROUPS.flatMap((g) => g.vars).find((x) => x.name === v.name)!;
      const parsed = parseValue(computed.getPropertyValue(v.name), def.unit);
      init[v.name] = parsed ?? def.min;
    }
    setValues(init);
    setInitials(init);
  }, []);

  const apply = (def: AnimVarDef, v: number) => {
    setValues((prev) => ({ ...prev, [def.name]: v }));
    document.documentElement.style.setProperty(def.name, fmtValue(def.unit, v));
  };

  const resetAll = () => {
    for (const v of ALL_VARS) {
      document.documentElement.style.removeProperty(v.name);
    }
    setValues({ ...initials });
    setReplayKey((k) => k + 1);
  };

  const replay = () => setReplayKey((k) => k + 1);

  const exportCss = useMemo(() => {
    const lines = ALL_VARS.map((v) => `  ${v.name}: ${fmtValue(v.unit, values[v.name] ?? 0)};`);
    return `:root {\n${lines.join('\n')}\n}`;
  }, [values]);

  const copyCss = async () => {
    try {
      await navigator.clipboard.writeText(exportCss);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用时保持展示，用户手动选择复制
    }
  };

  const sliderClass =
    'w-full accent-[var(--brand-600)]';

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-6">
      <WorkbenchPageHeader
        icon={Wand2}
        eyebrow="内部工具"
        title="动画调参台"
        description="拖动滑块实时预览全站动画参数；改动仅存于当前浏览器（刷新即恢复）。确认满意后，复制导出的变量块贴回 src/styles/animations.css 持久化。"
      />

      {/* 操作条 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-white px-4 py-3">
        <button
          type="button"
          onClick={replay}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--brand-strong)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-strong-hover)]"
        >
          <Sparkles className="h-4 w-4" /> 重播预览
        </button>
        <button
          type="button"
          onClick={resetAll}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-600)] hover:bg-[var(--background-100)]"
        >
          <RotateCcw className="h-4 w-4" /> 恢复初始值
        </button>
        <span className="ml-auto text-xs text-[var(--text-400)]">
          提示：调完后可离开本页去首页 / 任务市场 / 工作台看真实效果（本浏览器内持续生效）
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 左：分组滑块 */}
        <div className="space-y-4">
          {GROUPS.map((group) => (
            <section key={group.title} className="rounded-xl border border-[var(--border)] bg-white p-5">
              <h2 className="text-sm font-semibold text-[var(--text-800)]">{group.title}</h2>
              <p className="mt-0.5 text-xs text-[var(--text-400)]">{group.hint}</p>
              <div className="mt-4 space-y-4">
                {group.vars.map((v) => (
                  <div key={v.name}>
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor={v.name} className="font-medium text-[var(--text-600)]">
                        {v.label}
                        <code className="ml-2 text-[10px] text-[var(--text-400)]">{v.name}</code>
                      </label>
                      <span className="tabular-nums font-semibold text-[var(--brand-700)]">
                        {values[v.name] ?? '—'}{v.unit === 'num' ? '' : v.unit}
                      </span>
                    </div>
                    <input
                      id={v.name}
                      type="range"
                      min={v.min}
                      max={v.max}
                      step={v.step}
                      value={values[v.name] ?? v.min}
                      onChange={(e) => apply(v, Number.parseFloat(e.target.value))}
                      onMouseUp={replay}
                      onTouchEnd={replay}
                      className={`mt-1.5 ${sliderClass}`}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* 右：实时预览 + 导出 */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-xl border border-[var(--border)] bg-white p-5">
            <h2 className="text-sm font-semibold text-[var(--text-800)]">实时预览</h2>
            <p className="mt-0.5 text-xs text-[var(--text-400)]">拖动滑块或点「重播预览」查看</p>

            <div key={`hero-${replayKey}`} className="mt-4 rounded-lg bg-[var(--background-100)] p-4">
              <div className="text-xs text-[var(--text-500)]">Hero 标题</div>
              <div className="mt-2 text-xl font-bold text-[var(--text-900)]">
                <BlurText
                  segments={[
                    { text: '硅基智能体的' },
                    { text: '自由', className: 'grad' },
                    { text: '劳务市场' },
                  ]}
                />
              </div>
            </div>

            <div key={`num-${replayKey}`} className="mt-3 rounded-lg bg-[var(--background-100)] p-4">
              <div className="text-xs text-[var(--text-500)]">数字滚动</div>
              <div className="mt-2 text-2xl font-bold tabular-nums text-[var(--text-900)]">
                <AnimatedNumber value={128370.5} prefix="¥" decimals={2} />
                <span className="ml-4">
                  <AnimatedNumber value={97} suffix="%" />
                </span>
              </div>
            </div>

            <div key={`card-${replayKey}`} className="mt-3 space-y-2">
              <div className="text-xs text-[var(--text-500)]">任务卡入场 / hover 上浮</div>
              <div className="anim-card-enter anim-card-hover rounded-xl border border-[var(--border)] bg-white p-3 text-xs text-[var(--text-600)] hover:border-[var(--brand-300)] hover:shadow-[var(--shadow-sm)]">
                卡片 A · 悬停我看上浮
              </div>
            </div>

            <div key={`fade-${replayKey}`} className="mt-3">
              <div className="text-xs text-[var(--text-500)]">页面淡入</div>
              <div className="mt-2 rounded-lg bg-[var(--background-100)] p-3">
                <PageFade>
                  <span className="text-xs text-[var(--text-600)]">fade-in 内容块</span>
                </PageFade>
              </div>
            </div>

            <div key={`rise-${replayKey}`} className="mt-3 rounded-lg bg-[var(--background-100)] p-4">
              <div className="text-xs text-[var(--text-500)]">区块交错入场（.anim-rise）</div>
              <PreviewStage
                containerClass="anim-rise mt-2 space-y-1"
                itemClass="anim-rise-item"
                items={['区块小标签', '区块主标题', '区块说明文字']}
              />
            </div>

            <div key={`reveal-${replayKey}`} className="mt-3 rounded-lg bg-[var(--background-100)] p-4">
              <div className="text-xs text-[var(--text-500)]">卡片 reveal（.reveal）</div>
              <PreviewStage containerClass="reveal mt-2 space-y-1" items={['卡片内容上浮淡入']} />
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-800)]">导出 CSS</h2>
              <button
                type="button"
                onClick={copyCss}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--brand-strong)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-strong-hover)]"
              >
                <Copy className="h-3.5 w-3.5" /> {copied ? '已复制' : '复制'}
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--text-400)]">贴回 src/styles/animations.css 的 :root 块后重建前端生效</p>
            <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-[var(--background-100)] p-3 text-[11px] leading-5 text-[var(--text-700)]">
              <code>{exportCss}</code>
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
