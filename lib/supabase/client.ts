import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { supabaseFetch } from "./request";

// Both values are publishable by design. The database remains protected by RLS;
// no secret/service key is ever shipped to the browser.
const fallbackUrl = "https://zttclifwjyedxapgpwfb.supabase.co";
const fallbackPublishableKey = "sb_publishable_F7x6r2OzMeSM3vZndbB1pQ_Z52XrIzL";

export function isSupabaseConfigured() {
  return true;
}

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || fallbackUrl,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || fallbackPublishableKey,
    {
      global: { fetch: supabaseFetch },
      auth: {
        // Invitation and recovery URLs are completed only on /activate with a
        // non-persistent client. This prevents an activation opened beside an
        // administrator session from silently replacing that session.
        detectSessionInUrl: false,
      },
    },
  );
}

export function createSupabaseEphemeralBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || fallbackUrl,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || fallbackPublishableKey,
    {
      global: { fetch: supabaseFetch },
      auth: {
        storageKey: "negodigi-activation-only",
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}

export function createSupabaseRecoveryBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || fallbackUrl,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || fallbackPublishableKey,
    {
      global: { fetch: supabaseFetch },
      auth: {
        // The recovery page must consume the one-time session from the email
        // link before allowing auth.updateUser({ password }).
        detectSessionInUrl: true,
        persistSession: true,
      },
    },
  );
}
