import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { DollarSign, QrCode, Receipt, CreditCard } from 'lucide-react';
import PaymentCodes from './PaymentCodes';
import MyReceipts from './MyReceipts';
import MyPayments from './MyPayments';

type Tab = 'codes' | 'receipts' | 'payments';

export default function FinanceManagement() {
  const { user, admin } = useAuthStore();
  const navigate = useNavigate();

  if (!user && !admin) { navigate('/login'); return null; }

  const [activeTab, setActiveTab] = useState<Tab>('codes');

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'codes', label: '收款码', icon: <QrCode className="w-4 h-4" /> },
    { key: 'receipts', label: '收款记录', icon: <Receipt className="w-4 h-4" /> },
    { key: 'payments', label: '支付记录', icon: <CreditCard className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign className="w-6 h-6 text-blue-400" />
        <h1 className="text-2xl font-bold">收支管理</h1>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 bg-[#111] border border-gray-800 rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === t.key ? 'bg-blue-500/10 text-blue-400' : 'text-gray-500 hover:text-gray-400'
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
