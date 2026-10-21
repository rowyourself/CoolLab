// Clima exterior desde Open-Meteo (gratis, sin API key). Opcional: OpenWeatherMap si defines OPENWEATHER_KEY.

const WMO = {
  0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Niebla', 48: 'Niebla con escarcha', 51: 'Llovizna débil', 53: 'Llovizna', 55: 'Llovizna intensa',
  61: 'Lluvia débil', 63: 'Lluvia', 65: 'Lluvia intensa', 71: 'Nieve débil', 73: 'Nieve', 75: 'Nieve intensa',
  80: 'Chubascos', 81: 'Chubascos', 82: 'Chubascos fuertes', 95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta con granizo',
};

async function fetchJson(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function openMeteo(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,surface_pressure,wind_speed_10m,weather_code` +
    `&timezone=auto`;
  const j = await fetchJson(url);
  const c = j.current;
  return {
    source: 'Open-Meteo',
    time: c.time,
    temp_c: c.temperature_2m,
    rh: c.relative_humidity_2m,
    feels_c: c.apparent_temperature,
    dew_point_c: c.dew_point_2m,
    pressure_hpa: c.surface_pressure,
    wind_kmh: c.wind_speed_10m,
    condition: WMO[c.weather_code] || `Código ${c.weather_code}`,
  };
}

async function openWeather(lat, lng, key) {
  const j = await fetchJson(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&units=metric&lang=es&appid=${key}`);
  return {
    source: 'OpenWeatherMap',
    time: new Date(j.dt * 1000).toISOString(),
    temp_c: j.main.temp, rh: j.main.humidity, feels_c: j.main.feels_like,
    dew_point_c: dewPoint(j.main.temp, j.main.humidity),
    pressure_hpa: j.main.pressure, wind_kmh: +(j.wind.speed * 3.6).toFixed(1),
    condition: j.weather?.[0]?.description || '',
  };
}

// Punto de rocío (fórmula de Magnus)
function dewPoint(t, rh) {
  if (t == null || rh == null || rh <= 0) return null;
  const a = 17.62, b = 243.12;
  const g = Math.log(rh / 100) + (a * t) / (b + t);
  return +((b * g) / (a - g)).toFixed(1);
}

async function getWeather(lat, lng) {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;
  if (process.env.WEATHER_MOCK === '1') {
    return { source: 'Simulado', time: new Date().toISOString(), temp_c: 27.4, rh: 38, feels_c: 27.9, dew_point_c: 11.8, pressure_hpa: 951, wind_kmh: 9.4, condition: 'Despejado' };
  }
  try {
    if (process.env.OPENWEATHER_KEY) return await openWeather(lat, lng, process.env.OPENWEATHER_KEY);
    return await openMeteo(lat, lng);
  } catch (e) {
    console.warn('[clima] no se pudo obtener el clima:', e.message);
    return null;
  }
}

module.exports = { getWeather, dewPoint };
