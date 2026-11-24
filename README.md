# Cotizador de muestras — 3.0 estático

Versión estática de la UI 3.0 que corría en `cotizador-muestras.onrender.com`, adaptada para **Render Static Site** (sin backend Node).

## Qué hace

- Misma interfaz 3.0: Cotizar, Historial, Referencias, Importar, Correo.
- Motor de cálculo `engine.js` en el navegador (sin `/api/calculate`).
- Datos guardados en `localStorage` del navegador: cotizaciones, parámetros y catálogo importado.
- Importación de Excel (`.xlsx/.xlsm`) en el navegador con SheetJS.
- Exportación de historial a Excel en el navegador (3 hojas: Resumen, Cotizaciones, Detalle operaciones).
- Envío por EmailJS (resumen); el Excel se descarga localmente para adjuntarlo si la plantilla lo requiere.

## Despliegue en Render

1. Repo: `facturacion-jpg/cotizador-static`.
2. Render → **Static Site**.
3. **Build Command:** *(vacío)*.
4. **Publish Directory:** `.`

No requiere variables de entorno ni build.

## Nota importante

Al ser estático, los datos quedan en el navegador del equipo. Para compartir/respaldar, use **Historial → Descargar Excel** o la pestaña **Correo**. Si borra datos del navegador, pierde las cotizaciones locales.

## Archivos clave

- `index.html` — UI 3.0.
- `app.js` — lógica UI + adaptador local (reemplaza `/api/*`).
- `store.js` — persistencia localStorage + bootstrap/cálculo.
- `engine.js` — motor de cálculo (sin cambios de lógica).
- `catalog.json` — catálogo base.
- `_redirects` — SPA fallback para Render.
