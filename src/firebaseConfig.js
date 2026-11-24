// Configuración pública de Firebase.
// Los valores se leen de las variables de entorno de Render (VITE_*).
// Si no están llenas, la app usa almacenamiento local del navegador y
// funciona igual sin login ni Firebase.

const env = import.meta.env || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: env.VITE_FIREBASE_APP_ID || ''
};

// UID de la cuenta anónima del administrador. Se obtiene abriendo la app
// una vez y copiando el ID que aparece en "Información de sesión".
export const ADMIN_UID = (env.VITE_ADMIN_UID || '').trim();

const incompleta = [firebaseConfig.apiKey, firebaseConfig.projectId, firebaseConfig.appId]
  .some((v) => !v || /todo|pendiente|placeholder/i.test(v));

export const firebaseListo = !incompleta;
export const adminDefinido = Boolean(ADMIN_UID) && !/todo|pendiente/i.test(ADMIN_UID);
