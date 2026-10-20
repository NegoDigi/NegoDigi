-- One RPC call is one transaction: failures in services, assignments, deliveries
-- or their existing accounting triggers roll back the entire edit.
create or replace function public.save_job_draft_atomic(p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_job uuid := (p_payload->>'id')::uuid;
  v_client uuid := (p_payload->>'client_id')::uuid;
  v_mode text := p_payload->>'mode';
  v_items jsonb := p_payload->'items';
  v_assignments jsonb := p_payload->'assignments';
  v_progress jsonb := coalesce(p_payload->'progress', '[]'::jsonb);
  v_old public.jobs%rowtype;
  v_item jsonb;
  v_assignment jsonb;
  v_step jsonb;
  v_row record;
  v_client_name text;
  v_title text;
  v_item_id uuid;
  v_assignment_id uuid;
  v_qty numeric;
  v_minimum numeric;
  v_current numeric;
  v_remaining numeric;
  v_delta numeric;
  v_rate numeric;
  v_price numeric;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  select p.organization_id into v_org from public.profiles p
  where p.id = auth.uid() and p.active
    and p.access_state = 'active' and p.role in ('owner', 'admin');
  if v_org is null then
    raise exception 'Solo Dirección puede guardar pedidos.' using errcode = '42501';
  end if;
  if v_job is null or v_client is null or v_mode is null
    or v_mode not in ('planned', 'pending', 'history', 'update') then
    raise exception 'El pedido no es válido.';
  end if;
  if jsonb_typeof(v_items) is distinct from 'array'
    or jsonb_typeof(v_assignments) is distinct from 'array'
    or jsonb_typeof(v_progress) is distinct from 'array' then
    raise exception 'Faltan los servicios o el reparto del pedido.';
  end if;
  if jsonb_array_length(v_items) not between 1 and 100
    or jsonb_array_length(v_assignments) > 100
    or jsonb_array_length(v_progress) > 100 then
    raise exception 'El número de servicios o repartos no es válido.';
  end if;
  select c.name into v_client_name from public.clients c
  where c.id = v_client and c.organization_id = v_org;
  if not found then raise exception 'El cliente no pertenece a tu organización.'; end if;

  if v_mode = 'update' then
    select j.* into v_old from public.jobs j
    where j.id = v_job and j.organization_id = v_org for update;
    if not found then raise exception 'El pedido ya no existe o no tienes acceso.'; end if;
    if v_client <> v_old.client_id and (
      exists (select 1 from public.job_deliveries d join public.job_assignments a on a.id = d.assignment_id where a.job_id = v_job)
      or exists (select 1 from public.delivery_submissions where job_id = v_job)
    ) then
      raise exception 'No puedes cambiar el cliente de un pedido con entregas o revisiones. Crea otro pedido para el nuevo cliente.';
    end if;
    -- Serialize edits to this order and lock the children being replaced.
    perform 1 from public.job_items where job_id = v_job order by id for update;
    perform 1 from public.job_assignments where job_id = v_job order by id for update;
  elsif exists (select 1 from public.jobs where id = v_job) then
    raise exception 'Este pedido ya se guardó. Actualiza la lista antes de repetirlo.';
  end if;

  if exists (select 1 from jsonb_array_elements(v_items) i group by i->>'id' having count(*) > 1)
    or exists (select 1 from jsonb_array_elements(v_assignments) a group by a->>'id' having count(*) > 1)
    or exists (select 1 from jsonb_array_elements(v_assignments) a group by a->>'editor_id' having count(*) > 1)
    or exists (select 1 from jsonb_array_elements(v_progress) p group by p->>'id' having count(*) > 1) then
    raise exception 'Hay servicios o editores duplicados en el reparto.';
  end if;
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_item_id := (v_item->>'id')::uuid;
    if v_item_id is null or coalesce(length(btrim(v_item->>'service')), 0) = 0
      or jsonb_typeof(v_item->'quantity') is distinct from 'number'
      or (v_item->>'quantity')::numeric <= 0 then
      raise exception 'Cada servicio necesita nombre y una cantidad positiva.';
    end if;
    if coalesce((v_item->>'is_new')::boolean, false) then
      if exists (select 1 from public.job_items where id = v_item_id) then
        raise exception 'El servicio nuevo ya existe.';
      end if;
    elsif v_mode <> 'update' or not exists (
      select 1 from public.job_items where id = v_item_id and job_id = v_job and organization_id = v_org
    ) then raise exception 'Un servicio no pertenece a este pedido.';
    end if;
    select coalesce(sum((a->'quantities'->>v_item_id::text)::numeric), 0) into v_qty
    from jsonb_array_elements(v_assignments) a;
    if v_qty > (v_item->>'quantity')::numeric then
      raise exception 'El reparto de % supera las unidades del pedido.', v_item->>'service';
    end if;
    if v_mode = 'history' and v_qty <> (v_item->>'quantity')::numeric then
      raise exception 'Para registrar historial debes repartir todas las unidades de cada servicio.';
    end if;
  end loop;

  for v_assignment in select value from jsonb_array_elements(v_assignments) loop
    v_assignment_id := (v_assignment->>'id')::uuid;
    if v_assignment_id is null or jsonb_typeof(v_assignment->'quantities') is distinct from 'object'
      or not exists (select 1 from public.editors e where e.id = (v_assignment->>'editor_id')::uuid and e.organization_id = v_org) then
      raise exception 'Un editor del reparto no es válido.';
    end if;
    if coalesce((v_assignment->>'is_new')::boolean, false) then
      if exists (select 1 from public.job_assignments where id = v_assignment_id) then
        raise exception 'La asignación nueva ya existe.';
      end if;
    elsif v_mode <> 'update' or not exists (
      select 1 from public.job_assignments where id = v_assignment_id and job_id = v_job and organization_id = v_org
    ) then raise exception 'Una asignación no pertenece a este pedido.';
    end if;
    for v_row in select key, value from jsonb_each(v_assignment->'quantities') loop
      if jsonb_typeof(v_row.value) <> 'number' or (v_row.value #>> '{}')::numeric < 0
        or not exists (select 1 from jsonb_array_elements(v_items) i where i->>'id' = v_row.key) then
        raise exception 'El reparto incluye una cantidad o un servicio no válido.';
      end if;
    end loop;
    if not exists (select 1 from jsonb_each(v_assignment->'quantities') q where (q.value #>> '{}')::numeric > 0) then
      raise exception 'Una asignación debe contener al menos una unidad.';
    end if;
  end loop;
  if v_mode = 'planned' and jsonb_array_length(v_assignments) > 0 then
    raise exception 'Un pedido previsto todavía no tiene reparto.';
  end if;
  if v_mode <> 'update' and jsonb_array_length(v_progress) > 0 then
    raise exception 'El progreso manual se modifica después de crear el pedido.';
  end if;
  if v_mode = 'history' and nullif(p_payload->>'delivered_on', '') is null then
    raise exception 'El registro histórico necesita la fecha de entrega.';
  end if;

  -- Validate existing work before any mutation. Never silently discard an
  -- assignment with deliveries or submissions merely because a form omitted it.
  if v_mode = 'update' then
    for v_row in select a.* from public.job_assignments a where a.job_id = v_job loop
      select a into v_assignment from jsonb_array_elements(v_assignments) a where (a->>'id')::uuid = v_row.id;
      if not found then
        if exists (select 1 from public.job_deliveries where assignment_id = v_row.id)
          or exists (select 1 from public.delivery_submissions where assignment_id = v_row.id) then
          raise exception 'No puedes quitar una asignación con entregas o envíos para revisión.';
        end if;
      elsif (v_assignment->>'editor_id')::uuid <> v_row.editor_id and (
        exists (select 1 from public.job_deliveries where assignment_id = v_row.id)
        or exists (select 1 from public.delivery_submissions where assignment_id = v_row.id)
      ) then raise exception 'No puedes cambiar el editor de una asignación con entregas o revisiones.';
      end if;
    end loop;
    for v_row in
      select ai.*, coalesce((select sum(greatest(0, s.quantity - s.approved_quantity))
        from public.delivery_submissions s where s.assignment_id = ai.assignment_id and s.job_item_id = ai.job_item_id
          and s.status in ('pending_review', 'changes_requested')), 0) as submitted
      from public.job_assignment_items ai join public.job_assignments a on a.id = ai.assignment_id where a.job_id = v_job
    loop
      select coalesce((a->'quantities'->>v_row.job_item_id::text)::numeric, 0) into v_qty
      from jsonb_array_elements(v_assignments) a where (a->>'id')::uuid = v_row.assignment_id;
      if coalesce(v_qty, 0) < v_row.delivered_quantity + v_row.submitted then
        raise exception 'No puedes reducir una asignación por debajo de sus entregas o envíos para revisión.';
      end if;
    end loop;
    if exists (select 1 from public.job_items i where i.job_id = v_job
      and not exists (select 1 from jsonb_array_elements(v_items) d where (d->>'id')::uuid = i.id)
      and (exists (select 1 from public.job_deliveries where job_item_id = i.id)
        or exists (select 1 from public.delivery_submissions where job_item_id = i.id))) then
      raise exception 'No puedes quitar un servicio con entregas o revisiones.';
    end if;
  end if;

  select v_client_name || ' · ' || string_agg((i->>'quantity') || ' ' || (i->>'service'), ' · ' order by ord)
  into v_title from jsonb_array_elements(v_items) with ordinality x(i, ord);
  if v_mode = 'update' then
    update public.jobs set client_id = v_client, title = v_title,
      assigned_on = case when p_payload ? 'assigned_on' then nullif(p_payload->>'assigned_on', '')::date else v_old.assigned_on end,
      planned_on = case when p_payload ? 'planned_on' then nullif(p_payload->>'planned_on', '')::date else v_old.planned_on end,
      due_on = case when p_payload ? 'due_on' then nullif(p_payload->>'due_on', '')::date else v_old.due_on end
    where id = v_job and organization_id = v_org;
    if not found then raise exception 'El pedido no se pudo actualizar.'; end if;
    delete from public.job_assignments a where a.job_id = v_job
      and not exists (select 1 from jsonb_array_elements(v_assignments) d where (d->>'id')::uuid = a.id);
  else
    -- Do not INSERT RETURNING: the existing SELECT policy resolves the job
    -- through a stable helper. The UUID was already validated above.
    insert into public.jobs(id, organization_id, client_id, title, status, assigned_on, planned_on, due_on, delivered_on, source)
    values (v_job, v_org, v_client, v_title,
      (case when v_mode = 'history' then 'delivered' else v_mode end)::public.job_status,
      case when v_mode = 'history' then (p_payload->>'delivered_on')::date
        when v_mode = 'planned' then null else nullif(p_payload->>'assigned_on', '')::date end,
      case when v_mode = 'planned' then nullif(p_payload->>'assigned_on', '')::date else null end,
      case when v_mode = 'pending' then nullif(p_payload->>'due_on', '')::date else null end,
      case when v_mode = 'history' then (p_payload->>'delivered_on')::date else null end, 'app');
  end if;
  for v_item in select value from jsonb_array_elements(v_items) loop
    if coalesce((v_item->>'is_new')::boolean, false) then
      insert into public.job_items(id, organization_id, job_id, service, quantity)
      values ((v_item->>'id')::uuid, v_org, v_job, v_item->>'service', (v_item->>'quantity')::numeric);
    else
      update public.job_items set service = v_item->>'service', quantity = (v_item->>'quantity')::numeric
      where id = (v_item->>'id')::uuid and job_id = v_job and organization_id = v_org;
      if not found then raise exception 'El servicio no se pudo actualizar.'; end if;
    end if;
  end loop;
  for v_assignment in select value from jsonb_array_elements(v_assignments) loop
    v_assignment_id := (v_assignment->>'id')::uuid;
    if coalesce((v_assignment->>'is_new')::boolean, false) then
      insert into public.job_assignments(id, organization_id, job_id, editor_id, assigned_on, due_on, status)
      values (v_assignment_id, v_org, v_job, (v_assignment->>'editor_id')::uuid,
        case when v_mode = 'history' then (p_payload->>'delivered_on')::date
          else coalesce(nullif(p_payload->>'assigned_on', '')::date, v_old.assigned_on, v_today) end,
        case when v_mode = 'history' then null else coalesce(nullif(v_assignment->>'due_on', '')::date, nullif(p_payload->>'due_on', '')::date) end,
        case when v_mode = 'history' then 'completed' else 'pending' end);
    else
      update public.job_assignments set editor_id = (v_assignment->>'editor_id')::uuid,
        due_on = coalesce(nullif(v_assignment->>'due_on', '')::date, nullif(p_payload->>'due_on', '')::date)
      where id = v_assignment_id and job_id = v_job and organization_id = v_org;
      if not found then raise exception 'La asignación no se pudo actualizar.'; end if;
    end if;
    for v_item in select value from jsonb_array_elements(v_items) loop
      v_item_id := (v_item->>'id')::uuid;
      v_qty := coalesce((v_assignment->'quantities'->>v_item_id::text)::numeric, 0);
      if v_qty = 0 then
        delete from public.job_assignment_items where assignment_id = v_assignment_id and job_item_id = v_item_id and organization_id = v_org;
      elsif exists (select 1 from public.job_assignment_items where assignment_id = v_assignment_id and job_item_id = v_item_id) then
        update public.job_assignment_items set assigned_quantity = v_qty
        where assignment_id = v_assignment_id and job_item_id = v_item_id and organization_id = v_org;
      else
        select r.editor_unit_cost, r.client_unit_price into v_rate, v_price from public.client_rates r
        where r.organization_id = v_org and r.client_id = v_client and r.active
          and (case when r.service in ('Miniatura', 'Miniaturas') then 'Miniaturas' else r.service end) = v_item->>'service'
        order by r.created_at desc, r.id limit 1;
        insert into public.job_assignment_items(organization_id, assignment_id, job_item_id, assigned_quantity, editor_unit_cost)
        values (v_org, v_assignment_id, v_item_id, v_qty, coalesce(v_rate, 0));
        if v_mode = 'history' then
          insert into public.job_deliveries(organization_id, assignment_id, job_item_id, quantity, delivered_on, client_unit_price, billable, notes)
          values (v_org, v_assignment_id, v_item_id, v_qty, (p_payload->>'delivered_on')::date, coalesce(v_price, 0), false, 'Registro histórico creado desde Producción');
        end if;
      end if;
    end loop;
    delete from public.job_assignment_items ai where ai.assignment_id = v_assignment_id
      and not exists (select 1 from jsonb_array_elements(v_items) i where (i->>'id')::uuid = ai.job_item_id);
  end loop;
  if v_mode = 'update' then
    delete from public.job_items i where i.job_id = v_job
      and not exists (select 1 from jsonb_array_elements(v_items) d where (d->>'id')::uuid = i.id);
  end if;

  for v_step in select value from jsonb_array_elements(v_progress) loop
    v_item_id := (v_step->>'id')::uuid;
    if jsonb_typeof(v_step->'delivered') is distinct from 'number'
      or (v_step->>'delivered')::numeric < 0
      or not exists (select 1 from jsonb_array_elements(v_items) i where (i->>'id')::uuid = v_item_id) then
      raise exception 'El progreso no es válido para este pedido.';
    end if;
    select coalesce(sum(ai.assigned_quantity), 0), coalesce(sum(ai.delivered_quantity), 0)
      into v_qty, v_current from public.job_assignment_items ai
      join public.job_assignments a on a.id = ai.assignment_id where a.job_id = v_job and ai.job_item_id = v_item_id;
    select coalesce(sum(greatest(0, s.quantity - s.approved_quantity)), 0) into v_minimum
    from public.delivery_submissions s join public.job_assignments a on a.id = s.assignment_id
    where a.job_id = v_job and s.job_item_id = v_item_id and s.status in ('pending_review', 'changes_requested');
    v_remaining := (v_step->>'delivered')::numeric - v_current;
    if (v_step->>'delivered')::numeric > v_qty then raise exception 'El progreso supera las unidades asignadas.'; end if;
    if v_remaining > 0 and (v_step->>'delivered')::numeric > v_qty - v_minimum then
      raise exception 'Hay unidades en revisión. Apruébalas desde la revisión antes de modificar el progreso manual.';
    end if;
    if v_remaining > 0 then
      for v_row in select ai.*, coalesce((select sum(greatest(0, s.quantity - s.approved_quantity))
          from public.delivery_submissions s where s.assignment_id = ai.assignment_id and s.job_item_id = ai.job_item_id
            and s.status in ('pending_review', 'changes_requested')), 0) as submitted
        from public.job_assignment_items ai join public.job_assignments a on a.id = ai.assignment_id
        where a.job_id = v_job and ai.job_item_id = v_item_id order by ai.created_at, ai.id
      loop
        v_delta := least(v_remaining, greatest(0, v_row.assigned_quantity - v_row.delivered_quantity - v_row.submitted));
        if v_delta > 0 then
          insert into public.job_deliveries(organization_id, assignment_id, job_item_id, quantity, delivered_on, notes)
          values (v_org, v_row.assignment_id, v_item_id, v_delta, v_today, 'Ajuste manual desde la ficha');
          v_remaining := v_remaining - v_delta;
        end if;
        exit when v_remaining = 0;
      end loop;
    elsif v_remaining < 0 then
      v_remaining := -v_remaining;
      for v_row in select d.* from public.job_deliveries d join public.job_assignments a on a.id = d.assignment_id
        where a.job_id = v_job and d.job_item_id = v_item_id and d.submission_item_id is null
        order by d.delivered_on desc, d.created_at desc, d.id desc
      loop
        v_delta := least(v_remaining, v_row.quantity);
        if v_delta = v_row.quantity then
          delete from public.job_deliveries where id = v_row.id and organization_id = v_org;
        else
          update public.job_deliveries set quantity = quantity - v_delta, notes = 'Ajuste manual desde la ficha'
          where id = v_row.id and organization_id = v_org;
        end if;
        v_remaining := v_remaining - v_delta;
        exit when v_remaining = 0;
      end loop;
    end if;
    if v_remaining <> 0 then
      raise exception 'El progreso incluye entregas aprobadas. Modifícalas desde su historial; no se ha aplicado ningún cambio.';
    end if;
  end loop;
  return v_job;
end;
$$;
revoke all on function public.save_job_draft_atomic(jsonb) from public, anon;
grant execute on function public.save_job_draft_atomic(jsonb) to authenticated;
