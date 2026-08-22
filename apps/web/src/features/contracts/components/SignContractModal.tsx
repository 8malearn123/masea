import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { Modal, Button, Input } from '@/shared/ui';
import { SignaturePad } from '@/features/contracts/components/SignaturePad';
import { useSignContract } from '@/features/contracts/hooks/useContracts';
import { getClientIp } from '@/features/contracts/lib/clientIp';

export function SignContractModal({
  contractId,
  open,
  onClose,
}: {
  contractId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [customer, setCustomer] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [ip, setIp] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(false);
  const sign = useSignContract(contractId);

  // Capture the signer's IP once the dialog opens (best-effort, non-blocking).
  useEffect(() => {
    if (!open) return;
    setIpLoading(true);
    let alive = true;
    void getClientIp().then((v) => {
      if (alive) {
        setIp(v);
        setIpLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [open]);

  const nameOk = name.trim().length >= 3;
  const idOk = /^[12]\d{9}$/.test(nationalId.trim());
  const ready = nameOk && idOk && Boolean(customer) && Boolean(company);

  function submit() {
    if (!ready || !customer || !company) return;
    sign.mutate(
      {
        customer,
        company,
        customerName: name.trim(),
        nationalId: nationalId.trim(),
        ipAddress: ip,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="التوقيع الإلكتروني">
      <div className="space-y-4">
        <p className="text-sm text-purple">
          يُدخل العميل اسمه ورقم هويته ثم يوقّع الطرفان لإتمام العقد وتحويله إلى «موقّع». تُوثَّق
          هوية الموقّع وعنوان الـ IP وتاريخ التوقيع في سجل التوقيعات.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="اسم العميل (الطرف الثاني)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="الاسم كما في الهوية"
            error={name && !nameOk ? 'أدخل الاسم كاملاً' : undefined}
          />
          <Input
            label="رقم الهوية / الإقامة"
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="10 أرقام"
            inputMode="numeric"
            className="num"
            error={nationalId && !idOk ? 'رقم هوية غير صحيح (10 أرقام يبدأ بـ 1 أو 2)' : undefined}
          />
        </div>

        <div className="flex items-center gap-2 rounded-xl bg-navy-50 px-3 py-2 text-xs text-purple">
          <Globe size={14} />
          <span>عنوان الـ IP للتوقيع:</span>
          <span className="num font-semibold text-navy">
            {ipLoading ? '…جارٍ التحديد' : (ip ?? 'غير متاح')}
          </span>
        </div>

        <SignaturePad label="توقيع الطرف الثاني (العميل)" onChange={setCustomer} />
        <SignaturePad label="توقيع الطرف الأول (ماسية الشرق)" onChange={setCompany} />

        <Button onClick={submit} loading={sign.isPending} disabled={!ready} className="w-full">
          حفظ التوقيع وتأكيد العقد
        </Button>
      </div>
    </Modal>
  );
}
