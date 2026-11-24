(function () {
  'use strict';

  const cfg = window.COTIZADOR_FIREBASE_CONFIG || {};
  const PLACEHOLDER = /TODO_PEGAR_AQUI|PENDIENTE/i;
  const ready = cfg.apiKey && cfg.projectId && cfg.appId && !PLACEHOLDER.test(String(cfg.apiKey));

  let app = null;
  let auth = null;
  let storage = null;
  let initPromise = null;

  function isReady() { return ready; }

  async function ensure() {
    if (!ready) return null;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const [{ initializeApp, getApps }, { getAuth, signInAnonymously }, { getStorage }] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js')
      ]);
      app = getApps().length ? getApps()[0] : initializeApp(cfg);
      auth = getAuth(app);
      storage = getStorage(app);
      if (!auth.currentUser) await signInAnonymously(auth);
      return { app, auth, storage };
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
    return initPromise;
  }

  async function uploadExcel(blob, fileName) {
    const ctx = await ensure();
    if (!ctx) return null;
    const { ref, uploadBytes, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js');
    const folder = String(window.COTIZADOR_STORAGE_FOLDER || 'cotizador_exports').replace(/[^a-zA-Z0-9_-]/g, '');
    const safeName = String(fileName || ('historial_' + Date.now() + '.xlsx')).replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = folder + '/' + Date.now() + '_' + safeName;
    const objectRef = ref(ctx.storage, path);
    await uploadBytes(objectRef, blob, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = await getDownloadURL(objectRef);
    return { url, path };
  }

  window.CotizadorFirebase = { isReady, ensure, uploadExcel };
})();
