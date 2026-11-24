// Configuración Supabase (pública, va en el frontend).
// 1) https://supabase.com -> crea proyecto free.
// 2) Storage -> crea bucket "cotizador_exports" (Private recomendado).
// 3) Aplica policies SQL del README (insert para anon, select para firmado).
// 4) Pega Project URL y anon key aquí.

window.COTIZADOR_SUPABASE_CONFIG = {
  url: 'TODO_PEGAR_AQUI', // ej: https://xxxx.supabase.co
  anonKey: 'TODO_PEGAR_AQUI',
  bucket: 'cotizador_exports',
  signedUrlSeconds: 604800 // 7 días
};
