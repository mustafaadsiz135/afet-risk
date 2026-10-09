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

// CORS izni vermeyen resmi kaynaklar için Android tarafındaki yerel HTTP köprüsü (yalnızca izinli alan adları).
const pendingNative = new Map();
let nativeSeq = 0;
window.__nativeHttp = (id, ok, body) => {
  const p = pendingNative.get(id);
  if (!p) return;
  pendingNative.delete(id);
  ok ? p.res(body) : p.rej(new Error(body || 'native'));
};
function nativeGet(url, timeout) {
  return new Promise((res, rej) => {
    const id = ++nativeSeq;
    pendingNative.set(id, { res, rej });
    setTimeout(() => { if (pendingNative.delete(id)) rej(new Error('timeout')); }, timeout);
    window.Android.httpGet(id, url);
  });
}
async function getJSONAny(url, timeout = 25000) {
  try { return await getJSON(url, { timeout }); } catch (e) {
    if (!window.Android?.httpGet) throw e;
    return JSON.parse(await nativeGet(url, timeout));
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

// ---------- Ülke göstergeleri (Dünya Bankası Açık Veri, CC BY 4.0) ----------
export const WB = {
  hom: 'VC.IHR.PSRC.P5',        // kasten öldürme / 100.000 (UNODC)
  malaria: 'SH.MLR.INCD.P3',    // sıtma vakası / 1.000 risk altındaki kişi (WHO)
  water: 'SH.H2O.SMDW.ZS',      // güvenli yönetilen içme suyu kullanan nüfus % (WHO/UNICEF)
  uhc: 'SH.UHC.SRVS.CV.XD',     // evrensel sağlık hizmeti kapsama endeksi 0–100 (WHO)
  phys: 'SH.MED.PHYS.ZS',       // hekim / 1.000 kişi (WHO)
  road: 'SH.STA.TRAF.P5',       // trafik kazası ölümü / 100.000 (WHO)
  internet: 'IT.NET.USER.ZS',   // internet kullanan nüfus % (ITU)
  account: 'FX.OWN.TOTL.ZS',    // banka / mobil para hesabı sahipliği, 15+ yaş % (Global Findex)
};
async function wbLatest(code, indicator) {
  const r = await getJSONAny(`https://api.worldbank.org/v2/country/${code}/indicator/${indicator}?format=json&mrnev=1`, 20000);
  const row = Array.isArray(r) && Array.isArray(r[1]) ? r[1].find((x) => x.value != null) : null;
  return row ? { value: row.value, year: row.date } : null;
}
export async function countryStats(cc) {
  const keys = Object.keys(WB);
  const vals = await Promise.all(keys.map((k) => wbLatest(cc, WB[k]).catch(() => undefined)));
  const out = {};
  keys.forEach((k, i) => { out[k] = vals[i] ?? null; });
  if (vals.every((v) => v === undefined)) throw new Error('world bank unreachable');
  out.homWorld = await wbLatest('WLD', WB.hom).catch(() => null);
  return out;
}

// ---------- Resmi seyahat bilgisi (GOV.UK Foreign travel advice, Open Government Licence v3.0) ----------
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
let fcdoIndex = null;
export async function travelAdvice(countryNameEn) {
  if (!fcdoIndex) {
    const idx = await getJSONAny('https://www.gov.uk/api/content/foreign-travel-advice', 25000);
    fcdoIndex = (idx.links?.children || []).map((c) => ({
      path: c.base_path,
      keys: [c.details?.country?.name, c.details?.country?.slug, ...(c.details?.country?.synonyms || [])].map(norm),
    }));
  }
  const key = norm(countryNameEn);
  const hit = fcdoIndex.find((c) => c.keys.includes(key)) || fcdoIndex.find((c) => c.keys.some((k) => k && (k.includes(key) || key.includes(k))));
  if (!hit) return null;
  const page = await getJSONAny('https://www.gov.uk/api/content' + hit.path, 25000);
  const parts = {};
  for (const p of page.details?.parts || []) parts[p.slug] = p.body || '';
  return { base: 'https://www.gov.uk' + hit.path, updated: page.public_updated_at || page.updated_at || null, parts };
}

// HTML gövdesinden bir başlık altındaki metni düz metin blokları olarak çıkarır (HTML olarak gösterilmez).
// re verilmezse gövdenin tamamı alınır.
export function extractSection(html, re, max = 30) {
  if (!html) return { blocks: [], links: [] };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const all = [...doc.body.children];
  let from = 0, lvl = null;
  if (re) {
    from = all.findIndex((el) => /^H[2-4]$/.test(el.tagName) && re.test(el.textContent));
    if (from < 0) return { blocks: [], links: [] };
    lvl = +all[from].tagName[1];
    from++;
  }
  const blocks = [], links = [];
  for (let i = from; i < all.length; i++) {
    const el = all[i];
    const h = /^H([2-6])$/.exec(el.tagName);
    if (h && lvl != null && +h[1] <= lvl) break;
    el.querySelectorAll('a[href]').forEach((a) => links.push({ text: a.textContent.trim(), href: a.getAttribute('href') }));
    if (h) blocks.push({ h: el.textContent.trim() });
    else if (el.tagName === 'UL' || el.tagName === 'OL') blocks.push({ li: [...el.querySelectorAll('li')].map((li) => li.textContent.trim()).filter(Boolean) });
    else if (el.textContent.trim()) blocks.push({ p: el.textContent.trim() });
  }
  return { blocks: blocks.slice(0, max), links };
}

// ---------- Konum çevresindeki resmi suç kayıtları (yalnızca açık sokak düzeyi veri bulunan yerler) ----------
// Yöntem: konumun 1 km çevresindeki kayıt sayısı, aynı şehirde 3 km uzaktaki 4 noktanın (K, D, G, B)
// 1 km çevresindeki kayıt sayılarıyla karşılaştırılır. Sokak adı veya tekil olay gösterilmez.
const LOCAL_SOURCES = [
  { key: 'police_uk', test: (lat, lon, cc) => cc === 'GB' && lat < 55.8 },          // İngiltere, Galler, K. İrlanda
  { key: 'chicago', test: (lat, lon) => lat > 41.64 && lat < 42.03 && lon > -87.94 && lon < -87.52 },
  { key: 'sf', test: (lat, lon) => lat > 37.70 && lat < 37.84 && lon > -122.52 && lon < -122.35 },
];
export function localCrimeSource(lat, lon, cc) {
  return LOCAL_SOURCES.find((s) => s.test(lat, lon, cc))?.key || null;
}
export const LOCAL_RADIUS_M = 1000, RING_DIST_M = 3000;
function offsetPoint(lat, lon, dn, de) {
  return [lat + dn / 111320, lon + de / (111320 * Math.cos((lat * Math.PI) / 180))];
}
function ringPoints(lat, lon) {
  const d = RING_DIST_M;
  return [offsetPoint(lat, lon, d, 0), offsetPoint(lat, lon, 0, d), offsetPoint(lat, lon, -d, 0), offsetPoint(lat, lon, 0, -d)];
}
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

// --- İngiltere ve Galler polisi (data.police.uk, Open Government Licence) ---
async function policeUk(lat, lon) {
  const dates = await getJSONAny('https://data.police.uk/api/crimes-street-dates', 20000);
  const months = dates.map((d) => d.date).sort().reverse().slice(0, 2);
  if (!months.length) throw new Error('no months');
  const poly = (la, lo) => {
    const pts = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 2 * Math.PI;
      const [pla, plo] = offsetPoint(la, lo, LOCAL_RADIUS_M * Math.cos(a), LOCAL_RADIUS_M * Math.sin(a));
      pts.push(`${pla.toFixed(5)},${plo.toFixed(5)}`);
    }
    return pts.join(':');
  };
  const fetchArea = async (la, lo) => {
    const all = [];
    for (const m of months) {
      const r = await getJSONAny(`https://data.police.uk/api/crimes-street/all-crime?poly=${poly(la, lo)}&date=${m}`, 30000);
      all.push(...r);
    }
    return all.filter((c) => c.category !== 'anti-social-behaviour'); // suç olmayan şikâyetler hariç
  };
  const center = await fetchArea(lat, lon);
  const ring = await Promise.all(ringPoints(lat, lon).map(([a, b]) => fetchArea(a, b).then((x) => x.length).catch(() => null)));
  const cats = {};
  for (const c of center) cats[c.category] = (cats[c.category] || 0) + 1;
  return {
    source: 'police_uk', url: 'https://data.police.uk/', months,
    total: center.length, ring,
    pickpocket: cats['theft-from-the-person'] || 0,
    categories: Object.entries(cats).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n),
  };
}

// --- Socrata açık veri portalları (Chicago, San Francisco) ---
const SOCRATA = {
  chicago: { base: 'https://data.cityofchicago.org/resource/ijzp-q8t2.json', geo: 'location', date: 'date', cat: 'primary_type',
    pick: "description='POCKET-PICKING'", url: 'https://data.cityofchicago.org/' },
  sf: { base: 'https://data.sfgov.org/resource/wg3w-h783.json', geo: 'point', date: 'incident_datetime', cat: 'incident_category',
    pick: null, url: 'https://datasf.org/opendata/' },
};
async function socrata(key, lat, lon) {
  const S = SOCRATA[key];
  const to = Date.now(), from = to - 90 * 864e5;
  const where = (la, lo) => `within_circle(${S.geo},${la.toFixed(5)},${lo.toFixed(5)},${LOCAL_RADIUS_M}) AND ${S.date} > '${isoDay(from)}T00:00:00'`;
  const q = (params) => getJSONAny(`${S.base}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`, 30000);
  const count = async (la, lo, extra) => {
    const r = await q({ $select: 'count(*) AS n', $where: where(la, lo) + (extra ? ` AND ${extra}` : '') });
    return +(r?.[0]?.n ?? 0);
  };
  const catsRaw = await q({ $select: `${S.cat} AS k, count(*) AS n`, $where: where(lat, lon), $group: S.cat, $order: 'n DESC', $limit: 50 });
  const categories = catsRaw.filter((x) => x.k).map((x) => ({ k: x.k, n: +x.n }));
  const total = categories.reduce((a, b) => a + b.n, 0);
  const ring = await Promise.all(ringPoints(lat, lon).map(([a, b]) => count(a, b).catch(() => null)));
  const pickpocket = S.pick ? await count(lat, lon, S.pick).catch(() => null) : null;
  return { source: key, url: S.url, days: 90, total, ring, pickpocket, categories };
}

export async function localCrime(lat, lon, cc) {
  const src = localCrimeSource(lat, lon, cc);
  if (!src) return null;
  return src === 'police_uk' ? policeUk(lat, lon) : socrata(src, lat, lon);
}
