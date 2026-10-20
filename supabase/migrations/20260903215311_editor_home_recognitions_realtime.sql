do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'editor_daily_ranking_points',
    'editor_weekly_recognitions'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
