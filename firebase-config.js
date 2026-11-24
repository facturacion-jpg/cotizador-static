// Configuración de Firebase (pública, va en el frontend).
// 1) Firebase Console > Project settings > Your apps > Web app > copia firebaseConfig.
// 2) Reemplaza los TODO_PEGAR_AQUI.
// 3) No compartas claves privadas de servicio; esto es config web pública.
// La seguridad real va en Firebase Rules y dominios autorizados.

window.COTIZADOR_FIREBASE_CONFIG = {
  apiKey: 'TODO_PEGAR_AQUI',
  authDomain: 'TODO_PEGAR_AQUI.firebaseapp.com',
  projectId: 'TODO_PEGAR_AQUI',
  storageBucket: 'TODO_PEGAR_AQUI.firebasestorage.app',
  messagingSenderId: 'TODO_PEGAR_AQUI',
  appId: 'TODO_PEGAR_AQUI'
};

// Carpeta en Storage donde se suben los Excel para el enlace del correo.
window.COTIZADOR_STORAGE_FOLDER = 'cotizador_exports';
