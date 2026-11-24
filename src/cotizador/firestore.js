// Acceso a Firestore. No crea la app de Firebase: recibe la instancia que
// ya inicializó la aplicación principal (evita inicializaciones dobles).
import {
  collection, doc, getDoc, getDocs, query, orderBy, limit,
  addDoc, setDoc, deleteDoc, writeBatch
} from 'firebase/firestore';
import { COLECCIONES, DOC_PARAMETROS } from './config.js';

const TAMANO_LOTE = 200;

let _db = null;

/** Debe llamarse una vez, con la instancia de Firestore de la app. */
export function configurarFirestore(db) {
  _db = db;
}

function db() {
  if (!_db) {
    throw new Error('Cotizador: llame a configurarFirestore(db) antes de usarlo.');
  }
  return _db;
}

const nombreLote = (prefijo, indice) => prefijo + '_' + String(indice).padStart(3, '0');

function partir(items, tamano) {
  const partes = [];
  for (let i = 0; i < items.length; i += tamano) partes.push(items.slice(i, i + tamano));
  return partes;
}

// ---------------- Cotizaciones ----------------

export async function listarCotizaciones(maximo = 500) {
  const snap = await getDocs(query(
    collection(db(), COLECCIONES.cotizaciones),
    orderBy('createdAt', 'desc'),
    limit(maximo)
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Firestore rechaza los valores `undefined`; el motor devuelve objetos con
// campos opcionales, así que se limpian antes de escribir.
const limpio = (objeto) => JSON.parse(JSON.stringify(objeto ?? null));

export async function guardarCotizacion(cotizacion, idOpcional) {
  const datos = limpio(cotizacion);
  if (idOpcional) {
    await setDoc(doc(db(), COLECCIONES.cotizaciones, String(idOpcional)), datos);
    return String(idOpcional);
  }
  const ref = await addDoc(collection(db(), COLECCIONES.cotizaciones), datos);
  return ref.id;
}

export async function eliminarCotizacion(id) {
  await deleteDoc(doc(db(), COLECCIONES.cotizaciones, String(id)));
}

// ---------------- Parámetros ----------------

export async function cargarParametros() {
  const snap = await getDoc(doc(db(), COLECCIONES.config, DOC_PARAMETROS));
  return snap.exists() ? snap.data() : null;
}

export async function guardarParametros(parametros) {
  await setDoc(doc(db(), COLECCIONES.config, DOC_PARAMETROS), limpio(parametros));
}

// ---------------- Catálogo ----------------

/**
 * Devuelve el catálogo guardado en Firestore o null si nunca se importó.
 * Los documentos se parten en lotes para no superar el límite de 1 MB.
 */
export async function cargarCatalogo() {
  const metaSnap = await getDoc(doc(db(), COLECCIONES.catalogo, 'meta'));
  if (!metaSnap.exists()) return null;
  const meta = metaSnap.data();

  const opsLotes = await Promise.all(
    Array.from({ length: Number(meta.opsLotes) || 0 }, (_, i) =>
      getDoc(doc(db(), COLECCIONES.catalogo, nombreLote('ops', i))))
  );
  const refsLotes = await Promise.all(
    Array.from({ length: Number(meta.refsLotes) || 0 }, (_, i) =>
      getDoc(doc(db(), COLECCIONES.catalogo, nombreLote('refs', i))))
  );

  const operations = opsLotes.flatMap((s) => (s.exists() ? s.data().items || [] : []));
  const references = refsLotes.flatMap((s) => (s.exists() ? s.data().items || [] : []));
  if (!operations.length || !references.length) return null;

  return {
    meta: meta.meta || {},
    parameters: meta.parameters || {},
    goldenCase: meta.goldenCase || null,
    operations,
    references
  };
}

/**
 * Guarda el catálogo completo y actualiza los parámetros.
 * Solo el administrador puede hacerlo (lo refuerzan las reglas).
 * Se escribe en varios lotes porque Firestore limita a 500 operaciones
 * por lote; el documento `meta` se escribe al final para que una lectura
 * simultánea no vea un catálogo incompleto.
 */
export async function guardarCatalogo(catalogo) {
  const operations = Array.isArray(catalogo.operations) ? catalogo.operations : [];
  const references = Array.isArray(catalogo.references) ? catalogo.references : [];
  if (!operations.length || !references.length) {
    throw new Error('El catálogo está vacío: no se guardó nada.');
  }

  const previo = await getDoc(doc(db(), COLECCIONES.catalogo, 'meta'))
    .then((s) => (s.exists() ? s.data() : {}))
    .catch(() => ({}));

  const ops = partir(operations, TAMANO_LOTE);
  const refs = partir(references, TAMANO_LOTE);

  const escrituras = [];
  ops.forEach((items, i) => {
    escrituras.push([doc(db(), COLECCIONES.catalogo, nombreLote('ops', i)), { items }]);
  });
  refs.forEach((items, i) => {
    escrituras.push([doc(db(), COLECCIONES.catalogo, nombreLote('refs', i)), { items }]);
  });

  // Borra lotes sobrantes de una importación anterior.
  for (let i = ops.length; i < (Number(previo.opsLotes) || 0); i++) {
    escrituras.push([doc(db(), COLECCIONES.catalogo, nombreLote('ops', i)), null]);
  }
  for (let i = refs.length; i < (Number(previo.refsLotes) || 0); i++) {
    escrituras.push([doc(db(), COLECCIONES.catalogo, nombreLote('refs', i)), null]);
  }

  for (const grupo of partir(escrituras, 450)) {
    const batch = writeBatch(db());
    grupo.forEach(([ref, datos]) => (datos === null ? batch.delete(ref) : batch.set(ref, datos)));
    await batch.commit();
  }

  await setDoc(doc(db(), COLECCIONES.catalogo, 'meta'), {
    meta: catalogo.meta || {},
    parameters: catalogo.parameters || {},
    goldenCase: catalogo.goldenCase || null,
    opsLotes: ops.length,
    refsLotes: refs.length,
    operations: operations.length,
    references: references.length,
    updatedAt: new Date().toISOString()
  });

  // El Excel no trae el costo de empaque (es opcional y manual):
  // se conserva el que ya estuviera configurado.
  const parametrosPrevios = await cargarParametros().catch(() => null);
  await guardarParametros({ ...(parametrosPrevios || {}), ...(catalogo.parameters || {}) });
  return { operations: operations.length, references: references.length };
}

// ---------------- Marcas de referencias ----------------

/**
 * Las marcas se guardan aparte del catálogo (un solo documento pequeño).
 * Así editarlas no reescribe las 568 operaciones y 193 referencias.
 */
export async function cargarMarcas() {
  const snap = await getDoc(doc(db(), COLECCIONES.config, 'marcas'));
  return snap.exists() ? (snap.data().valores || {}) : {};
}

export async function guardarMarca(codigo, marca) {
  const ref = doc(db(), COLECCIONES.config, 'marcas');
  const snap = await getDoc(ref);
  const valores = snap.exists() ? { ...(snap.data().valores || {}) } : {};
  if (String(marca || '').trim()) valores[codigo] = String(marca).trim();
  else delete valores[codigo];
  await setDoc(ref, { valores, updatedAt: new Date().toISOString() });
}

