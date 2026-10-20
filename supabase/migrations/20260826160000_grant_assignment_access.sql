-- Assignment RLS policies call this private security-definer helper.
-- The API role must be able to invoke it while evaluating those policies.
grant execute on function private.can_access_assignment(uuid) to authenticated;
