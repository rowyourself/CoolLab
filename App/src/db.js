// Base de datos SQLite (un solo archivo, ideal para hostear en tu propio computador)
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'coollab.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','supervisor','tecnico')),
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rut TEXT,
  address TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  lat REAL,
  lng REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Equipos de frío instalados en cada cliente (cámaras, chillers, racks, túneles...)
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,            -- camara_conservacion, camara_congelado, tunel, chiller, rack, vitrina, otro
  brand TEXT,
  model TEXT,
  serial TEXT,
  refrigerant TEXT,              -- R404A, R134a, R410A, R507A, R744 (CO2), R717 (NH3)...
  charge_kg REAL,
  setpoint_c REAL,               -- temperatura objetivo
  tolerance_c REAL DEFAULT 2,    -- rango aceptable +/-
  rh_min REAL,                   -- humedad relativa objetivo (opcional)
  rh_max REAL,
  installed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  equipment_id INTEGER REFERENCES equipment(id),
  technician_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('reparacion','mantencion','rutinaria','implementacion')),
  status TEXT NOT NULL DEFAULT 'en_curso' CHECK (status IN ('en_curso','finalizada','anulada')),
  priority TEXT DEFAULT 'normal',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  start_lat REAL, start_lng REAL,
  end_lat REAL, end_lng REAL,
  weather_start TEXT,           -- JSON clima exterior al iniciar (API)
  weather_end TEXT,             -- JSON clima exterior al terminar (API)
  reason TEXT,                  -- motivo / falla reportada
  diagnosis TEXT,
  actions TEXT,
  parts_used TEXT,              -- JSON [{name, qty}]
  recommendations TEXT,
  checklist TEXT,               -- JSON [{item, ok, note}]
  result TEXT CHECK (result IN ('operativo','operativo_obs','fuera_servicio','pendiente') OR result IS NULL),
  downtime_hours REAL,          -- horas que el equipo estuvo detenido (reparaciones)
  refrigerant_added_kg REAL,
  client_signer TEXT,
  client_signature TEXT,        -- dataURL PNG
  client_rating INTEGER,        -- 1..5
  next_visit_date TEXT,
  report_token TEXT,            -- token público para ver el informe vía QR
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  point TEXT,                   -- ubicación / punto de medición
  phase TEXT DEFAULT 'inicial', -- inicial | final
  taken_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  caption TEXT,
  stage TEXT DEFAULT 'durante',   -- antes | durante | despues
  taken_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_visits_tech ON visits(technician_id);
CREATE INDEX IF NOT EXISTS idx_visits_client ON visits(client_id);
CREATE INDEX IF NOT EXISTS idx_visits_started ON visits(started_at);
CREATE INDEX IF NOT EXISTS idx_meas_visit ON measurements(visit_id);
CREATE INDEX IF NOT EXISTS idx_photos_visit ON photos(visit_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// Migraciones: columnas nuevas para el registro de asistencia (ubicación al iniciar / terminar)
const cols = db.prepare('PRAGMA table_info(visits)').all().map((c) => c.name);
[
  ['start_accuracy', 'REAL'], ['end_accuracy', 'REAL'],          // precisión GPS en metros
  ['start_address', 'TEXT'], ['end_address', 'TEXT'],            // dirección aproximada
  ['start_distance_m', 'REAL'], ['end_distance_m', 'REAL'],      // distancia a la ubicación registrada del cliente
  ['start_no_gps_reason', 'TEXT'], ['end_no_gps_reason', 'TEXT'],
  ['created_by', 'INTEGER'], ['manual_entry', 'INTEGER DEFAULT 0'],   // registro manual hecho por un administrador
].forEach(([n, t]) => { if (!cols.includes(n)) db.exec(`ALTER TABLE visits ADD COLUMN ${n} ${t}`); });

// Equipos de trabajo: cada técnico puede tener un supervisor a cargo
const ucols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!ucols.includes('supervisor_id')) db.exec('ALTER TABLE users ADD COLUMN supervisor_id INTEGER REFERENCES users(id)');

// Solicitudes de visita: el supervisor las crea y asigna; el técnico las ejecuta (se convierten en visita)
db.exec(`
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                 -- SOL-2026-00001
  type TEXT NOT NULL CHECK (type IN ('reparacion','mantencion','rutinaria','implementacion')),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  equipment_id INTEGER REFERENCES equipment(id),
  technician_id INTEGER REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'normal',
  scheduled_date TEXT,                       -- fecha programada (YYYY-MM-DD)
  description TEXT,                          -- motivo / falla / alcance
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','asignada','en_curso','completada','cancelada')),
  visit_id INTEGER REFERENCES visits(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_req_tech ON requests(technician_id);
CREATE INDEX IF NOT EXISTS idx_req_status ON requests(status);
`);
if (!db.prepare('PRAGMA table_info(visits)').all().some((c) => c.name === 'request_id')) db.exec('ALTER TABLE visits ADD COLUMN request_id INTEGER');

module.exports = db;
