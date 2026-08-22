import { useRef, useState } from 'react';
import { FileText, Paperclip, Plane, Save, Upload } from 'lucide-react';
import { Badge, Button, Input, Select } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import {
  useAddDocument,
  useRecruitmentDocuments,
  useSetTravel,
} from '@/features/contracts/hooks/useRecruitment';
import type { ContractListItem, RecruitmentStage } from '@/features/contracts/types';

/** Saudi-realistic recruitment document types (admin-extensible on the backend). */
const DOC_TYPES: { value: string; label: string }[] = [
  { value: 'visa', label: 'التأشيرة' },
  { value: 'medical', label: 'الفحص الطبي' },
  { value: 'passport', label: 'جواز السفر' },
  { value: 'ticket', label: 'التذكرة' },
  { value: 'contract', label: 'عقد العمل' },
  { value: 'other', label: 'أخرى' },
];
const docTypeLabel = (v: string) => DOC_TYPES.find((d) => d.value === v)?.label ?? v;

function TravelData({ contract, canEdit }: { contract: ContractListItem; canEdit: boolean }) {
  const save = useSetTravel(contract.id);
  const [visa, setVisa] = useState(contract.visa_number ?? '');
  const [arrival, setArrival] = useState(contract.expected_arrival_date ?? '');
  const [flight, setFlight] = useState(contract.flight_no ?? '');

  function submit() {
    save.mutate({
      visa_number: visa.trim() ? visa.trim() : null,
      expected_arrival_date: arrival || null,
      flight_no: flight.trim() ? flight.trim() : null,
    });
  }

  if (!canEdit) {
    const empty = !contract.visa_number && !contract.expected_arrival_date && !contract.flight_no;
    return (
      <div className="rounded-xl border border-navy-100 p-3">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-navy">
          <Plane size={14} /> بيانات التأشيرة والسفر
        </h3>
        {empty ? (
          <p className="text-sm text-purple">لم تُسجَّل بعد.</p>
        ) : (
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-[11px] text-purple">رقم التأشيرة</dt>
              <dd className="num font-medium text-navy-900">{contract.visa_number ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-purple">الوصول المتوقع</dt>
              <dd className="num font-medium text-navy-900">
                {contract.expected_arrival_date ? dateAr(contract.expected_arrival_date) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-purple">رقم الرحلة</dt>
              <dd className="num font-medium text-navy-900">{contract.flight_no ?? '—'}</dd>
            </div>
          </dl>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-navy-100 p-3">
      <h3 className="flex items-center gap-2 text-xs font-bold text-navy">
        <Plane size={14} /> بيانات التأشيرة والسفر
      </h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[11px] text-purple">رقم التأشيرة</label>
          <Input
            value={visa}
            onChange={(e) => setVisa(e.target.value)}
            placeholder="مثال: 4051227789"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-purple">تاريخ الوصول المتوقع</label>
          <Input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-purple">رقم الرحلة</label>
          <Input
            value={flight}
            onChange={(e) => setFlight(e.target.value)}
            placeholder="مثال: SV-872"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" loading={save.isPending} onClick={submit}>
          <Save size={15} /> حفظ بيانات السفر
        </Button>
      </div>
    </div>
  );
}

function Documents({
  contract,
  canEdit,
  stages,
}: {
  contract: ContractListItem;
  canEdit: boolean;
  stages: RecruitmentStage[];
}) {
  const { data: docs = [] } = useRecruitmentDocuments(contract.id);
  const add = useAddDocument(contract.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('visa');
  const [fileName, setFileName] = useState('');

  const stageName = (code: string | null) => stages.find((s) => s.code === code)?.name_ar ?? null;

  function submit() {
    if (!fileName.trim()) return;
    add.mutate(
      {
        doc_type: docType,
        file_name: fileName.trim(),
        storage_path: null, // demo: metadata only; real backend uploads to Storage
        stage: contract.recruitment_stage ?? null,
      },
      {
        onSuccess: () => {
          setFileName('');
          if (fileRef.current) fileRef.current.value = '';
        },
      },
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-navy-100 p-3">
      <h3 className="flex items-center gap-2 text-xs font-bold text-navy">
        <Paperclip size={14} /> مستندات المراحل
      </h3>

      {docs.length === 0 ? (
        <p className="text-sm text-purple">لا توجد مستندات مرفقة بعد.</p>
      ) : (
        <ul className="space-y-1.5">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded-lg bg-navy-50 px-2.5 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <FileText size={14} className="text-gold-600" />
                <span className="font-medium text-navy-900">{d.file_name}</span>
                <Badge tone="teal">{docTypeLabel(d.doc_type)}</Badge>
                {stageName(d.stage_code) && (
                  <span className="text-[11px] text-purple">{stageName(d.stage_code)}</span>
                )}
              </span>
              <span className="num text-[11px] text-purple">{dateAr(d.created_at)}</span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto]">
          <Select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            options={DOC_TYPES}
            className="sm:w-36"
          />
          <div className="relative">
            <input
              ref={fileRef}
              type="file"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
            />
            <div className="flex h-full items-center gap-2 rounded-xl border border-navy-100 px-3 py-2.5 text-sm text-purple">
              <Upload size={15} /> {fileName || 'اختر ملفاً للإرفاق'}
            </div>
          </div>
          <Button variant="outline" size="sm" loading={add.isPending} onClick={submit}>
            <Paperclip size={15} /> إرفاق
          </Button>
        </div>
      )}
    </div>
  );
}

/** Visa/travel data + per-stage documents for a recruitment contract. */
export function RecruitmentExtras({
  contract,
  canEdit,
  stages,
}: {
  contract: ContractListItem;
  canEdit: boolean;
  stages: RecruitmentStage[];
}) {
  return (
    <div className="mt-3 space-y-3">
      <TravelData contract={contract} canEdit={canEdit} />
      <Documents contract={contract} canEdit={canEdit} stages={stages} />
    </div>
  );
}
