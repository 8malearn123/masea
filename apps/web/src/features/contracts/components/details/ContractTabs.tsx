import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, FileDown, ScrollText, UserRound, Users } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Skeleton, useToast } from '@/shared/ui';
import { sar, dateTimeAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { contractKeys } from '@/features/contracts/api/keys';
import { getCompanyProfile, loadRentalDocument } from '@/features/contracts/api/rentalContract.api';
import {
  InstallmentsCard,
  PaymentsCard,
  RecordPaymentModal,
} from '@/features/contracts/components/details/FinancePanels';
import { InvoicesCard } from '@/features/contracts/components/details/InvoicesCard';
import { contractDocumentHtml } from '@/features/contracts/lib/contractDocument';
import { openContractPrint } from '@/features/contracts/lib/contractHtml';
import type {
  ContractClause,
  ContractListItem,
  ContractSignature,
} from '@/features/contracts/types';
import type { ReactNode } from 'react';

const NA = 'غير متوفر';

/** أسماء المستخدمين المسؤولين عن خطوات العقد (user_profiles) — لا شيء في الوضع التجريبي. */
export function useUserNames(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))].sort();
  return useQuery({
    queryKey: ['contracts', 'user-names', list],
    enabled: list.length > 0 && !isDemoMode(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, full_name')
        .in('id', list);
      if (error) throw new Error(error.message);
      return new Map((data ?? []).map((r) => [r.id as string, r.full_name as string]));
    },
  });
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="flex justify-between gap-3 border-b border-navy-50 py-2 text-sm last:border-0">
      <dt className="shrink-0 text-purple">{label}</dt>
      <dd className={`text-left ${empty ? 'text-purple/70' : 'text-navy-900'}`}>
        {empty ? NA : value}
      </dd>
    </div>
  );
}

export function useRentalDocument(contract: ContractListItem) {
  return useQuery({
    queryKey: [
      ...contractKeys.detail(contract.id),
      'rental-document',
      contract.template_id,
      contract.amount_paid,
    ],
    queryFn: () => loadRentalDocument(contract),
  });
}

/* ------------------------------ الأطراف ---------------------------------- */

export function PartiesTab({ contract }: { contract: ContractListItem }) {
  const docQ = useRentalDocument(contract);
  const companyQ = useQuery({
    queryKey: ['contracts', 'company-profile'],
    queryFn: getCompanyProfile,
  });
  if (docQ.isLoading || companyQ.isLoading) return <Skeleton className="h-64 w-full" />;
  if (docQ.isError) return <ErrorState onRetry={() => void docQ.refetch()} />;
  const src = docQ.data?.source ?? null;
  const company = src?.company ?? companyQ.data ?? null;
  const customer = src?.customer ?? { full_name: contract.customer_name ?? '' };
  const worker = src?.worker ?? (contract.worker_name ? { full_name: contract.worker_name } : null);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-navy">
          <Building2 size={16} /> الطرف الأول (الشركة)
        </h3>
        <dl>
          <Field label="الاسم" value={company?.name} />
          <Field
            label="السجل التجاري"
            value={company?.cr_number && <span className="num">{company.cr_number}</span>}
          />
          <Field
            label="الرقم الضريبي"
            value={company?.vat_number && <span className="num">{company.vat_number}</span>}
          />
          <Field
            label="ترخيص وزارة العمل"
            value={company?.mol_license_no && <span className="num">{company.mol_license_no}</span>}
          />
          <Field
            label="الهاتف"
            value={company?.phone && <span className="num">{company.phone}</span>}
          />
          <Field label="العنوان" value={company?.address} />
        </dl>
        {!src && company && (
          <p className="mt-2 text-[11px] text-purple">
            من بيانات الشركة الحالية — العقد لا يحمل لقطة للطرف الأول.
          </p>
        )}
      </Card>
      <Card>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-navy">
          <Users size={16} /> الطرف الثاني (العميل)
        </h3>
        <dl>
          <Field label="الاسم" value={customer.full_name} />
          <Field
            label="رقم الهوية"
            value={
              'national_id' in customer &&
              customer.national_id && <span className="num">{customer.national_id}</span>
            }
          />
          <Field
            label="الجوال"
            value={
              'phone' in customer && customer.phone && <span className="num">{customer.phone}</span>
            }
          />
          <Field label="العنوان" value={'address' in customer ? customer.address : null} />
          <Field label="مكان العمل" value={src?.contract.work_location} />
        </dl>
      </Card>
      <Card>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-navy">
          <UserRound size={16} /> العاملة
        </h3>
        {worker ? (
          <dl>
            <Field label="الاسم" value={worker.full_name} />
            <Field label="الجنسية" value={'nationality' in worker ? worker.nationality : null} />
            <Field
              label="الجواز / الإقامة"
              value={
                'passport_no' in worker &&
                (worker.iqama_no ?? worker.passport_no) && (
                  <span className="num">{worker.iqama_no ?? worker.passport_no}</span>
                )
              }
            />
            <Field
              label="الجوال"
              value={
                'phone' in worker && worker.phone && <span className="num">{worker.phone}</span>
              }
            />
          </dl>
        ) : (
          <p className="text-sm text-purple">{NA} — لا عاملة مرتبطة بهذا العقد.</p>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------- البنود ---------------------------------- */

/**
 * عقد على القالب المنظَّم: النص من نسخة القالب المثبّتة على العقد (لا أحدث منها)
 * بترقيم الأصل وترتيبه. غير ذلك: البنود المحفوظة مع العقد كما هي.
 */
export function ClausesTab({
  contract,
  clauses,
}: {
  contract: ContractListItem;
  clauses: ContractClause[];
}) {
  const docQ = useRentalDocument(contract);
  if (docQ.isLoading) return <Skeleton className="h-64 w-full" />;
  if (docQ.isError) return <ErrorState onRetry={() => void docQ.refetch()} />;
  const tpl = docQ.data?.template ?? null;
  if (tpl) {
    return (
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
            <ScrollText size={16} /> {tpl.doc.title}
          </h3>
          <Badge tone="navy">النسخة {tpl.version} — نص ثابت مطابق للأصل</Badge>
        </div>
        <div className="space-y-4">
          {tpl.doc.sections.map((s) => {
            const blocks = s.blocks.filter(
              (b) =>
                (b.t === 'heading' || b.t === 'para' || b.t === 'clause') && !b.text.includes('{{'),
            );
            if (blocks.length === 0) return null;
            return (
              <section key={s.id} className="space-y-1.5">
                {blocks.map((b, i) =>
                  b.t === 'heading' ? (
                    <h4 key={i} className="pt-1 text-sm font-bold text-navy">
                      {b.text}
                    </h4>
                  ) : b.t === 'clause' ? (
                    <p key={i} className="flex gap-2 text-sm leading-relaxed text-navy-900">
                      {b.no && (
                        <span className="num shrink-0 font-bold text-gold-600">{b.no}.</span>
                      )}
                      <span>{b.text}</span>
                    </p>
                  ) : b.t === 'para' ? (
                    <p key={i} className="text-sm leading-relaxed text-navy-900">
                      {b.text}
                    </p>
                  ) : null,
                )}
              </section>
            );
          })}
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <ScrollText size={16} />{' '}
        {contract.terms_accepted_at ? 'الشروط التي وافق عليها العميل' : 'بنود العقد'}
      </h3>
      {clauses.length === 0 ? (
        <p className="text-sm text-purple">{NA} — لا توجد بنود محفوظة لهذا العقد.</p>
      ) : (
        <ol className="space-y-2">
          {clauses.map((cl, i) => (
            <li key={cl.id} className="flex gap-3 text-sm leading-relaxed text-navy-900">
              <span className="num font-bold text-gold-600">{i + 1}.</span>
              {cl.body}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/* ------------------------------- المالية --------------------------------- */

export { RecordPaymentModal } from '@/features/contracts/components/details/FinancePanels';

export function FinanceTab({ contract }: { contract: ContractListItem }) {
  const { can } = usePermissions();
  const [paying, setPaying] = useState(false);
  const remaining = Math.round((contract.total_amount - contract.amount_paid) * 100) / 100;
  const canPay =
    can('payments', 'create') && remaining > 0 && !['draft', 'cancelled'].includes(contract.status);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['الأساسي قبل الضريبة', contract.base_amount],
          ['ضريبة القيمة المضافة', contract.vat_amount],
          ['الإجمالي', contract.total_amount],
          ['المتبقي', remaining],
        ].map(([k, v]) => (
          <Card key={String(k)}>
            <p className="text-xs text-purple">{k}</p>
            <p className="num text-lg font-bold text-navy">{sar(Number(v))}</p>
          </Card>
        ))}
      </div>
      <Card>
        <dl>
          {contract.discount_amount > 0 && (
            <>
              <Field
                label="السعر قبل الخصم"
                value={
                  <span className="num">
                    {sar(contract.gross_amount ?? contract.base_amount + contract.discount_amount)}{' '}
                    ر.س
                  </span>
                }
              />
              <Field
                label="الخصم المعتمد"
                value={
                  <span className="num text-green-700">− {sar(contract.discount_amount)} ر.س</span>
                }
              />
            </>
          )}
          <Field
            label="المدفوع"
            value={<span className="num">{sar(contract.amount_paid)} ر.س</span>}
          />
        </dl>
      </Card>
      <InvoicesCard contract={contract} />
      <InstallmentsCard contract={contract} />
      <PaymentsCard contract={contract} onRecord={canPay ? () => setPaying(true) : null} />
      {paying && <RecordPaymentModal contract={contract} onClose={() => setPaying(false)} />}
    </div>
  );
}

/* ------------------------------ المستندات -------------------------------- */

export function DocumentsTab({
  contract,
  clauses,
  signatures,
}: {
  contract: ContractListItem;
  clauses: ContractClause[];
  signatures: ContractSignature[];
}) {
  const toast = useToast();
  const docQ = useQuery({
    queryKey: [
      ...contractKeys.detail(contract.id),
      'document',
      contract.status,
      contract.amount_paid,
      signatures.length,
      clauses.length,
    ],
    queryFn: () =>
      contractDocumentHtml(contract, { clauses: clauses.map((c) => c.body), signatures }),
  });
  const [printing, setPrinting] = useState(false);
  async function print() {
    setPrinting(true);
    try {
      const d = await contractDocumentHtml(contract, {
        clauses: clauses.map((c) => c.body),
        signatures,
        autoPrint: true,
      });
      openContractPrint(d.html);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذّر تجهيز العقد للطباعة');
    } finally {
      setPrinting(false);
    }
  }
  const [height, setHeight] = useState(900);
  useEffect(() => setHeight(Math.max(900, Math.round(window.innerHeight * 0.85))), []);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
          <ScrollText size={16} /> نسخة العقد
          {docQ.data?.kind === 'rental_template' && (
            <Badge tone="navy">القالب المعتمد — النسخة {docQ.data.templateVersion}</Badge>
          )}
          {docQ.data?.kind === 'trial_contract' && (
            <Badge tone="navy">
              عقد تجربة — القالب المعتمد (النسخة {docQ.data.templateVersion})
            </Badge>
          )}
          {docQ.data?.kind === 'stored_clauses' && (
            <Badge tone="neutral">البنود المحفوظة مع العقد</Badge>
          )}
        </h3>
        <Button size="sm" loading={printing} onClick={() => void print()}>
          <FileDown size={14} /> طباعة / تنزيل PDF
        </Button>
      </div>
      {docQ.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : docQ.isError ? (
        <ErrorState onRetry={() => void docQ.refetch()} />
      ) : (
        <iframe
          title={`معاينة العقد ${contract.contract_no ?? ''}`}
          srcDoc={docQ.data?.html ?? ''}
          className="w-full rounded-xl border border-navy-100 bg-white"
          style={{ height }}
        />
      )}
      <p className="mt-2 text-[11px] text-purple">
        نفس المحرك في المعاينة والطباعة والتنزيل — العقد الموقّع يُعرض بنسخة القالب المثبّتة عليه
        وبيانات الأطراف المجمّدة.
        {signatures.length > 0 &&
          ` · آخر توقيع ${dateTimeAr(signatures[signatures.length - 1]?.signed_at ?? '')}`}
      </p>
    </Card>
  );
}
