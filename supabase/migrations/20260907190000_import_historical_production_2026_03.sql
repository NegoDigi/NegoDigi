-- March 2026 historical production import.
-- These records are explicitly non-billable: they feed Production and Team
-- history only, never Finance, bonuses, receivables or payment calculations.
do $$
declare
  org_id uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  line record;
  item record;
  client_id uuid;
  editor_id uuid;
  job_id uuid;
  assignment_id uuid;
  normalized_client text;
  job_source_key text := 'historical_import_2026_03_capture_01';
  lines jsonb := $data$
  [
    {"line_no":1,"client_name":"Ferran Rafús Aulet","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-03","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":2,"client_name":"Juanma FIT","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-03","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":3,"client_name":"Juanma FIT","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-07","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":4,"client_name":"Eric Rodriguez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-07","items":[{"service":"YouTube","quantity":1,"unit_price":5}]},
    {"line_no":5,"client_name":"CL Stylo Motor","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-07","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]},
    {"line_no":6,"client_name":"Alvaro Bello Vazquez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-11","items":[{"service":"Reels","quantity":3,"unit_price":2}]},
    {"line_no":7,"client_name":"Alvaro Bello Vazquez","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-11","items":[{"service":"Reels","quantity":3,"unit_price":2}]},
    {"line_no":8,"client_name":"Juanma FIT","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-11","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]},
    {"line_no":9,"client_name":"Marina Cisneros","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-11","items":[{"service":"Reels","quantity":4,"unit_price":3}]},
    {"line_no":10,"client_name":"US Fans","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-11","items":[{"service":"Reels","quantity":1,"unit_price":3.5}]},
    {"line_no":11,"client_name":"Alvaro García","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-16","items":[{"service":"Reels","quantity":2,"unit_price":5}]},
    {"line_no":12,"client_name":"FM Four Miami","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-16","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]},
    {"line_no":13,"client_name":"CL Stylo Motor","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-16","items":[{"service":"Reels","quantity":4,"unit_price":3.5}]},
    {"line_no":14,"client_name":"Ruben Herrero","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-16","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":15,"client_name":"Juanma FIT","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-17","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":16,"client_name":"Manuel Castillo","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-16","items":[{"service":"Reels","quantity":39,"unit_price":2}]},
    {"line_no":17,"client_name":"US Fans","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-16","items":[{"service":"Reels","quantity":1,"unit_price":3.5}]},
    {"line_no":18,"client_name":"Alvaro Punzano","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-16","items":[{"service":"Reels","quantity":2,"unit_price":3}]},
    {"line_no":19,"client_name":"FM Four Miami","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-16","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":20,"client_name":"Manuel Castillo","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-23","items":[{"service":"Reels","quantity":41,"unit_price":2}]},
    {"line_no":21,"client_name":"Ruben Herrero","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-19","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":22,"client_name":"Ferran Rafús Aulet","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-22","items":[{"service":"Reels","quantity":4,"unit_price":3.5}]},
    {"line_no":23,"client_name":"Alvaro Punzano","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-23","items":[{"service":"Reels","quantity":2,"unit_price":3}]},
    {"line_no":24,"client_name":"Monica Cortes","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-21","items":[{"service":"Reels","quantity":3,"unit_price":3}]},
    {"line_no":25,"client_name":"US Fans","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-23","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":26,"client_name":"Alvaro Punzano","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-24","items":[{"service":"Reels","quantity":3,"unit_price":3}]},
    {"line_no":27,"client_name":"Silvia","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-25","items":[{"service":"Reels","quantity":1,"unit_price":3.5}]},
    {"line_no":28,"client_name":"Iker Arias","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-30","items":[{"service":"YouTube","quantity":3,"unit_price":7}]},
    {"line_no":29,"client_name":"Iker Arias","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-30","items":[{"service":"YouTube","quantity":3,"unit_price":7}]},
    {"line_no":30,"client_name":"Alvaro García","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-30","items":[{"service":"Reels","quantity":2,"unit_price":5}]},
    {"line_no":31,"client_name":"Juanma FIT","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-30","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]},
    {"line_no":32,"client_name":"US Fans","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-30","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":33,"client_name":"CL Gustto App","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-30","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":34,"client_name":"Manuel Castillo 2","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-30","items":[{"service":"Reels","quantity":3,"unit_price":3}]},
    {"line_no":35,"client_name":"CL Sara Odontóloga","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-03-30","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":36,"client_name":"Carmen López","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-30","items":[{"service":"Reels","quantity":13,"unit_price":2}]},
    {"line_no":37,"client_name":"CL Gustto App","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-30","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]},
    {"line_no":38,"client_name":"CL Varola Homes","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-30","items":[{"service":"Reels","quantity":1,"unit_price":3.5}]},
    {"line_no":39,"client_name":"CL Gold Green Borja","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-30","items":[{"service":"Reels","quantity":1,"unit_price":3.5}]},
    {"line_no":40,"client_name":"Juanma FIT","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-03-30","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]}
  ]$data$::jsonb;
begin
  for line in select * from jsonb_to_recordset(lines) as x(line_no integer, client_name text, editor_name text, delivered_on date, items jsonb)
  loop
    normalized_client := case
      when lower(line.client_name) = lower('Alvaro García') then 'Alvaro Garcia'
      when lower(line.client_name) = lower('CL Gustto App') then 'CL Gusto App'
      when lower(line.client_name) = lower('Carmen López') then 'Carmen López Bauzá'
      else line.client_name
    end;
    select c.id into client_id from public.clients c where c.organization_id = org_id and lower(c.name) = lower(normalized_client) limit 1;
    if client_id is null then
      insert into public.clients (organization_id, name, status, relationship_type)
      values (org_id, normalized_client, 'active', 'former') returning id into client_id;
    end if;
    if not exists (select 1 from public.leads l where l.organization_id = org_id and lower(trim(l.name)) = lower(normalized_client)) then
      insert into public.leads (organization_id, name, interest, stage)
      values (org_id, normalized_client, 'Producción histórica', 'past_client');
    end if;
    select e.id into editor_id from public.editors e where e.organization_id = org_id and lower(e.name) = lower(line.editor_name) limit 1;
    if editor_id is null then
      raise exception 'No se encontró el editor histórico %', line.editor_name;
    end if;
    if not exists (
      select 1 from public.jobs j
      where j.organization_id = org_id and j.source = job_source_key
        and j.title = format('Histórico · %s · marzo línea %s', line.client_name, line.line_no)
    ) then
      insert into public.jobs (organization_id, client_id, editor_id, title, status, assigned_on, delivered_on, source)
      values (org_id, client_id, editor_id, format('Histórico · %s · marzo línea %s', line.client_name, line.line_no), 'delivered', line.delivered_on, line.delivered_on, job_source_key)
      returning id into job_id;
      insert into public.job_assignments (organization_id, job_id, editor_id, assigned_on, status)
      values (org_id, job_id, editor_id, line.delivered_on, 'completed') returning id into assignment_id;
      for item in select * from jsonb_to_recordset(line.items) as y(service text, quantity numeric, unit_price numeric)
      loop
        declare job_item_id uuid;
        begin
          insert into public.job_items (organization_id, job_id, service, quantity)
          values (org_id, job_id, item.service, item.quantity) returning id into job_item_id;
          insert into public.job_assignment_items (organization_id, assignment_id, job_item_id, assigned_quantity, editor_unit_cost)
          values (org_id, assignment_id, job_item_id, item.quantity, item.unit_price);
          insert into public.job_deliveries (organization_id, assignment_id, job_item_id, quantity, delivered_on, client_unit_price, billable, notes)
          values (org_id, assignment_id, job_item_id, item.quantity, line.delivered_on, item.unit_price, false, 'Importación histórica: solo Producción y Equipo, no contabiliza en Finanzas');
        end;
      end loop;
    end if;
  end loop;

  select id into editor_id from public.editors where organization_id = org_id and lower(name) = lower('NegoBot') limit 1;
  insert into public.production_historical_work_items (organization_id, editor_id, period_key, work_name, amount, source_key)
  values (org_id, editor_id, '2026-03', 'Video Eric', 20.00, 'historical_import_2026_03_summary_01')
  on conflict (organization_id, source_key, work_name) do update set amount = excluded.amount, editor_id = excluded.editor_id;
end;
$$;
