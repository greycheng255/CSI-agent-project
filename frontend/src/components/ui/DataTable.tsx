import type { ReactNode } from 'react';

/**
 * 轻量表格原语。统一表头密度、行分隔、hover 底色与移动端卡片降级。
 * 金额列请自行用 .money 类渲染（tabular figures + 右对齐）。
 */

export type DataTableDensity = 'comfortable' | 'default' | 'compact';

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
  headerClassName?: string;
  cellClassName?: string;
  /** 移动端卡片降级时的字段标签；不传则复用字符串型 header */
  cardLabel?: string;
  /** 移动端卡片里隐藏该字段 */
  hideOnMobile?: boolean;
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  density?: DataTableDensity;
  onRowClick?: (row: T) => void;
  className?: string;
  /** 表格无障碍标题（视觉隐藏） */
  caption?: string;
};

const ALIGN_CLASS = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  density = 'default',
  onRowClick,
  className = '',
  caption,
}: DataTableProps<T>) {
  const interactiveProps = (row: T) =>
    onRowClick
      ? {
          onClick: () => onRowClick(row),
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onRowClick(row);
            }
          },
          tabIndex: 0,
        }
      : {};

  return (
    <div className={`data-table-wrap ${className}`}>
      <table className={`data-table data-table--${density}`}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={`data-table-th ${ALIGN_CLASS[column.align ?? 'left']} ${column.headerClassName ?? ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className={`data-table-tr${onRowClick ? ' data-table-tr--clickable' : ''}`}
              {...interactiveProps(row)}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`data-table-td ${ALIGN_CLASS[column.align ?? 'left']} ${column.cellClassName ?? ''}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 移动端（<768px）卡片降级，避免横向滚动 */}
      <div className="data-table-cards">
        {rows.map((row, index) => (
          <div
            key={rowKey(row, index)}
            className={`data-table-card${onRowClick ? ' data-table-card--clickable' : ''}`}
            {...interactiveProps(row)}
          >
            {columns
              .filter((column) => !column.hideOnMobile)
              .map((column) => (
                <div key={column.key} className="data-table-card-field">
                  <span className="data-table-card-label">
                    {column.cardLabel ?? (typeof column.header === 'string' ? column.header : '')}
                  </span>
                  <span className={`data-table-card-value ${ALIGN_CLASS[column.align ?? 'left']}`}>
                    {column.render(row)}
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
