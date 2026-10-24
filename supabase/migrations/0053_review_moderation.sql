-- =============================================================
-- Masiat Alsharq ERP — 0053 Customer reviews with moderation (module rating)
-- Business rule (ماسية الشرق): لا يُنشر أي تعليق تلقائياً. كل تقييم/تعليق يصل
-- «قيد المراجعة»، ولا يظهر للزوار إلا بعد موافقة الإدارة. من لوحة التحكم:
-- موافقة ونشر · رفض · إبقاء قيد المراجعة · حذف (soft delete) · مراجعة المنشور.
--
-- The rating module (features/rating) had no table yet — this is its first
-- persistence. Reuses: worker_profiles (0011), customers, has_perm (0013),
-- audit_log (0007). Permissions: rating.view to read the queue, rating.edit to
-- moderate (already granted in 0013/0036).
-- =============================================================

create table if not exists ratings (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid references customers(id) on delete set null,
  customer_name   text not null default 'عميل',
  target_type     text not null check (target_type in ('worker', 'driver', 'service', 'branch')),
  target_name     text not null,
  worker_id       uuid references worker_profiles(id) on delete cascade,
  stars           integer not null check (stars between 1 and 5),
  comment         text not null default '',
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected')),
  moderation_note text,
  moderated_by    uuid references auth.users(id) on delete set null,
  moderated_at    timestamptz,
  deleted_at      timestamptz,             -- حذف = تعطيل (soft delete)
  created_at      timestamptz not null default now()
);
create index if not exists idx_ratings_worker on ratings(worker_id) where deleted_at is null;
create index if not exists idx_ratings_status on ratings(status, created_at desc);

alter table ratings enable row level security;

-- visitors see only approved, non-deleted reviews; staff with rating.view see the queue
drop policy if exists ratings_read on ratings;
create policy ratings_read on ratings for select to anon, authenticated
  using ((status = 'approved' and deleted_at is null) or has_perm('rating', 'view'));

-- anyone may submit — but ONLY as a pending, un-moderated review
drop policy if exists ratings_submit on ratings;
create policy ratings_submit on ratings for insert to anon, authenticated
  with check (status = 'pending' and deleted_at is null and moderated_by is null
              and moderated_at is null);

-- direct updates restricted to moderators (moderate_rating() below is the normal path)
drop policy if exists ratings_moderate on ratings;
create policy ratings_moderate on ratings for update to authenticated
  using (has_perm('rating', 'edit')) with check (has_perm('rating', 'edit'));
-- no delete policy: removal is a soft delete through moderate_rating()

-- ---------- moderation action (audited) ----------------------
-- p_action: 'approve' | 'reject' | 'pending' | 'delete' | 'restore'
create or replace function moderate_rating(p_rating_id uuid, p_action text, p_note text default null)
returns ratings
language plpgsql security definer set search_path = public
as $$
declare
  v_old ratings;
  v_row ratings;
begin
  if not has_perm('rating', 'edit') then
    raise exception 'لا تملك صلاحية مراجعة التعليقات';
  end if;
  if p_action not in ('approve', 'reject', 'pending', 'delete', 'restore') then
    raise exception 'إجراء غير معروف: %', p_action;
  end if;
  select * into v_old from ratings where id = p_rating_id for update;
  if not found then raise exception 'التعليق غير موجود'; end if;

  update ratings set
    status = case p_action
               when 'approve' then 'approved'
               when 'reject'  then 'rejected'
               when 'pending' then 'pending'
               else status end,
    deleted_at = case p_action
                   when 'delete'  then now()
                   when 'restore' then null
                   else deleted_at end,
    moderation_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), moderation_note),
    moderated_by = auth.uid(),
    moderated_at = now()
  where id = p_rating_id
  returning * into v_row;


  insert into audit_log (user_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), 'rating.' || p_action, 'ratings', p_rating_id, to_jsonb(v_old), to_jsonb(v_row));
  return v_row;
end $$;

grant execute on function moderate_rating(uuid, text, text) to authenticated;
