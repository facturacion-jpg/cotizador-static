# Cotizador de muestras — Static Site (sin pantalla de login)

App React lista para publicar en Render Static Site. Abre el link y entra directo
al cotizador: **no hay formulario de login**.

Tiene dos modos:

| Modo | Cuándo | Datos | Admin |
| --- | --- | --- | --- |
| **Local** (por defecto) | Sin configurar Firebase | `localStorage` de ese navegador | Todos los permisos en ese navegador |
| **Firestore** | Con `VITE_FIREBASE_*` llenos | Firestore, compartido por todos los que abran el link | Solo el UID configurado |

El cambio entre modos es automático: si las variables de Firebase están vacías,
la app funciona igual desde el primer día.

---

## 1. Publicar ya en Render (sin Firebase)

1. Subir esta carpeta a GitHub (o a un repo nuevo).
2. En Render: **New → Static Site** y elegir ese repo.
3. Configurar:
   - **Build command**: `npm install && npm run build`
   - **Publish directory**: `dist`
4. **Create Static Site**. No hace falta backend ni variables de entorno.
5. Verificar que `https://<tu-app>.onrender.com` muestra el cotizador.

Incluye `render.yaml` con esa configuración por si se prefiere usar Blueprint.
El archivo `public/_redirects` se copia solo a `dist/` durante el build y evita
404 al recargar rutas internas.

En este modo:

- Los datos quedan en el navegador que los creó (no se comparten entre equipos).
- Para pasarlos a otro equipo: pestaña **Historial → Descargar Excel**.
- Al limpiar los datos del navegador se pierden las cotizaciones guardadas.

---

## 2. Pasar a Firestore (sin login visible)

Firebase se usa con **Auth anónima**: la app entra sola, sin pedir correo ni
contraseña. Los datos quedan en Firestore y los ve cualquiera que abra el link.

### Paso 1 — Crear el proyecto

1. Entrar a https://console.firebase.google.com y crear proyecto (plan Spark).
2. **Build → Authentication → Sign-in method** → habilitar **Anonymous**.
3. **Build → Firestore Database → Create database** (modo producción).
4. **Project settings → Your apps → Web app** → copiar el objeto `firebaseConfig`.

### Paso 2 — Reglas

Pegar `firestore.rules` en **Firestore → Rules** y publicar.
Dejar `TODO_UID` por ahora; se reemplaza en el paso 4.

### Paso 3 — Variables en Render

En el Static Site → **Environment**, agregar:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=proyecto.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_ADMIN_UID=TODO
```

Luego **redeploy** manual (las variables `VITE_*` se graban en el build).

### Paso 4 — Definir el administrador

1. Abrir el link de Render.
2. Abajo de la página, desplegar **Información de sesión**.
3. Copiar el **ID** que aparece (es el de ese navegador).
4. Pegar ese ID:
   - en `VITE_ADMIN_UID` (Render → Environment → redeploy), y
   - en `firestore.rules`, reemplazando `TODO_UID` → publicar reglas.
5. Recargar el link: ese navegador ya ve las pestañas **Parámetros** e
   **Importar Excel**.

> Si se borran los datos del navegador, el ID anónimo cambia y hay que repetir
> el paso 4. Es la contrapartida de no tener login.

---

## 3. Uso diario

- **Cotizar**: escribir código, descripción, tipo y marca; buscar operación por
  nombre, ajustar cantidad y tiempo; guardar.
- **Historial**: buscar, seleccionar varias cotizaciones y descargar Excel.
- **Referencias**: consultar las 193 referencias; el admin puede cambiar la marca.
- **Parámetros** (admin): 9 valores del motor y botón *Verificar cálculo*.
- **Importar Excel** (admin): acepta `.xlsx`/`.xlsm`; las macros no se ejecutan.

---

## 4. Modelo de datos (modo Firestore)

| Ruta | Permisos |
| --- | --- |
| `cotizador_cotizaciones/{id}` | lectura y creación para cualquier sesión; borrado solo admin |
| `cotizador_config/parametros` | lectura para todos, escritura solo admin |
| `cotizador_config/marcas` | lectura para todos, escritura solo admin |
| `cotizador_catalogo/{doc}` | lectura para todos, escritura solo admin |

El catálogo de 568 operaciones / 193 referencias viene dentro del build, así que
no se gasta en leerlo de Firestore salvo que se importe un Excel nuevo.

---

## 5. Si algo falla

| Síntoma | Solución |
| --- | --- |
| Pantalla "No se pudo iniciar Firebase" | Revisar las variables `VITE_FIREBASE_*` y que Anonymous esté activo. Botón *Continuar en modo local* permite seguir. |
| `Missing or insufficient permissions` | Reglas no publicadas o el UID no es el de ese navegador. |
| No aparecen pestañas de admin | El ID de sesión no coincide con `VITE_ADMIN_UID`. |
| Al recargar no aparece una cotización | En modo local, ese dato se guardó en otro navegador; usar el Excel. |
| 404 al entrar a una ruta | Falta `_redirects` en `dist/`. |
| La descarga no inicia | El navegador bloqueó descargas automáticas del sitio. |

---

## 6. Cambios en el código

El cotizador vive en `src/cotizador/` y es una copia de `../cotizador-module/src/cotizador/`.
Si se modifica el módulo, sincronizar:

```bash
npm run sync
npm run build
```

No editar `src/cotizador/engine.js`: es el motor de cálculo y no se toca.

Pruebas del módulo (16 en verde):

```bash
cd ../cotizador-module && npm install && npm test
```
