/**
 * HR reference lists (0075) — facade over hr_lookups. Live: RLS (hr.manage
 * writes) + guard_hr_lookup + cascade rename in the database. Demo: an
 * in-memory copy of the seeds applying the same rules.
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { recordAudit } from '@/shared/lib/auditTrail';
import { roleCan, type RoleCode } from '@/lib/permissions';
import { useAuth } from '@/store/auth';
import { lookupUsageDemo, renameLookupValueDemo } from '@/features/hr/api/hr.api';
import { listHrDocuments } from '@/features/hr/api/documents.api';
import { assertLookupChange } from '@/features/hr/lib/lookups';
import { LOOKUP_STORE as STORE } from '@/features/hr/api/lookups.store';
import type { HrLookup, HrLookupKind, LookupScope } from '@/features/hr/types';

type Row = Record<string, unknown>;
function mapRow(r: Row): HrLookup {
  return {
    kind: String(r.kind) as HrLookupKind,
    code: String(r.code),
    name_ar: String(r.name_ar),
    scope: (r.scope as LookupScope) ?? 'both',
    is_active: r.is_active !== false,
    is_system: r.is_system === true,
    sort_order: Number(r.sort_order ?? 0),
  };
}

export async function listHrLookups(): Promise<HrLookup[]> {
  if (!isDemoMode()) {
    const { data, error } = await supabase
      .from('hr_lookups')
      .select('kind, code, name_ar, scope, is_active, is_system, sort_order')
      .order('sort_order');
    if (error) throw new Error(`تعذّر تحميل القوائم المرجعية: ${error.message}`);
    return ((data ?? []) as Row[]).map(mapRow);
  }
  return STORE.map((l) => ({ ...l }));
}

function assertCanManage(): void {
  const role = useAuth.getState().profile?.role as RoleCode | undefined;
  if (useAuth.getState().profile && (!role || !roleCan(role, 'hr', 'manage')))
    throw new Error('إدارة القوائم المرجعية من صلاحية إدارة الموارد البشرية');
}

/** Add (isNew) or update one item — rename, scope, order, enable/disable. */
export async function saveHrLookup(item: HrLookup, isNew: boolean): Promise<void> {
  const next: HrLookup = { ...item, name_ar: item.name_ar.trim() };
  if (!isDemoMode()) {
    const all = await listHrLookups();
    const before = all.find((l) => l.kind === next.kind && l.code === next.code) ?? null;
    assertLookupChange(all, next, isNew ? null : before);
    const cols = {
      name_ar: next.name_ar,
      scope: next.scope,
      is_active: next.is_active,
      sort_order: next.sort_order,
    };
    if (isNew) {
      const { error } = await supabase
        .from('hr_lookups')
        .insert({ kind: next.kind, code: next.code, ...cols });
      if (error) throw new Error(error.message);
      return;
    }
    const { data, error } = await supabase
      .from('hr_lookups')
      .update(cols)
      .eq('kind', next.kind)
      .eq('code', next.code)
      .select('code');
    if (error) throw new Error(error.message);
    if (!data || (data as unknown[]).length === 0)
      throw new Error('لم يُحفظ — إدارة القوائم المرجعية من صلاحية إدارة الموارد البشرية');
    return;
  }
  assertCanManage();
  const idx = STORE.findIndex((l) => l.kind === next.kind && l.code === next.code);
  const before = idx >= 0 ? { ...STORE[idx]! } : null;
  if (isNew && before) throw new Error('الرمز مستخدم');
  if (!isNew && !before) throw new Error('العنصر غير موجود');
  assertLookupChange(STORE, next, before);
  if (before) {
    STORE[idx] = next;
    if (before.name_ar !== next.name_ar)
      renameLookupValueDemo(next.kind, before.name_ar, next.name_ar);
  } else STORE.push(next);
  const changed = (Object.keys(next) as (keyof HrLookup)[]).filter(
    (k) => !before || before[k] !== next[k],
  );
  recordAudit({
    action: before ? 'update' : 'insert',
    entity: 'hr_lookups',
    record_ref: next.name_ar,
    old_data: before ? Object.fromEntries(changed.map((k) => [k, before[k]])) : null,
    new_data: Object.fromEntries(changed.map((k) => [k, next[k]])),
    branch: null,
  });
}

/** Records using each name (doc types: by code) — hr_lookup_usage. */
export async function lookupUsage(kind: HrLookupKind): Promise<Map<string, number>> {
  if (!isDemoMode()) {
    const { data, error } = await supabase.rpc('hr_lookup_usage', { p_kind: kind });
    if (error) throw new Error(error.message);
    return new Map(((data ?? []) as Row[]).map((r) => [String(r.name_ar), Number(r.uses)]));
  }
  if (kind === 'doc_type') {
    const out = new Map<string, number>();
    (await listHrDocuments())
      .filter((d) => d.is_active)
      .forEach((d) => out.set(d.type, (out.get(d.type) ?? 0) + 1));
    return out;
  }
  return lookupUsageDemo(kind);
}
