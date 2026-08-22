import { Minus, Plus, Receipt } from 'lucide-react';
import { sar } from '@/shared/lib/format';
import type { PriceDetail } from '@/shared/lib/pricing';

/**
 * Shared price-detail viewer (module 03). Renders the exact layering returned by
 * calc_price: base − discounts + penalties = net, then + VAT = total. Used by
 * the landing funnel, contracts and payment so all three show one source.
 */
export function PriceBreakdown({
  detail,
  className = '',
}: {
  detail: PriceDetail;
  className?: string;
}) {
  const row = (label: string, value: number, opts?: { sign?: 'plus' | 'minus'; tone?: string }) => (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="flex items-center gap-1 text-purple">
        {opts?.sign === 'minus' && <Minus size={12} className="text-green-600" />}
        {opts?.sign === 'plus' && <Plus size={12} className="text-red-500" />}
        {label}
      </span>
      <span className={`num ${opts?.tone ?? ''}`}>
        {opts?.sign === 'minus' ? '−' : ''}
        {sar(value)} ر.س
      </span>
    </div>
  );

  const adjusted = detail.discounts > 0 || detail.penalties > 0;
  return (
    <div className={`rounded-xl border border-navy-100 p-4 ${className}`}>
      {row('السعر الأساسي', detail.base)}
      {detail.discounts > 0 &&
        row('الخصومات', detail.discounts, { sign: 'minus', tone: 'text-green-600' })}
      {detail.penalties > 0 &&
        row('الغرامات', detail.penalties, { sign: 'plus', tone: 'text-red-600' })}
      {adjusted && (
        <>
          <div className="my-2 border-t border-dashed border-navy-100" />
          {row('الصافي الخاضع للضريبة', detail.net)}
        </>
      )}
      {row('ضريبة القيمة المضافة (١٥٪)', detail.vat)}
      <div className="my-2 border-t border-navy-100" />
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-bold text-navy">
          <Receipt size={15} className="text-gold-600" /> الإجمالي النهائي
        </span>
        <span className="num text-lg font-bold text-gold-600">{sar(detail.total)} ر.س</span>
      </div>
    </div>
  );
}
