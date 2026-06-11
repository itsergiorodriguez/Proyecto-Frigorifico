/* =====================================================================
   LAYOUT CANÓNICO — Cámaras altas 1° piso · Sala de Máquinas
   Relevado del croquis. Fuente única de verdad: de acá se siembra
   PostgreSQL y también el store en archivo.
   Cada evaporador: { pared:'T'|'B', f:<nº de forzadores> }
   pared T = pared superior, B = pared inferior.
   Para agregar/editar cámaras: tocá SOLO esta tabla (escalable).
   ===================================================================== */
const CAMARAS = [
  { col: 'L', num: 28, proceso: 'enfriado', evaps: [
      { pared:'T', f:3 }, { pared:'T', f:2 }, { pared:'T', f:3 },
      { pared:'B', f:3 }, { pared:'B', f:3 }, { pared:'B', f:3 }, { pared:'B', f:3 } ] },
  { col: 'L', num: 27, proceso: 'enfriado', evaps: [
      { pared:'B', f:3 }, { pared:'B', f:3 }, { pared:'B', f:3 }, { pared:'B', f:3 } ] },
  { col: 'L', num: 26, proceso: 'enfriado', evaps: [
      { pared:'T', f:3 }, { pared:'T', f:3 }, { pared:'T', f:3 }, { pared:'T', f:3 } ] },
  { col: 'L', num: 25, proceso: 'enfriado', evaps: [
      { pared:'T', f:1 }, { pared:'T', f:1 }, { pared:'T', f:1 }, { pared:'T', f:1 },
      { pared:'B', f:3 }, { pared:'B', f:3 } ] },
  { col: 'L', num: 24, proceso: 'enfriado', evaps: [
      { pared:'T', f:1 }, { pared:'T', f:1 }, { pared:'T', f:1 }, { pared:'T', f:1 },
      { pared:'B', f:3 }, { pared:'B', f:3 } ] },
  { col: 'L', num: 22, proceso: 'enfriado', evaps: [
      { pared:'B', f:2 }, { pared:'B', f:2 } ] },
  { col: 'L', num: 15, proceso: 'enfriado', evaps: [
      { pared:'T', f:1 }, { pared:'T', f:1 }, { pared:'T', f:1 } ] },

  { col: 'R', num: 33, proceso: 'enfriado', evaps: [
      { pared:'T', f:3 }, { pared:'T', f:3 }, { pared:'T', f:2 }, { pared:'T', f:3 },
      { pared:'B', f:3 }, { pared:'B', f:3 }, { pared:'B', f:3 }, { pared:'B', f:3 } ] },
  { col: 'R', num: 32, proceso: 'enfriado', evaps: [
      { pared:'T', f:3 }, { pared:'T', f:3 }, { pared:'T', f:2 }, { pared:'T', f:3 } ] },
  { col: 'R', num: 31, proceso: 'enfriado', evaps: [
      { pared:'T', f:3 }, { pared:'T', f:3 }, { pared:'T', f:2 }, { pared:'T', f:3 } ] },
  { col: 'R', num: 30, proceso: 'enfriado', evaps: [
      { pared:'T', f:1 }, { pared:'T', f:1 }, { pared:'T', f:1 }, { pared:'T', f:1 },
      { pared:'B', f:2 }, { pared:'B', f:2 } ] },
  { col: 'R', num: 29, proceso: 'enfriado', evaps: [
      { pared:'T', f:3 }, { pared:'T', f:2 }, { pared:'T', f:3 }, { pared:'T', f:3 } ] },
  { col: 'R', num: 19, proceso: 'enfriado', evaps: [
      { pared:'T', f:1 }, { pared:'T', f:1 }, { pared:'T', f:1 } ] },
];

/* Expande el layout a una estructura normalizada con IDs estables.
   forzador.id  = "F-<camara>-<nºglobal>"  (ej. F-28-05)
   evaporador.id = "E-<camara>-<orden>"    (ej. E-28-1)
   Devuelve { camaras:[ {num,col,proceso,total, evaporadores:[ {id,etiqueta,pared,orden,
              forzadores:[ {id,n_local,n_global} ] } ]} ] } */
function expandir() {
  const camaras = CAMARAS.map((c, ci) => {
    let global = 0;
    const evaporadores = c.evaps.map((e, ei) => {
      const orden = ei + 1;
      const id = `E-${c.num}-${orden}`;
      const forzadores = [];
      for (let k = 0; k < e.f; k++) {
        global += 1;
        forzadores.push({ id: `F-${c.num}-${String(global).padStart(2,'0')}`, n_local: k + 1, n_global: global });
      }
      return { id, etiqueta: `E${orden}`, pared: e.pared, orden, forzadores };
    });
    return {
      num: c.num, col: c.col, proceso: c.proceso, orden: ci,
      total: global, evaporadores
    };
  });
  return { camaras };
}

/* Lista plana de todos los forzadores (para sembrar/estados) */
function todosLosForzadores() {
  const out = [];
  for (const c of expandir().camaras)
    for (const ev of c.evaporadores)
      for (const f of ev.forzadores)
        out.push({ id: f.id, camara: c.num, evaporador: ev.id, n_global: f.n_global });
  return out;
}

module.exports = { CAMARAS, expandir, todosLosForzadores };
