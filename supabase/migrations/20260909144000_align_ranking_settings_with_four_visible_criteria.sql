-- The UI exposes four ranking criteria. Keep the old compatibility fields in
-- sync so legacy routines and the current UI both validate the same 100% sum.
update public.editor_ranking_settings
set completion_weight = value_weight,
    rework_weight = correction_weight,
    activity_weight = 0,
    commitment_weight = 0;

alter table public.editor_ranking_settings
  drop constraint if exists editor_ranking_settings_check;

alter table public.editor_ranking_settings
  add constraint editor_ranking_settings_check
  check (
    quality_weight + punctuality_weight + completion_weight + rework_weight + activity_weight = 100
  );
