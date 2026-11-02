/**
 * سجل التدقيق — قراءة فقط. مع قاعدة البيانات: جدول `audit_log` تكتبه مشغّلات
 * `audit_row_change` (0061) ودوال الـ backend، وRLS تقصر مدير الفرع على فرعه.
 * في الوضع التجريبي: مخزن `shared/lib/auditTrail` مُصفّى على فرع المستخدم.
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { scopeToViewerBranch } from '@/lib/branchScope';
import { listDemoAudit, type AuditEntry } from '@/shared/lib/auditTrail';

export type { AuditEntry };

export interface AuditFilters {
  entity: string | 'all';
  action: string | 'all';
  search: string;
  from: string; // yyyy-mm-dd ('' = بلا حد)
  to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  entity: 'all',
  action: 'all',
  search: '',
  from: '',
  to: '',
};

/** عدد السجلات المعروضة في الصفحة الواحدة من الخادم (الأحدث أولاً). */
export const AUDIT_FETCH_LIMIT = 500;

interface RawAudit {
  id: string;
  created_at: string;
  action: string | null;
  table_name: string | null;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  actor_name: string | null;
  details: Record<string, unknown> | null;
  branches: { city: string | null } | null;
}

export function applyAuditFilters(rows: AuditEntry[], f: AuditFilters): AuditEntry[] {
  const q = f.search.trim();
  return rows.filter((r) => {
    if (f.entity !== 'all' && r.entity !== f.entity) return false;
    if (f.action !== 'all' && r.action !== f.action) return false;
    const day = r.created_at.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (q) {
      const hay = `${r.actor_name ?? ''} ${r.record_ref ?? ''} ${r.branch ?? ''}`;
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export async function listAuditLog(filters: AuditFilters): Promise<AuditEntry[]> {
  if (isDemoMode()) {
    return applyAuditFilters(
      scopeToViewerBranch(listDemoAudit(), (r) => r.branch),
      filters,
    );
  }
  let query = supabase
    .from('audit_log')
    .select(
      'id, created_at, action, table_name, record_id, old_data, new_data, actor_name, details, branches(city)',
    )
    .order('created_at', { ascending: false })
    .limit(AUDIT_FETCH_LIMIT);
  if (filters.entity !== 'all') query = query.eq('table_name', filters.entity);
  if (filters.action !== 'all') query = query.eq('action', filters.action);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lt('created_at', `${filters.to}T23:59:59.999Z`);
  const { data, error } = await query;
  if (error) throw new Error(`تعذّر جلب سجل التدقيق: ${error.message}`);
  const rows = ((data ?? []) as unknown as RawAudit[]).map(
    (r): AuditEntry => ({
      id: r.id,
      created_at: r.created_at,
      action: r.action ?? 'update',
      entity: r.table_name ?? '',
      record_ref:
        (r.details?.key as string | undefined) ??
        (r.new_data?.contract_no as string | undefined) ??
        r.record_id,
      actor_name: r.actor_name,
      branch: r.branches?.city ?? null,
      old_data: r.old_data,
      new_data: r.new_data,
    }),
  );
  // search is free text over joined fields — applied client-side
  return applyAuditFilters(rows, { ...filters, entity: 'all', action: 'all', from: '', to: '' });
}
