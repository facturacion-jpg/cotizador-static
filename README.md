# Cotizador de muestras — 3.0 estático

Versión estática de la UI 3.0 que corría en `cotizador-muestras.onrender.com`, adaptada para **Render Static Site** (sin backend Node).

## Qué funciona hoy

- Misma interfaz 3.0: Cotizar, Historial, Referencias, Importar, Correo.
- Cálculo en navegador con `engine.js` (sin cambios de lógica).
- Datos guardados en `localStorage` del navegador: cotizaciones, parámetros y catálogo importado.
- Importación de Excel (`.xlsx/.xlsm`) en el navegador con SheetJS.
- Exportación de historial a Excel en el navegador (3 hojas: Resumen, Cotizaciones, Detalle operaciones).
- Envío por EmailJS. Si Firebase Storage está configurado, sube el Excel y el correo incluye enlace de descarga; si no, descarga el Excel localmente y envía el correo sin enlace público.

## Despliegue en Render (Static Site)

1. Repo: `facturacion-jpg/cotizador-static`, rama `main`.
2. En Render → Settings:
   - **Build Command**: vacío (o `:`).
   - **Publish Directory**: `.`
3. **Manual Deploy → Clear build cache & deploy**.
4. Verificar en incógnito: `https://cotizador-static.onrender.com/`.

## Configurar Firebase para enlace de Excel en correo

La descarga local del Excel ya funciona sin Firebase. Para que el correo tenga **enlace descargable**, configura Firebase:

### 1) Crear proyecto
- https://console.firebase.google.com → crear proyecto (plan Spark).

### 2) Authentication (sin login visible)
- **Build → Authentication → Sign-in method** → habilitar **Anonymous**.
- **Authentication → Settings → Authorized domains** → agregar `cotizador-static.onrender.com`.

### 3) Storage
- **Build → Storage → Get started**.
- En **Storage → Rules**, publicar el contenido de `storage.rules` de este repo.

### 4) Config web
- **Project settings → Your apps → Web app** → copiar `firebaseConfig`.
- Pegar los valores en `firebase-config.js` (reemplazar `TODO_PEGAR_AQUI`).
- Hacer commit/push; Render redeploya.

## Estado de datos

- **Ahora**: datos en `localStorage` (por navegador). No compartidos entre equipos.
- **Respaldo actual**: descargar Excel desde Historial/Correo.
- **Siguiente paso recomendado**: migrar datos compartidos a Firestore con Auth anónima (sin login), manteniendo este flujo de correo/Excel.

## Archivos clave

- `index.html` — UI 3.0.
- `app.js` — lógica UI, generación Excel, EmailJS, subida a Storage.
- `store.js` — persistencia localStorage.
- `engine.js` — motor de cálculo (sin cambios de lógica).
- `firebase-config.js` — configuración pública Firebase (placeholders).
- `firebase-client.js` — Auth anónima + subida de Excel a Storage.
- `storage.rules` — reglas sugeridas para Storage.
- `catalog.json` — catálogo base.
