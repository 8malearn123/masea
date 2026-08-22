import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { segmentLabel } from '@masiat/shared';
import type { Customer, CustomerSegment } from '@masiat/shared';
import { sar } from '@/lib/format';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';

const segColor: Record<CustomerSegment, string> = {
  bronze: 'bg-amber-100 text-amber-700',
  silver: 'bg-navy-50 text-navy',
  gold: 'bg-gold-100 text-gold-600',
};

async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Customer[]) ?? [];
}

export default function Customers() {
  const { data, isLoading } = useQuery({ queryKey: ['customers'], queryFn: fetchCustomers });

  return (
    <div>
      <PageHeader
        title="العملاء"
        subtitle="قاعدة العملاء ونقاط الولاء"
        action={<button className="btn-primary">+ عميل جديد</button>}
      />
      <DataTable<Customer>
        isLoading={isLoading}
        rows={data ?? []}
        columns={[
          { key: 'full_name', header: 'الاسم' },
          { key: 'phone', header: 'الجوال', render: (r) => <span className="num">{r.phone ?? '—'}</span> },
          { key: 'city', header: 'المدينة', render: (r) => r.city ?? '—' },
          {
            key: 'loyalty_points',
            header: 'النقاط',
            render: (r) => <span className="num">{r.loyalty_points}</span>,
          },
          {
            key: 'wallet_balance',
            header: 'المحفظة',
            render: (r) => <span className="num">{sar(r.wallet_balance)}</span>,
          },
          {
            key: 'segment',
            header: 'الفئة',
            render: (r) => <span className={`badge ${segColor[r.segment]}`}>{segmentLabel[r.segment]}</span>,
          },
        ]}
      />
    </div>
  );
}
