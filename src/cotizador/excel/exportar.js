// Genera el Excel del historial en el navegador (sin servidor).
import writeXlsxFile from 'write-excel-file/universal';
import {
  resumenDeCotizaciones,
  COLUMNAS_COTIZACIONES,
  COLUMNAS_DETALLE,
  FORMATOS_COTIZACIONES,
  FORMATOS_DETALLE,
  fechaLocal,
  moneda
} from './modelo.js';

const ESTILO_TITULO = { fontWeight: 'bold', fontSize: 14 };
const ESTILO_CABECERA = {
  fontWeight: 'bold',
  backgroundColor: '#2D4036',
  color: '#FFFFFF',
  align: 'center',
  borderColor: '#D5DED8',
  borderStyle: 'thin'
};

function celda(valor, formato) {
  if (valor === null || valor === undefined || valor === '') {
    return { value: '', format: undefined };
  }
  if (formato && typeof valor !== 'string') {
    const n = Number(valor);
    return { value: Number.isFinite(n) ? n : String(valor), format: formato };
  }
  return { value: valor };
}

function celdaNumero(valor, formato, negrita) {
  const n = Number(valor);
  const base = Number.isFinite(n) ? { value: n, format: formato } : { value: '' };
  return negrita ? { ...base, fontWeight: 'bold' } : base;
}

/** Construye las tres hojas (función pura, se puede probar sin navegador). */
export function construirHojas(cotizaciones, seleccionadas) {
  const r = resumenDeCotizaciones(cotizaciones, seleccionadas);

  // ---- Hoja 1: Resumen ----
  const resumen = [
    [{ value: 'HISTORIAL DE COTIZACIONES', ...ESTILO_TITULO }],
    [],
    [{ value: 'Generado', fontWeight: 'bold' }, { value: fechaLocal(new Date().toISOString()) }],
    [{ value: 'Cotizaciones', fontWeight: 'bold' }, celdaNumero(r.count, '#,##0')],
    [{ value: 'Desde', fontWeight: 'bold' }, { value: r.from }],
    [{ value: 'Hasta', fontWeight: 'bold' }, { value: r.to }],
    [{ value: 'SAM total (min)', fontWeight: 'bold' }, celdaNumero(r.totalSam, '0.000')],
    [{ value: 'Costo total', fontWeight: 'bold' }, celdaNumero(r.totalCost, '#,##0.00')],
    [{ value: 'Precio sugerido total', fontWeight: 'bold' }, celdaNumero(r.totalPrice, '#,##0.00')],
    [{ value: 'Precio sugerido promedio', fontWeight: 'bold' }, celdaNumero(r.avgPrice, '#,##0.00')],
    [],
    [{ value: 'Por tipo de prenda', fontWeight: 'bold' }],
    [
      { value: 'Tipo', fontWeight: 'bold' },
      { value: 'Cotizaciones', fontWeight: 'bold' },
      { value: 'Precio sugerido', fontWeight: 'bold' }
    ],
    ...r.byType.map((t) => [
      { value: t.type },
      celdaNumero(t.count, '#,##0'),
      celdaNumero(t.totalPrice, '#,##0.00')
    ]),
    [],
    [{ value: 'Por marca', fontWeight: 'bold' }],
    [
      { value: 'Marca', fontWeight: 'bold' },
      { value: 'Cotizaciones', fontWeight: 'bold' },
      { value: 'Precio sugerido', fontWeight: 'bold' }
    ],
    ...r.byBrand.map((m) => [
      { value: m.brand },
      celdaNumero(m.count, '#,##0'),
      celdaNumero(m.totalPrice, '#,##0.00')
    ])
  ];

  // ---- Hoja 2: Cotizaciones ----
  const cotizacionesHoja = [
    COLUMNAS_COTIZACIONES.map((texto) => ({ value: texto, ...ESTILO_CABECERA })),
    ...r.filasCotizaciones.map((fila) =>
      fila.map((valor, i) => celda(valor, FORMATOS_COTIZACIONES[i]))
    )
  ];

  // ---- Hoja 3: Detalle operaciones ----
  const detalle = [
    COLUMNAS_DETALLE.map((texto) => ({ value: texto, ...ESTILO_CABECERA })),
    ...r.filasDetalle.map((fila) =>
      fila.map((valor, i) => celda(valor, FORMATOS_DETALLE[i]))
    )
  ];

  return {
    resumen: r,
    hojas: [
      {
        nombre: 'Resumen',
        filas: resumen,
        columnas: [{ width: 28 }, { width: 24 }, { width: 18 }]
      },
      {
        nombre: 'Cotizaciones',
        filas: cotizacionesHoja,
        columnas: COLUMNAS_COTIZACIONES.map((texto) => ({ width: Math.min(40, Math.max(11, texto.length + 2)) }))
      },
      {
        nombre: 'Detalle operaciones',
        filas: detalle,
        columnas: COLUMNAS_DETALLE.map((texto) => ({ width: Math.min(40, Math.max(11, texto.length + 2)) }))
      }
    ]
  };
}

export function nombreArchivoExcel(fecha = new Date()) {
  const iso = fecha.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '_');
  return 'historial_' + iso + '.xlsx';
}

/**
 * Genera el .xlsx en memoria. Devuelve { blob, fileName, count, total }.
 * Se separa de la descarga para poder probarlo con Node.
 */
export async function generarExcel(cotizaciones, seleccionadas) {
  const { resumen, hojas } = construirHojas(cotizaciones, seleccionadas);
  if (resumen.count === 0) {
    throw new Error('No hay cotizaciones para exportar.');
  }
  const fileName = nombreArchivoExcel();
  const blob = await writeXlsxFile(
    hojas.map((h) => ({ data: h.filas, sheet: h.nombre, columns: h.columnas }))
  ).toBlob();
  return { blob, fileName, count: resumen.count, total: moneda(resumen.totalPrice) };
}

/**
 * Descarga el .xlsx con las cotizaciones indicadas (o todas).
 * Devuelve { fileName, count, total }.
 */
export async function descargarExcel(cotizaciones, seleccionadas) {
  const { blob, fileName, count, total } = await generarExcel(cotizaciones, seleccionadas);

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = fileName;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  return { fileName, count, total };
}
