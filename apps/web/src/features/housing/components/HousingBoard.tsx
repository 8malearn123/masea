import { useState } from 'react';
import { Building2, BedDouble, UserRound, MapPin } from 'lucide-react';
import { Badge, Card, Input, Select, Table, type Column } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { BRANCHES_AR } from '@/lib/funnel';
import { useDorms, useResidents } from '@/features/housing/hooks/useHousing';
import {
  RESIDENT_STATUS_LABEL,
  RESIDENT_STATUS_TONE,
  type Resident,
} from '@/features/housing/types';

function Kpi({
  label,
  value,
  tone = 'text-navy',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <p className="text-xs text-purple">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

function Overview() {
  const { data: dorms = [] } = useDorms();
  const { data: residents = [], isLoading, isError, refetch } = useResidents();
  const [branch, setBranch] = useState('all');
  const [search, setSearch] = useState('');

  const dormRows = branch === 'all' ? dorms : dorms.filter((d) => d.branch === branch);
  const residentRows = residents.filter(
    (r) =>
      (branch === 'all' || r.branch === branch) &&
      (!search.trim() || r.full_name.includes(search.trim())),
  );

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
      header: 'الحالة',
      cell: (r) => (
        <Badge tone={RESIDENT_STATUS_TONE[r.status]}>{RESIDENT_STATUS_LABEL[r.status]}</Badge>
      ),
    },
    {
      key: 'check_in',
      header: 'تاريخ السكن',
      cell: (r) => <span className="num text-xs">{dateAr(r.check_in)}</span>,
    },
  ];

  return (
    <>
      <Card className="mb-4">
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

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
            <BedDouble size={16} /> المساكن
          </h2>
          {dormRows.map((d) => {
            const r = d.capacity ? Math.round((d.occupied / d.capacity) * 100) : 0;
            const full = d.occupied >= d.capacity;
            return (
              <Card key={d.id} className="py-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-navy">{d.name}</p>
                  <Badge tone={full ? 'danger' : r >= 80 ? 'gold' : 'success'}>
                    {full ? 'مكتمل' : `${r}٪`}
                  </Badge>
                </div>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-purple">
                  <MapPin size={11} className="text-gold-600" /> {d.branch} · المشرفة:{' '}
                  {d.supervisor}
                </p>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-navy-50">
                  <div
                    className={`h-full rounded-full ${full ? 'bg-red-500' : 'bg-navy'}`}
                    style={{ width: `${r}%` }}
                  />
                </div>
                <p className="num mt-1.5 text-xs text-purple">
                  {d.occupied} / {d.capacity} سرير
                </p>
              </Card>
            );
          })}
        </div>

        <div className="lg:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <UserRound size={16} /> العاملات في السكن
          </h2>
          <Table
            columns={columns}
            rows={residentRows}
            rowKey={(r) => r.id}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
            emptyTitle="لا توجد عاملات في السكن"
          />
        </div>
      </div>
    </>
  );
}

export default function HousingBoard() {
  const { data: dorms = [] } = useDorms();

  const totalBeds = dorms.reduce((s, d) => s + d.capacity, 0);
  const occupied = dorms.reduce((s, d) => s + d.occupied, 0);
  const rate = totalBeds ? Math.round((occupied / totalBeds) * 100) : 0;

  // التحضير ومسح الباركود والتقرير ومستهدفاتي أصبحت روابط مستقلة في القائمة
  // الجانبية؛ هذه الصفحة هي «نظرة عامة» على المساكن والعاملات.
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Building2 size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">السكن</h1>
          <p className="text-sm text-purple">نظرة عامة على المساكن وإشغالها والعاملات فيها.</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="عدد المساكن" value={String(dorms.length)} />
        <Kpi label="إجمالي الأسرّة" value={String(totalBeds)} />
        <Kpi label="المشغولة" value={String(occupied)} tone="text-gold-600" />
        <Kpi label="المتاحة" value={String(totalBeds - occupied)} tone="text-green-600" />
        <Kpi label="نسبة الإشغال" value={`${rate}٪`} tone="text-teal" />
      </div>

      <Overview />
    </div>
  );
}
