import { useMemo, useState } from 'react';
import { BellRing, ExternalLink, History, KeyRound, ShieldCheck, UserCog } from 'lucide-react';
import { Badge, Button, Select, Table, type Column } from '@/shared/ui';
import { dateTimeAr } from '@/shared/lib/format';
import { DEMO_ACCOUNTS } from '@/lib/demo';
import {
  ALERT_PRIORITY_LABEL,
  ALERT_STATUS_LABEL,
  ALERT_TYPE_LABEL,
  deriveAlerts,
  withState,
  type AlertPriority,
  type AlertStatus,
  type AlertType,
} from '@/features/accounting/data/alerts';
import { apOpenItems, arOpenItems } from '@/features/accounting/data/receivables';
import { budgetAlerts } from '@/features/accounting/data/budgets';
import { detectAnomalies } from '@/features/accounting/data/insights';
import { dashboardKpis } from '@/features/accounting/data/analytics';
import { bookLines, reconciliationReport } from '@/features/accounting/data/bankrec';
import {
  ACC_ACTIONS,
  ACC_ACTION_LABEL,
  ACC_AREAS,
  ACC_AREA_LABEL,
  auditDiff,
  type AuditEvent,
  type DutyProfile,
} from '@/features/accounting/data/access';
import {
  useBills,
  useChart,
  useInvoices,
  useJournal,
  usePeriods,
} from '@/features/accounting/hooks/useAccounting';
import {
  useAccAccess,
  useAccConfig,
  useAccMutation,
  useAlertState,
  useAssignments,
  useAuditTrail,
  useBudgets,
  useDuties,
  useEInvoices,
  useMatches,
  useStatement,
  useWorkflow,
} from '@/features/accounting/hooks/useAccountingPro';
import * as pro from '@/features/accounting/api/accountingPro.api';
import {
  DataState,
  ExportButtons,
  SearchInput,
  SectionCard,
  todayIso,
} from '@/features/accounting/components/kit';

/* =============================== alerts ================================== */
export function AlertsScreen({ onNavigate }: { onNavigate: (key: string) => void }) {
  const journal = useJournal();
  const { data: chart = [] } = useChart();
  const { data: invoices = [] } = useInvoices();
  const { data: bills = [] } = useBills();
  const { data: budgets = [] } = useBudgets();
  const { data: wf = [] } = useWorkflow();
  const { data: periods = [] } = usePeriods();
  const { data: einv = [] } = useEInvoices();
  const { data: st } = useStatement('1112');
  const { data: matches = [] } = useMatches('1112');
  const { data: state = {} } = useAlertState();
  const { actor, allowed } = useAccAccess();
  const cfg = useAccConfig();
  const [type, setType] = useState<'all' | AlertType>('all');
  const [status, setStatus] = useState<'active' | AlertStatus>('active');
  const today = todayIso();
  const entries = journal.data ?? [];

  const alerts = useMemo(() => {
    const k = dashboardKpis(entries, chart, invoices, bills, {
      from: `${today.slice(0, 4)}-01-01`,
      to: today,
    });
    const rep = st
      ? reconciliationReport(bookLines(entries, '1112'), st.lines, matches, st.closing_balance)
      : null;
    const unrec = rep
      ? rep.unrecordedCredits.length +
        rep.unrecordedDebits.length +
        rep.depositsInTransit.length +
        rep.outstandingPayments.length
      : 0;
    return withState(
      deriveAlerts({
        today,
        arOpen: arOpenItems(invoices, today),
        apOpen: apOpenItems(bills, today),
        billDueDays: cfg.billDueDays,
        budgetAlerts: budgetAlerts(
          budgets,
          entries,
          chart,
          cfg.budgetAlertPct,
          Number(today.slice(5, 7)),
        ),
        cash: k.cash,
        lowCashThreshold: cfg.lowCash,
        anomalies: detectAnomalies(entries, chart, cfg.anomalyMultiplier),
        workflowEntries: wf,
        periods,
        unreconciledBankItems: unrec,
        einvoices: einv,
      }),
      state,
    );
  }, [entries, chart, invoices, bills, budgets, wf, periods, einv, st, matches, state, cfg, today]);

  const set = useAccMutation(
    (v: { id: string; patch: Parameters<typeof pro.setAlertState>[1] }) =>
      pro.setAlertState(v.id, v.patch, actor),
    'حُدّث التنبيه',
  );
  const rows = alerts.filter(
    (a) =>
      (type === 'all' || a.type === type) &&
      (status === 'active'
        ? a.state.status === 'open' || a.state.status === 'in_progress'
        : a.state.status === status),
  );
  const users = DEMO_ACCOUNTS.filter((u) => ['admin', 'accountant'].includes(u.role));
  const byType = (Object.keys(ALERT_TYPE_LABEL) as AlertType[]).map((t) => ({
    t,
    n: alerts.filter(
      (a) => a.type === t && a.state.status !== 'resolved' && a.state.status !== 'dismissed',
    ).length,
  }));

  const columns: Column<(typeof alerts)[number]>[] = [
    {
      key: 'p',
      header: 'الأولوية',
      sortValue: (a) => ({ high: 0, medium: 1, low: 2 })[a.priority],
      cell: (a) =>
        allowed('gl', 'view') ? (
          <Select
            value={a.priority}
            aria-label="الأولوية"
            onChange={(e) =>
              set.mutate({ id: a.id, patch: { priority: e.target.value as AlertPriority } })
            }
            options={(Object.keys(ALERT_PRIORITY_LABEL) as AlertPriority[]).map((p) => ({
              value: p,
              label: ALERT_PRIORITY_LABEL[p],
            }))}
          />
        ) : (
          <Badge
            tone={a.priority === 'high' ? 'danger' : a.priority === 'medium' ? 'gold' : 'neutral'}
          >
            {ALERT_PRIORITY_LABEL[a.priority]}
          </Badge>
        ),
    },
    {
      key: 't',
      header: 'النوع',
      cell: (a) => <Badge tone="navy">{ALERT_TYPE_LABEL[a.type]}</Badge>,
    },
    {
      key: 'title',
      header: 'التنبيه',
      cell: (a) => (
        <span>
          <span className="font-semibold text-navy">{a.title}</span>
          <span className="block text-xs text-purple">{a.detail}</span>
        </span>
      ),
    },
    {
      key: 'as',
      header: 'المسؤول',
      cell: (a) => (
        <Select
          value={a.state.assignee ?? ''}
          aria-label="المسؤول"
          onChange={(e) =>
            set.mutate({
              id: a.id,
              patch: {
                assignee: e.target.value || null,
                status:
                  a.state.status === 'open' && e.target.value ? 'in_progress' : a.state.status,
              },
            })
          }
          options={[
            { value: '', label: 'غير مسند' },
            ...users.map((u) => ({ value: u.name, label: u.name })),
          ]}
        />
      ),
    },
    {
      key: 's',
      header: 'الحالة',
      cell: (a) => (
        <Select
          value={a.state.status}
          aria-label="الحالة"
          onChange={(e) =>
            set.mutate({ id: a.id, patch: { status: e.target.value as AlertStatus } })
          }
          options={(Object.keys(ALERT_STATUS_LABEL) as AlertStatus[]).map((s) => ({
            value: s,
            label: ALERT_STATUS_LABEL[s],
          }))}
        />
      ),
    },
    {
      key: 'go',
      header: '',
      cell: (a) => (
        <button
          type="button"
          className="text-navy"
          aria-label="فتح الشاشة المعنية"
          onClick={() => onNavigate(a.target)}
        >
          <ExternalLink size={14} />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        {byType.map(({ t, n }) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(type === t ? 'all' : t)}
            className={`rounded-2xl bg-white p-2.5 text-right shadow-card ${type === t ? 'ring-2 ring-navy' : ''}`}
          >
            <p className="text-[11px] text-purple">{ALERT_TYPE_LABEL[t]}</p>
            <p className={`num text-lg font-bold ${n ? 'text-navy' : 'text-navy-200'}`}>{n}</p>
          </button>
        ))}
      </div>
      <SectionCard
        title="مركز التنبيهات المالية"
        icon={BellRing}
        actions={
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            options={[
              { value: 'active', label: 'النشطة' },
              ...(Object.keys(ALERT_STATUS_LABEL) as AlertStatus[]).map((s) => ({
                value: s,
                label: ALERT_STATUS_LABEL[s],
              })),
            ]}
          />
        }
      >
        <DataState
          isLoading={journal.isLoading}
          isError={journal.isError}
          onRetry={() => void journal.refetch()}
        >
          <Table
            columns={columns}
            rows={rows}
            rowKey={(a) => a.id}
            emptyTitle="لا تنبيهات في هذا التصنيف"
          />
        </DataState>
        <p className="mt-2 text-xs text-purple">
          التنبيهات تُشتق آليًا من البيانات الفعلية؛ العتبات (السيولة{' '}
          {cfg.lowCash.toLocaleString('en-US')} ر.س، الموازنة {cfg.budgetAlertPct}٪، الاستحقاق{' '}
          {cfg.billDueDays} أيام، معامل الشذوذ {cfg.anomalyMultiplier}×) تُدار من الإعدادات.
        </p>
      </SectionCard>
    </div>
  );
}

/* ========================= duties & audit log ============================ */
export function AccessScreen() {
  const { data: duties = [], isLoading, isError, refetch } = useDuties();
  const { data: assignments = {} } = useAssignments();
  const { role, actor, duty: myDuty } = useAccAccess();
  const isAdmin = role === 'admin';
  const [sel, setSel] = useState<string>('general_accountant');
  const duty = duties.find((d) => d.code === sel);
  const save = useAccMutation((d: DutyProfile) => pro.saveDuty(d, actor), 'حُفظت صلاحيات الملف');
  const assign = useAccMutation(
    (v: { email: string; duty: string | null }) => pro.assignDuty(v.email, v.duty, actor),
    'حُدّث الإسناد',
  );
  const toggle = (cap: string) =>
    duty &&
    save.mutate({
      ...duty,
      caps: duty.caps.includes(cap) ? duty.caps.filter((c) => c !== cap) : [...duty.caps, cap],
    });
  const accountingUsers = DEMO_ACCOUNTS.filter((u) =>
    ['admin', 'accountant', 'operations_manager'].includes(u.role),
  );

  return (
    <div className="space-y-4">
      <SectionCard title="ملفات المهام المحاسبية (تحت الأدوار العشرة)" icon={KeyRound}>
        <p className="mb-3 text-xs leading-relaxed text-purple">
          الدور يحدد الوصول للوحدة (has_perm)؛ ملف المهام يحدد ما يُسمح به داخل المحاسبة حسب الوظيفة
          (has_acc_perm) ويُفرض في الخادم داخل دوال الترحيل والاعتماد وسياسات RLS. مدير النظام يملك
          كل الصلاحيات. ملفك الحالي:{' '}
          <strong>{role === 'admin' ? 'مدير النظام' : (myDuty?.name ?? 'بدون')}</strong>.
        </p>
        <DataState isLoading={isLoading} isError={isError} onRetry={() => void refetch()}>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {duties.map((d) => (
              <button
                key={d.code}
                type="button"
                onClick={() => setSel(d.code)}
                className={`rounded-xl px-3 py-1.5 text-sm ${sel === d.code ? 'bg-navy text-white' : 'bg-navy-50 text-navy'}`}
              >
                {d.name}
              </button>
            ))}
          </div>
          {duty && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-navy-100 text-purple">
                    <th className="py-2 text-right">المجال</th>
                    {ACC_ACTIONS.map((a) => (
                      <th key={a} className="py-2 text-center">
                        {ACC_ACTION_LABEL[a]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ACC_AREAS.map((area) => (
                    <tr key={area} className="border-b border-navy-50">
                      <td className="py-2 font-medium text-navy">{ACC_AREA_LABEL[area]}</td>
                      {ACC_ACTIONS.map((a) => {
                        const cap = `${area}.${a}`;
                        return (
                          <td key={a} className="py-2 text-center">
                            <input
                              type="checkbox"
                              aria-label={`${ACC_AREA_LABEL[area]} — ${ACC_ACTION_LABEL[a]}`}
                              checked={duty.caps.includes(cap)}
                              disabled={!isAdmin}
                              onChange={() => toggle(cap)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!isAdmin && (
                <p className="mt-2 text-xs text-purple">تعديل الملفات للمدير العام فقط.</p>
              )}
            </div>
          )}
        </DataState>
      </SectionCard>

      <SectionCard title="إسناد الملفات للمستخدمين" icon={UserCog}>
        <ul className="divide-y divide-navy-50 text-sm">
          {accountingUsers.map((u) => (
            <li key={u.email} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-semibold text-navy">{u.name}</span>{' '}
                <span className="text-xs text-purple">{u.email}</span>
              </span>
              <div className="w-56">
                <Select
                  value={assignments[u.email] ?? ''}
                  disabled={!isAdmin || u.role === 'admin'}
                  aria-label={`ملف ${u.name}`}
                  onChange={(e) => assign.mutate({ email: u.email, duty: e.target.value || null })}
                  options={[
                    {
                      value: '',
                      label:
                        u.role === 'admin' ? 'مدير النظام (كل الصلاحيات)' : 'الافتراضي حسب الدور',
                    },
                    ...duties.map((d) => ({ value: d.code, label: d.name })),
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

export function AuditScreen() {
  const { data: events = [], isLoading, isError, refetch } = useAuditTrail();
  const { allowed } = useAccAccess();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const rows = events.filter(
    (e) => !q || `${e.actor} ${e.action} ${e.entity} ${e.entity_id} ${e.note ?? ''}`.includes(q),
  );
  if (!allowed('audit', 'view'))
    return (
      <SectionCard title="سجل التدقيق" icon={History}>
        <p className="text-sm text-purple">لا تملك صلاحية عرض سجل التدقيق.</p>
      </SectionCard>
    );
  return (
    <SectionCard
      title="سجل التدقيق (غير قابل للتعديل)"
      icon={History}
      actions={
        <>
          <SearchInput value={q} onChange={setQ} placeholder="بحث بالمستخدم أو العملية أو الكيان" />
          <ExportButtons
            build={() => ({
              title: 'سجل التدقيق المحاسبي',
              headers: ['الوقت', 'المستخدم', 'العملية', 'الكيان', 'المعرّف', 'ملاحظة'],
              rows: rows.map((e) => [e.at, e.actor, e.action, e.entity, e.entity_id, e.note ?? '']),
            })}
          />
        </>
      }
    >
      <Table
        columns={[
          {
            key: 'at',
            header: 'الوقت',
            cell: (e) => <span className="num text-xs">{dateTimeAr(e.at)}</span>,
            sortValue: (e) => e.at,
          },
          { key: 'u', header: 'المستخدم', cell: (e) => e.actor },
          { key: 'a', header: 'العملية', cell: (e) => <Badge tone="navy">{e.action}</Badge> },
          {
            key: 'en',
            header: 'الكيان',
            cell: (e) => (
              <span className="text-xs">
                {e.entity} · <span className="num">{e.entity_id}</span>
              </span>
            ),
          },
          {
            key: 'n',
            header: 'ملاحظة',
            cell: (e) => <span className="text-xs text-purple">{e.note ?? ''}</span>,
          },
          {
            key: 'd',
            header: '',
            cell: (e) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpen(open?.id === e.id ? null : e)}
              >
                القيم
              </Button>
            ),
          },
        ]}
        rows={rows}
        rowKey={(e) => e.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا عمليات مسجلة في هذه الجلسة بعد"
      />
      {open && (
        <div className="mt-3 rounded-xl bg-navy-50 p-3 text-xs">
          <p className="mb-2 flex items-center gap-1 font-semibold text-navy">
            <ShieldCheck size={13} /> القيم السابقة ← الجديدة
          </p>
          <ul className="space-y-1">
            {auditDiff(open.before, open.after).map((d) => (
              <li key={d.field} className="num break-all" dir="ltr">
                {d.field}: {d.from} → {d.to}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-xs text-purple">
        في قاعدة البيانات: accounting_audit_log محمي بمشغّل يمنع التعديل والحذف لأي مستخدم، ويُكتب
        آليًا بمشغلات على القيود والفترات والدليل والموازنات.
      </p>
    </SectionCard>
  );
}
