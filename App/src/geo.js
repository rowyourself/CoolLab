// Ubicación: distancia al cliente y dirección aproximada (OpenStreetMap / Nominatim, sin API key)

// Distancia en metros entre dos coordenadas (fórmula de Haversine)
function distanceM(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((x) => x == null || isNaN(x))) return null;
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// Radio (m) dentro del cual se considera que el técnico estuvo en la empresa
const GEOFENCE_M = +process.env.GEOFENCE_M || 300;

async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null || process.env.GEOCODE_OFF === '1') return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=es`, {
      signal: ctrl.signal, headers: { 'User-Agent': 'CoolLab/1.0 (gestion tecnica refrigeracion)' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const a = j.address || {};
    const street = [a.road, a.house_number].filter(Boolean).join(' ');
    const city = a.city || a.town || a.village || a.suburb || a.county;
    return [street, city].filter(Boolean).join(', ') || j.display_name || null;
  } catch {
    return null;
  } finally { clearTimeout(t); }
}

// Buscar una dirección escrita por el técnico (para el mapa de "marcar ubicación")
async function searchAddress(q) {
  q = String(q || '').trim();
  if (q.length < 3 || process.env.GEOCODE_OFF === '1') return [];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const cc = process.env.GEOCODE_COUNTRY || 'cl';
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&accept-language=es&countrycodes=${cc}&q=${encodeURIComponent(q)}`, {
      signal: ctrl.signal, headers: { 'User-Agent': 'CoolLab/1.0 (gestion tecnica refrigeracion)' },
    });
    if (!r.ok) return [];
    const j = await r.json();
    return j.map((x) => {
      const a = x.address || {};
      const street = [a.road, a.house_number].filter(Boolean).join(' ');
      const city = a.city || a.town || a.village || a.suburb || a.county;
      return { lat: +x.lat, lng: +x.lon, label: [street, city].filter(Boolean).join(', ') || x.display_name };
    });
  } catch {
    return [];
  } finally { clearTimeout(t); }
}

// ---------- Normalizador de direcciones (sugerencias mientras se escribe) ----------
// Usa Photon (komoot, datos OpenStreetMap), hecho para "buscar mientras se escribe".
// Nominatim NO permite autocompletar, por eso solo se usa como respaldo (máx. 1 consulta por segundo).
const UA = { 'User-Agent': 'CoolLab/1.0 (gestion tecnica refrigeracion)' };
const CHILE_BBOX = '-75.8,-56.0,-66.3,-17.4'; // lon_min,lat_min,lon_max,lat_max
const cache = new Map();
const cacheGet = (k) => { const v = cache.get(k); if (v && Date.now() - v.t < 3600e3) return v.data; cache.delete(k); return null; };
const cacheSet = (k, data) => { cache.set(k, { t: Date.now(), data }); if (cache.size > 500) cache.delete(cache.keys().next().value); };
let lastNominatim = 0;
async function politeNominatim() { const w = 1100 - (Date.now() - lastNominatim); if (w > 0) await new Promise((r) => setTimeout(r, w)); lastNominatim = Date.now(); }

// Corrige abreviaturas típicas para que el buscador encuentre la calle
function cleanQuery(q) {
  return String(q || '').replace(/\s+/g, ' ').trim()
    .replace(/\bav(?:da)?\.?\s/gi, 'Avenida ').replace(/\bpje\.?\s/gi, 'Pasaje ').replace(/\bpsje\.?\s/gi, 'Pasaje ')
    .replace(/\bgral\.?\s/gi, 'General ').replace(/\bstgo\b\.?/gi, 'Santiago').replace(/\bn[°º]\s*/gi, '').replace(/#\s*/g, '');
}

function photonToSuggestion(f, typedNumber) {
  const p = f.properties || {};
  const [lng, lat] = f.geometry?.coordinates || [];
  if (lat == null) return null;
  const isRoad = p.osm_key === 'highway';
  const street = p.street || (isRoad ? p.name : null);
  let number = p.housenumber || null;
  let approx = false;
  if (!number && street && typedNumber) { number = typedNumber; approx = true; } // calle encontrada, número aproximado
  const comuna = p.city || p.locality || p.district || p.county || null;
  const region = p.state || null;
  const place = !isRoad && p.name && p.name !== street && p.osm_value !== 'house' ? p.name : null; // empresa, edificio, lugar
  const main = [street, number].filter(Boolean).join(' ') || p.name || '';
  if (!main) return null;
  const label = [main, comuna].filter(Boolean).join(', ');
  return { label, street: street || null, number, comuna, region, place, lat, lng, exact: !!p.housenumber, approx: approx || (!p.housenumber && !!street) };
}

async function suggestAddress(q, near) {
  q = cleanQuery(q).slice(0, 150);
  if (q.length < 3 || process.env.GEOCODE_OFF === '1') return [];
  const key = q.toLowerCase() + (near ? `|${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '');
  const hit = cacheGet(key); if (hit) return hit;
  const typedNumber = (q.match(/\b(\d{1,5}[a-zA-Z]?)\b/) || [])[1] || null;
  let out = [];
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : '&lat=-33.45&lon=-70.66'; // por defecto, cerca de Santiago
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&bbox=${CHILE_BBOX}${bias}`, { signal: ctrl.signal, headers: UA });
    if (!r.ok) throw new Error('photon ' + r.status);
    const j = await r.json();
    out = (j.features || []).filter((f) => !f.properties?.countrycode || f.properties.countrycode === 'CL')
      .map((f) => photonToSuggestion(f, typedNumber)).filter(Boolean);
  } catch {
    // Respaldo: Nominatim (una consulta, respetando su límite)
    await politeNominatim();
    out = (await searchAddress(q)).map((x) => ({ ...x, exact: /\d/.test(x.label), approx: false }));
  } finally { clearTimeout(t); }
  // Sin duplicados y primero las exactas (con número)
  const seen = new Set();
  out = out.sort((a, b) => (b.exact - a.exact))
    .filter((x) => { const k = ((x.place || '') + '|' + x.label).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  cacheSet(key, out);
  return out;
}

const mapsUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

module.exports = { distanceM, reverseGeocode, searchAddress, suggestAddress, mapsUrl, GEOFENCE_M };
