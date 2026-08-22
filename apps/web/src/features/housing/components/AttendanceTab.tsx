import { useMemo, useState } from 'react';
import { CalendarCheck, UserRound } from 'lucide-react';
import { Card, Input, Select, Table, type Column } from '@/shared/ui';
import { BRANCHES_AR } from '@/lib/funnel';
import { useMarkAttendance, useResidents } from '@/features/housing/hooks/useHousing';
import {
  RESIDENT_STATUS_LABEL,
  type Resident,
  type ResidentStatus,
} from '@/features/housing/types';

const STATUS_OPTIONS = (Object.entries(RESIDENT_STATUS_LABEL) as [ResidentStatus, string][]).map(
  ([value, label]) => ({ value, label }),
);

export function AttendanceTab() {
  const { data: residents = [], isLoading, isError, refetch } = useResidents();
  const mark = useMarkAttendance();
  const [branch, setBranch] = useState('all');
  const [search, setSearch] = useState('');

  const rows = useMemo(
    () =>
      residents.filter(
        (r) =>
          (branch === 'all' || r.branch === branch) &&
          (!search.trim() || r.full_name.includes(search.trim())),
      ),
    [residents, branch, search],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { present: 0, absent: 0, on_service: 0, medical: 0 };
    rows.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1));
    return c;
  }, [rows]);

  const columns: Column<Resident>[] = [
    {
      key: 'full_name',
      header: 'العاملة',
      cell: (r) => <span className="font-semibold text-navy">{r.full_name}</span>,
    },
    { key: 'nationality', header: 'الجنسية', cell: (r) => r.nationality },
    { key: 'dorm', header: 'السكن', cell: (r) => r.dorm },
    {
      key: 'status',
      header: 'حالة اليوم',
      cell: (r) => (
        <Select
          value={r.status}
          onChange={(e) => mark.mutate({ id: r.id, status: e.target.value as ResidentStatus })}
          options={STATUS_OPTIONS}
          className="w-36"
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="py-3">
          <p className="text-xs text-purple">حاضرة</p>
          <p className="num mt-1 text-xl font-bold text-green-600">{counts.present}</p>
        </Card>
        <Card className="py-3">
          <p className="text-xs text-purple">غائبة</p>
          <p className="num mt-1 text-xl font-bold text-red-600">{counts.absent}</p>
        </Card>
        <Card className="py-3">
          <p className="text-xs text-purple">في خدمة</p>
          <p className="num mt-1 text-xl font-bold text-navy">{counts.on_service}</p>
        </Card>
        <Card className="py-3">
          <p className="text-xs text-purple">إجازة مرضية</p>
          <p className="num mt-1 text-xl font-bold text-gold-600">{counts.medical}</p>
        </Card>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="relative">
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
              <UserRound size={16} />
            </span>
            <Input
              placeholder="بحث باسم العاملة"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
          <Select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={[
              { value: 'all', label: 'كل الفروع' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
          />
        </div>
      </Card>

      <div>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <CalendarCheck size={16} /> تحضير العاملات اليوم
        </h2>
        <Table
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          emptyTitle="لا توجد عاملات"
        />
      </div>
    </div>
  );
}
