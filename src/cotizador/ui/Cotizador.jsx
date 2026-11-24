import React, { useEffect, useMemo, useState } from 'react';
import engine from '../engine.js';
import {
  configurarFirestore, cargarCatalogo, cargarParametros, guardarParametros,
  listarCotizaciones, guardarCotizacion, eliminarCotizacion, guardarCatalogo,
  cargarMarcas, guardarMarca
} from '../storage.js';
import {
  ADMIN_EMAIL, TIPOS_PRENDA, PARAMETROS_META, PERMITIR_ELIMINAR_AL_USUARIO, esAdmin
} from '../config.js';
import { descargarExcel } from '../excel/exportar.js';
import { parsearArchivo } from '../excel/importar.js';
import { numero, moneda } from '../excel/modelo.js';
import './cotizador.css';

let secuencia = 0;
const nuevaLinea = () => ({ key: ++secuencia, operation: '', quantity: '1', adjustedSec: '' });

function Campo({ etiqueta, children }) {
  return (
    <label className="ctz-campo">
      <span>{etiqueta}</span>
      {children}
    </label>
  );
}

function Aviso({ tipo = 'info', children }) {
  if (!children) return null;
  return <div className={'ctz-aviso ctz-aviso-' + tipo}>{children}</div>;
}

export default function Cotizador({ usuario, db, admin: adminProp, titulo = 'Cotizador de muestras' }) {
  const correo = String((usuario && usuario.email) || '').trim().toLowerCase();
  const admin = typeof adminProp === 'boolean'
    ? adminProp
    : esAdmin(correo);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [catalogo, setCatalogo] = useState(null);
  const [parametros, setParametros] = useState(null);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [tab, setTab] = useState('cotizar');

  useEffect(() => {
    if (db) configurarFirestore(db);
  }, [db]);

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const incluido = (await import('../catalogo.json')).default;
        let cat = incluido;
        try {
          const guardado = await cargarCatalogo();
          if (guardado) cat = { ...incluido, ...guardado };
        } catch (e) {
          setAviso('No se pudo leer el catálogo de Firestore; se usa el incluido en la app.');
        }
        // Las marcas editadas a mano viven en un documento aparte.
        try {
          const marcas = await cargarMarcas();
          if (marcas && Object.keys(marcas).length) {
            cat = {
              ...cat,
              references: cat.references.map((r) =>
                Object.prototype.hasOwnProperty.call(marcas, r.code) ? { ...r, marca: marcas[r.code] } : r
              )
            };
          }
        } catch (_) {
          // Si falla, se usan las marcas que traiga el catálogo.
        }
        let params = cat.parameters;
        try {
          const guardados = await cargarParametros();
          if (guardados) params = { ...cat.parameters, ...guardados };
        } catch (e) {
          setAviso((prev) => prev || 'No se pudieron leer los parámetros guardados.');
        }
        if (!activo) return;
        setCatalogo(cat);
        setParametros(params);
        try {
          const lista = await listarCotizaciones();
          if (activo) setCotizaciones(lista);
        } catch (e) {
          if (activo) setError('No se pudo leer el historial: ' + (e.message || e));
        }
      } catch (e) {
        if (activo) setError('No se pudo cargar el catálogo: ' + (e.message || e));
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => { activo = false; };
  }, []);

  if (cargando) {
    return <div className="ctz"><div className="ctz-cargando">Cargando cotizador…</div></div>;
  }
  if (error && !catalogo) {
    return <div className="ctz"><Aviso tipo="error">{error}</Aviso></div>;
  }

  return (
    <div className="ctz">
      <header className="ctz-cabecera">
        <div>
          <h2>{titulo}</h2>
          <p>
            Tiempos estándar, costo de transformación y precio sugerido
            {correo ? ' · ' + correo : ''}{admin ? ' (administrador)' : ''}
          </p>
        </div>
      </header>

      <nav className="ctz-tabs">
        {[
          ['cotizar', 'Cotizar'],
          ['historial', 'Historial (' + cotizaciones.length + ')'],
          ['referencias', 'Referencias']
        ].map(([id, texto]) => (
          <button key={id} type="button" className={tab === id ? 'activo' : ''} onClick={() => setTab(id)}>
            {texto}
          </button>
        ))}
        {admin && (
          <button type="button" className={tab === 'parametros' ? 'activo' : ''} onClick={() => setTab('parametros')}>
            Parámetros
          </button>
        )}
        {admin && (
          <button type="button" className={tab === 'importar' ? 'activo' : ''} onClick={() => setTab('importar')}>
            Importar Excel
          </button>
        )}
      </nav>

      {aviso && <Aviso>{aviso}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}

      {tab === 'cotizar' && (
        <PanelCotizar
          catalogo={catalogo}
          parametros={parametros}
          correo={correo}
          onGuardada={(nueva) => setCotizaciones((prev) => [nueva, ...prev])}
        />
      )}
      {tab === 'historial' && (
        <PanelHistorial
          cotizaciones={cotizaciones}
          admin={admin}
          onEliminada={(id) => setCotizaciones((prev) => prev.filter((q) => q.id !== id))}
        />
      )}
      {tab === 'referencias' && (
        <PanelReferencias catalogo={catalogo} admin={admin} onCatalogo={setCatalogo} />
      )}
      {tab === 'parametros' && admin && (
        <PanelParametros
          catalogo={catalogo}
          parametros={parametros}
          onGuardados={setParametros}
        />
      )}
      {tab === 'importar' && admin && (
        <PanelImportar
          onImportado={(cat) => {
            setCatalogo(cat);
            setParametros((prev) => ({ ...(prev || {}), ...(cat.parameters || {}) }));
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cotizar                                                             */
/* ------------------------------------------------------------------ */

function PanelCotizar({ catalogo, parametros, correo, onGuardada }) {
  const [referencia, setReferencia] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [tipo, setTipo] = useState('');
  const [marca, setMarca] = useState('');
  const [lineas, setLineas] = useState([nuevaLinea()]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const operaciones = catalogo.operations;
  const tipos = useMemo(() => {
    const delCatalogo = catalogo.references.map((r) => String(r.type || '').trim()).filter(Boolean);
    return Array.from(new Set([...TIPOS_PRENDA, ...delCatalogo]));
  }, [catalogo.references]);

  const resultados = useMemo(() => lineas.map((linea) => {
    if (!String(linea.operation || '').trim()) return { key: linea.key, vacia: true };
    try {
      return { key: linea.key, ...engine.calculateLine(linea, parametros, operaciones) };
    } catch (e) {
      return { key: linea.key, error: e.message };
    }
  }), [lineas, parametros, operaciones]);

  const validas = useMemo(
    () => lineas.filter((linea, i) => !resultados[i].vacia && !resultados[i].error),
    [lineas, resultados]
  );

  let totales = null;
  let errorTotales = '';
  if (validas.length) {
    try {
      totales = engine.calculateQuote(validas, parametros, operaciones).totals;
    } catch (e) {
      errorTotales = e.message;
    }
  }

  const cambiarLinea = (key, campo, valor) => {
    setLineas((prev) => prev.map((l) => (l.key === key ? { ...l, [campo]: valor } : l)));
  };

  const guardar = async () => {
    setError('');
    if (!referencia.trim() || !descripcion.trim() || !tipo) {
      setError('Complete código, descripción y tipo de prenda antes de guardar.');
      return;
    }
    if (!validas.length || !totales) {
      setError('Agregue al menos una operación válida.');
      return;
    }
    setGuardando(true);
    try {
      const resultado = engine.calculateQuote(validas, parametros, operaciones);
      const cotizacion = {
        referencia: referencia.trim(),
        descripcion: descripcion.trim(),
        tipo,
        marca: marca.trim(),
        lineas: validas.map((l) => ({
          operation: String(l.operation || '').trim(),
          quantity: l.quantity === '' ? 1 : Number(l.quantity),
          adjustedSec: l.adjustedSec === '' ? null : Number(l.adjustedSec)
        })),
        parametros: { ...parametros },
        resultado,
        creadoPor: correo,
        createdAt: new Date().toISOString()
      };
      const id = await guardarCotizacion(cotizacion);
      onGuardada({ id, ...cotizacion });
      setReferencia('');
      setDescripcion('');
      setTipo('');
      setMarca('');
      setLineas([nuevaLinea()]);
    } catch (e) {
      setError('No se pudo guardar: ' + (e.message || e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="ctz-panel">
      <div className="ctz-bloque">
        <h3>Datos de la referencia</h3>
        <div className="ctz-fila">
          <Campo etiqueta="Código">
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="A0065" />
          </Campo>
          <Campo etiqueta="Descripción">
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Camiseta…" />
          </Campo>
          <Campo etiqueta="Tipo de prenda">
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Seleccione…</option>
              {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Marca">
            <input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Crearte" />
          </Campo>
        </div>
      </div>

      <div className="ctz-bloque">
        <div className="ctz-bloque-cabecera">
          <h3>Operaciones</h3>
          <button type="button" className="ctz-btn" onClick={() => setLineas((prev) => [...prev, nuevaLinea()])}>
            + Agregar operación
          </button>
        </div>

        <datalist id="ctz-operaciones">
          {operaciones.map((op) => <option key={op.id || op.name} value={op.name} />)}
        </datalist>

        <table className="ctz-tabla">
          <thead>
            <tr>
              <th>#</th>
              <th>Operación estándar</th>
              <th>Cantidad</th>
              <th>Ajuste (s)</th>
              <th>Base (s)</th>
              <th>Bloque</th>
              <th>ID</th>
              <th>SAM (min)</th>
              <th>Costo</th>
              <th>Alertas</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lineas.map((linea, indice) => {
              const r = resultados[indice];
              return (
                <tr key={linea.key}>
                  <td>{indice + 1}</td>
                  <td>
                    <input
                      list="ctz-operaciones"
                      value={linea.operation}
                      onChange={(e) => cambiarLinea(linea.key, 'operation', e.target.value)}
                      placeholder="Buscar operación…"
                    />
                  </td>
                  <td>
                    <input
                      type="number" min="1" step="1" value={linea.quantity}
                      onChange={(e) => cambiarLinea(linea.key, 'quantity', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number" min="0" step="0.01" value={linea.adjustedSec}
                      onChange={(e) => cambiarLinea(linea.key, 'adjustedSec', e.target.value)}
                      placeholder="Opcional"
                    />
                  </td>
                  <td>{r.error || r.vacia ? '—' : numero(r.baseSec, 2)}</td>
                  <td>{r.block || '—'}</td>
                  <td>{r.id || '—'}</td>
                  <td>{r.samMin != null ? numero(r.samMin, 3) : '—'}</td>
                  <td>{r.cost != null ? moneda(r.cost) : '—'}</td>
                  <td className={r.error ? 'ctz-error-texto' : 'ctz-alerta-texto'}>
                    {r.error || (r.warnings && r.warnings.length ? r.warnings.join('; ') : '')}
                  </td>
                  <td>
                    <button
                      type="button" className="ctz-btn-borrar"
                      onClick={() => setLineas((prev) => (prev.length === 1 ? [nuevaLinea()] : prev.filter((l) => l.key !== linea.key)))}
                      title="Quitar operación"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="ctz-nota">
          El tiempo base se toma del catálogo (validado → base histórica → mediana).
          Si se diligencia el ajuste, ese tiempo tiene prioridad.
        </p>
      </div>

      <div className="ctz-totales">
        <div><span>SAM confección</span><strong>{totales ? numero(totales.samConfeccion, 3) : '—'}</strong></div>
        <div><span>SAM term. + empaque</span><strong>{totales ? numero(totales.samTerminacionEmpaque, 3) : '—'}</strong></div>
        <div><span>SAM total</span><strong>{totales ? numero(totales.samTotal, 3) : '—'}</strong></div>
        <div><span>Costo transformación</span><strong>{totales ? moneda(totales.costoTransformacion) : '—'}</strong></div>
        <div className="ctz-destacado"><span>Precio sugerido</span><strong>{totales ? moneda(totales.precioSugerido) : '—'}</strong></div>
      </div>

      {errorTotales && <Aviso tipo="error">{errorTotales}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="ctz-acciones">
        <button type="button" className="ctz-btn ctz-btn-primario" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar cotización'}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Historial                                                           */
/* ------------------------------------------------------------------ */

function PanelHistorial({ cotizaciones, admin, onEliminada }) {
  const [seleccion, setSeleccion] = useState(() => new Set());
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('');

  const puedeBorrar = admin || PERMITIR_ELIMINAR_AL_USUARIO;
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return cotizaciones;
    return cotizaciones.filter((c) =>
      [c.referencia, c.descripcion, c.tipo, c.marca].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [cotizaciones, busqueda]);

  const alternar = (id) => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exportar = async () => {
    setEstado('Generando Excel…');
    try {
      const ids = seleccion.size ? Array.from(seleccion) : undefined;
      const r = await descargarExcel(cotizaciones, ids);
      setEstado('Excel generado: ' + r.fileName + ' (' + r.count + ' cotizaciones, ' + r.total + ').');
    } catch (e) {
      setEstado('Error: ' + (e.message || e));
    }
  };

  const borrar = async (c) => {
    if (!confirm('¿Eliminar la cotización ' + (c.referencia || '') + '? Esta acción no se puede deshacer.')) return;
    try {
      await eliminarCotizacion(c.id);
      onEliminada(c.id);
      setSeleccion((prev) => { const next = new Set(prev); next.delete(c.id); return next; });
      setEstado('Cotización eliminada.');
    } catch (e) {
      setEstado('No se pudo eliminar: ' + (e.message || e));
    }
  };

  return (
    <section className="ctz-panel">
      <div className="ctz-bloque-cabecera">
        <h3>Historial</h3>
        <div className="ctz-fila">
          <input
            placeholder="Buscar por referencia, descripción, tipo o marca…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <button type="button" className="ctz-btn" onClick={exportar}>
            Descargar Excel {seleccion.size ? '(' + seleccion.size + ')' : '(todas)'}
          </button>
        </div>
      </div>

      <div className="ctz-scroll">
        <table className="ctz-tabla">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={filtradas.length > 0 && seleccion.size === filtradas.length}
                  onChange={(e) => setSeleccion(e.target.checked ? new Set(filtradas.map((c) => c.id)) : new Set())}
                  title="Seleccionar todas"
                />
              </th>
              <th>Fecha</th>
              <th>Referencia</th>
              <th>Descripción</th>
              <th>Tipo</th>
              <th>Marca</th>
              <th>SAM</th>
              <th>Costo</th>
              <th>Precio</th>
              {puedeBorrar && <th />}
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 && (
              <tr><td colSpan={puedeBorrar ? 10 : 9} className="ctz-vacio">Sin cotizaciones guardadas.</td></tr>
            )}
            {filtradas.map((c) => {
              const t = (c.resultado && c.resultado.totals) || {};
              return (
                <tr key={c.id}>
                  <td><input type="checkbox" checked={seleccion.has(c.id)} onChange={() => alternar(c.id)} /></td>
                  <td>{new Date(c.createdAt).toLocaleString('es-CO')}</td>
                  <td><strong>{c.referencia}</strong></td>
                  <td>{c.descripcion}</td>
                  <td>{c.tipo || '—'}</td>
                  <td>{c.marca || '—'}</td>
                  <td>{numero(t.samTotal, 3)}</td>
                  <td>{moneda(t.costoTransformacion)}</td>
                  <td>{moneda(t.precioSugerido)}</td>
                  {puedeBorrar && (
                    <td>
                      <button type="button" className="ctz-btn-borrar" onClick={() => borrar(c)} title="Eliminar">
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {estado && <Aviso>{estado}</Aviso>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Referencias                                                         */
/* ------------------------------------------------------------------ */

function PanelReferencias({ catalogo, admin, onCatalogo }) {
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('');

  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return catalogo.references;
    return catalogo.references.filter((r) =>
      [r.code, r.description, r.type, r.marca].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [catalogo.references, busqueda]);

  const editarMarca = async (referencia) => {
    const nueva = prompt('Marca para ' + referencia.code + ':', referencia.marca || '');
    if (nueva === null) return;
    const marca = nueva.trim();
    setEstado('Guardando…');
    try {
      await guardarMarca(referencia.code, marca);
      const references = catalogo.references.map((r) =>
        r.code === referencia.code ? { ...r, marca } : r
      );
      onCatalogo({ ...catalogo, references });
      setEstado('Marca actualizada.');
    } catch (e) {
      setEstado('No se pudo guardar: ' + (e.message || e));
    }
  };

  return (
    <section className="ctz-panel">
      <div className="ctz-bloque-cabecera">
        <h3>Referencias ({catalogo.references.length})</h3>
        <input placeholder="Buscar código, descripción, tipo o marca…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      </div>
      <div className="ctz-scroll ctz-scroll-alto">
        <table className="ctz-tabla">
          <thead>
            <tr>
              <th>Código</th><th>Descripción</th><th>Tipo</th><th>Marca</th><th>SAM total</th>
              {admin && <th />}
            </tr>
          </thead>
          <tbody>
            {lista.slice(0, 500).map((r) => (
              <tr key={r.code}>
                <td><strong>{r.code}</strong></td>
                <td>{r.description}</td>
                <td>{r.type}</td>
                <td>{r.marca || '—'}</td>
                <td>{numero(r.samTotalMin, 3)}</td>
                {admin && <td><button type="button" className="ctz-btn-mini" onClick={() => editarMarca(r)}>Editar</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lista.length > 500 && <p className="ctz-nota">Mostrando las primeras 500 coincidencias.</p>}
      {estado && <Aviso>{estado}</Aviso>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Parámetros (solo admin)                                             */
/* ------------------------------------------------------------------ */

function PanelParametros({ catalogo, parametros, onGuardados }) {
  const [valores, setValores] = useState(() => {
    const copia = { ...parametros };
    PARAMETROS_META.forEach((p) => {
      if (p.porcentaje && copia[p.key] != null) copia[p.key] = Number((Number(copia[p.key]) * 100).toFixed(4));
    });
    return copia;
  });
  const [estado, setEstado] = useState('');
  const [prueba, setPrueba] = useState(null);

  const guardar = async () => {
    const limpio = { ...valores };
    PARAMETROS_META.forEach((p) => {
      if (p.porcentaje) limpio[p.key] = Number(valores[p.key]) / 100;
      else limpio[p.key] = valores[p.key] === '' ? null : Number(valores[p.key]);
    });
    try {
      engine.validateParams(limpio);
    } catch (e) {
      setEstado('Error: ' + e.message);
      return;
    }
    setEstado('Guardando…');
    try {
      await guardarParametros(limpio);
      onGuardados(limpio);
      setEstado('Parámetros guardados.');
    } catch (e) {
      setEstado('No se pudo guardar: ' + (e.message || e));
    }
  };

  const verificar = () => {
    // Verifica con lo que está escrito en pantalla, no con lo último guardado.
    const actuales = { ...parametros };
    PARAMETROS_META.forEach((p) => {
      actuales[p.key] = p.porcentaje
        ? Number(valores[p.key]) / 100
        : valores[p.key] === '' ? null : Number(valores[p.key]);
    });
    setPrueba(engine.compareWithExcel(catalogo, actuales));
  };

  return (
    <section className="ctz-panel">
      <div className="ctz-bloque">
        <h3>Parámetros del motor</h3>
        <div className="ctz-fila ctz-fila-wrap">
          {PARAMETROS_META.map((p) => (
            <Campo key={p.key} etiqueta={p.label + (p.porcentaje ? ' (%)' : '')}>
              <input
                type="number" step={p.step} value={valores[p.key] == null ? '' : valores[p.key]}
                onChange={(e) => setValores((prev) => ({ ...prev, [p.key]: e.target.value }))}
              />
            </Campo>
          ))}
        </div>
        <div className="ctz-acciones">
          <button type="button" className="ctz-btn ctz-btn-primario" onClick={guardar}>Guardar parámetros</button>
          <button type="button" className="ctz-btn" onClick={verificar}>Verificar cálculo</button>
        </div>
        {prueba && (
          <Aviso tipo={prueba.passed ? 'ok' : 'error'}>
            Caso de control ({prueba.operation}): {prueba.passed ? 'coincide con el Excel' : 'NO coincide'}.
            SAM esperado {numero(prueba.expected.samMin, 3)} / obtenido {numero(prueba.actual.samMin, 3)}.
          </Aviso>
        )}
        {estado && <Aviso>{estado}</Aviso>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Importar Excel (solo admin)                                         */
/* ------------------------------------------------------------------ */

function PanelImportar({ onImportado }) {
  const [archivo, setArchivo] = useState(null);
  const [leido, setLeido] = useState(null);
  const [estado, setEstado] = useState('');
  const [cargando, setCargando] = useState(false);

  const leer = async (file) => {
    setArchivo(file);
    setLeido(null);
    setEstado('Leyendo archivo…');
    try {
      const catalogo = await parsearArchivo(file);
      setLeido(catalogo);
      setEstado('Archivo leído: ' + catalogo.operations.length + ' operaciones y ' +
        catalogo.references.length + ' referencias. Revise y confirme.');
    } catch (e) {
      setEstado('Error al leer: ' + (e.message || e));
    }
  };

  const confirmar = async () => {
    if (!leido) return;
    if (!confirm('Se reemplazarán el catálogo y los parámetros actuales. ¿Continuar?')) return;
    setCargando(true);
    setEstado('Guardando en Firestore…');
    try {
      const r = await guardarCatalogo(leido);
      onImportado(leido);
      setEstado('Importación completa: ' + r.operations + ' operaciones, ' + r.references + ' referencias.');
      setLeido(null);
      setArchivo(null);
    } catch (e) {
      setEstado('No se pudo guardar: ' + (e.message || e));
    } finally {
      setCargando(false);
    }
  };

  const control = leido && leido.goldenCase
    ? engine.compareWithExcel(leido, leido.parameters)
    : null;

  return (
    <section className="ctz-panel">
      <div className="ctz-bloque">
        <h3>Importar catálogo desde Excel</h3>
        <p className="ctz-nota">
          Acepta el archivo del cotizador (.xlsx o .xlsm). Se leen las hojas
          Parametros, Base_operaciones, BD Referencias, Historico y Cotizador.
          Las macros no se ejecutan.
        </p>
        <input
          type="file"
          accept=".xlsx,.xlsm"
          onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) leer(f); }}
        />
        {archivo && <p className="ctz-nota">Archivo: {archivo.name}</p>}
        {leido && (
          <div className="ctz-resumen-import">
            <p><strong>Operaciones:</strong> {leido.operations.length}</p>
            <p><strong>Referencias:</strong> {leido.references.length}</p>
            <p><strong>Parámetros:</strong> {Object.keys(leido.parameters).length} de 8</p>
            {control && (
              <p>
                <strong>Caso de control:</strong>{' '}
                <span className={control.passed ? 'ctz-ok-texto' : 'ctz-error-texto'}>
                  {control.passed ? 'coincide con el Excel' : 'NO coincide (revise los parámetros)'}
                </span>
              </p>
            )}
            <button type="button" className="ctz-btn ctz-btn-primario" onClick={confirmar} disabled={cargando}>
              {cargando ? 'Guardando…' : 'Confirmar importación'}
            </button>
          </div>
        )}
        {estado && <Aviso tipo={/Error|No se pudo/.test(estado) ? 'error' : 'info'}>{estado}</Aviso>}
      </div>
    </section>
  );
}
