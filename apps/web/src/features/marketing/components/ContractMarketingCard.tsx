import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Pencil } from 'lucide-react';
import { Button, Card, Input, Modal, Select, useToast } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useSources } from '@/features/settings/hooks/useSettings';
import { useCampaigns } from '@/features/loyalty/hooks/useLoyalty';
import { useUserNames } from '@/features/contracts/components/details/ContractTabs';
import { contractKeys } from '@/features/contracts/api/keys';
import { branchLabel, type ContractListItem } from '@/features/contracts/types';
import {
  noteRequired,
  setContractMarketing,
  sourceLabelOf,
  UNSPECIFIED_SOURCE,
} from '@/features/marketing/api/attribution.api';

/** «البيانات التسويقية» في تفاصيل العقد — للتقارير فقط، لا تدخل نص العقد. */
export function ContractMarketingCard({ contract }: { contract: ContractListItem }) {
  const { can } = usePermissions();
  const { data: sources = [] } = useSources();
  const { data: campaigns = [] } = useCampaigns();
  const names = useUserNames([contract.created_by]);
  const [editing, setEditing] = useState(false);
  const campaign = campaigns.find((c) => c.id === contract.campaign_id);
  const canEdit =
    (can('contracts', 'edit') || can('contracts', 'create')) && contract.status !== 'cancelled';
  const employee = contract.created_by ? (names.data?.get(contract.created_by) ?? null) : null;

  const rows: [string, string][] = [
    ['مصدر العميل الأصلي', sourceLabelOf(sources, contract.acquisition_source_code)],
    [
      'مصدر العقد',
      contract.source_code
        ? `${sourceLabelOf(sources, contract.source_code)}${contract.source_note ? ` — ${contract.source_note}` : ''}`
        : UNSPECIFIED_SOURCE,
    ],
    ['الحملة التسويقية', campaign?.name ?? (contract.campaign_id ? 'حملة غير متاحة' : 'بدون حملة')],
    ['الموظف المسؤول', employee ?? 'غير متوفر'],
    ['الفرع', branchLabel(contract)],
    [
      'تاريخ أول تواصل',
      contract.first_contact_at ? dateAr(contract.first_contact_at) : UNSPECIFIED_SOURCE,
    ],
  ];

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Megaphone size={16} /> البيانات التسويقية
        </h2>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil size={13} /> تعديل مصدر العقد
          </Button>
        )}
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between gap-3 border-b border-navy-50 py-2 text-sm last:border-0"
          >
            <dt className="text-purple">{k}</dt>
            <dd className={v === UNSPECIFIED_SOURCE ? 'text-purple/70' : 'text-navy-900'}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-purple">
        للتقارير فقط — لا تظهر في نص العقد ولا في ملف PDF. مصدر العميل الأصلي لقطة وقت إنشاء العقد.
      </p>
      {editing && (
        <EditModal
          contract={contract}
          sources={sources}
          campaigns={campaigns}
          onClose={() => setEditing(false)}
        />
      )}
    </Card>
  );
}

function EditModal({
  contract,
  sources,
  campaigns,
  onClose,
}: {
  contract: ContractListItem;
  sources: ReturnType<typeof useSources>['data'] & object;
  campaigns: { id: string; name: string; is_active: boolean }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [src, setSrc] = useState(contract.source_code ?? '');
  const [note, setNote] = useState(contract.source_note ?? '');
  const [campaign, setCampaign] = useState(contract.campaign_id ?? '');
  const needsNote = noteRequired(sources, src);
  const err = !src ? 'حدّد مصدر العقد' : needsNote && note.trim().length < 2 ? 'وضّح المصدر' : null;
  const m = useMutation({
    mutationFn: () =>
      setContractMarketing(contract.id, {
        source_code: src,
        source_note: needsNote ? note.trim() : null,
        campaign_id: campaign || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractKeys.all });
      toast.success('حُدّث مصدر العقد');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="مصدر العقد والحملة">
      <div className="space-y-3">
        <Select
          label="مصدر العقد"
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          options={[
            { value: '', label: 'اختر…' },
            ...sources
              .filter((s) => s.is_active || s.code === src)
              .map((s) => ({ value: s.code, label: s.name_ar })),
          ]}
        />
        {needsNote && (
          <Input label="توضيح المصدر" value={note} onChange={(e) => setNote(e.target.value)} />
        )}
        <Select
          label="الحملة التسويقية"
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          options={[
            { value: '', label: 'بدون حملة' },
            ...campaigns
              .filter((c) => c.is_active || c.id === campaign)
              .map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <p className="text-[11px] text-purple">مصدر العميل الأصلي لا يتغيّر من هنا.</p>
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
