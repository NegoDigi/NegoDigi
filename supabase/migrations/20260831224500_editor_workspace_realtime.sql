-- Realtime invalidation for the connected editor workspace. RLS remains the
-- source of truth for which rows each authenticated user can receive.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'job_deliveries',
    'delivery_corrections',
    'editor_activity_events',
    'editor_planning_blocks',
    'editor_ranking_settings',
    'editor_reward_settings',
    'editor_monthly_awards'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        table_name
      );
    end if;
  end loop;
end;
$$;
