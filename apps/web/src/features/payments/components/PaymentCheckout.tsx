import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Lock, ReceiptText } from 'lucide-react';
import { Button, Card, EmptyState, Skeleton } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { useInvoice, useRecordPayment } from '@/features/payments/hooks/usePayments';
import { PAYMENT_METHODS } from '@/features/payments/types';

export default function PaymentCheckout() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: invoice, isLoading } = useInvoice(id);
  const pay = useRecordPayment();
  const [method, setMethod] = useState('mada');
  const [processing, setProcessing] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <Skeleton className="h-48 w-full" />
      </Card>
    );
  }
  if (!invoice) {
    return <EmptyState icon={ReceiptText} title="الفاتورة غير موجودة" />;
  }

  async function submit() {
    if (!invoice) return;
    setProcessing(true);
    // TODO(payments): replace stub with Moyasar/Tamara. Simulated success.
    await new Promise((r) => setTimeout(r, 1200));
    const res = await pay.mutateAsync({ invoiceId: invoice.id, method, amount: invoice.total });
    setProcessing(false);
    navigate('/payments/success', {
      state: {
        reference_no: res.reference_no,
        total: invoice.total,
        method,
        contract_no: invoice.contract_no,
        customer_name: invoice.customer_name,
      },
    });
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link
        to="/payments"
        className="mb-4 inline-flex items-center gap-1 text-sm text-purple hover:text-navy"
      >
        <ArrowRight size={16} /> العودة للمدفوعات
      </Link>

      <Card>
        <h1 className="text-lg font-bold text-navy">إتمام الدفع</h1>
        <p className="mt-1 text-sm text-purple">
          العقد <span className="num">{invoice.contract_no}</span> — {invoice.customer_name}
        </p>

        <div className="mt-5 rounded-xl border border-navy-100 p-4">
          <div className="flex items-center justify-between py-1 text-sm">
            <span className="text-purple">السعر الأساسي</span>
            <span className="num">{sar(invoice.base)} ر.س</span>
          </div>
          <div className="flex items-center justify-between py-1 text-sm">
            <span className="text-purple">ضريبة القيمة المضافة (١٥٪)</span>
            <span className="num">{sar(invoice.vat)} ر.س</span>
          </div>
          <div className="my-2 border-t border-navy-100" />
          <div className="flex items-center justify-between">
            <span className="font-bold text-navy">المبلغ المطلوب</span>
            <span className="num text-lg font-bold text-gold-600">{sar(invoice.total)} ر.س</span>
          </div>
        </div>

        <p className="mb-3 mt-6 text-sm font-semibold text-navy">اختر وسيلة الدفع</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMethod(m.key)}
              className={`flex items-center gap-3 rounded-xl border p-3.5 text-right transition ${
                method === m.key ? 'border-navy bg-navy-50' : 'border-navy-100 hover:border-navy'
              }`}
            >
              <m.icon size={20} className="text-navy" />
              <span className="text-sm font-medium text-navy-900">{m.label}</span>
            </button>
          ))}
        </div>

        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          بيئة تجريبية: الدفع محاكاة فقط (سيُربط Moyasar لاحقًا). لن يتم خصم أي مبلغ.
        </p>

        <Button onClick={submit} loading={processing} className="mt-5 w-full">
          <Lock size={16} /> ادفع {sar(invoice.total)} ر.س
        </Button>
      </Card>
    </div>
  );
}
