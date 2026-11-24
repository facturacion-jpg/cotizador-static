// ============================================================
// CONFIGURACIÓN DEL MÓDULO COTIZADOR
// Este es el ÚNICO archivo que hay que ajustar al integrar.
// ============================================================

// Correo del administrador. Debe coincidir EXACTAMENTE con el de
// firestore.rules (el archivo de reglas es la seguridad real).
// TODO: reemplazar por el correo real del administrador.
export const ADMIN_EMAIL = 'admin@pendiente-por-definir.com';

// El usuario normal NO se define aquí: se toma del login de Firebase Auth.
// Cualquier cuenta autenticada puede cotizar; solo el admin borra y configura.

// ¿El usuario normal puede borrar cotizaciones? (por defecto, no)
// OJO: esto solo muestra u oculta el botón. Para que el borrado funcione de
// verdad hay que cambiar también la regla de `cotizador_cotizaciones` en
// firestore.rules (ver el comentario de ese archivo).
export const PERMITIR_ELIMINAR_AL_USUARIO = false;

// Nombres de las colecciones en Firestore.
export const COLECCIONES = {
  cotizaciones: 'cotizador_cotizaciones',
  config: 'cotizador_config',
  catalogo: 'cotizador_catalogo'
};

export const DOC_PARAMETROS = 'parametros';

// Catálogo incluido en el build (568 operaciones / 193 referencias).
// Si se importa un Excel nuevo, Firestore guarda la versión actualizada
// y esta copia queda solo como respaldo.
export const CATALOGO_INCLUIDO = 'incluido';

// Tipos de prenda usados en el formulario.
export const TIPOS_PRENDA = [
  'Camiseta', 'Blusa', 'Falda', 'Chaqueta / chaleco', 'Short', 'Pantalón',
  'Vestido', 'Buso', 'Polo', 'Conjunto', 'Enterizo', 'Body', 'Otro'
];

// Campos editables de los parámetros del motor.
// `step` controla el incremento del input y `porcentaje` indica que el
// valor se guarda como fracción (0.15 = 15 %).
export const PARAMETROS_META = [
  { key: 'supplementPct', label: 'Suplemento', step: '0.01', porcentaje: true },
  { key: 'costPerMinConf', label: 'Valor minuto confección', step: '1', moneda: true },
  { key: 'costPerMinFinish', label: 'Valor minuto terminación', step: '1', moneda: true },
  { key: 'costPerMinPack', label: 'Valor minuto empaque (opcional)', step: '1', moneda: true },
  { key: 'profitPct', label: 'Utilidad objetivo', step: '0.01', porcentaje: true },
  { key: 'complexityFactor', label: 'Factor de complejidad', step: '0.01' },
  { key: 'workDays', label: 'Días hábiles por mes', step: '1' },
  { key: 'hoursPerDay', label: 'Horas por jornada', step: '0.1' },
  { key: 'efficiency', label: 'Eficiencia', step: '0.01', porcentaje: true }
];

export function esAdmin(email) {
  return String(email || '').trim().toLowerCase() === String(ADMIN_EMAIL).trim().toLowerCase();
}
