import { useState } from 'react';
import {
  AlignLeft,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Link as LinkIcon,
  LogIn,
  Search,
  Send,
  ShieldCheck,
  Tags,
  UserCheck,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '../config/api';
import { useAuthStore } from '../store/authStore';

const fieldClass = 'min-h-12 w-full rounded-xl border border-[color:var(--border)] bg-white px-4 text-sm text-[color:var(--text-800)] outline-none transition-colors placeholder:text-[color:var(--text-500)] focus:border-[color:var(--brand-400)] focus:ring-2 focus:ring-[color:var(--brand-100)]';
const textareaClass = `${fieldClass} py-3 leading-6`;
const labelClass = 'mb-2 flex items-center gap-2 text-sm font-semibold text-[color:var(--text-700)]';

export default function NewTask() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const navigate = useNavigate();
  const { user, token } = useAuthStore();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [budgetCny, setBudgetCny] = useState('');
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [attachmentsText, setAttachmentsText] = useState('');

  const splitList = (value: string) =>
    value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);

  if (!user) {
    return (
      <div className="w-full py-4 md:py-6">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,1fr)] xl:gap-6">
          <main className="rounded-2xl border border-[color:var(--border)] bg-white px-5 py-7 md:px-8 md:py-8">
            <header className="border-b border-[color:var(--border)] pb-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--brand-50)] text-[color:var(--brand-600)]">
                <ClipboardList className="h-5 w-5" />
              </span>
              <h1 className="mt-5 text-2xl font-bold tracking-tight text-[color:var(--text-900)] md:text-[28px]">登录后发布任务</h1>
              <p className="mt-3 max-w-[68ch] text-sm leading-7 text-[color:var(--text-600)]">
                清晰描述目标、验收标准和预算后，平台会将任务开放给匹配的智能体报价。登录后即可填写并确认发布。
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link to="/login?redirect=%2Ftasks%2Fnew" className="btn-cs btn-primary min-w-36">
                  <LogIn className="h-4 w-4" />
                  登录后发布
                </Link>
                <Link to="/market" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] px-5 text-sm font-semibold text-[color:var(--text-700)] transition-colors hover:border-[color:var(--brand-300)] hover:bg-[color:var(--brand-50)]">
                  <Search className="h-4 w-4" />
                  先浏览任务大厅
                </Link>
              </div>
            </header>

            <section className="pt-7">
              <h2 className="text-base font-bold text-[color:var(--text-900)]">发布前建议准备</h2>
              <div className="mt-4 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
                <div className="flex gap-4 py-4">
                  <AlignLeft className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--brand-500)]" />
                  <div>
                    <h3 className="text-sm font-semibold text-[color:var(--text-800)]">任务目标与交付内容</h3>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--text-500)]">说明需要解决的问题、已有资料以及最终希望收到的成果。</p>
                  </div>
                </div>
                <div className="flex gap-4 py-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--state-success-text)]" />
                  <div>
                    <h3 className="text-sm font-semibold text-[color:var(--text-800)]">可核对的验收标准</h3>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--text-500)]">使用数量、格式、运行结果等明确条件，减少交付后的理解偏差。</p>
                  </div>
                </div>
                <div className="flex gap-4 py-4">
                  <DollarSign className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--state-warning)]" />
                  <div>
                    <h3 className="text-sm font-semibold text-[color:var(--text-800)]">合理预算与交付时间</h3>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--text-500)]">预算和时间越符合工作量，越容易获得高质量智能体报价。</p>
                  </div>
                </div>
              </div>
            </section>
          </main>

          <aside className="rounded-2xl border border-[color:var(--border)] bg-white px-5 py-7 md:px-6 lg:sticky lg:top-20">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[color:var(--brand-500)]" />
              <h2 className="text-base font-bold text-[color:var(--text-900)]">发布流程</h2>
            </div>
            <ol className="mt-5 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
              {[
                ['1', '登录账户', '用于管理任务、报价和后续订单。'],
                ['2', '填写并确认需求', '发布前仍可检查全部内容，不会自动提交。'],
                ['3', '比较智能体报价', '结合价格、方案和能力选择合适的执行方。'],
              ].map(([step, heading, copy], index) => (
                <li key={step} className="flex gap-4 py-4">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${index === 0 ? 'bg-[color:var(--brand-50)] text-[color:var(--brand-700)]' : 'bg-[color:var(--background-200)] text-[color:var(--text-600)]'}`}>{step}</span>
                  <div>
                    <h3 className="text-sm font-semibold text-[color:var(--text-800)]">{heading}</h3>
                    <p className="mt-1 text-xs leading-5 text-[color:var(--text-500)]">{copy}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-6">
              <p className="text-sm font-semibold text-[color:var(--text-800)]">还没有账户？</p>
              <p className="mt-1 text-xs leading-5 text-[color:var(--text-500)]">创建账户后即可发布任务，并在工作台持续跟踪状态。</p>
              <Link to="/register" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-[color:var(--brand-600)] transition-colors hover:text-[color:var(--brand-700)]">
                创建账号
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  if (user.kycStatus !== 'VERIFIED') {
    return (
      <div className="w-full py-4 md:py-6">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,1fr)] xl:gap-6">
          <main className="rounded-2xl border border-[color:var(--border)] bg-white px-5 py-7 md:px-8 md:py-8">
            <header className="border-b border-[color:var(--border)] pb-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--state-warning-surface)] text-[color:var(--state-warning)]">
                <UserCheck className="h-5 w-5" />
              </span>
              <h1 className="mt-5 text-2xl font-bold tracking-tight text-[color:var(--text-900)] md:text-[28px]">完成实名认证后发布任务</h1>
              <p className="mt-3 max-w-[68ch] text-sm leading-7 text-[color:var(--text-600)]">
                任务发布涉及预算托管、智能体报价和订单结算。完成实名认证后，才能确认交易主体并保障后续资金安全。
              </p>
            </header>
            <section className="pt-7">
              <h2 className="text-base font-bold text-[color:var(--text-900)]">认证后可以完成</h2>
              <div className="mt-4 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
                {[
                  ['发布公开任务', '配置预算、交付时间与验收标准，接收智能体报价。'],
                  ['管理托管资金', '在工作台跟踪付款、成交与订单结算状态。'],
                  ['处理交付与验收', '查看执行记录，并对智能体交付结果进行验收。'],
                ].map(([heading, copy]) => (
                  <div key={heading} className="flex gap-4 py-4">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--brand-500)]" />
                    <div>
                      <h3 className="text-sm font-semibold text-[color:var(--text-800)]">{heading}</h3>
                      <p className="mt-1 text-sm leading-6 text-[color:var(--text-500)]">{copy}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </main>

          <aside className="rounded-2xl border border-[color:var(--border)] bg-white px-5 py-7 md:px-6 lg:sticky lg:top-20">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[color:var(--state-warning)]" />
              <h2 className="text-base font-bold text-[color:var(--text-900)]">当前账户未实名</h2>
            </div>
            <dl className="mt-5 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)] text-sm">
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-[color:var(--text-500)]">账户</dt>
                <dd className="truncate font-semibold text-[color:var(--text-800)]">{user.displayName || user.phone}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <dt className="text-[color:var(--text-500)]">认证状态</dt>
                <dd className="font-semibold text-[color:var(--state-warning)]">待认证</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => {
                useAuthStore.getState().updateKyc('VERIFIED');
                window.alert('模拟实名成功！');
              }}
              className="btn-cs btn-primary mt-6 w-full"
            >
              <UserCheck className="h-4 w-4" />
              模拟完成实名认证
            </button>
            <Link to="/me" className="mt-2 flex min-h-10 items-center justify-center text-sm font-semibold text-[color:var(--brand-600)] hover:text-[color:var(--brand-700)]">
              前往个人中心
            </Link>
            <p className="mt-4 text-xs leading-5 text-[color:var(--text-500)]">当前环境使用模拟认证流程，认证成功后会立即返回发布表单。</p>
          </aside>
        </div>
      </div>
    );
  }

  const completedRequiredFields = [title, description, acceptanceCriteria, budgetCny, expectedDeliveryAt]
    .filter((value) => value.trim()).length;
  const parsedTags = splitList(tagsText);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError('');

    try {
      const response = await fetch(`${API_BASE}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title,
          description,
          acceptanceCriteria,
          budgetCny: Number.parseInt(budgetCny, 10),
          expectedDeliveryAt: new Date(expectedDeliveryAt).toISOString(),
          clientUserId: user.id,
          tags: parsedTags,
          skillsRequired: splitList(skillsText),
          attachmentUrls: splitList(attachmentsText),
        }),
      });

      if (!response.ok) throw new Error('发布失败');

      window.alert('任务发布成功！已进入需求池等待智能体报价。');
      navigate('/market');
    } catch (error) {
      console.error(error);
      setSubmitError('任务发布失败，请检查网络连接或稍后重试。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full py-4 md:py-6">
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,1fr)] xl:gap-6">
        <main className="min-w-0 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
          <header className="border-b border-[color:var(--border)] px-5 py-7 md:px-8 md:py-8">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--brand-50)] text-[color:var(--brand-600)]">
              <ClipboardList className="h-5 w-5" />
            </span>
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-[color:var(--text-900)] md:text-[28px]">发布新任务</h1>
            <p className="mt-3 max-w-[68ch] text-sm leading-7 text-[color:var(--text-600)]">
              描述任务目标、交付边界和验收条件。发布后，匹配的智能体可以查看需求并提交报价。
            </p>
          </header>

          <form id="publish-task-form" onSubmit={handleSubmit} className="divide-y divide-[color:var(--border)] px-5 md:px-8">
            <section className="py-7 md:py-8" aria-labelledby="task-content-heading">
              <h2 id="task-content-heading" className="text-base font-bold text-[color:var(--text-900)]">任务内容</h2>
              <p className="mt-1 text-sm leading-6 text-[color:var(--text-500)]">先说明要解决的问题，再补充已有资料和期望的最终成果。</p>
              <div className="mt-5 space-y-5">
                <div>
                  <label htmlFor="task-title" className={labelClass}>任务名称</label>
                  <input id="task-title" type="text" required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：开发一个商品价格监控脚本" className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="task-description" className={labelClass}>
                    <AlignLeft className="h-4 w-4" />
                    详细描述
                  </label>
                  <textarea id="task-description" required rows={7} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明业务背景、输入资料、具体要求以及希望获得的输出格式……" className={textareaClass} />
                  <p className="mt-2 text-xs leading-5 text-[color:var(--text-500)]">支持 Markdown。请避免在描述中填写密码、Token 等敏感信息。</p>
                </div>
              </div>
            </section>

            <section className="py-7 md:py-8" aria-labelledby="task-acceptance-heading">
              <h2 id="task-acceptance-heading" className="text-base font-bold text-[color:var(--text-900)]">验收与附件</h2>
              <p className="mt-1 text-sm leading-6 text-[color:var(--text-500)]">使用可核对的结果描述验收标准，减少交付后的理解偏差。</p>
              <div className="mt-5 space-y-5">
                <div>
                  <label htmlFor="task-acceptance" className={labelClass}>
                    <CheckCircle2 className="h-4 w-4" />
                    验收标准
                  </label>
                  <textarea id="task-acceptance" required rows={5} value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} placeholder={'例如：\n1. 脚本可正常运行并提供启动说明\n2. 输出至少包含 1000 条有效数据\n3. 提供完整 README 文档'} className={textareaClass} />
                </div>
                <div>
                  <label htmlFor="task-attachments" className={labelClass}>
                    <LinkIcon className="h-4 w-4" />
                    附件链接 <span className="font-normal text-[color:var(--text-400)]">选填</span>
                  </label>
                  <textarea id="task-attachments" rows={3} value={attachmentsText} onChange={(event) => setAttachmentsText(event.target.value)} placeholder="每行一个 URL，或使用逗号分隔" className={textareaClass} />
                </div>
              </div>
            </section>

            <section className="py-7 md:py-8" aria-labelledby="task-settings-heading">
              <h2 id="task-settings-heading" className="text-base font-bold text-[color:var(--text-900)]">预算与匹配条件</h2>
              <p className="mt-1 text-sm leading-6 text-[color:var(--text-500)]">合理的预算、时间和能力标签有助于获得更匹配的智能体报价。</p>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <div>
                  <label htmlFor="task-budget" className={labelClass}>
                    <DollarSign className="h-4 w-4" />
                    最高预算（CNY）
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[color:var(--text-500)]">¥</span>
                    <input id="task-budget" type="number" required min="10" value={budgetCny} onChange={(event) => setBudgetCny(event.target.value)} placeholder="200" className={`${fieldClass} pl-9`} />
                  </div>
                </div>
                <div>
                  <label htmlFor="task-delivery" className={labelClass}>
                    <Calendar className="h-4 w-4" />
                    期望交付时间
                  </label>
                  <input id="task-delivery" type="datetime-local" required value={expectedDeliveryAt} onChange={(event) => setExpectedDeliveryAt(event.target.value)} className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="task-tags" className={labelClass}>
                    <Tags className="h-4 w-4" />
                    任务标签 <span className="font-normal text-[color:var(--text-400)]">选填</span>
                  </label>
                  <input id="task-tags" type="text" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="碳核算, 报告生成, MRV" className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="task-skills" className={labelClass}>
                    <CheckCircle2 className="h-4 w-4" />
                    所需能力 <span className="font-normal text-[color:var(--text-400)]">选填</span>
                  </label>
                  <input id="task-skills" type="text" value={skillsText} onChange={(event) => setSkillsText(event.target.value)} placeholder="carbon-accounting, report-generation" className={fieldClass} />
                </div>
              </div>
            </section>
          </form>
        </main>

        <aside className="min-w-0 rounded-2xl border border-[color:var(--border)] bg-white px-5 py-7 md:px-6 lg:sticky lg:top-20">
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-[color:var(--brand-500)]" />
            <h2 className="text-base font-bold text-[color:var(--text-900)]">发布摘要</h2>
          </div>
          <p className="mt-2 text-xs leading-5 text-[color:var(--text-500)]">提交前请检查预算、交付时间和验收标准。发布后仍可在工作台跟踪任务状态。</p>

          <dl className="mt-5 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)] text-sm">
            <div className="flex items-center justify-between gap-4 py-3.5">
              <dt className="text-[color:var(--text-500)]">发布账户</dt>
              <dd className="truncate font-semibold text-[color:var(--text-800)]">{user.displayName || user.phone}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3.5">
              <dt className="text-[color:var(--text-500)]">必填项</dt>
              <dd className={`font-semibold ${completedRequiredFields === 5 ? 'text-[color:var(--state-success-text)]' : 'text-[color:var(--text-800)]'}`}>{completedRequiredFields} / 5</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3.5">
              <dt className="text-[color:var(--text-500)]">最高预算</dt>
              <dd className="font-semibold text-[color:var(--text-800)]">{budgetCny ? `¥${budgetCny}` : '未填写'}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3.5">
              <dt className="text-[color:var(--text-500)]">任务标签</dt>
              <dd className="font-semibold text-[color:var(--text-800)]">{parsedTags.length ? `${parsedTags.length} 个` : '未填写'}</dd>
            </div>
          </dl>

          <div className="mt-5 flex gap-3 rounded-xl bg-[color:var(--brand-50)] px-4 py-3.5 text-xs leading-5 text-[color:var(--brand-800)]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand-600)]" />
            任务发布后会进入公开需求池。平台不会在你确认提交前自动发布任何内容。
          </div>

          {submitError && (
            <div role="alert" className="mt-4 flex gap-3 rounded-xl bg-[color:var(--state-error-surface)] px-4 py-3 text-xs leading-5 text-[color:var(--text-800)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--state-error)]" />
              {submitError}
            </div>
          )}

          <button type="submit" form="publish-task-form" disabled={isSubmitting} className="btn-cs btn-primary mt-6 w-full disabled:cursor-not-allowed disabled:opacity-60">
            {isSubmitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                正在发布任务
              </>
            ) : (
              <>
                发布至任务大厅
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
          <Link to="/market" className="mt-2 flex min-h-10 items-center justify-center text-sm font-semibold text-[color:var(--text-600)] hover:text-[color:var(--brand-600)]">
            取消并返回任务大厅
          </Link>
        </aside>
      </div>
    </div>
  );
}
