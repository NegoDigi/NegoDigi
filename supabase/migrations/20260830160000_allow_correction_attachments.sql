-- Correction attachments reuse the existing files table and private
-- negodigi-documents bucket. The original files_file_kind_check constraint
-- predates per-correction attachments, so allow that one additional kind.
alter table public.files
  drop constraint if exists files_file_kind_check;

alter table public.files
  add constraint files_file_kind_check
  check (file_kind in ('raw', 'delivery', 'document', 'brand', 'correction_attachment'));

-- Keep attachment rows scoped to a real correction when they use the new kind.
alter table public.files
  drop constraint if exists files_correction_attachment_relation_check;

alter table public.files
  add constraint files_correction_attachment_relation_check
  check (file_kind <> 'correction_attachment' or correction_id is not null);
