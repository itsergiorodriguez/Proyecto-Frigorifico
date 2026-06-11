/* =====================================================================
   AUTH — sesión simple por cookie (sin dependencias extra).
   Cada compañero entra con nombre + PIN (gestionados en el store, ver
   server/store.js) y obtiene un rol:
     'admin'    → gestiona compañeros (Administración) y opera
     'operador' → puede marcar forzadores/cámaras
     'lectura'  → solo ve
   Las sesiones viven en memoria: se pierden si el server reinicia.
   ===================================================================== */
const crypto = require('crypto');
const store = require('./store');

const COOKIE = 'mv_sid';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 días

const sesiones = new Map(); // sid -> { nombre, rol }

/* ---------- freno de fuerza bruta sobre /api/login ---------- */
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000; // 5 minutos
const intentos = new Map(); // ip -> { fallos, bloqueadoHasta }

function loginBloqueado(ip) {
  const r = intentos.get(ip);
  return !!(r && r.bloqueadoHasta > Date.now());
}

function registrarIntento(ip, exito) {
  if (exito) { intentos.delete(ip); return; }
  const r = intentos.get(ip) || { fallos: 0, bloqueadoHasta: 0 };
  r.fallos++;
  if (r.fallos >= MAX_INTENTOS) { r.bloqueadoHasta = Date.now() + BLOQUEO_MS; r.fallos = 0; }
  intentos.set(ip, r);
}

// limpieza periódica para no acumular IPs viejas en memoria
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, r] of intentos) if (r.bloqueadoHasta < ahora) intentos.delete(ip);
}, 30 * 60 * 1000);

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/* intenta loguear; devuelve { sid, datos:{nombre,rol} }, null si las credenciales no
   matchean, o 'bloqueado' si esa IP encadenó demasiados intentos fallidos */
async function login(ip, nombre, pin) {
  if (loginBloqueado(ip)) return 'bloqueado';
  const usuarios = await store.getUsuarios();
  const u = usuarios.find(x => x.nombre === nombre && x.pin === String(pin ?? ''));
  if (!u) { registrarIntento(ip, false); return null; }
  registrarIntento(ip, true);
  const sid = crypto.randomBytes(24).toString('hex');
  const datos = { nombre: u.nombre, rol: u.rol };
  sesiones.set(sid, datos);
  return { sid, datos };
}

function logout(sid) { sesiones.delete(sid); }

/* adjunta req.usuario (o null) y req.sid a cada request */
function middleware(req, _res, next) {
  const sid = parseCookies(req)[COOKIE];
  req.sid = sid;
  req.usuario = sid ? sesiones.get(sid) || null : null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'no autenticado' });
  next();
}

function requireOperador(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'no autenticado' });
  if (req.usuario.rol !== 'operador' && req.usuario.rol !== 'admin') return res.status(403).json({ error: 'tu rol es de solo lectura' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'no autenticado' });
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'requiere rol admin' });
  next();
}

function setCookie(req, res, sid) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${secure}`);
}
function clearCookie(req, res) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

async function nombresUsuarios() {
  const usuarios = await store.getUsuarios();
  return usuarios.map(u => u.nombre);
}

module.exports = {
  middleware, requireAuth, requireOperador, requireAdmin,
  login, logout, setCookie, clearCookie, nombresUsuarios
};
