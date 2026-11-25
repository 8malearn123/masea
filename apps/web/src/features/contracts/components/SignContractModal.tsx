import { Modal } from '@/shared/ui';
import {
  ContractSignForm,
  type PartyState,
} from '@/features/contracts/components/ContractSignForm';
import { useSignContractParties } from '@/features/contracts/hooks/useContracts';
import type { ContractSignature } from '@/features/contracts/types';

/** نافذة التوقيع الإلكتروني لأي عقد — تستكمل الطرف الناقص فقط حسب الصلاحية. */
export function SignContractModal({
  contractId,
  open,
  onClose,
  customerState = 'pending',
  companyState = 'pending',
  signed,
  note,
}: {
  contractId: string;
  open: boolean;
  onClose: () => void;
  customerState?: PartyState;
  companyState?: PartyState;
  signed?: { customer?: ContractSignature | null; company?: ContractSignature | null };
  note?: string | null;
}) {
  const sign = useSignContractParties(contractId);
  return (
    <Modal open={open} onClose={onClose} title="التوقيع الإلكتروني">
      {open && (
        <ContractSignForm
          customerState={customerState}
          companyState={companyState}
          signed={signed}
          note={note}
          busy={sign.isPending}
          onSubmit={(c) => sign.mutate(c, { onSuccess: onClose })}
        />
      )}
    </Modal>
  );
}
