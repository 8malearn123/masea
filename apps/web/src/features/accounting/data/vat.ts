import type { JournalEntry, VatReturn } from '@/features/accounting/types';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Compute a period's VAT return from the journal — mirror of compute_vat_return
 * (0032_vat.sql): output VAT (2120) − input VAT (1140). Bases are derived from
 * the tax amounts and the configured rate.
 */
export function computeVatReturn(entries: JournalEntry[], period: string, rate = 0.15): VatReturn {
  let output = 0;
  let input = 0;
  for (const e of entries) {
    if (e.status !== 'posted' || !e.entry_date.startsWith(period)) continue;
    for (const l of e.lines) {
      if (l.account_code === '2120') output += l.credit - l.debit;
      else if (l.account_code === '1140') input += l.debit - l.credit;
    }
  }
  output = round2(output);
  input = round2(input);
  return {
    period,
    output_vat: output,
    input_vat: input,
    net_vat: round2(output - input),
    sales_base: rate > 0 ? round2(output / rate) : 0,
    purchases_base: rate > 0 ? round2(input / rate) : 0,
  };
}
