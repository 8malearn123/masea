import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isIgnorableWriteError } from '@/shared/lib/demoBackend';

export interface CustomerLite {
  id: string;
  full_name: string;
  phone: string | null;
  city: string | null;
}

const FALLBACK: CustomerLite[] = [
  { id: 'cust-1', full_name: 'محمد الأحمدي', phone: '0501234567', city: 'نجران' },
  { id: 'cust-2', full_name: 'سارة القحطاني', phone: '0552345678', city: 'جازان' },
  { id: 'cust-3', full_name: 'فهد العنزي', phone: '0533456789', city: 'شرورة' },
  { id: 'cust-4', full_name: 'نورة الشهري', phone: '0544567890', city: 'نجران' },
];

export async function searchCustomers(q: string): Promise<CustomerLite[]> {
  try {
    let query = supabase.from('customers').select('id, full_name, phone, city').limit(20);
    if (q.trim()) query = query.ilike('full_name', `%${q.trim()}%`);
    const { data, error } = await query;
    if (!error && data && data.length > 0) return data as CustomerLite[];
  } catch {
    /* fall through */
  }
  const s = q.trim();
  return s ? FALLBACK.filter((c) => c.full_name.includes(s)) : FALLBACK;
}

/** New customer from the contract wizard — validated before it reaches the backend. */
export const newCustomerSchema = z.object({
  full_name: z.string().trim().min(3, { message: 'أدخل اسم العميل كاملاً' }),
  phone: z
    .string()
    .trim()
    .regex(/^05\d{8}$/, { message: 'رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام' }),
  city: z.string().trim(),
});

export async function createCustomer(raw: {
  full_name: string;
  phone: string;
  city: string;
}): Promise<CustomerLite> {
  const parsed = newCustomerSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? 'بيانات العميل غير صحيحة');
  const input = parsed.data;
  const { data, error } = await supabase
    .from('customers')
    .insert({ full_name: input.full_name, phone: input.phone, city: input.city })
    .select('id, full_name, phone, city')
    .single();
  // Backend not provisioned → return a local demo customer so the flow continues.
  if (error) {
    if (isIgnorableWriteError(error.message)) {
      const local: CustomerLite = {
        id: `cust-${Date.now()}`,
        full_name: input.full_name,
        phone: input.phone,
        city: input.city || null,
      };
      FALLBACK.unshift(local); // searchable for the rest of the session
      return local;
    }
    throw new Error(error.message);
  }
  return data as CustomerLite;
}
