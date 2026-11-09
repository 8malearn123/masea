import { useState } from 'react';
import { Button, Input, Modal, Select } from '@/shared/ui';
import { useCreateLead, useUpdateLead } from '@/features/crm/hooks/useCrm';
import { useCrmMeta } from '@/features/crm/hooks/useCrmMeta';
import { leadInputError } from '@/features/crm/lib/leadInput';
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
  return (
    <Modal open={open} onClose={onClose} title={lead ? 'تعديل العميل المحتمل' : 'عميل محتمل جديد'}>
      <LeadForm lead={lead} defaultStage={defaultStage} onDone={onClose} onCancel={onClose} />
    </Modal>
  );
}

/** حقول العميل المحتمل — تُستخدم داخل نافذة التعديل وفي صفحة الإضافة. */
export function LeadForm({
  lead,
  defaultStage = 'new',
  onDone,
  onCancel,
}: {
  lead: Lead | null;
  defaultStage?: LeadStageCode;
  onDone: () => void;
  onCancel: () => void;
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
  const [touched, setTouched] = useState(false);

  const input = {
    full_name: fullName,
    phone: phone.trim() ? phone.trim() : null,
    source_code: source,
    service_code: service,
    stage_code: stage,
    // حقل فارغ = 0؛ نص غير رقمي يُرفض برسالة بدل أن يصير 0 بصمت
    est_value: estValue.trim() === '' ? 0 : Number(estValue),
    notes: notes.trim() ? notes.trim() : null,
  };
  const error = leadInputError(input);
  const fieldError = (needle: string) => (touched && error?.includes(needle) ? { error } : {});

  function submit() {
    setTouched(true);
    if (error) return;
    if (editing && lead) {
      update.mutate({ id: lead.id, patch: input }, { onSuccess: onDone });
    } else {
      create.mutate(input, { onSuccess: onDone });
    }
  }

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input
        label="الاسم"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="اسم العميل"
        {...fieldError('اسم')}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="الجوال"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="05xxxxxxxx"
          {...fieldError('الجوال')}
        />
        <Input
          label="القيمة المتوقعة (ر.س)"
          value={estValue}
          onChange={(e) => setEstValue(e.target.value)}
          inputMode="decimal"
          {...fieldError('القيمة')}
        />
        <Select
          label="المصدر"
          value={source}
          onChange={(e) => setSource(e.target.value as LeadSourceCode)}
          options={sourceOpts}
        />
        <Select
          label="الخدمة"
          value={service}
          onChange={(e) => setService(e.target.value as ServiceCode)}
          options={SERVICE_OPTS}
        />
        <Select
          label="المرحلة"
          value={stage}
          onChange={(e) => setStage(e.target.value as LeadStageCode)}
          options={stageOpts}
        />
      </div>
      <div>
        <label htmlFor="lead-notes" className="mb-1 block text-sm font-medium text-navy-900">
          ملاحظات
        </label>
        <textarea
          id="lead-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-xl border border-navy-100 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {editing ? 'حفظ' : 'إضافة'}
        </Button>
      </div>
    </form>
  );
}
