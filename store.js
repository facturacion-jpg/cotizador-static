(function () {
  'use strict';

  const LS_QUOTES = 'cotizador_v3_quotes';
  const LS_PARAMS = 'cotizador_v3_params';
  const LS_CATALOG = 'cotizador_v3_catalog';
  const LS_REFS = 'cotizador_v3_refs';
  const REMOTE_KEY = 'shared_v1';

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
  let remote = { enabled: false, lastSyncAt: null, lastError: '' };

  function hasRemote() {
    const sb = window.CotizadorSupabase;
    return !!(sb && sb.isReady() && sb.dbGet && sb.dbSet);
  }

  function snapshot() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: 'cotizador-static',
      catalog: catalog,
      parameters: params ? { ...params } : null,
      references: refs || [],
      quotes: quotes || []
    };
  }

  function applySnapshot(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.catalog && typeof payload.catalog === 'object') { catalog = payload.catalog; write(LS_CATALOG, catalog); }
    if (Array.isArray(payload.references)) { refs = payload.references; write(LS_REFS, refs); }
    else if (payload.catalog && Array.isArray(payload.catalog.references)) { refs = payload.catalog.references; write(LS_REFS, refs); }
    if (payload.parameters && typeof payload.parameters === 'object') { params = { ...params, ...payload.parameters }; write(LS_PARAMS, params); }
    if (Array.isArray(payload.quotes)) { quotes = payload.quotes; write(LS_QUOTES, quotes); }
    return true;
  }

  async function pullRemote() {
    if (!hasRemote()) { remote.enabled = false; return { ok: false, reason: 'not-configured' }; }
    remote.enabled = true;
    try {
      const row = await window.CotizadorSupabase.dbGet(REMOTE_KEY);
      const value = row ? row.value : null;
      if (value && typeof value === 'object') {
        applySnapshot(value);
        remote.lastSyncAt = row.updated_at || new Date().toISOString();
        remote.lastError = '';
        return { ok: true, pulled: true };
      }
      remote.lastError = '';
      return { ok: true, pulled: false };
    } catch (err) {
      remote.lastError = err.message;
      console.warn('Supabase pull failed:', err);
      return { ok: false, reason: err.message };
    }
  }

  async function pushRemote() {
    if (!hasRemote()) { remote.enabled = false; return { ok: false, reason: 'not-configured' }; }
    remote.enabled = true;
    try {
      await window.CotizadorSupabase.dbSet(REMOTE_KEY, snapshot());
      remote.lastSyncAt = new Date().toISOString();
      remote.lastError = '';
      return { ok: true };
    } catch (err) {
      remote.lastError = err.message;
      console.warn('Supabase push failed:', err);
      return { ok: false, reason: err.message };
    }
  }

  function pushRemoteSoon() { pushRemote().catch(() => {}); }

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
    await pullRemote(); // si Supabase está configurado, usa estado compartido
    return bootstrap();
  }

  function bootstrap() {
    return {
      meta: catalog.meta || {},
      importInfo: { catalogBackup: false, storeBackup: false },
      warning: remote.lastError ? ('Sync nube: ' + remote.lastError) : null,
      version: '3.0-static',
      readOnly: false,
      adminTokenRequired: false,
      remote,
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
    pushRemoteSoon();
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
    pushRemoteSoon();
    return { ok: true };
  }

  function putParameters(p) {
    engine.validateParams(p);
    params = { ...p };
    write(LS_PARAMS, params);
    pushRemoteSoon();
    return currentParameters();
  }

  function putReference(code, marca) {
    const ref = refs.find((r) => String(r.code) === String(code));
    if (!ref) throw new Error('Referencia no encontrada');
    ref.marca = String(marca || '').trim();
    write(LS_REFS, refs);
    pushRemoteSoon();
    return { ok: true, marca: ref.marca };
  }

  function clearData(clearQuotes) {
    localStorage.removeItem(LS_CATALOG);
    localStorage.removeItem(LS_PARAMS);
    localStorage.removeItem(LS_REFS);
    if (clearQuotes) localStorage.removeItem(LS_QUOTES);
    pushRemoteSoon();
    return { ok: true };
  }

  function exportBackup() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: 'cotizador-static',
      catalog: catalog,
      parameters: { ...params },
      references: refs || [],
      quotes: quotes || []
    };
  }

  function validateBackup(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('El archivo no es un respaldo válido.');
    const q = Array.isArray(payload.quotes) ? payload.quotes : null;
    const p = payload.parameters && typeof payload.parameters === 'object' ? payload.parameters : null;
    const c = payload.catalog && typeof payload.catalog === 'object' ? payload.catalog : null;
    const r = Array.isArray(payload.references) ? payload.references : null;
    if (!q && !p && !c && !r) throw new Error('El respaldo no contiene datos reconocibles (quotes/parameters/catalog/references).');
    return {
      quotes: q ? q.length : quotes.length,
      operations: c && Array.isArray(c.operations) ? c.operations.length : (catalog?.operations?.length || 0),
      references: r ? r.length : (c && Array.isArray(c.references) ? c.references.length : (refs?.length || 0)),
      hasParameters: !!p,
      hasCatalog: !!c
    };
  }

  function importBackup(payload) {
    const info = validateBackup(payload);
    if (payload.catalog && typeof payload.catalog === 'object') {
      catalog = payload.catalog;
      write(LS_CATALOG, catalog);
    }
    if (Array.isArray(payload.references)) {
      refs = payload.references;
      write(LS_REFS, refs);
    } else if (payload.catalog && Array.isArray(payload.catalog.references)) {
      refs = payload.catalog.references;
      write(LS_REFS, refs);
    }
    if (payload.parameters && typeof payload.parameters === 'object') {
      params = { ...params, ...payload.parameters };
      write(LS_PARAMS, params);
    }
    if (Array.isArray(payload.quotes)) {
      quotes = payload.quotes;
      write(LS_QUOTES, quotes);
    }
    pushRemoteSoon();
    return { ok: true, ...info };
  }

  window.CotizadorStore = {
    init, bootstrap, currentParameters, calculate, saveQuote, getQuote, deleteQuote,
    putParameters, putReference, clearData, exportBackup, validateBackup, importBackup,
    pullRemote, pushRemote, getRemoteStatus: () => ({ ...remote, enabled: hasRemote() }),
    get quotes() { return quotes; },
    get catalog() { return catalog; },
    get refs() { return refs; },
    setCatalog(c) { catalog = c; write(LS_CATALOG, c); refs = c.references || refs; write(LS_REFS, refs); params = c.parameters || params; write(LS_PARAMS, params); pushRemoteSoon(); },
    setQuotes(q) { quotes = q; write(LS_QUOTES, quotes); pushRemoteSoon(); }
  };
})();
