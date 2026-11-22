(() => {
const SUPABASE_URL = 'https://wfmhycutelkdcjgmdzno.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7_0wGgZdpUCmyy17AnyHog_sJbWisHV'; // publishable key: safe in the browser, data is protected by row level security
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CATS = [
  { id: 'tramite', label: 'Trámite' },
  { id: 'compra', label: 'Compra' },
  { id: 'reserva', label: 'Reserva' },
  { id: 'llamada', label: 'Llamada' },
  { id: 'dinero', label: 'Dinero' },
  { id: 'otro', label: 'Otro' },
];
const catLabel = id => (CATS.find(c => c.id === id) || CATS[5]).label;
const $ = id => document.getElementById(id);
const fmtPEN = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const fmtUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','set','oct','nov','dic'];

let user = null, plans = [], planId = null, tasks = [], filter = 'pend';
let subs = {};            // task id -> list of subtasks
const open = new Set();   // tasks whose checklist is expanded
try { JSON.parse(localStorage.getItem('openLists') || '[]').forEach(id => open.add(id)); } catch {}
const saveOpen = () => { try { localStorage.setItem('openLists', JSON.stringify([...open])); } catch {} };
const fromSub = r => ({ id: r.id, taskId: r.task_id, title: r.title, amount: r.amount ?? '', done: r.done });

// Money for one task. With priced checklist items: budget = task amount (or the sum of the items), spent = checked items.
function money(t) {
  const list = subs[t.id] || [];
  const priced = list.filter(x => num(x.amount));
  const itemsTotal = priced.reduce((a, x) => a + num(x.amount), 0);
  const spent = priced.filter(x => x.done).reduce((a, x) => a + num(x.amount), 0);
  const budget = num(t.amount) || itemsTotal;
  return { budget, spent, hasPriced: priced.length > 0, count: list.length, doneCount: list.filter(x => x.done).length };
}

// ---------- mapping between database rows and app objects ----------
const fromPlan = r => ({ id: r.id, name: r.name, date: r.date || '', rate: r.rate, savedPEN: r.saved_pen, savedUSD: r.saved_usd, createdAt: r.created_at });
const fromTask = r => ({ id: r.id, title: r.title, category: r.category, idealDate: r.ideal_date || '', deadline: r.deadline || '', amount: r.amount ?? '', currency: r.currency, notes: r.notes || '', done: r.done });
const toTask = t => ({ title: t.title, category: t.category, ideal_date: t.idealDate || null, deadline: t.deadline || null, amount: t.amount === '' || t.amount == null ? null : num(t.amount), currency: t.currency, notes: t.notes || '', done: !!t.done, updated_at: new Date().toISOString() });

// ---------- dates ----------
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function parse(s) { const [y,m,d] = s.split('-').map(Number); return Date.UTC(y, m-1, d); }
function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
function fmtDate(s) { if (!s) return ''; const [, m, d] = s.split('-').map(Number); return d + ' ' + MONTHS[m-1]; }
function addDays(s, n) { return new Date(parse(s) + n*864e5).toISOString().slice(0,10); }
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };

function status(t) {
  if (t.done) return { cls: 'ok', text: 'Hecho', rank: 9 };
  const today = todayStr();
  if (t.deadline) {
    const left = diffDays(today, t.deadline);
    if (left < 0) return { cls: 'bad', text: 'Se pasó la fecha límite. ¡Fue!', rank: 0 };
    if (left === 0) return { cls: 'bad', text: 'Hoy es el último día', rank: 1 };
    if (left <= 3) return { cls: 'warn', text: 'Quedan ' + left + (left === 1 ? ' día' : ' días') + ' antes del límite', rank: 2 };
  }
  if (t.idealDate && diffDays(today, t.idealDate) < 0) return { cls: 'warn', text: 'Atrasada (la fecha ideal ya pasó)', rank: 3 };
  if (t.idealDate && diffDays(today, t.idealDate) === 0) return { cls: 'warn', text: 'Toca hacerlo hoy', rank: 3 };
  return { cls: '', text: '', rank: 5 };
}

// ---------- render ----------
const plan = () => plans.find(p => p.id === planId);

function renderPlans() {
  const sel = $('planSel');
  sel.replaceChildren(...plans.map(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name || 'Sin nombre'; return o; }));
  if (planId) sel.value = planId;
}

function renderHeader() {
  const p = plan();
  if (!p) { $('planName').textContent = 'Crea tu primera actividad'; $('planDate').textContent = 'Toca “+ Actividad” arriba para empezar.'; $('days').textContent = '–'; return; }
  $('planName').textContent = p.name || 'Sin nombre';
  if (p.date) {
    const left = diffDays(todayStr(), p.date);
    $('planDate').textContent = 'Fecha: ' + fmtDate(p.date) + ' ' + p.date.slice(0,4);
    $('days').textContent = Math.max(left, 0);
    $('daysLbl').textContent = left === 1 ? 'día' : left <= 0 ? '¡es hoy o ya pasó!' : 'días';
  } else { $('planDate').textContent = 'Sin fecha'; $('days').textContent = '–'; }
  if (document.activeElement !== $('savedPEN')) $('savedPEN').value = num(p.savedPEN) || '';
  if (document.activeElement !== $('savedUSD')) $('savedUSD').value = num(p.savedUSD) || '';
  if (document.activeElement !== $('rate')) $('rate').value = num(p.rate) || '';
}

function renderBudget() {
  const p = plan() || {};
  let needPEN = 0, needUSD = 0, paidPEN = 0, paidUSD = 0;
  for (const t of tasks) {
    const m = money(t), usd = t.currency === 'USD';
    let paid, need;
    if (m.hasPriced) { paid = m.spent; need = t.done ? 0 : Math.max(m.budget - m.spent, 0); }
    else { paid = t.done ? m.budget : 0; need = t.done ? 0 : m.budget; }
    if (usd) { paidUSD += paid; needUSD += need; } else { paidPEN += paid; needPEN += need; }
  }
  const gPEN = needPEN - num(p.savedPEN), gUSD = needUSD - num(p.savedUSD);
  $('needPEN').textContent = fmtPEN.format(needPEN); $('needUSD').textContent = fmtUSD.format(needUSD);
  $('paidPEN').textContent = fmtPEN.format(paidPEN); $('paidUSD').textContent = fmtUSD.format(paidUSD);
  const setGap = (el, g, f) => { el.textContent = g > 0 ? f.format(g) : (g < 0 ? 'Te sobra ' + f.format(-g) : f.format(0)); el.className = 'r falta ' + (g > 0 ? 'bad' : 'good'); };
  setGap($('gapPEN'), gPEN, fmtPEN); setGap($('gapUSD'), gUSD, fmtUSD);
  const rate = num(p.rate);
  if (rate > 0) {
    const total = gPEN + gUSD * rate;
    const s = document.createElement('span');
    s.append(total > 0 ? 'Todo junto, te falta ' : 'Todo junto, te sobra ');
    const b = document.createElement('strong'); b.textContent = fmtPEN.format(Math.abs(total)) + ' ≈ ' + fmtUSD.format(Math.abs(total) / rate);
    s.append(b); $('combined').replaceChildren(s);
  } else $('combined').textContent = 'Pon el tipo de cambio para ver todo junto en soles.';
}

function renderAlerts() {
  const host = $('alerts'); host.replaceChildren();
  const urgent = tasks.map(t => [t, status(t)]).filter(([, s]) => s.rank <= 2).sort((a, b) => a[1].rank - b[1].rank).slice(0, 4);
  for (const [t, s] of urgent) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'alert ' + s.cls;
    const strong = document.createElement('b'); strong.textContent = t.title;
    b.append(strong, ' · ' + s.text); b.onclick = () => openTask(t);
    host.append(b);
  }
}

function renderFilters() {
  const opts = [['pend', 'Pendientes'], ['all', 'Todas'], ['done', 'Hechas'], ...CATS.map(c => [c.id, c.label])];
  $('filters').replaceChildren(...opts.map(([id, label]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (CATS.some(c => c.id === id) ? ' c-' + id : ''); b.textContent = label;
    b.setAttribute('aria-pressed', String(filter === id));
    b.onclick = () => { filter = id; try { localStorage.setItem('filter', id); } catch {} renderFilters(); renderList(); };
    return b;
  }));
}

function gcalUrl(t) {
  const day = t.idealDate || t.deadline; if (!day) return null;
  const d1 = day.replace(/-/g, ''), d2 = addDays(day, 1).replace(/-/g, '');
  let details = '';
  if (t.deadline) details += 'Fecha límite: ' + fmtDate(t.deadline) + '\n';
  if (num(t.amount)) details += 'Presupuesto: ' + (t.currency === 'USD' ? fmtUSD : fmtPEN).format(num(t.amount)) + '\n';
  if (t.notes) details += t.notes;
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(t.title) + '&dates=' + d1 + '/' + d2 + '&details=' + encodeURIComponent(details);
}

function renderList() {
  const host = $('list');
  if (!plan()) { host.replaceChildren(); return; }
  let rows = tasks.slice();
  if (filter === 'pend') rows = rows.filter(t => !t.done);
  else if (filter === 'done') rows = rows.filter(t => t.done);
  else if (filter !== 'all') rows = rows.filter(t => t.category === filter);
  rows.sort((a, b) => (a.done - b.done) || ((a.deadline || a.idealDate || '9999') < (b.deadline || b.idealDate || '9999') ? -1 : 1));
  if (!rows.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.textContent = tasks.length ? 'No hay tareas en este filtro.' : 'Todavía no hay tareas. Toca “+ Agregar tarea” para anotar la primera.';
    host.replaceChildren(e); return;
  }
  host.replaceChildren(...rows.map(t => {
    const s = status(t);
    const el = document.createElement('article'); el.className = 'task c-' + (CATS.some(c => c.id === t.category) ? t.category : 'otro') + (t.done ? ' done' : '');
    const ck = document.createElement('button'); ck.type = 'button'; ck.className = 'check'; ck.setAttribute('aria-label', t.done ? 'Marcar como pendiente' : 'Marcar como hecha');
    ck.textContent = t.done ? '✓' : ''; ck.onclick = () => saveTask({ ...t, done: !t.done });
    const body = document.createElement('button'); body.type = 'button'; body.className = 'body'; body.onclick = () => openTask(t);
    const cat = document.createElement('div'); cat.className = 'cat'; cat.textContent = catLabel(t.category);
    const ttl = document.createElement('div'); ttl.className = 'ttl'; ttl.textContent = t.title;
    const meta = document.createElement('div'); meta.className = 'meta';
    if (t.idealDate) { const m = document.createElement('span'); m.textContent = 'Ideal: ' + fmtDate(t.idealDate); meta.append(m); }
    if (t.deadline) { const m = document.createElement('span'); m.textContent = 'Límite: ' + fmtDate(t.deadline); meta.append(m); }
    if (t.notes) { const m = document.createElement('span'); m.textContent = t.notes.length > 50 ? t.notes.slice(0, 50) + '…' : t.notes; meta.append(m); }
    body.append(cat, ttl, meta);
    const amt = document.createElement('div'); amt.className = 'amt num';
    const m = money(t), f = t.currency === 'USD' ? fmtUSD : fmtPEN;
    if (m.hasPriced) { amt.textContent = f.format(m.spent); amt.append(mk('small', { textContent: 'gastado de ' + f.format(m.budget) })); if (num(t.amount) && m.spent > num(t.amount)) amt.classList.add('over'); }
    else amt.textContent = m.budget ? f.format(m.budget) : '';
    el.append(ck, body, amt);
    el.append(checklist(t, m));
    if (s.text && !t.done) { const p = document.createElement('span'); p.className = 'pill ' + s.cls; p.textContent = s.text; el.append(p); }
    const g = !t.done && gcalUrl(t);
    if (g) { const a = document.createElement('a'); a.className = 'gcal'; a.href = g; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Añadir a Google Calendar'; el.append(a); }
    return el;
  }));
}

function renderCharts() {
  const p = plan() || {}, rate = num(p.rate);
  let needPEN = 0, needUSD = 0;
  const byCat = {};
  for (const t of tasks) {
    const m = money(t), a = m.budget; if (!a) continue;
    const usd = t.currency === 'USD';
    const need = t.done ? 0 : (m.hasPriced ? Math.max(a - m.spent, 0) : a);
    usd ? needUSD += need : needPEN += need;
    const inPEN = usd ? a * rate : a;
    byCat[t.category] = (byCat[t.category] || 0) + inPEN;
  }
  const sPEN = num(p.savedPEN), sUSD = num(p.savedUSD);
  const rows = [
    { label: 'Soles', saved: sPEN, need: needPEN, f: fmtPEN, cls: 'save' },
    { label: 'Dólares', saved: sUSD, need: needUSD, f: fmtUSD, cls: 'save' },
  ];
  if (rate > 0) rows.push({ label: 'Todo junto (en soles)', saved: sPEN + sUSD * rate, need: needPEN + needUSD * rate, f: fmtPEN, cls: 'total' });
  const goal = $('goalBars');
  if (!needPEN && !needUSD && !sPEN && !sUSD) {
    goal.replaceChildren(mk('div', { className: 'chart-empty', textContent: 'Pon montos en tus tareas y lo que tienes ahorrado para ver cuánto te falta.' }));
  } else {
    goal.replaceChildren(...rows.filter(r => r.need || r.saved).map(r => {
      const pct = r.need > 0 ? Math.min(r.saved / r.need, 1) : 1;
      const w = mk('div', { className: 'goal' });
      const top = mk('div', { className: 'goal-top' });
      top.append(mk('b', { textContent: r.label }), mk('span', { className: 'num', textContent: r.f.format(r.saved) + ' de ' + r.f.format(r.need) }));
      const track = mk('div', { className: 'track ' + r.cls });
      const fill = mk('i'); fill.style.width = (pct * 100) + '%'; track.append(fill);
      track.title = r.label + ': tienes ' + r.f.format(r.saved) + ' de ' + r.f.format(r.need);
      const left = r.need - r.saved;
      const note = mk('div', { className: 'pct num' + (left <= 0 ? ' done' : '') });
      note.textContent = left <= 0 ? '¡Meta cubierta! ✓' : Math.round(pct * 100) + '% · te falta ' + r.f.format(left);
      w.append(top, track, note); return w;
    }));
  }
  const cats = CATS.filter(c => byCat[c.id] > 0).map(c => ({ ...c, v: byCat[c.id] })).sort((a, b) => b.v - a.v);
  const host = $('catBars');
  if (!cats.length) { host.replaceChildren(mk('div', { className: 'chart-empty', textContent: 'Aún no hay montos en tus tareas.' })); return; }
  const max = cats[0].v, total = cats.reduce((s, c) => s + c.v, 0);
  host.replaceChildren(...cats.map(c => {
    const w = mk('div', { className: 'cbar c-' + c.id });
    const top = mk('div', { className: 'cbar-top' });
    top.append(mk('span', { textContent: c.label }), mk('span', { className: 'num', textContent: fmtPEN.format(c.v) + ' · ' + Math.round(c.v / total * 100) + '%' }));
    const bar = mk('div', { className: 'cbar-bar' }); bar.style.width = (c.v / max * 100) + '%';
    bar.title = c.label + ': ' + fmtPEN.format(c.v);
    w.append(top, bar); return w;
  }));
  if (!rate && Object.keys(byCat).length) host.append(mk('div', { className: 'chart-empty', textContent: 'Pon el tipo de cambio para sumar también los montos en dólares.' }));
}

function checklist(t, m) {
  const wrap = mk('div', { className: 'subwrap' });
  const isOpen = open.has(t.id);
  const tog = mk('button', { type: 'button', className: 'subtoggle' });
  tog.setAttribute('aria-expanded', String(isOpen));
  tog.textContent = m.count ? 'Lista · ' + m.doneCount + ' de ' + m.count + (isOpen ? ' ▴' : ' ▾') : (isOpen ? 'Ocultar lista ▴' : '+ Agregar lista');
  tog.onclick = () => { isOpen ? open.delete(t.id) : open.add(t.id); saveOpen(); renderList(); if (!isOpen) focusAdd(t.id); };
  wrap.append(tog);
  if (!isOpen) return wrap;
  const f = t.currency === 'USD' ? fmtUSD : fmtPEN;
  const box = mk('div', { className: 'subs' });
  for (const x of subs[t.id] || []) {
    const row = mk('div', { className: 'sub' + (x.done ? ' done' : '') });
    const cb = mk('input', { type: 'checkbox', checked: x.done, id: 'sub-' + x.id });
    cb.onchange = () => updateSub(x, { done: cb.checked });
    const lab = mk('label', { htmlFor: 'sub-' + x.id, textContent: x.title });
    const price = mk('input', { className: 'subamt num', inputMode: 'decimal', value: x.amount === '' ? '' : x.amount, placeholder: t.currency === 'USD' ? '$' : 'S/' });
    price.setAttribute('aria-label', 'Precio de ' + x.title);
    price.onchange = () => updateSub(x, { amount: price.value.trim() === '' ? null : num(price.value) });
    const del = mk('button', { type: 'button', className: 'subdel', textContent: '×' });
    del.setAttribute('aria-label', 'Quitar ' + x.title);
    del.onclick = () => deleteSub(x);
    row.append(cb, lab, price, del); box.append(row);
  }
  const add = mk('form', { className: 'subadd' });
  const name = mk('input', { placeholder: 'Agregar a la lista…', className: 'subname' });
  name.dataset.task = t.id; name.setAttribute('aria-label', 'Nuevo elemento');
  const price = mk('input', { className: 'subamt num', inputMode: 'decimal', placeholder: t.currency === 'USD' ? '$' : 'S/' });
  price.setAttribute('aria-label', 'Precio');
  add.append(name, price, mk('button', { type: 'submit', className: 'subplus', textContent: 'Agregar' }));
  add.onsubmit = e => { e.preventDefault(); if (!name.value.trim()) return; addSub(t, name.value.trim(), price.value.trim() === '' ? null : num(price.value)); };
  box.append(add);
  if (m.hasPriced) {
    const sum = mk('div', { className: 'subsum num' });
    sum.textContent = 'Gastado ' + f.format(m.spent) + ' de ' + f.format(m.budget) + (num(t.amount) ? ' (presupuesto de la tarea)' : ' (suma de la lista)');
    if (num(t.amount) && m.spent > num(t.amount)) { sum.classList.add('over'); sum.textContent += ' · te pasaste por ' + f.format(m.spent - num(t.amount)); }
    box.append(sum);
  }
  wrap.append(box);
  return wrap;
}
function focusAdd(taskId) { setTimeout(() => { const i = document.querySelector('.subname[data-task="' + taskId + '"]'); if (i) i.focus(); }, 0); }

function renderProgress() {
  const done = tasks.filter(t => t.done).length;
  $('prog').style.width = tasks.length ? (done / tasks.length * 100) + '%' : '0';
  $('progTxt').textContent = tasks.length ? done + ' de ' + tasks.length + ' tareas listas' : '';
}

function render() { renderPlans(); renderHeader(); renderBudget(); renderCharts(); renderAlerts(); renderProgress(); renderList(); $('addBtn').hidden = !plan(); $('addBtn2').hidden = !plan(); $('editPlanBtn').hidden = !plan(); }

// ---------- toast & notice ----------
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }
function showNotice(msg) { const n = $('notice'); n.textContent = msg; n.hidden = !msg; }

// ---------- sheets ----------
function closeSheet() { $('sheetHost').replaceChildren(); }
function sheet(build) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.onclick = e => { if (e.target === ov) closeSheet(); };
  const sh = document.createElement('form'); sh.className = 'sheet'; sh.noValidate = true;
  build(sh); ov.append(sh); $('sheetHost').replaceChildren(ov);
  const first = sh.querySelector('input'); if (first) setTimeout(() => first.focus(), 30);
}
function field(label, input, hint) {
  const w = document.createElement('label'); w.className = 'field';
  const l = document.createElement('span'); l.className = 'label'; l.textContent = label;
  w.append(l, input);
  if (hint) { const s = document.createElement('small'); s.textContent = hint; w.append(s); }
  return w;
}
function mk(tag, props) { const e = document.createElement(tag); Object.assign(e, props); return e; }

function openTask(t) {
  const isNew = !t;
  t = t || { title: '', category: 'compra', idealDate: '', deadline: '', amount: '', currency: 'PEN', notes: '', done: false };
  sheet(sh => {
    const h = mk('h2', { textContent: isNew ? 'Nueva tarea' : 'Editar tarea' });
    const title = mk('input', { id: 'f-title', value: t.title, placeholder: 'Ej: Comprar maleta de mano', required: true });
    let cat = t.category || 'otro';
    const cats = mk('div', { className: 'cats' });
    const drawCats = () => cats.replaceChildren(...CATS.map(c => { const b = mk('button', { type: 'button', className: 'chip c-' + c.id, textContent: c.label }); b.setAttribute('aria-pressed', String(c.id === cat)); b.onclick = () => { cat = c.id; drawCats(); }; return b; }));
    drawCats();
    const ideal = mk('input', { id: 'f-ideal', type: 'date', value: t.idealDate || '' });
    const dead = mk('input', { id: 'f-dead', type: 'date', value: t.deadline || '' });
    const amount = mk('input', { id: 'f-amount', inputMode: 'decimal', value: t.amount ?? '', placeholder: '0' });
    const cur = mk('select', { id: 'f-cur' });
    cur.append(mk('option', { value: 'PEN', textContent: 'Soles (S/)' }), mk('option', { value: 'USD', textContent: 'Dólares (US$)' }));
    cur.value = t.currency || 'PEN';
    const notes = mk('textarea', { id: 'f-notes', rows: 2, value: t.notes || '', placeholder: 'Dónde, a quién llamar, qué llevar…' });
    const err = mk('div', { className: 'notice', hidden: true });

    const d1 = mk('div', { className: 'two' }); d1.append(field('Fecha ideal', ideal, 'Cuándo te conviene hacerlo'), field('Fecha límite', dead, 'Después de esto, ¡fue!'));
    const d2 = mk('div', { className: 'two' }); d2.append(field('Monto', amount), field('Moneda', cur));
    const catWrap = mk('div', { className: 'field' }); catWrap.append(mk('span', { className: 'label', textContent: 'Tipo' }), cats);

    const actions = mk('div', { className: 'actions' });
    const left = mk('div');
    if (!isNew) { const del = mk('button', { type: 'button', className: 'btn danger', textContent: 'Eliminar' });
      del.onclick = () => { if (del.dataset.sure) { deleteTask(t); closeSheet(); } else { del.dataset.sure = '1'; del.textContent = '¿Seguro? Toca otra vez'; } };
      left.append(del); }
    const right = mk('div', { style: 'display:flex;gap:8px' });
    right.append(mk('button', { type: 'button', className: 'btn ghost', textContent: 'Cancelar', onclick: closeSheet }), mk('button', { type: 'submit', className: 'btn primary', textContent: 'Guardar' }));
    actions.append(left, right);

    sh.append(h, field('¿Qué hay que hacer?', title), catWrap, d1, d2, field('Notas', notes), err, actions);
    sh.onsubmit = e => {
      e.preventDefault();
      if (!title.value.trim()) { err.textContent = 'Escribe qué hay que hacer.'; err.hidden = false; return; }
      if (ideal.value && dead.value && ideal.value > dead.value) { err.textContent = 'La fecha ideal debe ser antes (o igual) que la fecha límite.'; err.hidden = false; return; }
      saveTask({ ...t, title: title.value.trim(), category: cat, idealDate: ideal.value, deadline: dead.value, amount: amount.value ? num(amount.value) : '', currency: cur.value, notes: notes.value.trim() });
      closeSheet();
    };
  });
}

function openPlan(p) {
  const isNew = !p;
  p = p || { name: '', date: '' };
  sheet(sh => {
    const name = mk('input', { id: 'p-name', value: p.name, placeholder: 'Ej: Viaje de diciembre' });
    const date = mk('input', { id: 'p-date', type: 'date', value: p.date || '' });
    const err = mk('div', { className: 'notice', hidden: true });
    const actions = mk('div', { className: 'actions' });
    const r = mk('div', { style: 'display:flex;gap:8px' });
    r.append(mk('button', { type: 'button', className: 'btn ghost', textContent: 'Cancelar', onclick: closeSheet }), mk('button', { type: 'submit', className: 'btn primary', textContent: isNew ? 'Crear' : 'Guardar' }));
    actions.append(mk('div'), r);
    sh.append(mk('h2', { textContent: isNew ? 'Nueva actividad' : 'Editar actividad' }), field('Nombre', name), field('Fecha del evento', date, 'El día del viaje, la mudanza, etc.'), err, actions);
    sh.onsubmit = async e => {
      e.preventDefault();
      if (!name.value.trim()) { err.textContent = 'Ponle un nombre.'; err.hidden = false; return; }
      const row = { name: name.value.trim(), date: date.value || null };
      const res = isNew
        ? await sb.from('plans').insert(row).select().single()
        : await sb.from('plans').update(row).eq('id', p.id).select().single();
      if (res.error) { err.textContent = 'No se pudo guardar. Revisa tu conexión e inténtalo otra vez.'; err.hidden = false; return; }
      await loadPlans(); if (isNew) await selectPlan(res.data.id);
      closeSheet(); toast('Guardado');
    };
  });
}

// ---------- data ----------
async function loadPlans() {
  const { data, error } = await sb.from('plans').select('*').order('created_at');
  if (error) { showNotice('No se pudieron cargar tus datos. Revisa tu conexión y recarga.'); return; }
  showNotice('');
  plans = data.map(fromPlan);
}
async function loadTasks() {
  if (!planId) { tasks = []; return; }
  const { data, error } = await sb.from('tasks').select('*').eq('plan_id', planId).order('created_at');
  if (error) { showNotice('No se pudieron cargar tus tareas. Recarga la página.'); return; }
  tasks = data.map(fromTask);
  subs = {};
  if (tasks.length) {
    const r = await sb.from('subtasks').select('*').in('task_id', tasks.map(t => t.id)).order('created_at');
    if (!r.error) for (const x of r.data.map(fromSub)) (subs[x.taskId] ||= []).push(x);
  }
}
async function selectPlan(id) {
  planId = id; try { localStorage.setItem('planId', id); } catch {}
  await loadTasks(); render();
}
async function refresh() {
  if (!user) return;
  await loadPlans();
  let saved = null; try { saved = localStorage.getItem('planId'); } catch {}
  const pick = plans.find(p => p.id === planId) || plans.find(p => p.id === saved) || plans[plans.length - 1];
  planId = pick ? pick.id : null;
  await loadTasks(); render();
}

async function saveTask(t) {
  if (t.id) { tasks = tasks.map(x => x.id === t.id ? { ...t } : x); render(); }
  const row = toTask(t);
  const res = t.id
    ? await sb.from('tasks').update(row).eq('id', t.id).select().single()
    : await sb.from('tasks').insert({ ...row, plan_id: planId }).select().single();
  if (res.error) { toast('No se pudo guardar. Inténtalo otra vez.'); await loadTasks(); render(); return; }
  const saved = fromTask(res.data);
  tasks = t.id ? tasks.map(x => x.id === saved.id ? saved : x) : [...tasks, saved];
  render();
  toast(t.done && t.id ? '¡Listo! Una menos ✓' : 'Guardado');
}
async function deleteTask(t) {
  const { error } = await sb.from('tasks').delete().eq('id', t.id);
  if (error) { toast('No se pudo eliminar.'); return; }
  tasks = tasks.filter(x => x.id !== t.id); render(); toast('Tarea eliminada');
}
const pendingPlan = {}; let planTimer;
function patchPlan(fields) {
  if (!planId) return;
  Object.assign(pendingPlan, fields);
  const p = plan(); if (p) Object.assign(p, fields); renderBudget(); renderCharts();
  clearTimeout(planTimer);
  planTimer = setTimeout(async () => {
    const f = { ...pendingPlan }; for (const k in pendingPlan) delete pendingPlan[k];
    const row = {};
    if ('savedPEN' in f) row.saved_pen = f.savedPEN;
    if ('savedUSD' in f) row.saved_usd = f.savedUSD;
    if ('rate' in f) row.rate = f.rate;
    const { error } = await sb.from('plans').update(row).eq('id', planId);
    if (error) toast('No se pudo guardar el presupuesto.');
  }, 700);
}

async function addSub(t, title, amount) {
  const { data, error } = await sb.from('subtasks').insert({ task_id: t.id, title, amount }).select().single();
  if (error) { toast('No se pudo agregar. Inténtalo otra vez.'); return; }
  (subs[t.id] ||= []).push(fromSub(data)); render(); focusAdd(t.id);
}
async function updateSub(x, fields) {
  const list = subs[x.taskId] || [];
  const local = { ...x, ...fields }; if ('amount' in fields) local.amount = fields.amount ?? '';
  subs[x.taskId] = list.map(y => y.id === x.id ? local : y); render();
  const { error } = await sb.from('subtasks').update(fields).eq('id', x.id);
  if (error) { toast('No se pudo guardar.'); await loadTasks(); render(); }
}
async function deleteSub(x) {
  subs[x.taskId] = (subs[x.taskId] || []).filter(y => y.id !== x.id); render();
  const { error } = await sb.from('subtasks').delete().eq('id', x.id);
  if (error) { toast('No se pudo quitar.'); await loadTasks(); render(); }
}

// ---------- calendar export ----------
function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function buildIcs() {
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Antes del Viaje//ES', 'CALSCALE:GREGORIAN'];
  const ev = (uid, day, summary, desc) => {
    lines.push('BEGIN:VEVENT', 'UID:' + uid + '@antes-del-viaje', 'DTSTAMP:' + now,
      'DTSTART;VALUE=DATE:' + day.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + addDays(day, 1).replace(/-/g, ''),
      'SUMMARY:' + icsEscape(summary), 'DESCRIPTION:' + icsEscape(desc),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(summary), 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT');
  };
  let n = 0;
  for (const t of tasks) {
    if (t.done) continue;
    const desc = [t.deadline && 'Fecha límite: ' + fmtDate(t.deadline), num(t.amount) && 'Presupuesto: ' + (t.currency === 'USD' ? fmtUSD : fmtPEN).format(num(t.amount)), t.notes].filter(Boolean).join('\n');
    if (t.idealDate) { ev(t.id + '-ideal', t.idealDate, t.title, desc); n++; }
    if (t.deadline && t.deadline !== t.idealDate) { ev(t.id + '-limite', t.deadline, 'ÚLTIMO DÍA: ' + t.title, desc); n++; }
  }
  const p = plan(); if (p && p.date) { ev(p.id + '-evento', p.date, p.name, ''); n++; }
  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n'), n };
}
$('icsBtn').onclick = () => {
  if (!tasks.length) { toast('Primero agrega tareas con fecha.'); return; }
  const { text, n } = buildIcs();
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  const a = document.createElement('a'); a.href = url; a.download = 'antes-del-viaje.ics'; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(n + ' recordatorios listos. Ábrelo para añadirlos a tu calendario.');
};

// ---------- wiring ----------
$('planSel').onchange = e => selectPlan(e.target.value);
$('newPlanBtn').onclick = () => openPlan(null);
$('editPlanBtn').onclick = () => plan() && openPlan(plan());
$('addBtn').onclick = () => openTask(null);
$('addBtn2').onclick = () => openTask(null);
$('savedPEN').oninput = e => patchPlan({ savedPEN: num(e.target.value) });
$('savedUSD').oninput = e => patchPlan({ savedUSD: num(e.target.value) });
$('rate').oninput = e => patchPlan({ rate: num(e.target.value) });
$('logoutBtn').onclick = async () => { await sb.auth.signOut(); };

$('loginForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('email').value.trim();
  if (!email) return;
  $('loginBtn').disabled = true; $('loginMsg').className = ''; $('loginMsg').textContent = 'Enviando…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
  $('loginBtn').disabled = false;
  if (error) { $('loginMsg').textContent = error.status === 429 ? 'Se enviaron muchos correos seguidos. Espera unos minutos e inténtalo otra vez.' : 'No se pudo enviar el correo. Revisa la dirección e inténtalo otra vez.'; return; }
  $('loginMsg').className = 'ok'; $('loginMsg').textContent = 'Listo. Revisa tu correo (y la carpeta de spam) y abre el enlace en este mismo dispositivo.';
};

function showApp(signedIn) {
  $('login').hidden = signedIn; $('app').hidden = !signedIn;
  if (!signedIn) { $('addBtn').hidden = true; $('addBtn2').hidden = true; }
}

try { filter = localStorage.getItem('filter') || 'pend'; } catch {}
renderFilters();

sb.auth.onAuthStateChange((event, session) => {
  const next = session ? session.user : null;
  const changed = (next && next.id) !== (user && user.id);
  user = next;
  showApp(!!user);
  if (changed) { plans = []; tasks = []; planId = null; if (user) setTimeout(refresh, 0); else render(); }
});

// keep phone and laptop in sync: reload when you come back to the app
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
})();
