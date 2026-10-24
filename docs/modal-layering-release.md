## Corrección de superposición de cabecera y ventanas de detalle (24/10/2026)
- Síntoma: barra de navegación fija por encima de ventanas de detalle de pedidos, bonos y subpáginas.
- Causa: overlays fixed inset-0 renderizados dentro de .app-main, mientras .app-header y .app-sidebar forman capas propias.
- Solución limitada: elevar .app-main solo cuando contenga un diálogo, usando :has(). Compatible con navegadores Chromium modernos. No altera el orden entre diálogos.
- Parche: scripts/fix-modal-layering.mjs, idempotente. El CSS se añade durante la compilación al archivo original app/globals.css, sin reemplazar otros estilos.
- Configuración del build de Vercel: aplicar antes ambos parches, el de bonos y el de capas.
- Verificar con compilación en vista previa; lanzar producción en el proyecto negodigi-os conservando rootDirectory=src.

## Despliegue verificado
- Proyecto: negodigi-os / prj_SKBGljpOdUT8GSiN3vdhOTq560Ji.
- Producción activa: dpl_EkwogeFtqkFxidhoHFSqPF75wnPe (READY, 24/10/2026).
- Dominio verificado: https://app.negodigi.com (resuelve al nuevo despliegue).
- Base de código intacta: 154 archivos del CLI deployment dpl_J3yhgbpVNLwU3i8WxDWG5THnGiBj.
- Parches aplicados durante el build: consumo de bonos y elevación de capas de ventanas.
- Build Vercel: compilación y TypeScript correctos, rutas /editores y /trabaja-con-nosotros presentes.
- Runtime Vercel: sin clusters de errores registrados en la ventana revisada.
- Rollback en caso de regresión: despliegue anterior dpl_2HmN4jEgqZowGfSZakrwPcYAjwqk.
- Validación manual dentro de sesión administrativa pendiente; las pruebas de build no sustituyen una prueba visual real.
