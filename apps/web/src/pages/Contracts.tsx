import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { contractStatusLabel, serviceTypeLabel } from '@masiat/shared';
import type { Contract, ContractStatus } from '@masiat/shared';
import { sar, dateAr } from '@/lib/format';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';

const statusColor: Record<ContractStatus, string> = {
  draft: 'bg-navy-50 text-navy',
  active: 'bg-teal-100 text-teal',
  completed: 'bg-purple-100 text-purple',
  cancelled: 'bg-red-100 text-red-700',
};

type Row = Contract & { customers?: { full_name: string } | null };

async function fetchContracts(): Promise<Row[]> {
  const { data, error } = await supabase
    .from('contracts')
    .select('*, customers(full_name)')
    .order('contract_number', { ascending: false });
  if (error) throw error;
  return (data as Row[]) ?? [];
}

export default function Contracts() {
  const { data, isLoading } = useQuery({ queryKey: ['contracts'], queryFn: fetchContracts });

  return (
    <div>
      <PageHeader
        title="العقود"
        subtitle="عقود الخدمة والمدفوعات"
        action={<button className="btn-primary">+ عقد جديد</button>}
      />
      <DataTable<Row>
        isLoading={isLoading}
        rows={data ?? []}
        columns={[
          { key: 'contract_number', header: 'رقم', render: (r) => <span className="num">#{r.contract_number}</span> },
          { key: 'customer', header: 'العميل', render: (r) => r.customers?.full_name ?? '—' },
          { key: 'service_type', header: 'الخدمة', render: (r) => serviceTypeLabel[r.service_type] },
          { key: 'start_date', header: 'البداية', render: (r) => dateAr(r.start_date) },
          { key: 'total_amount', header: 'الإجمالي', render: (r) => <span className="num">{sar(r.total_amount)}</span> },
          { key: 'amount_paid', header: 'المدفوع', render: (r) => <span className="num">{sar(r.amount_paid)}</span> },
          {
            key: 'status',
            header: 'الحالة',
            render: (r) => <span className={`badge ${statusColor[r.status]}`}>{contractStatusLabel[r.status]}</span>,
          },
        ]}
      />
    </div>
  );
}
