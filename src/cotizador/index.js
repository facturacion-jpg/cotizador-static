export { default, default as Cotizador } from './ui/Cotizador.jsx';
export { configurarFirestore, configurarLocal, modoAlmacenamiento } from './storage.js';
export { ADMIN_EMAIL, esAdmin, TIPOS_PRENDA, PARAMETROS_META } from './config.js';
export { descargarExcel } from './excel/exportar.js';
export { parsearArchivo, parsearLibro } from './excel/importar.js';
export { resumenDeCotizaciones } from './excel/modelo.js';
