const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const db = require('./db');
const cat = require('./catalog');
const { issue, requireAuth, requireRole, hash, check } = require('./auth');
const { getWeather } = require('./weather');
const { visitKpis, fleetKpis } = require('./kpis');
const { buildReport } = require('./pdf');
const { distanceM, reverseGeocode, searchAddress, suggestAddress, GEOFENCE_M } = require('./geo');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const r = express.Router();
const isStaff = (u) => u.role === 'admin' || u.role === 'supervisor';
const num = (x) => (x === '' || x == null || isNaN(+x) ? null : +x);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Auth ----------
r.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(String(email || '').toLowerCase().trim());
  if (!u || !check(password || '', u.password_hash)) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  issue(res, u);
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role });
});
r.post('/auth/logout', (req, res) => { res.clearCookie('cl_token'); res.json({ ok: true }); });

// Informe público vía QR (sin login) — solo lectura del PDF
r.get('/public/report/:token', wrap(async (req, res) => {
  const v = db.prepare("SELECT id FROM visits WHERE report_token=? AND status='finalizada'").get(req.params.token);
  if (!v) return res.status(404).send('Informe no encontrado');
  await sendPdf(v.id, req, res);
}));

r.use(requireAuth);

r.get('/me', (req, res) => res.json(req.user));
r.put('/me/password', (req, res) => {
  const { current, next } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!check(current || '', u.password_hash)) return res.status(400).json({ error: 'Contraseña actual incorrecta' });
  if (!next || next.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash(next), u.id);
  res.json({ ok: true });
});

r.get('/catalog', (req, res) => res.json({
  visitTypes: cat.VISIT_TYPES, results: cat.RESULTS, equipmentKinds: cat.EQUIPMENT_KINDS,
  measurements: cat.MEASUREMENTS, refrigerants: Object.keys(cat.REFRIGERANTS), checklists: cat.CHECKLISTS, photoGuide: cat.PHOTO_GUIDE,
  company: { name: process.env.COMPANY_NAME || 'Mi Empresa de Refrigeración' },
}));

// Mapa para marcar ubicación: buscar dirección y obtener dirección de un punto
r.get('/geo/search', wrap(async (req, res) => res.json(await searchAddress(String(req.query.q || '').slice(0, 200)))));
r.get('/geo/suggest', wrap(async (req, res) => {
  const lat = num(req.query.lat), lng = num(req.query.lng);
  res.json(await suggestAddress(String(req.query.q || ''), lat != null && lng != null ? { lat, lng } : null));
}));
r.get('/geo/reverse', wrap(async (req, res) => res.json({ address: await reverseGeocode(num(req.query.lat), num(req.query.lng)) })));
r.get('/weather', wrap(async (req, res) => res.json(await getWeather(num(req.query.lat), num(req.query.lng)))));

// ---------- Usuarios ----------
r.get('/users', (req, res) => {
  const q = isStaff(req.user) ? `SELECT u.id,u.name,u.email,u.role,u.phone,u.active,u.created_at,u.supervisor_id,s.name AS supervisor_name
      FROM users u LEFT JOIN users s ON s.id=u.supervisor_id ORDER BY u.name`
    : "SELECT id,name,role FROM users WHERE id=" + req.user.id;
  res.json(db.prepare(q).all());
});
// Supervisor asignado (solo técnicos tienen supervisor)
function supervisorFor(role, supId) {
  if (role !== 'tecnico' || !num(supId)) return null;
  const s = db.prepare("SELECT id FROM users WHERE id=? AND role IN ('supervisor','admin')").get(num(supId));
  return s ? s.id : null;
}
const ROLES = ['admin', 'supervisor', 'tecnico'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Asigna una lista de técnicos a un supervisor (solo técnicos existentes)
function assignTechs(supId, ids) {
  const st = db.prepare("UPDATE users SET supervisor_id=? WHERE id=? AND role='tecnico'");
  (Array.isArray(ids) ? ids : []).map(num).filter(Boolean).forEach((t) => st.run(supId, t));
}
// El administrador crea cuentas de técnicos, supervisores u otros administradores
r.post('/users', requireRole('admin'), (req, res) => {
  const { name, email, password, role, phone, supervisor_id, technician_ids } = req.body || {};
  const rl = role || 'tecnico';
  const mail = String(email || '').toLowerCase().trim();
  if (!String(name || '').trim() || !mail || !password || password.length < 8) return res.status(400).json({ error: 'Nombre, correo y contraseña (mín. 8 caracteres) son obligatorios' });
  if (!ROLES.includes(rl)) return res.status(400).json({ error: 'Rol no válido' });
  if (!EMAIL_RE.test(mail)) return res.status(400).json({ error: 'El correo no es válido' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(mail)) return res.status(400).json({ error: 'Ese correo ya está registrado' });
  const id = db.transaction(() => {
    const info = db.prepare('INSERT INTO users(name,email,password_hash,role,phone,supervisor_id) VALUES(?,?,?,?,?,?)')
      .run(String(name).trim(), mail, hash(password), rl, phone || null, supervisorFor(rl, supervisor_id));
    if (rl === 'supervisor' || rl === 'admin') assignTechs(info.lastInsertRowid, technician_ids);
    return info.lastInsertRowid;
  })();
  res.json({ id });
});
r.put('/users/:id', requireRole('admin'), (req, res) => {
  const { name, role, phone, active, password, supervisor_id } = req.body || {};
  const cur = db.prepare('SELECT role,active FROM users WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Rol no válido' });
  if (password && password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  // Nunca dejar el sistema sin un administrador activo
  const losesAdmin = cur.role === 'admin' && cur.active && ((role && role !== 'admin') || active === false || active === 0);
  if (losesAdmin && db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get().n <= 1)
    return res.status(400).json({ error: 'Debe quedar al menos un administrador activo' });
  const rl = role || cur.role;
  db.prepare('UPDATE users SET name=COALESCE(?,name), role=COALESCE(?,role), phone=?, active=COALESCE(?,active) WHERE id=?')
    .run(name ?? null, role ?? null, phone ?? null, active == null ? null : active ? 1 : 0, req.params.id);
  if ('supervisor_id' in req.body || role) db.prepare('UPDATE users SET supervisor_id=? WHERE id=?').run(supervisorFor(rl, supervisor_id), req.params.id);
  // Si deja de ser supervisor/admin, sus técnicos quedan sin supervisor
  if (rl === 'tecnico' && cur.role !== 'tecnico') db.prepare('UPDATE users SET supervisor_id=NULL WHERE supervisor_id=?').run(req.params.id);
  if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash(password), req.params.id);
  if (rl !== 'tecnico' && Array.isArray(req.body.technician_ids)) {
    db.prepare("UPDATE users SET supervisor_id=NULL WHERE supervisor_id=? AND role='tecnico'").run(req.params.id);
    assignTechs(+req.params.id, req.body.technician_ids);
  }
  res.json({ ok: true });
});

// ---------- Equipo de trabajo (técnicos a cargo) ----------
// Admin: todos los técnicos. Supervisor: solo los técnicos asignados a él.
const teamIds = (u) => (u.role === 'admin' ? null : db.prepare("SELECT id FROM users WHERE role='tecnico' AND supervisor_id=?").all(u.id).map((x) => x.id));
const inTeam = (u, techId) => u.role === 'admin' || (u.role === 'supervisor' && teamIds(u).includes(+techId));
r.get('/team', requireRole('admin', 'supervisor'), (req, res) => {
  const mine = req.user.role === 'supervisor';
  res.json(db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.active,u.supervisor_id,s.name AS supervisor_name,
      (SELECT COUNT(*) FROM requests r WHERE r.technician_id=u.id AND r.status='asignada') AS asignadas,
      (SELECT COUNT(*) FROM requests r WHERE r.technician_id=u.id AND r.status IN ('asignada','en_curso') AND r.scheduled_date < date('now','localtime')) AS atrasadas,
      (SELECT COUNT(*) FROM visits v WHERE v.technician_id=u.id AND v.status='en_curso') AS en_curso,
      (SELECT COUNT(*) FROM visits v WHERE v.technician_id=u.id AND v.status='finalizada' AND v.started_at >= date('now','-30 days')) AS visitas_30d,
      (SELECT ROUND(AVG((julianday(v.ended_at)-julianday(v.started_at))*1440)) FROM visits v WHERE v.technician_id=u.id AND v.status='finalizada' AND v.started_at >= date('now','-30 days')) AS dur_prom_min,
      (SELECT ROUND(AVG(v.client_rating),1) FROM visits v WHERE v.technician_id=u.id AND v.client_rating IS NOT NULL) AS satisfaccion,
      (SELECT MAX(v.started_at) FROM visits v WHERE v.technician_id=u.id) AS ultima_visita
    FROM users u LEFT JOIN users s ON s.id=u.supervisor_id
    WHERE u.role='tecnico' ${mine ? 'AND u.supervisor_id=@me' : ''} ORDER BY u.active DESC, u.name`).all(mine ? { me: req.user.id } : {}));
});

// ---------- Clientes y equipos ----------
r.get('/clients', (req, res) => res.json(db.prepare(`
  SELECT c.*, (SELECT COUNT(*) FROM equipment e WHERE e.client_id=c.id) AS equipos,
         (SELECT COUNT(*) FROM visits v WHERE v.client_id=c.id) AS visitas
  FROM clients c ORDER BY c.name`).all()));
r.post('/clients', requireRole('admin', 'supervisor', 'tecnico'), (req, res) => {
  const b = req.body;
  if (!b.name) return res.status(400).json({ error: 'El nombre de la empresa es obligatorio' });
  const info = db.prepare('INSERT INTO clients(name,rut,address,contact_name,contact_email,contact_phone,lat,lng) VALUES(?,?,?,?,?,?,?,?)')
    .run(b.name, b.rut || null, b.address || null, b.contact_name || null, b.contact_email || null, b.contact_phone || null, num(b.lat), num(b.lng));
  res.json({ id: info.lastInsertRowid });
});
r.put('/clients/:id', requireRole('admin', 'supervisor'), (req, res) => {
  const b = req.body;
  db.prepare('UPDATE clients SET name=?,rut=?,address=?,contact_name=?,contact_email=?,contact_phone=?,lat=?,lng=? WHERE id=?')
    .run(b.name, b.rut || null, b.address || null, b.contact_name || null, b.contact_email || null, b.contact_phone || null, num(b.lat), num(b.lng), req.params.id);
  res.json({ ok: true });
});
r.get('/clients/:id/equipment', (req, res) => res.json(db.prepare('SELECT * FROM equipment WHERE client_id=? ORDER BY name').all(req.params.id)));
r.post('/equipment', (req, res) => {
  const b = req.body;
  if (!b.client_id || !b.name) return res.status(400).json({ error: 'Cliente y nombre del equipo son obligatorios' });
  const info = db.prepare(`INSERT INTO equipment(client_id,name,kind,brand,model,serial,refrigerant,charge_kg,setpoint_c,tolerance_c,rh_min,rh_max,installed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.client_id, b.name, b.kind || 'otro', b.brand || null, b.model || null, b.serial || null,
    b.refrigerant || null, num(b.charge_kg), num(b.setpoint_c), num(b.tolerance_c) ?? 2, num(b.rh_min), num(b.rh_max), b.installed_at || null);
  res.json({ id: info.lastInsertRowid });
});
r.put('/equipment/:id', requireRole('admin', 'supervisor'), (req, res) => {
  const b = req.body;
  db.prepare(`UPDATE equipment SET name=?,kind=?,brand=?,model=?,serial=?,refrigerant=?,charge_kg=?,setpoint_c=?,tolerance_c=?,rh_min=?,rh_max=? WHERE id=?`)
    .run(b.name, b.kind, b.brand || null, b.model || null, b.serial || null, b.refrigerant || null, num(b.charge_kg), num(b.setpoint_c), num(b.tolerance_c) ?? 2, num(b.rh_min), num(b.rh_max), req.params.id);
  res.json({ ok: true });
});

// ---------- Visitas ----------
function loadVisit(id, user) {
  const v = db.prepare(`SELECT v.*, c.name AS client_name, c.address AS client_address, c.rut AS client_rut, c.contact_name,
      u.name AS tech_name, u.email AS tech_email, rq.code AS request_code
    FROM visits v JOIN clients c ON c.id=v.client_id JOIN users u ON u.id=v.technician_id LEFT JOIN requests rq ON rq.id=v.request_id WHERE v.id=?`).get(id);
  if (!v) return null;
  if (user && !isStaff(user) && v.technician_id !== user.id) return null;
  return v;
}
// El técnico solo modifica su visita mientras está en curso; un administrador puede corregir siempre
const canEdit = (v, user) => isStaff(user) || (v.status === 'en_curso' && v.technician_id === user.id);
const LOCKED = { error: 'La visita ya fue finalizada: solo un administrador puede modificarla' };

// Registro de asistencia: dónde y cuándo se presionó Iniciar y Terminar
function attendance(v) {
  const ev = (p) => ({
    at: p === 'start' ? v.started_at : v.ended_at,
    lat: v[p + '_lat'], lng: v[p + '_lng'], accuracy: v[p + '_accuracy'], address: v[p + '_address'],
    distance_m: v[p + '_distance_m'], no_gps_reason: v[p + '_no_gps_reason'],
    inside: v[p + '_distance_m'] != null ? v[p + '_distance_m'] <= GEOFENCE_M : null,
  });
  const start = ev('start'), end = v.ended_at ? ev('end') : null;
  let verified = 'pendiente';
  if (end) {
    if (start.lat == null || end.lat == null) verified = 'sin_gps';
    else if (start.inside === false || end.inside === false) verified = 'fuera_rango';
    else if (start.inside && end.inside) verified = 'verificada';
    else verified = 'sin_referencia';
  }
  return { start, end, verified, geofence_m: GEOFENCE_M, manual: !!v.manual_entry };
}

function fullVisit(id, user) {
  const v = loadVisit(id, user);
  if (!v) return null;
  const equipment = v.equipment_id ? db.prepare('SELECT * FROM equipment WHERE id=?').get(v.equipment_id) : null;
  const measurements = db.prepare('SELECT * FROM measurements WHERE visit_id=? ORDER BY taken_at').all(id);
  const photos = db.prepare('SELECT * FROM photos WHERE visit_id=? ORDER BY taken_at').all(id);
  const { kpis, alerts } = visitKpis(v, measurements, equipment);
  ['weather_start', 'weather_end', 'checklist', 'parts_used'].forEach((k) => { v[k] = v[k] ? JSON.parse(v[k]) : null; });
  return { ...v, equipment, measurements, photos, kpis, alerts, attendance: attendance(v) };
}

function nextFolio() {
  const y = new Date().getFullYear();
  const row = db.prepare("SELECT COUNT(*) n FROM visits WHERE folio LIKE ?").get(`OT-${y}-%`);
  let n = row.n + 1, f;
  do { f = `OT-${y}-${String(n++).padStart(5, '0')}`; } while (db.prepare('SELECT 1 FROM visits WHERE folio=?').get(f));
  return f;
}
r.get('/visits/next-folio', (req, res) => res.json({ folio: nextFolio() }));

r.get('/visits', (req, res) => {
  const w = []; const p = {};
  if (!isStaff(req.user)) { w.push('v.technician_id=@me'); p.me = req.user.id; }
  else if (req.query.technician_id) { w.push('v.technician_id=@t'); p.t = +req.query.technician_id; }
  if (req.query.client_id) { w.push('v.client_id=@c'); p.c = +req.query.client_id; }
  if (req.query.status) { w.push('v.status=@s'); p.s = req.query.status; }
  if (req.query.type) { w.push('v.type=@ty'); p.ty = req.query.type; }
  if (req.query.from) { w.push('v.started_at>=@from'); p.from = req.query.from; }
  if (req.query.to) { w.push('v.started_at<=@to'); p.to = req.query.to + 'T23:59:59'; }
  if (req.query.q) { w.push('(v.folio LIKE @q OR c.name LIKE @q)'); p.q = `%${req.query.q}%`; }
  const rows = db.prepare(`SELECT v.id,v.folio,v.type,v.status,v.result,v.started_at,v.ended_at,v.client_rating,
      c.name AS client_name, u.name AS tech_name, e.name AS equipment_name,
      (SELECT COUNT(*) FROM photos ph WHERE ph.visit_id=v.id) AS fotos
    FROM visits v JOIN clients c ON c.id=v.client_id JOIN users u ON u.id=v.technician_id LEFT JOIN equipment e ON e.id=v.equipment_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY v.started_at DESC LIMIT ${Math.min(+req.query.limit || 200, 1000)}`).all(p);
  res.json(rows);
});

// Sello de ubicación para iniciar / terminar: coordenadas, precisión, dirección y distancia a la empresa
async function locationStamp(b, client) {
  const lat = num(b.lat), lng = num(b.lng);
  if (lat == null || lng == null) return { lat: null, lng: null, acc: null, address: null, dist: null, reason: (b.no_gps_reason || 'Ubicación no disponible en el dispositivo').slice(0, 200) };
  const address = await reverseGeocode(lat, lng);
  return { lat, lng, acc: num(b.accuracy), address, dist: client?.lat != null ? distanceM(lat, lng, client.lat, client.lng) : null, reason: null };
}

// Iniciar visita (botón "Iniciar visita"): la hora la pone el servidor; se registra GPS, dirección y clima exterior
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
// Toda visita nace de una solicitud (autorización previa):
// - el técnico NO puede crear visitas directas: las inicia desde una solicitud asignada (POST /requests/:id/start)
// - un supervisor/administrador que registra una visita a mano genera automáticamente su solicitud
r.post('/visits', wrap(async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Las visitas solo se inician desde una solicitud asignada. Pide a tu supervisor que te asigne una.' });
  let reqId = null;
  try {
    const b = req.body || {};
    if (!b.client_id || !cat.VISIT_TYPES[b.type]) throw new HttpError(400, 'Empresa y tipo de visita son obligatorios');
    const tech = validateAssign(req.user, b.technician_id);
    if (!tech) throw new HttpError(400, 'Indica el técnico que realizó la visita');
    reqId = db.prepare(`INSERT INTO requests(code,type,client_id,equipment_id,technician_id,priority,scheduled_date,description,status,created_by)
      VALUES(?,?,?,?,?,?,date('now','localtime'),?,'asignada',?)`).run(nextRequestCode(), b.type, +b.client_id, num(b.equipment_id), tech,
      b.priority || 'normal', (b.reason || '').trim() || 'Registro manual de visita', req.user.id).lastInsertRowid;
    const v = await createVisit({ ...b, technician_id: tech }, req.user, reqId);
    db.prepare("UPDATE requests SET status='en_curso', visit_id=?, updated_at=datetime('now') WHERE id=?").run(v.id, reqId);
    res.json(v);
  } catch (e) {
    if (reqId) db.prepare("DELETE FROM requests WHERE id=? AND visit_id IS NULL").run(reqId); // no dejar solicitudes huérfanas
    if (e.status) return res.status(e.status).json({ error: e.message }); throw e;
  }
}));
async function createVisit(b, user, requestId = null) {
  if (!b.client_id || !b.type) throw new HttpError(400, 'Empresa y tipo de visita son obligatorios');
  if (!cat.VISIT_TYPES[b.type]) throw new HttpError(400, 'Tipo de visita inválido');
  const folio = (b.folio || '').trim() || nextFolio();
  if (db.prepare('SELECT 1 FROM visits WHERE folio=?').get(folio)) throw new HttpError(400, `El folio ${folio} ya existe`);
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(b.client_id);
  if (!client) throw new HttpError(400, 'Empresa no encontrada');
  const req = { user };
  const loc = await locationStamp(b, client);
  const wx = await getWeather(loc.lat ?? client.lat, loc.lng ?? client.lng);
  const checklist = (cat.CHECKLISTS[b.type] || []).map((item) => ({ item, ok: false, note: '' }));
  const staff = isStaff(req.user);
  const techId = staff && b.technician_id ? +b.technician_id : req.user.id;
  // Solo un administrador puede registrar una visita con otra hora o a nombre de otro técnico (queda marcada como registro manual)
  const manual = staff && (b.started_at || techId !== req.user.id) ? 1 : 0;
  const startedAt = staff && b.started_at ? new Date(b.started_at).toISOString() : new Date().toISOString();
  const info = db.prepare(`INSERT INTO visits(folio,client_id,equipment_id,technician_id,type,priority,started_at,start_lat,start_lng,start_accuracy,start_address,start_distance_m,start_no_gps_reason,weather_start,reason,checklist,created_by,manual_entry,request_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(folio, b.client_id, b.equipment_id || null, techId, b.type, b.priority || 'normal',
    startedAt, loc.lat, loc.lng, loc.acc, loc.address, loc.dist, loc.reason, wx ? JSON.stringify(wx) : null, b.reason || null, JSON.stringify(checklist), req.user.id, manual, requestId);
  // La primera visita con GPS fija la ubicación de referencia de la empresa
  if (client.lat == null && loc.lat != null && !manual) db.prepare('UPDATE clients SET lat=?,lng=? WHERE id=?').run(loc.lat, loc.lng, client.id);
  return fullVisit(info.lastInsertRowid);
}

r.get('/visits/:id', (req, res) => {
  const v = fullVisit(req.params.id, req.user);
  if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
  res.json(v);
});

const EDITABLE = ['reason', 'diagnosis', 'actions', 'recommendations', 'result', 'downtime_hours', 'refrigerant_added_kg', 'client_signer', 'client_rating', 'next_visit_date', 'equipment_id', 'priority'];
r.put('/visits/:id', (req, res) => {
  const v = loadVisit(req.params.id, req.user);
  if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
  if (!canEdit(v, req.user)) return res.status(403).json(LOCKED);
  const b = req.body; const sets = []; const vals = [];
  EDITABLE.forEach((k) => { if (k in b) { sets.push(`${k}=?`); vals.push(['downtime_hours', 'refrigerant_added_kg', 'client_rating', 'equipment_id'].includes(k) ? num(b[k]) : (b[k] || null)); } });
  if ('checklist' in b) { sets.push('checklist=?'); vals.push(JSON.stringify(b.checklist || [])); }
  if ('parts_used' in b) { sets.push('parts_used=?'); vals.push(JSON.stringify(b.parts_used || [])); }
  if ('folio' in b && isStaff(req.user)) { sets.push('folio=?'); vals.push(b.folio); }
  if (sets.length) db.prepare(`UPDATE visits SET ${sets.join(',')} WHERE id=?`).run(...vals, v.id);
  res.json(fullVisit(v.id));
});

// Terminar visita (botón "Terminar visita"): hora del servidor, GPS, dirección, clima, firma y token para QR
r.post('/visits/:id/finish', wrap(async (req, res) => {
  const v = loadVisit(req.params.id, req.user);
  if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
  if (v.status !== 'en_curso') return res.status(400).json({ error: 'La visita ya fue finalizada' });
  const b = req.body;
  if (!b.result && !v.result) return res.status(400).json({ error: 'Indica el resultado de la visita antes de finalizar' });
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(v.client_id);
  const loc = await locationStamp(b, client);
  const wx = await getWeather(loc.lat ?? v.start_lat ?? client.lat, loc.lng ?? v.start_lng ?? client.lng);
  const staff = isStaff(req.user);
  const endedAt = staff && b.ended_at ? new Date(b.ended_at).toISOString() : new Date().toISOString();
  db.prepare(`UPDATE visits SET status='finalizada', ended_at=?, end_lat=?, end_lng=?, end_accuracy=?, end_address=?, end_distance_m=?, end_no_gps_reason=?,
      weather_end=?, result=COALESCE(?,result), client_signer=COALESCE(?,client_signer), client_signature=COALESCE(?,client_signature),
      client_rating=COALESCE(?,client_rating), report_token=?, manual_entry=CASE WHEN ? THEN 1 ELSE manual_entry END WHERE id=?`)
    .run(endedAt, loc.lat, loc.lng, loc.acc, loc.address, loc.dist, loc.reason, wx ? JSON.stringify(wx) : null, b.result || null,
      b.client_signer || null, b.client_signature || null, num(b.client_rating), crypto.randomBytes(16).toString('hex'), staff && b.ended_at ? 1 : 0, v.id);
  db.prepare("UPDATE requests SET status='completada', updated_at=datetime('now') WHERE visit_id=?").run(v.id);
  res.json(fullVisit(v.id));
}));

r.post('/visits/:id/reopen', requireRole('admin', 'supervisor'), (req, res) => {
  db.prepare("UPDATE visits SET status='en_curso', ended_at=NULL WHERE id=?").run(req.params.id);
  db.prepare("UPDATE requests SET status='en_curso', updated_at=datetime('now') WHERE visit_id=?").run(req.params.id);
  res.json(fullVisit(req.params.id));
});
r.post('/visits/:id/cancel', requireRole('admin', 'supervisor'), (req, res) => {
  db.prepare("UPDATE visits SET status='anulada' WHERE id=?").run(req.params.id);
  // La solicitud vuelve a quedar asignada para que se pueda volver a ejecutar
  // Una solicitud regularizada (creada solo para documentar una visita antigua) se cancela junto con su visita
  db.prepare("UPDATE requests SET status='cancelada', updated_at=datetime('now') WHERE visit_id=? AND regularized=1").run(req.params.id);
  db.prepare("UPDATE requests SET status=CASE WHEN technician_id IS NULL THEN 'pendiente' ELSE 'asignada' END, visit_id=NULL, updated_at=datetime('now') WHERE visit_id=? AND regularized=0").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Solicitudes de visita (las crea el supervisor y las ejecuta el técnico) ----------
function nextRequestCode() {
  const y = new Date().getFullYear();
  let n = db.prepare('SELECT COUNT(*) n FROM requests WHERE code LIKE ?').get(`SOL-${y}-%`).n + 1, c;
  do { c = `SOL-${y}-${String(n++).padStart(5, '0')}`; } while (db.prepare('SELECT 1 FROM requests WHERE code=?').get(c));
  return c;
}
const REQ_SELECT = `SELECT r.*, c.name AS client_name, c.address AS client_address, c.lat AS client_lat, c.lng AS client_lng, c.contact_name, c.contact_phone,
    e.name AS equipment_name, u.name AS tech_name, cb.name AS created_by_name, v.folio AS visit_folio, v.status AS visit_status, v.result AS visit_result, v.started_at AS visit_started_at
  FROM requests r JOIN clients c ON c.id=r.client_id LEFT JOIN equipment e ON e.id=r.equipment_id LEFT JOIN users u ON u.id=r.technician_id
  LEFT JOIN users cb ON cb.id=r.created_by LEFT JOIN visits v ON v.id=r.visit_id`;
// Quién ve qué: técnico → las suyas; supervisor → las de su equipo, las sin asignar y las que creó; admin → todas
function reqScope(u, p) {
  if (u.role === 'tecnico') { p.me = u.id; return 'r.technician_id=@me'; }
  // Supervisor: solo las solicitudes de sus técnicos a cargo (y las sin asignar, para poder asignarlas)
  if (u.role === 'supervisor') { p.me = u.id; return "(r.technician_id IS NULL OR r.technician_id IN (SELECT id FROM users WHERE role='tecnico' AND supervisor_id=@me))"; }
  return '1=1';
}
function loadRequest(id, u) {
  const p = { id: +id };
  return db.prepare(`${REQ_SELECT} WHERE r.id=@id AND ${reqScope(u, p)}`).get(p) || null;
}
r.get('/requests', (req, res) => {
  const p = {}; const w = [reqScope(req.user, p)];
  if (req.query.status === 'abiertas') w.push("r.status IN ('pendiente','asignada','en_curso')");
  else if (req.query.status === 'regularizadas') w.push('r.regularized=1');
  else if (req.query.status) { w.push('r.status=@st'); p.st = req.query.status; }
  if (req.query.technician_id && req.user.role !== 'tecnico') { w.push('r.technician_id=@t'); p.t = +req.query.technician_id; }
  if (req.query.client_id) { w.push('r.client_id=@c'); p.c = +req.query.client_id; }
  if (req.query.type && cat.VISIT_TYPES[req.query.type]) { w.push('r.type=@rty'); p.rty = req.query.type; }
  if (req.query.result && cat.RESULTS[req.query.result]) { w.push('v.result=@res'); p.res = req.query.result; }
  if (req.query.q) { w.push('(r.code LIKE @q OR c.name LIKE @q OR r.description LIKE @q)'); p.q = `%${req.query.q}%`; }
  res.json(db.prepare(`${REQ_SELECT} WHERE ${w.join(' AND ')}
    ORDER BY CASE r.status WHEN 'pendiente' THEN ${req.user.role === 'tecnico' ? 2 : -1} WHEN 'en_curso' THEN 0 WHEN 'asignada' THEN 1 WHEN 'completada' THEN 3 ELSE 4 END,
      CASE r.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, COALESCE(r.scheduled_date,'9999'), r.id DESC
    LIMIT ${Math.min(+req.query.limit || 300, 1000)}`).all(p));
});
r.get('/requests/:id', (req, res) => {
  const q = loadRequest(req.params.id, req.user);
  if (!q) return res.status(404).json({ error: 'Solicitud no encontrada' });
  res.json(q);
});
function validateAssign(u, techId) {
  if (!techId) return null;
  const t = db.prepare("SELECT id FROM users WHERE id=? AND role='tecnico' AND active=1").get(+techId);
  if (!t) throw new HttpError(400, 'Técnico no válido o inactivo');
  if (!inTeam(u, t.id)) throw new HttpError(403, 'Ese técnico no pertenece a tu equipo');
  return t.id;
}
r.post('/requests', requireRole('admin', 'supervisor'), (req, res) => {
  const b = req.body;
  try {
    if (!b.client_id || !cat.VISIT_TYPES[b.type]) throw new HttpError(400, 'Tipo de visita y empresa son obligatorios');
    if (!db.prepare('SELECT 1 FROM clients WHERE id=?').get(+b.client_id)) throw new HttpError(400, 'Empresa no encontrada');
    const tech = validateAssign(req.user, b.technician_id);
    const info = db.prepare(`INSERT INTO requests(code,type,client_id,equipment_id,technician_id,priority,scheduled_date,description,status,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(nextRequestCode(), b.type, +b.client_id, num(b.equipment_id), tech, b.priority || 'normal',
      b.scheduled_date || null, (b.description || '').trim() || null, tech ? 'asignada' : 'pendiente', req.user.id);
    res.json(loadRequest(info.lastInsertRowid, req.user));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
r.put('/requests/:id', requireRole('admin', 'supervisor'), (req, res) => {
  const q = loadRequest(req.params.id, req.user);
  if (!q) return res.status(404).json({ error: 'Solicitud no encontrada' });
  const b = req.body;
  try {
    if (b.status === 'cancelada') {
      if (q.status === 'en_curso' || q.status === 'completada') throw new HttpError(400, 'No se puede cancelar: la visita ya se inició');
      db.prepare("UPDATE requests SET status='cancelada', updated_at=datetime('now') WHERE id=?").run(q.id);
      return res.json(loadRequest(q.id, req.user));
    }
    if (q.status === 'completada' || q.status === 'cancelada') throw new HttpError(400, 'La solicitud ya está cerrada');
    const tech = 'technician_id' in b ? validateAssign(req.user, b.technician_id) : q.technician_id;
    if (q.status === 'en_curso' && tech !== q.technician_id) throw new HttpError(400, 'La visita ya está en curso: no se puede reasignar');
    const status = q.status === 'en_curso' ? 'en_curso' : tech ? 'asignada' : 'pendiente';
    db.prepare(`UPDATE requests SET type=COALESCE(?,type), client_id=COALESCE(?,client_id), equipment_id=?, technician_id=?, priority=COALESCE(?,priority),
      scheduled_date=?, description=?, status=?, updated_at=datetime('now') WHERE id=?`).run(cat.VISIT_TYPES[b.type] ? b.type : null, num(b.client_id),
      'equipment_id' in b ? num(b.equipment_id) : q.equipment_id, tech, b.priority || null,
      'scheduled_date' in b ? b.scheduled_date || null : q.scheduled_date, 'description' in b ? (b.description || '').trim() || null : q.description, status, q.id);
    res.json(loadRequest(q.id, req.user));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
// Iniciar la visita desde una solicitud: crea la visita con los datos de la solicitud y registra GPS/clima como siempre
r.post('/requests/:id/start', wrap(async (req, res) => {
  const q = loadRequest(req.params.id, req.user);
  if (!q) return res.status(404).json({ error: 'Solicitud no encontrada' });
  if (q.status === 'en_curso' && q.visit_id) return res.json(fullVisit(q.visit_id));
  if (!['pendiente', 'asignada'].includes(q.status)) return res.status(400).json({ error: 'La solicitud ya está cerrada' });
  if (req.user.role === 'tecnico' && q.technician_id !== req.user.id) return res.status(403).json({ error: 'Esta solicitud no está asignada a ti' });
  try {
    const b = { ...req.body, client_id: q.client_id, equipment_id: q.equipment_id, type: q.type, priority: q.priority, reason: q.description,
      technician_id: q.technician_id || req.user.id, folio: '' };
    const v = await createVisit(b, req.user, q.id);
    db.prepare("UPDATE requests SET status='en_curso', visit_id=?, technician_id=COALESCE(technician_id,?), updated_at=datetime('now') WHERE id=?").run(v.id, v.technician_id, q.id);
    res.json(v);
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); throw e; }
}));

// Mediciones
r.post('/visits/:id/measurements', (req, res) => {
  const v = loadVisit(req.params.id, req.user);
  if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
  if (!canEdit(v, req.user)) return res.status(403).json(LOCKED);
  const list = Array.isArray(req.body) ? req.body : [req.body];
  const ins = db.prepare('INSERT INTO measurements(visit_id,kind,value,unit,point,phase,taken_at) VALUES(?,?,?,?,?,?,?)');
  // replace: la planilla rápida guarda UN valor por variable y fase (reemplaza el anterior; vacío = borrar)
  const del = db.prepare('DELETE FROM measurements WHERE visit_id=? AND kind=? AND phase=? AND point IS NULL');
  const tx = db.transaction(() => list.forEach((m) => {
    const def = cat.MEASUREMENTS[m.kind];
    if (!def) return;
    if (m.replace && !m.point) del.run(v.id, m.kind, m.phase === 'final' ? 'final' : 'inicial');
    if (num(m.value) == null) return;
    ins.run(v.id, m.kind, num(m.value), def.unit, m.point || null, m.phase === 'final' ? 'final' : 'inicial', m.taken_at || new Date().toISOString());
  }));
  tx();
  res.json(fullVisit(v.id));
});
r.delete('/measurements/:id', (req, res) => {
  const m = db.prepare('SELECT visit_id FROM measurements WHERE id=?').get(req.params.id);
  const mv = m && loadVisit(m.visit_id, req.user);
  if (!mv) return res.status(404).json({ error: 'No encontrada' });
  if (!canEdit(mv, req.user)) return res.status(403).json(LOCKED);
  db.prepare('DELETE FROM measurements WHERE id=?').run(req.params.id);
  res.json(fullVisit(m.visit_id));
});

// Fotos (se comprimen a máx. 1600 px para que el PDF no pese demasiado)
r.post('/visits/:id/photos', upload.array('photos', 20), wrap(async (req, res) => {
  const v = loadVisit(req.params.id, req.user);
  if (!v) return res.status(404).json({ error: 'Visita no encontrada' });
  if (!canEdit(v, req.user)) return res.status(403).json(LOCKED);
  const dir = path.join(UPLOAD_DIR, String(v.id));
  fs.mkdirSync(dir, { recursive: true });
  const ins = db.prepare('INSERT INTO photos(visit_id,filename,caption,stage) VALUES(?,?,?,?)');
  for (const f of req.files || []) {
    const name = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
    await sharp(f.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(path.join(dir, name));
    ins.run(v.id, `${v.id}/${name}`, req.body.caption || null, req.body.stage || 'durante');
  }
  res.json(fullVisit(v.id));
}));
r.put('/photos/:id', (req, res) => {
  const p = db.prepare('SELECT visit_id FROM photos WHERE id=?').get(req.params.id);
  const pv = p && loadVisit(p.visit_id, req.user);
  if (!pv) return res.status(404).json({ error: 'No encontrada' });
  if (!canEdit(pv, req.user)) return res.status(403).json(LOCKED);
  db.prepare('UPDATE photos SET caption=?, stage=? WHERE id=?').run(req.body.caption || null, req.body.stage || 'durante', req.params.id);
  res.json({ ok: true });
});
r.delete('/photos/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM photos WHERE id=?').get(req.params.id);
  const pv = p && loadVisit(p.visit_id, req.user);
  if (!pv) return res.status(404).json({ error: 'No encontrada' });
  if (!canEdit(pv, req.user)) return res.status(403).json(LOCKED);
  fs.rmSync(path.join(UPLOAD_DIR, p.filename), { force: true });
  db.prepare('DELETE FROM photos WHERE id=?').run(p.id);
  res.json(fullVisit(p.visit_id));
});
r.get('/photos/:id/file', (req, res) => {
  const p = db.prepare('SELECT * FROM photos WHERE id=?').get(req.params.id);
  if (!p || !loadVisit(p.visit_id, req.user)) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, p.filename));
});

// Informe PDF
async function sendPdf(id, req, res) {
  const v = fullVisit(id);
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const buf = await buildReport(v, { uploadDir: UPLOAD_DIR, baseUrl: base, company: process.env.COMPANY_NAME || 'Mi Empresa de Refrigeración' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="Informe_${v.folio}.pdf"`);
  res.send(buf);
}
r.get('/visits/:id/pdf', wrap(async (req, res) => {
  if (!loadVisit(req.params.id, req.user)) return res.status(404).json({ error: 'Visita no encontrada' });
  await sendPdf(req.params.id, req, res);
}));

// ---------- Dashboards ----------
r.get('/dashboard', (req, res) => {
  const f = { ...req.query };
  if (!isStaff(req.user)) f.technician_id = req.user.id; // el técnico solo ve su propio dashboard
  res.json(fleetKpis(f));
});

// Exportar visitas a CSV (Excel)
r.get('/export/visits.csv', requireRole('admin', 'supervisor'), (req, res) => {
  const rows = db.prepare(`SELECT v.folio, c.name cliente, e.name equipo, u.name tecnico, v.type tipo, v.status estado, v.result resultado,
      v.started_at inicio, v.ended_at termino, ROUND((julianday(v.ended_at)-julianday(v.started_at))*1440,0) duracion_min,
      v.refrigerant_added_kg refrigerante_kg, v.downtime_hours horas_detenido, v.client_rating satisfaccion
    FROM visits v JOIN clients c ON c.id=v.client_id JOIN users u ON u.id=v.technician_id LEFT JOIN equipment e ON e.id=v.equipment_id
    ORDER BY v.started_at DESC`).all();
  const cols = rows.length ? Object.keys(rows[0]) : ['folio'];
  const esc = (x) => (x == null ? '' : /[;"\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x));
  const csv = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="visitas.csv"');
  res.send(csv);
});

module.exports = r;
