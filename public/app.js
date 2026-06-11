/* =====================================================================
   APP — lógica de relevamiento. Habla con la API, sincroniza entre
   compañeros por polling, y opera el plano dinámico.
   ===================================================================== */
const CICLO = ['sin_relevar', 'ok', 'revisar', 'falla'];
const ETIQ = { sin_relevar: 'sin relevar', ok: 'OK', revisar: 'revisar', falla: 'FALLA' };
const $ = s => document.querySelector(s);
let PLANO = null;          // último plano del server
let SESION = null;         // { nombre, rol } del compañero logueado
let filtro = 'todas';
let syncing = false;
let ADMIN_USUARIOS = [];   // caché de compañeros (solo para el panel de administración)

async function api(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
}

/* ---------- arranque / sesión ---------- */
async function init() {
  await poblarLoginUsuarios();
  $('#loginBtn').addEventListener('click', intentarLogin);
  $('#loginPin').addEventListener('keydown', e => { if (e.key === 'Enter') intentarLogin(); });

  try { SESION = await api('/api/me'); } catch { SESION = null; }
  if (SESION) { $('#loginOverlay').classList.remove('open'); arrancarApp(); }
}

async function poblarLoginUsuarios() {
  try {
    const nombres = await api('/api/usuarios');
    $('#loginNombre').innerHTML = nombres.map(n => `<option value="${n}">${n}</option>`).join('');
  } catch { /* sin conexión: el login fallará igual al enviar */ }
}

async function intentarLogin() {
  const nombre = $('#loginNombre').value;
  const pin = $('#loginPin').value.trim();
  $('#loginError').textContent = '';
  try {
    SESION = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, pin }) });
    $('#loginOverlay').classList.remove('open');
    $('#loginPin').value = '';
    arrancarApp();
  } catch (e) {
    $('#loginError').textContent = e.message === '429' || /intentos/i.test(e.message)
      ? 'Demasiados intentos. Probá de nuevo en unos minutos.'
      : 'Compañero o PIN incorrecto';
    $('#loginPin').value = '';
    $('#loginPin').focus();
  }
}

async function cerrarSesion() {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  location.reload();
}

function pintarSesion() {
  $('#opNombre').textContent = SESION.nombre;
  document.body.classList.toggle('lectura', SESION.rol === 'lectura');
  $('#badgeLectura').hidden = SESION.rol !== 'lectura';
  $('#btnAdmin').hidden = SESION.rol !== 'admin';
}

/* ---------- arranque de la app (ya logueado) ---------- */
async function arrancarApp() {
  pintarSesion();
  await cargarPlano();
  setInterval(sincronizar, 4000);   // todos los compañeros convergen
  $('#btnReporte').addEventListener('click', verReporte);
  $('#btnHist').addEventListener('click', verHistorial);
  $('#opNombre').addEventListener('click', cerrarSesion);
  if (SESION.rol === 'admin') {
    $('#btnAdmin').addEventListener('click', abrirAdmin);
    $('#adminForm').addEventListener('submit', guardarUsuario);
    $('#adminCancelar').addEventListener('click', resetearFormAdmin);
    $('#adminCerrar').addEventListener('click', () => $('#modalAdmin').classList.remove('open'));
  }
  document.querySelectorAll('#filtros button').forEach(b =>
    b.addEventListener('click', () => { filtro = b.dataset.f; pintarFiltros(); aplicarFiltro(); }));
}

async function cargarPlano() {
  PLANO = await api('/api/plano');
  const { svg } = PlanoForzadores.construirPlanoSVG(PLANO.camaras);
  $('#plano').innerHTML = svg;
  document.querySelectorAll('.frz').forEach(g => {
    g.addEventListener('click', () => tocar(g));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tocar(g); } });
  });
  refrescarKPIs();
  pintarFiltros();
  aplicarFiltro();
  renderPanelCamaras();
}

// orden de visualización del panel (no es el orden físico del plano)
const ORDEN_PANEL = [22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 15, 19];

function renderPanelCamaras() {
  const host = document.querySelector('#panelCamaras');
  const porNum = new Map(PLANO.camaras.map(c => [c.num, c]));
  host.innerHTML = ORDEN_PANEL.map(num => porNum.get(num)).filter(Boolean).map(c => {
    const cs = stats([c]);
    const cls = cs.fal ? 'm-falla' : cs.rev ? 'm-rev' : cs.nr === 0 ? 'm-ok' : '';
    return `<div class="pc ${cls}" data-pc="${c.num}">
      <div class="pc-top"><span class="pc-num">Cámara ${c.num}</span><span class="pc-prog">${cs.rel}/${cs.t}</span></div>
      <div class="pc-btns">
        <button class="ok" onclick="marcarCamara(${c.num},'ok')">✓ Todos OK</button>
        <button onclick="marcarCamara(${c.num},'sin_relevar')">Limpiar</button>
      </div>
    </div>`;
  }).join('');
}

/* ---------- tocar un forzador: cicla estado + persiste ---------- */
async function tocar(g) {
  if (SESION.rol === 'lectura') { toast('Modo solo lectura'); return; }
  const id = g.dataset.id;
  const actual = [...g.classList].find(c => c.startsWith('estado-'))?.slice(7) || 'sin_relevar';
  const nuevo = CICLO[(CICLO.indexOf(actual) + 1) % CICLO.length];
  setClaseEstado(g, nuevo);                 // optimista
  actualizarEstadoLocal(id, nuevo);
  refrescarKPIs(); aplicarFiltro();
  try { await api('/api/forzador/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: nuevo }) }); }
  catch (e) { toast('No se pudo guardar: ' + e.message); }
}

function setClaseEstado(g, estado) {
  g.classList.remove('estado-sin_relevar', 'estado-ok', 'estado-revisar', 'estado-falla');
  g.classList.add('estado-' + estado);
}
function actualizarEstadoLocal(id, estado) {
  for (const c of PLANO.camaras) for (const ev of c.evaporadores) for (const f of ev.forzadores)
    if (f.id === id) { f.estado = estado; return; }
}

/* ---------- marcar cámara completa ---------- */
async function marcarCamara(num, estado) {
  if (SESION.rol === 'lectura') { toast('Modo solo lectura'); return; }
  for (const c of PLANO.camaras) if (c.num === num)
    for (const ev of c.evaporadores) for (const f of ev.forzadores) {
      f.estado = estado;
      const g = document.querySelector(`.frz[data-id="${f.id}"]`); if (g) setClaseEstado(g, estado);
    }
  refrescarKPIs(); aplicarFiltro();
  try { await api(`/api/camara/${num}/todos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado }) }); toast(`Cámara ${num}: ${ETIQ[estado]}`); }
  catch (e) { toast('Error: ' + e.message); }
}

/* ---------- sincronización entre compañeros ---------- */
async function sincronizar() {
  if (syncing || document.hidden) return;
  syncing = true;
  try {
    const estados = await api('/api/estados');
    let cambios = 0;
    for (const c of PLANO.camaras) for (const ev of c.evaporadores) for (const f of ev.forzadores) {
      const e = estados[f.id]; if (!e) continue;
      if (e.estado !== f.estado) {
        f.estado = e.estado;
        const g = document.querySelector(`.frz[data-id="${f.id}"]`); if (g) setClaseEstado(g, e.estado);
        cambios++;
      }
    }
    if (cambios) { refrescarKPIs(); aplicarFiltro(); $('#syncDot').classList.add('on'); setTimeout(() => $('#syncDot').classList.remove('on'), 900); }
  } catch (e) { /* offline: seguimos con lo local */ }
  finally { syncing = false; }
}

/* ---------- KPIs + progreso por cámara ---------- */
function stats(camaras) {
  let t = 0, ok = 0, rev = 0, fal = 0, nr = 0;
  for (const c of camaras) for (const ev of c.evaporadores) for (const f of ev.forzadores) {
    t++; if (f.estado === 'ok') ok++; else if (f.estado === 'revisar') rev++; else if (f.estado === 'falla') fal++; else nr++;
  }
  return { t, ok, rev, fal, nr, rel: t - nr };
}
function refrescarKPIs() {
  const s = stats(PLANO.camaras);
  $('#kTot').textContent = s.t; $('#kRel').textContent = s.rel;
  $('#kOk').textContent = s.ok; $('#kRev').textContent = s.rev;
  $('#kFal').textContent = s.fal; $('#kPend').textContent = s.nr;
  $('#barra').style.width = s.t ? (s.rel / s.t * 100).toFixed(1) + '%' : '0';
  for (const c of PLANO.camaras) {
    const cs = stats([c]);
    const el = document.querySelector(`[data-prog="${c.num}"]`);
    if (el) { el.textContent = `${cs.rel}/${cs.t}`; el.setAttribute('class', 'cprog ' + (cs.fal ? 'malo' : cs.rev ? 'medio' : cs.nr === 0 ? 'bueno' : '')); }
    const g = document.querySelector(`.camara[data-cam="${c.num}"] .muro`);
    if (g) { g.setAttribute('class', 'muro ' + (cs.fal ? 'm-falla' : cs.rev ? 'm-rev' : cs.nr === 0 ? 'm-ok' : '')); }
    const pc = document.querySelector(`.pc[data-pc="${c.num}"]`);
    if (pc) { pc.className = 'pc ' + (cs.fal ? 'm-falla' : cs.rev ? 'm-rev' : cs.nr === 0 ? 'm-ok' : ''); pc.querySelector('.pc-prog').textContent = `${cs.rel}/${cs.t}`; }
  }
}

/* ---------- filtros ---------- */
function pintarFiltros() { document.querySelectorAll('#filtros button').forEach(b => b.classList.toggle('act', b.dataset.f === filtro)); }
function aplicarFiltro() {
  for (const c of PLANO.camaras) {
    const cs = stats([c]);
    let v = true;
    if (filtro === 'pend') v = cs.nr > 0;
    else if (filtro === 'falla') v = cs.fal > 0;
    else if (filtro === 'rev') v = cs.rev > 0;
    const g = document.querySelector(`.camara[data-cam="${c.num}"]`);
    if (g) g.style.opacity = v ? '1' : '0.18';
  }
}

/* ---------- reporte ---------- */
async function verReporte() {
  const r = await api('/api/reporte');
  const L = ['🌀 RELEVAMIENTO DE FORZADORES — CÁMARAS ALTAS 1° PISO', 'Sala de Máquinas · NH₃', new Date().toLocaleString('es-AR')];
  L.push('Operador: ' + SESION.nombre);
  const s = r.resumen;
  L.push('', `Total ${s.total} · Relevados ${s.relevados} · OK ${s.ok} · Revisar ${s.revisar} · Falla ${s.falla} · Pendientes ${s.sin_relevar}`);
  if (r.fallas.length) { L.push('', '🔴 EN FALLA:'); r.fallas.forEach(f => L.push(`  • Cámara ${f.camara}: forzador ${f.forzadores.join(', ')}`)); }
  if (r.revisar.length) { L.push('', '🟡 A REVISAR:'); r.revisar.forEach(f => L.push(`  • Cámara ${f.camara}: forzador ${f.forzadores.join(', ')}`)); }
  if (r.notas.length) { L.push('', '📝 NOTAS:'); r.notas.forEach(n => L.push(`  • Cámara ${n.camara}: ${n.nota}`)); }
  if (!r.fallas.length && !r.revisar.length) L.push('', '✅ Sin novedades.');
  abrirModal('Reporte de novedades', L.join('\n'), true);
}

async function verHistorial() {
  const h = await api('/api/historial?limit=60');
  const L = h.map(x => `${new Date(x.ts).toLocaleString('es-AR')} · ${x.operador || '—'} · ${x.forzador_id} → ${x.estado}`);
  abrirModal('Historial (últimos 60)', L.join('\n') || 'Sin movimientos.', false);
}

/* ---------- administración de compañeros (rol admin) ---------- */
async function abrirAdmin() {
  resetearFormAdmin();
  await cargarUsuarios();
  $('#modalAdmin').classList.add('open');
}

async function cargarUsuarios() {
  $('#adminError').textContent = '';
  try {
    ADMIN_USUARIOS = await api('/api/admin/usuarios');
    $('#adminTbody').innerHTML = ADMIN_USUARIOS.map(u => `
      <tr>
        <td>${u.nombre}</td>
        <td>${u.pin}</td>
        <td class="${u.rol === 'admin' ? 'rol-admin' : ''}">${u.rol}</td>
        <td>
          <button type="button" onclick="editarUsuario(${u.id})">Editar</button>
          <button type="button" onclick="borrarUsuario(${u.id})">Borrar</button>
        </td>
      </tr>`).join('');
  } catch (e) { $('#adminError').textContent = e.message; }
}

function resetearFormAdmin() {
  $('#adminForm').reset();
  $('#adminId').value = '';
  $('#adminRol').value = 'operador';
  $('#adminSubmit').textContent = 'Agregar';
  $('#adminCancelar').hidden = true;
  $('#adminError').textContent = '';
}

window.editarUsuario = function (id) {
  const u = ADMIN_USUARIOS.find(x => x.id === id);
  if (!u) return;
  $('#adminId').value = u.id;
  $('#adminNombre').value = u.nombre;
  $('#adminPin').value = u.pin;
  $('#adminRol').value = u.rol;
  $('#adminSubmit').textContent = 'Guardar';
  $('#adminCancelar').hidden = false;
  $('#adminError').textContent = '';
};

window.borrarUsuario = async function (id) {
  const u = ADMIN_USUARIOS.find(x => x.id === id);
  if (!u || !confirm(`¿Borrar a ${u.nombre}?`)) return;
  try {
    await api(`/api/admin/usuarios/${id}`, { method: 'DELETE' });
    await cargarUsuarios();
  } catch (e) { $('#adminError').textContent = e.message; }
};

async function guardarUsuario(e) {
  e.preventDefault();
  const id = $('#adminId').value;
  const body = {
    nombre: $('#adminNombre').value.trim(),
    pin: $('#adminPin').value.trim(),
    rol: $('#adminRol').value
  };
  $('#adminError').textContent = '';
  try {
    if (id) await api(`/api/admin/usuarios/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    else await api('/api/admin/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await cargarUsuarios();
    resetearFormAdmin();
  } catch (e) { $('#adminError').textContent = e.message; }
}

/* ---------- modal + toast ---------- */
function abrirModal(titulo, texto, wa) {
  $('#mTitulo').textContent = titulo;
  $('#mTexto').textContent = texto;
  $('#mWA').style.display = wa ? '' : 'none';
  $('#mWA').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
  $('#mCopiar').onclick = async () => { try { await navigator.clipboard.writeText(texto); toast('Copiado'); } catch { toast('No se pudo copiar'); } };
  $('#modal').classList.add('open');
}
$('#mCerrar')?.addEventListener('click', () => $('#modal').classList.remove('open'));
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200); }

// expone marcarCamara para los botones del panel
window.marcarCamara = marcarCamara;
window.addEventListener('DOMContentLoaded', init);
