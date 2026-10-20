-- February historical production import.
-- These rows are production history only: billable=false keeps them out of
-- Finance, receivables and bonus consumption.
create table if not exists public.production_historical_work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  editor_id uuid not null references public.editors(id) on delete restrict,
  period_key text not null check (period_key ~ '^[0-9]{4}-[0-9]{2}$'),
  work_name text not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  source_key text not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (organization_id, source_key, work_name)
);

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
  job_source_key text := 'historical_import_2026_02_capture_01';
  lines jsonb := $data$
  [
    {"line_no":1,"client_name":"Graciela Fernández Sánchez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-04","items":[{"service":"Reels","quantity":2,"unit_price":3.5},{"service":"YouTube","quantity":3,"unit_price":5}]},
    {"line_no":2,"client_name":"Daniel","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-04","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]},
    {"line_no":3,"client_name":"Alberto Noda Paz","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-08","items":[{"service":"Miniatura","quantity":1,"unit_price":10}]},
    {"line_no":4,"client_name":"Gaston VSL","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-08","items":[{"service":"Miniatura","quantity":1,"unit_price":10}]},
    {"line_no":5,"client_name":"Pedro Gonzalez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-10","items":[{"service":"Reels","quantity":1,"unit_price":3}]},
    {"line_no":6,"client_name":"Graciela Fernández Sánchez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-10","items":[{"service":"Reels","quantity":5,"unit_price":2},{"service":"YouTube","quantity":2,"unit_price":5}]},
    {"line_no":7,"client_name":"Alberto Noda Paz","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-12","items":[{"service":"Reels","quantity":3,"unit_price":3}]},
    {"line_no":8,"client_name":"Juan Abril","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-17","items":[{"service":"Reels","quantity":11,"unit_price":2}]},
    {"line_no":9,"client_name":"Carmen López","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-16","items":[{"service":"Reels","quantity":7,"unit_price":2}]},
    {"line_no":10,"client_name":"CL Stylo Motor","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-15","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]},
    {"line_no":11,"client_name":"CL De Local a Turístico","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-19","items":[{"service":"Reels","quantity":10,"unit_price":3.5}]},
    {"line_no":12,"client_name":"CL Gold Green Borja","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-19","items":[{"service":"Reels","quantity":5,"unit_price":3.5}]},
    {"line_no":13,"client_name":"Aida Perez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-14","items":[{"service":"Reels","quantity":15,"unit_price":2}]},
    {"line_no":14,"client_name":"Aida Perez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-14","items":[{"service":"Reels","quantity":3,"unit_price":3}]},
    {"line_no":15,"client_name":"Ferran Rafús Aulet","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-02-20","items":[{"service":"Reels","quantity":1,"unit_price":5}]},
    {"line_no":16,"client_name":"Aratz","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-20","items":[{"service":"Reels","quantity":1,"unit_price":3.5}]},
    {"line_no":17,"client_name":"Alvaro Bello Vazquez","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-02-21","items":[{"service":"Reels","quantity":4,"unit_price":2}]},
    {"line_no":18,"client_name":"CL Gusto App","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-21","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]},
    {"line_no":19,"client_name":"CL Gusto App","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-02-21","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]},
    {"line_no":20,"client_name":"CL Stylo Motor","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-21","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]},
    {"line_no":21,"client_name":"CL Gold Green Borja","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-21","items":[{"service":"Reels","quantity":2,"unit_price":3.5}]},
    {"line_no":22,"client_name":"Graciela Fernández Sánchez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-22","items":[{"service":"Reels","quantity":5,"unit_price":2}]},
    {"line_no":23,"client_name":"Graciela Fernández Sánchez","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-02-22","items":[{"service":"Reels","quantity":1,"unit_price":2}]},
    {"line_no":24,"client_name":"Aida Perez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-22","items":[{"service":"Reels","quantity":2,"unit_price":2}]},
    {"line_no":25,"client_name":"Graciela Fernández Sánchez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-25","items":[{"service":"Reels","quantity":5,"unit_price":2}]},
    {"line_no":26,"client_name":"Albert Maglini","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-02-25","items":[{"service":"Reels","quantity":4,"unit_price":2}]},
    {"line_no":27,"client_name":"CL Gold Green Borja","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-25","items":[{"service":"Reels","quantity":1,"unit_price":2}]},
    {"line_no":28,"client_name":"Eric Rodriguez","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-02-25","items":[{"service":"Reels","quantity":8,"unit_price":2}]},
    {"line_no":29,"client_name":"Eric Rodriguez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-25","items":[{"service":"Reels","quantity":4,"unit_price":2}]},
    {"line_no":30,"client_name":"CL Stylo Motor","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-02-28","items":[{"service":"Reels","quantity":3,"unit_price":3.5}]},
    {"line_no":31,"client_name":"Alberto Noda Paz","editor_name":"Miguel Alejandro Lovera Tigsi","delivered_on":"2026-02-28","items":[{"service":"Reels","quantity":1,"unit_price":3}]},
    {"line_no":32,"client_name":"Graciela Fernández Sánchez","editor_name":"Edgar Jesús Jiménez Rivas","delivered_on":"2026-02-28","items":[{"service":"Reels","quantity":3,"unit_price":2}]}
  ]$data$::jsonb;
begin
  for line in select * from jsonb_to_recordset(lines) as x(line_no integer, client_name text, editor_name text, delivered_on date, items jsonb)
  loop
    normalized_client := case
      when lower(line.client_name) = lower('Pedro Gonzalez') then 'Pedro Gonzales'
      when lower(line.client_name) = lower('Carmen López') then 'Carmen López Bauzá'
      when lower(line.client_name) = lower('Albert Maglini') then 'Albert Mangili'
      else line.client_name
    end;
    select c.id into client_id from public.clients c where c.organization_id = org_id and lower(c.name) = lower(normalized_client) limit 1;
    if client_id is null then
      insert into public.clients (organization_id, name, status, relationship_type) values (org_id, normalized_client, 'active', 'former') returning id into client_id;
    end if;
    if lower(line.client_name) = lower('Gaston VSL') and not exists (select 1 from public.leads l where l.organization_id = org_id and lower(trim(l.name)) = lower('Gaston VSL')) then
      insert into public.leads (organization_id, name, interest, stage) values (org_id, 'Gaston VSL', 'Miniatura', 'past_client');
    end if;
    select e.id into editor_id from public.editors e where e.organization_id = org_id and lower(e.name) = lower(line.editor_name) limit 1;
    if editor_id is null then
      insert into public.editors (organization_id, name, role_label, status) values (org_id, line.editor_name, 'Editor', 'archived') returning id into editor_id;
    end if;
    if not exists (select 1 from public.jobs j where j.organization_id = org_id and j.source = job_source_key and j.title = format('Histórico · %s · febrero línea %s', line.client_name, line.line_no)) then
      insert into public.jobs (organization_id, client_id, editor_id, title, status, assigned_on, delivered_on, source) values (org_id, client_id, editor_id, format('Histórico · %s · febrero línea %s', line.client_name, line.line_no), 'delivered', line.delivered_on, line.delivered_on, job_source_key) returning id into job_id;
      insert into public.job_assignments (organization_id, job_id, editor_id, assigned_on, status) values (org_id, job_id, editor_id, line.delivered_on, 'completed') returning id into assignment_id;
      for item in select * from jsonb_to_recordset(line.items) as y(service text, quantity numeric, unit_price numeric)
      loop
        declare job_item_id uuid;
        begin
          insert into public.job_items (organization_id, job_id, service, quantity) values (org_id, job_id, item.service, item.quantity) returning id into job_item_id;
          insert into public.job_assignment_items (organization_id, assignment_id, job_item_id, assigned_quantity, editor_unit_cost) values (org_id, assignment_id, job_item_id, item.quantity, item.unit_price);
          insert into public.job_deliveries (organization_id, assignment_id, job_item_id, quantity, delivered_on, client_unit_price, billable, notes) values (org_id, assignment_id, job_item_id, item.quantity, line.delivered_on, item.unit_price, false, 'Importación histórica: solo Producción, no contabiliza en Finanzas');
        end;
      end loop;
    end if;
  end loop;

  select e.id into editor_id from public.editors e where e.organization_id = org_id and lower(e.name) = lower('NegoBot') limit 1;
  insert into public.production_historical_work_items (organization_id, editor_id, period_key, work_name, amount, source_key) values
    (org_id, editor_id, '2026-02', 'Aratz', 60.00, 'historical_import_2026_02_summary_01'),
    (org_id, editor_id, '2026-02', 'Portada Grace', 1.50, 'historical_import_2026_02_summary_01'),
    (org_id, editor_id, '2026-02', 'Juan Abril', 6.00, 'historical_import_2026_02_summary_01'),
    (org_id, editor_id, '2026-02', 'Aida Perez / AUTOMATIZACION', 60.00, 'historical_import_2026_02_summary_01'),
    (org_id, editor_id, '2026-02', 'JuanmaFit / AUTOMATIZACION', 12.00, 'historical_import_2026_02_summary_01'),
    (org_id, editor_id, '2026-02', 'Alfredo ADS', 80.00, 'historical_import_2026_02_summary_01')
  on conflict (organization_id, source_key, work_name) do update set amount = excluded.amount, editor_id = excluded.editor_id;
end;
$$;
