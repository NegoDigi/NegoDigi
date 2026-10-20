-- NegoDigi OS · Núcleo: archivos vinculados a clientes, equipo y documentos generales
-- Idempotent extension of the existing private files registry.

alter table public.files
  add column if not exists editor_id uuid references public.editors(id) on delete cascade,
  add column if not exists title text,
  add column if not exists notes text,
  add column if not exists external_url text;

alter table public.files drop constraint if exists files_file_kind_check;
alter table public.files
  add constraint files_file_kind_check
  check (file_kind = any (array['raw'::text, 'delivery'::text, 'document'::text, 'brand'::text, 'contract'::text, 'correction_attachment'::text]));

create index if not exists files_editor_id_idx on public.files (editor_id);
create index if not exists files_kind_scope_idx on public.files (organization_id, file_kind, created_at desc);

comment on column public.files.editor_id is 'Optional editor/team subject for Núcleo documents such as contracts.';
comment on column public.files.title is 'Human-readable title for Núcleo documents; file_name remains the uploaded filename.';
comment on column public.files.external_url is 'Optional external link associated with a document; never treated as a stored upload.';
