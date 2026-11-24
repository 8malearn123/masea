import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Undo2, Wallet } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  StatTile,
  useToast,
} from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useSources } from '@/features/settings/hooks/useSettings';
import { useUserNames } from '@/features/contracts/components/details/ContractTabs';
import { sourceLabelOf } from '@/features/marketing/api/attribution.api';
import { campaignReport } from '@/features/marketing/api/analytics.api';
import {
  addSpend,
  listSpend,
  reverseSpend,
  spendSchema,
  type SpendEntry,
} from '@/features/marketing/api/campaignSpend.api';
import type { Campaign } from '@/features/loyalty/types';

const today = () => new Date().toISOString().slice(0, 10);

/** نتائج الحملة الفعلية (عملاء محتملون، عقود، قيمتها، الإيراد، المحصّل) والميزانية والمصروف. */
export function CampaignResults({ campaign }: { campaign: Campaign }) {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: sources = [] } = useSources();
  const owner = useUserNames([campaign.owner_id]);
  const from = (campaign.start_at || '2000-01-01').slice(0, 10);
  const res = useQuery({
    queryKey: ['marketing', 'campaign-result', campaign.id, from],
    queryFn: async () =>
      (await campaignReport({ from, to: today(), branch: null })).find(
        (r) => r.campaign_id === campaign.id,
      ) ?? null,
  });
  const spend = useQuery({
    queryKey: ['marketing', 'spend', campaign.id],
    queryFn: () => listSpend(campaign.id),
  });
  const [adding, setAdding] = useState(false);
  const [reversing, setReversing] = useState<SpendEntry | null>(null);
  const canManage = can('loyalty', 'manage');
  const totalSpend = (spend.data ?? []).reduce((s, e) => s + e.amount, 0);
  const reversedIds = new Set((spend.data ?? []).map((s) => s.reverses_id).filter(Boolean));
  const r = res.data;

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-navy">نتائج الحملة والميزانية</h2>
        {canManage && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> تسجيل مصروف
          </Button>
        )}
      </div>
      <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-purple">المنصة</dt>
          <dd className="font-semibold text-navy">
            {sourceLabelOf(sources, campaign.platform_code)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-purple">الفرع المستهدف</dt>
          <dd className="font-semibold text-navy">{campaign.branch ?? 'كل الفروع'}</dd>
        </div>
        <div>
          <dt className="text-xs text-purple">المسؤول</dt>
          <dd className="font-semibold text-navy">
            {(campaign.owner_id && owner.data?.get(campaign.owner_id)) ||
              campaign.owner_name ||
              'غير محدد'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-purple">الميزانية المعتمدة</dt>
          <dd className="num font-semibold text-navy">
            {campaign.budget == null ? 'غير محددة' : `${sar(campaign.budget)} ر.س`}
          </dd>
        </div>
      </dl>
      {res.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : res.isError ? (
        <ErrorState onRetry={() => void res.refetch()} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="العملاء المحتملون" value={r?.leads ?? 0} />
          <StatTile label="العقود الناتجة" value={r?.contracts ?? 0} />
          <StatTile label="قيمة العقود" value={sar(r?.contract_value ?? 0)} />
          <StatTile label="الإيراد المحقق" value={sar(r?.revenue ?? 0)} tone="success" />
          <StatTile label="المحصّل" value={sar(r?.collected ?? 0)} tone="success" />
          <StatTile
            label="المصروف الفعلي"
            value={sar(totalSpend)}
            tone={campaign.budget != null && totalSpend > campaign.budget ? 'danger' : 'warning'}
            {...(campaign.budget != null ? { hint: `من ميزانية ${sar(campaign.budget)}` } : {})}
          />
        </div>
      )}
      <h3 className="mb-2 mt-5 flex items-center gap-2 text-sm font-bold text-navy">
        <Wallet size={15} /> قيود المصروف
      </h3>
      {spend.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : spend.isError ? (
        <ErrorState onRetry={() => void spend.refetch()} />
      ) : (spend.data ?? []).length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="لا مصروف مسجّل"
          description="سجّل ما صُرف فعلاً على الإعلان لتظهر CPL وCAC وROAS."
        />
      ) : (
        <ul className="divide-y divide-navy-50 text-sm">
          {(spend.data ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="num text-xs text-purple">{dateAr(e.spend_date)}</span>
              <span className="text-xs">
                {e.reference ?? ''} {e.note ?? ''}
              </span>
              <span className={`num font-semibold ${e.amount < 0 ? 'text-red-600' : 'text-navy'}`}>
                {sar(e.amount)}
              </span>
              {canManage && !e.reverses_id && !reversedIds.has(e.id) && (
                <Button size="sm" variant="ghost" onClick={() => setReversing(e)}>
                  <Undo2 size={13} /> عكس
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <SpendModal
          onClose={() => setAdding(false)}
          onSave={async (i) => {
            await addSpend(campaign.id, i);
            void qc.invalidateQueries({ queryKey: ['marketing'] });
            toast.success('سُجّل المصروف');
          }}
        />
      )}
      {reversing && (
        <ReverseModal
          entry={reversing}
          onClose={() => setReversing(null)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ['marketing'] });
            toast.success('سُجّل قيد العكس');
          }}
        />
      )}
    </Card>
  );
}

function SpendModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (i: {
    spend_date: string;
    amount: number;
    reference: string;
    note: string;
  }) => Promise<void>;
}) {
  const toast = useToast();
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(0);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const input = { spend_date: date, amount, reference, note };
  const parsed = spendSchema.safeParse(input);
  const err = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  const m = useMutation({
    mutationFn: () => onSave(input),
    onSuccess: onClose,
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="تسجيل مصروف الحملة">
      <div className="space-y-3">
        <Input
          label="التاريخ"
          type="date"
          max={today()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          label="المبلغ"
          type="number"
          min={0}
          suffix="ر.س"
          value={amount || ''}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
        <Input
          label="المرجع (رقم الفاتورة/الإيصال من المنصة)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <Input label="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-[11px] text-purple">
          القيد لا يُعدَّل ولا يُحذف؛ الخطأ يُصحَّح بقيد عكس.
        </p>
        {err && <p className="text-[11px] text-gold-600">{err}</p>}
        <Button
          className="w-full"
          disabled={Boolean(err)}
          loading={m.isPending}
          onClick={() => m.mutate()}
        >
          حفظ
        </Button>
      </div>
    </Modal>
  );
}

function ReverseModal({
  entry,
  onClose,
  onDone,
}: {
  entry: SpendEntry;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => reverseSpend(entry, reason),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="عكس قيد مصروف">
      <div className="space-y-3">
        <p className="text-sm text-purple">
          قيد بمبلغ <span className="num font-bold text-navy">{sar(entry.amount)}</span> — يُسجَّل
          قيد مقابل سالب.
        </p>
        <Input label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button
          className="w-full"
          variant="danger"
          disabled={reason.trim().length < 5}
          loading={m.isPending}
          onClick={() => m.mutate()}
        >
          تأكيد العكس
        </Button>
      </div>
    </Modal>
  );
}
