"use client";

import { useEffect } from "react";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[workspace.render]", error.name, error.message, error.digest); }, [error]);
  return <main className="grid min-h-screen place-items-center bg-[#080b11] p-6 text-white"><section className="max-w-md space-y-4"><h1 className="text-xl font-semibold">No se pudo mostrar esta pantalla</h1><p className="text-sm leading-6 text-slate-400">Puedes volver a cargarla sin cerrar tu sesión. Si estabas guardando un cambio, comprueba su resultado antes de repetirlo.</p><button onClick={reset} className="rounded-xl bg-violet-500 px-5 py-3 text-sm font-medium">Volver a cargar</button></section></main>;
}
