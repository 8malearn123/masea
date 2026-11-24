import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { FilePlus2, FileText, Printer, Receipt, Send } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Select,
  Skeleton,
  useToast,
} from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { contractKeys } from '@/features/contracts/api/keys';
import {
  INVOICE_STATUS_LABEL,
  invoiceNet,
  issueContractInvoice,
  issueContractNote,
  listTaxDocuments,
  TAX_DOC_LABEL,
  taxNoteSchema,
  type TaxDocument,
} from '@/features/contracts/api/contractInvoices.api';
import { getCompanyProfile } from '@/features/contracts/api/rentalContract.api';
import { getCustomer } from '@/features/customers/api/customers.api';
import { taxDocumentHtml } from '@/features/contracts/lib/taxInvoiceHtml';
import { openContractPrint } from '@/features/contracts/lib/contractHtml';
import type { ContractListItem } from '@/features/contracts/types';

const SIGNED = ['signed', 'musaned_signed', 'active', 'completed'];

function NoteModal({
  contract,
  docs,
  onClose,
}: {
  contract: ContractListItem;
  docs: TaxDocument[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<'credit' | 'debit'>('credit');
  const [total, setTotal] = useState(0);
  const [reason, setReason] = useState('');
  const net = invoiceNet(docs);
  const parsed = taxNoteSchema.safeParse({ kind, total, reason });
  const err = !parsed.success
    ? (parsed.error.issues[0]?.message ?? null)
    : kind === 'credit' && total > net
      ? `الإشعار الدائن يتجاوز صافي الفاتورة (${sar(net)})`
      : null;
  const m = useMutation({
    mutationFn: () => issueContractNote(contract.id, { kind, total, reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractKeys.all });
      toast.success(
        kind === 'credit' ? 'صدر الإشعار الدائن ورُحّل قيده' : 'صدر الإشعار المدين ورُحّل قيده',
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="إشعار دائن / مدين">
      <div className="space-y-3">
        <p className="text-sm text-purple">
          صافي الفاتورة بعد الإشعارات: <span className="num font-bold text-navy">{sar(net)}</span>{' '}
          ر.س
        </p>
        <Select
          label="النوع"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'credit' | 'debit')}
          options={[
            { value: 'credit', label: 'إشعار دائن — تخفيض (خصم، تعويض، إلغاء جزئي)' },
            { value: 'debit', label: 'إشعار مدين — زيادة (رسوم أو خدمة إضافية)' },
          ]}
        />
        <Input
          label="المبلغ شامل الضريبة"
          type="number"
          min={0}
          suffix="ر.س"
          value={total || ''}
          onChange={(e) => setTotal(Number(e.target.value))}
        />
        <Input label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <p className="text-[11px] text-gold-600">{err}</p>}
        <Button
          className="w-full"
          disabled={Boolean(err)}
          loading={m.isPending}
          onClick={() => m.mutate()}
        >
          إصدار الإشعار
        </Button>
      </div>
    </Modal>
  );
}

/** الفواتير الضريبية للعقد وإشعاراتها: عرض، طباعة/PDF، إرسال، إصدار إشعار. */
export function InvoicesCard({ contract }: { contract: ContractListItem }) {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: [
      ...contractKeys.detail(contract.id),
      'tax-docs',
      contract.status,
      contract.amount_paid,
    ],
    queryFn: () => listTaxDocuments(contract.id),
  });
  const [noting, setNoting] = useState(false);
  const docs = q.data ?? [];
  const invoice = docs.find((d) => d.kind === 'invoice' && d.status !== 'void') ?? null;
  const canIssue =
    (can('accounting', 'create') || can('contracts', 'approve')) &&
    SIGNED.includes(contract.status) &&
    !invoice;
  const canNote = can('accounting', 'create') && Boolean(invoice);
  const issue = useMutation({
    mutationFn: () => issueContractInvoice(contract.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractKeys.all });
      toast.success('صدرت الفاتورة الضريبية');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function print(doc: TaxDocument) {
    try {
      const company = await getCompanyProfile();
      const qr = doc.zatca_qr
        ? await QRCode.toDataURL(doc.zatca_qr, { margin: 0, width: 260 })
        : null;
      openContractPrint(taxDocumentHtml(doc, contract, company, qr, invoice?.doc_no ?? null));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذّر تجهيز المستند');
    }
  }

  async function send(doc: TaxDocument) {
    const customer = await getCustomer(contract.customer_id).catch(() => null);
    const phone = (customer?.phone ?? '').replace(/\D/g, '').replace(/^0/, '966');
    if (!/^9665\d{8}$/.test(phone)) {
      toast.error('لا يوجد جوال صحيح للعميل — حدّثه في ملف العميل');
      return;
    }
    const text = `${TAX_DOC_LABEL[doc.kind]} رقم ${doc.doc_no}\nالعقد ${contract.contract_no ?? ''}\nالإجمالي ${sar(doc.total)} ر.س شامل الضريبة (${sar(doc.vat_amount)})\nماسية الشرق للاستقدام`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Receipt size={16} /> الفواتير الضريبية والإشعارات
        </h3>
        <div className="flex gap-2">
          {canIssue && (
            <Button size="sm" loading={issue.isPending} onClick={() => issue.mutate()}>
              <FilePlus2 size={14} /> إصدار الفاتورة
            </Button>
          )}
          {canNote && (
            <Button size="sm" variant="outline" onClick={() => setNoting(true)}>
              إشعار دائن / مدين
            </Button>
          )}
        </div>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="لا فاتورة ضريبية بعد"
          description={
            SIGNED.includes(contract.status)
              ? 'تُصدر الفاتورة تلقائياً عند التوقيع — أو أصدرها الآن.'
              : 'العقد ليس فاتورة؛ تُصدر الفاتورة الضريبية عند توقيعه.'
          }
        />
      ) : (
        <ul className="divide-y divide-navy-50 text-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-navy">{TAX_DOC_LABEL[d.kind]}</span>
                  <span className="num text-xs text-purple">{d.doc_no}</span>
                  {d.kind === 'invoice' && (
                    <Badge
                      tone={
                        d.status === 'paid' ? 'success' : d.status === 'void' ? 'neutral' : 'gold'
                      }
                    >
                      {INVOICE_STATUS_LABEL[d.status] ?? d.status}
                    </Badge>
                  )}
                  {!d.zatca_qr && <Badge tone="neutral">بلا QR — أكمل الرقم الضريبي للمنشأة</Badge>}
                </p>
                <p className="text-[11px] text-purple">
                  <span className="num">{dateAr(d.issued_at)}</span> · قبل الضريبة{' '}
                  <span className="num">{sar(d.subtotal)}</span> · الضريبة{' '}
                  <span className="num">{sar(d.vat_amount)}</span>
                  {d.reason ? ` · ${d.reason}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <span className="num font-bold text-navy">
                  {d.kind === 'credit_note' ? '− ' : ''}
                  {sar(d.total)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="طباعة / PDF"
                  onClick={() => void print(d)}
                >
                  <Printer size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="إرسال للعميل"
                  onClick={() => void send(d)}
                >
                  <Send size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {noting && <NoteModal contract={contract} docs={docs} onClose={() => setNoting(false)} />}
    </Card>
  );
}
