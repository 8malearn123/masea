import { useMemo, useState } from 'react';
import { Building2, Check, ClipboardList, MessageSquarePlus, Send } from 'lucide-react';
import { Button, Card, Select, Skeleton } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useAdvanceStage,
  useFollowups,
  useRecruitmentStages,
} from '@/features/contracts/hooks/useRecruitment';
import { AssignOfficeModal } from '@/features/contracts/components/AssignOfficeModal';
import { RecruitmentExtras } from '@/features/contracts/components/RecruitmentExtras';
import type { ContractListItem } from '@/features/contracts/types';

/**
 * The external-office recruitment workflow panel, shown on a recruitment
 * contract. The creator assigns it to an office; the assigned office (and
 * admin/ops) advances it through the managed stages and logs follow-ups.
 */
export function RecruitmentJourney({ contract }: { contract: ContractListItem }) {
  const { role, userId, can } = usePermissions();
  const { data: stages = [], isLoading } = useRecruitmentStages();
  const { data: followups = [] } = useFollowups(contract.id);
  const advance = useAdvanceStage(contract.id);
  const [showAssign, setShowAssign] = useState(false);
  const [stage, setStage] = useState('');
  const [note, setNote] = useState('');

  const isAssignedOffice = role === 'external_office' && contract.assigned_office_id === userId;
  const isOpsSide = role === 'admin' || role === 'operations_manager';
  const canAdvance = Boolean(contract.assigned_office_id) && (isAssignedOffice || isOpsSide);
  const canAssign = can('contracts', 'edit') && role !== 'external_office';

  const currentIdx = useMemo(
    () => stages.findIndex((s) => s.code === contract.recruitment_stage),
    [stages, contract.recruitment_stage],
  );
  const stageName = (code: string | null) =>
    stages.find((s) => s.code === code)?.name_ar ?? code ?? '—';

  function submit() {
    const target = stage || stages[currentIdx + 1]?.code || contract.recruitment_stage;
    if (!target) return;
    advance.mutate(
      { stage: target, note: note.trim() ? note.trim() : null },
      {
        onSuccess: () => {
          setNote('');
          setStage('');
        },
      },
    );
  }

  if (isLoading)
    return (
      <Card>
        <Skeleton className="h-40 w-full" />
      </Card>
    );

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <ClipboardList size={16} /> مسار الاستقدام (المكتب الخارجي)
        </h2>
        {canAssign && (
          <Button variant="outline" size="sm" onClick={() => setShowAssign(true)}>
            <Building2 size={15} />{' '}
            {contract.assigned_office_id ? 'إعادة الإسناد' : 'إسناد لمكتب خارجي'}
          </Button>
        )}
      </div>

      {!contract.assigned_office_id ? (
        <p className="rounded-xl bg-navy-50 px-3 py-3 text-sm text-purple">
          لم يُسنَد هذا العقد لمكتب خارجي بعد. بعد الإسناد ينتقل للمكتب لمتابعته وتحديث مراحله.
        </p>
      ) : (
        <>
          {/* Stage tracker */}
          <ol className="mb-4 space-y-2">
            {stages.map((s, i) => {
              const done = i < currentIdx;
              const current = i === currentIdx;
              return (
                <li key={s.code} className="flex items-center gap-3">
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                      done
                        ? 'bg-teal text-white'
                        : current
                          ? 'bg-navy text-white ring-2 ring-navy/20'
                          : 'bg-navy-50 text-purple'
                    }`}
                  >
                    {done ? <Check size={13} /> : <span className="num">{i + 1}</span>}
                  </span>
                  <span
                    className={`text-sm ${current ? 'font-bold text-navy' : done ? 'text-navy-900' : 'text-purple'}`}
                  >
                    {s.name_ar}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* Advance control — assigned office / ops only */}
          {canAdvance && (
            <div className="space-y-2 rounded-xl border border-navy-100 p-3">
              <label className="block text-xs font-medium text-navy-900">تحديث المرحلة</label>
              <Select
                value={stage || stages[currentIdx + 1]?.code || contract.recruitment_stage || ''}
                onChange={(e) => setStage(e.target.value)}
                options={stages.map((s) => ({ value: s.code, label: s.name_ar }))}
              />
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="ملاحظة المتابعة (اختياري) — مثل: تم استلام التأشيرة برقم…"
                rows={2}
                className="w-full rounded-xl border border-navy-100 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
              />
              <div className="flex justify-end">
                <Button variant="primary" size="sm" loading={advance.isPending} onClick={submit}>
                  <Send size={15} /> تحديث وتسجيل المتابعة
                </Button>
              </div>
            </div>
          )}

          {/* Visa/travel data + stage documents — the office's required actions */}
          <RecruitmentExtras contract={contract} canEdit={canAdvance} stages={stages} />
        </>
      )}

      {/* Follow-up log */}
      {followups.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-navy">
            <MessageSquarePlus size={14} /> سجل المتابعة
          </h3>
          <ol className="space-y-3">
            {followups.map((f) => (
              <li key={f.id} className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold-600" />
                <div>
                  <p className="text-sm font-medium text-navy-900">
                    {stageName(f.stage_code)}
                    {f.note && <span className="font-normal text-purple"> — {f.note}</span>}
                  </p>
                  <p className="num text-[11px] text-purple">{dateAr(f.created_at)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <AssignOfficeModal
        contractId={contract.id}
        current={contract.assigned_office_id}
        open={showAssign}
        onClose={() => setShowAssign(false)}
      />
    </Card>
  );
}
