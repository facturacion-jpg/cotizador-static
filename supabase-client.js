(function () {
  'use strict';

  const cfg = window.COTIZADOR_SUPABASE_CONFIG || {};
  const PLACEHOLDER = /TODO_PEGAR_AQUI|PENDIENTE/i;
  const ready = cfg.url && cfg.anonKey && !PLACEHOLDER.test(String(cfg.url)) && !PLACEHOLDER.test(String(cfg.anonKey));

  function isReady() { return ready; }
  function baseUrl() { return String(cfg.url || '').replace(/\/+$/, ''); }
  function headers(extra) {
    return Object.assign({
      'apikey': cfg.anonKey,
      'Authorization': 'Bearer ' + cfg.anonKey
    }, extra || {});
  }

  async function sbFetch(path, options) {
    const res = await fetch(baseUrl() + path, options);
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    if (!res.ok) {
      const msg = (data && (data.message || data.error_description || data.error)) || text || res.status;
      throw new Error('Supabase ' + res.status + ': ' + String(msg).slice(0, 220));
    }
    return data;
  }

  async function uploadExcel(blob, fileName) {
    if (!ready) return null;
    const bucket = encodeURIComponent(String(cfg.bucket || 'cotizador_exports'));
    const safeName = String(fileName || ('historial_' + Date.now() + '.xlsx')).replace(/[^a-zA-Z0-9._-]/g, '_');
    const uid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    const path = uid + '/' + safeName;
    const objectPath = path.split('/').map(encodeURIComponent).join('/');

    await sbFetch(`/storage/v1/object/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x-upsert': 'false' }),
      body: blob
    });

    const expiresIn = Number(cfg.signedUrlSeconds) > 0 ? Number(cfg.signedUrlSeconds) : 604800;
    const data = await sbFetch(`/storage/v1/object/sign/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn })
    });
    const signed = data && (data.signedURL || data.signedUrl || data.url);
    if (!signed) throw new Error('Supabase no devolvió URL firmada.');
    const url = signed.startsWith('http') ? signed : (baseUrl() + '/storage/v1' + (signed.startsWith('/') ? signed : '/' + signed));
    return { url, path };
  }

  // --- DB compartida (historial en cualquier dispositivo) ---
  // Requiere tabla: cotizador_state(key text primary key, value jsonb, updated_at timestamptz default now())
  async function dbGet(key) {
    if (!ready) return null;
    const k = encodeURIComponent(String(key));
    const rows = await sbFetch(`/rest/v1/cotizador_state?select=key,value,updated_at&key=eq.${k}&limit=1`, {
      headers: headers({ 'Accept': 'application/json' })
    });
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  async function dbSet(key, value) {
    if (!ready) return null;
    return sbFetch('/rest/v1/cotizador_state?on_conflict=key', {
      method: 'POST',
      headers: headers({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      }),
      body: JSON.stringify([{ key: String(key), value: value, updated_at: new Date().toISOString() }])
    });
  }

  window.CotizadorSupabase = { isReady, uploadExcel, dbGet, dbSet };
})();
