/* CoolLab — app del técnico + dashboards. JavaScript sin frameworks. */
'use strict';

const S = { me: null, cat: null, clients: null, timer: null, charts: [] };
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isStaff = () => S.me && (S.me.role === 'admin' || S.me.role === 'supervisor');
const LOGO = `<img src="/icon.svg" alt="" class="logo-img">`;

// ---------- utilidades ----------
// Capa del mapa. Principal: OpenStreetMap (exige que el navegador envíe el origen; ver Referrer-Policy en server.js).
// Respaldo automático: Esri World Street Map, si OpenStreetMap bloquea la app (403). CARTO ya no se usa: ahora pide API key.
const TILE_PROVIDERS = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
  esri: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', maxZoom: 19,
    attribution: 'Mapa © <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, © OpenStreetMap' },
};
// Revisa una sola vez por sesión si OpenStreetMap responde; si no, usa Esri
function tileProvider() {
  if (tileProvider.p) return tileProvider.p;
  let saved = null; try { saved = sessionStorage.getItem('cl_tiles'); } catch {}
  if (saved && TILE_PROVIDERS[saved]) return (tileProvider.p = Promise.resolve(saved));
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
  return (tileProvider.p = fetch('https://tile.openstreetmap.org/10/310/617.png', { referrerPolicy: 'strict-origin-when-cross-origin', signal: ctrl.signal })
    .then((r) => (r.ok ? 'osm' : 'esri')).catch(() => 'esri')
    .then((k) => { clearTimeout(t); try { sessionStorage.setItem('cl_tiles', k); } catch {} return k; }));
}
const osmTiles = (map) => {
  const make = (k) => L.tileLayer(TILE_PROVIDERS[k].url, { maxZoom: TILE_PROVIDERS[k].maxZoom, attribution: TILE_PROVIDERS[k].attribution, referrerPolicy: 'strict-origin-when-cross-origin' });
  let layer = make('osm').addTo(map); // se muestra de inmediato; si OSM está bloqueado se cambia a Esri
  tileProvider().then((k) => { if (k !== 'osm' && map.hasLayer(layer)) { map.removeLayer(layer); layer = make(k).addTo(map); } });
  return layer;
};
async function api(path, opts = {}) {
  const o = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
  if (o.body && !(o.body instanceof FormData) && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers['Content-Type'] = 'application/json'; }
  const r = await fetch('/api' + path, o);
  if (r.status === 401 && !path.startsWith('/auth')) { S.me = null; renderLogin(); throw new Error('Sesión expirada'); }
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(data?.error || 'Error ' + r.status);
  return data;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 3200);
}
const fmtDT = (s) => (s ? new Date(s).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtD = (s) => (s ? new Date(s.length === 10 ? s + 'T12:00' : s).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtMin = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)} min`);
const typeChip = (t) => `<span class="chip"><i style="background:var(--t-${t})"></i>${esc(S.cat.visitTypes[t]?.label || t)}</span>`;
const resultChip = (r) => r ? `<span class="chip ${r === 'operativo' ? 'ok' : r === 'fuera_servicio' ? 'bad' : 'warn'}">${r === 'operativo' ? '✓' : r === 'fuera_servicio' ? '✕' : '!'} ${esc(S.cat.results[r])}</span>` : '';
const statusChip = (v) => v.status === 'en_curso' ? '<span class="chip live"><i></i>En curso</span>' : v.status === 'anulada' ? '<span class="chip">Anulada</span>' : resultChip(v.result);
const kpiStatus = { ok: ['ok', '✓ En rango'], warn: ['warn', '! Revisar'], bad: ['bad', '✕ Fuera de rango'] };
function getPos(fresh) {
  return new Promise((res) => {
    if (!navigator.geolocation) return res({ error: 'el dispositivo no tiene GPS' });
    if (!window.isSecureContext) return res({ error: 'el GPS requiere HTTPS' });
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (e) => res({ error: e.code === 1 ? 'permiso de ubicación denegado' : e.code === 3 ? 'el GPS no respondió a tiempo' : 'señal GPS no disponible' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: fresh ? 0 : 60000 });
  });
}
// Ubicación al presionar Iniciar / Terminar. Si no hay GPS, el técnico puede continuar y queda registrado en el informe.
async function stampLocation(accion) {
  toast('Obteniendo tu ubicación…');
  const p = await getPos(true);
  if (!p.error) return { lat: p.lat, lng: p.lng, accuracy: p.accuracy };
  const ok = confirm(`No se pudo obtener tu ubicación (${p.error}).\n\nPara ${accion} con ubicación, activa el GPS y permite la ubicación en el navegador.\n\n¿${accion[0].toUpperCase() + accion.slice(1)} de todas formas? El informe indicará "Registro sin GPS".`);
  return ok ? { no_gps_reason: p.error } : null;
}
const fmtDist = (d) => (d == null ? '—' : d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d} m`);
const mapLink = (e) => `https://www.google.com/maps?q=${e.lat},${e.lng}`;
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function formData(form) { const o = {}; new FormData(form).forEach((v, k) => (o[k] = v)); return o; }
function busy(btn, on, label) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.l = btn.innerHTML; btn.innerHTML = label || 'Guardando…'; } else if (btn.dataset.l) btn.innerHTML = btn.dataset.l; }

// ---------- arranque ----------
async function boot() {
  try { S.me = await api('/me'); } catch { return renderLogin(); }
  S.cat = await api('/catalog');
  document.title = 'CoolLab · ' + S.cat.company.name;
  window.addEventListener('hashchange', route);
  route();
}

function renderLogin() {
  clearInterval(S.timer);
  const ic = (d) => `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  // Diseño "Propuesta A": encabezado compacto + formulario visible de inmediato en el celular; panel lateral en escritorio
  $('#app').innerHTML = `
  <div class="lg">
    <aside class="lg-side">
      <div class="lg-brand"><img src="/icon-192.png" alt="" width="44" height="44"><span>CoolLab</span></div>
      <p class="lg-tag">Gestión técnica de refrigeración industrial</p>
      <div class="lg-more">
        <p class="lg-lead">Visitas en terreno, mediciones e informes firmados por el cliente, en un solo lugar.</p>
        <ul class="lg-feat">
          <li><span>${ic('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>')}</span><p><b>Asistencia verificada.</b> Hora, GPS y clima al iniciar y terminar cada visita.</p></li>
          <li><span>${ic('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14h6"/>')}</span><p><b>Informe PDF con firma.</b> El cliente firma en pantalla y recibe el informe por QR.</p></li>
          <li><span>${ic('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>')}</span><p><b>KPIs de cada equipo.</b> Recalentamiento, MTTR, fugas y CO₂e calculados solos.</p></li>
        </ul>
      </div>
    </aside>
    <main class="lg-main">
      <form id="lf" class="lg-form" novalidate>
        <h1>Ingresar</h1>
        <p class="lg-sub">Usa el correo que te entregó tu empresa.</p>
        <div class="lg-field"><label for="lg-email">Correo</label>
          <div class="lg-input">${ic('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>')}
            <input id="lg-email" name="email" type="email" inputmode="email" autocomplete="username" placeholder="nombre@empresa.cl" required></div></div>
        <div class="lg-field"><label for="lg-pass">Contraseña</label>
          <div class="lg-input">${ic('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')}
            <input id="lg-pass" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required>
            <button type="button" class="lg-show" data-show aria-pressed="false">Mostrar</button></div></div>
        <p class="lg-err" role="alert" hidden></p>
        <button class="lg-go" type="submit">Entrar</button>
        <p class="lg-help">¿Olvidaste tu contraseña?<br>Pídele una nueva al administrador.</p>
        <div class="lg-install">${ic('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>')}<span>Instálala en tu celular: menú del navegador → <b>Agregar a pantalla de inicio</b></span></div>
      </form>
    </main>
  </div>`;
  const f = $('#lf'), err = $('.lg-err', f), pass = $('#lg-pass'), show = $('[data-show]', f);
  show.onclick = () => { const v = pass.type === 'password'; pass.type = v ? 'text' : 'password'; show.textContent = v ? 'Ocultar' : 'Mostrar'; show.setAttribute('aria-pressed', String(v)); pass.focus(); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const b = formData(f);
    if (!b.email || !b.password) { err.textContent = 'Escribe tu correo y tu contraseña.'; err.hidden = false; return; }
    const btn = $('.lg-go', f); busy(btn, true, 'Entrando…');
    try { S.me = await api('/auth/login', { method: 'POST', body: b }); boot(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; busy(btn, false); }
  };
}

function nav() {
  const staff = isStaff();
  // Cada perfil tiene su propio menú
  const items = S.me.role === 'admin'
    ? [['#/dashboard', '◧', 'Dashboard'], ['#/solicitudes', '✎', 'Solicitudes'], ['#/equipo', '◉', 'Técnicos'], ['#/visitas', '☰', 'Visitas'], ['#/clientes', '▣', 'Clientes'], ['#/usuarios', '⚙', 'Usuarios']]
    : staff
      ? [['#/dashboard', '◧', 'Dashboard'], ['#/solicitudes', '✎', 'Solicitudes'], ['#/equipo', '◉', 'Mi equipo'], ['#/visitas', '☰', 'Visitas'], ['#/clientes', '▣', 'Clientes']]
      : [['#/', '⌂', 'Mi ruta'], ['#/visitas', '☰', 'Visitas'], ['#/mi-dashboard', '◧', 'Mis KPI']];
  const cur = location.hash || '#/';
  const on = (h) => (cur === h || (h !== '#/' && cur.startsWith(h)) ? 'on' : '');
  return {
    side: `<aside class="side"><div class="logo">${LOGO}<span>CoolLab</span></div>
      ${items.map(([h, ic, l]) => `<a href="${h}" class="${on(h)}"><span>${ic}</span>${l}${h === '#/solicitudes' ? '<b class="nbadge" data-nb hidden></b>' : ''}</a>`).join('')}
      <div class="me"><b>${esc(S.me.name)}</b>${esc({ admin: 'Administrador', supervisor: 'Supervisor', tecnico: 'Técnico' }[S.me.role])}
      <div style="margin-top:8px"><a href="#/cuenta" style="padding:0;display:inline">Mi cuenta</a> · <a href="#" data-logout style="padding:0;display:inline">Salir</a></div></div></aside>`,
    top: `<div class="topbar">${LOGO}<span>CoolLab</span><span class="sp"></span><button onclick="location.hash='#/cuenta'">${esc(S.me.name.split(' ')[0])}</button></div>`,
    tab: `<nav class="tabbar">${items.slice(0, 6).map(([h, ic, l]) => `<a href="${h}" class="${on(h)}"><span>${ic}${h === '#/solicitudes' ? '<b class="nbadge" data-nb hidden></b>' : ''}</span>${l}</a>`).join('')}</nav>`,
  };
}

function layout(html) {
  const n = nav();
  $('#app').innerHTML = `<div class="shell">${n.side}<div>${n.top}<main id="main">${html}</main></div></div>${n.tab}`;
  if (isStaff()) refreshActiveBadge();
  $$('[data-logout]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }); S.me = null; location.hash = ''; renderLogin(); }));
}

// Marcador en el menú "Solicitudes": cuántas visitas están en curso ahora (admin: todas; supervisor: las de su equipo)
async function refreshActiveBadge(rows) {
  try {
    const n = (rows || await api('/requests?status=en_curso&limit=1000')).filter((q) => q.status === 'en_curso').length;
    $$('[data-nb]').forEach((b) => { b.hidden = !n; b.textContent = n; b.title = `${n} solicitud${n === 1 ? '' : 'es'} en curso`; });
  } catch { /* sin conexión: se deja como estaba */ }
}

async function route() {
  clearInterval(S.timer);
  $$('dialog[open]').forEach((d) => d.close()); // al cambiar de pantalla se cierran los formularios abiertos
  S.charts.forEach((c) => c.destroy()); S.charts = [];
  const h = (location.hash || '#/').slice(1);
  const [, a, b] = h.split('/');
  try {
    if (!a) return isStaff() ? (location.hash = '#/dashboard') : viewHome();
    if (a === 'nueva') { if (!isStaff()) { toast('Las visitas se inician desde una solicitud asignada', true); location.hash = '#/'; return; } return viewNew(); }
    if (a === 'visita') return viewVisit(+b);
    if (a === 'visitas') return viewVisits(+b || null);
    if (a === 'dashboard') return viewDashboard({});
    if (a === 'mi-dashboard') return viewDashboard({ technician_id: S.me.id, mine: true });
    if (a === 'tecnico') return viewDashboard({ technician_id: +b });
    if (a === 'solicitudes' && isStaff()) return viewRequests();
    if (a === 'equipo' && isStaff()) return viewTeam();
    if (a === 'clientes') return viewClients();
    if (a === 'cliente') return viewClient(+b);
    if (a === 'usuarios') return viewUsers();
    if (a === 'cuenta') return viewAccount();
    location.hash = '#/';
  } catch (e) { toast(e.message, true); }
}

// ---------- Inicio del técnico ----------
async function viewHome() {
  const [list, reqs] = await Promise.all([api('/visits?limit=30'), api('/requests?status=abiertas')]);
  const open = list.filter((v) => v.status === 'en_curso' && !reqs.some((q) => q.visit_id === v.id));
  const done = list.filter((v) => v.status !== 'en_curso');
  const today = todayISO();
  const todayReqs = reqs.filter((q) => q.status !== 'en_curso' && (!q.scheduled_date || q.scheduled_date <= today));
  const later = reqs.filter((q) => q.status !== 'en_curso' && q.scheduled_date && q.scheduled_date > today);
  const running = reqs.filter((q) => q.status === 'en_curso');
  const late = todayReqs.filter((q) => q.scheduled_date && q.scheduled_date < today).length;
  layout(`
    <div class="head"><div><h1>Hola, ${esc(S.me.name.split(' ')[0])}</h1><p>${new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
    <div class="grid g4">
      ${tile('Para hoy', todayReqs.length, '', 'Visitas asignadas')}${tile('En curso', running.length + open.length, '', 'Iniciadas')}
      ${tile('Atrasadas', late, '', late ? 'Fecha programada vencida' : 'Al día')}${tile('Próximas', later.length, '', 'Programadas más adelante')}
    </div>
    ${running.length || open.length ? `<div class="card" style="margin-top:14px"><h2>En curso</h2><ul class="list">${running.map((q) => reqItem(q, true)).join('')}${open.map(visitItem).join('')}</ul></div>` : ''}
    <div class="card" style="margin-top:14px"><h2>Ruta del día <span class="faint" style="font-weight:500;margin-left:auto" id="rtInfo"></span></h2>
      ${todayReqs.length ? `<div class="routemap" id="rtMap"></div>
        <div class="row" style="margin-top:10px"><button class="btn" id="rtGps">📍 Recalcular desde mi ubicación</button><a class="btn primary" id="rtNav" target="_blank" rel="noopener">🧭 Abrir ruta en Google Maps</a></div>
        <ul class="list" id="rtList" style="margin-top:6px"></ul>` : '<div class="empty">No tienes visitas asignadas para hoy. Tu supervisor te las asignará aquí.</div>'}
    </div>
    ${later.length ? `<div class="card" style="margin-top:14px"><h2>Próximas visitas</h2><ul class="list">${later.map((q) => reqItem(q, true)).join('')}</ul></div>` : ''}
    <p class="faint" style="margin:14px 2px 0;font-size:13.5px">Las visitas se inician solo desde una solicitud asignada. ¿Te piden un trabajo que no aparece aquí? Pídele a tu supervisor que te lo asigne.</p>
    <div class="card" style="margin-top:14px"><h2>Últimas visitas</h2>
      ${done.length ? `<ul class="list">${done.slice(0, 10).map(visitItem).join('')}</ul>` : '<div class="empty">Aún no tienes visitas registradas.</div>'}</div>`);
  bindReqActions(viewHome);
  if (todayReqs.length) planRoute(todayReqs);
}

// ---------- Ruta: orden de visitas según la ubicación del técnico ----------
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
function kmBetween(a, b) {
  const R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Vecino más cercano + mejora 2-opt (ruta abierta que parte en la ubicación actual). Las urgentes van primero.
function bestOrder(start, stops) {
  const urgent = stops.filter((x) => x.priority === 'urgente'), rest = stops.filter((x) => x.priority !== 'urgente');
  const nn = (from, pts) => { const out = []; let cur = from; const left = [...pts];
    while (left.length) { let bi = 0; left.forEach((p, i) => { if (kmBetween(cur, p) < kmBetween(cur, left[bi])) bi = i; }); cur = left.splice(bi, 1)[0]; out.push(cur); } return out; };
  const len = (from, seq) => seq.reduce((s, p, i) => s + kmBetween(i ? seq[i - 1] : from, p), 0);
  const twoOpt = (from, seq) => { let best = seq, improved = true, guard = 0;
    while (improved && guard++ < 50) { improved = false;
      for (let i = 0; i < best.length - 1; i++) for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        if (len(from, cand) + 1e-9 < len(from, best)) { best = cand; improved = true; } } }
    return best; };
  const a = twoOpt(start, nn(start, urgent));
  const b = twoOpt(a.length ? a[a.length - 1] : start, nn(a.length ? a[a.length - 1] : start, rest));
  return [...a, ...b];
}
function gmapsRoute(origin, seq) {
  if (!seq.length) return '#';
  const pt = (p) => `${p.lat},${p.lng}`;
  const dest = seq[Math.min(seq.length, 10) - 1], way = seq.slice(0, Math.min(seq.length, 10) - 1);
  return `https://www.google.com/maps/dir/?api=1${origin ? '&origin=' + pt(origin) : ''}&destination=${pt(dest)}${way.length ? '&waypoints=' + encodeURIComponent(way.map(pt).join('|')) : ''}&travelmode=driving`;
}
async function planRoute(reqs) {
  const withLoc = reqs.filter((q) => q.client_lat != null).map((q) => ({ ...q, lat: q.client_lat, lng: q.client_lng }));
  const noLoc = reqs.filter((q) => q.client_lat == null);
  let me = null, map = null, layer = null;
  try { await loadLeaflet(); map = L.map($('#rtMap'), { zoomControl: true }); osmTiles(map); }
  catch { $('#rtMap').innerHTML = '<div class="empty">No se pudo cargar el mapa.</div>'; }
  const draw = () => {
    const seq = withLoc.length ? bestOrder(me || withLoc[0], withLoc) : [];
    let total = 0;
    $('#rtList').innerHTML = seq.map((q, i) => { const d = kmBetween(i ? seq[i - 1] : me || seq[0], q); total += i || me ? d : 0;
      return reqItem(q, true, `<span class="stop">${i + 1}</span>`, i || me ? `${d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km'} desde ${i ? 'la anterior' : 'tu ubicación'}` : 'Primera parada'); }).join('')
      + noLoc.map((q) => reqItem(q, true, '<span class="stop off">?</span>', 'Empresa sin ubicación: no entra en la ruta')).join('');
    $('#rtInfo').textContent = seq.length ? `${seq.length} paradas · ≈ ${total.toFixed(1)} km en línea recta` : '';
    $('#rtNav').href = gmapsRoute(me, seq);
    $('#rtNav').classList.toggle('disabled', !seq.length);
    bindReqActions(viewHome);
    if (!map) return;
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    const pts = [];
    if (me) { L.circleMarker([me.lat, me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2a78d6', fillOpacity: 1 }).addTo(layer).bindTooltip('Tú'); pts.push([me.lat, me.lng]); }
    seq.forEach((q, i) => { L.marker([q.lat, q.lng], { icon: numIcon(i + 1, q.priority === 'urgente') }).addTo(layer).bindPopup(`<b>${esc(q.client_name)}</b><br>${esc(q.client_address || '')}`); pts.push([q.lat, q.lng]); });
    if (pts.length > 1) L.polyline(pts, { color: cssVar('--accent') || '#0c8fb3', weight: 3, dashArray: '6 6' }).addTo(layer);
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 }); else map.setView([-33.45, -70.66], 10);
    setTimeout(() => map.invalidateSize(), 100);
  };
  draw();
  const locate = async () => { $('#rtInfo').textContent = 'Obteniendo tu ubicación…'; const p = await getPos(true);
    if (p.error) { toast('Sin GPS: ' + p.error + '. La ruta parte en la primera visita.', true); } else me = { lat: p.lat, lng: p.lng };
    draw(); };
  $('#rtGps').onclick = locate;
  locate();
}
const numIcon = (n, urgent) => L.divIcon({ className: '', html: `<div class="pin${urgent ? ' urg' : ''}">${n}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });

// ---------- Solicitudes: elementos compartidos ----------
const PRIO = { urgente: ['bad', 'Urgente'], alta: ['warn', 'Alta'], normal: ['', 'Normal'], baja: ['', 'Baja'] };
const REQST = { pendiente: ['warn', 'Sin asignar'], asignada: ['live', 'Asignada'], en_curso: ['live', 'En curso'], completada: ['ok', '✓ Completada'], cancelada: ['', 'Cancelada'] };
const prioChip = (p) => p && p !== 'normal' ? `<span class="chip ${PRIO[p]?.[0] || ''}">${esc(PRIO[p]?.[1] || p)}</span>` : '';
const reqChip = (q) => `<span class="chip ${REQST[q.status][0]}">${q.status === 'en_curso' ? '<i></i>' : ''}${REQST[q.status][1]}</span>`;
function reqItem(q, techView, lead = '', extra = '') {
  const late = q.scheduled_date && q.scheduled_date < todayISO() && ['asignada', 'en_curso', 'pendiente'].includes(q.status);
  const nav = q.client_lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${q.client_lat},${q.client_lng}&travelmode=driving` : null;
  const act = techView
    ? (q.status === 'en_curso' && q.visit_id ? `<a class="btn sm primary" href="#/visita/${q.visit_id}">Continuar</a>`
      : ['asignada', 'pendiente'].includes(q.status) ? `<button class="btn sm primary" data-start="${q.id}">▶ Iniciar</button>` : q.visit_id ? `<a class="btn sm" href="#/visita/${q.visit_id}">Ver</a>` : '')
      + (nav && ['asignada', 'pendiente'].includes(q.status) ? `<a class="btn sm" href="${nav}" target="_blank" rel="noopener" title="Cómo llegar">🧭</a>` : '')
    : '';
  return `<li class="item req">${lead}<span class="bar" style="background:var(--t-${q.type})"></span>
    <div class="main"><b>${esc(q.client_name)}</b>
      <div class="meta"><span class="num">${esc(q.code)}</span> · ${esc(S.cat.visitTypes[q.type].label)}${q.equipment_name ? ' · ' + esc(q.equipment_name) : ''}</div>
      <div class="meta">${q.client_address ? esc(q.client_address) + ' · ' : ''}${q.scheduled_date ? `<span style="${late ? 'color:var(--bad);font-weight:600' : ''}">${late ? 'Atrasada · ' : ''}${fmtD(q.scheduled_date)}</span>` : 'Sin fecha'}${!techView && q.tech_name ? ' · ' + esc(q.tech_name) : ''}</div>
      ${q.description ? `<div class="meta faint">${esc(q.description)}</div>` : ''}${extra ? `<div class="meta faint">${extra}</div>` : ''}</div>
    <div class="req-r">${prioChip(q.priority)}${reqChip(q)}<div class="row end" style="gap:6px">${act}</div></div></li>`;
}
function bindReqActions(again) {
  $$('[data-start]').forEach((b) => (b.onclick = async () => {
    busy(b, true, 'Ubicando…');
    const loc = await stampLocation('iniciar la visita');
    if (!loc) return busy(b, false);
    try { const v = await api(`/requests/${b.dataset.start}/start`, { method: 'POST', body: loc }); toast(loc.lat != null ? 'Visita iniciada · ubicación registrada' : 'Visita iniciada sin GPS'); location.hash = '#/visita/' + v.id; }
    catch (err) { toast(err.message, true); busy(b, false); }
  }));
}
function visitItem(v) {
  return `<li><a class="item" href="#/visita/${v.id}"><span class="bar" style="background:var(--t-${v.type})"></span>
    <div class="main"><b>${esc(v.client_name)}</b><div class="meta"><span class="num">${esc(v.folio)}</span> · ${esc(S.cat.visitTypes[v.type].label)}${v.equipment_name ? ' · ' + esc(v.equipment_name) : ''}</div>
    <div class="meta">${fmtDT(v.started_at)}${v.ended_at ? ' · ' + fmtMin((new Date(v.ended_at) - new Date(v.started_at)) / 60000) : ''}${isStaff() ? ' · ' + esc(v.tech_name) : ''}</div></div>
    ${statusChip(v)}</a></li>`;
}

// ---------- Nueva visita ----------
async function viewNew() {
  const [clients, { folio }, users] = await Promise.all([api('/clients'), api('/visits/next-folio'), isStaff() ? api('/users') : Promise.resolve([])]);
  S.clients = clients;
  const techs = users.filter((u) => u.active);
  layout(`
    <div class="head"><div><h1>Registrar visita</h1><p>Registro manual de una visita a nombre de un técnico. Se crea automáticamente su solicitud, para que toda visita quede autorizada.</p></div></div>
    <form id="nf" class="stack" style="max-width:720px">
      <div class="card"><h2>1 · Tipo de visita</h2>
        <div class="types">${Object.entries(S.cat.visitTypes).map(([k, t]) => `<button type="button" data-type="${k}"><i style="background:var(--t-${k})"></i>${esc(t.label)}</button>`).join('')}</div>
        <input type="hidden" name="type" required></div>
      <div class="card"><h2>2 · Empresa y equipo</h2>
        <div class="field"><label>Empresa visitada</label>
          <div class="row" style="flex-wrap:nowrap"><select name="client_id" required><option value="">Selecciona…</option>${clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
          <button type="button" class="btn" id="addClient" title="Nueva empresa">＋</button></div></div>
        <div class="field"><label>Equipo intervenido (opcional)</label>
          <div class="row" style="flex-wrap:nowrap"><select name="equipment_id"><option value="">— Sin equipo específico —</option></select>
          <button type="button" class="btn" id="addEq" title="Nuevo equipo">＋</button></div></div>
      </div>
      <div class="card"><h2>3 · Datos de la orden</h2>
        <div class="fields">
          <div><label>Folio de la operación</label><input name="folio" value="${esc(folio)}" class="num"></div>
          <div><label>Prioridad</label><select name="priority"><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option><option value="baja">Baja</option></select></div>
          ${isStaff() ? `<div><label>Técnico que realizó la visita</label><select name="technician_id" required><option value="">Selecciona…</option>${techs.filter((u) => u.role === 'tecnico').map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>` : ''}
        </div>
        <div class="field" style="margin-top:12px"><label id="reasonL">Motivo / falla reportada</label><textarea name="reason" placeholder="Ej: cámara N°2 no baja de 8 °C desde la mañana"></textarea></div>
      </div>
      <div class="card" id="wxCard"><h2>Clima exterior</h2><div class="muted" id="wxBox">Obteniendo ubicación…</div></div>
      <div class="sticky-actions"><button class="btn primary big" id="startBtn">▶ Iniciar visita</button></div>
    </form>`);

  getPos().then(async (p) => {
    if (p.error) { $('#wxBox').textContent = `Sin GPS (${p.error}). Actívalo antes de iniciar para que la ubicación quede en el informe.`; return; }
    try {
      const w = await api(`/weather?lat=${p.lat}&lng=${p.lng}`);
      $('#wxBox').innerHTML = w ? `<div class="row" style="gap:18px"><span><b class="num">${w.temp_c}</b> °C ${esc(w.condition)}</span><span>HR <b class="num">${w.rh}</b>%</span><span>Rocío <b class="num">${w.dew_point_c}</b> °C</span><span class="faint">${esc(w.source)}</span></div>` : 'Clima no disponible en este momento.';
    } catch { $('#wxBox').textContent = 'Clima no disponible.'; }
  });

  const f = $('#nf');
  $$('[data-type]').forEach((b) => (b.onclick = () => {
    $$('[data-type]').forEach((x) => x.classList.toggle('on', x === b));
    f.type.value = b.dataset.type;
    $('#reasonL').textContent = { reparacion: 'Falla reportada', mantencion: 'Alcance de la mantención', rutinaria: 'Motivo de la visita', implementacion: 'Proyecto / alcance' }[b.dataset.type];
  }));
  const loadEq = async (sel) => {
    const id = f.client_id.value;
    const eqs = id ? await api(`/clients/${id}/equipment`) : [];
    f.equipment_id.innerHTML = '<option value="">— Sin equipo específico —</option>' + eqs.map((e) => `<option value="${e.id}">${esc(e.name)}${e.refrigerant ? ' · ' + esc(e.refrigerant) : ''}</option>`).join('');
    if (sel) f.equipment_id.value = sel;
  };
  f.client_id.onchange = () => loadEq();
  $('#addClient').onclick = () => clientDialog(null, async (id) => {
    S.clients = await api('/clients');
    f.client_id.innerHTML = '<option value="">Selecciona…</option>' + S.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    f.client_id.value = id; loadEq();
  });
  $('#addEq').onclick = () => { if (!f.client_id.value) return toast('Primero elige la empresa', true); equipmentDialog(+f.client_id.value, null, (id) => loadEq(id)); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.type.value) return toast('Elige el tipo de visita', true);
    const b = formData(f);
    busy($('#startBtn'), true, 'Registrando ubicación…');
    const loc = await stampLocation('iniciar la visita');
    if (!loc) return busy($('#startBtn'), false);
    Object.assign(b, loc);
    try { const v = await api('/visits', { method: 'POST', body: b }); toast(loc.lat != null ? 'Visita iniciada · ubicación registrada' : 'Visita iniciada sin GPS'); location.hash = '#/visita/' + v.id; }
    catch (err) { toast(err.message, true); busy($('#startBtn'), false); }
  };
}

// ---------- Diálogos ----------
function dialog(html, onSubmit) {
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog">${html}<div class="row end" style="margin-top:18px"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary">Guardar</button></div></form>`;
  document.body.appendChild(d);
  d.showModal();
  $('[data-x]', d).onclick = () => d.close();
  d.onclose = () => d.remove();
  $('form', d).onsubmit = async (e) => {
    e.preventDefault();
    try { await onSubmit(formData(e.target), d); d.close(); } catch (err) { toast(err.message, true); }
  };
  return d;
}
function clientDialog(c, done) {
  c = c || {};
  const d = dialog(`<h2>${c.id ? 'Editar' : 'Nueva'} empresa</h2>
    <div class="field"><label>Nombre / razón social</label><input name="name" required value="${esc(c.name)}"></div>
    <div class="fields" style="margin-top:12px"><div><label>RUT</label><input name="rut" value="${esc(c.rut)}"></div><div><label>Contacto</label><input name="contact_name" value="${esc(c.contact_name)}"></div></div>
    <div class="field"><label>Dirección</label>
      <div class="addr"><input name="address" value="${esc(c.address)}" autocomplete="off" placeholder="Escribe calle, número y comuna (ej: Av. Providencia 1980, Providencia)" role="combobox" aria-autocomplete="list" aria-expanded="false">
        <ul class="addr-sug" role="listbox" hidden></ul></div>
      <div class="addr-st" data-addrst></div></div>
    <div class="fields" style="margin-top:12px"><div><label>Correo contacto</label><input name="contact_email" type="email" value="${esc(c.contact_email)}"></div><div><label>Teléfono</label><input name="contact_phone" value="${esc(c.contact_phone)}"></div></div>
    <div class="field"><label>Ubicación en el mapa</label>
      <div class="mp"><div class="mp-map" data-map></div><div class="mp-pin" aria-hidden="true"></div></div>
      <div class="mp-foot"><span class="faint" data-coord></span><button type="button" class="btn" data-me>📍 Usar mi ubicación</button></div>
      <input type="hidden" name="lat" value="${esc(c.lat)}"><input type="hidden" name="lng" value="${esc(c.lng)}">
    </div>
    <p class="faint">Elige una de las direcciones sugeridas. Si no aparece, <b>toca el mapa</b> (o muévelo) para dejar el pin sobre la empresa. Si no la marcas, se usará el GPS de la primera visita.</p>`,
  async (b) => {
    const r = c.id ? await api('/clients/' + c.id, { method: 'PUT', body: b }) : await api('/clients', { method: 'POST', body: b });
    toast('Empresa guardada'); done && done(c.id || r.id);
  });
  mapPicker(d);
}

// ---------- Mapa para marcar ubicación (estilo "app de transporte": el pin queda al centro y se mueve el mapa) ----------
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return (loadLeaflet.p ||= new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/vendor/leaflet/leaflet.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = '/vendor/leaflet/leaflet.js'; s.onload = res;
    s.onerror = () => { loadLeaflet.p = null; rej(new Error('No se pudo cargar el mapa')); };
    document.head.appendChild(s);
  }));
}
async function mapPicker(root) {
  const latI = $('[name=lat]', root), lngI = $('[name=lng]', root), addrI = $('[name=address]', root), lab = $('[data-coord]', root);
  if (!latI || !$('[data-map]', root)) return;
  const mp = root.querySelector('.mp'), sug = $('.addr-sug', root), st = $('[data-addrst]', root);
  const show = (t) => (lab.textContent = t);
  // Estado de la dirección: verificada | aproximada | marcada en el mapa | no encontrada
  const status = (kind, html) => { st.className = 'addr-st' + (kind ? ' st-' + kind : ''); st.innerHTML = html || ''; };
  let map = null;
  const has = latI.value !== '' && lngI.value !== '';
  if (has) { mp.classList.add('set'); status('ok', '✓ Ubicación guardada'); }

  // ----- Marcar ubicación (desde una sugerencia, tocando el mapa o con el GPS) -----
  let t;
  const set = (ll, label, from) => {
    latI.value = (+ll.lat).toFixed(6); lngI.value = (+ll.lng).toFixed(6);
    mp.classList.add('set'); mp.classList.remove('need');
    if (label) { show('📍 ' + label); return; }
    show('📍 Ubicación marcada · buscando dirección…');
    clearTimeout(t);
    t = setTimeout(async () => {
      try {
        const r = await api(`/geo/reverse?lat=${latI.value}&lng=${lngI.value}`);
        show('📍 ' + (r.address || 'Ubicación marcada'));
        if (!r.address) return status('pin', '📍 Ubicación marcada en el mapa');
        if (!addrI.value.trim()) { addrI.value = r.address; status('pin', `📍 Marcada en el mapa · dirección sugerida: <b>${esc(r.address)}</b>`); }
        else if (addrI.value.trim().toLowerCase() !== r.address.toLowerCase())
          status('pin', `📍 Marcada en el mapa. Dirección en ese punto: <b>${esc(r.address)}</b> <button type="button" class="btn sm" data-use>Usar esta</button>`);
        else status('pin', '📍 Marcada en el mapa');
        const u = $('[data-use]', st); if (u) u.onclick = () => { addrI.value = r.address; status('pin', `📍 Marcada en el mapa · ${esc(r.address)}`); };
      } catch { show('📍 Ubicación marcada'); status('pin', '📍 Ubicación marcada en el mapa'); }
    }, from === 'gps' ? 0 : 500);
  };

  // ----- Normalizador: sugerencias mientras se escribe -----
  let items = [], active = -1, seq = 0, timer;
  const close = () => { sug.hidden = true; addrI.setAttribute('aria-expanded', 'false'); active = -1; };
  const choose = (x) => {
    addrI.value = x.label; close();
    status(x.exact ? 'ok' : 'warn', x.exact ? `✓ Dirección verificada${x.region ? ' · ' + esc(x.region) : ''}`
      : '⚠ Encontramos la calle pero no el número exacto. <b>Toca el mapa</b> para dejar el pin en el lugar correcto.');
    if (map) map.setView([x.lat, x.lng], x.exact ? 18 : 17);
    set({ lat: x.lat, lng: x.lng }, x.label);
    if (!x.exact) mp.classList.add('need');
  };
  const render = (q) => {
    if (!items.length) {
      sug.innerHTML = `<li class="none">No encontramos «${esc(q)}».<br><b>Toca el mapa</b> para marcar el lugar, o prueba con calle, número y comuna.</li>`;
      status('bad', '✗ Dirección no encontrada: marca la ubicación tocando el mapa.'); mp.classList.add('need');
    } else sug.innerHTML = items.map((x, i) => `<li role="option" data-i="${i}" class="${i === active ? 'on' : ''}">
        <span class="ic">${x.exact ? '📍' : '〰'}</span><span><b>${esc(x.place ? x.place + ' — ' : '')}${esc(x.label)}</b>
        <small>${esc(x.region || '')}${x.exact ? '' : ' · número aproximado'}</small></span></li>`).join('');
    sug.hidden = false; addrI.setAttribute('aria-expanded', 'true');
    $$('li[data-i]', sug).forEach((li) => li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(items[+li.dataset.i]); }));
  };
  const lookup = async () => {
    const q = addrI.value.trim();
    if (q.length < 4) return close();
    const my = ++seq;
    sug.innerHTML = '<li class="none">Buscando direcciones…</li>'; sug.hidden = false;
    try {
      const near = map ? map.getCenter() : null;
      const r = await api('/geo/suggest?q=' + encodeURIComponent(q) + (near && has ? `&lat=${near.lat.toFixed(4)}&lng=${near.lng.toFixed(4)}` : ''));
      if (my !== seq) return; // llegó una respuesta vieja
      items = r; active = -1; render(q);
    } catch { if (my === seq) { sug.innerHTML = '<li class="none">No se pudo consultar el buscador. Marca la ubicación en el mapa.</li>'; } }
  };
  addrI.addEventListener('input', () => {
    status('', addrI.value.trim() ? '<span class="faint">Elige una dirección de la lista para verificarla.</span>' : '');
    clearTimeout(timer); timer = setTimeout(lookup, 400);
  });
  addrI.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (!sug.hidden && items[active >= 0 ? active : 0]) choose(items[active >= 0 ? active : 0]); else lookup(); return; }
    if (sug.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; render(addrI.value.trim()); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  addrI.addEventListener('blur', () => setTimeout(close, 150));

  // ----- Mapa -----
  try { await loadLeaflet(); } catch (e) { show('No se pudo cargar el mapa. Revisa tu conexión.'); return; }
  const start = has ? [+latI.value, +lngI.value] : [-33.4489, -70.6693]; // Santiago por defecto
  map = L.map($('[data-map]', root), { zoomControl: true }).setView(start, has ? 17 : 11);
  osmTiles(map);
  setTimeout(() => map.invalidateSize(), 200);
  show(has ? '📍 Ubicación guardada. Toca o mueve el mapa para cambiarla.' : 'Sin marcar: elige una dirección sugerida o toca el mapa.');
  map.on('dragend', () => { close(); set(map.getCenter()); });
  map.on('click', (e) => { close(); map.setView(e.latlng, Math.max(map.getZoom(), 17)); set(e.latlng); });
  $('[data-me]', root).onclick = async () => {
    show('Obteniendo tu ubicación…');
    const p = await getPos(true);
    if (p.error) return show('No se pudo obtener tu ubicación: ' + p.error);
    map.setView([p.lat, p.lng], 17);
    set(L.latLng(p.lat, p.lng), null, 'gps');
  };
}

function equipmentDialog(clientId, e, done) {
  e = e || {};
  dialog(`<h2>${e.id ? 'Editar' : 'Nuevo'} equipo</h2>
    <div class="fields"><div><label>Nombre</label><input name="name" required value="${esc(e.name)}" placeholder="Cámara N°1"></div>
      <div><label>Tipo</label><select name="kind">${Object.entries(S.cat.equipmentKinds).map(([k, l]) => `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>
    <div class="fields" style="margin-top:12px"><div><label>Marca</label><input name="brand" value="${esc(e.brand)}"></div><div><label>Modelo</label><input name="model" value="${esc(e.model)}"></div><div><label>N° serie</label><input name="serial" value="${esc(e.serial)}"></div></div>
    <div class="fields" style="margin-top:12px"><div><label>Refrigerante</label><select name="refrigerant"><option value="">—</option>${S.cat.refrigerants.map((r) => `<option ${e.refrigerant === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div><label>Carga total (kg)</label><input name="charge_kg" inputmode="decimal" value="${esc(e.charge_kg)}"></div></div>
    <div class="fields" style="margin-top:12px"><div><label>Setpoint (°C)</label><input name="setpoint_c" inputmode="decimal" value="${esc(e.setpoint_c)}"></div><div><label>Tolerancia ± (K)</label><input name="tolerance_c" inputmode="decimal" value="${esc(e.tolerance_c ?? 2)}"></div></div>
    <div class="fields" style="margin-top:12px"><div><label>HR mínima (%)</label><input name="rh_min" inputmode="decimal" value="${esc(e.rh_min)}"></div><div><label>HR máxima (%)</label><input name="rh_max" inputmode="decimal" value="${esc(e.rh_max)}"></div></div>`,
  async (b) => {
    b.client_id = clientId;
    const r = e.id ? await api('/equipment/' + e.id, { method: 'PUT', body: b }) : await api('/equipment', { method: 'POST', body: b });
    toast('Equipo guardado'); done && done(e.id || r.id);
  });
}

// ---------- Visita (en curso o finalizada) ----------
async function viewVisit(id) {
  const v = await api('/visits/' + id);
  renderVisit(v);
}
function renderVisit(v) {
  const live = v.status === 'en_curso';
  const edit = live || isStaff();
  const T = S.cat.visitTypes[v.type];
  const w = v.weather_start;
  const labels = {
    reparacion: ['Falla reportada', 'Diagnóstico', 'Trabajo realizado'],
    mantencion: ['Alcance de la mantención', 'Hallazgos', 'Trabajo realizado'],
    rutinaria: ['Motivo de la visita', 'Observaciones', 'Acciones'],
    implementacion: ['Proyecto / alcance', 'Detalle de la instalación', 'Trabajo realizado'],
  }[v.type];
  const parts = v.parts_used || [];
  layout(`
    <div class="vhead"><span class="stripe" style="background:var(--t-${v.type})"></span>
      <div class="row" style="justify-content:space-between"><span class="folio">${esc(v.folio)} · ${esc(T.label.toUpperCase())}${v.request_code ? ` · <span title="Solicitud asignada">${esc(v.request_code)}</span>` : ''}</span>${live ? '<span class="chip live"><i></i>En curso</span>' : statusChip(v)}</div>
      <h1>${esc(v.client_name)}</h1>
      <div class="sub">${v.equipment ? esc(v.equipment.name) + (v.equipment.setpoint_c != null ? ` · setpoint ${v.equipment.setpoint_c} °C` : '') + ' · ' : ''}${esc(v.tech_name)}</div>
      <div class="timer" id="timer">—</div>
      <div class="sub" style="margin-top:4px">Inicio ${fmtDT(v.started_at)}${v.ended_at ? ' · Término ' + fmtDT(v.ended_at) : ''}</div>
      ${live ? '<button class="btn" id="goFinish" style="margin-top:14px;background:#fff;color:var(--brand);border:0">■ Terminar visita</button>' : ''}
      ${w ? `<div class="wx"><span>Exterior <b>${w.temp_c}</b> °C</span><span>HR <b>${w.rh}</b>%</span><span>Rocío <b>${w.dew_point_c}</b> °C</span><span>${esc(w.condition)}</span><span style="opacity:.7">${esc(w.source)}</span></div>` : ''}
    </div>

    ${attendanceCard(v)}

    ${!live ? `<div class="row" style="margin-top:14px">
      <a class="btn primary" href="/api/visits/${v.id}/pdf" target="_blank">📄 Ver informe PDF</a>
      <a class="btn" href="/api/visits/${v.id}/pdf?download=1">⬇ Descargar</a>
      ${v.report_token ? `<button class="btn" id="share">🔗 Compartir con cliente</button>` : ''}
      ${isStaff() ? `<button class="btn" id="reopen">Reabrir</button>` : ''}</div>` : ''}

    <div class="card" style="margin-top:14px"><h2>Indicadores en vivo</h2>
      ${v.alerts.map((a) => `<div class="alert">⚠ ${esc(a)}</div>`).join('')}
      <div class="kpis" style="margin-top:${v.alerts.length ? 12 : 0}px">${v.kpis.filter((k) => k.key !== 'duracion').map((k) => `
        <div class="kpi"><div class="l"><span>${esc(k.label)}</span>${k.status ? `<span class="chip ${kpiStatus[k.status][0]}">${kpiStatus[k.status][1]}</span>` : ''}</div>
        <div class="val">${k.value ?? '—'} <small>${esc(k.unit)}</small></div>
        <div class="ref">${k.ideal ? 'Ref. ' + esc(k.ideal) : ''}${k.note ? (k.ideal ? ' · ' : '') + esc(k.note) : ''}</div></div>`).join('') || '<div class="faint">Registra mediciones para calcular recalentamiento, subenfriamiento, ΔT, cumplimiento de setpoint y más.</div>'}</div>
    </div>

    <div class="grid g2" style="margin-top:14px;align-items:start">
      <div class="card"><h2>Mediciones</h2>
        ${edit ? `<p class="faint" style="margin:-6px 0 10px">Lee cada instrumento (termómetro, higrómetro, manómetro, pinza amperimétrica, anemómetro) y escribe el valor. Deja en blanco lo que no midas.</p>
        <div class="seg" id="phaseSeg"><button type="button" data-ph="inicial" class="on">Al llegar (inicial)</button><button type="button" data-ph="final">Al terminar (final)</button></div>
        <form id="mq">${quickMeasFields()}
          <button class="btn dark big" style="margin-top:14px">Guardar mediciones</button></form>
        <details style="margin-top:12px"><summary class="faint" style="cursor:pointer">Agregar una medición en un punto específico (ej. puerta, fondo de cámara)</summary>
        <form id="mf" class="fields" style="grid-template-columns:1fr 1fr;margin-top:10px">
          <div style="grid-column:1/-1"><label>Variable</label><select name="kind">${groupedMeasOptions()}</select></div>
          <div><label>Valor</label><input name="value" inputmode="decimal" required placeholder="0.0" class="num"></div>
          <div><label>Momento</label><select name="phase"><option value="inicial">Inicial (al llegar)</option><option value="final">Final (al terminar)</option></select></div>
          <div style="grid-column:1/-1"><label>Punto de medición</label><input name="point" placeholder="Ej: puerta, fondo, pasillo 3"></div>
          <button class="btn" style="grid-column:1/-1">＋ Agregar medición</button></form></details>` : ''}
        <h3 style="margin-top:18px">Registradas</h3>
        <div id="mlist">${measList(v, edit)}</div>
      </div>

      <div class="card"><h2>Fotografías <span class="faint">(${v.photos.length})</span></h2>
        <div class="guide">${(S.cat.photoGuide[v.type] || []).map((g) => `<span class="chip">${esc(g)}</span>`).join('')}</div>
        ${edit ? `<form id="pf" class="fields" style="grid-template-columns:1fr 1fr;margin-bottom:12px">
          <div><label>Etapa</label><select name="stage"><option value="antes">Antes</option><option value="durante" selected>Durante</option><option value="despues">Después</option></select></div>
          <div><label>Descripción</label><input name="caption" placeholder="Ej: condensador sucio"></div>
          <label class="btn dark" style="grid-column:1/-1;margin:0;color:#fff">📷 Tomar / subir fotos<input type="file" name="photos" accept="image/*" capture="environment" multiple hidden></label>
          <label class="btn" style="grid-column:1/-1;margin:0">🖼 Elegir de la galería<input type="file" name="gallery" accept="image/*" multiple hidden></label></form>` : ''}
        <div class="photos">${v.photos.map((p) => `<div class="photo"><a href="/api/photos/${p.id}/file" target="_blank"><img loading="lazy" src="/api/photos/${p.id}/file" alt=""></a>
          <div class="cap"><b>${esc({ antes: 'ANTES', durante: 'DURANTE', despues: 'DESPUÉS' }[p.stage])}</b>${esc(p.caption || '')}</div>${edit ? `<button data-delp="${p.id}" title="Eliminar">✕</button>` : ''}</div>`).join('') || '<div class="faint">Sin fotos aún.</div>'}</div>
      </div>
    </div>

    <form id="df" class="card" style="margin-top:14px"><h2>Detalle técnico</h2>
      <div class="field"><label>${labels[0]}</label><textarea name="reason" ${edit ? '' : 'readonly'}>${esc(v.reason)}</textarea></div>
      <div class="field"><label>${labels[1]}</label><textarea name="diagnosis" ${edit ? '' : 'readonly'}>${esc(v.diagnosis)}</textarea></div>
      <div class="field"><label>${labels[2]}</label><textarea name="actions" ${edit ? '' : 'readonly'}>${esc(v.actions)}</textarea></div>
      <div class="field"><label>Recomendaciones al cliente</label><textarea name="recommendations" ${edit ? '' : 'readonly'}>${esc(v.recommendations)}</textarea></div>
      <div class="fields" style="margin-top:12px">
        <div><label>Refrigerante recargado (kg)</label><input name="refrigerant_added_kg" inputmode="decimal" value="${esc(v.refrigerant_added_kg)}" ${edit ? '' : 'readonly'}></div>
        ${v.type === 'reparacion' ? `<div><label>Horas de equipo detenido</label><input name="downtime_hours" inputmode="decimal" value="${esc(v.downtime_hours)}" ${edit ? '' : 'readonly'}></div>` : ''}
        <div><label>Próxima visita recomendada</label><input type="date" name="next_visit_date" value="${esc(v.next_visit_date)}" ${edit ? '' : 'readonly'}></div>
      </div>
      <div class="field" style="margin-top:14px"><label>Repuestos y materiales</label>
        <div id="parts">${parts.map((p, i) => partRow(p, i, edit)).join('')}</div>
        ${edit ? '<button type="button" class="btn sm" id="addPart" style="margin-top:6px">＋ Agregar repuesto</button>' : ''}</div>
      ${edit ? '<div class="row end" style="margin-top:14px"><button class="btn dark">Guardar detalle</button></div>' : ''}
    </form>

    <div class="card"><h2>${v.type === 'implementacion' ? 'Protocolo de puesta en marcha' : 'Checklist'} <span class="faint" id="clc"></span></h2>
      <div id="cl">${(v.checklist || []).map((c, i) => `<div class="check"><input type="checkbox" data-i="${i}" ${c.ok ? 'checked' : ''} ${edit ? '' : 'disabled'}>
        <div class="main">${esc(c.item)}${edit || c.note ? `<input data-n="${i}" value="${esc(c.note)}" placeholder="Observación" ${edit ? '' : 'readonly'}>` : ''}</div></div>`).join('')}</div>
      ${edit ? '<div class="row" style="margin-top:10px"><input id="newItem" placeholder="Agregar ítem al checklist" style="flex:1"><button class="btn sm" id="addItem">＋</button></div>' : ''}
    </div>

    ${live ? `<form id="ff" class="card"><h2>Finalizar visita</h2>
      <div class="field"><label>Resultado</label><select name="result" required><option value="">Selecciona…</option>${Object.entries(S.cat.results).map(([k, l]) => `<option value="${k}" ${v.result === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>Nombre de quien recibe (cliente)</label><input name="client_signer" value="${esc(v.client_signer)}" placeholder="Nombre y cargo"></div>
      <div class="field"><label>Firma del cliente</label><canvas class="sig" id="sig"></canvas><button type="button" class="btn sm" id="sigClear" style="margin-top:6px">Borrar firma</button></div>
      <div class="field"><label>Satisfacción del cliente</label><div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-s="${n}">★</button>`).join('')}</div></div>
      <div style="margin-top:18px"><button class="btn primary big" id="finBtn">■ Terminar visita</button></div>
    </form>` : v.client_signature ? `<div class="card"><h2>Conformidad del cliente</h2><div class="row"><img src="${v.client_signature}" alt="Firma" style="max-height:90px;background:#fff;border-radius:8px;padding:6px"><div><b>${esc(v.client_signer || '')}</b><div class="faint">${v.client_rating ? '★'.repeat(v.client_rating) + '☆'.repeat(5 - v.client_rating) : ''}</div></div></div></div>` : ''}
  `);

  // Cronómetro
  clearInterval(S.timer);
  const tick = () => {
    if (!$('#timer')) return clearInterval(S.timer);
    const end = v.ended_at ? new Date(v.ended_at) : new Date();
    const s = Math.max(0, Math.floor((end - new Date(v.started_at)) / 1000));
    $('#timer').textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  tick(); if (live) S.timer = setInterval(tick, 1000);

  const refresh = (nv) => { const y = window.scrollY; renderVisit(nv); window.scrollTo(0, y); };

  if (live) $('#goFinish').onclick = () => $('#ff').scrollIntoView({ behavior: 'smooth' });
  if (!live) {
    $('#share') && ($('#share').onclick = async () => {
      const url = `${location.origin}/r/${v.report_token}`;
      if (navigator.share) navigator.share({ title: `Informe ${v.folio}`, url }).catch(() => {});
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
    });
    $('#reopen') && ($('#reopen').onclick = async () => refresh(await api(`/visits/${v.id}/reopen`, { method: 'POST' })));
  }
  if (!edit) return;

  // Planilla rápida de mediciones
  let phase = S.lastPhase || 'inicial';
  const setPhase = (ph) => { phase = S.lastPhase = ph; $$('#phaseSeg button').forEach((b) => b.classList.toggle('on', b.dataset.ph === ph)); };
  setPhase(phase);
  $$('#phaseSeg button').forEach((b) => (b.onclick = () => setPhase(b.dataset.ph)));
  $('#mq').onsubmit = async (e) => {
    e.preventDefault();
    const list = Object.entries(formData(e.target)).filter(([, x]) => x.trim() !== '').map(([kind, x]) => ({ kind, value: x.replace(',', '.'), phase }));
    if (!list.length) return toast('Escribe al menos un valor', true);
    if (list.some((m) => isNaN(+m.value))) return toast('Hay un valor que no es número', true);
    try { const nv = await api(`/visits/${v.id}/measurements`, { method: 'POST', body: list }); toast(`${list.length} medición(es) guardadas (${phase})`); refresh(nv); }
    catch (err) { toast(err.message, true); }
  };
  // Medición individual con punto
  $('#mf').onsubmit = async (e) => {
    e.preventDefault();
    const b = formData(e.target); b.value = b.value.replace(',', '.');
    try { const nv = await api(`/visits/${v.id}/measurements`, { method: 'POST', body: b }); toast('Medición registrada'); refresh(nv); $('#mf [name=kind]').value = b.kind; $('#mf [name=phase]').value = b.phase; }
    catch (err) { toast(err.message, true); }
  };
  $$('[data-delm]').forEach((x) => (x.onclick = async () => refresh(await api('/measurements/' + x.dataset.delm, { method: 'DELETE' }))));

  // Fotos
  $$('#pf input[type=file]').forEach((inp) => (inp.onchange = async () => {
    if (!inp.files.length) return;
    const fd = new FormData();
    [...inp.files].forEach((f) => fd.append('photos', f));
    fd.append('stage', $('#pf [name=stage]').value); fd.append('caption', $('#pf [name=caption]').value);
    toast(`Subiendo ${inp.files.length} foto(s)…`);
    try { refresh(await api(`/visits/${v.id}/photos`, { method: 'POST', body: fd })); toast('Fotos guardadas'); } catch (err) { toast(err.message, true); }
  }));
  $$('[data-delp]').forEach((x) => (x.onclick = async () => { if (confirm('¿Eliminar esta foto?')) refresh(await api('/photos/' + x.dataset.delp, { method: 'DELETE' })); }));

  // Detalle + repuestos
  const collectParts = () => $$('#parts .prow').map((r) => ({ name: $('[data-pn]', r).value.trim(), qty: $('[data-pq]', r).value })).filter((p) => p.name);
  $('#addPart').onclick = () => { $('#parts').insertAdjacentHTML('beforeend', partRow({ name: '', qty: 1 }, Date.now(), true)); bindPartDel(); };
  const bindPartDel = () => $$('[data-delpart]').forEach((x) => (x.onclick = () => x.closest('.prow').remove()));
  bindPartDel();
  const saveDetail = async (silent) => {
    const b = formData($('#df')); b.parts_used = collectParts();
    const nv = await api('/visits/' + v.id, { method: 'PUT', body: b });
    if (!silent) { toast('Detalle guardado'); refresh(nv); }
    return nv;
  };
  $('#df').onsubmit = async (e) => { e.preventDefault(); try { await saveDetail(); } catch (err) { toast(err.message, true); } };

  // Checklist (se guarda solo)
  const cl = v.checklist || [];
  const count = () => ($('#clc').textContent = `${cl.filter((c) => c.ok).length}/${cl.length}`);
  count();
  const saveCl = async () => { try { await api('/visits/' + v.id, { method: 'PUT', body: { checklist: cl } }); } catch (e) { toast(e.message, true); } };
  $$('#cl [data-i]').forEach((c) => (c.onchange = () => { cl[c.dataset.i].ok = c.checked; count(); saveCl(); }));
  $$('#cl [data-n]').forEach((c) => (c.onchange = () => { cl[c.dataset.n].note = c.value; saveCl(); }));
  $('#addItem').onclick = async () => { const t = $('#newItem').value.trim(); if (!t) return; cl.push({ item: t, ok: false, note: '' }); await saveDetail(true).catch(() => {}); await saveCl(); refresh(await api('/visits/' + v.id)); };

  if (!live) return;
  // Firma
  const cv = $('#sig'), ctx = cv.getContext('2d');
  const sizeCv = () => { const r = cv.getBoundingClientRect(); cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0b2540'; };
  sizeCv();
  let drawing = false, signed = false;
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.onpointerdown = (e) => { drawing = true; signed = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pt(e)); };
  cv.onpointermove = (e) => { if (!drawing) return; ctx.lineTo(...pt(e)); ctx.stroke(); };
  cv.onpointerup = () => (drawing = false);
  $('#sigClear').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); signed = false; };
  let rating = v.client_rating || 0;
  const paint = () => $$('#stars button').forEach((b) => b.classList.toggle('on', +b.dataset.s <= rating));
  paint();
  $$('#stars button').forEach((b) => (b.onclick = () => { rating = +b.dataset.s; paint(); }));

  $('#ff').onsubmit = async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    if (!v.photos.length && !confirm('La visita no tiene fotos. ¿Terminar de todas formas?')) return;
    busy($('#finBtn'), true, 'Generando informe…');
    try {
      await saveDetail(true);
      const loc = await stampLocation('terminar la visita');
      if (!loc) return busy($('#finBtn'), false);
      const nv = await api(`/visits/${v.id}/finish`, { method: 'POST', body: { ...b, ...loc, client_rating: rating || null, client_signature: signed ? cv.toDataURL('image/png') : null } });
      toast(loc.lat != null ? 'Visita terminada · ubicación registrada. Informe listo.' : 'Visita terminada sin GPS. Informe listo.');
      refresh(nv);
      window.scrollTo(0, 0);
    } catch (err) { toast(err.message, true); busy($('#finBtn'), false); }
  };
}
function attendanceCard(v) {
  const a = v.attendance;
  const VER = { verificada: ['ok', '✓ Presencia verificada'], fuera_rango: ['bad', '✕ Fuera de la empresa'], sin_gps: ['warn', '! Registro sin GPS'], sin_referencia: ['warn', '! Sin ubicación de referencia'], pendiente: ['live', 'Falta registrar término'] }[a.verified];
  const row = (label, e) => `<div class="att">
    <div class="att-l">${label}</div>
    ${e ? `<div class="att-m"><b>${new Date(e.at).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</b>
      ${e.lat != null ? `<div class="faint">${esc(e.address || `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`)} · <a href="${mapLink(e)}" target="_blank" rel="noopener">ver en mapa ↗</a></div>` : `<div class="faint" style="color:var(--warn)">Sin ubicación: ${esc(e.no_gps_reason || 'no disponible')}</div>`}</div>
      ${e.lat != null ? `<div class="att-d"><span class="chip ${e.inside === false ? 'bad' : e.inside ? 'ok' : ''}">${fmtDist(e.distance_m)}</span><div class="faint">${e.accuracy ? 'GPS ±' + Math.round(e.accuracy) + ' m' : ''}</div></div>` : ''}`
    : '<div class="att-m faint">Se registra al presionar Terminar visita</div>'}</div>`;
  return `<div class="card" style="margin-top:14px"><h2>Registro de asistencia <span class="chip ${VER[0]}" style="margin-left:auto">${VER[1]}</span></h2>
    ${row('Inicio', a.start)}${row('Término', a.end)}
    <p class="faint" style="margin:8px 0 0">Distancia medida desde la ubicación registrada de la empresa (radio aceptado ${a.geofence_m} m).${a.manual ? ' <b>Registro ingresado manualmente por un administrador.</b>' : ''}</p></div>`;
}
function partRow(p, i, edit) {
  return `<div class="row prow" style="flex-wrap:nowrap;margin-bottom:6px"><input data-pn value="${esc(p.name)}" placeholder="Descripción" ${edit ? '' : 'readonly'}>
    <input data-pq value="${esc(p.qty)}" style="width:80px" inputmode="decimal" ${edit ? '' : 'readonly'}>${edit ? '<button type="button" class="btn sm" data-delpart>✕</button>' : ''}</div>`;
}
function quickMeasFields() {
  const g = {};
  Object.entries(S.cat.measurements).forEach(([k, m]) => (g[m.group] ||= []).push(`<div class="qm"><label for="q_${k}">${esc(m.label)}</label>
    <div class="unit"><input id="q_${k}" name="${k}" inputmode="decimal" autocomplete="off" class="num"><span>${esc(m.unit)}</span></div></div>`));
  return Object.entries(g).map(([n, f]) => `<div class="meas-group">${esc(n)}</div><div class="qgrid">${f.join('')}</div>`).join('');
}
function groupedMeasOptions() {
  const g = {};
  Object.entries(S.cat.measurements).forEach(([k, m]) => (g[m.group] ||= []).push(`<option value="${k}">${esc(m.label)} (${m.unit})</option>`));
  return Object.entries(g).map(([n, o]) => `<optgroup label="${esc(n)}">${o.join('')}</optgroup>`).join('');
}
function measList(v, edit) {
  if (!v.measurements.length) return '<div class="faint" style="margin-top:12px">Sin mediciones aún.</div>';
  const g = {};
  v.measurements.forEach((m) => { const d = S.cat.measurements[m.kind]; (g[d?.group || 'Otras'] ||= []).push({ ...m, label: d?.label || m.kind }); });
  return Object.entries(g).map(([n, ms]) => `<div class="meas-group">${esc(n)}</div>
    <table class="t"><tbody>${ms.map((m) => `<tr><td>${esc(m.label)}${m.point ? `<div class="faint">${esc(m.point)}</div>` : ''}</td>
      <td><span class="chip">${m.phase === 'final' ? 'Final' : 'Inicial'}</span></td><td class="r num"><b>${m.value}</b> ${esc(m.unit)}</td>
      ${edit ? `<td class="r" style="width:40px"><button class="btn sm" data-delm="${m.id}" title="Eliminar">✕</button></td>` : ''}</tr>`).join('')}</tbody></table>`).join('');
}

// ---------- Listado de visitas ----------
async function viewVisits(techId) {
  const users = isStaff() ? await api('/users') : [];
  const clients = await api('/clients');
  layout(`
    <div class="head"><div><h1>Visitas</h1><p>Historial completo con filtros.</p></div>${isStaff() ? '<a class="btn" href="/api/export/visits.csv">⬇ Exportar Excel (CSV)</a>' : ''}</div>
    <div class="card">
      <form class="filters" id="vf">
        <div><label>Buscar</label><input name="q" placeholder="Folio o empresa"></div>
        <div><label>Estado</label><select name="status"><option value="">Todos</option><option value="en_curso">En curso</option><option value="finalizada">Finalizadas</option><option value="anulada">Anuladas</option></select></div>
        <div><label>Tipo</label><select name="type"><option value="">Todos</option>${Object.entries(S.cat.visitTypes).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select></div>
        <div><label>Empresa</label><select name="client_id"><option value="">Todas</option>${clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        ${isStaff() ? `<div><label>Técnico</label><select name="technician_id"><option value="">Todos</option>${users.filter((u) => u.role === 'tecnico').map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>` : ''}
        <div><label>Desde</label><input type="date" name="from"></div><div><label>Hasta</label><input type="date" name="to"></div>
      </form>
      <div id="vl"></div>
    </div>`);
  const load = async () => {
    const q = new URLSearchParams(Object.entries(formData($('#vf'))).filter(([, x]) => x)).toString();
    const rows = await api('/visits?limit=300&' + q);
    $('#vl').innerHTML = rows.length ? `<div class="scroll"><table class="t"><thead><tr><th>Folio</th><th>Empresa</th><th>Tipo</th>${isStaff() ? '<th>Técnico</th>' : ''}<th>Inicio</th><th class="r">Duración</th><th>Estado</th></tr></thead><tbody>
      ${rows.map((v) => `<tr data-href="#/visita/${v.id}"><td class="num">${esc(v.folio)}</td><td><b>${esc(v.client_name)}</b>${v.equipment_name ? `<div class="faint">${esc(v.equipment_name)}</div>` : ''}</td><td>${typeChip(v.type)}</td>
      ${isStaff() ? `<td>${esc(v.tech_name)}</td>` : ''}<td>${fmtDT(v.started_at)}</td><td class="r num">${v.ended_at ? fmtMin((new Date(v.ended_at) - new Date(v.started_at)) / 60000) : '—'}</td><td>${statusChip(v)}</td></tr>`).join('')}
      </tbody></table></div><p class="faint">${rows.length} visitas</p>` : '<div class="empty">No hay visitas con esos filtros.</div>';
    $$('#vl tr[data-href]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
  };
  $('#vf').oninput = () => { clearTimeout(load.t); load.t = setTimeout(load, 250); };
  if (techId && $('#vf').technician_id) $('#vf').technician_id.value = String(techId);
  load();
}

// ---------- Dashboards ----------
async function viewDashboard(opts) {
  const users = isStaff() ? await api('/users') : [];
  const clients = await api('/clients');
  const tech = opts.technician_id ? users.find((u) => u.id === opts.technician_id) || (opts.mine ? S.me : null) : null;
  const d0 = new Date(); d0.setMonth(d0.getMonth() - 6);
  const title = tech ? (opts.mine ? 'Mis indicadores' : tech.name) : 'Dashboard de la empresa';
  layout(`
    <div class="head"><div>${tech && !opts.mine ? '<a href="#/equipo" class="faint">← Técnicos</a>' : ''}<h1>${esc(title)}</h1>
      <p>${tech ? `Desempeño individual: visitas, tiempos y calidad de servicio.${tech.supervisor_name && !opts.mine ? ' · Supervisor: ' + esc(tech.supervisor_name) : ''}${tech.phone && !opts.mine ? ' · ☎ ' + esc(tech.phone) : ''}` : 'Operación de todos los técnicos y clientes.'}</p></div>
      ${isStaff() ? '<a class="btn" href="/api/export/visits.csv">⬇ Exportar CSV</a>' : ''}</div>
    <form class="filters" id="df">
      <div><label>Desde</label><input type="date" name="from" value="${d0.toISOString().slice(0, 10)}"></div>
      <div><label>Hasta</label><input type="date" name="to" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div><label>Tipo de visita</label><select name="type"><option value="">Todos</option>${Object.entries(S.cat.visitTypes).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select></div>
      <div><label>Empresa</label><select name="client_id"><option value="">Todas</option>${clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      ${isStaff() && !tech ? `<div><label>Técnico</label><select name="technician_id"><option value="">Todos</option>${users.filter((u) => u.role === 'tecnico').map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>` : ''}
    </form>
    ${tech && !opts.mine && isStaff() ? `<div class="card" id="tvis" style="margin-bottom:14px"><h2>Visitas <span class="faint" id="tvisN" style="font-weight:500"></span>
        <span class="row" style="margin-left:auto;gap:6px">${[['', 'Todas'], ['en_curso', 'En curso'], ['finalizada', 'Finalizadas'], ['anulada', 'Anuladas']].map(([k, l]) => `<button type="button" class="btn sm${k === '' ? ' primary' : ''}" data-vst="${k}" aria-pressed="${k === ''}">${l}</button>`).join('')}
        <a class="btn sm" href="#/visitas/${tech.id}">Ver en Visitas</a></span></h2>
      <p class="faint" style="margin:-4px 0 8px">Incluye las visitas iniciadas sin solicitud. Usa los filtros de fecha, tipo y empresa de arriba.</p>
      <div id="tvisL" class="faint">Cargando…</div></div>` : ''}
    ${tech && !opts.mine && isStaff() ? `<div class="card" id="treq"><h2>Solicitudes asignadas <button class="btn sm primary" id="asg" style="margin-left:auto">＋ Asignar solicitud</button></h2><div id="treqL" class="faint">Cargando…</div></div>` : ''}
    <div id="dash"></div>`);
  if (tech && !opts.mine && isStaff()) {
    const loadReq = async () => {
      const rq = await api('/requests?technician_id=' + tech.id + '&limit=60');
      const openR = rq.filter((q) => ['asignada', 'en_curso'].includes(q.status)), closed = rq.filter((q) => !['asignada', 'en_curso'].includes(q.status)).slice(0, 8);
      $('#treqL').outerHTML = `<div id="treqL">${openR.length ? `<ul class="list">${openR.map((q) => reqItem(q, false)).join('')}</ul>` : '<div class="empty">Sin solicitudes abiertas.</div>'}
        ${closed.length ? `<details style="margin-top:8px"><summary class="faint">Últimas cerradas (${closed.length})</summary><ul class="list">${closed.map((q) => reqItem(q, false)).join('')}</ul></details>` : ''}</div>`;
      $$('#treqL li.req').forEach((li, i) => (li.onclick = () => requestDialog([...openR, ...closed][i], loadReq)));
    };
    $('#asg').onclick = () => requestDialog({ technician_id: tech.id }, loadReq);
    loadReq();
  }
  // Visitas del técnico (todas, no solo las que vienen de una solicitud)
  let vst = '';
  const loadVisits = async (f) => {
    if (!$('#tvisL')) return;
    const q = new URLSearchParams({ ...f, technician_id: tech.id, limit: 100, ...(vst ? { status: vst } : {}) });
    const rows = await api('/visits?' + q);
    $('#tvisN').textContent = `· ${rows.length}${rows.length === 100 ? '+' : ''}`;
    $('#tvisL').outerHTML = `<div id="tvisL">${rows.length ? `<div class="scroll"><table class="t"><thead><tr><th>Folio</th><th>Empresa</th><th>Tipo</th><th>Inicio</th><th class="r">Duración</th><th>Estado / resultado</th></tr></thead><tbody>
      ${rows.map((v) => `<tr data-href="#/visita/${v.id}"><td class="num">${esc(v.folio)}</td><td><b>${esc(v.client_name)}</b>${v.equipment_name ? `<div class="faint">${esc(v.equipment_name)}</div>` : ''}</td><td>${typeChip(v.type)}</td>
        <td>${fmtDT(v.started_at)}</td><td class="r num">${v.ended_at ? fmtMin((new Date(v.ended_at) - new Date(v.started_at)) / 60000) : '—'}</td><td>${statusChip(v)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Sin visitas con estos filtros.</div>'}</div>`;
    $$('#tvisL tr[data-href]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
  };
  $$('[data-vst]').forEach((b) => (b.onclick = () => {
    vst = b.dataset.vst;
    $$('[data-vst]').forEach((x) => { const on = x === b; x.classList.toggle('primary', on); x.setAttribute('aria-pressed', String(on)); });
    load();
  }));
  const load = async () => {
    const f = Object.fromEntries(Object.entries(formData($('#df'))).filter(([, x]) => x));
    if (opts.technician_id) f.technician_id = opts.technician_id;
    if (tech && !opts.mine && isStaff()) loadVisits(Object.fromEntries(Object.entries(f).filter(([k]) => ['from', 'to', 'type', 'client_id'].includes(k))));
    const d = await api('/dashboard?' + new URLSearchParams(f));
    renderDash(d, !!tech, f);
  };
  $('#df').onchange = load;
  load();
}

function tile(k, v, unit, hint) {
  return `<div class="tile"><div class="k">${k}</div><div class="v">${v ?? '—'}${v != null && unit ? `<small>${unit}</small>` : ''}</div>${hint ? `<div class="h">${hint}</div>` : ''}</div>`;
}
function renderDash(d, isTech, f) {
  S.charts.forEach((c) => c.destroy()); S.charts = [];
  const s = d.summary;
  const types = Object.keys(S.cat.visitTypes);
  $('#dash').innerHTML = `
    <div class="grid g4">
      ${tile('Visitas', s.total, '', `${s.finalizadas} finalizadas · ${s.en_curso} en curso`)}
      ${tile('Duración promedio', s.duracion_prom_min != null ? fmtMin(s.duracion_prom_min) : null, '', 'Por visita finalizada')}
      ${tile('MTTR', s.mttr_h, 'h', 'Tiempo medio de reparación')}
      ${tile('Resolución 1ª visita', s.ftfr_pct, '%', 'Reparaciones resueltas (FTFR)')}
      ${tile('Preventivo / total', s.preventivo_pct, '%', 'Mantenciones + rutinarias')}
      ${tile('Satisfacción cliente', s.satisfaccion, '/ 5', 'Promedio de evaluaciones')}
      ${tile('MTBF', s.mtbf_dias, 'días', 'Tiempo medio entre fallas por equipo')}
      ${tile('Refrigerante recargado', s.refrigerante_kg, 'kg', s.co2e_t != null ? `≈ ${s.co2e_t} t CO₂e emitidas` : '')}
    </div>

    <div class="grid g2" style="margin-top:14px">
      <div class="card"><h2>Visitas por mes</h2>
        <div class="legend">${types.map((t) => `<span><i style="background:var(--t-${t})"></i>${esc(S.cat.visitTypes[t].label)}</span>`).join('')}</div>
        <div class="chartbox"><canvas id="c1" aria-label="Visitas por mes según tipo"></canvas></div></div>
      <div class="card"><h2>Duración promedio por tipo</h2>
        <div class="chartbox"><canvas id="c2" aria-label="Duración promedio por tipo de visita"></canvas></div>
        <table class="t" style="margin-top:10px"><tbody>${types.filter((t) => d.byType[t]).map((t) => `<tr><td>${typeChip(t)}</td><td class="r num">${d.byType[t].count} visitas</td><td class="r num"><b>${fmtMin(d.byType[t].avg_min)}</b></td></tr>`).join('')}</tbody></table></div>
    </div>

    ${!isTech ? `<div class="card" style="margin-top:14px"><h2>Técnicos</h2><div class="scroll"><table class="t"><thead><tr><th>Técnico</th><th class="r">Visitas</th><th class="r">Duración prom.</th><th class="r">Horas en terreno</th><th class="r">FTFR</th><th class="r">Satisfacción</th></tr></thead><tbody>
      ${d.technicians.map((t) => `<tr data-href="#/tecnico/${t.id}"><td><b>${esc(t.name)}</b></td><td class="r num">${t.visitas}</td><td class="r num">${fmtMin(t.duracion_prom_min)}</td><td class="r num">${t.horas_totales ?? '—'}</td><td class="r num">${t.ftfr_pct != null ? t.ftfr_pct + '%' : '—'}</td><td class="r num">${t.satisfaccion ?? '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin datos</td></tr>'}
      </tbody></table></div></div>` : ''}

    <div class="grid g2" style="margin-top:14px;align-items:start">
      <div class="card"><h2>Clientes</h2><div class="scroll"><table class="t"><thead><tr><th>Empresa</th><th class="r">Visitas</th><th class="r">Reparaciones</th><th class="r">Refrig. kg</th></tr></thead><tbody>
        ${d.clients.map((c) => `<tr data-href="#/cliente/${c.id}"><td>${esc(c.name)}</td><td class="r num">${c.visitas}</td><td class="r num">${c.reparaciones}</td><td class="r num">${c.refrigerante_kg || '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin datos</td></tr>'}</tbody></table></div></div>
      <div class="card"><h2>Próximas mantenciones</h2>
        ${d.upcoming.length ? `<ul class="list">${d.upcoming.map((u) => `<li class="item"><div class="main"><b>${esc(u.client_name)}</b><div class="meta">${esc(u.equipment_name || 'General')} · desde ${esc(u.folio)}</div></div>
          <span class="chip ${u.vencida ? 'bad' : ''}">${u.vencida ? '✕ Vencida ' : ''}${fmtD(u.next_visit_date)}</span></li>`).join('')}</ul>` : '<div class="empty">No hay mantenciones programadas.</div>'}</div>
    </div>
    ${isTech ? `<div class="card" style="margin-top:14px"><h2>Visitas del período</h2><div id="tv"></div></div>` : ''}`;

  $$('#dash tr[data-href]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
  if (isTech) api('/visits?limit=50&' + new URLSearchParams(f)).then((rows) => ($('#tv').innerHTML = rows.length ? `<ul class="list">${rows.map(visitItem).join('')}</ul>` : '<div class="empty">Sin visitas</div>'));
  drawCharts(d, types);
}

function drawCharts(d, types) {
  if (!window.Chart) return setTimeout(() => drawCharts(d, types), 300);
  const ink2 = cssVar('--ink-2'), line = cssVar('--line'), surf = cssVar('--surface');
  Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
  Chart.defaults.color = ink2;
  const months = Object.keys(d.byMonth).sort();
  const mLabel = (m) => new Date(m + '-15').toLocaleDateString('es-CL', { month: 'short', year: '2-digit' });
  const tip = { backgroundColor: cssVar('--ink'), titleColor: surf, bodyColor: surf, padding: 10, cornerRadius: 8, boxPadding: 4 };
  S.charts.push(new Chart($('#c1'), {
    type: 'bar',
    data: { labels: months.map(mLabel), datasets: types.map((t) => ({ label: S.cat.visitTypes[t].label, data: months.map((m) => d.byMonth[m][t] || 0),
      backgroundColor: cssVar('--t-' + t), borderColor: surf, borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 34 })) },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: tip },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: line }, border: { display: false }, ticks: { precision: 0 } } } },
  }));
  const tk = types.filter((t) => d.byType[t]);
  S.charts.push(new Chart($('#c2'), {
    type: 'bar',
    data: { labels: tk.map((t) => S.cat.visitTypes[t].label), datasets: [{ label: 'Duración promedio (min)', data: tk.map((t) => d.byType[t].avg_min),
      backgroundColor: tk.map((t) => cssVar('--t-' + t)), borderRadius: 4, maxBarThickness: 28 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { ...tip, callbacks: { label: (c) => ' ' + fmtMin(c.raw) } } },
      scales: { x: { beginAtZero: true, grid: { color: line }, border: { display: false }, title: { display: true, text: 'minutos' } }, y: { grid: { display: false } } } },
  }));
}

// ---------- Clientes ----------
async function viewClients() {
  const cl = await api('/clients');
  layout(`
    <div class="head"><div><h1>Clientes</h1><p>Empresas atendidas y sus equipos de frío.</p></div><button class="btn primary" id="nc">＋ Nueva empresa</button></div>
    <div class="card"><div class="scroll"><table class="t"><thead><tr><th>Empresa</th><th>RUT</th><th>Dirección</th><th class="r">Equipos</th><th class="r">Visitas</th></tr></thead><tbody>
    ${cl.map((c) => `<tr data-href="#/cliente/${c.id}"><td><b>${esc(c.name)}</b></td><td class="num">${esc(c.rut || '—')}</td><td>${esc(c.address || '—')}</td><td class="r num">${c.equipos}</td><td class="r num">${c.visitas}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Aún no hay clientes</td></tr>'}
    </tbody></table></div></div>`);
  $$('tr[data-href]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
  $('#nc').onclick = () => clientDialog(null, (id) => (location.hash = '#/cliente/' + id));
}
async function viewClient(id) {
  const [cl, eqs, visits] = await Promise.all([api('/clients'), api(`/clients/${id}/equipment`), api(`/visits?client_id=${id}&limit=40`)]);
  const c = cl.find((x) => x.id === id);
  if (!c) return toast('Cliente no encontrado', true);
  layout(`
    <div class="head"><div><a href="#/clientes" class="faint">← Clientes</a><h1>${esc(c.name)}</h1><p>${esc([c.rut, c.address, c.contact_name].filter(Boolean).join(' · '))}</p></div>
      <div class="row"><button class="btn" id="ec">Editar</button><a class="btn" href="#/dashboard" id="cd">Ver KPIs</a></div></div>
    <div class="card"><h2>Equipos <button class="btn sm" id="ne" style="margin-left:auto">＋ Equipo</button></h2>
      <div class="scroll"><table class="t"><thead><tr><th>Equipo</th><th>Tipo</th><th>Refrigerante</th><th class="r">Setpoint</th><th></th></tr></thead><tbody>
      ${eqs.map((e) => `<tr><td><b>${esc(e.name)}</b><div class="faint">${esc([e.brand, e.model, e.serial].filter(Boolean).join(' · '))}</div></td><td>${esc(S.cat.equipmentKinds[e.kind] || e.kind)}</td>
        <td>${esc(e.refrigerant || '—')}${e.charge_kg ? ` · ${e.charge_kg} kg` : ''}</td><td class="r num">${e.setpoint_c != null ? `${e.setpoint_c} °C ± ${e.tolerance_c}` : '—'}</td>
        <td class="r">${isStaff() ? `<button class="btn sm" data-ee="${e.id}">Editar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin equipos registrados</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h2>Historial de visitas</h2>${visits.length ? `<ul class="list">${visits.map(visitItem).join('')}</ul>` : '<div class="empty">Sin visitas</div>'}</div>`);
  $('#ec').onclick = () => clientDialog(c, () => viewClient(id));
  $('#ne').onclick = () => equipmentDialog(id, null, () => viewClient(id));
  $$('[data-ee]').forEach((b) => (b.onclick = () => equipmentDialog(id, eqs.find((e) => e.id === +b.dataset.ee), () => viewClient(id))));
  $('#cd').onclick = (e) => { e.preventDefault(); viewDashboard({}).then(() => { const s = $('#df [name=client_id]'); s.value = id; s.dispatchEvent(new Event('change', { bubbles: true })); }); };
}

// ---------- Solicitudes (supervisor / administrador) ----------
async function viewRequests() {
  const team = await api('/team');
  layout(`
    <div class="head"><div><h1>Solicitudes de visita</h1><p>Crea solicitudes, asígnalas a tus técnicos y sigue su estado.</p></div><button class="btn primary" id="nr">＋ Nueva solicitud</button></div>
    <div class="grid g4" id="rqT"></div>
    <div class="card" style="margin-top:14px"><h2>Mapa de solicitudes abiertas</h2><div class="routemap" id="rqMap"></div>
      <div class="legend" style="margin-top:8px"><span><i style="background:var(--warn)"></i>Sin asignar</span><span><i style="background:var(--accent)"></i>Asignada</span><span><i class="live"></i>En curso (técnico en terreno)</span><span><i style="background:var(--bad)"></i>Urgente</span></div></div>
    <div class="card" id="rqLive" style="margin-top:14px;display:none"></div>
    <div class="card" style="margin-top:14px">
      <form class="filters" id="rf">
        <div><label>Buscar</label><input name="q" placeholder="Código, empresa o descripción"></div>
        <div><label>Estado</label><select name="status"><option value="abiertas">Abiertas</option><option value="">Todas</option>${Object.entries(REQST).map(([k, [, l]]) => `<option value="${k}">${esc(l.replace('✓ ', ''))}</option>`).join('')}</select></div>
        <div><label>Técnico</label><select name="technician_id"><option value="">Todos</option>${team.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      </form>
      <ul class="list" id="rl"></ul>
    </div>`);
  let map = null, layer = null;
  loadLeaflet().then(() => { map = L.map($('#rqMap')).setView([-33.45, -70.66], 10); osmTiles(map); load(); })
    .catch(() => ($('#rqMap').innerHTML = '<div class="empty">No se pudo cargar el mapa.</div>'));
  const load = async () => {
    const f = Object.fromEntries(Object.entries(formData($('#rf'))).filter(([, x]) => x));
    const [rows, all] = await Promise.all([api('/requests?' + new URLSearchParams(f)), api('/requests?status=abiertas')]);
    const today = todayISO();
    $('#rqT').innerHTML = tile('Sin asignar', all.filter((q) => q.status === 'pendiente').length, '', 'Esperando técnico')
      + tile('Asignadas', all.filter((q) => q.status === 'asignada').length, '', 'Por iniciar')
      + tile('En curso', all.filter((q) => q.status === 'en_curso').length, '', 'Técnico en terreno')
      + tile('Atrasadas', all.filter((q) => q.scheduled_date && q.scheduled_date < today).length, '', 'Fecha vencida');
    $('#rl').innerHTML = rows.length ? rows.map((q) => reqItem(q, false)).join('') : '<div class="empty">No hay solicitudes con esos filtros.</div>';
    const live = all.filter((q) => q.status === 'en_curso');
    $('#rqLive').style.display = live.length ? '' : 'none';
    $('#rqLive').innerHTML = `<h2><i class="live-dot"></i> Ahora en terreno <span class="faint" style="font-weight:500">· ${live.length}</span></h2>
      <ul class="list">${live.map((q) => `<li class="item" style="cursor:pointer" ${q.visit_id ? `data-href="#/visita/${q.visit_id}"` : ''}><span class="bar" style="background:var(--ok)"></span>
        <div class="main"><b>${esc(q.tech_name || '—')} · ${esc(q.client_name)}</b>
          <div class="meta"><span class="num">${esc(q.code)}</span> · ${esc(S.cat.visitTypes[q.type].label)}${q.equipment_name ? ' · ' + esc(q.equipment_name) : ''}</div>
          <div class="meta">En terreno desde ${q.visit_started_at ? fmtDT(q.visit_started_at) : '—'}</div></div>
        <div class="req-r">${prioChip(q.priority)}<span class="chip ok">● En curso</span></div></li>`).join('')}</ul>`;
    $$('#rqLive [data-href]').forEach((li) => (li.onclick = () => (location.hash = li.dataset.href)));
    refreshActiveBadge(all);
    $$('#rl li.req').forEach((li, i) => (li.onclick = () => requestDialog(rows[i], load)));
    if (map) {
      if (layer) layer.remove(); layer = L.layerGroup().addTo(map);
      const pts = all.filter((q) => q.client_lat != null).map((q) => {
        const pop = `<b>${esc(q.client_name)}</b><br>${esc(q.code)} · ${esc(S.cat.visitTypes[q.type].label)}<br>${esc(q.tech_name || 'Sin asignar')}`;
        if (q.status === 'en_curso') {
          // Marcador destacado: técnico trabajando ahora en esa empresa
          const ini = (q.tech_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
          L.marker([q.client_lat, q.client_lng], { zIndexOffset: 1000, title: `En curso · ${q.tech_name || ''}`,
            icon: L.divIcon({ className: '', html: `<div class="pin-live${q.priority === 'urgente' ? ' urg' : ''}">${esc(ini)}</div>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] }) })
            .addTo(layer).bindPopup(`${pop}<br><b style="color:${cssVar('--ok')}">● En curso</b>${q.visit_started_at ? ' desde ' + fmtDT(q.visit_started_at) : ''}${q.visit_id ? `<br><a href="#/visita/${q.visit_id}">Ver visita ${esc(q.visit_folio || '')} →</a>` : ''}`);
        } else {
          const col = q.priority === 'urgente' ? cssVar('--bad') : q.status === 'pendiente' ? cssVar('--warn') : cssVar('--accent');
          L.circleMarker([q.client_lat, q.client_lng], { radius: 9, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 }).addTo(layer).bindPopup(pop);
        }
        return [q.client_lat, q.client_lng]; });
      if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 });
      setTimeout(() => map.invalidateSize(), 100);
    }
  };
  $('#rf').oninput = () => { clearTimeout(load.t); load.t = setTimeout(load, 250); };
  $('#nr').onclick = () => requestDialog(null, load);
  S.timer = setInterval(() => { if (!$('dialog[open]')) load(); }, 60000); // se actualiza solo cada minuto
  if (!window.L) load();
}

async function requestDialog(q, done) {
  q = q || {};
  const isNew = !q.id;
  const closed = q.status === 'completada' || q.status === 'cancelada';
  const [clients, team] = await Promise.all([api('/clients'), api('/team')]);
  const types = Object.entries(S.cat.visitTypes);
  const d = dialog(`<h2>${isNew ? 'Nueva solicitud' : esc(q.code)} ${!isNew ? reqChip(q) : ''}</h2>
    ${q.visit_id ? `<p><a href="#/visita/${q.visit_id}" data-go>Ver visita ${esc(q.visit_folio || '')} ↗</a></p>` : ''}
    <div class="field"><label>Tipo de visita</label><select name="type" required ${closed ? 'disabled' : ''}>${types.map(([k, t]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div>
    <div class="field"><label>Empresa</label><div class="row" style="flex-wrap:nowrap"><select name="client_id" required ${closed ? 'disabled' : ''}><option value="">Selecciona…</option>${clients.map((c) => `<option value="${c.id}" ${q.client_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      ${closed ? '' : '<button type="button" class="btn" data-addc title="Nueva empresa">＋</button>'}</div><div class="faint" data-cinfo style="margin-top:4px"></div></div>
    <div class="field"><label>Equipo (opcional)</label><select name="equipment_id" ${closed ? 'disabled' : ''}><option value="">— Sin equipo específico —</option></select></div>
    <div class="fields" style="margin-top:12px">
      <div><label>Prioridad</label><select name="priority" ${closed ? 'disabled' : ''}>${Object.entries(PRIO).map(([k, [, l]]) => `<option value="${k}" ${(q.priority || 'normal') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label>Fecha programada</label><input type="date" name="scheduled_date" value="${esc(q.scheduled_date || (isNew ? todayISO() : ''))}" ${closed ? 'disabled' : ''}></div></div>
    <div class="field"><label>Técnico asignado</label><select name="technician_id" ${closed || q.status === 'en_curso' ? 'disabled' : ''}><option value="">— Sin asignar —</option>
      ${team.filter((t) => t.active || t.id === q.technician_id).map((t) => `<option value="${t.id}" ${q.technician_id === t.id ? 'selected' : ''}>${esc(t.name)} · ${t.asignadas} asignadas${t.en_curso ? ' · en terreno' : ''}</option>`).join('')}</select>
      ${team.length ? '' : `<p class="faint" style="margin:4px 0 0">${S.me.role === 'supervisor' ? 'Aún no tienes técnicos asignados. Pídele al administrador que te los asigne en Usuarios.' : 'No hay técnicos activos.'}</p>`}</div>
    <div class="field"><label>Descripción / motivo</label><textarea name="description" placeholder="Ej: Cámara N°2 no baja de 8 °C. Cliente pide visita en la mañana." ${closed ? 'disabled' : ''}>${esc(q.description)}</textarea></div>
    ${!isNew && !closed && q.status !== 'en_curso' ? '<button type="button" class="btn danger sm" data-cancel style="margin-top:12px">Cancelar solicitud</button>' : ''}
    ${!isNew ? `<p class="faint" style="margin-top:10px">Creada por ${esc(q.created_by_name || '—')} · ${fmtDT(String(q.created_at).replace(' ', 'T') + 'Z')}</p>` : ''}`,
  async (b) => {
    if (closed) return;
    const r = isNew ? await api('/requests', { method: 'POST', body: b }) : await api('/requests/' + q.id, { method: 'PUT', body: b });
    toast(isNew ? `Solicitud ${r.code} creada${r.tech_name ? ' y asignada a ' + r.tech_name : ''}` : 'Solicitud actualizada'); done && done();
  });
  if (closed) $('button.primary', d).remove();
  const f = $('form', d);
  const loadEq = async (sel) => {
    const c = clients.find((x) => x.id === +f.client_id.value);
    $('[data-cinfo]', d).innerHTML = !c ? '' : c.lat != null ? `📍 ${esc(c.address || 'Ubicación registrada')}` : `<span style="color:var(--warn)">⚠ Esta empresa no tiene ubicación en el mapa: no entrará en la ruta del técnico.</span> <a href="#" data-loc>Marcar ubicación</a>`;
    const a = $('[data-loc]', d); if (a) a.onclick = (e) => { e.preventDefault(); clientDialog(c, async () => { const nc = await api('/clients'); clients.splice(0, clients.length, ...nc); loadEq(f.equipment_id.value); }); };
    const eqs = c ? await api(`/clients/${c.id}/equipment`) : [];
    f.equipment_id.innerHTML = '<option value="">— Sin equipo específico —</option>' + eqs.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    if (sel) f.equipment_id.value = sel;
  };
  f.client_id.onchange = () => loadEq();
  loadEq(q.equipment_id);
  const ac = $('[data-addc]', d);
  if (ac) ac.onclick = () => clientDialog(null, async (id) => { const nc = await api('/clients'); clients.splice(0, clients.length, ...nc);
    f.client_id.innerHTML = '<option value="">Selecciona…</option>' + nc.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join(''); f.client_id.value = id; loadEq(); });
  const cb = $('[data-cancel]', d);
  if (cb) cb.onclick = async () => { if (!confirm('¿Cancelar esta solicitud?')) return; try { await api('/requests/' + q.id, { method: 'PUT', body: { status: 'cancelada' } }); toast('Solicitud cancelada'); d.close(); done && done(); } catch (e) { toast(e.message, true); } };
  const go = $('[data-go]', d); if (go) go.onclick = () => d.close();
}

// ---------- Técnicos / Mi equipo ----------
async function viewTeam() {
  const team = await api('/team');
  const admin = S.me.role === 'admin';
  const groups = {};
  team.forEach((t) => (groups[admin ? t.supervisor_name || 'Sin supervisor asignado' : 'Mi equipo'] ||= []).push(t));
  const card = (t) => `<a class="tcard${t.active ? '' : ' off'}" href="#/tecnico/${t.id}">
    <div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b>${esc(t.name)}</b>${t.en_curso ? '<span class="chip live"><i></i>En terreno</span>' : t.active ? '' : '<span class="chip">Inactivo</span>'}</div>
    <div class="faint">${esc(t.email)}${t.phone ? ' · ' + esc(t.phone) : ''}</div>
    <div class="tstats">
      <div><span>${t.asignadas}</span>asignadas</div>
      <div class="${t.atrasadas ? 'bad' : ''}"><span>${t.atrasadas}</span>atrasadas</div>
      <div><span>${t.visitas_30d}</span>visitas 30 d</div>
      <div><span>${t.dur_prom_min != null ? fmtMin(t.dur_prom_min) : '—'}</span>duración prom.</div>
      <div><span>${t.satisfaccion ?? '—'}</span>satisfacción</div>
    </div>
    <div class="faint">Última visita: ${t.ultima_visita ? fmtDT(t.ultima_visita) : 'sin visitas'}</div></a>`;
  layout(`
    <div class="head"><div><h1>${admin ? 'Técnicos' : 'Mi equipo'}</h1><p>Rendimiento y carga de trabajo de cada técnico. Toca uno para ver su ficha.</p></div>
      <div class="row"><a class="btn primary" href="#/solicitudes">✎ Solicitudes</a>${admin ? '<a class="btn" href="#/usuarios">⚙ Usuarios y supervisores</a>' : ''}</div></div>
    ${team.length ? Object.entries(groups).map(([g, ts]) => `${admin ? `<h2 style="margin:18px 0 10px">${esc(g)} <span class="faint" style="font-weight:500">· ${ts.length}</span></h2>` : ''}<div class="tgrid">${ts.map(card).join('')}</div>`).join('')
      : `<div class="card"><div class="empty">${admin ? 'Aún no hay técnicos. Créalos en Usuarios.' : 'Aún no tienes técnicos asignados. El administrador los asigna en Usuarios → Supervisor a cargo.'}</div></div>`}`);
}

// ---------- Usuarios ----------
async function viewUsers() {
  const us = await api('/users');
  const roles = { admin: 'Administrador', supervisor: 'Supervisor', tecnico: 'Técnico' };
  layout(`
    <div class="head"><div><h1>Usuarios</h1><p>Crea las cuentas de técnicos y supervisores, y asigna a cada técnico su supervisor.</p></div>
      <div class="row"><button class="btn primary" id="nt">＋ Nuevo técnico</button><button class="btn primary" id="ns">＋ Nuevo supervisor</button><button class="btn" id="na">＋ Administrador</button></div></div>
    <div class="card"><div class="scroll"><table class="t"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Supervisor / a cargo</th><th>Estado</th><th></th></tr></thead><tbody>
    ${us.map((u) => {
      const aCargo = us.filter((t) => t.role === 'tecnico' && t.supervisor_id === u.id).length;
      const sup = u.role === 'tecnico' ? (u.supervisor_name ? esc(u.supervisor_name) : '<span class="faint">Sin asignar</span>')
        : aCargo ? `${aCargo} técnico${aCargo === 1 ? '' : 's'} a cargo` : '<span class="faint">—</span>';
      return `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${roles[u.role]}</td><td>${sup}</td><td>${u.active ? '<span class="chip ok">✓ Activo</span>' : '<span class="chip">Inactivo</span>'}</td>
      <td class="r"><div class="row end">${u.role === 'tecnico' ? `<a class="btn sm" href="#/tecnico/${u.id}">KPIs</a>` : ''}<button class="btn sm" data-eu="${u.id}">Editar</button></div></td></tr>`;
    }).join('')}
    </tbody></table></div></div>`);
  const techs = us.filter((x) => x.role === 'tecnico' && x.active);
  const form = (u, preset) => dialog(`<h2>${u ? 'Editar usuario' : `Nuevo ${roles[preset].toLowerCase()}`}</h2>
    <div class="field"><label>Nombre</label><input name="name" required value="${esc(u?.name)}"></div>
    ${u ? '' : '<div class="field"><label>Correo (con este entra a la app)</label><input name="email" type="email" required autocomplete="off"></div>'}
    <div class="fields" style="margin-top:12px"><div><label>Rol</label><select name="role">${Object.entries(roles).map(([k, l]) => `<option value="${k}" ${(u?.role || preset) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label>Teléfono</label><input name="phone" value="${esc(u?.phone)}"></div></div>
    <div class="field" data-supf><label>Supervisor a cargo</label><select name="supervisor_id"><option value="">— Sin supervisor —</option>
      ${us.filter((x) => (x.role === 'supervisor' || x.role === 'admin') && x.active && x.id !== u?.id).map((x) => `<option value="${x.id}" ${u?.supervisor_id === x.id ? 'selected' : ''}>${esc(x.name)} (${roles[x.role]})</option>`).join('')}</select>
      <p class="faint" style="margin:4px 0 0">El supervisor podrá asignarle solicitudes y ver su rendimiento.</p></div>
    <div class="field" data-techf><label>Técnicos a cargo</label>
      ${techs.length ? `<div style="max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:4px 10px">${techs.map((t) => `<label class="check" style="display:flex;gap:10px;align-items:center;padding:6px 0;font-weight:500"><input type="checkbox" data-tech="${t.id}" ${u && t.supervisor_id === u.id ? 'checked' : ''}>
        <span>${esc(t.name)}${t.supervisor_name && t.supervisor_id !== u?.id ? ` <span class="faint">· hoy con ${esc(t.supervisor_name)}</span>` : ''}</span></label>`).join('')}</div>
        <p class="faint" style="margin:4px 0 0">Opcional. Los técnicos marcados quedan bajo este supervisor.</p>` : '<p class="faint" style="margin:0">Aún no hay técnicos. Puedes crearlos después y asignarles este supervisor.</p>'}</div>
    <div class="field"><label>${u ? 'Nueva contraseña (opcional)' : 'Contraseña inicial (mín. 8 caracteres)'}</label>
      <div class="row" style="flex-wrap:nowrap"><input name="password" type="text" minlength="8" ${u ? '' : 'required'} autocomplete="new-password"><button type="button" class="btn" data-gen>Generar</button></div>
      ${u ? '' : '<p class="faint" style="margin:4px 0 0">Entrégasela a la persona; podrá cambiarla en «Mi cuenta».</p>'}</div>
    ${u ? `<div class="field"><label>Estado</label><select name="active"><option value="1" ${u.active ? 'selected' : ''}>Activo</option><option value="0" ${u.active ? '' : 'selected'}>Inactivo</option></select></div>` : ''}`,
  async (b, d) => {
    if (b.role !== 'tecnico') { b.supervisor_id = ''; b.technician_ids = $$('[data-tech]', d).filter((c) => c.checked).map((c) => +c.dataset.tech); }
    if (u) { b.active = b.active === '1'; if (!b.password) delete b.password; await api('/users/' + u.id, { method: 'PUT', body: b }); }
    else await api('/users', { method: 'POST', body: b });
    toast(u ? 'Usuario guardado' : `${roles[b.role]} creado: ya puede entrar con ${b.email}`); viewUsers();
  });
  const form2 = (u, preset = 'tecnico') => {
    const d = form(u, preset);
    const sync = () => { const t = $('[name=role]', d).value === 'tecnico'; $('[data-supf]', d).style.display = t ? '' : 'none'; $('[data-techf]', d).style.display = t ? 'none' : ''; };
    $('[name=role]', d).onchange = sync; sync();
    $('[data-gen]', d).onclick = () => {
      const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', a = crypto.getRandomValues(new Uint32Array(10));
      $('[name=password]', d).value = Array.from(a, (n) => abc[n % abc.length]).join('');
    };
  };
  $('#nt').onclick = () => form2(null, 'tecnico');
  $('#ns').onclick = () => form2(null, 'supervisor');
  $('#na').onclick = () => form2(null, 'admin');
  $$('[data-eu]').forEach((b) => (b.onclick = () => form2(us.find((u) => u.id === +b.dataset.eu))));
}

// ---------- Mi cuenta ----------
function viewAccount() {
  layout(`
    <div class="head"><div><h1>Mi cuenta</h1><p>${esc(S.me.email)}</p></div></div>
    <form class="card" id="pw" style="max-width:460px"><h2>Cambiar contraseña</h2>
      <div class="field"><label>Contraseña actual</label><input name="current" type="password" required></div>
      <div class="field"><label>Nueva contraseña</label><input name="next" type="password" minlength="8" required></div>
      <div class="row end" style="margin-top:14px"><button class="btn primary">Actualizar</button></div></form>
    <div class="card" style="max-width:460px"><h2>Apariencia</h2><div class="row">
      <button class="btn sm" data-th="">Automático</button><button class="btn sm" data-th="light">Claro</button><button class="btn sm" data-th="dark">Oscuro</button></div></div>
    <button class="btn danger" data-logout style="margin-top:14px">Cerrar sesión</button>`);
  $('#pw').onsubmit = async (e) => { e.preventDefault(); try { await api('/me/password', { method: 'PUT', body: formData(e.target) }); toast('Contraseña actualizada'); e.target.reset(); } catch (err) { toast(err.message, true); } };
  $$('[data-th]').forEach((b) => (b.onclick = () => { setTheme(b.dataset.th); }));
}
function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { t ? localStorage.setItem('cl-theme', t) : localStorage.removeItem('cl-theme'); } catch {}
}
try { const t = localStorage.getItem('cl-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
