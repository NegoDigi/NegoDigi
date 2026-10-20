-- January lower summary table: no client/date was shown, so keep the original
-- work labels and attribute both entries to NegoBot without inventing details.
do $$
declare org_id uuid := '00000000-0000-4000-8000-000000000001'::uuid;
declare editor_id uuid;
begin
  select e.id into editor_id from public.editors e where e.organization_id = org_id and lower(e.name) = lower('NegoBot') limit 1;
  insert into public.production_historical_work_items (organization_id, editor_id, period_key, work_name, amount, source_key) values
    (org_id, editor_id, '2026-01', 'Video Yenny', 35.00, 'historical_import_2026_01_summary_01'),
    (org_id, editor_id, '2026-01', 'Video Ricky Pack', 35.00, 'historical_import_2026_01_summary_01')
  on conflict (organization_id, source_key, work_name) do update set amount = excluded.amount, editor_id = excluded.editor_id;
end;
$$;
