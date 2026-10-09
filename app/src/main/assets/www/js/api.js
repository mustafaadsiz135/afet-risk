// Ağ erişimi: açık ve ücretsiz veri servisleri. Her kaynak bağımsızdır; biri başarısız olursa
// rapor diğer kaynaklarla (düşük güven düzeyiyle) üretilmeye devam eder.
import { gridPoints, haversineKm } from './risk.js';

async function getJSON(url, { timeout = 25000, init = {} } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function firstOk(urls, opts) {
  let err;
  for (const u of urls) {
    try { return await getJSON(u, opts); } catch (e) { err = e; }
  }
  throw err;
}

// ---------- Yer arama (OpenStreetMap Nominatim, yedek: Photon) ----------
export async function geocode(query, { country, lat, lon, lang = 'tr' }) {
  const q = encodeURIComponent(query);
  const d = 0.6;
  const vb = lat != null ? `&viewbox=${lon - d},${lat + d},${lon + d},${lat - d}` : '';
  const cc = country ? `&countrycodes=${country.toLowerCase()}` : '';
  try {
    const res = await getJSON(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&addressdetails=1&limit=8&accept-language=${lang}${cc}${vb}`,
      { timeout: 15000 });
    if (res.length) return res.map((r) => ({
      name: r.name || r.display_name.split(',')[0],
      label: r.display_name,
      type: r.type, lat: +r.lat, lon: +r.lon,
    }));
  } catch (_) { /* yedeğe geç */ }
  const bias = lat != null ? `&lat=${lat}&lon=${lon}` : '';
  const ph = await getJSON(`https://photon.komoot.io/api/?q=${q}&limit=8${bias}&lang=${lang === 'tr' ? 'default' : 'en'}`, { timeout: 15000 });
  return (ph.features || [])
    .filter((f) => !country || (f.properties.countrycode || '').toUpperCase() === country.toUpperCase())
    .map((f) => {
      const p = f.properties;
      const parts = [p.name, p.street && (p.street + (p.housenumber ? ' ' + p.housenumber : '')), p.district, p.city, p.state, p.country].filter(Boolean);
      return { name: p.name || parts[0], label: parts.join(', '), type: p.osm_value, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
    });
}

// ---------- Yükseklik (Copernicus DEM 90 m, Open-Meteo üzerinden) ----------
export async function elevationGrid(lat, lon) {
  const pts = gridPoints(lat, lon);
  const la = pts.map((p) => p[0]).join(','), lo = pts.map((p) => p[1]).join(',');
  const r = await getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`);
  return r.elevation;
}

// ---------- İklim geçmişi (ERA5 yeniden analiz, Open-Meteo Archive) ----------
export async function climateHistory(lat, lon) {
  const end = new Date().getUTCFullYear() - 1;
  const start = end - 19; // 20 yıl
  const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start_date=${start}-01-01&end_date=${end}-12-31&daily=precipitation_sum,snowfall_sum&timezone=GMT`;
  const r = await getJSON(u, { timeout: 40000 });
  return r.daily;
}

// ---------- Deprem kataloğu (USGS ComCat, yedek: EMSC) ----------
export async function earthquakes(lat, lon, radiusKm = 150) {
  const mapUsgs = (f) => ({
    mag: f.properties.mag, time: f.properties.time, place: f.properties.place,
    lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth: f.geometry.coordinates[2],
  });
  let ev;
  try {
    const r = await getJSON(
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}` +
      `&maxradiuskm=${radiusKm}&minmagnitude=4.5&starttime=1900-01-01&orderby=magnitude&limit=4000`, { timeout: 30000 });
    ev = r.features.map(mapUsgs);
  } catch (e) {
    const r = await getJSON(
      `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&lat=${lat}&lon=${lon}` +
      `&maxradius=${(radiusKm / 111.2).toFixed(2)}&minmag=4.5&limit=4000`, { timeout: 30000 });
    ev = r.features.map((f) => ({
      mag: f.properties.mag, time: Date.parse(f.properties.time), place: f.properties.flynn_region,
      lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth: Math.abs(f.geometry.coordinates[2]),
    }));
  }
  return ev.filter((e) => e.mag != null).map((e) => ({ ...e, distKm: haversineKm(lat, lon, e.lat, e.lon) }));
}

// ---------- Akarsu ve kıyı (OpenStreetMap, Overpass API) ----------
export async function waterways(lat, lon) {
  const q = `[out:json][timeout:25];(` +
    `way(around:1500,${lat},${lon})[waterway~"^(river|canal)$"];` +
    `way(around:400,${lat},${lon})[waterway=stream];` +
    `way(around:1500,${lat},${lon})[natural=water];` +
    `way(around:1500,${lat},${lon})[natural=coastline];` +
    `);out body geom;`;
  const body = 'data=' + encodeURIComponent(q);
  const init = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body };
  const r = await firstOk([
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ], { timeout: 30000, init });
  return r.elements || [];
}

// ---------- Fay hatları (uygulama içine gömülü GEM Global Active Faults verisi) ----------
const faultCache = new Map();
let faultIndex = null;
export async function faultsAround(lat, lon) {
  if (!faultIndex) faultIndex = new Set(await (await fetch('data/faults/index.json')).json());
  const ty = Math.floor(lat / 5) * 5, tx = Math.floor(lon / 5) * 5;
  const keys = [];
  for (const dy of [-5, 0, 5]) for (const dx of [-5, 0, 5]) keys.push(`${ty + dy}_${tx + dx}`);
  const out = [];
  await Promise.all(keys.map(async (k) => {
    if (!faultIndex.has(k)) return;
    if (!faultCache.has(k)) {
      try {
        const r = await fetch(`data/faults/${k}.json`);
        faultCache.set(k, r.ok ? await r.json() : []);
      } catch (_) { faultCache.set(k, []); }
    }
    out.push(...faultCache.get(k));
  }));
  return out;
}

export async function loadCountries() {
  return (await fetch('data/countries.json')).json();
}
export async function loadPlaces(cc) {
  const r = await fetch(`data/places/${cc}.json`);
  return r.ok ? r.json() : [];
}
