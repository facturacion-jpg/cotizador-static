# Cotizador de muestras — 3.0 estático

Versión estática de la UI 3.0 que corría en `cotizador-muestras.onrender.com`, adaptada para **Render Static Site** (sin backend Node).

## Qué funciona hoy

- Misma interfaz 3.0: Cotizar, Historial, Referencias, Importar, Correo.
- Cálculo en navegador con `engine.js` (sin cambios de lógica).
- Datos guardados en `localStorage` del navegador: cotizaciones, parámetros y catálogo importado.
- **Respaldo rápido de historial**: en Importar → “Descargar copia actual” genera un JSON con cotizaciones/parámetros/catálogo/referencias. “Probar esta copia” y “Restaurar desde esta copia” permiten mover el historial a otro navegador/PC.
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

## Guardado compartido + link de Excel: Supabase (sin tarjeta)

Firebase Storage requiere plan Blaze/tarjeta. Para plan free sin tarjeta, usa Supabase. La misma configuración sirve para:
- **Enlace descargable del Excel** en correos (Storage + signed URL).
- **Historial compartido en cualquier dispositivo** (tabla `cotizador_state`).

### 1) Crear proyecto
1. Crea proyecto en https://supabase.com (free).
2. En **Project Settings → API** copia `Project URL` y `anon public key`.

### 2) Storage para Excel
1. **Storage → New bucket**: `cotizador_exports` (Private recomendado).
2. En **SQL Editor**, ejecuta:

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

### 3) Tabla para historial compartido
En **SQL Editor**, ejecuta:

```sql
create table if not exists public.cotizador_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.cotizador_state enable row level security;

-- IMPORTANTE: esto permite leer/escribir el estado compartido con la anon key.
-- Es práctico para uso interno rápido, pero no es seguro para datos públicos/sensibles.
create policy "cotizador_state_select_anon"
on public.cotizador_state for select to anon
using (true);

create policy "cotizador_state_insert_anon"
on public.cotizador_state for insert to anon
with check (true);

create policy "cotizador_state_update_anon"
on public.cotizador_state for update to anon
using (true)
with check (true);
```

### 4) Configurar la app
1. En el repo `facturacion-jpg/cotizador-static`, edita `supabase-config.js`:

```js
window.COTIZADOR_SUPABASE_CONFIG = {
  url: 'https://TU-PROYECTO.supabase.co',
  anonKey: 'TU_ANON_PUBLIC_KEY',
  bucket: 'cotizador_exports',
  signedUrlSeconds: 604800 // 7 días
};
```

2. Commit/push a `main`. Render redeploya.
3. Prueba:
   - Abre la app en dispositivo A, guarda una cotización.
   - Abre la misma URL en dispositivo B/incógnito: debe aparecer en Historial.
   - En Correo, “Vista previa del correo” debe mostrar enlace de descarga.

> Nota seguridad: la `anon key` es pública. Las policies de `cotizador_state` hacen el historial compartido **sin login** (cualquiera con la key/proyecto podría leerlo si la obtiene). Para uso interno rápido está bien; para producción, agregar Auth y RLS por usuario.

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
- **Respaldo rápido**: Importar → “Descargar copia actual” (JSON). Ese JSON se puede probar/restaurar en otro navegador/PC.
- **Respaldo/entrega**: Excel desde Historial/Correo.
- **Siguiente paso recomendado**: migrar datos compartidos a Firestore/Supabase DB para que el historial sea común entre equipos.

## Archivos clave

- `index.html` — UI 3.0.
- `app.js` — lógica UI, generación Excel, EmailJS, subida a Storage.
- `store.js` — persistencia localStorage.
- `engine.js` — motor de cálculo (sin cambios de lógica).
- `supabase-config.js` / `supabase-client.js` — enlace de Excel por Supabase (recomendado free).
- `firebase-config.js` / `firebase-client.js` — alternativa Firebase (requiere Blaze para Storage).
- `storage.rules` — reglas sugeridas para Firebase Storage.
- `catalog.json` — catálogo base.
