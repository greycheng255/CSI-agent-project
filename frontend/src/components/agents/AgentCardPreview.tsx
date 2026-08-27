/* eslint-disable react-refresh/only-export-components -- validation helper is intentionally colocated with its preview */
type CardJson = {
  schema_version?: unknown;
  name?: unknown;
  description?: unknown;
  version?: unknown;
  endpoints?: { task?: unknown; health?: unknown };
  auth?: { type?: unknown };
  capabilities?: { domains?: unknown; skills?: unknown; tools?: unknown; models?: unknown };
  pricing?: { model?: unknown; minimum_price?: unknown; currency?: unknown };
  limits?: { max_concurrent_tasks?: unknown; timeout_seconds?: unknown };
  [key: string]: unknown;
};

function list(value: unknown) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function PillList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-xs text-[var(--text-400)]">无</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className="rounded bg-[var(--background-100)] px-2 py-1 text-xs text-[var(--text-700)]">
          {item}
        </span>
      ))}
    </div>
  );
}

export function validateAgentCardForPreview(card?: CardJson | null) {
  const missing: string[] = [];
  if (!card) return ['Card JSON 为空'];
  if (!card.schema_version) missing.push('schema_version');
  if (!card.name) missing.push('name');
  if (!card.description) missing.push('description');
  if (!card.version) missing.push('version');
  if (!card.endpoints?.task) missing.push('endpoints.task');
  if (!card.endpoints?.health) missing.push('endpoints.health');
  if (!card.auth?.type) missing.push('auth.type');
  if (!Array.isArray(card.capabilities?.domains) || card.capabilities.domains.length === 0) {
    missing.push('capabilities.domains');
  }
  if (!Array.isArray(card.capabilities?.skills) || card.capabilities.skills.length === 0) {
    missing.push('capabilities.skills');
  }
  if (!card.pricing?.model) missing.push('pricing.model');
  return missing;
}

export function AgentCardPreview({
  card,
  error,
  embedded = false,
}: {
  card?: CardJson | null;
  error?: string;
  embedded?: boolean;
}) {
  if (error) {
    return (
      <div className="rounded-lg border border-[#ffc6c1] bg-[var(--state-error-surface)] p-4 text-sm text-[var(--state-error)]">
        {error}
      </div>
    );
  }

  if (!card) {
    return (
      <div className="rounded-lg border border-dashed border-[color:var(--border)] p-4 text-sm text-[var(--text-500)]">
        粘贴 Card JSON 或抓取 Card URL 后显示预览。
      </div>
    );
  }

  const missing = validateAgentCardForPreview(card);
  const capabilities = card.capabilities || {};
  const pricing = card.pricing || {};
  const limits = card.limits || {};
  const cardName = String(card.name || '未命名 Agent');
  const cardDescription = String(card.description || '暂无描述');

  return (
    <section className={embedded ? '' : 'rounded-xl border border-[color:var(--border)] bg-white p-4'}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-[var(--text-500)]">Card 预览</div>
          <h3 className="mt-1 truncate text-base font-bold text-[var(--text-900)]" title={cardName}>{cardName}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--text-600)]">{cardDescription}</p>
        </div>
        <span
          className={`w-fit flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
            missing.length === 0
              ? 'bg-[var(--state-success-surface)] text-[var(--state-success-text)]'
              : 'bg-[var(--state-warning-surface)] text-[var(--state-warning)]'
          }`}
        >
          {missing.length === 0 ? '格式可提交' : `缺少 ${missing.length} 项`}
        </span>
      </div>

      {missing.length > 0 && (
        <div className="mb-4 rounded border border-[#f3d79a] bg-[var(--state-warning-surface)] px-3 py-2 text-xs text-[var(--state-warning)]">
          缺少字段：{missing.join(', ')}
        </div>
      )}

      <div className={`grid gap-x-8 gap-y-5 sm:grid-cols-2 ${embedded ? 'xl:grid-cols-3' : ''}`}>
        <Info label="版本" value={String(card.version || '-')} />
        <Info label="认证方式" value={String(card.auth?.type || '-')} />
        <Info label="Task Endpoint" value={String(card.endpoints?.task || '-')} />
        <Info label="Health Endpoint" value={String(card.endpoints?.health || '-')} />
        <Info
          label="定价"
          value={`${pricing.model || '-'}${pricing.minimum_price != null ? ` / ${pricing.currency || 'CNY'} ${pricing.minimum_price}` : ''}`}
        />
        <Info
          label="限制"
          value={
            limits.max_concurrent_tasks || limits.timeout_seconds
              ? `并发 ${limits.max_concurrent_tasks || '-'} / 超时 ${limits.timeout_seconds || '-'}s`
              : '-'
          }
        />
      </div>

      <div className="mt-6 grid gap-x-8 gap-y-5 border-t border-[color:var(--border)] pt-5 sm:grid-cols-2 xl:grid-cols-4">
        <Group label="领域" items={list(capabilities.domains)} />
        <Group label="技能" items={list(capabilities.skills)} />
        <Group label="工具" items={list(capabilities.tools)} />
        <Group label="模型" items={list(capabilities.models)} />
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--text-500)]">{label}</div>
      <div className="mt-1 break-all text-sm text-[var(--text-700)]">{value}</div>
    </div>
  );
}

function Group({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="mb-2 text-xs text-[var(--text-500)]">{label}</div>
      <PillList items={items} />
    </div>
  );
}

