-- This function is an internal trigger on auth.users. It must not be exposed as
-- an RPC endpoint to anonymous or authenticated clients.
revoke execute on function public.activate_profile_after_invitation_confirmation()
  from public, anon, authenticated;
