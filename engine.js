/* Motor de cálculo SAM / SMV y costos de transformación.
 * Se usa igual en el servidor (Node) y en el navegador (window.CotizadorEngine).
 * Toda la lógica es pura: recibe datos y parámetros, devuelve resultados.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CotizadorEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function norm(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function isBlock(value, target) {
    return norm(value) === norm(target);
  }

  function rateForBlock(block, params) {
    if (isBlock(block, 'Confección')) return Number(params.costPerMinConf);
    if (isBlock(block, 'Terminación')) return Number(params.costPerMinFinish);
    if (isBlock(block, 'Empaque')) {
      const pack = Number(params.costPerMinPack);
      return Number.isFinite(pack) && pack > 0 ? pack : Number(params.costPerMinFinish);
    }
    return Number(params.costPerMinConf);
  }

  function validateParams(params) {
    const checks = [
      ['suplemento', params.supplementPct, 0, 1],
      ['utilidad objetivo', params.profitPct, 0, 0.99],
      ['factor de complejidad', params.complexityFactor, 1, 3],
      ['valor minuto confeccion', params.costPerMinConf, 0.0001, Infinity],
      ['valor minuto terminacion', params.costPerMinFinish, 0.0001, Infinity],
      ['dias habiles por mes', params.workDays, 1, 31],
      ['horas por jornada', params.hoursPerDay, 0.5, 24],
      ['eficiencia', params.efficiency, 0.05, 1]
    ];
    for (const [label, value, min, max] of checks) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < min || n > max) {
        throw new Error(`Parámetro inválido: ${label} (${value})`);
      }
    }
    // El costo de empaque es opcional: vacío o null significa "sin costo".
    const pack = params.costPerMinPack;
    if (pack !== null && pack !== undefined && pack !== '') {
      const n = Number(pack);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`Parámetro inválido: costo empaque (${pack})`);
      }
    }
    return true;
  }

  function findOperation(name, operations) {
    const key = norm(name);
    if (!key) return null;
    return operations.find((op) => norm(op.name) === key) || null;
  }

  function resolveBaseSeconds(op, line) {
    // El campo "Tiempo ajustado" tiene prioridad sobre el tiempo base del catálogo.
    if (line.adjustedSec !== '' && line.adjustedSec !== null && line.adjustedSec !== undefined) {
      const adjusted = Number(line.adjustedSec);
      if (!Number.isFinite(adjusted) || adjusted <= 0) {
        throw new Error(`El tiempo ajustado de "${op.name}" debe ser mayor que 0`);
      }
      return { seconds: adjusted, source: 'ajustado' };
    }
    const candidates = [op.validatedSec, op.baseSec, op.medianSec, op.p75Sec];
    for (const candidate of candidates) {
      const n = Number(candidate);
      if (Number.isFinite(n) && n > 0) return { seconds: n, source: candidate === op.validatedSec ? 'validado' : 'base histórica' };
    }
    throw new Error(`La operación "${op.name}" no tiene tiempo base válido`);
  }

  function calculateLine(line, params, operations) {
    const rawName = String(line.operation || '').trim();
    if (!rawName) return null;

    const op = findOperation(rawName, operations);
    if (!op) {
      throw new Error(`Operación no encontrada en el catálogo: "${rawName}"`);
    }

    let quantity = line.quantity === '' || line.quantity === null || line.quantity === undefined
      ? 1
      : Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`La cantidad de "${op.name}" debe ser mayor que 0`);
    }

    const resolved = resolveBaseSeconds(op, line);
    const normalMin = resolved.seconds * quantity / 60;
    const samMin = normalMin * (1 + Number(params.supplementPct)) * Number(params.complexityFactor);
    const rate = rateForBlock(op.block, params);
    const cost = samMin * rate;

    const warnings = [];
    if (norm(op.reliability) === 'baja') warnings.push('Confiabilidad baja: requiere medición');
    if (Number(op.cv) > 0.5) warnings.push('Dispersión alta (CV > 0,5)');
    if (!(Number(op.validatedSec) > 0)) warnings.push('Tiempo sin validar (usa mediana histórica)');
    if (op.historicalSupplement != null &&
        Math.abs(Number(op.historicalSupplement) - Number(params.supplementPct)) > 0.01) {
      warnings.push('Suplemento histórico distinto del actual');
    }

    return {
      operation: op.name,
      id: op.id || '',
      block: op.block || '',
      family: op.family || '',
      component: op.component || '',
      machine: op.machine || '',
      reliability: op.reliability || '',
      cv: Number(op.cv) || 0,
      referenceCount: Number(op.referenceCount) || 0,
      quantity,
      adjustedSec: line.adjustedSec === '' || line.adjustedSec == null ? null : Number(line.adjustedSec),
      baseSec: resolved.seconds,
      timeSource: resolved.source,
      normalMin,
      samMin,
      rate,
      cost,
      warnings
    };
  }

  function calculateQuote(lines, params, operations, options) {
    validateParams(params);
    const opts = options || {};
    const calculated = [];
    for (const line of Array.isArray(lines) ? lines : []) {
      const result = calculateLine(line, params, operations);
      if (result) calculated.push(result);
    }

    const sumByBlock = (target) => calculated
      .filter((l) => isBlock(l.block, target))
      .reduce((acc, l) => acc + l.samMin, 0);

    const samConfeccion = sumByBlock('Confección');
    const samTerminacion = sumByBlock('Terminación');
    const samEmpaque = sumByBlock('Empaque');
    const samTotal = calculated.reduce((acc, l) => acc + l.samMin, 0);
    const costoTransformacion = calculated.reduce((acc, l) => acc + l.cost, 0);
    const precioSugerido = costoTransformacion / (1 - Number(params.profitPct));
    const minutosProductivosMes = Number(params.workDays) * Number(params.hoursPerDay) * 60 * Number(params.efficiency);

    return {
      lines: calculated,
      totals: {
        operaciones: calculated.length,
        samConfeccion,
        samTerminacion,
        samEmpaque,
        samTerminacionEmpaque: samTerminacion + samEmpaque,
        samTotal,
        costoTransformacion,
        precioSugerido,
        suplemento: Number(params.supplementPct),
        utilidad: Number(params.profitPct),
        complejidad: Number(params.complexityFactor),
        minutosProductivosMes: Number.isFinite(minutosProductivosMes) ? minutosProductivosMes : null
      },
      reference: opts.reference || null
    };
  }

  function compareWithExcel(catalog, params) {
    const golden = catalog.goldenCase;
    if (!golden || !golden.operation) return null;
    const result = calculateQuote([{
      operation: golden.operation,
      quantity: golden.quantity || 1,
      adjustedSec: golden.adjustedSec
    }], params || catalog.parameters, catalog.operations);
    const line = result.lines[0];
    return {
      operation: golden.operation,
      expected: {
        baseSec: golden.baseSec,
        normalMin: golden.normalMin,
        samMin: golden.samMin,
        cost: golden.cost,
        suggestedPrice: golden.suggestedPrice
      },
      actual: {
        baseSec: line.baseSec,
        normalMin: line.normalMin,
        samMin: line.samMin,
        cost: line.cost,
        suggestedPrice: result.totals.precioSugerido
      },
      passed: ['baseSec', 'normalMin', 'samMin', 'cost', 'suggestedPrice'].every((key) =>
        Math.abs(Number(golden[key]) - Number(
          key === 'suggestedPrice' ? result.totals.precioSugerido : line[key]
        )) < 0.0001)
    };
  }

  return {
    norm,
    isBlock,
    rateForBlock,
    validateParams,
    findOperation,
    calculateLine,
    calculateQuote,
    compareWithExcel
  };
});
