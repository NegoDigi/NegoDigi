-- Keep one notification per user and event, while allowing the same video to
-- generate a later notification when its state changes (for example,
-- corrections_requested -> approved or a replacement delivery).
create or replace function private.notify_delivery_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_name text;
  editor_name text;
  job_title text;
  service_name text;
  is_revision boolean;
  event_key text;
begin
  if new.status <> 'pending_review'
    or (tg_op = 'UPDATE' and old.status = new.status) then
    return new;
  end if;
  select c.name, j.title, ji.service, e.name into client_name, job_title, service_name, editor_name
  from public.jobs j join public.clients c on c.id = j.client_id
  left join public.job_items ji on ji.id = new.job_item_id
  left join public.job_assignments ja on ja.id = new.assignment_id
  left join public.editors e on e.id = ja.editor_id where j.id = new.job_id;
  is_revision := (tg_op = 'UPDATE' and old.status = 'changes_requested');
  select is_revision or exists (
    select 1 from public.delivery_submissions previous
    where previous.assignment_id = new.assignment_id and previous.job_item_id is not distinct from new.job_item_id
      and previous.id <> new.id and previous.status = 'changes_requested'
  ) into is_revision;
  event_key := case when is_revision then 'corrected' else 'delivery' end;
  insert into public.notifications (organization_id, user_id, title, body, action_url)
  select new.organization_id, p.id,
    case when is_revision then format('El editor %s ha enviado una versión corregida', coalesce(editor_name, 'Editor')) else format('El editor %s ha enviado una entrega', coalesce(editor_name, 'Editor')) end,
    format('%s · %s · %s · %s vídeo(s) para revisar%s.', coalesce(client_name, 'Cliente'), coalesce(editor_name, 'Editor'), coalesce(job_title, 'Trabajo'), coalesce(service_name, 'Servicio'), trim(to_char(new.quantity, 'FM999999990.##')), case when is_revision then ' · nueva versión corregida' else '' end),
    format('/operaciones?job=%s&submission=%s&event=%s', new.job_id, new.id, event_key)
  from public.profiles p where p.organization_id = new.organization_id and p.role in ('owner'::public.app_role, 'admin'::public.app_role) and p.active = true
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.notify_delivery_submission() from public, anon, authenticated;

create or replace function private.notify_delivery_item_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
  client_name text;
  editor_name text;
  job_title text;
begin
  if new.status not in ('approved', 'changes_requested') or old.status is not distinct from new.status then return new; end if;
  select e.user_id, c.name, e.name, j.title into target_user, client_name, editor_name, job_title
  from public.delivery_submissions ds join public.jobs j on j.id = ds.job_id join public.clients c on c.id = j.client_id
  join public.job_assignments ja on ja.id = ds.assignment_id join public.editors e on e.id = ja.editor_id
  where ds.id = new.submission_id;
  if target_user is null then return new; end if;
  insert into public.notifications (organization_id, user_id, title, body, action_url)
  select new.organization_id, target_user,
    case when new.status = 'approved' then 'Tu trabajo ha sido aprobado' else 'El administrador ha solicitado cambios' end,
    format('%s · %s · %s · %s (%s).', coalesce(client_name, 'Cliente'), coalesce(editor_name, 'Editor'), coalesce(job_title, 'Trabajo'), coalesce(new.label, 'Vídeo'), case when new.status = 'approved' then 'aprobado' else 'correcciones pendientes' end),
    format('/operaciones?job=%s&submission=%s&video=%s&event=%s', ds.job_id, new.submission_id, new.id, new.status)
  from public.delivery_submissions ds where ds.id = new.submission_id
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.notify_delivery_item_review() from public, anon, authenticated;

create or replace function private.notify_delivery_submission_review_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_user uuid; client_name text; editor_name text; job_title text;
begin
  if new.status not in ('approved', 'changes_requested') or old.status is not distinct from new.status
    or exists (select 1 from public.delivery_submission_items dsi where dsi.submission_id = new.id) then return new; end if;
  select e.user_id, c.name, e.name, j.title into target_user, client_name, editor_name, job_title
  from public.jobs j join public.clients c on c.id = j.client_id join public.job_assignments ja on ja.id = new.assignment_id join public.editors e on e.id = ja.editor_id where j.id = new.job_id;
  if target_user is null then return new; end if;
  insert into public.notifications (organization_id, user_id, title, body, action_url) values (
    new.organization_id, target_user,
    case when new.status = 'approved' then 'Tu trabajo ha sido aprobado' else 'El administrador ha solicitado cambios' end,
    format('%s · %s · %s · entrega (%s).', coalesce(client_name, 'Cliente'), coalesce(editor_name, 'Editor'), coalesce(job_title, 'Trabajo'), case when new.status = 'approved' then 'aprobada' else 'correcciones pendientes' end),
    format('/operaciones?job=%s&submission=%s&event=%s', new.job_id, new.id, new.status)
  ) on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.notify_delivery_submission_review_outcome() from public, anon, authenticated;
