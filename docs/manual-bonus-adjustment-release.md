# Edición manual de bonos junto con las entregas automáticas · 24 octubre 2026

Rehabilita la edición manual de consumo sin reintroducir el problema de duplicidades: cada acción explícita de edición escribe un movimiento auditable, de forma independiente a los controles de Guardar configuración.

Al añadir unidades, se crea un movimiento `usage` con `source=manual_service_adjustment` y detalle del servicio y precio. Al corregir, se registra un cambio `usage` con `source=manual_override`, pero únicamente sobre el servicio modificado (patch de snapshot). No se tocan las entregas automáticas ni su historia.

Los cambios se verifican contra `bonus_balances.used_amount` y los IDs vigentes de movimientos antes del INSERT, de modo que nuevas entregas concurrentes obliguen a actualizar en vez de escribir un ajuste sobre una copia antigua.

Los saldos se actualizan mediante los triggers existentes de Supabase. La autorización exige owner/admin y la política RLS actual. Se añade un botón separado de confirmación, aviso de efecto económico, soporte de alta de servicios personalizados, correcciones con motivo obligatorio y refresco inmediato.

Para desplegar: reconstruir los 154 archivos de la fuente original de producción en Vercel y aplicar sucesivamente `finance-bonus-production-patch.mjs`, `fix-modal-layering.mjs`, `enable-manual-bonus-adjustment.mjs` durante `next.config.ts`, manteniendo `rootDirectory=src` y `target=production` solo después de pasar el build de Preview. Evitar merge de main incompleto.

Pruebas: `tests/manual-bonus-adjustment.test.mjs`, `tests/bonus-service-usage.test.mjs` y verificación en Preview de TypeScript.

No se crean movimientos reales hasta que un administrador pulse Guardar ajuste manual dentro de la web.