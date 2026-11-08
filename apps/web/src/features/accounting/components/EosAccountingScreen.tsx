import { useState } from 'react';
import { BookOpenText, Landmark, Link2, Scale } from 'lucide-react';
import { Badge, Button, Card, Input, Select, StatTile, Table, type Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { payrollPeriods } from '@/features/hr/api/hr.api';
import { useEosSettlements } from '@/features/hr/hooks/useHr';
import { EOS_STATUS_LABEL, EOS_STATUS_TONE, type EosSettlement } from '@/features/hr/types';
import {
  useEosProvision,
  usePayEosSettlement,
  usePostEosProvision,
  usePostEosSettlement,
} from '@/features/accounting/hooks/useAccounting';
import { useAccAccess } from '@/features/accounting/hooks/useAccountingPro';

const BANKS = [
  { value: '1112', label: 'البنك - مصرف الراجحي (1112)' },
  { value: '1113', label: 'البنك - البنك الأهلي (1113)' },
  { value: '1111', label: 'الصندوق (1111)' },
];

/**
 * End of service in accounting (0073): the monthly provision true-up
 * (DR 5150 / CR 2210 = liability − balance) and the approved HR settlements
 * (award drawn from 2210) with their payment.
 */
export function EosAccountingScreen() {
  const { allowed } = useAccAccess();
  const canPost = allowed('gl', 'post');
  const canPay = allowed('bank', 'post');
  const [period, setPeriod] = useState(payrollPeriods()[0] ?? '');
  const [bank, setBank] = useState('1112');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const { data: prov, isLoading } = useEosProvision(period);
  const postProv = usePostEosProvision();
  const { data: settlements = [] } = useEosSettlements();
  const post = usePostEosSettlement();
  const pay = usePayEosSettlement();
  const ready = settlements.filter((s) => s.status !== 'draft');

  const columns: Column<EosSettlement>[] = [
    {
      key: 'name',
      header: 'الموظف',
      cell: (s) => (
        <div>
          <span className="font-semibold text-navy">{s.employee_name}</span>
          <div className="num text-[11px] text-purple">{dateAr(s.end_date)}</div>
        </div>
      ),
    },
    {
      key: 'award',
      header: 'من المخصص (2210)',
      cell: (s) => <span className="num">{sar(s.award)}</span>,
    },
    {
      key: 'other',
      header: 'إجازات وتعويضات',
      cell: (s) => (
        <span className="num">{sar(s.leave_amount + s.art77_amount + s.other_additions)}</span>
      ),
    },
    {
      key: 'net',
      header: 'الصافي',
      cell: (s) => <span className="num font-bold text-navy">{sar(s.net)}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (s) => (
        <div className="space-y-0.5">
          <Badge tone={EOS_STATUS_TONE[s.status]}>{EOS_STATUS_LABEL[s.status]}</Badge>
          {s.posted_at && <div className="text-[11px] text-green-700">مُرحَّل</div>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (s) =>
        !s.posted_at ? (
          canPost ? (
            <Button size="sm" loading={post.isPending} onClick={() => post.mutate(s.id)}>
              <BookOpenText size={13} /> ترحيل القيد
            </Button>
          ) : null
        ) : s.status !== 'paid' && canPay ? (
          <Button
            size="sm"
            variant="outline"
            loading={pay.isPending}
            onClick={() => pay.mutate({ id: s.id, paidOn, bankCode: bank })}
          >
            <Landmark size={13} /> تسجيل الصرف
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 border-teal/30 bg-teal-50/40 text-sm">
        <Link2 size={16} className="text-teal" />
        <span className="font-semibold text-navy">مصدر البيانات: الموارد البشرية</span>
        <span className="text-purple">— الالتزام من ملفات الموظفين، والتسويات بعد اعتمادها.</span>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
            <Scale size={16} /> مخصص مكافأة نهاية الخدمة
          </h2>
          <Select
            label="الشهر"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            options={payrollPeriods().map((p) => ({ value: p, label: p }))}
          />
        </div>
        {isLoading || !prov ? (
          <p className="text-sm text-purple">جارٍ الاحتساب…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatTile
                label="الالتزام الفعلي نهاية الشهر"
                value={sar(prov.target)}
                tone="warning"
              />
              <StatTile label="رصيد المخصص (2210)" value={sar(prov.balance)} />
              <StatTile
                label={prov.delta >= 0 ? 'قيد التسوية (زيادة)' : 'قيد التسوية (تخفيض)'}
                value={sar(Math.abs(prov.delta))}
                tone={prov.delta >= 0 ? 'danger' : 'success'}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-purple">
              <span>
                {prov.delta >= 0
                  ? 'مدين 5150 مصروف المكافأة / دائن 2210 المخصص'
                  : 'مدين 2210 المخصص / دائن 5150'}{' '}
                — يجعل رصيد المخصص مساويًا للالتزام الفعلي.
              </span>
              {prov.posted ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="success">مُرحَّل لهذا الشهر</Badge>
                  {prov.delta !== 0 && (
                    <span className="text-[11px] text-purple">
                      الفرق ناتج عن تسوية رُحّلت بعد قيد المخصص — يُسوّى تلقائيًا في قيد الشهر
                      التالي.
                    </span>
                  )}
                </span>
              ) : (
                canPost && (
                  <Button
                    loading={postProv.isPending}
                    disabled={prov.delta === 0}
                    onClick={() => postProv.mutate(period)}
                  >
                    <BookOpenText size={15} /> ترحيل قيد المخصص
                  </Button>
                )
              )}
            </div>
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-bold text-navy">التسويات النهائية المعتمدة</h2>
          {canPay && (
            <div className="flex flex-wrap items-end gap-2">
              <Select
                label="الصرف من"
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                options={BANKS}
              />
              <Input
                label="تاريخ الصرف"
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </div>
          )}
        </div>
        <Table
          columns={columns}
          rows={ready}
          rowKey={(s) => s.id}
          emptyTitle="لا توجد تسويات معتمدة"
        />
        <p className="text-xs text-purple">
          قيد التسوية: مدين 2210 (المكافأة من المخصص) + 5100 (بدل الإجازات) + 5150 (التعويضات) /
          دائن 1160 (المخصوم) + 2130 (الصافي المستحق). والصرف: مدين 2130 / دائن البنك.
        </p>
      </Card>
    </div>
  );
}
