/** مصروف الحملات الفعلي (campaign_spend — 0099): قيود لا تُعدَّل، والتصحيح بقيد عكس. */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';

export interface SpendEntry {
  id: string;
  campaign_id: string;
  spend_date: string;
  amount: number;
  reference: string | null;
  note: string | null;
  reverses_id: string | null;
  created_at: string;
}

const DEMO: SpendEntry[] = [];
export function resetSpendDemo(): void {
  DEMO.length = 0;
}
export function demoSpend(): SpendEntry[] {
  return DEMO.map((s) => ({ ...s }));
}
const demo = (id: string) => isDemoMode() || isDemoId(id);
const today = () => new Date().toISOString().slice(0, 10);

export const spendSchema = z.object({
  spend_date: z
    .string()
    .min(1, { message: 'حدّد تاريخ المصروف' })
    .refine((d) => d <= today(), { message: 'تاريخ المصروف لا يكون في المستقبل' }),
  amount: z.number().positive({ message: 'المبلغ يجب أن يكون أكبر من صفر' }),
  reference: z.string().trim().max(60).optional(),
  note: z.string().trim().max(200).optional(),
});
export type SpendInput = z.input<typeof spendSchema>;

export async function listSpend(campaignId: string): Promise<SpendEntry[]> {
  if (demo(campaignId))
    return DEMO.filter((s) => s.campaign_id === campaignId).map((s) => ({ ...s }));
  const { data, error } = await supabase
    .from('campaign_spend')
    .select('id, campaign_id, spend_date, amount, reference, note, reverses_id, created_at')
    .eq('campaign_id', campaignId)
    .order('spend_date', { ascending: false });
  if (error) throw new Error(`تعذّر جلب المصروف: ${error.message}`);
  return ((data ?? []) as SpendEntry[]).map((s) => ({ ...s, amount: Number(s.amount) }));
}

export async function addSpend(campaignId: string, input: SpendInput): Promise<void> {
  const p = spendSchema.parse(input);
  if (demo(campaignId)) {
    DEMO.push({
      id: `sp-${Date.now()}-${DEMO.length}`,
      campaign_id: campaignId,
      spend_date: p.spend_date,
      amount: Math.round(p.amount * 100) / 100,
      reference: p.reference?.trim() || null,
      note: p.note?.trim() || null,
      reverses_id: null,
      created_at: new Date().toISOString(),
    });
    return;
  }
  const { error } = await supabase.rpc('add_campaign_spend', {
    p_campaign: campaignId,
    p_date: p.spend_date,
    p_amount: p.amount,
    p_reference: p.reference?.trim() || null,
    p_note: p.note?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function reverseSpend(entry: SpendEntry, reason: string): Promise<void> {
  if (reason.trim().length < 5) throw new Error('سبب العكس مطلوب');
  if (entry.reverses_id) throw new Error('قيد عكس لا يُعكس');
  if (demo(entry.campaign_id)) {
    if (DEMO.some((s) => s.reverses_id === entry.id)) throw new Error('القيد معكوس مسبقاً');
    DEMO.push({
      ...entry,
      id: `sp-${Date.now()}-r`,
      spend_date: today(),
      amount: -entry.amount,
      note: `عكس: ${reason.trim()}`,
      reverses_id: entry.id,
      created_at: new Date().toISOString(),
    });
    return;
  }
  const { error } = await supabase.rpc('reverse_campaign_spend', {
    p_id: entry.id,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}
