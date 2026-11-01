import { useState } from 'react';
import { Button, Input, Modal, Select } from '@/shared/ui';
import { BRANCHES_AR } from '@/lib/funnel';
import { usePermissions } from '@/hooks/usePermissions';
import { useSaveCustomer } from '@/features/customers/hooks/useCrmCustomers';
import { parseCustomerInput } from '@/features/customers/api/customers.api';
import type { CustomerInput, CustomerRecord } from '@/features/customers/types';

/** إضافة عميل أو تعديل بياناته — تحقّق Zod قبل الإرسال، والفرع لموظف الفرع ثابت. */
export function CustomerFormModal({
  open,
  onClose,
  customer = null,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customer?: CustomerRecord | null;
  onSaved?: (c: CustomerRecord) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? 'تعديل بيانات العميل' : 'عميل جديد'}
      size="lg"
    >
      {open && <Body customer={customer} onDone={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function Body({
  customer,
  onDone,
  onSaved,
}: {
  customer: CustomerRecord | null;
  onDone: () => void;
  onSaved: ((c: CustomerRecord) => void) | undefined;
}) {
  const { meta, branchLabel } = usePermissions();
  const save = useSaveCustomer();
  const [f, setF] = useState<CustomerInput>({
    full_name: customer?.full_name ?? '',
    phone: customer?.phone ?? '',
    national_id: customer?.national_id ?? '',
    city: customer?.city ?? '',
    email: customer?.email ?? '',
    vat_number: customer?.vat_number ?? '',
    address: customer?.address ?? '',
    branch: customer?.branch ?? (meta?.crossBranch ? '' : branchLabel),
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<CustomerInput>) => {
    setF((x) => ({ ...x, ...patch }));
    setError(null);
  };

  function submit() {
    try {
      parseCustomerInput(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'بيانات غير صحيحة');
      return;
    }
    save.mutate(
      { input: f, ...(customer ? { id: customer.id } : {}) },
      {
        onSuccess: (c) => {
          onSaved?.(c);
          onDone();
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="الاسم الكامل *"
          value={f.full_name}
          onChange={(e) => set({ full_name: e.target.value })}
        />
        <Input
          label="الجوال *"
          placeholder="05xxxxxxxx"
          inputMode="numeric"
          value={f.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
        <Input
          label="رقم الهوية / الإقامة"
          inputMode="numeric"
          value={f.national_id ?? ''}
          onChange={(e) => set({ national_id: e.target.value })}
        />
        <Input
          label="المدينة"
          value={f.city ?? ''}
          onChange={(e) => set({ city: e.target.value })}
        />
        <Input
          label="البريد الإلكتروني"
          type="email"
          value={f.email ?? ''}
          onChange={(e) => set({ email: e.target.value })}
        />
        <Input
          label="الرقم الضريبي (للمنشآت)"
          placeholder="3xxxxxxxxxxxxx3"
          inputMode="numeric"
          value={f.vat_number ?? ''}
          onChange={(e) => set({ vat_number: e.target.value })}
        />
        <Input
          label="العنوان"
          value={f.address ?? ''}
          onChange={(e) => set({ address: e.target.value })}
        />
        {meta?.crossBranch ? (
          <Select
            label="الفرع *"
            options={[
              { value: '', label: 'اختر الفرع' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
            value={f.branch ?? ''}
            onChange={(e) => set({ branch: e.target.value })}
          />
        ) : (
          <div className="rounded-xl border border-navy-100 px-3 py-2 text-sm">
            <div className="text-xs text-purple">الفرع</div>
            <div className="font-medium text-navy">{f.branch ?? '—'}</div>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          إلغاء
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          حفظ
        </Button>
      </div>
    </div>
  );
}
