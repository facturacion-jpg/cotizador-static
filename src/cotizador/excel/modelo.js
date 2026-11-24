// Cálculos puros para el historial y el Excel. No usa Firebase ni el DOM,
// así que se puede probar con Node.

export const redondear = (valor, decimales = 2) => {
  const n = Number(valor);
  return Number.isFinite(n) ? Number(n.toFixed(decimales)) : 0;
};

export const numero = (valor, decimales = 2) => {
  if (valor == null || valor === '') return '—';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es-CO', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  });
};

export const moneda = (valor) => (valor == null || valor === '' ? '—' : '$ ' + numero(valor, 2));

const porcentajeTexto = (valor) =>
  valor == null || valor === '' ? '—' : numero(Number(valor) * 100, 2) + '%';

export const fechaLocal = (valor) => {
  if (!valor) return '—';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO');
};

const parametrosTexto = (p) => {
  const params = p || {};
  return [
    'Suplemento ' + porcentajeTexto(params.supplementPct),
    'Valor minuto confeccion ' + moneda(params.costPerMinConf) + '/min',
    'Valor minuto terminacion ' + moneda(params.costPerMinFinish) + '/min',
    'Empaque ' + moneda(params.costPerMinPack) + '/min',
    'Complejidad ' + numero(params.complexityFactor, 2),
    'Utilidad ' + porcentajeTexto(params.profitPct),
    'Capacidad ' + numero(params.workDays, 0) + ' días × ' + numero(params.hoursPerDay, 1) + ' h',
    'Eficiencia ' + porcentajeTexto(params.efficiency)
  ].join(' | ');
};

const parametrosValores = (p) => {
  const params = p || {};
  return [
    params.supplementPct,
    params.costPerMinConf,
    params.costPerMinFinish,
    params.costPerMinPack,
    params.complexityFactor,
    params.profitPct,
    params.workDays,
    params.hoursPerDay,
    params.efficiency
  ];
};

/**
 * Construye el resumen que alimenta el Excel y la pantalla de historial.
 * `seleccionadas` puede ser un arreglo de ids; si se omite, usa todas.
 */
export function resumenDeCotizaciones(cotizaciones, seleccionadas) {
  const todas = Array.isArray(cotizaciones) ? cotizaciones : [];
  const filtro = Array.isArray(seleccionadas) ? new Set(seleccionadas.map(String)) : null;
  const lista = filtro ? todas.filter((q) => filtro.has(String(q.id))) : todas;

  const filasCotizaciones = [];
  const filasDetalle = [];
  const porTipo = new Map();
  const porMarca = new Map();
  let totalSam = 0;
  let totalCosto = 0;
  let totalPrecio = 0;
  let desde = null;
  let hasta = null;

  for (const q of lista) {
    const totales = (q.resultado && q.resultado.totals) || {};
    const lineas = (q.resultado && q.resultado.lines) || [];
    const sam = Number(totales.samTotal) || 0;
    const costo = Number(totales.costoTransformacion) || 0;
    const precio = Number(totales.precioSugerido) || 0;

    totalSam += sam;
    totalCosto += costo;
    totalPrecio += precio;

    if (q.createdAt && (!desde || q.createdAt < desde)) desde = q.createdAt;
    if (q.createdAt && (!hasta || q.createdAt > hasta)) hasta = q.createdAt;

    const tipo = String(q.tipo || 'Sin tipo');
    const grupoTipo = porTipo.get(tipo) || { count: 0, totalPrice: 0 };
    grupoTipo.count += 1;
    grupoTipo.totalPrice += precio;
    porTipo.set(tipo, grupoTipo);

    const marca = String(q.marca || '').trim() || 'Sin marca';
    const grupoMarca = porMarca.get(marca) || { count: 0, totalPrice: 0 };
    grupoMarca.count += 1;
    grupoMarca.totalPrice += precio;
    porMarca.set(marca, grupoMarca);

    filasCotizaciones.push([
      fechaLocal(q.createdAt),
      String(q.referencia || ''),
      String(q.descripcion || ''),
      tipo,
      lineas.length,
      redondear(totales.samConfeccion, 3),
      redondear(totales.samTerminacionEmpaque, 3),
      redondear(sam, 3),
      redondear(costo, 2),
      redondear(precio, 2),
      ...parametrosValores(q.parametros),
      parametrosTexto(q.parametros),
      marca
    ]);

    for (const linea of lineas) {
      filasDetalle.push([
        fechaLocal(q.createdAt),
        String(q.referencia || ''),
        String(linea.operation || ''),
        String(linea.block || ''),
        String(linea.id || ''),
        Number(linea.quantity) || 0,
        redondear(linea.baseSec, 2),
        redondear(linea.samMin, 3),
        redondear(linea.cost, 2),
        Array.isArray(linea.warnings) ? linea.warnings.join('; ') : '',
        marca
      ]);
    }
  }

  const ordenar = (mapa, clave) => Array.from(mapa.entries())
    .map(([nombre, grupo]) => ({ [clave]: nombre, count: grupo.count, totalPrice: redondear(grupo.totalPrice, 2) }))
    .sort((a, b) => b.totalPrice - a.totalPrice);

  return {
    count: lista.length,
    soloSeleccionadas: Array.isArray(seleccionadas),
    from: desde ? fechaLocal(desde).split(',')[0] : '—',
    to: hasta ? fechaLocal(hasta).split(',')[0] : '—',
    totalSam: redondear(totalSam, 3),
    totalCost: redondear(totalCosto, 2),
    totalPrice: redondear(totalPrecio, 2),
    avgPrice: lista.length ? redondear(totalPrecio / lista.length, 2) : 0,
    byType: ordenar(porTipo, 'type'),
    byBrand: ordenar(porMarca, 'brand'),
    filasCotizaciones,
    filasDetalle
  };
}

export const COLUMNAS_COTIZACIONES = [
  'Fecha', 'Referencia', 'Descripción', 'Tipo', 'Operaciones',
  'SAM conf.', 'SAM term.+emp.', 'SAM total', 'Costo', 'Precio sugerido',
  'Suplemento (%)', 'Valor minuto confeccion', 'Valor minuto terminacion',
  'Costo empaque ($/min)', 'Factor complejidad', 'Utilidad (%)',
  'Días hábiles/mes', 'Horas/jornada', 'Eficiencia (%)', 'Parámetros usados', 'Marca'
];

export const COLUMNAS_DETALLE = [
  'Fecha', 'Referencia', 'Operación', 'Bloque', 'ID', 'Cantidad',
  'Base (s)', 'SAM (min)', 'Costo', 'Alertas', 'Marca'
];

// Formatos de Excel alineados con COLUMNAS_COTIZACIONES.
export const FORMATOS_COTIZACIONES = [
  null, null, null, null, '#,##0', '0.000', '0.000', '0.000',
  '#,##0.00', '#,##0.00', '0.00%', '#,##0.00', '#,##0.00', '#,##0.00',
  '0.00', '0.00%', '#,##0', '0.0', '0.00%', null, null
];

export const FORMATOS_DETALLE = [
  null, null, null, null, null, '#,##0', '#,##0.00', '0.000', '#,##0.00', null, null
];
