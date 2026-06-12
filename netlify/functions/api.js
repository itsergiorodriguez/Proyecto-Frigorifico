// NETLIFY FUNCTION - Sala de Maquinas NH3
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const { expandir, todosLosForzadores } = require('../../db/layout');
const { USUARIOS } = require('../../db/usuarios');
const ESTADOS = ['sin_relevar','ok','revisar','falla'];
const ROLES = ['admin','operador','lectura'];
const sesiones = new Map();
const intentos = new Map();
const COOKIE = 'mv_sid';
function cors(h={}) { return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Cookie','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Content-Type':'application/json',...h}; }
function ok(d,c=200){return{statusCode:c,headers:cors(),body:JSON.stringify(d)};}
function err(m,c=400){return{statusCode:c,headers:cors(),body:JSON.stringify({error:m})};}
function parseCookies(h=''){return Object.fromEntries(h.split(';').map(c=>c.trim().split('=').map(s=>s.trim())));}
function getSession(ev){const c=parseCookies(ev.headers.cookie||ev.headersh.Cookie||'');const s=c[COOKIE];return s?sesiones.get(s):null;}
function rnd(){return Math.random().toString(36).slice(2)+Date.now().toString(36);}
let seeded=false;
async function seed(){
  if(seeded)return;
  const{rows}=await pool.query('SELECT COUNT(*) c FROM }))}))}));camaras');
  if(+rows[0].c>0){seeded=true;return;}
  const{camaras}=expandir();
  for(const c of camaras){
    await pool.query('INSERT INTO camaras(num,columna,proceso,orden,total_forz)VALUES($1,$2,$3,$4,$5)ON CONFLICT DO NOTHING',[c.num,c.columna,c.proceso,c.orden,c.total]);
    for(const ev of c.evaporadores){
      await pool.query('INSERT INTO evaporadores(id,camara_num,etiqueta,pared,orden)VALUES($1,$2,$3,$4,$5)ON CONFLICT DO NOTHING',[ev.id,c.num,ev.etiqueta,ev.pared,ev.orden]);
      for(const f of ev.forzadores)await pool.query('INSERT INTO forzadores(id,evap_id,camara_num,n_local,n_global,estado)VALUES($1,$2,$3,$4,$5,$6)ON CONFLICT DO NOTHING',[f.id,ev.id,c.num,f.n_local,f.n_global,'sin_relevar']);
    }
  }
  for(const u of USUARIOS)await pool.query('INSERT INTO usuarios(nombre,pin,rol)VALUES($1,$2,$3)ON CONFLICT DO NOTHING',[u.nombre,String(u.pin),u.rol]);
  seeded=true;
}
exports.handler=async function(event){
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:cors()};
  try{await seed();}catch(e){console.error('seed:',e.message);}
  const m=event.httpMethod;
  const p=(event.path.replace(/^\/.netlify\/functions\/api/,'').replace(/^\/api/,'')||'/').split('/').filter(Boolean);
  const b=event.body?JSON.parse(event.body):{};
  const q=event.queryStringParameters||{};
  const s=getSession(event);
  try{
    if(m==='GET'&&p[0]==='plano'){
      const cc=expandir().camaras;const ids=todosLosForzadores().map(f=>f.id);
      if(!ids.length)return ok({camaras:cc});
      const{rows}=await pool.query('SELECT id,estado,operador,nota,actualizado FROM forzadores WHERE id=ANY($1)',[ids]);
      const st=Object.fromEntries(rows.map(r=>[r.id,r]));
      return ok({camaras:cc.map(c=>({...c,evaporadores:c.evaporadores.map(ev=>({...ev,forzadores:ev.forzadores.map(f=>({...f,...(st[f.id]||{estado:'sin_relevar',operador:null,nota:null})}))}))}))});
    }
    if(m==='GET'&&p[0]==='estados'){const{rows}=await pool.query('SELECT id,estado,operador,nota,actualizado FROM forzadores');return ok(rows);}
    if(m==='GET'&&p[0]==='historial'){const{rows}=await pool.query('SELECT * FROM historial ORDER BY ts DESC LIMIT $1',[+q.limit||100]);return ok(rows);}
    if(m==='GET'&&p[0]==='me'){if(!s)return err('No autenticado',401);return ok({nombre:s.nombre,rol:s.rol});}
    if(m==='GET'&&p[0]==='usuarios'){if(!s||s.rol!=='admin')return err('Sin permiso',403);const{rows}=await pool.query('SELECT id,nombre,rol FROM usuarios ORDER BY nombre');return ok(rows);}
    if(m==='POST'&&p[0]==='forzador'){if(!s)return err('No autenticado',401);if(s.rol==='lectura')return err('Sin permiso',403);const{id,estado,operador,nota}=b;if(!id||!ESTADOS.includes(estado))return err('Datos invalidos');const op=operador||s.nombre;const ts=new Date().toISOString();await pool.query('UPDATE forzadores SET estado=$1,operador=$2,nota=$3,actualizado=$4 WHERE id=$5',[estado,op,nota||null,ts,id]);const{rows:r2}=await pool.query('SELECT camara_num FROM forzadores WHERE id=$1',[id]);await pool.query('INSERT INTO historial(forzador_id,camara_num,estado,operador,nota)VALUES($1,$2,$3,$4,$5)',[id,r2[0]?.camara_num,estado,op,nota||null]);return ok({ok:true});}
    if(m==='POST'&&p[0]==='camara'&&p[1]==='bulk'){if(!s)return err('No autenticado',401);if(s.rol==='lectura')return err('Sin permiso',403);const{num,estado,operador,nota}=b;if(!num||!ESTADOS.includes(estado))return err('Datos invalidos');const op=operador||s.nombre;const ts=new Date().toISOString();const{rows:fz}=await pool.query('SELECT id FROM forzadores WHERE camara_num=$1',[num]);for(const f of fz){await pool.query('UPDATE forzadores SET estado=$1,operador=$2,nota=$3,actualizado=$4 WHERE id=$5',[estado,op,nota||null,ts,f.id]);await pool.query('INSERT INTO historial(forzador_id,camara_num,estado,operador,nota)VALUES($1,$2,$3,$4,$5)',[f.id,num,estado,op,nota||null]);}return ok({ok:true,actualizados:fz.length});}
    if(m==='POST'&&p[0]==='camara'&&p[1]==='nota'){if(!s)return err('No autenticado',401);if(s.rol==='lectura')return err('Sin permiso',403);const{num,nota,operador}=b;const op=operador||s.nombre;const ts=new Date().toISOString();await pool.query('INSERT INTO camara_notas(camara_num,nota,operador,actualizado)VALUES($1,$2,$3,$4)ON CONFLICT(camara_num)DO UPDATE SET nota=$2,operador=$3,actualizado=$4',[num,nota,op,ts]);return ok({ok:true});}
    if(m==='POST'&&p[0]==='login'){const ip=event.headers['x-forwarded-for']||'unknown';const bloq=intentos.get(ip);if(bloq&&bloq.b>Date.now())return err('Demasiados intentos',429);const{nombre,pin}=b;if(!nombre||!pin)return err('Faltan datos');const{rows}=await pool.query('SELECT * FROM usuarios WHERE nombre=$1',[nombre.trim()]);const u=rows[0];if(!u||String(u.pin)!==String(pin)){const r=intentos.get(ip)||{f:0,b:0};r.f++;if(r.f>=5)r.b=Date.now()+300000;intentos.set(ip,r);return err('Credenciales invalidas',401);}intentos.delete(ip);const sid=rnd();sesiones.set(sid,{nombre:u.nombre,rol:u.rol});return{statusCode:200,headers:{...cors(),'Set-Cookie':COOKIE+'='+sid+'; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=2592000'},body:JSON.stringify({ok:true,nombre:u.nombre,rol:u.rol})};}
    if(m==='POST'&&p[0]==='logout'){const c=parseCookies(event.headers.cookie||'');const sid=c[COOKIE];if(sid)sesiones.delete(sid);return{statusCode:200,headers:{...cors(),'Set-Cookie':COOKIE+'=; HttpOnly; Path=/; Max-Age=0'},body:JSON.stringify({ok:true})};}
    if(m==='POST'&&p[0]==='usuarios'){if(!s||s.rol!=='admin')return err('Sin permiso',403);const{nombre,pin,rol}=b;if(!nombre||!pin||!ROLES.includes(rol))return err('Datos invalidos');try{await pool.query('INSERT INTO usuarios(nombre,pin,rol)VALUES($1,$2,$3)',[nombre.trim(),String(pin),rol]);return ok({ok:true},201);}catch(e){if(e.code==='23505')return err('Nombre ya existe');throw e;}}
    if(m==='PUT'&&p[0]==='usuarios'&&p[1]){if(!s||s.rol!=='admin')return err('Sin permiso',403);const{nombre,pin,rol}=b;const sets=[];const vals=[];if(nombre){sets.push('nombre=$'+(sets.length+1));vals.push(nombre.trim());}if(pin){sets.push('pin=$'+(sets.length+1));vals.push(String(pin));}if(rol){sets.push('rol=$'+(sets.length+1));vals.push(rol);}if(!sets.length)return err('Nada que actualizar');vals.push(p[1]);await pool.query('UPDATE usuarios SET '+sets.join(',')+'WHERE id=$'+vals.length,vals);return ok({ok:true});}
    if(m==='DELETE'&&p[0]==='usuarios'&&p[1]){if(!s||s.rol!=='admin')return err('Sin permiso',403);await pool.query('DELETE FROM usuarios WHERE id=$1',[p[1]]);return ok({ok:true});}
    return err('Ruta no encontrada',404);
  }catch(e){console.error('API:',e.message,e.stack);return err('Error interno',500);}
};
