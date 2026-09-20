import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { addLocalOrder } from '@/features/orders/api/orders.api';
import { captureLead } from '@/features/crm/api/crm.api';
import { addBooking } from '@/features/catalog/lib/availability';
import { blankRequestFile, saveRequestFile } from '@/features/requests/api/requests.api';
import type { PriceBreakdown, ServiceCode, WorkerProfile } from '@/lib/funnel';
import { draftPeriod, type OrderDraft } from '@/lib/orderTypes';

export interface CreateResult {
  requestNo: string;
  persisted: boolean;
}

/** بيانات إضافية يحتاجها ملف الطلب ولا تحملها المسودة (اسم الخدمة والعاملة). */
export interface CreateRequestInput {
  draft: OrderDraft;
  price: PriceBreakdown;
  serviceName: string;
  worker?: WorkerProfile | null;
}

function genRequestNo(): string {
  const rand = Math.random().toString(16).slice(2, 10).toUpperCase();
  return `REQ-${rand}`;
}

/**
 * Persists a paid order into the service_requests pipeline. If the table is
 * not migrated yet, the order still confirms with a locally generated number
 * (persisted=false) so the funnel keeps working end-to-end. Either way the
 * order is registered on the dispatch board (orders store) so it shows up.
 */
export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation<CreateResult, never, CreateRequestInput>({
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['request_files'] });
    },
    mutationFn: async ({ draft, price, serviceName, worker }) => {
      const localNo = genRequestNo();
      const { service, paymentMethod, agreeTerms, ...details } = draft;

      let result: CreateResult = { requestNo: localNo, persisted: false };
      try {
        const { data, error } = await supabase
          .from('service_requests')
          .insert({
            service_code: service,
            details: { ...details, paymentMethod, agreeTerms },
            worker_profile_id: draft.workerProfileId,
            customer_name: draft.customerName || null,
            customer_phone: draft.phone || null,
            customer_national_id: draft.nationalId || null,
            customer_city: draft.city || null,
            base_amount: price.base,
            vat_amount: price.vat,
            total_amount: price.total,
            status: 'paid',
            payment_status: 'paid',
          })
          .select('request_no')
          .single();

        if (!error && data?.request_no) {
          result = { requestNo: data.request_no as string, persisted: true };
        }
      } catch {
        /* table missing — fall back to local confirmation */
      }

      // Show the new order on the dispatch board (demo + real both register here).
      addLocalOrder({
        request_no: result.requestNo,
        customer_name: draft.customerName || null,
        service_code: service as ServiceCode,
        branch: draft.branch || null,
        total_amount: price.total,
      });
      // ملف الطلب: البيانات الموسّعة التي يعرضها ملخّص الطلب للعميل.
      const period = draftPeriod(draft);
      saveRequestFile({
        ...blankRequestFile(result.requestNo),
        service_code: service as ServiceCode,
        service_name: serviceName,
        customer_name: draft.customerName,
        phone: draft.phone,
        national_id: draft.nationalId,
        city: draft.city,
        address: draft.address,
        branch: draft.branch,
        worker: worker
          ? {
              id: worker.id,
              full_name: worker.full_name,
              nationality: worker.nationality,
              profession: worker.profession,
            }
          : null,
        match_score: draft.matchScore,
        place: draft.place,
        period,
        amounts: { base: price.base, vat: price.vat, total: price.total },
        payment_method: paymentMethod,
      });

      // حجز المدة المطلوبة على جدول العاملة حتى تظهر محجوزة للعملاء الآخرين.
      if (worker && period) {
        addBooking(worker.id, {
          start: period.startDate,
          end: period.endDate,
          reason: `طلب ${serviceName}`,
          request_no: result.requestNo,
        });
      }

      // Auto-capture the deal into the sales pipeline (landing page = website source).
      captureLead({
        full_name: draft.customerName || 'عميل من الموقع',
        phone: draft.phone || null,
        source_code: 'website',
        service_code: service as ServiceCode,
        est_value: price.total,
        stage_code: 'won',
      });
      return result;
    },
  });
}
