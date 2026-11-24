(function () {
  'use strict';

  const cfg = window.COTIZADOR_SUPABASE_CONFIG || {};
  const PLACEHOLDER = /TODO_PEGAR_AQUI|PENDIENTE/i;
  const ready = cfg.url && cfg.anonKey && !PLACEHOLDER.test(String(cfg.url)) && !PLACEHOLDER.test(String(cfg.anonKey));

  function isReady() { return ready; }

  async function uploadExcel(blob, fileName) {
    if (!ready) return null;
    const base = String(cfg.url).replace(/\/+$/, '');
    const bucket = encodeURIComponent(String(cfg.bucket || 'cotizador_exports'));
    const safeName = String(fileName || ('historial_' + Date.now() + '.xlsx')).replace(/[^a-zA-Z0-9._-]/g, '_');
    const uid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    const path = uid + '/' + safeName;
    const objectPath = path.split('/').map(encodeURIComponent).join('/');

    const uploadRes = await fetch(`${base}/storage/v1/object/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': 'Bearer ' + cfg.anonKey,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'x-upsert': 'false'
      },
      body: blob
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => '');
      throw new Error('Supabase upload ' + uploadRes.status + ': ' + text.slice(0, 200));
    }

    const expiresIn = Number(cfg.signedUrlSeconds) > 0 ? Number(cfg.signedUrlSeconds) : 604800;
    const signRes = await fetch(`${base}/storage/v1/object/sign/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': 'Bearer ' + cfg.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expiresIn })
    });
    if (!signRes.ok) {
      const text = await signRes.text().catch(() => '');
      throw new Error('Supabase sign ' + signRes.status + ': ' + text.slice(0, 200));
    }
    const data = await signRes.json();
    const signed = data.signedURL || data.signedUrl || data.url;
    if (!signed) throw new Error('Supabase no devolvió URL firmada.');
    const url = signed.startsWith('http') ? signed : (base + '/storage/v1' + (signed.startsWith('/') ? signed : '/' + signed));
    return { url, path };
  }

  window.CotizadorSupabase = { isReady, uploadExcel };
})();
