import { useState } from 'react';
import { ShieldCheck, Users, Grid3x3 } from 'lucide-react';
import { Badge, Card, Table, type Column } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { MODULE_ICON } from '@/lib/moduleIcons';
import { MODULES, ROLE_META, roleCan, type ModuleCode, type RoleCode } from '@/lib/permissions';
import { useSystemUsers } from '@/features/rbac/hooks/useSystemUsers';
import { type SystemUser } from '@/features/rbac/types';

const ROLE_ORDER = Object.keys(ROLE_META) as RoleCode[];

type Access = { label: string; cls: string };

function accessFor(role: RoleCode, mod: ModuleCode): Access {
  if (roleCan(role, mod, 'manage')) return { label: 'إدارة', cls: 'bg-teal-100 text-teal' };
  if (roleCan(role, mod, 'delete')) return { label: 'كامل', cls: 'bg-green-100 text-green-700' };
  if (roleCan(role, mod, 'edit')) return { label: 'تعديل', cls: 'bg-navy-50 text-navy' };
  if (roleCan(role, mod, 'view')) return { label: 'عرض', cls: 'bg-gold-100 text-gold-600' };
  return { label: '—', cls: 'text-navy-100' };
}

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

export default function RbacBoard() {
  const { data: users = [], isLoading, isError, refetch } = useSystemUsers();
  const [tab, setTab] = useState<'users' | 'matrix'>('users');

  const active = users.filter((u) => u.is_active).length;

  const columns: Column<SystemUser>[] = [
    {
      key: 'full_name',
      header: 'الاسم',
      cell: (u) => (
        <div>
          <span className="font-semibold text-navy">{u.full_name}</span>
          <span className="block text-[11px] text-purple">{u.email}</span>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'الدور',
      cell: (u) => <Badge tone="navy">{ROLE_META[u.role].label}</Badge>,
    },
    { key: 'branch', header: 'الفرع', cell: (u) => <span className="text-xs">{u.branch}</span> },
    {
      key: 'status',
      header: 'الحالة',
      cell: (u) => (
        <Badge tone={u.is_active ? 'success' : 'neutral'}>{u.is_active ? 'نشط' : 'موقوف'}</Badge>
      ),
    },
    {
      key: 'last_login',
      header: 'آخر دخول',
      cell: (u) => <span className="num text-xs">{dateAr(u.last_login)}</span>,
    },
  ];

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <ShieldCheck size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">الحسابات والصلاحيات</h1>
          <p className="text-sm text-purple">إدارة المستخدمين والأدوار ومصفوفة الصلاحيات.</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="إجمالي المستخدمين" value={String(users.length)} />
        <Kpi label="نشطون" value={String(active)} tone="text-green-600" />
        <Kpi label="الأدوار" value={String(ROLE_ORDER.length)} tone="text-teal" />
        <Kpi label="الوحدات" value={String(MODULES.length)} tone="text-gold-600" />
      </div>

      <div className="mb-4 inline-flex rounded-xl bg-navy-50 p-1">
        <button
          onClick={() => setTab('users')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === 'users' ? 'bg-white text-navy shadow-card' : 'text-purple'}`}
        >
          <Users size={15} /> المستخدمون
        </button>
        <button
          onClick={() => setTab('matrix')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === 'matrix' ? 'bg-white text-navy shadow-card' : 'text-purple'}`}
        >
          <Grid3x3 size={15} /> مصفوفة الصلاحيات
        </button>
      </div>

      {tab === 'users' ? (
        <Table
          columns={columns}
          rows={users}
          rowKey={(u) => u.id}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          emptyTitle="لا يوجد مستخدمون"
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-center text-xs">
            <thead>
              <tr>
                <th className="sticky right-0 bg-white p-2 text-right font-bold text-navy">
                  الوحدة
                </th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} className="whitespace-nowrap p-2 font-semibold text-purple">
                    {ROLE_META[r].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m.module} className="border-t border-navy-50">
                  <td className="sticky right-0 bg-white p-2 text-right font-semibold text-navy">
                    <ModuleLabel module={m.module} label={m.label} />
                  </td>
                  {ROLE_ORDER.map((r) => {
                    const a = accessFor(r, m.module);
                    return (
                      <td key={r} className="p-1.5">
                        <span
                          className={`inline-flex min-w-[44px] justify-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${a.cls}`}
                        >
                          {a.label}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/** اسم الوحدة مع أيقونتها (lucide — لا إيموجي). */
function ModuleLabel({ module, label }: { module: ModuleCode; label: string }) {
  const Icon = MODULE_ICON[module];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon size={14} aria-hidden className="shrink-0 text-navy" /> {label}
    </span>
  );
}
