// Cálculo de KPIs de refrigeración: por visita y agregados (empresa / técnico / cliente)
const db = require('./db');
const { REFRIGERANTS } = require('./catalog');
const { dewPoint } = require('./weather');

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r1 = (x) => (x == null || isNaN(x) ? null : Math.round(x * 10) / 10);
const minutesBetween = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : null);

// phase 'inicial'/'final' = exacta; 'auto' = usa la final si existe, si no la inicial
function pick(meas, kind, phase) {
  const of = (ph) => meas.filter((m) => m.kind === kind && m.phase === ph).map((m) => m.value);
  if (phase === 'auto') { const f = of('final'); return avg(f.length ? f : of('inicial')); }
  return avg(of(phase));
}

// Evalúa un valor contra un rango ideal -> 'ok' | 'warn' | 'bad'
function band(v, okMin, okMax, warnMin, warnMax) {
  if (v == null) return null;
  if (v >= okMin && v <= okMax) return 'ok';
  if (v >= warnMin && v <= warnMax) return 'warn';
  return 'bad';
}

/** KPIs técnicos de una visita individual */
function visitKpis(visit, meas, equipment) {
  const k = [];
  const alerts = [];
  const phase = 'auto';
  const wx = visit.weather_start ? JSON.parse(visit.weather_start) : null;

  const dur = minutesBetween(visit.started_at, visit.ended_at || new Date().toISOString());
  k.push({ key: 'duracion', label: 'Duración de la visita', value: r1(dur), unit: 'min', status: null,
    note: visit.ended_at ? null : 'Visita en curso' });

  // Recalentamiento (superheat) y subenfriamiento (subcooling)
  const ts = pick(meas, 'temp_succion', phase), tse = pick(meas, 'temp_sat_evap', phase);
  if (ts != null && tse != null) {
    const sh = ts - tse;
    const st = band(sh, 4, 10, 2, 15);
    k.push({ key: 'superheat', label: 'Recalentamiento (SH)', value: r1(sh), unit: 'K', status: st, ideal: '4 – 10 K' });
    if (st === 'bad') alerts.push(sh < 2 ? 'Recalentamiento muy bajo: riesgo de retorno de líquido al compresor.' : 'Recalentamiento alto: posible falta de refrigerante o válvula de expansión restringida.');
  }
  const tl = pick(meas, 'temp_liquido', phase), tsc = pick(meas, 'temp_sat_cond', phase);
  if (tl != null && tsc != null) {
    const sc = tsc - tl;
    const st = band(sc, 3, 10, 1, 15);
    k.push({ key: 'subcooling', label: 'Subenfriamiento (SC)', value: r1(sc), unit: 'K', status: st, ideal: '3 – 10 K' });
    if (st === 'bad') alerts.push(sc < 1 ? 'Subenfriamiento casi nulo: posible baja carga de refrigerante.' : 'Subenfriamiento alto: posible sobrecarga o restricción en línea de líquido.');
  }

  // ΔT del evaporador
  const tr = pick(meas, 'temp_retorno_aire', phase), ti = pick(meas, 'temp_inyeccion_aire', phase);
  if (tr != null && ti != null) {
    const dt = tr - ti;
    k.push({ key: 'dt_evap', label: 'ΔT aire evaporador', value: r1(dt), unit: 'K', status: band(dt, 3, 8, 2, 11), ideal: '3 – 8 K' });
  }

  // Approach de condensación vs clima exterior (usa la API climática)
  const tamb = pick(meas, 'temp_sala_maquinas', phase) ?? wx?.temp_c;
  if (tsc != null && tamb != null) {
    const ap = tsc - tamb;
    const st = band(ap, 8, 15, 5, 20);
    k.push({ key: 'approach', label: 'Approach condensación (Tcond − Tamb)', value: r1(ap), unit: 'K', status: st, ideal: '8 – 15 K',
      note: pick(meas, 'temp_sala_maquinas', phase) == null ? 'T° ambiente desde API climática' : null });
    if (ap > 20) alerts.push('Approach de condensación alto: revisar limpieza del condensador y ventiladores.');
  }

  // Temperatura de descarga
  const td = pick(meas, 'temp_descarga', phase);
  if (td != null) {
    const st = td <= 105 ? 'ok' : td <= 120 ? 'warn' : 'bad';
    k.push({ key: 'tdesc', label: 'T° de descarga compresor', value: r1(td), unit: '°C', status: st, ideal: '≤ 105 °C' });
    if (st === 'bad') alerts.push('Temperatura de descarga crítica (>120 °C): riesgo de degradación del aceite.');
  }

  // Cumplimiento de temperatura vs setpoint del equipo
  const interior = meas.filter((m) => m.kind === 'temp_interior');
  if (equipment && equipment.setpoint_c != null && interior.length) {
    const tol = equipment.tolerance_c ?? 2;
    const inRange = interior.filter((m) => Math.abs(m.value - equipment.setpoint_c) <= tol).length;
    const pct = (inRange / interior.length) * 100;
    const dev = pick(meas, 'temp_interior', phase) - equipment.setpoint_c;
    k.push({ key: 'setpoint_dev', label: 'Desviación vs setpoint', value: r1(dev), unit: 'K', status: Math.abs(dev) <= tol ? 'ok' : Math.abs(dev) <= tol * 2 ? 'warn' : 'bad',
      ideal: `± ${tol} K (setpoint ${equipment.setpoint_c} °C)` });
    k.push({ key: 'temp_compliance', label: 'Mediciones dentro de rango', value: r1(pct), unit: '%', status: pct >= 95 ? 'ok' : pct >= 80 ? 'warn' : 'bad', ideal: '≥ 95 %' });
    if (Math.abs(dev) > tol) alerts.push(`Temperatura interior fuera de rango (${r1(dev) > 0 ? '+' : ''}${r1(dev)} K respecto del setpoint).`);
  }

  // Mejora lograda (reparación): T° interior inicial vs final
  const tIni = pick(meas, 'temp_interior', 'inicial'), tFin = pick(meas, 'temp_interior', 'final');
  if (tIni != null && tFin != null) {
    k.push({ key: 'recovery', label: 'Recuperación de temperatura', value: r1(tIni - tFin), unit: 'K', status: null, note: `${r1(tIni)} °C → ${r1(tFin)} °C` });
  }

  // Humedad y punto de rocío interior
  const ti2 = pick(meas, 'temp_interior', phase), hr = pick(meas, 'hr_interior', phase);
  if (hr != null) {
    let st = null;
    if (equipment && equipment.rh_min != null && equipment.rh_max != null) st = hr >= equipment.rh_min && hr <= equipment.rh_max ? 'ok' : 'warn';
    k.push({ key: 'hr', label: 'Humedad relativa interior', value: r1(hr), unit: '%', status: st,
      ideal: equipment?.rh_min != null ? `${equipment.rh_min} – ${equipment.rh_max} %` : null });
    if (ti2 != null) k.push({ key: 'dew', label: 'Punto de rocío interior', value: dewPoint(ti2, hr), unit: '°C', status: null });
  }

  // Emisiones por recarga de refrigerante (indicador de fugas)
  if (visit.refrigerant_added_kg && equipment?.refrigerant) {
    const gwp = REFRIGERANTS[equipment.refrigerant];
    if (gwp != null) {
      const t = (visit.refrigerant_added_kg * gwp) / 1000;
      k.push({ key: 'co2e', label: `Emisión equivalente (${equipment.refrigerant})`, value: r1(t), unit: 't CO₂e', status: t > 1 ? 'warn' : null,
        note: `${visit.refrigerant_added_kg} kg recargados · GWP ${gwp}` });
      if (equipment.charge_kg) {
        const leak = (visit.refrigerant_added_kg / equipment.charge_kg) * 100;
        k.push({ key: 'leak', label: 'Tasa de fuga (recarga / carga total)', value: r1(leak), unit: '%', status: leak <= 5 ? 'ok' : leak <= 10 ? 'warn' : 'bad', ideal: '≤ 5 %' });
        if (leak > 10) alerts.push('Tasa de fuga sobre 10 % de la carga: se recomienda búsqueda y reparación de fuga.');
      }
    }
  }

  if (visit.checklist) {
    const cl = JSON.parse(visit.checklist);
    if (cl.length) {
      const done = cl.filter((c) => c.ok).length;
      k.push({ key: 'checklist', label: 'Checklist completado', value: r1((done / cl.length) * 100), unit: '%', status: done === cl.length ? 'ok' : 'warn', note: `${done} de ${cl.length}` });
    }
  }

  return { kpis: k, alerts };
}

/** KPIs agregados con filtros (fecha desde/hasta, técnico, cliente, tipo) */
function fleetKpis(f = {}) {
  const where = ["v.status != 'anulada'"];
  const p = {};
  if (f.from) { where.push('v.started_at >= @from'); p.from = f.from; }
  if (f.to) { where.push('v.started_at <= @to'); p.to = f.to + 'T23:59:59'; }
  if (f.technician_id) { where.push('v.technician_id = @tech'); p.tech = +f.technician_id; }
  if (f.client_id) { where.push('v.client_id = @client'); p.client = +f.client_id; }
  if (f.type) { where.push('v.type = @type'); p.type = f.type; }
  const W = 'WHERE ' + where.join(' AND ');

  const visits = db.prepare(`
    SELECT v.*, c.name AS client_name, u.name AS tech_name, e.refrigerant, e.name AS equipment_name
    FROM visits v JOIN clients c ON c.id = v.client_id JOIN users u ON u.id = v.technician_id
    LEFT JOIN equipment e ON e.id = v.equipment_id ${W} ORDER BY v.started_at`).all(p);

  const done = visits.filter((v) => v.status === 'finalizada');
  const durs = done.map((v) => minutesBetween(v.started_at, v.ended_at));
  const rep = done.filter((v) => v.type === 'reparacion');
  const fixed = rep.filter((v) => v.result === 'operativo' || v.result === 'operativo_obs');
  const prev = visits.filter((v) => v.type === 'mantencion' || v.type === 'rutinaria');
  const ratings = done.filter((v) => v.client_rating).map((v) => v.client_rating);
  const refrig = done.reduce((s, v) => s + (v.refrigerant_added_kg || 0), 0);
  const co2 = done.reduce((s, v) => s + ((v.refrigerant_added_kg || 0) * (REFRIGERANTS[v.refrigerant] || 0)) / 1000, 0);
  const downtime = rep.reduce((s, v) => s + (v.downtime_hours || 0), 0);

  // MTBF: tiempo medio entre reparaciones de un mismo equipo
  const byEq = {};
  rep.filter((v) => v.equipment_id).forEach((v) => (byEq[v.equipment_id] ||= []).push(new Date(v.started_at)));
  const gaps = [];
  Object.values(byEq).forEach((ds) => { ds.sort((a, b) => a - b); for (let i = 1; i < ds.length; i++) gaps.push((ds[i] - ds[i - 1]) / 86400000); });

  const summary = {
    total: visits.length,
    finalizadas: done.length,
    en_curso: visits.filter((v) => v.status === 'en_curso').length,
    duracion_prom_min: r1(avg(durs)),
    mttr_h: r1(avg(rep.map((v) => minutesBetween(v.started_at, v.ended_at) / 60))),
    ftfr_pct: rep.length ? r1((fixed.length / rep.length) * 100) : null,
    preventivo_pct: visits.length ? r1((prev.length / visits.length) * 100) : null,
    satisfaccion: r1(avg(ratings)),
    mtbf_dias: r1(avg(gaps)),
    refrigerante_kg: r1(refrig),
    co2e_t: r1(co2),
    downtime_h: r1(downtime),
    fuera_servicio: done.filter((v) => v.result === 'fuera_servicio').length,
  };

  // Series y desgloses
  const byMonth = {};
  visits.forEach((v) => { const m = v.started_at.slice(0, 7); (byMonth[m] ||= { reparacion: 0, mantencion: 0, rutinaria: 0, implementacion: 0 })[v.type]++; });
  const byType = {};
  visits.forEach((v) => {
    const t = (byType[v.type] ||= { count: 0, durs: [] });
    t.count++; if (v.ended_at) t.durs.push(minutesBetween(v.started_at, v.ended_at));
  });
  Object.values(byType).forEach((t) => { t.avg_min = r1(avg(t.durs)); delete t.durs; });

  const techMap = {};
  visits.forEach((v) => {
    const t = (techMap[v.technician_id] ||= { id: v.technician_id, name: v.tech_name, visitas: 0, finalizadas: 0, durs: [], ratings: [], rep: 0, repOk: 0 });
    t.visitas++;
    if (v.status === 'finalizada') {
      t.finalizadas++; t.durs.push(minutesBetween(v.started_at, v.ended_at));
      if (v.client_rating) t.ratings.push(v.client_rating);
      if (v.type === 'reparacion') { t.rep++; if (v.result === 'operativo' || v.result === 'operativo_obs') t.repOk++; }
    }
  });
  const technicians = Object.values(techMap).map((t) => ({
    id: t.id, name: t.name, visitas: t.visitas, finalizadas: t.finalizadas,
    duracion_prom_min: r1(avg(t.durs)), horas_totales: r1(t.durs.reduce((s, x) => s + x, 0) / 60),
    satisfaccion: r1(avg(t.ratings)), ftfr_pct: t.rep ? r1((t.repOk / t.rep) * 100) : null,
  })).sort((a, b) => b.visitas - a.visitas);

  const clientMap = {};
  visits.forEach((v) => {
    const c = (clientMap[v.client_id] ||= { id: v.client_id, name: v.client_name, visitas: 0, reparaciones: 0, refrigerante_kg: 0 });
    c.visitas++; if (v.type === 'reparacion') c.reparaciones++; c.refrigerante_kg += v.refrigerant_added_kg || 0;
  });
  const clients = Object.values(clientMap).map((c) => ({ ...c, refrigerante_kg: r1(c.refrigerante_kg) })).sort((a, b) => b.visitas - a.visitas);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = db.prepare(`
    SELECT v.next_visit_date, v.folio, c.name AS client_name, e.name AS equipment_name
    FROM visits v JOIN clients c ON c.id = v.client_id LEFT JOIN equipment e ON e.id = v.equipment_id
    WHERE v.next_visit_date IS NOT NULL AND v.status != 'anulada' AND v.started_at = (
      SELECT MAX(v2.started_at) FROM visits v2 WHERE v2.next_visit_date IS NOT NULL AND v2.status != 'anulada'
      AND v2.client_id = v.client_id AND COALESCE(v2.equipment_id, 0) = COALESCE(v.equipment_id, 0))
    ORDER BY v.next_visit_date LIMIT 12`).all()
    .map((u) => ({ ...u, vencida: u.next_visit_date < today }));

  return { summary, byMonth, byType, technicians, clients, upcoming };
}

module.exports = { visitKpis, fleetKpis, minutesBetween };
