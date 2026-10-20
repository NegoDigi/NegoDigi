-- Keep the accounting row for an approved video tied to its logical item.
-- Re-approvals after corrections can then update the same row instead of
-- creating a second delivery/payment record.
alter table public.job_deliveries
  add column if not exists submission_item_id uuid
    references public.delivery_submission_items(id) on delete set null;

create unique index if not exists job_deliveries_submission_item_unique
  on public.job_deliveries(submission_item_id)
  where submission_item_id is not null;
