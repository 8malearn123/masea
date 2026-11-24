import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Select, Skeleton, useToast } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useCustomerContracts } from '@/features/customers/hooks/useCrmCustomers';
import { SERVICE_LABEL, type ContractServiceCode } from '@/features/contracts/types';
import { riyadhDateTime } from '@/features/marketing/api/analytics.api';
import {
  customerWheelPrizes,
  prizeState,
  redeemWheelPrize,
  type CustomerPrize,
} from '@/features/marketing/api/wheel.api';

const STATE: Record<
  ReturnType<typeof prizeState>,
  { label: string; tone: 'success' | 'neutral' | 'danger' }
> = {
  valid: { label: 'صالحة', tone: 'success' },
  used: { label: 'مستخدمة', tone: 'neutral' },
  expired: { label: 'منتهية', tone: 'danger' },
  credited: { label: 'أُضيفت لرصيده', tone: 'success' },
  none: { label: 'بلا جائزة', tone: 'neutral' },
};

/** جوائز عجلة الحظ في ملف العميل: المرجع والصلاحية والشروط، والتحقق منها واستخدامها على عقد. */
export function CustomerWheelPrizesCard({ customerId }: { customerId: string }) {
  const { can } = usePermissions();
  const q = useQuery({
    queryKey: ['marketing', 'customer-prizes', customerId],
    queryFn: () => customerWheelPrizes(customerId),
  });
  if (!can('loyalty', 'view') && !can('contracts', 'view')) return null;
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <Gift size={16} /> جوائز عجلة الحظ
      </h2>
      {q.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-xs text-purple">لم يشارك العميل في عجلة الحظ.</p>
      ) : (
        <ul className="space-y-2">
          {(q.data ?? []).map((p) => (
            <PrizeRow key={p.spin_id} customerId={customerId} prize={p} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function PrizeRow({ customerId, prize: p }: { customerId: string; prize: CustomerPrize }) {
  const { can } = usePermissions();
  const toast = useToast();
  const qc = useQueryClient();
  const contracts = useCustomerContracts(customerId);
  const state = prizeState(p);
  const services = p.services ?? [];
  const eligible = (contracts.data ?? []).filter(
    (c) =>
      c.status !== 'cancelled' &&
      (services.length === 0 || services.includes(c.service_code ?? '')),
  );
  const [contractId, setContractId] = useState('');
  const redeem = useMutation({
    mutationFn: () => {
      const c = eligible.find((x) => x.id === (contractId || eligible[0]?.id));
      if (!c || !p.reference) throw new Error('اختر العقد');
      return redeemWheelPrize(p.reference, c);
    },
    onSuccess: () => {
      toast.success('سُجّل استخدام الجائزة على العقد');
      void qc.invalidateQueries({ queryKey: ['marketing'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const canRedeem =
    state === 'valid' &&
    p.prize_type !== 'discount' &&
    (can('contracts', 'edit') || can('contracts', 'create'));
  return (
    <li className="rounded-xl border border-navy-100 p-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-navy">{p.label}</span>
        <Badge tone={STATE[state].tone}>{STATE[state].label}</Badge>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-purple">
        {p.campaign_name && <span>{p.campaign_name}</span>}
        <span className="num">{riyadhDateTime(p.spun_at)}</span>
        {p.reference && (
          <span className="num font-semibold text-navy" dir="ltr">
            {p.reference}
          </span>
        )}
        {p.valid_until && (
          <span>
            حتى <span className="num">{riyadhDateTime(p.valid_until)}</span>
          </span>
        )}
        {services.length > 0 && (
          <span>
            على: {services.map((s) => SERVICE_LABEL[s as ContractServiceCode] ?? s).join('، ')}
          </span>
        )}
        {p.max_discount_amount != null && <span>بحد أعلى {sar(p.max_discount_amount)}</span>}
        {p.reference && (
          <span className="num">
            الاستخدام {p.uses}/{p.usage_limit}
          </span>
        )}
      </div>
      {p.terms && <p className="mt-1 text-[11px] text-navy">{p.terms}</p>}
      {state === 'valid' && p.prize_type === 'discount' && (
        <p className="mt-1 text-[11px] text-purple">
          يُطبَّق بإدخال الكود في خطوة التسعير في «عقد جديد» — يتحقق النظام من الخدمة والحد
          والصلاحية.
        </p>
      )}
      {canRedeem && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Select
            aria-label="العقد"
            value={contractId || eligible[0]?.id || ''}
            onChange={(e) => setContractId(e.target.value)}
            options={
              eligible.length
                ? eligible.map((c) => ({
                    value: c.id,
                    label: `${c.contract_no ?? 'مسودة'} — ${SERVICE_LABEL[c.service_code as ContractServiceCode] ?? c.service_code ?? ''}`,
                  }))
                : [{ value: '', label: 'لا عقد مناسب لخدمات الجائزة' }]
            }
          />
          <Button
            size="sm"
            variant="outline"
            disabled={eligible.length === 0}
            loading={redeem.isPending}
            onClick={() => redeem.mutate()}
          >
            استخدام على العقد
          </Button>
        </div>
      )}
    </li>
  );
}
