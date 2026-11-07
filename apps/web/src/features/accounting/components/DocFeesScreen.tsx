import { useState } from 'react';
import { BookOpenText, FileText, Landmark } from 'lucide-react';
import { Badge, Button, Card, Input, Select, StatTile, Table, type Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { DOC_OWNER_LABEL, type DocCostRow } from '@/features/hr/types';
import { useHrLookups } from '@/features/hr/hooks/useHrLookups';
import { useDocCosts, usePostDocCost } from '@/features/accounting/hooks/useAccounting';
import { useAccAccess } from '@/features/accounting/hooks/useAccountingPro';

const BANKS = [
  { value: '1112', label: 'البنك - مصرف الراجحي (1112)' },
  { value: '1113', label: 'البنك - البنك الأهلي (1113)' },
  { value: '1111', label: 'الصندوق (1111)' },
];

/**
 * Government fees of HR documents (0074): every iqama / work-permit / visa
 * renewal recorded by HR with a cost waits here, then posts as
 * DR 5160 «الرسوم الحكومية» / CR bank — once (idempotent).
 */
export function DocFeesScreen() {
  const { allowed } = useAccAccess();
  const canPost = allowed('bank', 'post');
  const { data: rows = [], isLoading, isError, refetch } = useDocCosts();
  const post = usePostDocCost();
  const lk = useHrLookups();
  const [bank, setBank] = useState('1112');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const pending = rows.filter((r) => !r.posted);
  const pendingTotal = pending.reduce((s, r) => s + r.renewal_cost, 0);
  const postedTotal = rows.filter((r) => r.posted).reduce((s, r) => s + r.renewal_cost, 0);

  const columns: Column<DocCostRow>[] = [
    {
      key: 'owner',
      header: 'صاحب الوثيقة',
      cell: (r) => (
        <div>
          <span className="font-semibold text-navy">{r.owner_name}</span>
          <div className="text-[11px] text-purple">
            {DOC_OWNER_LABEL[r.owner_kind]}
            {r.branch ? ` · ${r.branch}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'doc',
      header: 'الوثيقة',
      cell: (r) => (
        <div>
          {lk.docTypeLabel(r.type)}
          <div className="num text-[11px] text-purple">{r.number}</div>
        </div>
      ),
    },
    {
      key: 'expiry',
      header: 'سارية حتى',
      cell: (r) => (
        <span className="num text-xs">{r.expiry_date ? dateAr(r.expiry_date) : '—'}</span>
      ),
    },
    {
      key: 'cost',
      header: 'المبلغ',
      cell: (r) => <span className="num font-bold text-navy">{sar(r.renewal_cost)}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) =>
        r.posted ? (
          <Badge tone="success">مُرحَّل</Badge>
        ) : (
          <Badge tone="gold">بانتظار الترحيل</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      cell: (r) =>
        !r.posted && canPost ? (
          <Button
            size="sm"
            variant="success"
            loading={post.isPending && post.variables?.id === r.id}
            onClick={() =>
              post.mutate({ id: r.id, paidOn, bankCode: bank, typeLabel: lk.docTypeLabel(r.type) })
            }
          >
            <BookOpenText size={14} /> ترحيل
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="بانتظار الترحيل" value={pending.length} tone="warning" icon={FileText} />
        <StatTile
          label="مبلغ غير مُرحَّل"
          value={sar(pendingTotal)}
          tone="danger"
          icon={Landmark}
        />
        <StatTile
          label="مُرحَّل إلى 5160"
          value={sar(postedTotal)}
          tone="success"
          icon={BookOpenText}
        />
      </div>
      <Card className="grid gap-3 sm:grid-cols-3">
        <Select
          label="حساب السداد"
          value={bank}
          onChange={(e) => setBank(e.target.value)}
          options={BANKS}
        />
        <Input
          label="تاريخ السداد"
          type="date"
          value={paidOn}
          onChange={(e) => setPaidOn(e.target.value)}
        />
        <p className="self-end text-xs text-purple">
          القيد: مدين «الرسوم الحكومية» (5160) / دائن الحساب المختار — مرة واحدة لكل وثيقة.
        </p>
      </Card>
      {!canPost && (
        <p className="rounded-xl bg-navy-50 px-3 py-2 text-sm text-navy">
          الترحيل لمن يملك مهمة «ترحيل البنك» في المحاسبة.
        </p>
      )}
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد رسوم وثائق مسجّلة"
      />
    </div>
  );
}
