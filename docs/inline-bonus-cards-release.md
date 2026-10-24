# Bonos — edición directa, sin panel adicional

Fecha: 24-10-2026.

Se recupera exactamente el aspecto compacto de las tarjetas «Consumo por servicio». Los campos Unidades y Precio/unidad admiten borrar, escribir o reemplazar valores directamente. El componente `BonusInlineConsumptionCards` mantiene los valores como cadenas de texto durante la edición para no convertir un campo vacío en cero mientras el usuario escribe.

**Guardado**: al salir del conjunto de tarjetas o pulsar Enter, se agrupan todas las modificaciones en un solo `bonus_movements` con source=`manual_override`, version=3 y snapshot únicamente de los servicios modificados. Sin un panel de edición separado ni confirmaciones adicionales. Escape revierte el campo en edición. Mientras se escribe no hay consultas a Supabase: solo un render local pequeño.

**Integridad**: el importe contabilizado es el delta frente a las cantidades reales previas; un cambio de unidades conserva importes históricos de precios mixtos; cambiar el precio recalcula explícitamente la tarifa de las unidades. Las entregas automáticas y otros servicios quedan intactos. Antes de insertar, compara balance e IDs del libro con la foto original: si llegan nuevas entregas, rechaza la edición obsoleta y refresca. Tras guardar conserva una versión optimista para impedir duplicidades si hay otro blur antes de refrescar.

**Alcance**: Finanzas → Bonos y Bonos general (solo administradores). «Guardar configuración» sigue gestionando únicamente metadatos. Conserva la corrección de capas de la cabecera. No hay cambios de estructura SQL, datos, cuentas, ni permisos.

**Compilación segura**: recuperar los 154 archivos del despliegue original `dpl_J3yhgbpVNLwU3i8WxDWG5THnGiBj` en Vercel y aplicar `finance-bonus-production-patch.mjs`, `fix-modal-layering.mjs`, `inline-bonus-cards-patch.mjs` por ese orden. NO ejecutar el antiguo `enable-manual-bonus-adjustment.mjs`. Deben estar presentes los módulos `bonus-service-usage.mjs`, `manual-bonus-adjustment.mjs`, `inline-bonus-patch.mjs` y `bonus-inline-consumption-cards.tsx`.

**Pruebas**: 7 escenarios de edición directa, más pruebas preexistentes de bonos y de movimientos manuales. Caso Albert Linares: 5 reels × 8 € → escribir 6 → 48 €; delta +8 €. Mantener saldo correcto, respetar importes y movimientos previos.

El código fuente publicado en Vercel todavía debe integrarse completamente en la rama main: se conserva esta rama independiente para no borrar funciones añadidas vía Vercel CLI.
