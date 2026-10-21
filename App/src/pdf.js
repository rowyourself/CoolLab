// Informe PDF de la visita. El contenido se adapta al tipo de visita.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const cat = require('./catalog');

const FONTS = path.join(__dirname, '..', 'assets', 'fonts');
const LOGO = path.join(__dirname, '..', 'assets', 'logo.png');
const C = {
  ink: '#0f1b2d', sub: '#5b6b80', line: '#dbe3ec', soft: '#f3f6fa', brand: '#0b3a66', accent: '#14a3c7',
  ok: '#1f9d55', warn: '#d98a00', bad: '#d23b3b',
};
const STATUS = { ok: C.ok, warn: C.warn, bad: C.bad };

const fmtDate = (s) => (s ? new Date(s).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.TZ || 'America/Santiago' }) : '—');
const fmtDur = (a, b) => {
  if (!a || !b) return '—';
  const m = Math.round((new Date(b) - new Date(a)) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

async function buildReport(v, { uploadDir, baseUrl, company }) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 55, left: 45, right: 45 }, bufferPages: true,
    info: { Title: `Informe ${v.folio}`, Author: company, Subject: `Visita técnica ${v.client_name}` } });
  doc.registerFont('R', path.join(FONTS, 'Inter-Regular.otf'));
  doc.registerFont('M', path.join(FONTS, 'Inter-Medium.otf'));
  doc.registerFont('SB', path.join(FONTS, 'Inter-SemiBold.otf'));
  doc.registerFont('B', path.join(FONTS, 'Inter-Bold.otf'));

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h) => { if (doc.y + h > bottom()) doc.addPage(); };
  const type = cat.VISIT_TYPES[v.type];

  // ---------- Cabecera ----------
  doc.rect(0, 0, doc.page.width, 118).fill(C.brand);
  doc.rect(0, 118, doc.page.width, 4).fill(type.color);
  doc.fillColor('#ffffff').font('B').fontSize(17).text(company, L, 34, { width: W - 110 });
  doc.font('R').fontSize(10).fillColor('#bcd3ea').text('Informe de visita técnica · Refrigeración', L, 58);
  doc.font('SB').fontSize(13).fillColor('#ffffff').text(`Folio ${v.folio}`, L, 80);
  doc.font('M').fontSize(9).fillColor('#ffffff')
    .text(type.label.toUpperCase(), L + doc.widthOfString(`Folio ${v.folio}`, { font: 'SB', size: 13 }) + 60, 84);
  if (v.report_token) {
    const qr = await QRCode.toBuffer(`${baseUrl}/r/${v.report_token}`, { margin: 1, width: 180, color: { dark: '#0b3a66', light: '#ffffff' } });
    doc.image(qr, doc.page.width - doc.page.margins.right - 78, 22, { width: 78 });
    doc.font('R').fontSize(6.5).fillColor('#bcd3ea').text('Verificar en línea', doc.page.width - doc.page.margins.right - 78, 102, { width: 78, align: 'center' });
  }
  doc.y = 140;

  // ---------- Helpers ----------
  const section = (title) => {
    ensure(50);
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(L, y + 2, 3, 12).fill(C.accent);
    doc.font('SB').fontSize(11.5).fillColor(C.ink).text(title, L + 10, y);
    doc.moveDown(0.4);
  };
  const para = (label, text) => {
    if (!text) return;
    ensure(40);
    doc.font('SB').fontSize(8.5).fillColor(C.sub).text(label.toUpperCase(), L, doc.y, { characterSpacing: 0.4 });
    doc.font('R').fontSize(10).fillColor(C.ink).text(text, L, doc.y + 2, { width: W, lineGap: 2 });
    doc.moveDown(0.6);
  };
  // Grilla de pares etiqueta / valor
  const grid = (pairs, cols = 3) => {
    const cw = W / cols; const rowH = 34;
    for (let i = 0; i < pairs.length; i += cols) {
      ensure(rowH);
      const y = doc.y;
      pairs.slice(i, i + cols).forEach(([k, val], j) => {
        doc.font('M').fontSize(7.5).fillColor(C.sub).text(k.toUpperCase(), L + j * cw, y, { width: cw - 8, characterSpacing: 0.3 });
        doc.font('SB').fontSize(10).fillColor(C.ink).text(val == null || val === '' ? '—' : String(val), L + j * cw, y + 11, { width: cw - 8, height: 22, ellipsis: true });
      });
      doc.y = y + rowH;
    }
  };
  // Tabla genérica
  const table = (cols, rows, opts = {}) => {
    const hH = 20, pad = 6;
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(L, y, W, hH).fill(C.soft);
      let x = L;
      cols.forEach((c) => { doc.font('SB').fontSize(8).fillColor(C.sub).text(c.label, x + pad, y + 6, { width: c.w * W - pad * 2, align: c.align || 'left' }); x += c.w * W; });
      doc.y = y + hH;
    };
    ensure(hH + 22); drawHeader();
    rows.forEach((row, ri) => {
      const hs = cols.map((c) => doc.font(c.font || 'R').fontSize(9).heightOfString(String(row[c.key] ?? '—'), { width: c.w * W - pad * 2 }));
      const h = Math.max(20, Math.max(...hs) + 10);
      if (doc.y + h > bottom()) { doc.addPage(); drawHeader(); }
      const y = doc.y; let x = L;
      cols.forEach((c) => {
        const val = row[c.key];
        if (c.dot && row._status) doc.circle(x + pad + 3, y + h / 2, 3.2).fill(STATUS[row._status]);
        doc.font(c.font || 'R').fontSize(9).fillColor(c.color ? c.color(row) : C.ink)
          .text(val == null || val === '' ? '—' : String(val), x + pad + (c.dot && row._status ? 12 : 0), y + 5, { width: c.w * W - pad * 2 - (c.dot ? 12 : 0), align: c.align || 'left' });
        x += c.w * W;
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.y = y + h;
    });
    doc.x = L;
  };

  // ---------- Datos generales ----------
  section('Datos de la visita');
  const eq = v.equipment;
  grid([
    ['Empresa cliente', v.client_name], ['RUT', v.client_rut], ['Dirección', v.client_address],
    ['Técnico responsable', v.tech_name], ['Tipo de visita', type.label], ['Prioridad', v.priority],
    ['Inicio', fmtDate(v.started_at)], ['Término', fmtDate(v.ended_at)], ['Duración', fmtDur(v.started_at, v.ended_at)],
  ]);
  // ---------- Registro de asistencia (ubicación al presionar Iniciar / Terminar) ----------
  const att = v.attendance;
  if (att) {
    section('Registro de asistencia en terreno');
    const VER = {
      verificada: [C.ok, '✓ Presencia verificada', `Inicio y término registrados dentro de ${att.geofence_m} m de la ubicación de la empresa.`],
      fuera_rango: [C.bad, '✕ Ubicación fuera de rango', `Al menos un registro quedó a más de ${att.geofence_m} m de la ubicación de la empresa.`],
      sin_gps: [C.warn, '! Registro sin GPS', 'Uno de los registros no tiene ubicación del dispositivo.'],
      sin_referencia: [C.warn, '! Sin ubicación de referencia', 'La empresa no tenía ubicación registrada para comparar.'],
      pendiente: [C.sub, 'Visita en curso', 'Falta registrar el término.'],
    }[att.verified];
    ensure(40);
    const y0 = doc.y;
    doc.roundedRect(L, y0, W, 30, 6).fill(C.soft);
    doc.font('B').fontSize(10).fillColor(VER[0]).text(VER[1], L + 12, y0 + 9, { lineBreak: false });
    doc.font('R').fontSize(8.5).fillColor(C.sub).text(VER[2] + (att.manual ? ' Registro ingresado manualmente por un administrador.' : ''), L + 175, y0 + 6, { width: W - 187, height: 22 });
    doc.y = y0 + 38;
    const row = (label, e) => {
      ensure(54);
      const y = doc.y;
      doc.font('SB').fontSize(8).fillColor(C.sub).text(label, L, y, { width: 70 });
      doc.font('SB').fontSize(10).fillColor(C.ink).text(e ? new Date(e.at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: process.env.TZ || 'America/Santiago' }) : 'No registrado', L + 72, y - 1, { width: 140 });
      if (e && e.lat != null) {
        doc.font('R').fontSize(9).fillColor(C.ink).text(e.address || 'Ubicación GPS del dispositivo', L + 215, y - 1, { width: W - 215 - 95 });
        const url = `https://www.google.com/maps?q=${e.lat},${e.lng}`;
        doc.font('R').fontSize(8).fillColor(C.accent).text(`${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}  ↗ ver en mapa`, L + 215, doc.y + 1, { width: W - 215 - 95, link: url, underline: false });
        const d = e.distance_m;
        const col = d == null ? C.sub : d <= att.geofence_m ? C.ok : C.bad;
        doc.font('SB').fontSize(9.5).fillColor(col).text(d == null ? 'sin referencia' : d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d} m`, L + W - 90, y - 1, { width: 90, align: 'right' });
        doc.font('R').fontSize(7.5).fillColor(C.sub).text(`de la empresa${e.accuracy ? ` · GPS ±${Math.round(e.accuracy)} m` : ''}`, L + W - 120, y + 12, { width: 120, align: 'right' });
      } else if (e) {
        doc.font('R').fontSize(9).fillColor(C.warn).text(`Sin ubicación: ${e.no_gps_reason || 'no disponible'}`, L + 215, y - 1, { width: W - 215 });
      }
      doc.y = Math.max(doc.y, y + 26) + 6;
      doc.moveTo(L, doc.y - 3).lineTo(L + W, doc.y - 3).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.y += 4;
    };
    row('INICIO', att.start);
    row('TÉRMINO', att.end);
    doc.font('R').fontSize(7.5).fillColor(C.sub).text('La fecha y hora las registra el servidor al presionar los botones Iniciar / Terminar visita; el técnico no puede modificarlas.', L, doc.y, { width: W });
  }

  if (eq) {
    section('Equipo intervenido');
    grid([
      ['Equipo', eq.name], ['Tipo', cat.EQUIPMENT_KINDS[eq.kind] || eq.kind], ['Marca / modelo', [eq.brand, eq.model].filter(Boolean).join(' ')],
      ['N° de serie', eq.serial], ['Refrigerante', eq.refrigerant ? `${eq.refrigerant}${eq.charge_kg ? ` · ${eq.charge_kg} kg` : ''}` : null],
      ['Setpoint', eq.setpoint_c != null ? `${eq.setpoint_c} °C ± ${eq.tolerance_c ?? 2}` : null],
    ]);
  }

  // Resultado destacado
  if (v.result) {
    ensure(46); doc.moveDown(0.4);
    const color = v.result === 'operativo' ? C.ok : v.result === 'fuera_servicio' ? C.bad : C.warn;
    const y = doc.y;
    doc.roundedRect(L, y, W, 36, 6).fill(C.soft);
    doc.rect(L, y, 5, 36).fill(color);
    doc.font('M').fontSize(8).fillColor(C.sub).text('RESULTADO DE LA VISITA', L + 16, y + 7);
    doc.font('B').fontSize(12).fillColor(color).text(cat.RESULTS[v.result], L + 16, y + 18);
    if (v.client_rating) doc.font('SB').fontSize(10).fillColor(C.ink).text(`Satisfacción cliente: ${'★'.repeat(v.client_rating)}${'☆'.repeat(5 - v.client_rating)}`, L, y + 13, { width: W - 14, align: 'right' });
    doc.y = y + 44;
  }

  // ---------- Clima exterior (API) ----------
  if (v.weather_start || v.weather_end) {
    section('Condiciones climáticas exteriores');
    const w0 = v.weather_start || {}, w1 = v.weather_end || {};
    const f = (x, u) => (x == null ? '—' : `${x} ${u}`);
    table([
      { key: 'k', label: 'Variable', w: 0.4 }, { key: 'a', label: 'Al iniciar', w: 0.3, align: 'right' }, { key: 'b', label: 'Al terminar', w: 0.3, align: 'right' },
    ], [
      { k: 'Condición', a: w0.condition, b: w1.condition },
      { k: 'Temperatura', a: f(w0.temp_c, '°C'), b: f(w1.temp_c, '°C') },
      { k: 'Humedad relativa', a: f(w0.rh, '%'), b: f(w1.rh, '%') },
      { k: 'Punto de rocío', a: f(w0.dew_point_c, '°C'), b: f(w1.dew_point_c, '°C') },
      { k: 'Presión atmosférica', a: f(w0.pressure_hpa, 'hPa'), b: f(w1.pressure_hpa, 'hPa') },
      { k: 'Viento', a: f(w0.wind_kmh, 'km/h'), b: f(w1.wind_kmh, 'km/h') },
    ]);
    doc.font('R').fontSize(7.5).fillColor(C.sub).text(`Fuente: ${w0.source || w1.source || '—'} según ubicación GPS de la visita.`, L, doc.y + 4);
  }

  // ---------- KPIs ----------
  const kp = (v.kpis || []).filter((k) => k.value != null);
  if (kp.length) {
    section('Indicadores (KPI) de la visita');
    table([
      { key: 'label', label: 'Indicador', w: 0.42, dot: true },
      { key: 'val', label: 'Valor', w: 0.18, align: 'right', font: 'SB' },
      { key: 'ideal', label: 'Referencia', w: 0.2, align: 'right', color: () => C.sub },
      { key: 'note', label: 'Detalle', w: 0.2, color: () => C.sub },
    ], kp.map((k) => ({ ...k, val: k.key === 'duracion' ? fmtDur(v.started_at, v.ended_at || new Date().toISOString()) : `${k.value} ${k.unit}`, _status: k.status })));
  }

  if (v.alerts?.length) {
    ensure(30); doc.moveDown(0.6);
    const y0 = doc.y;
    const txt = v.alerts.map((a) => '•  ' + a).join('\n');
    const h = doc.font('R').fontSize(9.5).heightOfString(txt, { width: W - 28, lineGap: 3 }) + 30;
    ensure(h);
    const y = doc.y;
    doc.roundedRect(L, y, W, h, 6).fillAndStroke('#fff5f5', '#f2c4c4');
    doc.font('SB').fontSize(9).fillColor(C.bad).text('ALERTAS DETECTADAS', L + 14, y + 9);
    doc.font('R').fontSize(9.5).fillColor(C.ink).text(txt, L + 14, y + 23, { width: W - 28, lineGap: 3 });
    doc.y = y + h; if (y0 > y) doc.y = y + h;
  }

  // ---------- Mediciones ----------
  if (v.measurements?.length) {
    section('Mediciones en terreno');
    const rows = {};
    v.measurements.forEach((m) => {
      const key = m.kind + '|' + (m.point || '');
      const r = (rows[key] ||= { label: cat.MEASUREMENTS[m.kind]?.label || m.kind, point: m.point, unit: m.unit, ini: [], fin: [] });
      (m.phase === 'final' ? r.fin : r.ini).push(m.value);
    });
    const f = (a, u) => (a.length ? `${(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1)} ${u}${a.length > 1 ? ` (${a.length})` : ''}` : '—');
    table([
      { key: 'label', label: 'Variable', w: 0.4 }, { key: 'point', label: 'Punto', w: 0.2, color: () => C.sub },
      { key: 'a', label: 'Inicial', w: 0.2, align: 'right' }, { key: 'b', label: 'Final', w: 0.2, align: 'right', font: 'SB' },
    ], Object.values(rows).map((r) => ({ label: r.label, point: r.point, a: f(r.ini, r.unit), b: f(r.fin, r.unit) })));
  }

  // ---------- Contenido según tipo de visita ----------
  const labels = {
    reparacion: ['Falla reportada', 'Diagnóstico', 'Trabajo realizado'],
    mantencion: ['Alcance de la mantención', 'Hallazgos', 'Trabajo realizado'],
    rutinaria: ['Motivo de la visita', 'Observaciones', 'Acciones'],
    implementacion: ['Proyecto / alcance', 'Detalle de la instalación', 'Trabajo realizado'],
  }[v.type];
  if (v.reason || v.diagnosis || v.actions || v.recommendations) {
    section('Detalle técnico');
    para(labels[0], v.reason); para(labels[1], v.diagnosis); para(labels[2], v.actions);
    if (v.type === 'reparacion' && v.downtime_hours != null) para('Tiempo de equipo detenido', `${v.downtime_hours} horas`);
    if (v.refrigerant_added_kg) para('Refrigerante recargado', `${v.refrigerant_added_kg} kg ${eq?.refrigerant || ''}`);
    para('Recomendaciones', v.recommendations);
  }
  if (v.parts_used?.length) {
    section('Repuestos y materiales');
    table([{ key: 'name', label: 'Descripción', w: 0.8 }, { key: 'qty', label: 'Cantidad', w: 0.2, align: 'right' }], v.parts_used);
  }
  if (v.checklist?.length) {
    section(v.type === 'implementacion' ? 'Protocolo de puesta en marcha' : 'Checklist de inspección');
    table([
      { key: 'mark', label: '', w: 0.07, align: 'center', font: 'B', color: (r) => (r.ok ? C.ok : C.bad) },
      { key: 'item', label: 'Ítem', w: 0.55 }, { key: 'note', label: 'Observación', w: 0.38, color: () => C.sub },
    ], v.checklist.map((c) => ({ ...c, mark: c.ok ? '✓' : '✗' })));
  }

  // ---------- Fotografías ----------
  const photos = (v.photos || []).filter((p) => fs.existsSync(path.join(uploadDir, p.filename)));
  if (photos.length) {
    ensure(260); // que el título no quede solo al final de la página
    section('Registro fotográfico');
    const order = { antes: 0, durante: 1, despues: 2 };
    photos.sort((a, b) => (order[a.stage] ?? 1) - (order[b.stage] ?? 1));
    const gap = 12, pw = (W - gap) / 2, ph = pw * 0.72;
    for (let i = 0; i < photos.length; i += 2) {
      ensure(ph + 30);
      const y = doc.y;
      photos.slice(i, i + 2).forEach((p, j) => {
        const x = L + j * (pw + gap);
        doc.save().roundedRect(x, y, pw, ph, 5).clip();
        doc.rect(x, y, pw, ph).fill(C.soft);
        try { doc.image(path.join(uploadDir, p.filename), x, y, { cover: [pw, ph], align: 'center', valign: 'center' }); } catch {}
        doc.restore();
        const tag = { antes: 'ANTES', durante: 'DURANTE', despues: 'DESPUÉS' }[p.stage] || '';
        doc.font('SB').fontSize(7.5).fillColor(C.accent).text(tag, x, y + ph + 5);
        if (p.caption) doc.font('R').fontSize(8.5).fillColor(C.ink).text(p.caption, x + doc.widthOfString(tag, { font: 'SB', size: 7.5 }) + 6, y + ph + 4.5, { width: pw - 60, height: 12, ellipsis: true });
      });
      doc.y = y + ph + 24;
    }
  }

  // ---------- Cierre y firmas ----------
  ensure(130);
  section('Conformidad');
  if (v.next_visit_date) para('Próxima visita recomendada', new Date(v.next_visit_date + 'T12:00:00').toLocaleDateString('es-CL', { dateStyle: 'long' }));
  const y = doc.y + 10, sw = (W - 30) / 2;
  if (v.client_signature?.startsWith('data:image')) {
    try { doc.image(Buffer.from(v.client_signature.split(',')[1], 'base64'), L + sw + 30, y, { fit: [sw, 60], align: 'center' }); } catch {}
  }
  doc.moveTo(L, y + 66).lineTo(L + sw, y + 66).lineWidth(0.7).strokeColor(C.sub).stroke();
  doc.moveTo(L + sw + 30, y + 66).lineTo(L + W, y + 66).stroke();
  doc.font('SB').fontSize(9).fillColor(C.ink).text(v.tech_name, L, y + 72, { width: sw, align: 'center' });
  doc.font('R').fontSize(8).fillColor(C.sub).text('Técnico responsable', L, y + 85, { width: sw, align: 'center' });
  doc.font('SB').fontSize(9).fillColor(C.ink).text(v.client_signer || 'Representante del cliente', L + sw + 30, y + 72, { width: sw, align: 'center' });
  doc.font('R').fontSize(8).fillColor(C.sub).text(`Recepción conforme · ${v.client_name}`, L + sw + 30, y + 85, { width: sw, align: 'center' });

  // ---------- Pie de página ----------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const fy = doc.page.height - 34;
    doc.page.margins.bottom = 0;
    doc.moveTo(L, fy - 6).lineTo(L + W, fy - 6).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.image(LOGO, L, fy - 2, { width: 11 });
    doc.font('R').fontSize(7.5).fillColor(C.sub)
      .text(`Generado con CoolLab · ${company} · Folio ${v.folio} · ${fmtDate(new Date().toISOString())}`, L + 15, fy, { width: W * 0.8, lineBreak: false });
    doc.text(`Página ${i + 1} de ${range.count}`, L, fy, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

module.exports = { buildReport };
