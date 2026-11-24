'use strict';

const $ = (id) => document.getElementById(id);
const engine = window.CotizadorEngine;

// Identificadores públicos de EmailJS (los mismo que usa la versión publicada de Crearte).
const EMAILJS_SERVICE_ID = 'service_8lq3ei3';
const EMAILJS_TEMPLATE_ID = 'template_ersho2m';
const EMAILJS_PUBLIC_KEY = 'd1WCtmrksSpYe5uKe';

const state = {
  catalog: null,
  params: null,
  lines: [],
  result: null,
  quotes: [],
  refs: [],
  operationOptions: [],
  importInfo: null,
  mailSummary: null,
  selectedQuoteIds: new Set(),
  adminTokenRequired: false,
  readOnly: false
};

const PARAM_DEFS = [
  { key: 'supplementPct', label: 'Suplemento (%)', pct: true, step: '0.1' },
  { key: 'costPerMinConf', label: 'Valor minuto confeccion', step: '0.01' },
  { key: 'costPerMinFinish', label: 'Valor minuto terminacion', step: '0.01' },
  { key: 'costPerMinPack', label: 'Costo empaque ($/min, opcional)', step: '0.01' },
  { key: 'complexityFactor', label: 'Factor de complejidad', step: '0.01' },
  { key: 'profitPct', label: 'Utilidad objetivo (%)', pct: true, step: '0.1' },
  { key: 'workDays', label: 'Días hábiles por mes', step: '1' },
  { key: 'hoursPerDay', label: 'Horas por jornada', step: '0.1' },
  { key: 'efficiency', label: 'Eficiencia (%)', pct: true, step: '0.1' }
];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmt(value, decimals) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: decimals == null ? 2 : decimals,
    maximumFractionDigits: decimals == null ? 2 : decimals
  }).format(n);
}
const money = (value) => '$ ' + fmt(value, 2);

function getSelectedIds() {
  return state.quotes
    .filter((q) => state.selectedQuoteIds.has(q.id))
    .map((q) => q.id);
}

function pruneSelection() {
  const valid = new Set(state.quotes.map((q) => q.id));
  state.selectedQuoteIds = new Set([...state.selectedQuoteIds].filter((id) => valid.has(id)));
}

function selectedPayload() {
  return JSON.stringify({ ids: getSelectedIds() });
}

function updateSelectionUI() {
  const ids = getSelectedIds();
  const total = state.quotes.length;
  const countEl = $('selectionCount');
  if (countEl) {
    countEl.textContent = `${ids.length} de ${total} seleccionadas`;
    countEl.className = 'badge ' + (ids.length ? 'badge-ok' : 'badge-muted');
  }
  const all = $('selectAllQuotes');
  if (all) {
    all.checked = total > 0 && ids.length === total;
    all.indeterminate = ids.length > 0 && ids.length < total;
    all.disabled = total === 0;
  }
  const info = $('mailSelectionInfo');
  if (info) {
    if (!ids.length) {
      info.textContent = 'No hay cotizaciones seleccionadas. Marque al menos una en Historial o use «Seleccionar todas».';
      info.style.color = 'var(--danger)';
    } else {
      const refs = state.quotes
        .filter((q) => state.selectedQuoteIds.has(q.id))
        .map((q) => q.reference || '—');
      const shown = refs.slice(0, 6).join(', ');
      const label = ids.length === 1 ? 'cotización seleccionada' : 'cotizaciones seleccionadas';
      info.textContent = `Se enviará${ids.length === 1 ? '' : 'n'} ${ids.length} ${label}` +
        (shown ? ': ' + shown + (refs.length > 6 ? '…' : '') : '') + '.';
      info.style.color = 'var(--muted)';
    }
  }
}

// Las acciones que escriben piden una clave que no está guardada en el código.
// Se conserva solo en memoria mientras la pestaña esté abierta: nunca se
// escribe en sessionStorage/localStorage, donde un XSS podría leerla.
let adminTokenInMemory = '';
function adminTokenHeader() { return {}; }

// Debe coincidir con isAdminRoute() del servidor: toda petición que no sea de
// lectura requiere la clave (GET, HEAD, OPTIONS y /api/health quedan fuera).
function isAdminRequest(path, method) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false;
  if (path === '/api/health') return false;
  return true;
}


function quoteRowsForSummary(ids) {
  const selected = Array.isArray(ids) ? new Set(ids.map(String)) : null;
  return (window.CotizadorStore.quotes || []).filter((q) => !selected || selected.has(String(q.id)));
}

function buildLocalEmailSummary(ids) {
  const list = quoteRowsForSummary(ids);
  const byType = new Map();
  const byBrand = new Map();
  let totalSam = 0, totalCost = 0, totalPrice = 0;
  let minDate = null, maxDate = null;
  for (const q of list) {
    const t = q.result?.totals || {};
    const sam = Number(t.samTotal) || 0;
    const cost = Number(t.costoTransformacion) || 0;
    const price = Number(t.precioSugerido) || 0;
    totalSam += sam; totalCost += cost; totalPrice += price;
    if (q.createdAt && (!minDate || q.createdAt < minDate)) minDate = q.createdAt;
    if (q.createdAt && (!maxDate || q.createdAt > maxDate)) maxDate = q.createdAt;
    const type = String(q.type || 'Sin tipo');
    const bt = byType.get(type) || { count: 0, totalPrice: 0 };
    bt.count++; bt.totalPrice += price; byType.set(type, bt);
    const brand = String(q.marca || '').trim() || 'Sin marca';
    const bb = byBrand.get(brand) || { count: 0, totalPrice: 0 };
    bb.count++; bb.totalPrice += price; byBrand.set(brand, bb);
  }
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-CO') : '—';
  const sort = (m, key) => Array.from(m.entries()).map(([k, v]) => ({ [key]: k, count: v.count, totalPrice: Number(v.totalPrice.toFixed(2)) })).sort((a,b)=>b.totalPrice-a.totalPrice);
  return {
    count: list.length,
    from: fmtDate(minDate),
    to: fmtDate(maxDate),
    totalSam: Number(totalSam.toFixed(3)),
    totalCost: Number(totalCost.toFixed(2)),
    totalPrice: Number(totalPrice.toFixed(2)),
    avgPrice: list.length ? Number((totalPrice / list.length).toFixed(2)) : 0,
    byType: sort(byType, 'type'),
    byBrand: sort(byBrand, 'brand')
  };
}

function buildEmailBody(summary, opts) {
  const linkUrl = opts && opts.linkUrl ? opts.linkUrl : '';
  const linkHtml = linkUrl
    ? `<p><strong>Descargar Excel:</strong> <a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener">${escapeHtml(linkUrl)}</a></p>`
    : `<p><strong>Excel:</strong> ${(opts && opts.fileName) ? escapeHtml(opts.fileName) : 'adjunto/descargado localmente'} (sin enlace público; adjunte el archivo descargado).</p>`;
  return [
    '<div style="font-family:Arial,sans-serif;color:#222;line-height:1.45">',
    '<h2 style="margin:0 0 12px">Resumen de cotizaciones</h2>',
    `<p><strong>Cotizaciones:</strong> ${fmt(summary.count,0)} &nbsp;|&nbsp; <strong>Período:</strong> ${escapeHtml(summary.from)} al ${escapeHtml(summary.to)}</p>`,
    `<p><strong>SAM total:</strong> ${fmt(summary.totalSam,3)} min &nbsp;|&nbsp; <strong>Costo total:</strong> ${money(summary.totalCost)} &nbsp;|&nbsp; <strong>Precio sugerido:</strong> ${money(summary.totalPrice)}</p>`,
    linkHtml,
    '</div>'
  ].join('');
}

async function generateLocalExcel(ids, opts) {
  const options = opts || {};
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error('No se pudo cargar la librería de Excel (SheetJS).');
  const list = quoteRowsForSummary(ids);
  if (!list.length) throw new Error('Seleccione al menos una cotización para generar el Excel.');
  const summary = buildLocalEmailSummary(ids);

  const wb = XLSX.utils.book_new();
  const resumenAoa = [
    ['HISTORIAL DE COTIZACIONES'],
    [],
    ['Generado', new Date().toLocaleString('es-CO')],
    ['Cotizaciones', summary.count],
    ['Desde', summary.from],
    ['Hasta', summary.to],
    ['SAM total (min)', summary.totalSam],
    ['Costo total', summary.totalCost],
    ['Precio sugerido total', summary.totalPrice],
    ['Precio sugerido promedio', summary.avgPrice],
    [],
    ['Por tipo de prenda'], ['Tipo', 'Cotizaciones', 'Precio sugerido'],
    ...summary.byType.map((t) => [t.type, t.count, t.totalPrice]),
    [],
    ['Por marca'], ['Marca', 'Cotizaciones', 'Precio sugerido'],
    ...summary.byBrand.map((b) => [b.brand, b.count, b.totalPrice])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenAoa), 'Resumen');

  const cotAoa = [[
    'Fecha','Referencia','Descripción','Tipo','Operaciones','SAM conf.','SAM term.+emp.','SAM total','Costo','Precio sugerido',
    'Suplemento (%)','Valor minuto confeccion','Valor minuto terminacion','Costo empaque ($/min)','Factor complejidad','Utilidad (%)',
    'Días hábiles/mes','Horas/jornada','Eficiencia (%)','Parámetros usados','Marca'
  ]];
  const detAoa = [[
    'Fecha','Referencia','Operación','Bloque','ID','Cantidad','Base (s)','SAM (min)','Costo','Alertas','Marca'
  ]];
  for (const q of list) {
    const t = q.result?.totals || {};
    const p = q.parameters || {};
    const paramsTxt = [
      'Suplemento ' + fmt((p.supplementPct||0)*100,2)+'%',
      'Valor minuto confeccion $ '+fmt(p.costPerMinConf,2)+'/min',
      'Valor minuto terminacion $ '+fmt(p.costPerMinFinish,2)+'/min',
      'Empaque $ '+fmt(p.costPerMinPack,2)+'/min',
      'Complejidad '+fmt(p.complexityFactor,2),
      'Utilidad '+fmt((p.profitPct||0)*100,2)+'%',
      'Capacidad '+fmt(p.workDays,0)+' días × '+fmt(p.hoursPerDay,1)+' h',
      'Eficiencia '+fmt((p.efficiency||0)*100,2)+'%'
    ].join(' | ');
    cotAoa.push([
      q.createdAt ? new Date(q.createdAt).toLocaleString('es-CO') : '—',
      q.reference||'', q.description||'', q.type||'', (q.lines||[]).length,
      Number((t.samConfeccion||0).toFixed(3)), Number((t.samTerminacionEmpaque||0).toFixed(3)), Number((t.samTotal||0).toFixed(3)),
      Number((t.costoTransformacion||0).toFixed(2)), Number((t.precioSugerido||0).toFixed(2)),
      p.supplementPct, p.costPerMinConf, p.costPerMinFinish, p.costPerMinPack,
      p.complexityFactor, p.profitPct, p.workDays, p.hoursPerDay, p.efficiency,
      paramsTxt, q.marca || ''
    ]);
    for (const line of (q.result?.lines || q.lines || [])) {
      detAoa.push([
        q.createdAt ? new Date(q.createdAt).toLocaleString('es-CO') : '—',
        q.reference||'', line.operation||line.name||'', line.block||'', line.id||'',
        line.quantity||0, Number((line.baseSec||0).toFixed(2)), Number((line.samMin||0).toFixed(3)),
        Number((line.cost||0).toFixed(2)), (line.warnings||[]).join('; '), q.marca || ''
      ]);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cotAoa), 'Cotizaciones');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detAoa), 'Detalle operaciones');

  const fileName = 'historial_' + new Date().toISOString().replace(/[-:]/g,'').slice(0,15).replace('T','_') + '.xlsx';
  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (options.download !== false) XLSX.writeFile(wb, fileName);
  return { ok: true, fileName, count: list.length, blob, summary };
}

function sanitizeEmail(raw) {
  return String(raw || '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email);
}

async function uploadExcelForEmail(result) {
  const sb = window.CotizadorSupabase;
  if (sb && sb.isReady()) {
    try {
      const uploaded = await sb.uploadExcel(result.blob, result.fileName);
      if (uploaded && uploaded.url) return { url: uploaded.url, warning: '' };
    } catch (err) {
      console.error('No se pudo subir el Excel a Supabase:', err);
      return { url: '', warning: 'No se pudo subir el Excel a Supabase: ' + err.message };
    }
  }

  const fb = window.CotizadorFirebase;
  if (fb && fb.isReady()) {
    try {
      const uploaded = await fb.uploadExcel(result.blob, result.fileName);
      if (uploaded && uploaded.url) return { url: uploaded.url, warning: '' };
    } catch (err) {
      console.error('No se pudo subir el Excel a Firebase Storage:', err);
      return { url: '', warning: 'No se pudo subir el Excel a Storage: ' + err.message };
    }
  }

  return { url: '', warning: 'No hay almacenamiento configurado (Supabase/Firebase); el correo saldrá sin enlace público.' };
}

async function buildLocalEmailPreview(ids, opts) {
  const options = opts || {};
  const summary = buildLocalEmailSummary(ids);
  if (!summary.count) throw new Error('Seleccione al menos una cotización para enviar.');
  const res = await generateLocalExcel(ids, { download: options.download !== false });
  let downloadUrl = '';
  let uploadWarning = '';
  if (options.upload !== false) {
    const uploaded = await uploadExcelForEmail(res);
    downloadUrl = uploaded.url;
    uploadWarning = uploaded.warning;
  }
  return {
    ok: true,
    fileName: res.fileName,
    downloadUrl,
    uploadWarning,
    message: buildEmailBody(summary, { linkUrl: downloadUrl, fileName: res.fileName }),
    count: summary.count
  };
}
async function api(path, options) {
  const opts = options || {};
  const method = String(opts.method || 'GET').toUpperCase();
  const body = opts.body ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body) : null;
  const store = window.CotizadorStore;

  if (path === '/api/bootstrap' && method === 'GET') return store.bootstrap();
  if (path === '/api/parameters' && method === 'GET') return store.currentParameters();
  if (path === '/api/parameters' && method === 'PUT') return store.putParameters(body);
  if (path === '/api/calculate' && method === 'POST') return store.calculate(body.lines || [], body.reference);
  if (path === '/api/quotes' && method === 'GET') return store.quotes;
  if (path === '/api/quotes' && method === 'POST') return store.saveQuote(body);
  const quoteMatch = path.match(/^\/api\/quotes\/([^/]+)$/);
  if (quoteMatch && method === 'GET') return store.getQuote(decodeURIComponent(quoteMatch[1]));
  if (quoteMatch && method === 'DELETE') return store.deleteQuote(decodeURIComponent(quoteMatch[1]));
  const refMatch = path.match(/^\/api\/references\/([^/]+)$/);
  if (refMatch && method === 'PUT') return store.putReference(decodeURIComponent(refMatch[1]), body ? body.marca : '');
  if (path === '/api/import/clear' && method === 'POST') { store.clearData(false); return { ok: true }; }
  if (path === '/api/import/restore' && method === 'POST') { store.clearData(true); location.reload(); return { ok: true }; }
  if (path === '/api/backup/status' && method === 'GET') return { backups: [], retention: 0, disk: { available: false }, drill: { ok: true, problems: [] } };
  if (path === '/api/backup/create' && method === 'POST') throw new Error('En modo web estático use el Excel del historial como respaldo.');
  if (path === '/api/backup/verify' && method === 'POST') return { ok: true, problems: [] };
  if (path === '/api/backup/restore' && method === 'POST') throw new Error('La restauración de backup del servidor no aplica en modo estático.');
  if (path === '/api/email/summary' && method === 'POST') return buildLocalEmailSummary(body && body.ids);
  if (path === '/api/email/excel' && method === 'POST') return generateLocalExcel(body && body.ids);
  if (path === '/api/email/emailjs/preview' && method === 'POST') return buildLocalEmailPreview(body && body.ids);

  throw new Error('Acción no disponible en modo estático: ' + method + ' ' + path);
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.hidden = true; }, 3200);
}

function showError(message) {
  const box = $('errorBox');
  if (!message) { box.hidden = true; box.textContent = ''; return; }
  box.hidden = false;
  box.textContent = message;
}

function newLine(operation) {
  return { operation: operation || '', quantity: 1, adjustedSec: '' };
}

let activeComboInput = null;
let activeOptionIndex = 0;

function normText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function closeOperationMenu() {
  const menu = $('operationMenu');
  if (!menu) return;
  menu.hidden = true;
  menu.innerHTML = '';
  document.querySelectorAll('.op-search').forEach((input) => input.setAttribute('aria-expanded', 'false'));
  activeComboInput = null;
  activeOptionIndex = 0;
}

function positionOperationMenu(input) {
  const menu = $('operationMenu');
  const rect = input.getBoundingClientRect();
  const menuHeight = 260;
  const below = window.innerHeight - rect.bottom;
  const top = below < menuHeight && rect.top > menuHeight
    ? rect.top - menuHeight - 4
    : rect.bottom + 4;
  menu.style.top = `${top}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.width = `${Math.max(rect.width, 340)}px`;
}

function setActiveOption(index) {
  const menu = $('operationMenu');
  const options = [...menu.querySelectorAll('.op-option')];
  if (!options.length) return;
  activeOptionIndex = Math.max(0, Math.min(index, options.length - 1));
  options.forEach((option, i) => option.classList.toggle('active', i === activeOptionIndex));
  options[activeOptionIndex].scrollIntoView({ block: 'nearest' });
}

function renderOperationOptions(query) {
  const menu = $('operationMenu');
  const needle = normText(query);
  const ops = state.operationOptions || [];
  const found = ops.filter((op) =>
    normText(op.name).includes(needle) || normText(op.block).includes(needle)
  );
  const matches = found
    .filter((op) => normText(op.name) === needle)
    .concat(found.filter((op) => normText(op.name) !== needle));
  const shown = matches.slice(0, 80);

  if (!shown.length) {
    menu.innerHTML = '<div class="op-empty">No hay operaciones con ese texto.</div>';
    return;
  }

  const label = matches.length > shown.length
    ? `Mostrando ${shown.length} de ${matches.length} coincidencias`
    : `${matches.length} coincidencia${matches.length === 1 ? '' : 's'}`;

  menu.innerHTML = `<div class="op-menu-head">${label}</div>` + shown.map((op, i) => `
    <button type="button" class="op-option${i === 0 ? ' active' : ''}" role="option"
      data-op="${escapeHtml(op.name)}" title="${escapeHtml(op.name)}">
      <span>${escapeHtml(op.name)}</span>
      <small>${escapeHtml(op.block || '')}</small>
    </button>`).join('');
  activeOptionIndex = 0;
}

function openOperationMenu(input) {
  closeOperationMenu();
  const menu = $('operationMenu');
  activeComboInput = input;
  input.setAttribute('aria-expanded', 'true');
  renderOperationOptions(input.value === input.dataset.value ? '' : input.value);
  positionOperationMenu(input);
  menu.hidden = false;
}

function selectOperation(name) {
  const input = activeComboInput;
  if (!input) return;
  const idx = Number(input.dataset.idx);
  state.lines[idx].operation = name;
  closeOperationMenu();
  recalculateLocal();
  const qty = document.querySelector(`#opsBody [data-idx="${idx}"][data-field="quantity"]`);
  if (qty) qty.focus();
}

function commitOperationInput(input) {
  const committed = input.dataset.value || '';
  const typed = input.value.trim();
  if (normText(typed) === normText(committed)) {
    input.value = committed;
    closeOperationMenu();
    return;
  }
  const exact = (state.operationOptions || []).find((op) => normText(op.name) === normText(typed));
  if (exact) {
    selectOperation(exact.name);
    return;
  }
  input.value = committed;
  closeOperationMenu();
}

function handleOperationKeydown(event) {
  if (!event.target.classList.contains('op-search')) return;
  const menu = $('operationMenu');
  if (menu.hidden) {
    if (event.key === 'ArrowDown' || event.key === 'Enter') {
      event.preventDefault();
      openOperationMenu(event.target);
    }
    return;
  }

  const options = [...menu.querySelectorAll('.op-option')];
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setActiveOption(activeOptionIndex + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    setActiveOption(activeOptionIndex - 1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const option = options[activeOptionIndex];
    if (option) selectOperation(option.dataset.op);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.target.value = event.target.dataset.value || '';
    closeOperationMenu();
  } else if (event.key === 'Tab') {
    commitOperationInput(event.target);
  }
}

function operationCells(line) {
  const catalogOps = state.catalog ? state.catalog.operations : [];
  let calc = null;
  let error = '';
  try {
    calc = engine.calculateLine(line, state.params, catalogOps);
    if (!calc) error = 'Complete la operación';
  } catch (err) {
    error = err.message;
  }
  const alerts = calc && calc.warnings.length
    ? calc.warnings.map((w) => `<span class="warn-text" title="${escapeHtml(w)}">⚠ ${escapeHtml(w)}</span>`).join('')
    : (calc ? '<span style="color:var(--ok)">OK</span>' : '');
  return {
    baseSec: calc ? fmt(calc.baseSec, 2) : '—',
    block: calc ? escapeHtml(calc.block) : '—',
    id: calc ? escapeHtml(calc.id) : '—',
    samMin: calc ? fmt(calc.samMin, 3) : '—',
    cost: calc ? money(calc.cost) : '—',
    alerts: error
      ? `<span class="warn-text" style="color:var(--danger)">${escapeHtml(error)}</span>`
      : alerts
  };
}

function renderOperations() {
  const body = $('opsBody');
  const html = state.lines.map((line, idx) => {
    const value = (field) => escapeHtml(line[field] == null ? '' : line[field]);
    const cells = operationCells(line);
    return `
      <tr data-row="${idx}">
        <td>${idx + 1}</td>
        <td>
          <div class="op-combo">
            <input class="op-search" type="text" role="combobox" aria-expanded="false" aria-controls="operationMenu"
              autocomplete="off" spellcheck="false" data-idx="${idx}" data-field="operation"
              data-value="${value('operation')}" value="${value('operation')}" placeholder="Buscar operación…" />
          </div>
        </td>
        <td><input class="qty" type="number" min="1" step="1" data-idx="${idx}" data-field="quantity" value="${value('quantity')}" /></td>
        <td><input class="adj" type="number" min="0" step="0.01" data-idx="${idx}" data-field="adjustedSec" value="${value('adjustedSec')}" placeholder="—" /></td>
        <td class="num">${cells.baseSec}</td>
        <td>${cells.block}</td>
        <td>${cells.id}</td>
        <td class="num">${cells.samMin}</td>
        <td class="num">${cells.cost}</td>
        <td>${cells.alerts}</td>
        <td><button class="danger" type="button" data-remove="${idx}" title="Quitar fila">×</button></td>
      </tr>`;
  }).join('');
  body.innerHTML = html || '<tr><td colspan="11" style="color:var(--muted)">No hay operaciones. Agregue una para comenzar.</td></tr>';
}

function refreshOperationCells() {
  const body = $('opsBody');
  state.lines.forEach((line, idx) => {
    const row = body.querySelector(`tr[data-row="${idx}"]`);
    if (!row) return;
    const cells = operationCells(line);
    row.cells[4].innerHTML = cells.baseSec;
    row.cells[5].innerHTML = cells.block;
    row.cells[6].innerHTML = cells.id;
    row.cells[7].innerHTML = cells.samMin;
    row.cells[8].innerHTML = cells.cost;
    row.cells[9].innerHTML = cells.alerts;
  });
}

function renderTotals() {
  const t = state.result && state.result.totals;
  $('kpiSamConf').textContent = fmt(t ? t.samConfeccion : 0, 2) + ' min';
  $('kpiSamRest').textContent = fmt(t ? t.samTerminacionEmpaque : 0, 2) + ' min';
  $('kpiSamTotal').textContent = fmt(t ? t.samTotal : 0, 2) + ' min';
  $('kpiCost').textContent = money(t ? t.costoTransformacion : 0);
  $('kpiPrice').textContent = money(t ? t.precioSugerido : 0);
}

function recalculateLocal(keepInputs) {
  const active = document.activeElement;
  const focusInfo = active && active.closest && active.closest('#opsBody')
    ? { idx: active.dataset.idx, field: active.dataset.field, start: active.selectionStart, end: active.selectionEnd }
    : null;

  try {
    state.result = engine.calculateQuote(state.lines, state.params, state.catalog.operations, {
      reference: $('refCode').value.trim()
    });
    showError('');
  } catch (err) {
    state.result = null;
    showError(err.message);
  }
  if (keepInputs) refreshOperationCells();
  else renderOperations();
  renderTotals();

  if (!keepInputs && focusInfo && focusInfo.field && focusInfo.field !== 'operation') {
    const next = document.querySelector(`#opsBody [data-idx="${focusInfo.idx}"][data-field="${focusInfo.field}"]`);
    if (next) {
      next.focus();
      try { next.setSelectionRange(focusInfo.start, focusInfo.end); } catch (_) { /* number inputs */ }
    }
  }
}

function renderReferences(filter) {
  const needle = String(filter || '').trim().toLowerCase();
  const rows = state.refs.filter((r) =>
    !needle || [r.code, r.description, r.type, r.marca].some((v) => String(v || '').toLowerCase().includes(needle))
  );
  $('refsBody').innerHTML = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.code)}</td>
      <td><input class="ref-brand" type="text" data-code="${escapeHtml(r.code)}" value="${escapeHtml(r.marca || '')}" placeholder="—" title="Marca de la referencia" style="width:100%" /></td>
      <td>${escapeHtml(r.description)}</td>
      <td>${escapeHtml(r.type)}</td>
      <td class="num">${fmt(r.confectionMin, 2)}</td>
      <td class="num">${fmt(r.finishingMin, 2)}</td>
      <td class="num">${fmt(r.packingMin, 2)}</td>
      <td class="num">${fmt(r.samTotalMin, 2)}</td>
      <td class="num">${r.supplementPct == null ? '—' : fmt(r.supplementPct * 100, 0) + '%'}</td>
    </tr>`).join('') || '<tr><td colspan="9" style="color:var(--muted)">Sin resultados</td></tr>';
}

function renderHistory() {
  const rows = state.quotes.map((q) => {
    const checked = state.selectedQuoteIds.has(q.id) ? ' checked' : '';
    return `
    <tr>
      <td><input type="checkbox" class="quote-select" data-select="${escapeHtml(q.id)}"${checked} title="Incluir en el correo" /></td>
      <td>${escapeHtml(new Date(q.createdAt).toLocaleString('es-CO'))}</td>
      <td><strong>${escapeHtml(q.reference || '—')}</strong></td>
      <td>${escapeHtml(q.marca || '—')}</td>
      <td>${escapeHtml(q.description || '')}</td>
      <td class="num">${q.lines || 0}</td>
      <td class="num">${fmt(q.totalSam, 2)}</td>
      <td class="num">${money(q.totalCost)}</td>
      <td class="num">${money(q.suggestedPrice)}</td>
      <td>
        <button class="link" type="button" data-load="${escapeHtml(q.id)}">Abrir</button>
        ${state.readOnly ? '' : `<button class="danger" type="button" data-delete="${escapeHtml(q.id)}">Eliminar</button>`}
      </td>
    </tr>`;
  }).join('');
  $('historyBody').innerHTML = rows ||
    '<tr><td colspan="10" style="color:var(--muted)">Aún no hay cotizaciones guardadas.</td></tr>';
  updateSelectionUI();
}

function renderParams() {
  $('paramsForm').innerHTML = PARAM_DEFS.map((def) => {
    const raw = state.params[def.key];
    const value = def.pct && raw != null ? Number(raw) * 100 : raw;
    return `<label>${def.label}<input type="number" step="${def.step}" data-param="${def.key}" value="${value == null ? '' : escapeHtml(value)}" /></label>`;
  }).join('');
  const p = state.params;
  const minutes = Number(p.workDays) * Number(p.hoursPerDay) * 60 * Number(p.efficiency);
  $('paramInfo').textContent = `Catálogo: ${state.catalog.operations.length} operaciones · ${state.refs.length} referencias · Capacidad productiva: ${fmt(minutes, 0)} min por operario/mes.`;
}

function renderImportInfo(data) {
  const m = data.meta || {};
  const info = data.importInfo || {};
  const date = m.exportedAt ? new Date(m.exportedAt).toLocaleString('es-CO') : '—';
  $('importCurrent').innerHTML = `
    <strong>Archivo cargado actualmente:</strong> ${escapeHtml(m.sourceFile || '—')}<br>
    <strong>Última importación:</strong> ${escapeHtml(date)}<br>
    <strong>Datos activos:</strong> ${fmt(m.operationCount || 0, 0)} operaciones · ${fmt(m.referenceCount || 0, 0)} referencias · ${state.quotes.length} cotizaciones guardadas<br>
    <strong>Copias de seguridad:</strong> ${info.catalogBackup ? 'disponible' : 'no disponible'}`;
  $('btnRestore').disabled = !info.catalogBackup;
  $('importStatus').textContent = '';
}

async function withButtonLoading(btn, loadingText, fn) {
  if (!btn || btn.disabled) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = loadingText;
  btn.classList.add('is-loading');
  try {
    return await fn();
  } finally {
    btn.classList.remove('is-loading');
    btn.textContent = original;
    if (!state.readOnly) btn.disabled = false;
  }
}

async function importExcel() {
  const file = $('importFile').files[0];
  const status = $('importStatus');
  if (!file) { status.textContent = 'Seleccione primero un archivo .xlsm o .xlsx.'; $('importFile').focus(); return; }
  if (!/\.(xlsm|xlsx)$/i.test(file.name)) { status.textContent = 'El archivo debe terminar en .xlsm o .xlsx.'; $('importFile').focus(); return; }
  const clear = $('clearQuotes').checked;
  const warning = clear
    ? 'Se reemplazarán operaciones, referencias, parámetros y se eliminarán TODAS las cotizaciones guardadas. ¿Continuar?'
    : 'Se reemplazarán operaciones, referencias y parámetros. Las cotizaciones guardadas se conservarán. ¿Continuar?';
  if (!confirm(warning)) return;

  const btn = $('btnImport');
  await withButtonLoading(btn, 'Procesando...', async () => {
    status.textContent = 'Leyendo archivo en el navegador…';
    try {
      const parsed = await parseCatalogoDesdeExcel(file);
      window.CotizadorStore.setCatalog(parsed);
      if (clear) window.CotizadorStore.setQuotes([]);
      sessionStorage.setItem('cotizadorMsg', `Importación completada: ${parsed.operations.length} operaciones y ${parsed.references.length} referencias.`);
      location.reload();
    } catch (err) {
      status.textContent = 'Error: ' + err.message;
    }
  });
}

function parseCatalogoDesdeExcel(file) {
  return file.arrayBuffer().then((buffer) => {
    const XLSX = window.XLSX;
    if (!XLSX) throw new Error('No se pudo cargar SheetJS.');
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const byName = (name) => {
      const n = name.toLowerCase();
      const real = wb.SheetNames.find((s) => String(s).trim().toLowerCase() === n);
      if (!real) throw new Error('El archivo no contiene la hoja "' + name + '".');
      return wb.Sheets[real];
    };
    const rows = (name, from) => XLSX.utils.sheet_to_json(byName(name), { header: 1, raw: true, defval: null, blankrows: true, range: from || 0 });
    const val = (sheet, r, c) => { const cell = sheet[XLSX.utils.encode_cell({r:r-1,c:c-1})]; return cell ? cell.v : null; };
    const num = (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
      let t = String(v).trim().replace(/[\s\u00a0]/g, ''); if (!t) return null;
      const cma = t.includes(','), dot = t.includes('.');
      if (cma && dot) { if (t.lastIndexOf(',') > t.lastIndexOf('.')) t=t.replace(/\./g,'').replace(/,/g,'.'); else t=t.replace(/,/g,''); }
      else if (cma) t=t.replace(/\./g,'').replace(/,/g,'.');
      else if (dot && /^[+-]?\d{1,3}(\.\d{3})+$/.test(t)) t=t.replace(/\./g,'');
      const n = Number(t.replace(/[^0-9+\-.]/g,'')); return Number.isFinite(n) ? n : null;
    };
    const txt = (v) => v == null ? '' : String(v).trim();
    const pct = (v) => { if (v==null) return null; const t=String(v).trim(); if(!t) return null; const has=t.endsWith('%'); const n=num(has?t.slice(0,-1):t); return n==null?null:(has?n/100:n); };

    const pSheet = byName('Parametros');
    const pKeys = ['supplementPct','costPerMinConf','costPerMinFinish','profitPct','complexityFactor','workDays','hoursPerDay','efficiency'];
    const parameters = {};
    pKeys.forEach((k,i) => { const v = num(val(pSheet, i+2, 2)); if (v !== null) parameters[k] = v; });
    if (!Object.keys(parameters).length) throw new Error('No se encontraron parámetros en la hoja "Parametros".');

    const operations = [];
    for (const fila of rows('Base_operaciones', 6)) {
      if (!fila) continue;
      const name = txt(fila[2]); if (!name) continue;
      operations.push({
        id:txt(fila[0]), block:txt(fila[1]), name, family:txt(fila[3]), component:txt(fila[4]),
        machine:txt(fila[5]), classification:txt(fila[6]), referenceCount:num(fila[7]),
        observationCount:num(fila[8]), minSec:num(fila[9]), p25Sec:num(fila[10]), medianSec:num(fila[11]),
        p75Sec:num(fila[12]), maxSec:num(fila[13]), cv:num(fila[14]), reliability:txt(fila[15]),
        validationPriority:num(fila[16]), validatedSec:num(fila[17]), baseSec:num(fila[18]),
        normalMin:num(fila[19]), samBaseMin:num(fila[20]), historicalSupplement:num(fila[21]),
        nameVariants:num(fila[22]), exampleOriginalName:txt(fila[23])
      });
    }

    const rSheet = byName('BD Referencias');
    const hasMarca = (XLSX.utils.decode_range(rSheet['!ref'] || 'A1:J1').e.c >= 10);
    const references = [];
    rows('BD Referencias', 1).forEach((fila, idx) => {
      if (!fila) return;
      const code = txt(fila[0]); if (!code) return;
      references.push({
        code, description:txt(fila[1]), type:txt(fila[2]), confectionMin:num(fila[3]),
        finishingMin:num(fila[4]), packingMin:num(fila[5]), samTotalMin:num(fila[6]),
        supplementPct:pct(fila[7]), observation:txt(fila[8]), profitPct:pct(fila[9]),
        marca: hasMarca ? txt(val(rSheet, idx+2, 11)) : ''
      });
    });

    if (!operations.length) throw new Error('No se encontraron operaciones en "Base_operaciones".');
    if (!references.length) throw new Error('No se encontraron referencias en "BD Referencias".');

    let goldenCase = null;
    try {
      const cSheet = byName('Cotizador');
      goldenCase = {
        operation: txt(val(cSheet,8,1)), quantity:num(val(cSheet,8,2))||1, adjustedSec:num(val(cSheet,8,3)),
        baseSec:num(val(cSheet,8,4)), normalMin:num(val(cSheet,8,5)), samMin:num(val(cSheet,8,6)),
        cost:num(val(cSheet,8,9)), suggestedPrice:num(val(cSheet,53,2))
      };
      if (!goldenCase.operation) goldenCase = null;
    } catch (_) {}

    return {
      meta: { sourceFile: file.name, exportedAt: new Date().toISOString(), operationCount: operations.length, referenceCount: references.length },
      parameters, operations, references, goldenCase
    };
  });
}

async function clearData() {
  const clear = $('clearQuotes').checked;
  const ops = state.catalog ? state.catalog.operations.length : 0;
  const refs = state.catalog ? state.catalog.references.length : 0;
  const first = confirm(
    'Esto NO reinicia la aplicación: borra el catálogo de trabajo.\n\n' +
    `Se eliminarán ${ops} operaciones y ${refs} referencias` +
    (clear ? ' y TODAS las cotizaciones guardadas' : ' (las cotizaciones guardadas se conservan)') +
    '.\n\nAntes de borrar se guarda una copia de seguridad para poder restaurar.\n\n¿Continuar?'
  );
  if (!first) return;
  const word = prompt('Para confirmar, escriba BORRAR (en mayúsculas):');
  if (word === null) return;
  if (word.trim().toUpperCase() !== 'BORRAR') {
    $('importStatus').textContent = 'Cancelado: no se escribió BORRAR. No se borró nada.';
    return;
  }
  try {
    await api('/api/import/clear', {
      method: 'POST',
      body: JSON.stringify({ clearQuotes: clear })
    });
    sessionStorage.setItem('cotizadorMsg', 'Datos limpiados. Puede importar otro Excel o restaurar la copia anterior.');
    location.reload();
  } catch (err) { $('importStatus').textContent = 'Error: ' + err.message; }
}

async function restoreData() {
  if (!confirm('¿Restaurar la copia anterior? Los datos actuales se guardarán como respaldo antes de restaurar.')) return;
  try {
    const result = await api('/api/import/restore', { method: 'POST' });
    sessionStorage.setItem('cotizadorMsg', `Copia restaurada: ${result.operations} operaciones y ${result.references} referencias.`);
    location.reload();
  } catch (err) { $('importStatus').textContent = 'Error: ' + err.message; }
}

async function loadBackupStatus() {
  renderBackupStatus();
}

function renderBackupStatus() {
  const q = (window.CotizadorStore.quotes || []).length;
  const r = (window.CotizadorStore.refs || []).length;
  const ops = (window.CotizadorStore.catalog?.operations || []).length;
  const remote = window.CotizadorStore.getRemoteStatus ? window.CotizadorStore.getRemoteStatus() : { enabled: false };
  const syncMsg = remote.enabled
    ? `<span style="color:var(--ok)">Nube Supabase activa: el historial se comparte entre dispositivos.</span>${remote.lastSyncAt ? '<br><strong>Última sync:</strong> ' + escapeHtml(new Date(remote.lastSyncAt).toLocaleString('es-CO')) : ''}${remote.lastError ? '<br><span style="color:var(--danger)">Error sync: ' + escapeHtml(remote.lastError) + '</span>' : ''}`
    : `<span style="color:#a03">Nube no configurada: el historial solo está en este navegador.</span> Configure Supabase en <code>supabase-config.js</code> para guardado compartido.`;
  $('backupCurrent').innerHTML =
    `<strong>Datos actuales:</strong> ${q} cotizaciones · ${r} referencias · ${ops} operaciones.<br>` +
    syncMsg +
    `<br><strong>Respaldo extra:</strong> descargue una copia JSON y guárdela en Drive/otra PC.`;
  $('backupList').innerHTML = remote.enabled
    ? '<div>Guardado compartido activo. La copia JSON sigue siendo útil como respaldo manual.</div>'
    : '<div>Modo local: use “Descargar copia actual” para mover el historial entre dispositivos.</div>';
}

async function createBackup() {
  downloadBackup();
}

function downloadBackup() {
  try {
    const store = window.CotizadorStore;
    const payload = store.exportBackup();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '_');
    const fileName = `cotizador_backup_${stamp}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    $('backupStatus').textContent = `Copia descargada: ${fileName} (${payload.quotes.length} cotizaciones). Guárdala en Drive/pendrive/otra PC.`;
    toast('Copia de respaldo descargada');
    loadBackupStatus();
  } catch (err) {
    $('backupStatus').textContent = 'Error al descargar copia: ' + err.message;
  }
}

async function readBackupFile() {
  const file = $('verifyBackupFile').files[0];
  if (!file) {
    $('backupStatus').textContent = 'Seleccione primero un archivo de copia .json.';
    return null;
  }
  try {
    return JSON.parse(await file.text());
  } catch (_) {
    $('backupStatus').textContent = 'El archivo seleccionado no es un JSON válido.';
    return null;
  }
}

async function verifyBackupFile() {
  const payload = await readBackupFile();
  if (!payload) return;
  $('backupStatus').textContent = 'Probando la copia seleccionada…';
  try {
    const result = window.CotizadorStore.validateBackup(payload);
    $('backupStatus').textContent =
      `Copia válida: ${result.operations} operaciones, ${result.references} referencias y ${result.quotes} cotizaciones. ` +
      'Los datos actuales no se modificaron.';
  } catch (err) {
    $('backupStatus').textContent = 'La copia NO se puede restaurar: ' + err.message;
  }
}

async function restoreBackupFile() {
  const payload = await readBackupFile();
  if (!payload) return;
  if (!confirm('Esto REEMPLAZA el catálogo, los parámetros, referencias y cotizaciones actuales con la copia elegida. ¿Continuar?')) return;
  const word = prompt('Para confirmar, escriba RESTAURAR (en mayúsculas):');
  if (word === null) return;
  if (word.trim().toUpperCase() !== 'RESTAURAR') {
    $('backupStatus').textContent = 'Cancelado: no se escribió RESTAURAR. No se cambió nada.';
    return;
  }
  try {
    const result = window.CotizadorStore.importBackup(payload);
    sessionStorage.setItem('cotizadorMsg', `Copia restaurada: ${result.operations} operaciones, ${result.references} referencias y ${result.quotes} cotizaciones.`);
    location.reload();
  } catch (err) { $('backupStatus').textContent = 'Error: ' + err.message; }
}

function mailStatus(message, isError) {
  const box = $('mailStatus');
  box.textContent = message || '';
  box.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function renderMailSummary() {
  const s = state.mailSummary;
  if (!s) { $('mailPreview').textContent = ''; return; }
  const typeRows = (s.byType || []).map((t) => `
    <tr>
      <td>${escapeHtml(t.type)}</td>
      <td class="num">${t.count}</td>
      <td class="num">${money(t.totalPrice)}</td>
    </tr>`).join('');
  const brandRows = (s.byBrand || []).map((b) => `
    <tr>
      <td>${escapeHtml(b.brand)}</td>
      <td class="num">${b.count}</td>
      <td class="num">${money(b.totalPrice)}</td>
    </tr>`).join('');
  $('mailPreview').innerHTML = `
    <strong>Vista previa del resumen incluido en el correo</strong>
    <div class="kpis" style="margin-top:10px">
      <div class="kpi"><span>Cotizaciones</span><strong>${fmt(s.count, 0)}</strong></div>
      <div class="kpi"><span>SAM total</span><strong>${fmt(s.totalSam, 3)} min</strong></div>
      <div class="kpi"><span>Costo total</span><strong>${money(s.totalCost)}</strong></div>
      <div class="kpi highlight"><span>Precio sugerido</span><strong>${money(s.totalPrice)}</strong></div>
    </div>
    <p class="hint">Período: ${escapeHtml(s.from)} al ${escapeHtml(s.to)} · Precio sugerido promedio: ${money(s.avgPrice)} · ${fmt(s.detailRows.length, 0)} operaciones en el detalle.</p>
    <table style="max-width:520px;margin-top:10px">
      <thead><tr><th>Tipo de prenda</th><th class="num">Cantidad</th><th class="num">Precio sugerido</th></tr></thead>
      <tbody>${typeRows || '<tr><td colspan="3" style="color:var(--muted)">Sin cotizaciones registradas</td></tr>'}</tbody>
    </table>
    <table style="max-width:520px;margin-top:10px">
      <thead><tr><th>Marca</th><th class="num">Cantidad</th><th class="num">Precio sugerido</th></tr></thead>
      <tbody>${brandRows || '<tr><td colspan="3" style="color:var(--muted)">Sin marcas registradas</td></tr>'}</tbody>
    </table>`;
}

function triggerDownload(url, fileName) {
  const a = document.createElement('a');
  a.href = url;
  if (fileName) a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// En modo estático el Excel se genera y descarga con SheetJS en el navegador.
async function downloadExcelFile(fileName) {
  return fileName;
}

async function downloadHistoryExcel() {
  if (!getSelectedIds().length) {
    mailStatus('Seleccione al menos una cotización en el historial.', true);
    return;
  }
  const btn = $('btnMailExcel');
  await withButtonLoading(btn, 'Procesando...', async () => {
    mailStatus('Generando Excel de las cotizaciones seleccionadas…');
    try {
      const result = await generateLocalExcel(getSelectedIds());
      mailStatus(`Excel generado: ${result.fileName} (${result.count} cotizaciones).`);
    } catch (err) {
      mailStatus('Error: ' + err.message, true);
    }
  });
}

async function previewMailJs() {
  if (!getSelectedIds().length) {
    mailStatus('Seleccione al menos una cotización en el historial.', true);
    return;
  }
  mailStatus('Generando vista previa y subiendo Excel (si hay almacenamiento configurado)…');
  try {
    const result = await buildLocalEmailPreview(getSelectedIds(), { download: false, upload: true });
    const subject = $('mailSubject').value.trim() || 'Cotizaciones seleccionadas';
    const label = result.count === 1 ? 'cotización' : 'cotizaciones';
    const linkText = result.downloadUrl
      ? `<a href="${escapeHtml(result.downloadUrl)}" target="_blank" rel="noopener">Abrir enlace de descarga</a>`
      : '<span style="color:#a03">Sin enlace público. Configure Supabase/Firebase Storage o adjunte el Excel manualmente.</span>';
    $('mailPreview').innerHTML =
      '<strong>Vista previa del correo EmailJS</strong>' +
      '<p class="hint">Asunto: ' + escapeHtml(subject) + ' · ' + fmt(result.count, 0) + ' ' + label + '</p>' +
      '<p class="hint">Excel: ' + escapeHtml(result.fileName) + '</p>' +
      '<p class="hint">Enlace: ' + linkText + '</p>' +
      (result.uploadWarning ? '<p class="hint" style="color:#a03">' + escapeHtml(result.uploadWarning) + '</p>' : '') +
      '<div style="border:1px solid var(--line);border-radius:8px;padding:12px;max-height:260px;overflow:auto;background:#fff">' +
      result.message + '</div>';
    mailStatus(result.downloadUrl ? 'Vista previa lista con enlace de descarga.' : 'Vista previa lista, pero sin enlace público.');
  } catch (err) {
    mailStatus('Error: ' + err.message, true);
  }
}

async function sendMailJs() {
  const to = sanitizeEmail($('mailJsTo').value);
  $('mailJsTo').value = to;
  if (!to) {
    mailStatus('Escribe el correo de destino.', true);
    $('mailJsTo').focus();
    return;
  }
  if (!isValidEmail(to)) {
    mailStatus('Correo de destino inválido. Usa un solo correo, sin espacios ni comas (ej: nombre@empresa.com).', true);
    $('mailJsTo').focus();
    return;
  }
  const ids = getSelectedIds();
  if (!ids.length) {
    mailStatus('Seleccione al menos una cotización en el historial antes de enviar.', true);
    return;
  }
  const subject = $('mailSubject').value.trim() || 'Cotizaciones seleccionadas';
  const count = ids.length;
  if (!confirm(`Se enviarán ${count} cotizaciones seleccionadas por correo a:\n${to}\n\nEl Excel se descargará localmente y, si hay almacenamiento configurado, el correo incluirá enlace de descarga.\n\n¿Continuar?`)) return;

  const btn = $('btnSendMailJs');
  await withButtonLoading(btn, 'Procesando...', async () => {
    mailStatus('Generando Excel, subiendo archivo y enviando por EmailJS…');
    let preview = null;
    try {
      preview = await buildLocalEmailPreview(getSelectedIds(), { download: true, upload: true });
    } catch (err) {
      mailStatus('No se pudo generar el Excel para el correo: ' + err.message, true);
      return;
    }

    const reportHtml = preview.message;
    try {
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: EMAILJS_SERVICE_ID,
          template_id: EMAILJS_TEMPLATE_ID,
          user_id: EMAILJS_PUBLIC_KEY,
          template_params: {
            to_email: to,
            to_name: '',
            subject: subject,
            cotizador_subject: subject,
            report_html: reportHtml,
            observations: preview.uploadWarning || '',
            download_url: preview.downloadUrl || '',
            file_name: preview.fileName,
            from_name: 'Cotizador de Muestras',
            reply_to: 'facturacion@crearte-sas.com'
          }
        })
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error('EmailJS respondió ' + response.status + ': ' + text.trim());
      }
      const linkMsg = preview.downloadUrl ? ' con enlace de descarga' : ' sin enlace público (almacenamiento no configurado o subida fallida)';
      mailStatus(`Correo enviado a ${to}${linkMsg}. Excel: ${preview.fileName}.` + (preview.uploadWarning ? ' Aviso: ' + preview.uploadWarning : ''));
      toast('Correo enviado por EmailJS');
    } catch (err) {
      mailStatus('No se pudo enviar el correo por EmailJS: ' + err.message + '. El Excel "' + preview.fileName + '" se descargó en este equipo.', true);
    }
  });
}

async function loadMailData() {
  try {
    state.mailSummary = await api('/api/email/summary', { method: 'POST', body: selectedPayload() });
    if (!$('mailSubject').value) $('mailSubject').value = 'Cotizaciones seleccionadas';
    renderMailSummary();
  } catch (err) {
    mailStatus('No se pudo cargar el resumen de las cotizaciones seleccionadas: ' + err.message, true);
  }
}

async function loadQuote(id) {
  try {
    const q = await api('/api/quotes/' + encodeURIComponent(id));
    $('refCode').value = q.reference || '';
    $('refDesc').value = q.description || '';
    $('refBrand').value = q.marca || '';
    $('refType').value = q.type || '';
    state.lines = q.result.lines.map((l) => ({
      operation: l.operation,
      quantity: l.quantity,
      adjustedSec: l.adjustedSec == null ? '' : l.adjustedSec
    }));
    recalculateLocal();
    switchTab('cotizar');
    toast('Cotización cargada');
  } catch (err) { toast(err.message); }
}

async function deleteQuote(id) {
  if (!confirm('¿Eliminar esta cotización guardada?')) return;
  try {
    await api('/api/quotes/' + encodeURIComponent(id), { method: 'DELETE' });
    state.quotes = state.quotes.filter((q) => q.id !== id);
    state.selectedQuoteIds.delete(id);
    renderHistory();
    loadMailData();
    toast('Cotización eliminada');
  } catch (err) { toast(err.message); }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'tab-' + name));
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  $('btnAdd').addEventListener('click', () => { state.lines.push(newLine()); recalculateLocal(); });
  $('btnClear').addEventListener('click', () => {
    if (!confirm('¿Limpiar la cotización actual?')) return;
    state.lines = [newLine()];
    $('refCode').value = ''; $('refDesc').value = ''; $('refBrand').value = ''; $('refType').value = '';
    recalculateLocal();
  });

  $('opsBody').addEventListener('input', (event) => {
    const idx = Number(event.target.dataset.idx);
    const field = event.target.dataset.field;
    if (!field || Number.isNaN(idx) || field === 'operation') return;
    state.lines[idx][field] = event.target.value;
    recalculateLocal(true);
  });
  $('opsBody').addEventListener('click', (event) => {
    const idx = event.target.dataset.remove;
    if (idx == null) return;
    state.lines.splice(Number(idx), 1);
    if (state.lines.length === 0) state.lines.push(newLine());
    recalculateLocal();
  });

  $('opsBody').addEventListener('focusin', (event) => {
    if (event.target.classList.contains('op-search')) openOperationMenu(event.target);
  });
  $('opsBody').addEventListener('input', (event) => {
    if (event.target.classList.contains('op-search') && !$('operationMenu').hidden) {
      renderOperationOptions(event.target.value);
    }
  });
  $('opsBody').addEventListener('keydown', handleOperationKeydown);
  $('opsBody').addEventListener('focusout', (event) => {
    if (!event.target.classList.contains('op-search')) return;
    const related = event.relatedTarget;
    if (related && related.closest && related.closest('#operationMenu')) return;
    setTimeout(() => {
      if (activeComboInput === event.target) commitOperationInput(event.target);
    }, 0);
  });

  $('operationMenu').addEventListener('mousedown', (event) => {
    const option = event.target.closest('.op-option');
    if (!option) return;
    event.preventDefault();
    selectOperation(option.dataset.op);
  });
  $('operationMenu').addEventListener('mousemove', (event) => {
    const option = event.target.closest('.op-option');
    if (!option) return;
    const options = [...$('operationMenu').querySelectorAll('.op-option')];
    setActiveOption(options.indexOf(option));
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('.op-combo') || event.target.closest('#operationMenu')) return;
    closeOperationMenu();
  });
  window.addEventListener('scroll', () => {
    if (activeComboInput && !$('operationMenu').hidden) positionOperationMenu(activeComboInput);
  }, true);
  window.addEventListener('resize', () => {
    if (activeComboInput && !$('operationMenu').hidden) positionOperationMenu(activeComboInput);
  });

  ['refCode', 'refDesc', 'refBrand', 'refType'].forEach((id) => $(id).addEventListener('input', recalculateLocal));

  $('refCode').addEventListener('change', () => {
    const code = $('refCode').value.trim();
    const ref = state.refs.find((r) => String(r.code) === code);
    if (!ref) return;
    $('refDesc').value = ref.description || '';
    $('refBrand').value = ref.marca || '';
    $('refType').value = ref.type || '';
    recalculateLocal();
  });

  $('btnCalculate').addEventListener('click', async () => {
    try {
      const result = await api('/api/calculate', {
        method: 'POST',
        body: JSON.stringify({ lines: state.lines, reference: $('refCode').value.trim() })
      });
      state.result = result;
      renderTotals();
      toast('Cálculo verificado por el servidor (' + result.totals.operaciones + ' operaciones)');
    } catch (err) { showError(err.message); }
  });

  function validateBeforeSave() {
    const checks = [
      { id: 'refCode', value: $('refCode').value.trim(), msg: 'Ingrese el código de referencia antes de guardar.' },
      { id: 'refDesc', value: $('refDesc').value.trim(), msg: 'Ingrese la descripción de la referencia antes de guardar.' },
      { id: 'refType', value: $('refType').value, msg: 'Seleccione el tipo de prenda antes de guardar.' }
    ];
    for (const check of checks) {
      if (!check.value) {
        showError(check.msg);
        switchTab('cotizar');
        const el = $(check.id);
        if (el) { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        return false;
      }
    }
    const hasValidOperation = state.lines.some((line) => {
      const name = String(line.operation || '').trim();
      if (!name) return false;
      try { return !!engine.calculateLine(line, state.params, state.catalog.operations); } catch (_) { return false; }
    });
    if (!hasValidOperation) {
      showError('Agregue al menos una operación válida antes de guardar la cotización.');
      switchTab('cotizar');
      const firstOp = document.querySelector('#opsBody .op-search');
      if (firstOp) { firstOp.focus(); firstOp.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return false;
    }
    return true;
  }

  $('btnSave').addEventListener('click', async () => {
    if (!validateBeforeSave()) return;
    const btn = $('btnSave');
    await withButtonLoading(btn, 'Procesando...', async () => {
      try {
        const saved = await api('/api/quotes', {
          method: 'POST',
          body: JSON.stringify({
            reference: $('refCode').value.trim(),
            description: $('refDesc').value.trim(),
            type: $('refType').value,
            marca: $('refBrand').value.trim(),
            lines: state.lines
          })
        });
        state.quotes.unshift({
          id: saved.id, createdAt: saved.createdAt, reference: saved.reference,
          description: saved.description, type: saved.type, marca: saved.marca,
          totalSam: saved.result.totals.samTotal,
          totalCost: saved.result.totals.costoTransformacion,
          suggestedPrice: saved.result.totals.precioSugerido,
          lines: saved.result.lines.length
        });
        state.selectedQuoteIds.add(saved.id);
        renderHistory();
        loadMailData();
        showError('');
        toast('Cotización guardada y seleccionada: ' + saved.reference);
      } catch (err) { showError(err.message); }
    });
  });

  $('btnReloadHistory').addEventListener('click', async () => {
    const data = await api('/api/bootstrap');
    state.quotes = data.quotes;
    pruneSelection();
    renderHistory();
    loadMailData();
  });

  $('historyBody').addEventListener('click', (event) => {
    if (event.target.dataset.load) loadQuote(event.target.dataset.load);
    if (event.target.dataset.delete) deleteQuote(event.target.dataset.delete);
  });

  $('historyBody').addEventListener('change', (event) => {
    const id = event.target.dataset.select;
    if (id == null) return;
    if (event.target.checked) state.selectedQuoteIds.add(id);
    else state.selectedQuoteIds.delete(id);
    updateSelectionUI();
    loadMailData();
  });

  $('selectAllQuotes').addEventListener('change', (event) => {
    if (event.target.checked) state.quotes.forEach((q) => state.selectedQuoteIds.add(q.id));
    else state.selectedQuoteIds.clear();
    renderHistory();
    loadMailData();
  });

  $('refSearch').addEventListener('input', (event) => renderReferences(event.target.value));

  $('refsBody').addEventListener('change', async (event) => {
    const input = event.target;
    if (!input.classList.contains('ref-brand')) return;
    const code = input.dataset.code;
    const marca = input.value.trim();
    try {
      await api('/api/references/' + encodeURIComponent(code), {
        method: 'PUT',
        body: JSON.stringify({ marca: marca })
      });
      const ref = state.refs.find((r) => String(r.code) === code);
      if (ref) ref.marca = marca;
      toast('Marca guardada en la referencia ' + code);
    } catch (err) {
      toast(err.message);
    }
  });

  $('btnSaveParams').addEventListener('click', async () => {
    const payload = {};
    document.querySelectorAll('[data-param]').forEach((input) => {
      const key = input.dataset.param;
      const def = PARAM_DEFS.find((d) => d.key === key);
      const n = input.value === '' ? null : Number(input.value);
      if (n == null) { payload[key] = null; return; }
      payload[key] = def && def.pct ? n / 100 : n;
    });
    try {
      state.params = await api('/api/parameters', { method: 'PUT', body: JSON.stringify(payload) });
      renderParams();
      recalculateLocal();
      toast('Parámetros actualizados');
    } catch (err) { toast(err.message); }
  });

  $('btnImport').addEventListener('click', importExcel);
  $('btnClearData').addEventListener('click', clearData);
  $('btnRestore').addEventListener('click', restoreData);
  $('btnDownloadBackup').addEventListener('click', downloadBackup);
  $('btnCreateBackup').addEventListener('click', createBackup);
  $('btnVerifyBackup').addEventListener('click', verifyBackupFile);
  $('btnRestoreBackup').addEventListener('click', restoreBackupFile);

  $('btnMailExcel').addEventListener('click', downloadHistoryExcel);
  $('btnMailJsPreview').addEventListener('click', previewMailJs);
  $('btnSendMailJs').addEventListener('click', sendMailJs);
  $('btnHistoryMail').addEventListener('click', () => switchTab('correo'));
  $('btnSelectAllMail').addEventListener('click', () => {
    state.quotes.forEach((q) => state.selectedQuoteIds.add(q.id));
    renderHistory();
    loadMailData();
  });
  $('btnClearSelectionMail').addEventListener('click', () => {
    state.selectedQuoteIds.clear();
    renderHistory();
    loadMailData();
  });
}

async function init() {
  try {
    const data = await window.CotizadorStore.init();
    state.catalog = data;
    state.params = data.parameters;
    state.quotes = data.quotes;
    state.refs = data.references;
    state.importInfo = data.importInfo || null;
    state.adminTokenRequired = false;
    state.readOnly = false;
    if ($('appVersion')) $('appVersion').textContent = '3.0 estático';
    pruneSelection();

    state.operationOptions = data.operations || [];
    const types = Array.from(new Set(data.references.map((r) => r.type).filter(Boolean))).sort();
    $('refType').innerHTML = '<option value="">Seleccione…</option>' +
      types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

    renderParams();
    renderReferences('');
    renderHistory();
    renderImportInfo(data);
    renderBackupStatus({ backups: [], retention: 0, disk: { available: false }, drill: { ok: true, problems: [] } });
    if (data.warning) showError(data.warning);
    if (state.readOnly) {
      ['btnSave', 'btnSaveParams', 'btnImport', 'btnClearData', 'btnRestore', 'btnCreateBackup', 'btnRestoreBackup'].forEach((id) => {
        const button = $(id);
        if (button) button.disabled = true;
      });
      showError('Modo solo lectura: se puede consultar y calcular, pero no guardar cambios.');
    }

    const pending = sessionStorage.getItem('cotizadorMsg');
    if (pending) { sessionStorage.removeItem('cotizadorMsg'); toast(pending); }
    const rs = window.CotizadorStore.getRemoteStatus ? window.CotizadorStore.getRemoteStatus() : null;
    if (rs && rs.enabled) toast('Historial sincronizado con la nube');
    else toast('Historial local: configura Supabase para guardarlo en cualquier dispositivo');

    state.lines = [newLine()];
    recalculateLocal();
    bindEvents();
    loadMailData();
  } catch (err) {
    showError('No se pudo iniciar la aplicación: ' + err.message);
  }
}

init();
