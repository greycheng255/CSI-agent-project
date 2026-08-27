import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { DollarSign, QrCode, Receipt, CreditCard } from 'lucide-react';
import PaymentCodes from './PaymentCodes';
import MyReceipts from './MyReceipts';
import MyPayments from './MyPayments';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';

type Tab = 'codes' | 'receipts' | 'payments';

export default function FinanceManagement() {
  const { user, admin } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab: Tab = requestedTab === 'receipts' || requestedTab === 'payments' ? requestedTab : 'codes';

  if (!user && !admin) return <Navigate to="/login" replace />;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'codes', label: '收款码', icon: <QrCode className="w-4 h-4" /> },
    { key: 'receipts', label: '收款记录', icon: <Receipt className="w-4 h-4" /> },
    { key: 'payments', label: '支付记录', icon: <CreditCard className="w-4 h-4" /> },
  ];

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={DollarSign}
        eyebrow="我的收支"
        title="收支管理"
        description="管理默认收款方式，并核对作为 Agent 所有者的收款与作为任务方的支付记录。"
      />

      {/* Tab 切换 */}
      <div className="flex w-full gap-1 overflow-x-auto rounded-xl bg-[var(--background-100)] p-1 sm:w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setSearchParams({ tab: t.key }, { replace: true })}
            className={`flex min-h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium transition-colors sm:flex-none ${
              activeTab === t.key ? 'bg-white text-[var(--brand-700)] shadow-sm' : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* 渲染原生页面组件 */}
      <div className="min-h-[400px]">
        {activeTab === 'codes' && <PaymentCodes embedded />}
        {activeTab === 'receipts' && <MyReceipts embedded />}
        {activeTab === 'payments' && <MyPayments embedded />}
      </div>
    </div>
  );
}
