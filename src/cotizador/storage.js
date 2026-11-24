// Capa de almacenamiento con dos modos:
//  - Firestore: cuando la app principal llama a configurarFirestore(db).
//  - Local: cuando no hay Firebase configurado (Static Site sin login).
// El resto del módulo solo usa esta interfaz, así que no necesita saber
// dónde están los datos.

import * as firestore from './firestore.js';

const CLAVES = {
  cotizaciones: 'cotizador_local_cotizaciones',
  parametros: 'cotizador_local_parametros',
  catalogo: 'cotizador_local_catalogo',
  marcas: 'cotizador_local_marcas'
};

let usandoFirestore = false;

export function configurarFirestore(db) {
  firestore.configurarFirestore(db);
  usandoFirestore = true;
}

export function configurarLocal() {
  usandoFirestore = false;
}

export function modoAlmacenamiento() {
  return usandoFirestore ? 'firestore' : 'local';
}

function almacen() {
  if (typeof localStorage === 'undefined') {
    throw new Error('El modo local necesita un navegador con localStorage.');
  }
  return localStorage;
}

function leer(clave, defecto) {
  try {
    const texto = almacen().getItem(clave);
    return texto == null ? defecto : JSON.parse(texto);
  } catch (_) {
    return defecto;
  }
}

function escribir(clave, valor) {
  almacen().setItem(clave, JSON.stringify(valor));
}

// ---------------- Implementación local ----------------

const idLocal = () => 'local_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

async function localListarCotizaciones(maximo = 500) {
  const todas = leer(CLAVES.cotizaciones, []);
  return todas
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, maximo);
}

async function localGuardarCotizacion(cotizacion, idOpcional) {
  const todas = leer(CLAVES.cotizaciones, []);
  const id = idOpcional ? String(idOpcional) : idLocal();
  const indice = todas.findIndex((q) => String(q.id) === id);
  const registro = { ...cotizacion, id };
  if (indice >= 0) todas[indice] = registro;
  else todas.push(registro);
  escribir(CLAVES.cotizaciones, todas);
  return id;
}

async function localEliminarCotizacion(id) {
  const todas = leer(CLAVES.cotizaciones, []);
  escribir(CLAVES.cotizaciones, todas.filter((q) => String(q.id) !== String(id)));
}

async function localCargarParametros() {
  return leer(CLAVES.parametros, null);
}

async function localGuardarParametros(parametros) {
  escribir(CLAVES.parametros, parametros);
}

async function localCargarCatalogo() {
  return leer(CLAVES.catalogo, null);
}

async function localGuardarCatalogo(catalogo) {
  const operations = catalogo.operations || [];
  const references = catalogo.references || [];
  if (!operations.length || !references.length) {
    throw new Error('El catálogo está vacío: no se guardó nada.');
  }
  escribir(CLAVES.catalogo, catalogo);
  // El Excel no trae el costo de empaque: se conserva el que ya había.
  const previos = leer(CLAVES.parametros, {}) || {};
  await localGuardarParametros({ ...previos, ...(catalogo.parameters || {}) });
  return { operations: operations.length, references: references.length };
}

async function localCargarMarcas() {
  return leer(CLAVES.marcas, {});
}

async function localGuardarMarca(codigo, marca) {
  const valores = leer(CLAVES.marcas, {});
  if (String(marca || '').trim()) valores[codigo] = String(marca).trim();
  else delete valores[codigo];
  escribir(CLAVES.marcas, valores);
}

// ---------------- API pública (decide según el modo) ----------------

export const listarCotizaciones = (...args) =>
  usandoFirestore ? firestore.listarCotizaciones(...args) : localListarCotizaciones(...args);

export const guardarCotizacion = (...args) =>
  usandoFirestore ? firestore.guardarCotizacion(...args) : localGuardarCotizacion(...args);

export const eliminarCotizacion = (...args) =>
  usandoFirestore ? firestore.eliminarCotizacion(...args) : localEliminarCotizacion(...args);

export const cargarParametros = (...args) =>
  usandoFirestore ? firestore.cargarParametros(...args) : localCargarParametros(...args);

export const guardarParametros = (...args) =>
  usandoFirestore ? firestore.guardarParametros(...args) : localGuardarParametros(...args);

export const cargarCatalogo = (...args) =>
  usandoFirestore ? firestore.cargarCatalogo(...args) : localCargarCatalogo(...args);

export const guardarCatalogo = (...args) =>
  usandoFirestore ? firestore.guardarCatalogo(...args) : localGuardarCatalogo(...args);

export const cargarMarcas = (...args) =>
  usandoFirestore ? firestore.cargarMarcas(...args) : localCargarMarcas(...args);

export const guardarMarca = (...args) =>
  usandoFirestore ? firestore.guardarMarca(...args) : localGuardarMarca(...args);
