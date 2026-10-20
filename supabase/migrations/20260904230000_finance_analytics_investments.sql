-- Commit the enum independently before a later migration can reference it.
alter type public.finance_type add value if not exists 'investment';
