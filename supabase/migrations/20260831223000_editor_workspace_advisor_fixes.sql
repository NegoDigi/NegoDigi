-- Follow-up from Supabase database advisors: avoid a duplicate permissive
-- SELECT policy and cover the new foreign keys used for coordination views.

drop policy if exists "ranking settings admin write" on public.editor_ranking_settings;

drop policy if exists "ranking settings admin insert" on public.editor_ranking_settings;
create policy "ranking settings admin insert"
on public.editor_ranking_settings for insert to authenticated
with check (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  and updated_by = auth.uid()
);

drop policy if exists "ranking settings admin update" on public.editor_ranking_settings;
create policy "ranking settings admin update"
on public.editor_ranking_settings for update to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  and updated_by = auth.uid()
);

create index if not exists editor_planning_organization_idx
  on public.editor_planning_blocks(organization_id);
create index if not exists editor_planning_job_idx
  on public.editor_planning_blocks(job_id);
create index if not exists editor_planning_created_by_idx
  on public.editor_planning_blocks(created_by);
create index if not exists editor_ranking_settings_updated_by_idx
  on public.editor_ranking_settings(updated_by);
create index if not exists editor_reward_settings_created_by_idx
  on public.editor_reward_settings(created_by);
create index if not exists editor_monthly_rankings_organization_idx
  on public.editor_monthly_rankings(organization_id);
create index if not exists editor_monthly_awards_editor_idx
  on public.editor_monthly_awards(editor_id);
create index if not exists editor_monthly_awards_reward_setting_idx
  on public.editor_monthly_awards(reward_setting_id);
create index if not exists editor_monthly_awards_confirmed_by_idx
  on public.editor_monthly_awards(confirmed_by);
