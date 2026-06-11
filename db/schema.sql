-- =====================================================================
--  ESQUEMA PostgreSQL — Relevamiento de forzadores · Sala de Máquinas
--  Datos compartidos multiusuario. Se siembra desda db/layout.js
--  vía  npm run seed.
-- =====================================================================

CREATE TABLE IF NOT EXISTS camaras (
  num          INTEGER PRIMARY KEY,
  columna      CHAR(1)      NOT NULL,          -- 'L' / 'R'
  proceso      TEXT         NOT NULL DEFAULT 'enfriado',
  orden        INTEGER      NOT NULL,
  total_forz   INTEGER      NOT NULL
);

CREATE TABLE IF NOT EXISTS evaporadores (
  id           TEXT PRIMARY KEY,               -- 'E-28-1'
  camara_num   INTEGER NOT NULL REFERENCES camaras(num) ON DELETE CASCADE,
  etiqueta     TEXT    NOT NULL,               -- 'E1'
  pared        CHAR(1) NOT NULL,               -- 'T' / 'B'
  orden        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forzadores (
  id           TEXT PRIMARY KEY,               -- 'F-28-05'
  evap_id      TEXT    NOT NULL REFERENCES evaporadores(id) ON DELETE CASCADE,
  camara_num   INTEGER NOT NULL REFERENCES camaras(num) ON DELETE CASCADE,
  n_local      INTEGER NOT NULL,
  n_global     INTEGER NOT NULL,
  -- estado ACTUAL (último relevamiento)
  estado       TEXT    NOT NULL DEFAULT 'sin_relevar'
                 CHECK (estado IN ('sin_relevar','ok','revisar','falla')),
  operador     TEXT,
  nota         TEXT,
  actualizado  TIMESTAMPTZ
);

-- Auditoría: quién cambió qué y cuándo (multiusuario)
CREATE TABLE IF NOT EXISTS historial (
  id           BIGSERIAL PRIMARY KEY,
  forzador_id  TEXT NOT NULL,
  camara_num   INTEGER NOT NULL,
  estado       TEXT NOT NULL,
  operador     TEXT,
  nota         TEXT,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nota por cámara (observaciones de la ronda)
CREATE TABLE IF NOT EXISTS camara_notas (
  camara_num   INTEGER PRIMARY KEY REFERENCES camaras(num) ON DELETE CASCADE,
  nota         TEXT,
  operador     TEXT,
  actualizado  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_forz_camara ON forzadores(camara_num);
CREATE INDEX IF NOT EXISTS idx_hist_ts     ON historial(ts DESC);
CREATE INDEX IF NOT EXISTS idx_forz_act    ON forzadores(actualizado DESC);

-- Compañeros habilitados (login + roles)
CREATE TABLE IF NOT EXISTS usuarios (
  id     SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  pin    TEXT NOT NULL,
  rol    TEXT NOT NULL CHECK (rol IN ('admin','operador','lectura'))
);
