const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

export function formatShanghaiDateTime(value?: string | Date | null) {
  if (!value) return '未指定';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '未指定';
  return date.toLocaleString('zh-CN', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatShanghaiDate(value?: string | Date | null) {
  if (!value) return '未指定';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '未指定';
  return date.toLocaleDateString('zh-CN', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
