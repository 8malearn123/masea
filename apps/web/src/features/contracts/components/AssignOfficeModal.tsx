import { useState } from 'react';
import { Button, Modal, Select, Spinner } from '@/shared/ui';
import { useExternalOffices, useAssignOffice } from '@/features/contracts/hooks/useRecruitment';

/**
 * The contract creator (admin/sales/call_center/branch_manager) picks an
 * external-office account to hand a recruitment contract to. The backend
 * (assign_office RPC) re-checks the permission, branch scope, the recruitment
 * service and that the target is a real external_office account.
 */
export function AssignOfficeModal({
  contractId,
  current,
  open,
  onClose,
}: {
  contractId: string;
  current: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: offices = [], isLoading } = useExternalOffices();
  const assign = useAssignOffice(contractId);
  const [officeId, setOfficeId] = useState(current ?? '');

  function submit() {
    if (!officeId) return;
    assign.mutate(officeId, { onSuccess: onClose });
  }

  return (
    <Modal open={open} onClose={onClose} title="إسناد العقد لمكتب خارجي">
      {isLoading ? (
        <div className="grid place-items-center py-8">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-purple">
            يتابع المكتب الخارجي مراحل الاستقدام ويُحدّثها. اختر الحساب الذي سيُسنَد له العقد.
          </p>
          <Select
            value={officeId}
            onChange={(e) => setOfficeId(e.target.value)}
            options={[
              { value: '', label: '— اختر المكتب الخارجي —' },
              ...offices.map((o) => ({
                value: o.id,
                label: o.branch ? `${o.full_name} · ${o.branch}` : o.full_name,
              })),
            ]}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
            <Button
              variant="primary"
              loading={assign.isPending}
              disabled={!officeId}
              onClick={submit}
            >
              إسناد
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
