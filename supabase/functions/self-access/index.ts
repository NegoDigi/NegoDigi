import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired security-sensitive endpoint. Account activation now requires the
// approval workflow in account-setup and cannot be completed with an email
// address and a caller-selected password.
Deno.serve(() => new Response(
  JSON.stringify({ error: "Este flujo ya no está disponible. Solicita el acceso desde NegoDigi." }),
  {
    status: 410,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  },
));

