-- Security-invoker Production views join organizations to apply the correct
-- timezone. RLS already limits rows to the signed-in user's organization.
grant select on public.organizations to authenticated;

