import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { workerStatusLabel } from '@masiat/shared';
import type { Worker, WorkerStatus } from '@masiat/shared';
import { sar } from '@/lib/format';
import PageHeader from '@/components/PageHeader';
import DataTable from '@/components/DataTable';

const statusColor: Record<WorkerStatus, string> = {
  available: 'bg-teal-100 text-teal',
  on_service: 'bg-navy-50 text-navy',
  absent: 'bg-amber-100 text-amber-700',
  medical: 'bg-purple-100 text-purple',
  terminated: 'bg-red-100 text-red-700',
};

async function fetchWorkers(): Promise<Worker[]> {
  const { data, error } = await supabase
    .from('workers')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Worker[]) ?? [];
}

export default function Workers() {
  const { data, isLoading } = useQuery({ queryKey: ['workers'], queryFn: fetchWorkers });

  return (
    <div>
      <PageHeader
        title="العمالة"
        subtitle="إدارة بيانات العمالة والحالة"
        action={<button className="btn-primary">+ عامل جديد</button>}
      />
      <DataTable<Worker>
        isLoading={isLoading}
        rows={data ?? []}
        columns={[
          { key: 'full_name', header: 'الاسم' },
          { key: 'profession', header: 'المهنة', render: (r) => r.profession ?? '—' },
          { key: 'nationality', header: 'الجنسية', render: (r) => r.nationality ?? '—' },
          {
            key: 'daily_rate',
            header: 'اليومي',
            render: (r) => <span className="num">{sar(r.daily_rate)}</span>,
          },
          {
            key: 'barcode',
            header: 'الباركود',
            render: (r) => <span className="num text-xs">{r.barcode ?? '—'}</span>,
          },
          {
            key: 'status',
            header: 'الحالة',
            render: (r) => (
              <span className={`badge ${statusColor[r.status]}`}>{workerStatusLabel[r.status]}</span>
            ),
          },
        ]}
      />
    </div>
  );
}
