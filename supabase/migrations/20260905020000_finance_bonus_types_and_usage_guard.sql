-- Finance-only bonus configuration. Existing records remain credit balances and
-- retain every historical consumption and amount already registered.
alter table public.bonus_accounts
  add column if not exists bonus_type text not null default 'credit',
  add column if not exists allowed_services jsonb not null default '[]'::jsonb,
  add column if not exists pack_config jsonb not null default '{}'::jsonb,
  add column if not exists delivery_frequency text,
  add column if not exists notes text;

alter table public.bonus_accounts
  drop constraint if exists bonus_accounts_bonus_type_check;
alter table public.bonus_accounts
  add constraint bonus_accounts_bonus_type_check
  check (bonus_type in ('credit', 'closed_pack'));

-- One delivery may consume a particular bonus once. This protects the future
-- delivery integration from double clicks/retries while leaving non-job manual
-- adjustments and historical movements untouched.
create unique index if not exists bonus_movements_unique_job_usage_idx
  on public.bonus_movements (bonus_id, job_id, movement_type)
  where job_id is not null and movement_type = 'usage';

comment on column public.bonus_accounts.bonus_type is 'credit balance or closed delivery pack';
comment on column public.bonus_accounts.allowed_services is 'Allowed services and only explicitly saved price references for credit bonuses';
comment on column public.bonus_accounts.pack_config is 'Service, contracted quantity and delivered quantity for closed packs';
