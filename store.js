(function () {
  'use strict';

  const LS_QUOTES = 'cotizador_v3_quotes';
  const LS_PARAMS = 'cotizador_v3_params';
  const LS_CATALOG = 'cotizador_v3_catalog';
  const LS_REFS = 'cotizador_v3_refs';

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  const engine = window.CotizadorEngine;
  let catalog = null;
  let quotes = read(LS_QUOTES, []);
  let params = null;
  let refs = null;

  function uid() {
    return 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  async function init() {
    const base = await fetch('./catalog.json').then((r) => r.json());
    const storedCatalog = read(LS_CATALOG, null);
    const storedRefs = read(LS_REFS, null);
    catalog = storedCatalog && Array.isArray(storedCatalog.operations) ? storedCatalog : base;
    refs = storedRefs && Array.isArray(storedRefs) ? storedRefs : (catalog.references || base.references || []);
    params = read(LS_PARAMS, null) || catalog.parameters || base.parameters;
    quotes = read(LS_QUOTES, []);
    return bootstrap();
  }

  function bootstrap() {
    return {
      meta: catalog.meta || {},
      importInfo: { catalogBackup: false, storeBackup: false },
      warning: null,
      version: '3.0-static',
      readOnly: false,
      adminTokenRequired: false,
      parameters: { ...params },
      operations: catalog.operations || [],
      references: refs || [],
      quotes: quotes.map((q) => ({
        id: q.id,
        createdAt: q.createdAt,
        reference: q.reference,
        description: q.description,
        type: q.type,
        marca: q.marca || '',
        totalSam: q.result?.totals?.samTotal || 0,
        totalCost: q.result?.totals?.costoTransformacion || 0,
        suggestedPrice: q.result?.totals?.precioSugerido || 0,
        lines: q.lines ? q.lines.length : 0
      }))
    };
  }

  function currentParameters() { return { ...params }; }

  function calculate(lines, reference) {
    return engine.calculateQuote(lines || [], currentParameters(), catalog.operations, { reference: reference || null });
  }

  function saveQuote(payload) {
    const result = calculate(payload.lines || [], payload.reference);
    const quote = {
      id: uid(),
      createdAt: new Date().toISOString(),
      reference: String(payload.reference || '').trim(),
      description: String(payload.description || '').trim(),
      type: String(payload.type || '').trim(),
      marca: String(payload.marca || '').trim(),
      parameters: currentParameters(),
      lines: result.lines,
      result
    };
    quotes.unshift(quote);
    write(LS_QUOTES, quotes);
    return quote;
  }

  function getQuote(id) {
    const q = quotes.find((x) => x.id === id);
    if (!q) throw new Error('Cotización no encontrada');
    return q;
  }

  function deleteQuote(id) {
    const idx = quotes.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('Cotización no encontrada');
    quotes.splice(idx, 1);
    write(LS_QUOTES, quotes);
    return { ok: true };
  }

  function putParameters(p) {
    engine.validateParams(p);
    params = { ...p };
    write(LS_PARAMS, params);
    return currentParameters();
  }

  function putReference(code, marca) {
    const ref = refs.find((r) => String(r.code) === String(code));
    if (!ref) throw new Error('Referencia no encontrada');
    ref.marca = String(marca || '').trim();
    write(LS_REFS, refs);
    return { ok: true, marca: ref.marca };
  }

  function clearData(clearQuotes) {
    localStorage.removeItem(LS_CATALOG);
    localStorage.removeItem(LS_PARAMS);
    localStorage.removeItem(LS_REFS);
    if (clearQuotes) localStorage.removeItem(LS_QUOTES);
    return { ok: true };
  }

  window.CotizadorStore = {
    init, bootstrap, currentParameters, calculate, saveQuote, getQuote, deleteQuote,
    putParameters, putReference, clearData,
    get quotes() { return quotes; },
    get catalog() { return catalog; },
    get refs() { return refs; },
    setCatalog(c) { catalog = c; write(LS_CATALOG, c); refs = c.references || refs; write(LS_REFS, refs); params = c.parameters || params; write(LS_PARAMS, params); },
    setQuotes(q) { quotes = q; write(LS_QUOTES, quotes); }
  };
})();
