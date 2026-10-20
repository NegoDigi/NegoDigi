-- Historical January capture: production history only.
-- These rows are non-billable and intentionally do not create finance movements,
-- receivables or bonus usage.
do $$
declare
  org_id uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  line record;
  item record;
  client_id uuid;
  editor_id uuid;
  job_id uuid;
  assignment_id uuid;
  normalized_editor text;
  source_key text := 'historical_import_2026_01_capture_01';
  lines jsonb := $data$
  [
    {"line_no":1,"client_name":"Iker Arias","editor_name":"Daniel Manrique Sua","delivered_on":"2026-01-04","items":[{"service":"Reels","quantity":3,"unit_price":5}]},
    {"line_no":2,"client_name":"Damian","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-01-07","items":[{"service":"YouTube","quantity":3,"unit_price":5}]},
    {"line_no":3,"client_name":"Iker Arias","editor_name":"Daniel Manrique Sua","delivered_on":"2026-01-08","items":[{"service":"Reels","quantity":1,"unit_price":5}]},
    {"line_no":4,"client_name":"Damian","editor_name":"Daniel Manrique Sua","delivered_on":"2026-01-11","items":[{"service":"Miniatura","quantity":1,"unit_price":40}]},
    {"line_no":5,"client_name":"AG Mikel Serrano","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-01-14","items":[{"service":"Reels","quantity":1,"unit_price":2}]},
    {"line_no":6,"client_name":"Yenny Parra","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-01-14","items":[{"service":"YouTube","quantity":2,"unit_price":5}]},
    {"line_no":7,"client_name":"Eric Rodriguez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-01-16","items":[{"service":"Reels","quantity":9,"unit_price":2},{"service":"YouTube","quantity":1,"unit_price":10}]},
    {"line_no":8,"client_name":"Gonzalo Carrion","editor_name":"Daniel Manrique Sua","delivered_on":"2026-01-15","items":[{"service":"Reels","quantity":3,"unit_price":2}]},
    {"line_no":9,"client_name":"Fermin","editor_name":"Daniel Manrique Sua","delivered_on":"2026-01-20","items":[{"service":"Reels","quantity":2,"unit_price":3}]},
    {"line_no":10,"client_name":"Alvaro Bello Vazquez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-01-20","items":[{"service":"Reels","quantity":9,"unit_price":2}]},
    {"line_no":11,"client_name":"Alvaro Bello Vazquez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-01-22","items":[{"service":"Reels","quantity":9,"unit_price":2}]},
    {"line_no":12,"client_name":"Aratz","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-01-25","items":[{"service":"YouTube","quantity":1,"unit_price":12}]},
    {"line_no":13,"client_name":"Joy VSL","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-01-28","items":[{"service":"YouTube","quantity":1,"unit_price":10}]},
    {"line_no":14,"client_name":"Graciela Fernández Sánchez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-02","items":[{"service":"YouTube","quantity":1,"unit_price":5}]}
  ]$data$::jsonb;
begin
  -- The historical editor exists without an account, so it remains archived.
  select e.id into editor_id
  from public.editors e
  where e.organization_id = org_id and lower(e.name) = lower('Daniel Manrique Sua')
  limit 1;

  if editor_id is null then
    insert into public.editors (organization_id, name, role_label, status)
    values (org_id, 'Daniel Manrique Sua', 'Editor', 'archived')
    returning id into editor_id;
  end if;

  for line in
    select *
    from jsonb_to_recordset(lines) as x(
      line_no integer,
      client_name text,
      editor_name text,
      delivered_on date,
      items jsonb
    )
  loop
    normalized_editor := case
      when lower(line.editor_name) = lower('Santiago Martínez Vallejo') then 'NegoBot'
      else line.editor_name
    end;

    select c.id into client_id
    from public.clients c
    where c.organization_id = org_id and lower(c.name) = lower(line.client_name)
    limit 1;

    if client_id is null then
      insert into public.clients (organization_id, name, status, relationship_type)
      values (org_id, line.client_name, 'active', 'unclassified')
      returning id into client_id;
    end if;

    select e.id into editor_id
    from public.editors e
    where e.organization_id = org_id and lower(e.name) = lower(normalized_editor)
    limit 1;

    if editor_id is null then
      insert into public.editors (organization_id, name, role_label, status)
      values (
        org_id,
        normalized_editor,
        'Editor',
        case when lower(normalized_editor) = lower('Daniel Manrique Sua') then 'archived' else 'inactive' end
      )
      returning id into editor_id;
    end if;

    if not exists (
      select 1
      from public.jobs j
      where j.organization_id = org_id
        and j.source = source_key
        and j.title = format('Histórico · %s · línea %s', line.client_name, line.line_no)
    ) then
      insert into public.jobs (
        organization_id, client_id, editor_id, title, status,
        assigned_on, delivered_on, source
      )
      values (
        org_id, client_id, editor_id,
        format('Histórico · %s · línea %s', line.client_name, line.line_no),
        'delivered', line.delivered_on, line.delivered_on, source_key
      )
      returning id into job_id;

      insert into public.job_assignments (
        organization_id, job_id, editor_id, assigned_on, due_on, status
      )
      values (
        org_id, job_id, editor_id, line.delivered_on, null, 'completed'
      )
      returning id into assignment_id;

      for item in
        select *
        from jsonb_to_recordset(line.items) as y(
          service text,
          quantity numeric,
          unit_price numeric
        )
      loop
        declare
          job_item_id uuid;
        begin
          insert into public.job_items (
            organization_id, job_id, service, quantity
          )
          values (
            org_id, job_id, item.service, item.quantity
          )
          returning id into job_item_id;

          insert into public.job_assignment_items (
            organization_id, assignment_id, job_item_id,
            assigned_quantity, editor_unit_cost
          )
          values (
            org_id, assignment_id, job_item_id,
            item.quantity, item.unit_price
          );

          insert into public.job_deliveries (
            organization_id, assignment_id, job_item_id,
            quantity, delivered_on, client_unit_price, billable, notes
          )
          values (
            org_id, assignment_id, job_item_id,
            item.quantity, line.delivered_on, item.unit_price, false,
            'Importación histórica: solo Producción, no contabiliza en Finanzas'
          );
        end;
      end loop;
    end if;
  end loop;
end;
$$;
