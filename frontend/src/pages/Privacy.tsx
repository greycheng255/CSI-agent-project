import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

type Section = {
  id: string;
  title: string;
  clauses: string[];
};

const sections: Section[] = [
  {
    id: 'privacy-intro',
    title: '一、引言与适用范围',
    clauses: [
      '1.1 碳硅 Genesis（下称“平台”）重视用户个人信息保护。本政策说明我们收集哪些信息、如何使用与保护这些信息，以及你可以如何行使相关权利。',
      '1.2 本政策适用于你在注册登录、实名认证、发布任务、竞价、支付结算、交付验收与争议处理等环节中使用平台服务的情形。',
    ],
  },
  {
    id: 'privacy-collect',
    title: '二、我们收集的信息',
    clauses: [
      '2.1 账号与身份信息：注册时提供的手机号及发送、校验短信验证码所需信息；实名认证时提供的真实姓名与身份证号。',
      '2.2 实名信息安全：身份证号在服务端以加密方式存储、不以明文落库，在页面与凭证中仅以掩码形式展示（例如 110***********001X），用于确认交易主体身份。',
      '2.3 交易与资金信息：任务内容、报价与竞价记录、订单金额、托管支付状态（未支付 / 已支付托管 / 已结算）、结算与退款记录，以及收款或提现所需的必要信息。',
      '2.4 使用与设备信息：登录时间、操作日志、设备与浏览器类型、网络地址等，用于安全风控与服务故障排查。',
    ],
  },
  {
    id: 'privacy-use',
    title: '三、信息的使用用途',
    clauses: [
      '3.1 用于账号注册登录、手机号验证与实名身份核验，确保交易主体真实、可追溯。',
      '3.2 用于任务的发布、竞价撮合、下单支付、资金托管、交付验收、结算退款与售后申诉等核心交易流程。',
      '3.3 用于识别与防范虚假任务、刷单、规避平台交易等违规行为，并在发生争议时支撑仲裁裁定。',
      '3.4 用于向你发送中标、支付、交付与验收等交易通知，以及在你同意的前提下发送服务与产品信息。',
    ],
  },
  {
    id: 'privacy-storage',
    title: '四、信息的存储与保护',
    clauses: [
      '4.1 我们仅在实现本政策所述目的所必需的期限内保留你的个人信息，法律法规另有规定的从其规定；超出期限后予以删除或匿名化处理。',
      '4.2 我们采取传输加密、敏感字段加密存储、访问权限控制与操作审计等措施，防止信息被未经授权地访问、泄露、篡改或毁损。',
      '4.3 若发生个人信息安全事件，我们将依法及时采取补救措施，并以合理方式告知你可能受到的影响。',
    ],
  },
  {
    id: 'privacy-sharing',
    title: '五、信息的对外提供',
    clauses: [
      '5.1 为完成支付、短信验证与结算等必需环节，我们可能向合作的支付机构、电信运营商等提供实现该功能所必需的最少信息。',
      '5.2 在交易双方履行订单所必需的范围内，对方可看到与交易相关的必要信息（如任务内容、报价、订单状态），但我们不会向其提供你的身份证号等敏感信息。',
      '5.3 除法律法规要求、司法机关或行政机关依法提出要求，或为保护用户与公众合法权益所必需外，我们不会出售或对外提供你的个人信息。',
    ],
  },
  {
    id: 'privacy-rights',
    title: '六、你的权利',
    clauses: [
      '6.1 你可以随时在个人中心查询账号资料、实名认证状态与交易记录，并对昵称等可修改的信息进行更正。',
      '6.2 如发现我们处理的你的个人信息有误，可申请更正；如你希望注销账号，可通过第八条的联系方式提出申请，我们将在你结清未完成的交易与资金后予以处理。',
      '6.3 你可以要求我们说明个人信息的使用情况，或在法律允许的范围内要求删除相关信息、撤回此前作出的同意。',
    ],
  },
  {
    id: 'privacy-minor',
    title: '七、未成年人保护',
    clauses: [
      '7.1 平台服务面向具备完全民事行为能力的用户。若你不具备相应民事行为能力，请在监护人陪同下阅读本政策并决定是否使用平台服务。',
    ],
  },
  {
    id: 'privacy-update',
    title: '八、政策更新与联系方式',
    clauses: [
      '8.1 本政策可能随服务调整而更新，更新内容在平台公示后生效；涉及你重要权益的变更，我们将以显著方式提示。',
      '8.2 如你对本政策或个人信息处理有任何疑问、意见或投诉，可通过以下方式联系我们，我们将在合理期限内答复：电子邮箱 greycheng255@gmail.com。',
    ],
  },
];

export default function Privacy() {
  return (
    <div className="mx-auto w-full max-w-3xl py-4 pb-12 md:py-6">
      <header className="rounded-2xl border border-[color:var(--border)] bg-white px-5 py-7 md:px-8 md:py-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--brand-50)] text-[color:var(--brand-600)]">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-[color:var(--text-900)] md:text-[30px]">隐私政策</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-[color:var(--text-600)]">
          本政策说明碳硅 Genesis 在提供智能体交易服务时如何收集、使用、存储与保护你的个人信息，以及你可以如何管理这些信息。
        </p>
        <p className="mt-3 text-xs leading-6 text-[color:var(--text-500)]">
          最近更新日期：2026 年 9 月。实名身份证号加密存储、仅展示掩码等做法与平台实际数据保护措施一致。
        </p>
      </header>

      <nav aria-label="隐私政策目录" className="mt-6 rounded-2xl border border-[color:var(--border)] bg-white px-5 py-6 md:px-8">
        <h2 className="text-xs font-bold text-[color:var(--text-400)]">目录</h2>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="flex min-h-10 items-center rounded-lg px-2 text-sm font-medium text-[color:var(--text-600)] transition-colors hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-700)]"
              >
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <article className="mt-6 divide-y divide-[color:var(--border)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white px-5 md:px-8">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-24 py-7 md:py-8">
            <h2 className="text-base font-bold text-[color:var(--text-900)]">{section.title}</h2>
            <div className="mt-4 space-y-3">
              {section.clauses.map((clause) => (
                <p key={clause} className="text-sm leading-7 text-[color:var(--text-600)]">
                  {clause}
                </p>
              ))}
            </div>
          </section>
        ))}
      </article>

      <p className="mt-6 text-sm leading-7 text-[color:var(--text-500)]">
        关于平台交易规则与责任约定，请阅读
        <Link to="/terms" className="link-cs mx-1">服务条款</Link>
        。
      </p>
    </div>
  );
}