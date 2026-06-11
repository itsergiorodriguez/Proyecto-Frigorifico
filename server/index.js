/* =====================================================================
   SERVIDOR — API REST de relevamiento de forzadores · Sala de Máquinas
   Node.js + Express. Sirve el frontend (public/) y expone la API.
   Datos compartidos: todos los compañeros que apunten a este servidor
   ven y editan el mismo relevamiento.
   ===================================================================== */
const express = require('express');
const path = require('path');
const store = require('./store');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

// detrás de un proxy/PaaS (Railway, Render, etc.) que termina TLS
app.set('trust proxy', 1);

// en producción, forzar HTTPS
if (PROD) {
  app.use((req, res, next) => {
    if (!req.secure) return res.redirect(301, `https://${req.headers.host}${req.url}`);
    next();
  });
}

// cabeceras de seguridad básicas
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '64kb' }));
app.use(auth.middleware);
app.use(express.static(path.join(__dirname, '..', 'public')));

// log mínimo
app.use((req, _res, next) => { if (req.method !== 'GET') console.log(`${new Date().toISOString()} ${req.method} ${req.url}`); next(); });

// respuesta genérica para errores inesperados (no filtra detalles internos)
function errorInterno(res, e) { console.error(e); res.status(500).json({ error: 'Error interno del servidor' }); }

/* ---- Login / sesión ---- */
app.get('/api/usuarios', async (_req, res) => {
  try { res.json(await auth.nombresUsuarios()); }
  catch (e) { errorInterno(res, e); }
});

app.post('/api/login', async (req, res) => {
  const { nombre, pin } = req.body || {};
  const r = await auth.login(req.ip, nombre, pin);
  if (r === 'bloqueado') return res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
  if (!r) return res.status(401).json({ error: 'Compañero o PIN incorrecto' });
  auth.setCookie(req, res, r.sid);
  res.json(r.datos);
});

app.post('/api/logout', (req, res) => {
  if (req.sid) auth.logout(req.sid);
  auth.clearCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/me', auth.requireAuth, (req, res) => res.json(req.usuario));

/* ---- Plano completo + estados (1 sola llamada para renderizar) ---- */
app.get('/api/plano', auth.requireAuth, async (_req, res) => {
  try { res.json(await store.getPlano()); }
  catch (e) { errorInterno(res, e); }
});

/* ---- Solo estados (liviano, para el polling de sincronización) ---- */
app.get('/api/estados', auth.requireAuth, async (_req, res) => {
  try { res.json(await store.getEstados()); }
  catch (e) { errorInterno(res, e); }
});

/* ---- Actualizar 1 forzador ---- */
app.post('/api/forzador/:id', auth.requireOperador, async (req, res) => {
  try {
    const { estado, nota } = req.body || {};
    const r = await store.setForzador(req.params.id, { estado, operador: req.usuario.nombre, nota });
    res.json({ ok: true, forzador: req.params.id, ...r });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---- Marcar TODA una cámara (rápido en la ronda) ---- */
app.post('/api/camara/:num/todos', auth.requireOperador, async (req, res) => {
  try {
    const { estado } = req.body || {};
    const n = await store.bulkCamara(Number(req.params.num), estado, req.usuario.nombre);
    res.json({ ok: true, camara: Number(req.params.num), afectados: n });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---- Nota de cámara ---- */
app.post('/api/camara/:num/nota', auth.requireOperador, async (req, res) => {
  try {
    const { nota } = req.body || {};
    await store.setNotaCamara(Number(req.params.num), nota, req.usuario.nombre);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---- Historial (auditoría multiusuario) ---- */
app.get('/api/historial', auth.requireAuth, async (req, res) => {
  try { res.json(await store.getHistorial(Number(req.query.limit) || 60)); }
  catch (e) { errorInterno(res, e); }
});

/* ---- Reporte de novedades (fallas / a revisar) ---- */
app.get('/api/reporte', auth.requireAuth, async (_req, res) => {
  try {
    const { camaras } = await store.getPlano();
    let t = 0, ok = 0, rev = 0, fal = 0, norel = 0;
    const fallas = [], revisar = [], notas = [];
    for (const c of camaras) {
      const f = [], r = [];
      for (const ev of c.evaporadores) for (const fz of ev.forzadores) {
        t++;
        if (fz.estado === 'ok') ok++;
        else if (fz.estado === 'revisar') { rev++; r.push(fz.n_global); }
        else if (fz.estado === 'falla') { fal++; f.push(fz.n_global); }
        else norel++;
      }
      if (f.length) fallas.push({ camara: c.num, forzadores: f });
      if (r.length) revisar.push({ camara: c.num, forzadores: r });
      if (c.nota) notas.push({ camara: c.num, nota: c.nota });
    }
    res.json({ resumen: { total: t, ok, revisar: rev, falla: fal, sin_relevar: norel, relevados: t - norel }, fallas, revisar, notas });
  } catch (e) { errorInterno(res, e); }
});

/* ---- Administración de compañeros (solo admin) ---- */
app.get('/api/admin/usuarios', auth.requireAdmin, async (_req, res) => {
  try { res.json(await store.getUsuarios()); }
  catch (e) { errorInterno(res, e); }
});

app.post('/api/admin/usuarios', auth.requireAdmin, async (req, res) => {
  try { res.json(await store.crearUsuario(req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/admin/usuarios/:id', auth.requireAdmin, async (req, res) => {
  try { res.json(await store.actualizarUsuario(Number(req.params.id), req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/admin/usuarios/:id', auth.requireAdmin, async (req, res) => {
  try { await store.eliminarUsuario(Number(req.params.id)); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

store.init()
  .then(() => app.listen(PORT, () => {
    console.log(`\n  SALA DE MÁQUINAS · Relevamiento de forzadores`);
    console.log(`  Motor de datos: ${(process.env.DB_DRIVER || 'file').toUpperCase()}`);
    console.log(`  Servidor en  http://localhost:${PORT}\n`);
  }))
  .catch(e => { console.error('Error al iniciar:', e); process.exit(1); });
