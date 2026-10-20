-- The live ranking has three positive criteria that total 100%, plus two
-- explicit point deductions. Legacy columns remain synchronized for old RPCs.
alter table public.editor_ranking_settings
  add column if not exists late_penalty_points numeric not null default 2,
  add column if not exists correction_penalty_points numeric not null default 1;

update public.editor_ranking_settings
set value_weight = 40,
    quality_weight = 30,
    punctuality_weight = 30,
    correction_weight = 0,
    completion_weight = 40,
    rework_weight = 0,
    activity_weight = 0,
    commitment_weight = 0,
    late_penalty_points = 2,
    correction_penalty_points = 1;

alter table public.editor_ranking_settings
  drop constraint if exists editor_ranking_settings_check;

alter table public.editor_ranking_settings
  add constraint editor_ranking_settings_check
  check (
    quality_weight + punctuality_weight + completion_weight + rework_weight + activity_weight = 100
  );
