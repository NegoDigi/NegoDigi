# NegoDigi OS — despliegue de bonos sin perder módulos

Este lanzamiento usa la fuente INTACTA del despliegue Vercel CLI del 23 de octubre de 2026 (dpl_J3yhgbpVNLwU3i8WxDWG5THnGiBj), recuperada por referencias SHA-1 desde la API de Vercel. No parte del código incompleto del branch main.

Cambios: scripts/finance-bonus-production-patch.mjs modifica SOLO la función de consumo y formularios de bonos durante la compilación de producción; el módulo puro lib/bonus-service-usage.mjs calcula el desglose con todos los servicios registrados (manual y automático) y los ajustes históricos.

PREVENCIÓN: Esta rama no es directamente publicable por GitHub: el resto del código fuente completo del último CLI deployment sigue alojado en Vercel y debe reconstruirse con las referencias de ese despliegue. La configuración de compilación invoca node scripts/finance-bonus-production-patch.mjs antes del build Next.js; falla explícitamente si hay una discrepancia en los marcadores del código fuente. Los datos de Supabase no se reescriben.

Caso de control: Andrés Flores = 18 reels / 270 € consumidos / 180 € disponibles.
