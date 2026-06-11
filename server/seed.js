/* Siembra/recrea la base. Útil para PostgreSQL:
   DB_DRIVER=pg DATABASE_URL=... npm run seed
   Con el motor archivo simplemente inicializa data.json. */
process.env.DB_DRIVER = process.env.DB_DRIVER || 'file';
const store = require('./store');
store.init()
  .then(() => { console.log(`Base inicializada (motor: ${process.env.DB_DRIVER}).`); process.exit(0); })
  .catch(e => { console.error('Error al sembrar:', e); process.exit(1); });
