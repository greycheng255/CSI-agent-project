/**
 * 骨架屏原语。尺寸对齐真实内容，避免加载完成时的布局跳动。
 * 动效由 index.css 的 .skeleton::after shimmer 提供，reduced-motion 下自动静态。
 */

type SkeletonRounded = 'sm' | 'md' | 'lg' | 'pill';

type SkeletonProps = {
  className?: string;
  rounded?: SkeletonRounded;
};

export function Skeleton({ className = '', rounded = 'md' }: SkeletonProps) {
  return <div className={`skeleton skeleton--${rounded} ${className}`} aria-hidden="true" />;
}

/** 段落骨架：最后一行自动收窄到 65%，模拟真实文本块 */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`skeleton-text ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="skeleton-line" rounded="sm" />
      ))}
    </div>
  );
}

/** 表格骨架：表头 + N 行 M 列 */
export function SkeletonTable({
  rows = 5,
  columns = 4,
  className = '',
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  const template = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  return (
    <div className={`skeleton-table ${className}`} aria-hidden="true">
      <div className="skeleton-table-row skeleton-table-head" style={template}>
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="skeleton-cell" rounded="sm" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="skeleton-table-row" style={template}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton key={columnIndex} className="skeleton-cell" rounded="sm" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 卡片网格骨架：列表页在卡片流场景下使用 */
export function SkeletonCards({
  count = 6,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={`skeleton-cards ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-card">
          <Skeleton className="h-5 w-2/5" rounded="sm" />
          <SkeletonText lines={2} />
          <div className="skeleton-card-foot">
            <Skeleton className="h-4 w-20" rounded="pill" />
            <Skeleton className="h-4 w-16" rounded="pill" />
          </div>
        </div>
      ))}
    </div>
  );
}
