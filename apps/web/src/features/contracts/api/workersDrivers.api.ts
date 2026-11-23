/**
 * العاملات والسائقون داخل العقد (0095):
 * - المرشّحات للعقد بتوفرهن الفعلي في الفترة (المتاحة وغير المتاحة وسببها).
 * - سجل العاملة (عقود، استبدالات، إرجاعات).
 * - مهام التوصيل والاستلام وانشغال السائقين ومنع تعارضهم.
 * الوضع التجريبي: نفس القواعد على مخازن العرض.
 */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import { useAuth } from '@/store/auth';
import { listContracts } from '@/features/contracts/api/contracts.api';
import { demoLogOp, listReplacements, listReturns } from '@/features/contracts/api/contractOps.api';
import { listDrivers } from '@/features/orders/api/orders.api';
import { workerConflict } from '@/features/contracts/lib/workerAllocation';
import type { ContractServiceCode } from '@/features/contracts/types';

/* --------------------------------- workers --------------------------------- */

export interface WorkerCandidate {
  id: string;
  full_name: string;
  nationality: string;
  profession: string;
  branch_name: string | null;
  status: string;
  internal_no: string | null;
  id_no: string | null;
  available: boolean;
  reason: string | null;
  next_free_date: string | null;
  conflict_contract_no: string | null;
}

export const WORKER_STATUS_LABEL: Record<string, string> = {
  available: 'متاحة',
  reserved: 'محجوزة لعقد آخر',
  on_service: 'لدى عميل',
  returning: 'بانتظار الاستلام',
  medical: 'متابعة طبية',
};

const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;
const live = () => !isDemoMode();

export async function listWorkerCandidates(
  service: ContractServiceCode | '',
  start: string,
  end: string | null,
  excludeContract?: string,
): Promise<WorkerCandidate[]> {
  if (live()) {
    const { data, error } = await supabase.rpc('contract_worker_candidates', {
      p_service: service || null,
      p_start: start,
      p_end: end,
      p_exclude_contract: excludeContract ?? null,
    });
    if (error) throw new Error(`تعذّر جلب العاملات: ${error.message}`);
    return (data ?? []) as WorkerCandidate[];
  }
  const contracts = await listContracts(ALL);
  return FALLBACK_WORKERS.map((w, i) => {
    const hit = start ? workerConflict(contracts, w.id, start, end, excludeContract) : null;
    const status = hit ? 'reserved' : w.status;
    const available = !hit && (w.status === 'available' || w.status === 'reserved');
    return {
      id: w.id,
      full_name: w.full_name,
      nationality: w.nationality,
      profession: w.profession,
      branch_name: null,
      status,
      internal_no: `MAS-W-${2001 + i}`,
      id_no: null,
      available,
      reason: hit
        ? `محجوزة على العقد ${hit.contract_no ?? ''} في الفترة نفسها`
        : available
          ? null
          : (WORKER_STATUS_LABEL[w.status] ?? 'غير متاحة'),
      next_free_date: hit?.end_date ?? null,
      conflict_contract_no: hit?.contract_no ?? null,
    };
  }).sort(
    (a, b) =>
      Number(b.available) - Number(a.available) || a.full_name.localeCompare(b.full_name, 'ar'),
  );
}

export interface WorkerHistoryRow {
  kind: 'contract' | 'replacement' | 'return';
  ref_id: string;
  contract_id: string;
  contract_no: string | null;
  service_code: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  customer_name: string | null;
  note: string | null;
  at: string;
}

export async function workerHistory(workerId: string): Promise<WorkerHistoryRow[]> {
  if (live() && !isDemoId(workerId)) {
    const { data, error } = await supabase.rpc('worker_contract_history', { p_worker: workerId });
    if (error) throw new Error(`تعذّر جلب سجل العاملة: ${error.message}`);
    return (data ?? []) as WorkerHistoryRow[];
  }
  const contracts = (await listContracts(ALL)).filter((c) => c.worker_profile_id === workerId);
  const rows: WorkerHistoryRow[] = contracts.map((c) => ({
    kind: 'contract',
    ref_id: c.id,
    contract_id: c.id,
    contract_no: c.contract_no,
    service_code: c.service_code,
    status: c.status,
    start_date: c.start_date,
    end_date: c.end_date,
    customer_name: c.customer_name,
    note: null,
    at: c.created_at,
  }));
  for (const r of await listReplacements()) {
    if (r.old_worker_profile_id !== workerId && r.new_worker_profile_id !== workerId) continue;
    rows.push({
      kind: 'replacement',
      ref_id: r.id,
      contract_id: r.contract_id,
      contract_no: null,
      service_code: null,
      status: r.status,
      start_date: r.requested_at,
      end_date: r.new_delivered_at,
      customer_name: null,
      note: r.old_worker_profile_id === workerId ? 'استُبدلت من العقد' : 'دخلت العقد بديلةً',
      at: r.created_at,
    });
  }
  for (const r of await listReturns()) {
    if (r.worker_profile_id !== workerId) continue;
    rows.push({
      kind: 'return',
      ref_id: r.id,
      contract_id: r.contract_id,
      contract_no: null,
      service_code: null,
      status: r.status,
      start_date: r.requested_date,
      end_date: r.actual_date,
      customer_name: null,
      note: r.condition_code,
      at: r.created_at,
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/** هوية العاملة للعقد (الجواز/الإقامة/الجوال) — contract_worker_doc (0087). */
export async function workerDoc(workerId: string): Promise<{
  passport_no?: string | null;
  iqama_no?: string | null;
  phone?: string | null;
} | null> {
  if (!live() || isDemoId(workerId)) return null;
  const { data, error } = await supabase.rpc('contract_worker_doc', { p_worker: workerId });
  if (error) return null;
  return (
    (data as {
      passport_no?: string | null;
      iqama_no?: string | null;
      phone?: string | null;
    } | null) ?? null
  );
}

/* --------------------------------- drivers --------------------------------- */

export type DriverTaskKind = 'delivery' | 'pickup';
export type DriverTaskStatus = 'pending' | 'assigned' | 'on_the_way' | 'done' | 'cancelled';
export interface DriverTask {
  id: string;
  task_no: string;
  contract_id: string;
  worker_profile_id: string | null;
  kind: DriverTaskKind;
  driver_id: string | null;
  driver_name?: string | null;
  starts_at: string;
  ends_at: string;
  address: string | null;
  notes: string | null;
  status: DriverTaskStatus;
  done_at: string | null;
  created_at: string;
}
export const TASK_KIND_LABEL: Record<DriverTaskKind, string> = {
  delivery: 'توصيل العاملة',
  pickup: 'استلام العاملة',
};
export const TASK_STATUS_LABEL: Record<DriverTaskStatus, string> = {
  pending: 'بانتظار إسناد سائق',
  assigned: 'مُسندة',
  on_the_way: 'في الطريق',
  done: 'منفّذة',
  cancelled: 'ملغاة',
};

export interface DriverSlot {
  id: string;
  full_name: string;
  phone: string | null;
  branch_name: string | null;
  status: string;
  busy: boolean;
  busy_task_no: string | null;
  tasks_today: number;
}

let tasks: DriverTask[] = [];
let seq = 0;
export function resetDriverTasksDemo(): void {
  tasks = [];
  seq = 0;
}
const LIVE_TASK: DriverTaskStatus[] = ['assigned', 'on_the_way'];
const overlaps = (a: DriverTask, s: string, e: string) => a.starts_at < e && s < a.ends_at;
function demoConflict(driver: string, s: string, e: string, exclude?: string): DriverTask | null {
  return (
    tasks.find(
      (t) =>
        t.id !== exclude &&
        t.driver_id === driver &&
        LIVE_TASK.includes(t.status) &&
        overlaps(t, s, e),
    ) ?? null
  );
}
function fail(m: string): never {
  throw new Error(m);
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error)
    throw new Error(error.message.replace(/^.*?\bERROR:\s*/, '').trim() || 'تعذّر تنفيذ العملية');
  return data as T;
}

export async function driverAvailability(start: string, end: string): Promise<DriverSlot[]> {
  if (live()) return rpc<DriverSlot[]>('driver_availability', { p_start: start, p_end: end });
  const drivers = (await listDrivers()).filter((d) => d.is_active);
  return drivers
    .map((d) => {
      const hit = demoConflict(d.id, start, end);
      return {
        id: d.id,
        full_name: d.full_name,
        phone: d.phone,
        branch_name: d.branch,
        status: d.status,
        busy: Boolean(hit),
        busy_task_no: hit?.task_no ?? null,
        tasks_today: tasks.filter(
          (t) =>
            t.driver_id === d.id &&
            LIVE_TASK.includes(t.status) &&
            t.starts_at.slice(0, 10) === start.slice(0, 10),
        ).length,
      };
    })
    .sort((a, b) => Number(a.busy) - Number(b.busy));
}

export async function listDriverTasks(contractId?: string): Promise<DriverTask[]> {
  if (live() && !(contractId && isDemoId(contractId))) {
    let q = supabase.from('driver_tasks').select('*, drivers(full_name)').order('starts_at');
    if (contractId) q = q.eq('contract_id', contractId);
    const { data, error } = await q;
    if (error) throw new Error(`تعذّر جلب المهام: ${error.message}`);
    return (data ?? []).map(({ drivers, ...t }) => ({
      ...(t as DriverTask),
      driver_name: (drivers as { full_name: string } | null)?.full_name ?? null,
    }));
  }
  return tasks.filter((t) => !contractId || t.contract_id === contractId).map((t) => ({ ...t }));
}

/** مهام السائق المسجّل دخوله (تطبيق السائق). RLS يقصرها عليه في الوضع الحي. */
export async function listMyDriverTasks(): Promise<DriverTask[]> {
  if (live()) return listDriverTasks();
  const me = useAuth.getState().profile;
  const mine = (await listDrivers())
    .filter((d) => d.user_id && d.user_id === me?.id)
    .map((d) => d.id);
  return tasks.filter((t) => t.driver_id && mine.includes(t.driver_id)).map((t) => ({ ...t }));
}

export const driverTaskSchema = z
  .object({
    contractId: z.string().min(1),
    kind: z.enum(['delivery', 'pickup']),
    startsAt: z.string().min(1, { message: 'حدّد وقت المهمة' }),
    endsAt: z.string().min(1, { message: 'حدّد نهاية المهمة' }),
    driverId: z.string().nullable(),
    address: z.string().optional(),
    notes: z.string().optional(),
    workerId: z.string().nullable().optional(),
  })
  .refine((d) => d.endsAt > d.startsAt, { message: 'نهاية المهمة بعد بدايتها', path: ['endsAt'] });
export type DriverTaskInput = z.infer<typeof driverTaskSchema>;

export async function createDriverTask(input: DriverTaskInput): Promise<void> {
  const p = driverTaskSchema.parse(input);
  const s = new Date(p.startsAt).toISOString();
  const e = new Date(p.endsAt).toISOString();
  if (live() && !isDemoId(p.contractId)) {
    await rpc('create_driver_task', {
      p_contract: p.contractId,
      p_kind: p.kind,
      p_start: s,
      p_end: e,
      p_driver: p.driverId,
      p_address: p.address ?? null,
      p_notes: p.notes ?? null,
      p_worker: p.workerId ?? null,
    });
    return;
  }
  if (p.driverId) {
    const hit = demoConflict(p.driverId, s, e);
    if (hit) fail(`السائق مشغول بالمهمة ${hit.task_no} في الوقت نفسه`);
  }
  seq += 1;
  const drivers = await listDrivers();
  const row: DriverTask = {
    id: `dt-${Date.now()}-${seq}`,
    task_no: `DT-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`,
    contract_id: p.contractId,
    worker_profile_id: p.workerId ?? null,
    kind: p.kind,
    driver_id: p.driverId,
    driver_name: drivers.find((d) => d.id === p.driverId)?.full_name ?? null,
    starts_at: s,
    ends_at: e,
    address: p.address?.trim() || null,
    notes: p.notes?.trim() || null,
    status: p.driverId ? 'assigned' : 'pending',
    done_at: null,
    created_at: new Date().toISOString(),
  };
  tasks.push(row);
  demoLogOp(
    p.contractId,
    'driver_task',
    row.id,
    'driver_create',
    null,
    row.status,
    TASK_KIND_LABEL[p.kind],
  );
}

export type DriverTaskAction = 'assign' | 'start' | 'done' | 'cancel';
export async function driverTaskStep(
  t: Pick<DriverTask, 'id' | 'contract_id'>,
  action: DriverTaskAction,
  driverId?: string | null,
  note?: string,
): Promise<void> {
  if (live() && !isDemoId(t.contract_id)) {
    await rpc('driver_task_step', {
      p_id: t.id,
      p_action: action,
      p_driver: driverId ?? null,
      p_note: note ?? null,
    });
    return;
  }
  const row = tasks.find((x) => x.id === t.id) ?? fail('المهمة غير موجودة');
  if (action === 'assign') {
    if (!['pending', 'assigned'].includes(row.status)) fail('لا يُعاد إسناد مهمة بدأت أو انتهت');
    if (!driverId) fail('اختر السائق');
    const hit = demoConflict(driverId, row.starts_at, row.ends_at, row.id);
    if (hit) fail(`السائق مشغول بالمهمة ${hit.task_no} في الوقت نفسه`);
    row.driver_id = driverId;
    row.driver_name = (await listDrivers()).find((d) => d.id === driverId)?.full_name ?? null;
    row.status = 'assigned';
  } else if (action === 'start') {
    if (row.status !== 'assigned') fail('تبدأ المهمة بعد إسنادها');
    row.status = 'on_the_way';
  } else if (action === 'done') {
    if (!['assigned', 'on_the_way'].includes(row.status)) fail('المهمة ليست قيد التنفيذ');
    row.status = 'done';
    row.done_at = new Date().toISOString();
    if (note?.trim()) row.notes = note.trim();
  } else {
    if (['done', 'cancelled'].includes(row.status)) fail('المهمة منتهية');
    row.status = 'cancelled';
  }
  demoLogOp(
    row.contract_id,
    'driver_task',
    row.id,
    `driver_${action}`,
    null,
    row.status,
    note ?? null,
  );
}
