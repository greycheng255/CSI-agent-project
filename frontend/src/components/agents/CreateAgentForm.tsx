import { useMemo, useState } from 'react';
import { CheckCircle2, FileJson, Link2, Loader2, Server } from 'lucide-react';
import { registerAgent, registerExternalAgent } from '../../api/agentsApi';
import type { Agent } from '../../types/agent';

type Mode = 'platform' | 'external';

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function CreateAgentForm({
  onCreated,
  onCancel,
}: {
  onCreated: (agent: Agent) => void;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<Mode>('platform');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [skills, setSkills] = useState('python,data');
  const [domains, setDomains] = useState('carbon');
  const [tags, setTags] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [healthUrl, setHealthUrl] = useState('');
  const [pricingModel, setPricingModel] = useState('quote');
  const [basePrice, setBasePrice] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const [cardUrl, setCardUrl] = useState('');
  const [cardJsonText, setCardJsonText] = useState('');

  const parsedCard = useMemo(() => {
    if (!cardJsonText.trim()) return { ok: true, value: undefined as Record<string, unknown> | undefined };
    try {
      return { ok: true, value: JSON.parse(cardJsonText) as Record<string, unknown> };
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
      let agent: Agent;
      if (mode === 'platform') {
        agent = await registerAgent({
          name: name.trim(),
          description: description.trim(),
          skills: splitList(skills),
          domains: splitList(domains),
          tags: splitList(tags),
          endpointUrl: endpointUrl.trim() || undefined,
          webhookUrl: endpointUrl.trim() || undefined,
          healthUrl: healthUrl.trim() || undefined,
          authType: 'bearer',
          pricingModel,
          basePrice: basePrice ? Number(basePrice) : null,
          currency: 'CNY',
          contactEmail: contactEmail.trim() || undefined,
        });
      } else {
        if (!cardUrl.trim() && !parsedCard.value) {
          throw new Error('Card URL 和 Card JSON 至少填写一个');
        }
        if (!parsedCard.ok) {
          throw new Error('Card JSON 格式错误，请修正后提交');
        }
        agent = await registerExternalAgent({
          cardUrl: cardUrl.trim() || undefined,
          cardJson: parsedCard.value,
          contactEmail: contactEmail.trim() || undefined,
        });
      }
      onCreated(agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-purple-900/50 bg-purple-950/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-purple-300">注册 Agent</h2>
          <p className="mt-1 text-xs text-gray-500">提交后进入待审核，管理员通过后才会进入智能体广场。</p>
        </div>
        <div className="flex rounded border border-gray-800 bg-black p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode('platform')}
            className={`flex items-center gap-1 rounded px-3 py-1.5 ${
              mode === 'platform' ? 'bg-purple-500 text-black' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Server className="h-4 w-4" />
            平台托管
          </button>
          <button
            type="button"
            onClick={() => setMode('external')}
            className={`flex items-center gap-1 rounded px-3 py-1.5 ${
              mode === 'external' ? 'bg-purple-500 text-black' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Link2 className="h-4 w-4" />
            外部自托管
          </button>
        </div>
      </div>

      {mode === 'platform' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Agent 名称">
            <input required value={name} onChange={(e) => setName(e.target.value)} className="field-input" />
          </Field>
          <Field label="Endpoint URL">
            <input value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} placeholder="https://example.com/a2a/tasks" className="field-input" />
          </Field>
          <Field label="能力描述">
            <input required value={description} onChange={(e) => setDescription(e.target.value)} className="field-input" />
          </Field>
          <Field label="Health URL">
            <input value={healthUrl} onChange={(e) => setHealthUrl(e.target.value)} placeholder="https://example.com/health" className="field-input" />
          </Field>
          <Field label="技能，逗号分隔">
            <input value={skills} onChange={(e) => setSkills(e.target.value)} className="field-input" />
          </Field>
          <Field label="领域，逗号分隔">
            <input value={domains} onChange={(e) => setDomains(e.target.value)} className="field-input" />
          </Field>
          <Field label="自定义标签">
            <input value={tags} onChange={(e) => setTags(e.target.value)} className="field-input" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="定价模式">
              <select value={pricingModel} onChange={(e) => setPricingModel(e.target.value)} className="field-input">
                <option value="quote">询价</option>
                <option value="fixed">固定价</option>
                <option value="hourly">按小时</option>
                <option value="token">按 Token</option>
              </select>
            </Field>
            <Field label="基础价格">
              <input value={basePrice} onChange={(e) => setBasePrice(e.target.value)} inputMode="decimal" className="field-input" />
            </Field>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Agent Card URL">
            <input value={cardUrl} onChange={(e) => setCardUrl(e.target.value)} placeholder="https://example.com/agent-card.json" className="field-input" />
          </Field>
          <Field label="或粘贴 Agent Card JSON">
            <textarea
              value={cardJsonText}
              onChange={(e) => setCardJsonText(e.target.value)}
              rows={8}
              className="field-input font-mono"
              placeholder='{"schema_version":"1.0","name":"Carbon Agent",...}'
            />
          </Field>
          {cardJsonText.trim() && (
            <div className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${
              parsedCard.ok ? 'border-green-500/30 bg-green-500/10 text-green-300' : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}>
              {parsedCard.ok ? <CheckCircle2 className="h-4 w-4" /> : <FileJson className="h-4 w-4" />}
              {parsedCard.ok ? `JSON 可解析：${String(parsedCard.value?.name || '未命名 Agent')}` : parsedCard.message}
            </div>
          )}
        </div>
      )}

      <Field label="联系邮箱">
        <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="ops@example.com" className="field-input" />
      </Field>

      {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="flex justify-end gap-3">
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">
            取消
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded bg-purple-500 px-5 py-2 text-sm font-bold text-black hover:bg-purple-400 disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          提交注册
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-gray-400">{label}</span>
      {children}
    </label>
  );
}
