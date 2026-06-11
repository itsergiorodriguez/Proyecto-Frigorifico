/* =====================================================================
   STORE — capa de datos con dos motores intercambiables:
     DB_DRIVER=file  (por defecto)  → JSON en server/data.json
     DB_DRIVER=pg                   → PostgreSQL (escalable, producción)
   Ambos exponen la MISMA interfaz async:
     init(), getPlano(), setForzador(id,{estado,operador,nota}),
     bulkCamara(num,estado,operador), setNotaCamara(num,nota,operador),
     getEstados(), getHistorial(limit)
   ===================================================================== */
const path = require('path');
const fs = require('fs');
const { expandir, todosLosForzadores } = require('../db/layout');

const ESTADOS = ['sin_relevar', 'ok', 'revisar', 'falla'];
const ROLES_USUARIO = ['admin', 'operador', 'lectura'];
const ahora = () => new Date().toISOString();

/* ---------- helpers comunes ---------- */
function estructuraBase() {
  // estructura de plano sin estados (se completa con el motor)
  return expandir().camaras;
}

function validarUsuario({ nombre, pin, rol }) {
  if (!nombre || !String(nombre).trim()) throw new Error('falta el nombre');
  if (!/^\d{4}$/.test(String(pin ?? ''))) throw new Error('el PIN debe ser de 4 dígitos');
  if (!ROLES_USUARIO.includes(rol)) throw new Error('rol inválido');
}

// semilla inicial de compañeros (se siembra una sola vez en el primer arranque)
function sembrarUsuarios() {
  const { USUARIOS } = require('../db/usuarios');
  return USUARIOS.map((u, i) => ({ id: i + 1, nombre: u.nombre, pin: String(u.pin), rol: u.rol }));
}

/* ===================================================================
   MOTOR ARCHIVO (JSON)
   =================================================================== */
function fileStore() {
  const FILE = path.join(__dirname, 'data.json');
  let db = null;

  function persistir() { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }

  async function init() {
    if (fs.existsSync(FILE)) {
      db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (!db.usuarios) { db.usuarios = sembrarUsuarios(); persistir(); }
    } else {
      db = { estados: {}, notas: {}, historial: [], usuarios: sembrarUsuarios() };
      for (const f of todosLosForzadores())
        db.estados[f.id] = { estado: 'sin_relevar', operador: null, nota: null, actualizado: null };
      persistir();
    }
    return true;
  }

  async function getPlano() {
    const camaras = estructuraBase().map(c => ({
      ...c,
      nota: db.notas[c.num] || null,
      evaporadores: c.evaporadores.map(ev => ({
        ...ev,
        forzadores: ev.forzadores.map(f => ({ ...f, ...(db.estados[f.id] || { estado: 'sin_relevar' }) }))
      }))
    }));
    return { camaras };
  }

  async function getEstados() { return db.estados; }

  async function setForzador(id, { estado, operador, nota }) {
    if (!ESTADOS.includes(estado)) throw new Error('estado inválido');
    if (!db.estados[id]) throw new Error('forzador inexistente');
    db.estados[id] = { estado, operador: operador || null, nota: nota || null, actualizado: ahora() };
    const cam = Number(id.split('-')[1]);
    db.historial.unshift({ forzador_id: id, camara_num: cam, estado, operador: operador || null, nota: nota || null, ts: ahora() });
    db.historial = db.historial.slice(0, 2000);
    persistir();
    return db.estados[id];
  }

  async function bulkCamara(num, estado, operador) {
    if (!ESTADOS.includes(estado)) throw new Error('estado inválido');
    let n = 0;
    for (const f of todosLosForzadores()) {
      if (f.camara === num) { db.estados[f.id] = { estado, operador: operador || null, nota: null, actualizado: ahora() }; n++; }
    }
    db.historial.unshift({ forzador_id: `*cam-${num}`, camara_num: num, estado: `(masivo) ${estado}`, operador: operador || null, nota: `${n} forzadores`, ts: ahora() });
    persistir();
    return n;
  }

  async function setNotaCamara(num, nota, operador) {
    db.notas[num] = nota || null;
    persistir();
    return true;
  }

  async function getHistorial(limit = 50) { return db.historial.slice(0, limit); }

  async function getUsuarios() { return db.usuarios.map(u => ({ ...u })); }

  async function crearUsuario({ nombre, pin, rol }) {
    nombre = String(nombre || '').trim();
    validarUsuario({ nombre, pin, rol });
    if (db.usuarios.some(u => u.nombre.toLowerCase() === nombre.toLowerCase()))
      throw new Error('ya existe un compañero con ese nombre');
    const id = db.usuarios.reduce((m, u) => Math.max(m, u.id), 0) + 1;
    const u = { id, nombre, pin: String(pin), rol };
    db.usuarios.push(u);
    persistir();
    return u;
  }

  async function actualizarUsuario(id, { nombre, pin, rol }) {
    nombre = String(nombre || '').trim();
    validarUsuario({ nombre, pin, rol });
    const u = db.usuarios.find(x => x.id === id);
    if (!u) throw new Error('compañero inexistente');
    if (db.usuarios.some(x => x.id !== id && x.nombre.toLowerCase() === nombre.toLowerCase()))
      throw new Error('ya existe un compañero con ese nombre');
    if (u.rol === 'admin' && rol !== 'admin' && db.usuarios.filter(x => x.rol === 'admin').length <= 1)
      throw new Error('no se puede quitar el último admin');
    Object.assign(u, { nombre, pin: String(pin), rol });
    persistir();
    return u;
  }

  async function eliminarUsuario(id) {
    const u = db.usuarios.find(x => x.id === id);
    if (!u) throw new Error('compañero inexistente');
    if (u.rol === 'admin' && db.usuarios.filter(x => x.rol === 'admin').length <= 1)
      throw new Error('no se puede borrar el último admin');
    db.usuarios = db.usuarios.filter(x => x.id !== id);
    persistir();
    return true;
  }

  return {
    init, getPlano, getEstados, setForzador, bulkCamara, setNotaCamara, getHistorial,
    getUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario
  };
}

/* ===================================================================
   MOTOR POSTGRES
   =================================================================== */
function pgStore() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  async function init() {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM forzadores');
    if (rows[0].n === 0) await seed();
    const { rows: ur } = await pool.query('SELECT COUNT(*)::int AS n FROM usuarios');
    if (ur[0].n === 0) {
      for (const u of sembrarUsuarios())
        await pool.query('INSERT INTO usuarios(nombre,pin,rol) VALUES($1,$2,$3) ON CONFLICT (nombre) DO NOTHING', [u.nombre, u.pin, u.rol]);
    }
    return true;
  }

  async function seed() {
    const data = expandir();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const c of data.camaras) {
        await client.query(
          `INSERT INTO camaras(num,columna,proceso,orden,total_forz) VALUES($1,$2,$3,$4,$5)
           ON CONFLICT (num) DO NOTHING`,
          [c.num, c.col, c.proceso, c.orden, c.total]);
        for (const ev of c.evaporadores) {
          await client.query(
            `INSERT INTO evaporadores(id,camara_num,etiqueta,pared,orden) VALUES($1,$2,$3,$4,$5)
             ON CONFLICT (id) DO NOTHING`,
            [ev.id, c.num, ev.etiqueta, ev.pared, ev.orden]);
          for (const f of ev.forzadores) {
            await client.query(
              `INSERT INTO forzadores(id,evap_id,camara_num,n_local,n_global,estado)
               VALUES($1,$2,$3,$4,$5,'sin_relevar') ON CONFLICT (id) DO NOTHING`,
              [f.id, ev.id, c.num, f.n_local, f.n_global]);
          }
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }

  async function getPlano() {
    const cams = (await pool.query('SELECT * FROM camaras ORDER BY orden')).rows;
    const evs  = (await pool.query('SELECT * FROM evaporadores ORDER BY camara_num,orden')).rows;
    const frz  = (await pool.query('SELECT * FROM forzadores ORDER BY camara_num,n_global')).rows;
    const notas= (await pool.query('SELECT * FROM camara_notas')).rows;
    const notaMap = Object.fromEntries(notas.map(n => [n.camara_num, n.nota]));
    const camaras = cams.map(c => ({
      num: c.num, col: c.columna, proceso: c.proceso, orden: c.orden, total: c.total_forz,
      nota: notaMap[c.num] || null,
      evaporadores: evs.filter(e => e.camara_num === c.num).map(e => ({
        id: e.id, etiqueta: e.etiqueta, pared: e.pared, orden: e.orden,
        forzadores: frz.filter(f => f.evap_id === e.id).map(f => ({
          id: f.id, n_local: f.n_local, n_global: f.n_global,
          estado: f.estado, operador: f.operador, nota: f.nota, actualizado: f.actualizado
        }))
      }))
    }));
    return { camaras };
  }

  async function getEstados() {
    const { rows } = await pool.query('SELECT id,estado,operador,nota,actualizado FROM forzadores');
    return Object.fromEntries(rows.map(r => [r.id, r]));
  }

  async function setForzador(id, { estado, operador, nota }) {
    if (!ESTADOS.includes(estado)) throw new Error('estado inválido');
    const r = await pool.query(
      `UPDATE forzadores SET estado=$2, operador=$3, nota=$4, actualizado=now()
       WHERE id=$1 RETURNING camara_num`, [id, estado, operador || null, nota || null]);
    if (!r.rowCount) throw new Error('forzador inexistente');
    await pool.query(
      `INSERT INTO historial(forzador_id,camara_num,estado,operador,nota) VALUES($1,$2,$3,$4,$5)`,
      [id, r.rows[0].camara_num, estado, operador || null, nota || null]);
    return { estado, operador, nota };
  }

  async function bulkCamara(num, estado, operador) {
    if (!ESTADOS.includes(estado)) throw new Error('estado inválido');
    const r = await pool.query(
      `UPDATE forzadores SET estado=$2, operador=$3, nota=NULL, actualizado=now() WHERE camara_num=$1`,
      [num, estado, operador || null]);
    await pool.query(
      `INSERT INTO historial(forzador_id,camara_num,estado,operador,nota) VALUES($1,$2,$3,$4,$5)`,
      [`*cam-${num}`, num, `(masivo) ${estado}`, operador || null, `${r.rowCount} forzadores`]);
    return r.rowCount;
  }

  async function setNotaCamara(num, nota, operador) {
    await pool.query(
      `INSERT INTO camara_notas(camara_num,nota,operador,actualizado) VALUES($1,$2,$3,now())
       ON CONFLICT (camara_num) DO UPDATE SET nota=$2, operador=$3, actualizado=now()`,
      [num, nota || null, operador || null]);
    return true;
  }

  async function getHistorial(limit = 50) {
    const { rows } = await pool.query('SELECT * FROM historial ORDER BY ts DESC LIMIT $1', [limit]);
    return rows;
  }

  async function getUsuarios() {
    const { rows } = await pool.query('SELECT id,nombre,pin,rol FROM usuarios ORDER BY id');
    return rows;
  }

  async function crearUsuario({ nombre, pin, rol }) {
    nombre = String(nombre || '').trim();
    validarUsuario({ nombre, pin, rol });
    try {
      const { rows } = await pool.query(
        'INSERT INTO usuarios(nombre,pin,rol) VALUES($1,$2,$3) RETURNING id,nombre,pin,rol',
        [nombre, String(pin), rol]);
      return rows[0];
    } catch (e) {
      if (e.code === '23505') throw new Error('ya existe un compañero con ese nombre');
      throw e;
    }
  }

  async function actualizarUsuario(id, { nombre, pin, rol }) {
    nombre = String(nombre || '').trim();
    validarUsuario({ nombre, pin, rol });
    if (rol !== 'admin') {
      const { rows: admins } = await pool.query("SELECT id FROM usuarios WHERE rol='admin'");
      if (admins.length === 1 && admins[0].id === id)
        throw new Error('no se puede quitar el último admin');
    }
    try {
      const { rows } = await pool.query(
        'UPDATE usuarios SET nombre=$2,pin=$3,rol=$4 WHERE id=$1 RETURNING id,nombre,pin,rol',
        [id, nombre, String(pin), rol]);
      if (!rows.length) throw new Error('compañero inexistente');
      return rows[0];
    } catch (e) {
      if (e.code === '23505') throw new Error('ya existe un compañero con ese nombre');
      throw e;
    }
  }

  async function eliminarUsuario(id) {
    const { rows } = await pool.query('SELECT rol FROM usuarios WHERE id=$1', [id]);
    if (!rows.length) throw new Error('compañero inexistente');
    if (rows[0].rol === 'admin') {
      const { rows: admins } = await pool.query("SELECT COUNT(*)::int AS n FROM usuarios WHERE rol='admin'");
      if (admins[0].n <= 1) throw new Error('no se puede borrar el último admin');
    }
    await pool.query('DELETE FROM usuarios WHERE id=$1', [id]);
    return true;
  }

  return {
    init, getPlano, getEstados, setForzador, bulkCamara, setNotaCamara, getHistorial,
    getUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario
  };
}

const driver = (process.env.DB_DRIVER || 'file').toLowerCase();
module.exports = driver === 'pg' ? pgStore() : fileStore();
module.exports.ESTADOS = ESTADOS;
