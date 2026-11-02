-- The role × permission matrix in the DB must equal tests/role_permissions.json.
-- The frontend mirror (apps/web/src/lib/permissions.ts) is checked against the
-- same file by lib/__tests__/permissionMatrix.test.ts — one source, both sides.
\set ON_ERROR_STOP 1
\set matrix `cat tests/role_permissions.json`
create temp table _matrix as select :'matrix'::jsonb as j;
do $$
declare v_diff text;
begin
  with expected as (
    select e.key as role_code, p.value as perm
    from _matrix m, jsonb_each(m.j) e, jsonb_array_elements_text(e.value) p
  ), actual as (
    select role_code, module || '.' || action as perm from role_permissions
  ), diff as (
    (select 'missing in DB: ' || role_code || ' ' || perm as d from (select * from expected except select * from actual) x)
    union all
    (select 'extra in DB: ' || role_code || ' ' || perm from (select * from actual except select * from expected) y)
  )
  select string_agg(d, E'\n') into v_diff from diff;
  if v_diff is not null then raise exception 'FAIL: permission matrix drift%', E'\n' || v_diff; end if;
end $$;
select 'permission matrix: in sync' as result;
