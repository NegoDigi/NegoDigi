-- Metas personales por editor y mes. No almacena ingresos ni pagos: esos
-- importes se calculan siempre desde production_video_history.
create table if not exists public.editor_financial_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  editor_id uuid not null references public.editors(id) on delete cascade,
  period_key text not null check (period_key ~ '^\\d{4}-\\d{2}$'),
  target_amount numeric(12,2) not null check (target_amount >= 0),
  motivation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, editor_id, period_key)
);

create index if not exists editor_financial_goals_editor_period_idx
  on public.editor_financial_goals (editor_id, period_key desc);

grant select, insert, update on public.editor_financial_goals to authenticated;

alter table public.editor_financial_goals enable row level security;

create policy editor_financial_goals_select on public.editor_financial_goals
  for select to authenticated
  using (
    private.has_role(organization_id, array['owner','admin']::public.app_role[])
    or exists (
      select 1 from public.editors e
      where e.id = editor_financial_goals.editor_id
        and e.user_id = (select auth.uid())
    )
  );

create policy editor_financial_goals_insert on public.editor_financial_goals
  for insert to authenticated
  with check (
    private.has_role(organization_id, array['owner','admin']::public.app_role[])
    or exists (
      select 1 from public.editors e
      where e.id = editor_financial_goals.editor_id
        and e.user_id = (select auth.uid())
    )
  );

create policy editor_financial_goals_update on public.editor_financial_goals
  for update to authenticated
  using (
    private.has_role(organization_id, array['owner','admin']::public.app_role[])
    or exists (
      select 1 from public.editors e
      where e.id = editor_financial_goals.editor_id
        and e.user_id = (select auth.uid())
    )
  )
  with check (
    private.has_role(organization_id, array['owner','admin']::public.app_role[])
    or exists (
      select 1 from public.editors e
      where e.id = editor_financial_goals.editor_id
        and e.user_id = (select auth.uid())
    )
  );
