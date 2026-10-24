## Corrección de superposición de cabecera y ventanas de detalle (24/10/2026)
- Síntoma: barra de navegación fija por encima de ventanas de detalle de pedidos, bonos y subpáginas.
- Causa: overlays fixed inset-0 renderizados dentro de .app-main, mientras .app-header y .app-sidebar forman capas propias.
- Solución limitada: elevar .app-main solo cuando contenga un diálogo, usando :has(). Compatible con navegadores Chromium modernos. No altera el orden entre diálogos.
- Parche: scripts/fix-modal-layering.mjs, idempotente. El CSS se añade durante la compilación al archivo original app/globals.css, sin reemplazar otros estilos.
- Configuración del build de Vercel: aplicar antes ambos parches, el de bonos y el de capas.
- Verificar con compilación en vista previa; lanzar producción en el proyecto negodigi-os conservando rootDirectory=src.