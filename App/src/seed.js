// Datos de demostración:  npm run demo
// Crea 4 técnicos, 5 empresas ficticias con sus equipos y 30 visitas con casos variados (últimos ~3 meses).
// Usa --force para agregarlas aunque ya existan visitas.
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { hash } = require('./auth');
const { CHECKLISTS } = require('./catalog');
const { distanceM } = require('./geo');

if (db.prepare('SELECT COUNT(*) n FROM visits').get().n > 0 && !process.argv.includes('--force')) {
  console.log('Ya hay visitas en la base. Usa:  npm run demo -- --force   para agregar las 30 visitas demo igualmente.');
  process.exit(0);
}

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (a, b) => a + rnd() * (b - a);
const r1 = (x) => Math.round(x * 10) / 10;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

// ---------- Técnicos ----------
const insUser = db.prepare('INSERT OR IGNORE INTO users(name,email,password_hash,role) VALUES(?,?,?,?)');
[['Camila Rojas', 'camila@demo.cl'], ['Matías Fuentes', 'matias@demo.cl'], ['Javier Soto', 'javier@demo.cl'], ['Valentina Muñoz', 'valentina@demo.cl']]
  .forEach(([n, e]) => insUser.run(n, e, hash('demo1234'), 'tecnico'));
// Supervisores con su equipo de técnicos
[['Sofía Herrera', 'sofia@demo.cl'], ['Ignacio Bravo', 'ignacio@demo.cl']].forEach(([n, e]) => insUser.run(n, e, hash('demo1234'), 'supervisor'));
const T = Object.fromEntries(db.prepare("SELECT id, email FROM users WHERE email LIKE '%@demo.cl'").all().map((u) => [u.email.split('@')[0], u.id]));
db.prepare('UPDATE users SET supervisor_id=? WHERE id IN (?,?)').run(T.sofia, T.camila, T.matias);
db.prepare('UPDATE users SET supervisor_id=? WHERE id IN (?,?)').run(T.ignacio, T.javier, T.valentina);

// ---------- Empresas y equipos ----------
const insClient = db.prepare('INSERT INTO clients(name,rut,address,contact_name,contact_email,lat,lng) VALUES(?,?,?,?,?,?,?)');
const insEq = db.prepare(`INSERT INTO equipment(client_id,name,kind,brand,model,serial,refrigerant,charge_kg,setpoint_c,tolerance_c,rh_min,rh_max)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
const clientsDef = [
  { k: 'austral', name: 'Frigorífico Austral S.A. (demo)', rut: '76.123.456-7', addr: 'Av. Industrial 1450, Quilicura', contact: 'Rodrigo Pérez, Jefe de mantención', lat: -33.3551, lng: -70.7293,
    eq: [['cons', 'Cámara conservación N°1', 'camara_conservacion', 'Bitzer', 'R404A', 180, 2, 1.5, 85, 95], ['cong', 'Cámara congelado N°2', 'camara_congelado', 'Copeland', 'R404A', 220, -20, 2, null, null], ['tunel', 'Túnel de congelado', 'tunel', 'Frascold', 'R507A', 350, -32, 3, null, null]] },
  { k: 'andina', name: 'Distribuidora Andina Ltda. (demo)', rut: '77.234.567-8', addr: 'Camino a Melipilla 9800, Maipú', contact: 'Paula Díaz, Encargada de bodega', lat: -33.5302, lng: -70.7905,
    eq: [['cons', 'Cámara frutas y verduras', 'camara_conservacion', 'Danfoss', 'R448A', 150, 4, 1.5, 85, 95], ['rack', 'Rack de compresores central', 'rack', 'Bitzer', 'R448A', 400, -10, 2, null, null]] },
  { k: 'valle', name: 'Supermercados del Valle (demo)', rut: '96.345.678-9', addr: 'Av. Vicuña Mackenna 7110, La Florida', contact: 'Andrés Lagos, Jefe de local', lat: -33.5205, lng: -70.5988,
    eq: [['vitr', 'Vitrinas lácteos', 'vitrina', 'Arneg', 'R744', 60, 4, 2, null, null], ['cong', 'Cámara congelados sala de ventas', 'camara_congelado', 'Tecumseh', 'R404A', 90, -22, 2, null, null]] },
  { k: 'pesquera', name: 'Pesquera Mar Profundo (demo)', rut: '78.456.789-0', addr: 'Puerto de San Antonio, Muelle 3', contact: 'Hernán Vega, Gerente de planta', lat: -33.5932, lng: -71.6127,
    eq: [['tunel', 'Túnel de congelado IQF', 'tunel', 'GEA', 'R717', 900, -35, 3, null, null], ['chiller', 'Chiller agua de proceso', 'chiller', 'Carrier', 'R134a', 95, 7, 1, null, null]] },
  { k: 'nunoa', name: 'Pastelería Ñuñoa Gourmet (demo)', rut: '76.888.111-2', addr: 'Av. Irarrázaval 3300, Ñuñoa', contact: 'Daniela Mora, Administradora', lat: -33.4542, lng: -70.5981,
    eq: [['cons', 'Cámara de producción', 'camara_conservacion', 'Embraco', 'R290', 25, 3, 1.5, null, null]] },
  { k: 'provi', name: 'Hotel Providencia Plaza (demo)', rut: '96.777.222-3', addr: 'Av. Providencia 1980, Providencia', contact: 'Jorge Lillo, Jefe de mantención', lat: -33.4214, lng: -70.6102,
    eq: [['chiller', 'Chiller climatización', 'chiller', 'Trane', 'R410A', 120, 7, 1, null, null], ['cong', 'Cámara cocina congelados', 'camara_congelado', 'Copeland', 'R404A', 30, -20, 2, null, null]] },
  { k: 'enea', name: 'Centro de Distribución Enea (demo)', rut: '77.666.333-4', addr: 'Av. Américo Vespucio 1501, Pudahuel', contact: 'Felipe Araya, Jefe de bodega', lat: -33.4247, lng: -70.7556,
    eq: [['rack', 'Rack CO₂ transcrítico', 'rack', 'Bitzer', 'R744', 300, -8, 2, null, null], ['cong', 'Cámara congelado N°1', 'camara_congelado', 'Danfoss', 'R744', 0, -24, 2, null, null]] },
  { k: 'robles', name: 'Agroexportadora Los Robles (demo)', rut: '76.567.890-1', addr: 'Ruta 5 Sur km 85, Rancagua', contact: 'Carolina Silva, Jefa de packing', lat: -34.1702, lng: -70.7444,
    eq: [['cons', 'Cámara atmósfera controlada N°3', 'camara_conservacion', 'Bitzer', 'R449A', 260, 0, 1, 90, 95]] },
];
const C = {};
clientsDef.forEach((c) => {
  const id = insClient.run(c.name, c.rut, c.addr, c.contact, `contacto@${c.k}.cl`, c.lat, c.lng).lastInsertRowid;
  C[c.k] = { id, lat: c.lat, lng: c.lng, addr: c.addr, eq: {} };
  c.eq.forEach(([ek, n, kind, brand, ref, charge, sp, tol, rhmin, rhmax]) => {
    const eid = insEq.run(id, n, kind, brand, 'Mod-' + Math.floor(between(100, 999)), 'SN' + Math.floor(between(1e5, 1e6)), ref, charge, sp, tol, rhmin, rhmax).lastInsertRowid;
    C[c.k].eq[ek] = { id: eid, sp, tol, ref, charge };
  });
});

// ---------- Perfiles de mediciones (casos técnicos) ----------
// Devuelve [[kind, valor, fase], ...] según el estado del equipo
function measurements(eq, tAmb, caso) {
  const sp = eq.sp;
  const te = sp - 8;                       // saturación evaporación típica
  let tc = tAmb + 11;                      // saturación condensación típica
  let sh = between(5, 8), sc = between(4, 7), tIni = sp + between(-0.8, 0.8), tFin = sp + between(-0.6, 0.6), tDesc = between(75, 95), amp = between(10, 18), velCond = between(3, 4.5);
  switch (caso) {
    case 'fuga': sh = between(16, 22); sc = between(0, 0.8); tIni = sp + between(5, 8); tFin = sp + between(-0.5, 1); break;      // baja carga de refrigerante
    case 'condensador': tc = tAmb + between(22, 26); tDesc = between(112, 124); amp = between(20, 26); velCond = between(1, 1.8); tIni = sp + between(2, 4); tFin = sp + between(0, 1); break;
    case 'hielo': tIni = sp + between(4, 7); tFin = sp + between(-0.5, 0.8); break;                                              // evaporador bloqueado
    case 'sobrecarga': sh = between(1, 2); sc = between(12, 15); break;
    case 'fuera_rango': tIni = sp + between(4, 6); tFin = sp + between(3.5, 5); break;                                           // no se logró recuperar
    case 'contactor': tIni = sp + between(8, 12); tFin = sp + between(-0.4, 0.6); break;
  }
  const ms = [
    ['temp_interior', tIni, 'inicial'], ['hr_interior', between(84, 93), 'inicial'], ['temp_sala_maquinas', tAmb + between(1, 4), 'inicial'],
    ['temp_interior', tFin, 'final'], ['temp_sat_evap', te, 'final'], ['temp_succion', te + sh, 'final'],
    ['temp_sat_cond', tc, 'final'], ['temp_liquido', tc - sc, 'final'], ['temp_retorno_aire', sp + between(1.5, 3), 'final'],
    ['temp_inyeccion_aire', sp - between(2, 4), 'final'], ['temp_descarga', tDesc, 'final'], ['corriente', amp, 'final'],
    ['vel_aire_evap', between(2.5, 4), 'final'], ['vel_aire_cond', velCond, 'final'], ['voltaje', between(372, 392), 'final'],
  ];
  if (caso === 'fuga' || caso === 'condensador') ms.push(['presion_baja', between(1.2, 1.8), 'final'], ['presion_alta', caso === 'condensador' ? between(24, 27) : between(13, 15), 'final']);
  return ms;
}

// ---------- 30 visitas ----------
// d = días atrás, h = hora de inicio, dur = minutos, gps: ok | sin_gps | lejos
const V = [
  // Reparaciones
  { d: 44, h: 9.2, c: 'austral', e: 'cons', t: 'camila', type: 'reparacion', caso: 'fuga', dur: 215, res: 'operativo', rate: 5, ref: 14.5, down: 6,
    reason: 'Cámara no baja de 7 °C desde la mañana.', diag: 'Fuga en válvula Schrader de línea de líquido; carga de refrigerante baja (recalentamiento 18 K, subenfriamiento casi nulo).',
    actions: 'Reparación de fuga, prueba de hermeticidad con nitrógeno, vacío a 400 micrones y recarga de 14,5 kg de R404A.', parts: [['Válvula Schrader 1/4"', 2], ['Filtro secador 3/8"', 1]], rec: 'Programar búsqueda de fugas trimestral. Evaluar recambio a refrigerante de menor GWP.' },
  { d: 41, h: 14.5, c: 'valle', e: 'vitr', t: 'matias', type: 'reparacion', caso: 'contactor', dur: 95, res: 'operativo', rate: 5, down: 3,
    reason: 'Vitrinas de lácteos apagadas, alarma de alta temperatura.', diag: 'Contactor principal del compresor con contactos quemados.', actions: 'Reemplazo de contactor y revisión de protecciones térmicas.', parts: [['Contactor 32 A', 1]] },
  { d: 38, h: 8.4, c: 'pesquera', e: 'tunel', t: 'javier', type: 'reparacion', caso: 'hielo', dur: 260, res: 'operativo_obs', rate: 4, down: 9,
    reason: 'Túnel IQF no alcanza temperatura de congelado.', diag: 'Evaporador bloqueado con hielo: resistencia de deshielo N°2 cortada.', actions: 'Deshielo manual, reemplazo de resistencia y ajuste de ciclos de deshielo.', parts: [['Resistencia deshielo 2.000 W', 1]], rec: 'Revisar las otras resistencias en la próxima mantención.' },
  { d: 35, h: 11, c: 'austral', e: 'cong', t: 'valentina', type: 'reparacion', caso: 'condensador', dur: 180, res: 'operativo', rate: 4, down: 4,
    reason: 'Alarma de alta presión, compresor se detiene.', diag: 'Condensador obstruido por polvo y ventilador N°2 con rodamiento dañado; approach de condensación muy alto.', actions: 'Limpieza química del condensador y cambio de motor ventilador.', parts: [['Motor ventilador 1/3 HP', 1], ['Desincrustante (litros)', 5]] },
  { d: 30, h: 16, c: 'andina', e: 'rack', t: 'matias', type: 'reparacion', caso: 'fuga', dur: 330, res: 'pendiente', rate: 3, ref: 38, down: 14,
    reason: 'Baja presión en rack central, varias cámaras con temperatura alta.', diag: 'Fuga en soldadura de colector de succión, requiere reemplazo de tramo.', actions: 'Contención provisoria y recarga de 38 kg de R448A. Se solicita repuesto.', parts: [['Refrigerante R448A (kg)', 38]], rec: 'Urgente: reemplazar tramo de colector. Equipo operando en modo degradado.', gps: 'lejos' },
  { d: 27, h: 10.3, c: 'pesquera', e: 'chiller', t: 'javier', type: 'reparacion', caso: 'normal', dur: 140, res: 'fuera_servicio', rate: 2, down: 24,
    reason: 'Chiller no parte, falla de compresor.', diag: 'Compresor con bobinado a tierra. Requiere reemplazo completo.', actions: 'Diagnóstico eléctrico, aislamiento del equipo y cotización de compresor.', rec: 'Reemplazar compresor. Plazo estimado de repuesto: 10 días.' },
  { d: 22, h: 13.1, c: 'austral', e: 'cons', t: 'camila', type: 'reparacion', caso: 'fuga', dur: 190, res: 'operativo', rate: 4, ref: 9, down: 5,
    reason: 'Nuevamente cámara con temperatura alta.', diag: 'Nueva fuga en unión flare del evaporador.', actions: 'Reemplazo de unión por soldadura, vacío y recarga de 9 kg.', parts: [['Unión de cobre 1/2"', 2]], rec: 'Segunda fuga en el mes: se recomienda prueba de hermeticidad completa del circuito.' },
  { d: 15, h: 9, c: 'robles', e: 'cons', t: 'valentina', type: 'reparacion', caso: 'sobrecarga', dur: 120, res: 'operativo_obs', rate: 4, down: 2,
    reason: 'Compresor con ruido y escarcha en la succión.', diag: 'Sobrecarga de refrigerante tras intervención de terceros (recalentamiento 1–2 K).', actions: 'Recuperación de 6 kg de refrigerante y ajuste de válvula de expansión.', rec: 'Verificar recalentamiento en 2 semanas.' },
  { d: 8, h: 15.4, c: 'valle', e: 'cong', t: 'matias', type: 'reparacion', caso: 'fuera_rango', dur: 150, res: 'pendiente', rate: 3, down: 7, gps: 'sin_gps',
    reason: 'Cámara de congelados a −15 °C.', diag: 'Válvula de expansión con falla intermitente; temperatura no se recupera totalmente.', actions: 'Ajuste provisorio, se solicita válvula nueva.', rec: 'Trasladar producto sensible hasta el cambio de válvula.' },
  { d: 3, h: 10, c: 'andina', e: 'rack', t: 'javier', type: 'reparacion', caso: 'normal', dur: 240, res: 'operativo', rate: 5, down: 3,
    reason: 'Reemplazo programado de tramo de colector (pendiente del folio anterior).', diag: 'Tramo de colector con fuga confirmada.', actions: 'Reemplazo de tramo, prueba con nitrógeno a 25 bar, vacío y puesta en marcha.', parts: [['Tubo cobre 1 3/8" (m)', 3]] },
  // Mantenciones preventivas
  { d: 43, h: 8.5, c: 'andina', e: 'cons', t: 'valentina', type: 'mantencion', caso: 'normal', dur: 150, res: 'operativo', rate: 5, next: 90 },
  { d: 40, h: 9, c: 'robles', e: 'cons', t: 'camila', type: 'mantencion', caso: 'normal', dur: 170, res: 'operativo', rate: 5, next: 90 },
  { d: 36, h: 14, c: 'valle', e: 'cong', t: 'javier', type: 'mantencion', caso: 'condensador', dur: 200, res: 'operativo_obs', rate: 4, next: 30,
    diag: 'Condensador con suciedad alta, ventilador con vibración.', rec: 'Cambiar ventilador del condensador en la próxima visita.' },
  { d: 33, h: 8, c: 'pesquera', e: 'tunel', t: 'matias', type: 'mantencion', caso: 'normal', dur: 240, res: 'operativo', rate: 4, next: 60 },
  { d: 29, h: 11.5, c: 'austral', e: 'tunel', t: 'valentina', type: 'mantencion', caso: 'normal', dur: 190, res: 'operativo', rate: 5, next: 90 },
  { d: 24, h: 9.3, c: 'valle', e: 'vitr', t: 'camila', type: 'mantencion', caso: 'normal', dur: 110, res: 'operativo', rate: 5, next: -2 },   // mantención vencida
  { d: 18, h: 10, c: 'andina', e: 'rack', t: 'javier', type: 'mantencion', caso: 'normal', dur: 230, res: 'operativo_obs', rate: 4, next: 45, rec: 'Nivel de aceite en el límite inferior; revisar en 15 días.' },
  { d: 12, h: 8.2, c: 'pesquera', e: 'chiller', t: 'valentina', type: 'mantencion', caso: 'normal', dur: 160, res: 'operativo', rate: 5, next: 90 },
  { d: 6, h: 14.2, c: 'austral', e: 'cong', t: 'matias', type: 'mantencion', caso: 'normal', dur: 175, res: 'operativo', rate: 4, next: 90 },
  // Visitas rutinarias
  { d: 42, h: 15, c: 'austral', e: 'cons', t: 'matias', type: 'rutinaria', caso: 'normal', dur: 45, res: 'operativo', rate: 4 },
  { d: 34, h: 16.3, c: 'valle', e: 'vitr', t: 'valentina', type: 'rutinaria', caso: 'normal', dur: 35, res: 'operativo', rate: 5 },
  { d: 26, h: 12, c: 'robles', e: 'cons', t: 'javier', type: 'rutinaria', caso: 'normal', dur: 50, res: 'operativo', rate: 5 },
  { d: 20, h: 9.5, c: 'andina', e: 'cons', t: 'camila', type: 'rutinaria', caso: 'fuera_rango', dur: 60, res: 'operativo_obs', rate: 3, rec: 'Temperatura 4 K sobre setpoint: puerta queda abierta en horario de carga. Instalar cortina de PVC.' },
  { d: 14, h: 17, c: 'pesquera', e: 'chiller', t: 'matias', type: 'rutinaria', caso: 'normal', dur: 40, res: 'operativo', rate: 4, gps: 'sin_gps' },
  { d: 9, h: 11.2, c: 'austral', e: 'cong', t: 'camila', type: 'rutinaria', caso: 'normal', dur: 55, res: 'operativo', rate: 5 },
  { d: 4, h: 16, c: 'robles', e: 'cons', t: 'valentina', type: 'rutinaria', caso: 'normal', dur: 42, res: 'operativo', rate: 5 },
  // Implementaciones
  { d: 39, h: 8, c: 'robles', e: 'cons', t: 'javier', type: 'implementacion', caso: 'normal', dur: 480, res: 'operativo', rate: 5, ref: 0, next: 30,
    reason: 'Instalación de nueva cámara de atmósfera controlada N°3.', actions: 'Montaje de unidad condensadora y 2 evaporadores, prueba de hermeticidad, vacío, carga de 260 kg de R449A y puesta en marcha.' },
  { d: 25, h: 8.3, c: 'valle', e: 'vitr', t: 'camila', type: 'implementacion', caso: 'normal', dur: 420, res: 'operativo', rate: 5, next: 30,
    reason: 'Reemplazo de vitrinas de lácteos por sistema CO₂ (R744).', actions: 'Retiro de equipos antiguos, instalación de 6 vitrinas y central CO₂, capacitación al personal.' },
  { d: 11, h: 8, c: 'pesquera', e: 'chiller', t: 'javier', type: 'implementacion', caso: 'normal', dur: 390, res: 'operativo_obs', rate: 4, next: 15,
    reason: 'Instalación de compresor nuevo en chiller (folio fuera de servicio anterior).', actions: 'Reemplazo de compresor, cambio de aceite y filtro, puesta en marcha.', rec: 'Revisar vibraciones a las 100 horas de operación.' },
  // Visita en curso (hoy)
  { d: 0, h: null, c: 'andina', e: 'cons', t: 'camila', type: 'mantencion', caso: 'normal', dur: null, open: true, reason: 'Mantención preventiva trimestral.' },
];

// ---------- Fotos demo (imágenes generadas con un rótulo) ----------
let sharp = null; try { sharp = require('sharp'); } catch {}
async function demoPhoto(visitId, label, color) {
  if (!sharp) return null;
  const dir = path.join(UPLOAD_DIR, String(visitId));
  fs.mkdirSync(dir, { recursive: true });
  const name = `demo_${crypto.randomBytes(4).toString('hex')}.jpg`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0b2540"/></linearGradient></defs>
    <rect width="1200" height="900" fill="url(#g)"/><g fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="10">${Array.from({ length: 9 }, (_, i) => `<line x1="${150 + i * 110}" y1="200" x2="${150 + i * 110}" y2="700"/>`).join('')}</g>
    <text x="600" y="470" font-family="Arial, sans-serif" font-size="64" font-weight="700" fill="#ffffff" text-anchor="middle">${label}</text>
    <text x="600" y="540" font-family="Arial, sans-serif" font-size="32" fill="#cfe0f2" text-anchor="middle">Foto de demostración</text></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 78 }).toFile(path.join(dir, name));
  return `${visitId}/${name}`;
}
const PHOTOS = {
  reparacion: [['Falla encontrada', 'antes', '#b54a2a'], ['Componente reemplazado', 'durante', '#7a5a1e'], ['Equipo funcionando', 'despues', '#1f7a4e']],
  mantencion: [['Condensador antes', 'antes', '#6b5a3a'], ['Condensador después', 'despues', '#1f6f8a'], ['Tablero eléctrico', 'durante', '#3a4a6b']],
  rutinaria: [['Display del controlador', 'durante', '#2a5a7a']],
  implementacion: [['Instalación terminada', 'despues', '#1f7a6a'], ['Unidad condensadora', 'durante', '#3a5a8a'], ['Placa de datos', 'durante', '#5a4a7a']],
};

// ---------- Inserción ----------
const year = new Date().getFullYear();
const maxN = db.prepare("SELECT COUNT(*) n FROM visits WHERE folio LIKE ?").get(`OT-${year}-%`).n;
const insVisit = db.prepare(`INSERT INTO visits(folio,client_id,equipment_id,technician_id,type,status,priority,started_at,ended_at,
  start_lat,start_lng,start_accuracy,start_address,start_distance_m,start_no_gps_reason,end_lat,end_lng,end_accuracy,end_address,end_distance_m,end_no_gps_reason,
  weather_start,weather_end,reason,diagnosis,actions,recommendations,checklist,parts_used,result,downtime_hours,refrigerant_added_kg,client_signer,client_signature,client_rating,next_visit_date,report_token,created_by,manual_entry)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);
const insM = db.prepare('INSERT INTO measurements(visit_id,kind,value,unit,point,phase,taken_at) VALUES(?,?,?,?,?,?,?)');
const insP = db.prepare('INSERT INTO photos(visit_id,filename,caption,stage,taken_at) VALUES(?,?,?,?,?)');
const UNITS = { hr_interior: '%', hr_sala_maquinas: '%', corriente: 'A', voltaje: 'V', presion_baja: 'bar', presion_alta: 'bar', vel_aire_evap: 'm/s', vel_aire_cond: 'm/s' };
const COND = ['Despejado', 'Despejado', 'Parcialmente nublado', 'Nublado'];
// Firma demo (trazo simple)
const SIG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="90"><path d="M10 60 C 40 10, 70 90, 100 45 S 160 20, 190 55 S 250 70, 290 30" fill="none" stroke="#0b2540" stroke-width="3"/></svg>').toString('base64');

(async () => {
  // La firma del PDF necesita PNG: se convierte una vez
  let sigPng = null;
  if (sharp) sigPng = 'data:image/png;base64,' + (await sharp(Buffer.from(SIG.split(',')[1], 'base64')).png().toBuffer()).toString('base64');

  let n = maxN;
  V.forEach((s) => (s.d = Math.round(s.d * 2.3))); // reparte las visitas en ~3 meses
  V.sort((a, b) => b.d - a.d); // en orden cronológico para que los folios sean correlativos
  for (const s of V) {
    n++;
    const c = C[s.c], eq = c.eq[s.e];
    const start = new Date(); start.setDate(start.getDate() - s.d);
    if (s.open) start.setTime(Date.now() - 50 * 60000);
    else start.setHours(Math.floor(s.h), Math.round((s.h % 1) * 60), Math.floor(between(0, 59)), 0);
    const end = s.open ? null : new Date(start.getTime() + s.dur * 60000);
    const tAmb = r1(between(14, 30));
    const wx = (t) => JSON.stringify({ source: 'Open-Meteo', temp_c: t, rh: Math.round(between(25, 65)), dew_point_c: r1(t - between(9, 15)), pressure_hpa: Math.round(between(950, 1013)), wind_kmh: r1(between(3, 18)), condition: COND[Math.floor(rnd() * COND.length)] });
    const gps = (which) => {
      if (s.gps === 'sin_gps' && which === 'start') return [null, null, null, null, null, 'señal GPS no disponible (subterráneo)'];
      const far = s.gps === 'lejos' && which === 'end';
      const la = c.lat + (far ? 0.03 : (rnd() - 0.5) * 0.001), ln = c.lng + (far ? 0.02 : (rnd() - 0.5) * 0.001);
      return [la, ln, Math.round(between(4, 18)), far ? null : c.addr, distanceM(la, ln, c.lat, c.lng), null];
    };
    const cl = (CHECKLISTS[s.type] || []).map((item) => ({ item, ok: s.open ? rnd() < 0.3 : s.res === 'operativo' ? true : rnd() > 0.2, note: '' }));
    const nextDate = s.next != null ? new Date(Date.now() + s.next * 86400000).toISOString().slice(0, 10) : null;
    const defaults = {
      mantencion: ['Mantención preventiva programada.', 'Equipo dentro de parámetros, suciedad moderada en condensador.', 'Limpieza de serpentines, revisión eléctrica, verificación de presiones y prueba de fugas.'],
      rutinaria: ['Control de parámetros de operación.', 'Sin novedades relevantes.', 'Registro de temperaturas y revisión de alarmas del controlador.'],
      implementacion: ['Proyecto de instalación.', 'Instalación según plano aprobado.', 'Montaje y puesta en marcha.'],
      reparacion: ['Falla reportada por el cliente.', '', ''],
    }[s.type];
    const vid = insVisit.run(
      `OT-${year}-${String(n).padStart(5, '0')}`, c.id, eq.id, T[s.t], s.type, s.open ? 'en_curso' : 'finalizada', s.type === 'reparacion' && s.down > 8 ? 'urgente' : 'normal',
      start.toISOString(), end ? end.toISOString() : null, ...gps('start'), ...(end ? gps('end') : [null, null, null, null, null, null]),
      wx(tAmb), end ? wx(r1(tAmb + between(-1, 3))) : null,
      s.reason || defaults[0], s.open ? null : s.diag || defaults[1], s.open ? null : s.actions || defaults[2], s.rec || null,
      JSON.stringify(cl), s.parts ? JSON.stringify(s.parts.map(([name, qty]) => ({ name, qty }))) : null,
      s.open ? null : s.res, s.down ?? null, s.ref || null,
      s.open ? null : { austral: 'Rodrigo Pérez', andina: 'Paula Díaz', valle: 'Andrés Lagos', pesquera: 'Hernán Vega', robles: 'Carolina Silva' }[s.c] || 'Cliente',
      s.open ? null : sigPng, s.rate ?? null, nextDate, s.open ? null : crypto.randomBytes(16).toString('hex'), T[s.t],
    ).lastInsertRowid;

    // Mediciones
    const t0 = start.getTime();
    const ms = s.open ? measurements(eq, tAmb, s.caso).filter((m) => m[2] === 'inicial') : measurements(eq, tAmb, s.caso);
    ms.forEach(([kind, val, phase], i) => insM.run(vid, kind, r1(val), UNITS[kind] || '°C', null, phase,
      new Date(t0 + (phase === 'final' ? (s.dur || 60) * 0.85 : 5 + i) * 60000).toISOString()));

    // Fotos
    const list = s.type === 'rutinaria' && rnd() < 0.4 ? [] : PHOTOS[s.type];
    for (const [label, stage, color] of s.open ? list.slice(0, 1) : list) {
      const f = await demoPhoto(vid, label, color);
      if (f) insP.run(vid, f, label, stage, new Date(t0 + between(10, (s.dur || 60) - 5) * 60000).toISOString());
    }
  }
  // Solicitudes asignadas por los supervisores (para hoy, atrasadas, próximas y sin asignar)
  const iso = (dd) => { const x = new Date(Date.now() + dd * 86400000); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const insR = db.prepare(`INSERT INTO requests(code,type,client_id,equipment_id,technician_id,priority,scheduled_date,description,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  let rn = db.prepare('SELECT COUNT(*) n FROM requests WHERE code LIKE ?').get(`SOL-${year}-%`).n;
  [
    ['reparacion', 'provi', 'chiller', 'camila', 'urgente', 0, 'Chiller con alarma de baja presión. Huéspedes reclaman por temperatura.', 'sofia'],
    ['mantencion', 'nunoa', 'cons', 'camila', 'normal', 0, 'Mantención preventiva mensual de cámara de producción.', 'sofia'],
    ['rutinaria', 'valle', 'vitr', 'camila', 'normal', 0, 'Control de temperaturas de vitrinas y registro de alarmas.', 'sofia'],
    ['mantencion', 'enea', 'rack', 'camila', 'alta', -2, 'Mantención trimestral rack CO₂ (atrasada).', 'sofia'],
    ['reparacion', 'austral', 'cong', 'matias', 'alta', 0, 'Cámara de congelado con hielo en evaporador.', 'sofia'],
    ['rutinaria', 'provi', 'cong', 'matias', 'normal', 1, 'Revisión de cámara de cocina.', 'sofia'],
    ['implementacion', 'enea', 'cong', 'javier', 'normal', 2, 'Puesta en marcha de nueva cámara de congelado N°1.', 'ignacio'],
    ['mantencion', 'andina', 'cons', 'valentina', 'normal', 0, 'Mantención preventiva cámara frutas y verduras.', 'ignacio'],
    ['reparacion', 'pesquera', 'tunel', null, 'urgente', 0, 'Túnel IQF no llega a −35 °C. Sin técnico disponible aún.', 'ignacio'],
  ].forEach(([type, ck, ek, tk, prio, dd, desc, by]) => insR.run(`SOL-${year}-${String(++rn).padStart(5, '0')}`, type, C[ck].id, C[ck].eq[ek]?.id || null,
    tk ? T[tk] : null, prio, iso(dd), desc, tk ? 'asignada' : 'pendiente', T[by]));

  console.log(`Listo: ${Object.keys(C).length} empresas demo, ${Object.values(C).reduce((a, c) => a + Object.keys(c.eq).length, 0)} equipos y ${V.length} visitas.`);
  console.log('Técnicos demo (clave demo1234): camila@demo.cl, matias@demo.cl, javier@demo.cl, valentina@demo.cl');
  console.log('Supervisores demo (clave demo1234): sofia@demo.cl (Camila y Matías), ignacio@demo.cl (Javier y Valentina)');
})();
