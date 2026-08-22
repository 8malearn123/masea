import { Link, useLocation } from 'react-router-dom';
import { Check, FileText, Wallet } from 'lucide-react';
import { Card } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { METHOD_LABEL } from '@/features/payments/types';

interface SuccessState {
  reference_no: string;
  total: number;
  method: string;
  contract_no: string;
  customer_name: string;
}

export default function PaymentSuccess() {
  const location = useLocation();
  const state = location.state as SuccessState | null;

  return (
    <div className="mx-auto max-w-lg">
      <Card className="text-center">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-green-100 text-green-600">
          <Check size={40} strokeWidth={2.5} />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-navy">تمت عملية الدفع بنجاح</h1>
        <p className="mt-1 text-sm text-purple">شكرًا لك — تم تسجيل الدفعة وإصدار الإيصال.</p>

        <div className="mt-7 rounded-2xl border border-navy-100 p-5 text-right">
          <Row label="رقم العملية" value={<span className="num font-bold text-gold-600">{state?.reference_no ?? '—'}</span>} />
          <Row label="العقد" value={<span className="num">{state?.contract_no ?? '—'}</span>} />
          <Row label="العميل" value={state?.customer_name ?? '—'} />
          <Row label="وسيلة الدفع" value={state ? METHOD_LABEL[state.method] ?? state.method : '—'} />
          <Row label="التاريخ" value={<span className="num">{dateAr(new Date().toISOString())}</span>} />
          <div className="my-2 border-t border-navy-100" />
          <Row label="المبلغ المدفوع" value={<span className="num text-lg font-bold text-green-600">{sar(state?.total ?? 0)} ر.س</span>} strong />
        </div>

        <div className="mt-6 flex justify-center gap-3">
          <Link to="/payments" className="btn-primary gap-2">
            <Wallet size={16} /> المدفوعات
          </Link>
          <Link to="/contracts" className="btn-ghost gap-2 border border-navy-100">
            <FileText size={16} /> العقود
          </Link>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={strong ? 'font-bold text-navy' : 'text-sm text-purple'}>{label}</span>
      <span className="text-sm font-medium text-navy-900">{value}</span>
    </div>
  );
}
