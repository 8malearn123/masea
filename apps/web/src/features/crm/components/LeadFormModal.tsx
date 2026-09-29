import { useState } from 'react';
import { Button, Input, Modal, Select } from '@/shared/ui';
import { useCreateLead, useUpdateLead } from '@/features/crm/hooks/useCrm';
import { useCrmMeta } from '@/features/crm/hooks/useCrmMeta';
import {
  SERVICE_LABEL,
  type Lead,
  type LeadSourceCode,
  type LeadStageCode,
  type ServiceCode,
} from '@/features/crm/types';

const SERVICE_OPTS = (Object.entries(SERVICE_LABEL) as [ServiceCode, string][]).map(
  ([value, label]) => ({ value, label }),
);

export function LeadFormModal({
  lead,
  open,
  onClose,
  defaultStage = 'new',
}: {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
  /** Stage preselected for a new lead (e.g. the column it was added from). */
  defaultStage?: LeadStageCode;
}) {
  const create = useCreateLead();
  const update = useUpdateLead();
  const { sources, activeStages } = useCrmMeta();
  const sourceOpts = sources.map((s) => ({ value: s.code, label: s.name_ar }));
  const stageOpts = activeStages.map((s) => ({ value: s.code, label: s.name_ar }));
  const editing = Boolean(lead);

  const [fullName, setFullName] = useState(lead?.full_name ?? '');
  const [phone, setPhone] = useState(lead?.phone ?? '');
  const [source, setSource] = useState<LeadSourceCode>(lead?.source_code ?? 'website');
  const [service, setService] = useState<ServiceCode>(lead?.service_code ?? 'recruitment');
  const [stage, setStage] = useState<LeadStageCode>(lead?.stage_code ?? defaultStage);
  const [estValue, setEstValue] = useState(String(lead?.est_value ?? 0));
  const [notes, setNotes] = useState(lead?.notes ?? '');

  const busy = create.isPending || update.isPending;

  function submit() {
    if (!fullName.trim()) return;
    const input = {
      full_name: fullName.trim(),
      phone: phone.trim() ? phone.trim() : null,
      source_code: source,
      service_code: service,
      stage_code: stage,
      est_value: Number(estValue) || 0,
      notes: notes.trim() ? notes.trim() : null,
    };
    if (editing && lead) {
      update.mutate({ id: lead.id, patch: input }, { onSuccess: onClose });
    } else {
      create.mutate(input, { onSuccess: onClose });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'تعديل العميل المحتمل' : 'عميل محتمل جديد'}
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-navy-900">الاسم</label>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="اسم العميل"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">الجوال</label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="05xxxxxxxx"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">
              القيمة المتوقعة (ر.س)
            </label>
            <Input
              value={estValue}
              onChange={(e) => setEstValue(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">المصدر</label>
            <Select
              value={source}
              onChange={(e) => setSource(e.target.value as LeadSourceCode)}
              options={sourceOpts}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">الخدمة</label>
            <Select
              value={service}
              onChange={(e) => setService(e.target.value as ServiceCode)}
              options={SERVICE_OPTS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">المرحلة</label>
            <Select
              value={stage}
              onChange={(e) => setStage(e.target.value as LeadStageCode)}
              options={stageOpts}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-navy-900">ملاحظات</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-navy-100 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {editing ? 'حفظ' : 'إضافة'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
