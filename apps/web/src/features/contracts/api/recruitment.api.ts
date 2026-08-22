/**
 * External-office recruitment workflow API (supabase 0037).
 * The contract creator assigns a recruitment contract to an external-office
 * account; that office then advances it through managed stages and logs
 * follow-ups. Security lives in the backend (RLS + assign_office /
 * advance_recruitment_stage RPCs); this layer falls back to demo data offline.
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { listSystemUsers } from '@/features/rbac/api/rbac.api';
import { demoMutateContract, DEMO_OFFICE_ID } from '@/features/contracts/api/contracts.api';
import type {
  ExternalOfficeAccount,
  RecruitmentDocument,
  RecruitmentFollowup,
  RecruitmentStage,
} from '@/features/contracts/types';

export interface TravelInput {
  visa_number: string | null;
  expected_arrival_date: string | null;
  flight_no: string | null;
}

/* --------------------------- demo fallbacks ------------------------------ */
const DEMO_STAGES: RecruitmentStage[] = [
  {
    id: 's1',
    code: 'office_contract',
    name_ar: 'التعاقد مع المكتب الخارجي',
    sort_order: 1,
    is_active: true,
  },
  {
    id: 's2',
    code: 'worker_selection',
    name_ar: 'ترشيح العاملة واختيارها',
    sort_order: 2,
    is_active: true,
  },
  { id: 's3', code: 'visa_issuance', name_ar: 'إصدار التأشيرة', sort_order: 3, is_active: true },
  { id: 's4', code: 'medical_exam', name_ar: 'الفحص الطبي', sort_order: 4, is_active: true },
  {
    id: 's5',
    code: 'visa_stamping',
    name_ar: 'تصديق الأوراق وتأشيرة الخروج',
    sort_order: 5,
    is_active: true,
  },
  {
    id: 's6',
    code: 'ticket_travel',
    name_ar: 'حجز التذكرة والسفر',
    sort_order: 6,
    is_active: true,
  },
  { id: 's7', code: 'arrival', name_ar: 'الوصول إلى المملكة', sort_order: 7, is_active: true },
  {
    id: 's8',
    code: 'handover',
    name_ar: 'الاستلام والتسليم للعميل',
    sort_order: 8,
    is_active: true,
  },
];

/** Saudi-realistic external recruitment offices (demo accounts). */
const DEMO_OFFICES: ExternalOfficeAccount[] = [
  { id: DEMO_OFFICE_ID, full_name: 'مكتب ياسر الأنصاري للاستقدام', branch: 'شرورة' },
  { id: 'office-manila', full_name: 'مكتب مانيلا للعمالة الفلبينية', branch: 'الرياض' },
  { id: 'office-colombo', full_name: 'مكتب كولومبو للاستقدام', branch: 'جدة' },
];

/** In-memory follow-up log so offline (demo) writes persist within the session. */
const demoFollowups = new Map<string, RecruitmentFollowup[]>([
  [
    '00001',
    [
      {
        id: 'f1',
        contract_id: '00001',
        stage_code: null,
        note: 'تم إسناد العقد للمكتب الخارجي',
        created_by: DEMO_OFFICE_ID,
        created_at: '2026-02-02T09:00:00Z',
      },
      {
        id: 'f2',
        contract_id: '00001',
        stage_code: 'office_contract',
        note: 'وقّع المكتب الخارجي على العقد',
        created_by: DEMO_OFFICE_ID,
        created_at: '2026-02-03T11:00:00Z',
      },
      {
        id: 'f3',
        contract_id: '00001',
        stage_code: 'visa_issuance',
        note: 'تم تقديم طلب التأشيرة عبر مساند',
        created_by: DEMO_OFFICE_ID,
        created_at: '2026-02-06T13:00:00Z',
      },
    ],
  ],
  [
    '00007',
    [
      {
        id: 'f4',
        contract_id: '00007',
        stage_code: 'worker_selection',
        note: 'ترشيح العاملة "ساندیا" — خبرة 4 سنوات',
        created_by: DEMO_OFFICE_ID,
        created_at: '2026-03-04T10:00:00Z',
      },
      {
        id: 'f5',
        contract_id: '00007',
        stage_code: 'medical_exam',
        note: 'العاملة في الفحص الطبي بمركز جمسي',
        created_by: DEMO_OFFICE_ID,
        created_at: '2026-03-08T09:30:00Z',
      },
    ],
  ],
]);

/** In-memory stage documents so offline (demo) uploads persist within the session. */
const demoDocuments = new Map<string, RecruitmentDocument[]>([
  [
    '00001',
    [
      {
        id: 'd1',
        contract_id: '00001',
        stage_code: 'visa_issuance',
        doc_type: 'visa',
        file_name: 'تأشيرة-4051227789.pdf',
        storage_path: null,
        uploaded_by: DEMO_OFFICE_ID,
        created_at: '2026-02-06T13:10:00Z',
      },
    ],
  ],
]);

let demoSeq = 100;

/* ------------------------------- queries --------------------------------- */
export async function listRecruitmentStages(): Promise<RecruitmentStage[]> {
  try {
    const { data, error } = await supabase
      .from('recruitment_stages')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (!error && data && data.length > 0) return data as RecruitmentStage[];
  } catch {
    /* fall through */
  }
  return DEMO_STAGES;
}

export async function getFollowups(contractId: string): Promise<RecruitmentFollowup[]> {
  try {
    const { data, error } = await supabase
      .from('recruitment_followups')
      .select('*')
      .eq('contract_id', contractId)
      .order('created_at', { ascending: true });
    if (!error && data && data.length > 0) return data as RecruitmentFollowup[];
  } catch {
    /* fall through */
  }
  return demoFollowups.get(contractId) ?? [];
}

export async function listExternalOffices(): Promise<ExternalOfficeAccount[]> {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, full_name, branch_id, role, is_active')
      .eq('role', 'external_office')
      .eq('is_active', true);
    if (!error && data && data.length > 0) {
      return (data as { id: string; full_name: string | null; branch_id: string | null }[]).map(
        (u) => ({
          id: u.id,
          full_name: u.full_name ?? 'مكتب خارجي',
          branch: u.branch_id,
        }),
      );
    }
  } catch {
    /* fall through */
  }
  // demo: surface any active external_office accounts the RBAC screen knows too
  try {
    const sys = (await listSystemUsers()).filter(
      (u) => u.role === 'external_office' && u.is_active,
    );
    if (sys.length > 0) {
      return [
        ...DEMO_OFFICES,
        ...sys.map((u) => ({ id: u.id, full_name: u.full_name, branch: u.branch })),
      ];
    }
  } catch {
    /* fall through */
  }
  return DEMO_OFFICES;
}

/* ------------------------------ mutations -------------------------------- */
export async function assignOffice(contractId: string, officeId: string): Promise<void> {
  if (!isDemoId(contractId)) {
    const { error } = await supabase.rpc('assign_office', {
      p_contract_id: contractId,
      p_office_id: officeId,
    });
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  // demo: assign + seed first stage so the office immediately sees it
  const firstStage = DEMO_STAGES[0]?.code ?? null;
  demoMutateContract(contractId, {
    assigned_office_id: officeId,
    assigned_at: new Date().toISOString(),
    recruitment_stage: firstStage,
  });
  pushDemoFollowup(contractId, null, 'تم إسناد العقد للمكتب الخارجي', officeId);
}

export async function advanceStage(
  contractId: string,
  stage: string,
  note: string | null,
): Promise<void> {
  if (!isDemoId(contractId)) {
    const { error } = await supabase.rpc('advance_recruitment_stage', {
      p_contract_id: contractId,
      p_stage: stage,
      p_note: note,
    });
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  // demo: move the contract's stage + log the follow-up in-memory
  demoMutateContract(contractId, { recruitment_stage: stage });
  pushDemoFollowup(contractId, stage, note, DEMO_OFFICE_ID);
}

/* ----------------------- documents + travel data ------------------------ */
export async function getDocuments(contractId: string): Promise<RecruitmentDocument[]> {
  try {
    const { data, error } = await supabase
      .from('recruitment_documents')
      .select('*')
      .eq('contract_id', contractId)
      .order('created_at', { ascending: false });
    if (!error && data && data.length > 0) return data as RecruitmentDocument[];
  } catch {
    /* fall through */
  }
  return [...(demoDocuments.get(contractId) ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}

export async function addDocument(
  contractId: string,
  input: { doc_type: string; file_name: string; storage_path: string | null; stage: string | null },
): Promise<void> {
  if (!isDemoId(contractId)) {
    const { error } = await supabase.rpc('add_recruitment_document', {
      p_contract_id: contractId,
      p_doc_type: input.doc_type,
      p_file_name: input.file_name,
      p_storage_path: input.storage_path,
      p_stage: input.stage,
    });
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  const list = demoDocuments.get(contractId) ?? [];
  list.push({
    id: `demo-d${++demoSeq}`,
    contract_id: contractId,
    stage_code: input.stage,
    doc_type: input.doc_type,
    file_name: input.file_name,
    storage_path: input.storage_path,
    uploaded_by: DEMO_OFFICE_ID,
    created_at: new Date().toISOString(),
  });
  demoDocuments.set(contractId, list);
}

export async function setTravel(contractId: string, input: TravelInput): Promise<void> {
  if (!isDemoId(contractId)) {
    const { error } = await supabase.rpc('set_recruitment_travel', {
      p_contract_id: contractId,
      p_visa_number: input.visa_number,
      p_expected_arrival_date: input.expected_arrival_date,
      p_flight_no: input.flight_no,
    });
    if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
    if (!error) return;
  }
  demoMutateContract(contractId, {
    visa_number: input.visa_number,
    expected_arrival_date: input.expected_arrival_date,
    flight_no: input.flight_no,
  });
}

function pushDemoFollowup(
  contractId: string,
  stage: string | null,
  note: string | null,
  by: string,
): void {
  const list = demoFollowups.get(contractId) ?? [];
  list.push({
    id: `demo-f${++demoSeq}`,
    contract_id: contractId,
    stage_code: stage,
    note: note && note.trim() ? note.trim() : null,
    created_by: by,
    created_at: new Date().toISOString(),
  });
  demoFollowups.set(contractId, list);
}
