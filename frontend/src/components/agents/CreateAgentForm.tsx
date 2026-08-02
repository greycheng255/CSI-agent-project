import { useMemo, useState } from 'react';
import { CheckCircle2, FileJson, Link2, Loader2 } from 'lucide-react';
import { registerExternalAgent } from '../../api/agentsApi';
import type { Agent } from '../../types/agent';
import { AgentCardPreview, validateAgentCardForPreview } from './AgentCardPreview';

const AGENT_CARD_JSON_EXAMPLE = JSON.stringify(
  {
    schema_version: '1.0',
    agent_id: 'external-agent-demo-001',
    name: 'AI Lead Generation Agent',
    description:
      'An external self-hosted agent that analyzes lead generation tasks, creates outreach plans, and returns structured delivery artifacts.',
    version: '1.0.0',
    provider: {
      owner: 'Example AI Team',
      homepage: 'https://example.com',
      contact_email: 'ops@example.com',
    },
    endpoints: {
      task: 'https://agent.example.com/a2a/tasks',
      webhook: 'https://agent.example.com/webhook',
      health: 'https://agent.example.com/health',
      callback: 'https://agent.example.com/callback',
    },
    auth: {
      type: 'bearer',
      key_id: 'prod-key-001',
    },
    capabilities: {
      domains: ['lead-generation', 'crm', 'marketing-automation'],
      skills: ['task_analysis', 'lead_scoring', 'outreach_copywriting'],
      tools: ['crm-search', 'email-draft', 'report-generator'],
      models: ['gpt-4.1', 'claude-sonnet'],
      languages: ['zh-CN', 'en-US'],
      input_formats: ['text', 'json', 'csv'],
      output_formats: ['json', 'markdown', 'xlsx'],
      max_concurrency: 3,
    },
    pricing: {
      model: 'quote',
      currency: 'CNY',
      minimum_price: 100,
      description:
        'Quote by task complexity, lead volume, and delivery deadline.',
    },
    limits: {
      max_concurrent_tasks: 3,
      timeout_seconds: 600,
    },
    metadata: {
      tags: ['external-self-hosted', 'lead-generation', 'crm'],
      service_level: 'business-hours',
      owner_user_id: 'replace-with-platform-user-id-if-needed',
    },
  },
  null,
  2,
);

export function CreateAgentForm({
  onCreated,
  onCancel,
}: {
  onCreated: (agent: Agent) => void;
  onCancel?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [cardUrl, setCardUrl] = useState('');
  const [cardJsonText, setCardJsonText] = useState('');
  const [cardUrlLoading, setCardUrlLoading] = useState(false);
  const [cardUrlPreview, setCardUrlPreview] = useState<Record<string, unknown> | null>(null);
  const [cardPreviewError, setCardPreviewError] = useState('');

  const parsedCard = useMemo(() => {
    if (!cardJsonText.trim()) {
      return {
        ok: true,
        value: undefined as Record<string, unknown> | undefined,
        message: '',
      };
    }
    try {
      return {
        ok: true,
        value: JSON.parse(cardJsonText) as Record<string, unknown>,
        message: '',
      };
    } catch (err) {
      return {
        ok: false,
        value: undefined,
        message: err instanceof Error ? err.message : 'JSON 格式错误',
      };
    }
  }, [cardJsonText]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const cardJson = parsedCard.value || cardUrlPreview || undefined;
      if (!cardUrl.trim() && !cardJson) {
        throw new Error('请填写 Agent Card URL 或 Agent Card JSON');
      }
      if (!parsedCard.ok) {
        throw new Error('请修正 Agent Card JSON 后再提交');
      }
      if (cardJson && validateAgentCardForPreview(cardJson).length > 0) {
        throw new Error('Agent Card 缺少必填字段');
      }

      const agent = await registerExternalAgent({
        cardUrl: cardUrl.trim() || undefined,
        cardJson,
        contactEmail: contactEmail.trim() || undefined,
      });
      onCreated(agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setSubmitting(false);
    }
  };

  const fetchCardUrlPreview = async () => {
    if (!cardUrl.trim()) {
      setCardPreviewError('请先填写 Card URL');
      return;
    }
    setCardUrlLoading(true);
    setCardPreviewError('');
    setCardUrlPreview(null);

    try {
      const response = await fetch(cardUrl.trim());
      if (!response.ok) {
        throw new Error(`Card URL 返回 HTTP ${response.status}`);
      }
      const data = (await response.json()) as Record<string, unknown>;
      setCardUrlPreview(data);
    } catch (err) {
      setCardPreviewError(err instanceof Error ? err.message : 'Card URL 抓取失败');
    } finally {
      setCardUrlLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-[color:var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-900)]">注册外部自托管 Agent</h2>
          <p className="mt-1 text-xs text-[var(--text-500)]">提交后进入待审核，审核通过并启动后展示到智能体广场。</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-50)] px-2.5 py-1 text-xs font-medium text-[var(--brand-700)]">
          <Link2 className="h-3.5 w-3.5" />
          外部自托管
        </span>
      </div>

      <div className="space-y-4">
        <Field label="Agent Card URL">
          <div className="flex gap-2">
            <input
              value={cardUrl}
              onChange={(event) => setCardUrl(event.target.value)}
              placeholder="https://example.com/agent-card.json"
              className="field-input"
            />
            <button
              type="button"
              onClick={fetchCardUrlPreview}
              disabled={cardUrlLoading}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[color:var(--border)] px-3 py-2 text-sm text-[var(--text-700)] hover:border-[var(--brand-300)] hover:bg-[var(--brand-50)] disabled:opacity-50"
            >
              {cardUrlLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              预览
            </button>
          </div>
        </Field>

        <Field label="或粘贴 Agent Card JSON">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--text-500)]">
              示例包含必填字段：schema_version、name、description、version、endpoints.task、endpoints.health、auth.type、capabilities.domains、capabilities.skills、pricing.model。
            </p>
            <button
              type="button"
              onClick={() => setCardJsonText(AGENT_CARD_JSON_EXAMPLE)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[color:var(--border)] px-2.5 py-1 text-xs text-[var(--text-700)] hover:border-[var(--brand-300)] hover:bg-[var(--brand-50)]"
            >
              <FileJson className="h-3.5 w-3.5" />
              填入示例
            </button>
          </div>
          <textarea
            value={cardJsonText}
            onChange={(event) => setCardJsonText(event.target.value)}
            rows={18}
            className="field-input font-mono"
            placeholder={AGENT_CARD_JSON_EXAMPLE}
          />
        </Field>

        {cardJsonText.trim() && (
          <div
            className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${
              parsedCard.ok
                ? 'border-[var(--state-success-border)] bg-[var(--state-success-surface)] text-[var(--state-success-text)]'
                : 'border-[var(--state-danger-border)] bg-[var(--state-danger-surface)] text-[var(--state-danger-text)]'
            }`}
          >
            {parsedCard.ok ? <CheckCircle2 className="h-4 w-4" /> : <FileJson className="h-4 w-4" />}
            {parsedCard.ok
              ? `JSON 可解析：${String(parsedCard.value?.name || '未命名 Agent')}`
              : parsedCard.message}
          </div>
        )}

        <AgentCardPreview
          card={(parsedCard.ok && parsedCard.value) || cardUrlPreview}
          error={!parsedCard.ok ? parsedCard.message : cardPreviewError}
        />
      </div>

      <Field label="联系邮箱">
        <input
          value={contactEmail}
          onChange={(event) => setContactEmail(event.target.value)}
          placeholder="ops@example.com"
          className="field-input"
        />
      </Field>

      {error && (
        <div className="rounded-xl border border-[var(--state-danger-border)] bg-[var(--state-danger-surface)] px-3 py-2 text-sm text-[var(--state-danger-text)]">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3">
        {onCancel && (
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl px-4 py-2 text-sm text-[var(--text-500)] hover:bg-[var(--background-100)] hover:text-[var(--text-900)]">
            取消
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="btn-cs inline-flex min-h-11 items-center gap-2 px-5 py-2 text-sm font-bold disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          提交审核
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--text-700)]">{label}</span>
      {children}
    </label>
  );
}
