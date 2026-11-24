# Cotizador de muestras — 3.0 estático

Versión estática de la UI 3.0 que corría en `cotizador-muestras.onrender.com`, adaptada para **Render Static Site** (sin backend Node).

## Qué funciona hoy

- Misma interfaz 3.0: Cotizar, Historial, Referencias, Importar, Correo.
- Cálculo en navegador con `engine.js` (sin cambios de lógica).
- Datos guardados en `localStorage` del navegador: cotizaciones, parámetros y catálogo importado.
- Importación de Excel (`.xlsx/.xlsm`) en el navegador con SheetJS.
- Exportación de historial a Excel en el navegador (3 hojas: Resumen, Cotizaciones, Detalle operaciones).
- Envío por EmailJS. Si **Supabase** o **Firebase Storage** está configurado, sube el Excel y el correo incluye enlace de descarga; si no, descarga el Excel localmente y envía el correo sin enlace público.
- Validación de correo destino antes de enviar (evita el 422 típico por espacios/formato).

## Despliegue en Render (Static Site)

1. Repo: `facturacion-jpg/cotizador-static`, rama `main`.
2. En Render → Settings:
   - **Build Command**: vacío (o `:`).
   - **Publish Directory**: `.`
3. **Manual Deploy → Clear build cache & deploy**.
4. Verificar en incógnito: `https://cotizador-static.onrender.com/`.

## Opción recomendada para link de Excel: Supabase (sin tarjeta)

Firebase Storage requiere plan Blaze/tarjeta. Para plan free sin tarjeta, usa Supabase:

1. Crea proyecto en https://supabase.com (free).
2. **Storage → New bucket**: `cotizador_exports` (Private recomendado).
3. En **SQL Editor**, crea policies mínimas (ajusta el nombre del bucket si cambias):

```sql
-- Permite subir archivos al bucket desde la anon key (solo insert)
create policy "cotizador_upload_xlsx"
on storage.objects for insert to anon
with check (
  bucket_id = 'cotizador_exports'
  and (storage.extension(name) = 'xlsx')
);

-- Permite crear signed URLs/leer objetos necesarios para descarga firmada
create policy "cotizador_read_signed"
on storage.objects for select to anon
using (bucket_id = 'cotizador_exports');
```

4. En **Project Settings → API** copia `Project URL` y `anon public key`.
5. Pégalos en `supabase-config.js`, commit/push. Render redeploya.
6. Prueba con “Vista previa del correo”: debe mostrar enlace de descarga.

> Nota seguridad: la `anon key` es pública. No habilites `list/delete` para anon. Usa signed URLs (el código ya las pide, expiran en 7 días por defecto).

## Opción Firebase Storage (requiere Blaze)

Solo si activas Blaze/tarjeta:
- Habilitar Auth Anonymous.
- Crear Storage y publicar `storage.rules`.
- Pegar config en `firebase-config.js`.
- Agregar `cotizador-static.onrender.com` en dominios autorizados.

## EmailJS

La app usa estos IDs públicos en `app.js`:
- `EMAILJS_SERVICE_ID = 'service_8lq3ei3'`
- `EMAILJS_TEMPLATE_ID = 'template_ersho2m'`
- `EMAILJS_PUBLIC_KEY = 'd1WCtmrksSpYe5uKe'`

Si sale `422 The recipients address is corrupted`, revisa en EmailJS que el template tenga **To Email = `{{to_email}}`** (sin espacios/comas), y usa un solo correo válido.

## Estado de datos

- **Ahora**: datos en `localStorage` (por navegador). No compartidos entre equipos.
- **Respaldo actual**: descargar Excel desde Historial/Correo.
- **Siguiente paso recomendado**: migrar datos compartidos a Firestore/Supabase DB con auth anónima.

## Archivos clave

- `index.html` — UI 3.0.
- `app.js` — lógica UI, generación Excel, EmailJS, subida a Storage.
- `store.js` — persistencia localStorage.
- `engine.js` — motor de cálculo (sin cambios de lógica).
- `supabase-config.js` / `supabase-client.js` — enlace de Excel por Supabase (recomendado free).
- `firebase-config.js` / `firebase-client.js` — alternativa Firebase (requiere Blaze para Storage).
- `storage.rules` — reglas sugeridas para Firebase Storage.
- `catalog.json` — catálogo base.
