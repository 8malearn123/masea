-- Rollback for 0086_public_site.sql. The company profile data is dropped with its table.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists site_media_write on storage.objects';
  end if;
end $$;
drop function if exists submit_web_lead(text, text, text, text, text, text);
drop function if exists public_site_info();
drop table if exists company_profile cascade;
drop function if exists touch_company_profile();
