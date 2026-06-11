/* =====================================================================
   USUARIOS — semilla inicial de compañeros habilitados.
   Se siembra UNA SOLA VEZ (primer arranque); de ahí en adelante los
   compañeros se gestionan desde la pestaña "Administración" (rol admin),
   que guarda los cambios en el store (archivo o Postgres).
   rol: 'admin' (gestiona compañeros + opera) | 'operador' (opera) | 'lectura' (solo ve).
   ===================================================================== */
const USUARIOS = [
  { nombre: 'Sergio', pin: '1234', rol: 'admin' },
];

module.exports = { USUARIOS };
