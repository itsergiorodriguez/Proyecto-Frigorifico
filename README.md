# Sala de Máquinas · Relevamiento de Forzadores (multiusuario)

Plano **dinámico** de las cámaras altas (1° piso) para hacer relevamientos de forzadores
entre varios compañeros, **compartiendo los mismos datos** en tiempo real.

- **Frontend:** JavaScript + SVG/CSS. Cada forzador es un ventilador que **gira** según su
  estado (verde = OK girando, ámbar = revisar, rojo = falla detenido, gris = sin relevar).
- **Backend:** Node.js + Express con API REST.
- **Datos:** motor **archivo** (arranca sin instalar nada) o **PostgreSQL** (escalable).
- **Multiusuario:** todos los que apunten al mismo servidor ven y editan el mismo
  relevamiento; se sincroniza solo cada 4 segundos. Queda **historial** de quién cambió qué.

Datos del plano: **13 cámaras · 61 evaporadores · 138 forzadores** (relevados del croquis).

---

## 1) Arranque rápido (sin base de datos)

```bash
npm install
npm start
```

Abrí **http://localhost:3000**. Listo: ya funciona y guarda en `server/data.json`.

> Para que **tus compañeros** usen los mismos datos, el servidor tiene que correr en una
> máquina accesible para todos (una PC en la red de la planta, o un hosting). Cada uno abre
> la IP de esa máquina, por ejemplo `http://192.168.1.50:3000`.

---

## 2) Modo PostgreSQL (recomendado para producción)

1. Creá la base:
   ```bash
   createdb salamaquinas
   ```
2. Configurá el entorno (copiá `.env.example` a `.env` o exportá variables):
   ```bash
   export DB_DRIVER=pg
   export DATABASE_URL=postgres://usuario:clave@localhost:5432/salamaquinas
   ```
3. Sembrá y arrancá:
   ```bash
   npm run seed     # crea tablas y carga las 13 cámaras / 138 forzadores
   npm start
   ```

El esquema está en `db/schema.sql`. El layout (fuente única) en `db/layout.js`.

---

## 3) Cómo se usa

- **Login**: al entrar pedís tu nombre (de la lista de compañeros) y tu PIN de 4 dígitos.
  Tu sesión queda guardada (cookie) hasta que toques tu nombre arriba a la derecha para
  cerrar sesión.
- **Roles**:
  - `admin`: además de operar, ve la pestaña **Administración** para gestionar compañeros
    (alta, edición de PIN/rol, baja).
  - `operador`: puede tocar forzadores, marcar cámaras enteras y dejar notas.
  - `lectura`: ve todo el plano, KPIs, reporte e historial, pero no puede marcar nada
    (se muestra el badge **SOLO LECTURA**).
- **Tocá un forzador** para ciclar su estado: sin relevar → OK → revisar → falla.
- **Acciones por cámara**: "✓ Todos OK" marca la cámara entera; después tocás solo las excepciones.
- **Filtros**: Pendientes / Con falla / A revisar.
- **Reporte**: arma el texto de novedades listo para **WhatsApp**.
- **Historial**: auditoría de los últimos cambios (quién y cuándo) — el nombre es siempre
  el de la sesión, no se puede falsear.
- El punto **"en vivo"** parpadea cuando entran cambios de otro compañero.

### Compañeros y roles

Se gestionan desde la pestaña **Administración** (solo visible para el rol `admin`):
alta, edición de nombre/PIN/rol y baja de compañeros. No hace falta tocar archivos
ni reiniciar el servidor.

**`db/usuarios.js`** es solo la **semilla inicial** (un único `admin` para el primer
arranque); de ahí en adelante los compañeros viven en el store (`server/data.json` o
la tabla `usuarios` en Postgres). No se puede borrar ni degradar al último `admin`.

Las sesiones se guardan en memoria del servidor (se pierden si reinicia).

---

## 4) Escalar / agregar cámaras

Editá **`db/layout.js`** (tabla `CAMARAS`). Cada evaporador es `{ pared:'T'|'B', f:<nº forzadores> }`.
El plano y la base se regeneran a partir de ahí. En PostgreSQL, volvé a correr `npm run seed`
(no pisa lo existente) o aplicá una migración.

---

## 5) API REST

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET  | `/api/usuarios` | - | Lista de nombres de compañeros (para el login) |
| POST | `/api/login` | - | `{nombre, pin}` → setea cookie de sesión |
| POST | `/api/logout` | - | Cierra la sesión |
| GET  | `/api/me` | sesión | Datos de la sesión actual `{nombre, rol}` |
| GET  | `/api/plano` | sesión | Plano completo + estados (para renderizar) |
| GET  | `/api/estados` | sesión | Solo estados (polling de sincronización) |
| POST | `/api/forzador/:id` | operador | `{estado, nota}` |
| POST | `/api/camara/:num/todos` | operador | `{estado}` (marca toda la cámara) |
| POST | `/api/camara/:num/nota` | operador | `{nota}` |
| GET  | `/api/historial?limit=` | sesión | Auditoría |
| GET  | `/api/reporte` | sesión | Resumen + fallas + a revisar |
| GET  | `/api/admin/usuarios` | admin | Lista de compañeros (nombre, PIN, rol) |
| POST | `/api/admin/usuarios` | admin | `{nombre, pin, rol}` → crea un compañero |
| PUT  | `/api/admin/usuarios/:id` | admin | `{nombre, pin, rol}` → edita un compañero |
| DELETE | `/api/admin/usuarios/:id` | admin | Borra un compañero |

`operador` registrado en cambios e historial = nombre de la sesión (no viaja en el body).
El rol `admin` tiene los mismos permisos de `operador` más el acceso a `/api/admin/usuarios`.

---

## 6) Estructura

```
relevamiento-forzadores/
├── db/
│   ├── layout.js      # FUENTE ÚNICA del plano (cámaras/evaporadores/forzadores)
│   └── schema.sql     # esquema PostgreSQL
├── server/
│   ├── index.js       # API Express
│   ├── store.js       # capa de datos (file | pg)
│   └── seed.js        # inicializar/sembrar
└── public/
    ├── index.html
    ├── styles.css
    ├── plano.js       # renderizador SVG dinámico (forzadores que giran)
    └── app.js         # lógica: tocar, sincronizar, reporte
```

---

## 7) Despliegue para el equipo (opciones)

- **PC en la planta (LAN):** corré `npm start` en una PC fija; los demás entran por su IP.
- **Railway / Render / Fly.io:** subí el repo, agregá un PostgreSQL gratis, seteá `DB_DRIVER=pg`
  y `DATABASE_URL`. Te dan una URL pública para todo el equipo.

---

## 8) Seguridad (al exponerlo a internet)

- **Variables sensibles**: `DATABASE_URL` y cualquier secreto van en variables de entorno
  (`.env`, no se sube a git). Nunca se hardcodean en el código.
- **`NODE_ENV=production`**: activalo en el hosting. Con esto el servidor:
  - redirige HTTP → HTTPS,
  - marca la cookie de sesión como `Secure` (solo viaja por HTTPS),
  - agrega cabeceras `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, etc.
- **Login con freno de fuerza bruta**: tras 5 intentos fallidos desde la misma IP, el login
  se bloquea 5 minutos (protege el PIN de 4 dígitos).
- **PINs**: son para identificar al compañero en un equipo chico, no para datos críticos.
  Cambiá el PIN inicial de `Sergio` (`1234`) desde **Administración** apenas despliegues.
- **Errores**: los 500 nunca devuelven detalles internos (mensajes de DB, paths, stack);
  quedan solo en el log del servidor.
- El esquema asume **un solo proxy/balanceador** delante (`trust proxy = 1`), típico en
  Railway/Render/Fly. Si lo corrés expuesto directo a internet sin proxy, no seteés
  `NODE_ENV=production` con `trust proxy` activo o el rate-limit por IP puede ser falseable.
