// Lee el Excel del cotizador (.xlsx o .xlsm) en el navegador y devuelve el
// catálogo con operaciones, referencias, parámetros y caso de control.
// Replica la lectura que antes hacía tools/export_excel.ps1 con Excel COM.
import * as XLSX from 'xlsx';

const HOJAS = {
  parametros: 'Parametros',
  operaciones: 'Base_operaciones',
  referencias: 'BD Referencias',
  historico: 'Historico',
  cotizador: 'Cotizador'
};

const LABELS_PARAMETROS = [
  'supplementPct', 'costPerMinConf', 'costPerMinFinish', 'profitPct',
  'complexityFactor', 'workDays', 'hoursPerDay', 'efficiency'
];

function numero(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  let t = String(valor).trim().replace(/[\s\u00a0]/g, '');
  if (!t) return null;

  // Excel en español guarda 1.234,56; en inglés 1,234.56.
  // Se resuelve según cuál separador aparece de último.
  const tieneComa = t.includes(',');
  const tienePunto = t.includes('.');
  if (tieneComa && tienePunto) {
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(/,/g, '.');
    else t = t.replace(/,/g, '');
  } else if (tieneComa) {
    t = t.replace(/\./g, '').replace(/,/g, '.');
  } else if (tienePunto && /^[+-]?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');
  }

  const limpio = t.replace(/[^0-9+\-.]/g, '');
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

function texto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

function porcentaje(valor) {
  if (valor === null || valor === undefined) return null;
  const t = String(valor).trim();
  if (!t) return null;
  const conSigno = t.endsWith('%');
  const base = conSigno ? t.slice(0, -1) : t;
  const n = numero(base);
  if (n === null) return null;
  return conSigno ? n / 100 : n;
}

function buscarHoja(libro, nombre) {
  const buscado = nombre.toLowerCase();
  const real = libro.SheetNames.find((n) => String(n).trim().toLowerCase() === buscado);
  if (!real) {
    throw new Error('El archivo no contiene la hoja "' + nombre + '".');
  }
  return libro.Sheets[real];
}

function tabla(libro, nombre, desdeFila = 0) {
  const hoja = buscarHoja(libro, nombre);
  return XLSX.utils.sheet_to_json(hoja, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range: desdeFila
  });
}

// Valor de una celda por dirección (fila y columna empiezan en 1).
// No depende de dónde empiece el rango usado de la hoja.
function valorCelda(hoja, fila, columna) {
  const celdaDireccion = hoja[XLSX.utils.encode_cell({ r: fila - 1, c: columna - 1 })];
  return celdaDireccion ? celdaDireccion.v : null;
}

const celda = (filas, fila, columna) => {
  const f = filas[fila];
  return f ? f[columna] : null;
};

/** Devuelve el catálogo a partir del contenido del archivo. */
export function parsearLibro(contenido, nombreArchivo = 'importado.xlsx') {
  const libro = XLSX.read(contenido, { type: 'array', cellDates: false });

  // ---------- Parámetros ----------
  const hojaParametros = buscarHoja(libro, HOJAS.parametros);
  const parameters = {};
  LABELS_PARAMETROS.forEach((label, i) => {
    const valor = numero(valorCelda(hojaParametros, i + 2, 2));
    if (valor !== null) parameters[label] = valor;
  });
  if (!Object.keys(parameters).length) {
    throw new Error('No se encontraron parámetros en la hoja "Parametros".');
  }

  // ---------- Operaciones (desde la fila 7) ----------
  const filasOperaciones = tabla(libro, HOJAS.operaciones, 6);
  const operations = [];
  for (const fila of filasOperaciones) {
    if (!fila) continue;
    const nombre = texto(fila[2]);
    if (!nombre) continue;
    operations.push({
      id: texto(fila[0]),
      block: texto(fila[1]),
      name: nombre,
      family: texto(fila[3]),
      component: texto(fila[4]),
      machine: texto(fila[5]),
      classification: texto(fila[6]),
      referenceCount: numero(fila[7]),
      observationCount: numero(fila[8]),
      minSec: numero(fila[9]),
      p25Sec: numero(fila[10]),
      medianSec: numero(fila[11]),
      p75Sec: numero(fila[12]),
      maxSec: numero(fila[13]),
      cv: numero(fila[14]),
      reliability: texto(fila[15]),
      validationPriority: numero(fila[16]),
      validatedSec: numero(fila[17]),
      baseSec: numero(fila[18]),
      normalMin: numero(fila[19]),
      samBaseMin: numero(fila[20]),
      historicalSupplement: numero(fila[21]),
      nameVariants: numero(fila[22]),
      exampleOriginalName: texto(fila[23])
    });
  }

  // ---------- Referencias (desde la fila 2) ----------
  const hojaReferencias = buscarHoja(libro, HOJAS.referencias);
  const rango = XLSX.utils.decode_range(hojaReferencias['!ref'] || 'A1:J1');
  const tieneMarca = rango.e.c >= 10; // columna K (índice 10) o superior
  const filasReferencias = tabla(libro, HOJAS.referencias, 1);
  const references = [];
  filasReferencias.forEach((fila, indice) => {
    if (!fila) return;
    const code = texto(fila[0]);
    if (!code) return;
    references.push({
      code,
      description: texto(fila[1]),
      type: texto(fila[2]),
      confectionMin: numero(fila[3]),
      finishingMin: numero(fila[4]),
      packingMin: numero(fila[5]),
      samTotalMin: numero(fila[6]),
      supplementPct: porcentaje(fila[7]),
      observation: texto(fila[8]),
      profitPct: porcentaje(fila[9]),
      marca: tieneMarca ? texto(valorCelda(hojaReferencias, indice + 2, 11)) : ''
    });
  });

  if (!operations.length) {
    throw new Error('No se encontraron operaciones en "Base_operaciones". Revise que el archivo sea el cotizador correcto.');
  }
  if (!references.length) {
    throw new Error('No se encontraron referencias en "BD Referencias".');
  }

  // ---------- Historico (solo conteos de calidad) ----------
  let historicalRows = 0;
  let historicalBlankCodes = 0;
  let historicalBlankSupplement = 0;
  const historicalBlocks = {};
  try {
    const filasHistorico = tabla(libro, HOJAS.historico, 1);
    historicalRows = filasHistorico.length;
    for (const fila of filasHistorico) {
      if (!fila) continue;
      if (!texto(fila[1])) historicalBlankCodes++;
      if (!texto(fila[12])) historicalBlankSupplement++;
      const bloque = texto(fila[4]);
      historicalBlocks[bloque] = (historicalBlocks[bloque] || 0) + 1;
    }
  } catch (_) {
    // El histórico es informativo: si falta la hoja no se bloquea la importación.
  }

  // ---------- Caso de control (hoja Cotizador) ----------
  let goldenCase = null;
  try {
    const hojaCotizador = buscarHoja(libro, HOJAS.cotizador);
    goldenCase = {
      operation: texto(valorCelda(hojaCotizador, 8, 1)),
      quantity: numero(valorCelda(hojaCotizador, 8, 2)) || 1,
      adjustedSec: numero(valorCelda(hojaCotizador, 8, 3)),
      baseSec: numero(valorCelda(hojaCotizador, 8, 4)),
      normalMin: numero(valorCelda(hojaCotizador, 8, 5)),
      samMin: numero(valorCelda(hojaCotizador, 8, 6)),
      cost: numero(valorCelda(hojaCotizador, 8, 9)),
      suggestedPrice: numero(valorCelda(hojaCotizador, 53, 2))
    };
    if (!goldenCase.operation) goldenCase = null;
  } catch (_) {
    goldenCase = null;
  }

  return {
    meta: {
      sourceFile: nombreArchivo,
      exportedAt: new Date().toISOString(),
      operationCount: operations.length,
      referenceCount: references.length,
      historicalRows,
      historicalBlankCodes,
      historicalBlankSupplement,
      historicalBlocks
    },
    parameters,
    operations,
    references,
    goldenCase
  };
}

/** Lee un File del navegador. */
export async function parsearArchivo(file) {
  if (!file) throw new Error('Seleccione un archivo.');
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
    throw new Error('El archivo debe ser .xlsx o .xlsm.');
  }
  const buffer = await file.arrayBuffer();
  return parsearLibro(new Uint8Array(buffer), file.name);
}
