// Afet risk hesaplama çekirdeği — yalnızca saf fonksiyonlar (ağ erişimi yok).
// Tüm puanlar 0–100 arası "tehlike göstergesi"dir; bina/tesis güvenliğini değerlendirmez.

const R = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Noktadan (lat,lon) çoklu çizgiye (düz dizi [lon,lat,lon,lat,...]) en kısa mesafe, km.
export function distToPolylineKm(lat, lon, flat) {
  const kx = 111.32 * Math.cos(toRad(lat)), ky = 110.574;
  let best = Infinity;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const ax = (flat[i] - lon) * kx, ay = (flat[i + 1] - lat) * ky;
    const bx = (flat[i + 2] - lon) * kx, by = (flat[i + 3] - lat) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? -(ax * dx + ay * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (d < best) best = d;
  }
  if (flat.length === 2) best = Math.hypot((flat[0] - lon) * kx, (flat[1] - lat) * ky);
  return best;
}

export function levelOf(score) {
  if (score == null) return null;
  if (score < 20) return 1;
  if (score < 40) return 2;
  if (score < 60) return 3;
  if (score < 80) return 4;
  return 5;
}

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const step = (v, table) => { for (const [lim, pts] of table) if (v < lim) return pts; return table.length ? table[table.length - 1][2] ?? 0 : 0; };

// ---------- Arazi (yükseklik ızgarası) ----------
// Izgara: fine = 7x7 noktadan 100 m aralıklı, coarse = 5x5 noktadan 1000 m aralıklı.
export const GRID = { fineN: 7, fineStep: 100, coarseN: 5, coarseStep: 1000 };

export function gridPoints(lat, lon) {
  const mLat = 1 / 111320, mLon = 1 / (111320 * Math.cos(toRad(lat)));
  const pts = [];
  const add = (n, s) => {
    const h = (n - 1) / 2;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
      pts.push([+(lat + (h - i) * s * mLat).toFixed(5), +(lon + (j - h) * s * mLon).toFixed(5)]);
  };
  add(GRID.fineN, GRID.fineStep);
  add(GRID.coarseN, GRID.coarseStep);
  return pts;
}

export function terrainStats(elev) {
  const { fineN: n, fineStep: s, coarseN: m } = GRID;
  if (!elev || elev.length < n * n + m * m || elev.some((v) => v == null || Number.isNaN(v))) return null;
  const z = (i, j) => elev[i * n + j];
  const slopes = [];
  for (let i = 1; i < n - 1; i++) for (let j = 1; j < n - 1; j++) {
    const dzdx = (z(i, j + 1) - z(i, j - 1)) / (2 * s);
    const dzdy = (z(i - 1, j) - z(i + 1, j)) / (2 * s);
    slopes.push({ i, j, deg: (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI });
  }
  const c = (n - 1) / 2;
  const core = slopes.filter((p) => Math.abs(p.i - c) <= 1 && Math.abs(p.j - c) <= 1).map((p) => p.deg);
  const all = slopes.map((p) => p.deg);
  const coarse = elev.slice(n * n, n * n + m * m);
  const cc = (m * m - 1) / 2;
  const ring = coarse.filter((_, k) => k !== cc);
  const ringMean = ring.reduce((a, b) => a + b, 0) / ring.length;
  const fine = elev.slice(0, n * n);
  return {
    elevation: z(c, c),
    siteSlope: core.reduce((a, b) => a + b, 0) / core.length,
    maxSlope: Math.max(...all),
    steepFraction: all.filter((d) => d >= 28 && d <= 50).length / all.length,
    relElevation: z(c, c) - ringMean, // negatif: çevresine göre çukurda/vadi tabanında
    localRelief: Math.max(...fine) - Math.min(...fine),
    areaRelief: Math.max(...coarse) - Math.min(...coarse),
  };
}

// ---------- İklim (günlük yağış / kar) ----------
export function climateStats(daily) {
  if (!daily || !daily.time || !daily.time.length) return null;
  const pr = daily.precipitation_sum || [], sn = daily.snowfall_sum || [];
  const years = daily.time.length / 365.25;
  let sumP = 0, maxP = 0, heavy = 0, sumS = 0, maxS = 0, nP = 0, nS = 0;
  for (const v of pr) if (v != null) { nP++; sumP += v; if (v > maxP) maxP = v; if (v >= 50) heavy++; }
  for (const v of sn) if (v != null) { nS++; sumS += v; if (v > maxS) maxS = v; }
  if (!nP) return null;
  return {
    years: Math.round(years),
    annualPrecip: sumP / years,
    maxDailyPrecip: maxP,
    heavyDaysPerYear: heavy / years,
    annualSnowCm: nS ? sumS / years : 0,
    maxDailySnowCm: maxS,
  };
}

// ---------- Deprem ----------
// Artçı ve öncü sarsıntıları ayıklar: daha büyük bir depremin 50 km ve 1 yıl yakınındaki
// küçük depremler ayrı olay sayılmaz (basit kümeleme). Böylece tek bir büyük deprem dizisi
// sıklığı ve olasılığı şişirmez.
export function decluster(events) {
  const kept = [];
  for (const e of [...events].sort((a, b) => b.mag - a.mag)) {
    const dup = kept.some((k) => Math.abs(k.time - e.time) < 365 * 864e5 && haversineKm(k.lat, k.lon, e.lat, e.lon) < 50);
    if (!dup) kept.push(e);
  }
  return kept;
}
// Uzaklıkla azalan etki: 20 km'den sonra her 10 kat uzaklıkta 1,5 büyüklük birimi düşer.
export function effectiveMag(e) { return e.mag - 1.5 * Math.log10(Math.max(e.distKm, 20) / 20); }

export function quakeStats(events, nowMs = Date.now()) {
  // events: [{mag, time(ms), lat, lon, depth, place, distKm}]
  const yrs = (fromYear) => (nowMs - Date.UTC(fromYear, 0, 1)) / (365.25 * 864e5);
  const main = decluster(events);
  const e100 = main.filter((e) => e.distKm <= 100);
  const n45modern = e100.filter((e) => e.mag >= 4.5 && e.time >= Date.UTC(1973, 0, 1)).length;
  const n6hist = e100.filter((e) => e.mag >= 6).length;
  const n5 = e100.filter((e) => e.mag >= 5).length;
  const lamHist = n6hist / yrs(1900);
  const lamGR = (n45modern / yrs(1973)) * Math.pow(10, -1.0 * (6 - 4.5)); // Gutenberg–Richter, b≈1
  const lam6 = n45modern >= 10 ? (lamHist + lamGR) / 2 : lamHist;
  const lam7 = lam6 * 0.1;
  const p = (lam, y) => 1 - Math.exp(-lam * y);
  const sorted = [...events].sort((a, b) => b.mag - a.mag);
  const maxMag = sorted.length ? sorted[0].mag : null;
  let felt = null;
  for (const e of events) { const m = effectiveMag(e); if (!felt || m > felt.m) felt = { m, mag: e.mag, d: e.distKm }; }
  const max50 = events.filter((e) => e.distKm <= 50).reduce((m, e) => Math.max(m, e.mag), 0) || null;
  return {
    count: events.length, count100: e100.length, n5, n6: n6hist, n45modern, maxMag, max50, felt,
    strongest: sorted.slice(0, 6),
    lastSignificant: [...e100].filter((e) => e.mag >= 5).sort((a, b) => b.time - a.time)[0] || null,
    p6_50y: p(lam6, 50), p6_10y: p(lam6, 10), p7_50y: p(lam7, 50),
  };
}

export function nearestFault(lat, lon, faults) {
  let best = null;
  const seen = new Set();
  for (const f of faults) {
    if (seen.has(f[0])) continue;
    seen.add(f[0]);
    const d = distToPolylineKm(lat, lon, f[4]);
    if (!best || d < best.distKm) best = { id: f[0], name: f[1], slipType: f[2], slipRate: f[3], coords: f[4], distKm: d };
  }
  // 30 km içindeki faylar (harita ve ek bilgi için)
  const near = [];
  seen.clear();
  for (const f of faults) {
    if (seen.has(f[0])) continue;
    seen.add(f[0]);
    const d = distToPolylineKm(lat, lon, f[4]);
    if (d <= 30) near.push({ id: f[0], name: f[1], slipType: f[2], slipRate: f[3], coords: f[4], distKm: d });
  }
  near.sort((a, b) => a.distKm - b.distKm);
  return best ? { ...best, nearby: near } : { distKm: null, nearby: [] };
}

export function scoreEarthquake({ fault, quakes }) {
  const factors = [];
  let s = 0, inputs = 0;
  if (fault) {
    inputs++;
    const d = fault.distKm;
    let pts = d == null ? 0 : step(d, [[2, 40], [5, 36], [10, 32], [20, 27], [35, 18], [60, 10], [100, 4], [Infinity, 0]]);
    const r = fault.slipRate;
    // Yavaş kayan faylar büyük depremi çok daha seyrek üretir.
    const mult = r == null ? 0.7 : r >= 5 ? 1 : r >= 1 ? 0.8 : r >= 0.2 ? 0.6 : 0.45;
    pts = Math.round(pts * mult);
    s += pts;
    factors.push({ k: 'eq.fault', v: { d, name: fault.name, rate: r, type: fault.slipType }, pts });
  }
  if (quakes) {
    inputs++;
    const fm = quakes.felt ? quakes.felt.m : 0;
    const hist = step(fm, [[5, 0], [5.5, 4], [6, 8], [6.5, 13], [7, 18], [Infinity, 24]]);
    s += hist;
    factors.push({ k: 'eq.maxmag', v: { m: quakes.felt?.mag ?? null, d: quakes.felt?.d ?? null, eff: quakes.felt?.m ?? null }, pts: hist });
    const freq = Math.min(12, quakes.n5);
    s += freq;
    factors.push({ k: 'eq.count5', v: { n: quakes.n5 }, pts: freq });
    const prob = Math.round(16 * quakes.p6_50y);
    s += prob;
    factors.push({ k: 'eq.prob', v: { p: quakes.p6_50y }, pts: prob });
  }
  if (!inputs) return null;
  return { score: clamp(Math.round(s)), factors, confidence: inputs === 2 ? 'high' : 'medium' };
}

export function scoreFlood({ terrain, water, climate }) {
  const factors = [];
  let s = 0, inputs = 0;
  const near = water && water.riverDistM != null ? water.riverDistM : Infinity;
  if (water) {
    inputs++;
    const d = water.riverDistM;
    const base = d == null ? 0 : step(d, [[100, 30], [300, 22], [700, 12], [1500, 5], [Infinity, 0]]);
    // Nehir tam etki; kanal ve göl/baraj gölü daha yavaş yükselir; küçük dere yalnızca çok yakınsa sayılır.
    const k = water.riverKind;
    const mult = k === 'river' ? 1 : k === 'stream' ? 0.5 : 0.7;
    const pts = Math.round(base * mult);
    s += pts;
    factors.push({ k: 'fl.river', v: { d, name: water.riverName, kind: k }, pts });
    if (water.coastDistM != null && water.coastDistM < 1000 && terrain && terrain.elevation < 6) {
      s += 15;
      factors.push({ k: 'fl.coast', v: { d: water.coastDistM, e: terrain.elevation }, pts: 15 });
    }
  }
  if (terrain) {
    inputs++;
    const re = terrain.relElevation;
    let pts = step(re, [[-15, 18], [-5, 10], [5, 4], [Infinity, 0]]);
    if (near > 1500) pts = Math.round(pts / 2); // yakında akarsu yoksa çukurda olmak daha az etkilidir
    s += pts;
    factors.push({ k: 'fl.relelev', v: { re }, pts });
    const flat = terrain.siteSlope < 2 && near <= 700 ? 6 : 0;
    s += flat;
    factors.push({ k: 'fl.flat', v: { sl: terrain.siteSlope }, pts: flat });
  }
  if (climate) {
    inputs++;
    const pts = step(climate.maxDailyPrecip, [[50, 0], [70, 4], [100, 8], [150, 12], [Infinity, 15]]);
    s += pts;
    factors.push({ k: 'fl.rain', v: { mx: climate.maxDailyPrecip, y: climate.years, hd: climate.heavyDaysPerYear }, pts });
  }
  if (!inputs) return null;
  return { score: clamp(Math.round(s)), factors, confidence: inputs === 3 ? 'high' : inputs === 2 ? 'medium' : 'low' };
}

export function scoreLandslide({ terrain, climate, eqScore }) {
  const factors = [];
  if (!terrain) return null;
  let s = 0;
  const sl = terrain.siteSlope;
  const pSlope = step(sl, [[5, 0], [8, 4], [15, 9], [25, 20], [35, 32], [Infinity, 42]]);
  s += pSlope;
  factors.push({ k: 'ls.slope', v: { sl, mx: terrain.maxSlope }, pts: pSlope });
  const pRelief = step(terrain.areaRelief, [[50, 0], [150, 3], [400, 6], [Infinity, 10]]);
  s += pRelief;
  factors.push({ k: 'ls.relief', v: { r: terrain.areaRelief }, pts: pRelief });
  if (climate) {
    const pr = step(climate.annualPrecip, [[600, 0], [1000, 4], [1500, 8], [Infinity, 12]]) +
      (climate.maxDailyPrecip >= 100 ? 6 : 0);
    s += pr;
    factors.push({ k: 'ls.rain', v: { a: climate.annualPrecip, mx: climate.maxDailyPrecip }, pts: pr });
  }
  if (eqScore != null) {
    // Deprem kaynaklı heyelan yalnızca eğimli arazide anlamlıdır.
    const pe = sl < 10 ? 0 : eqScore >= 60 ? 8 : eqScore >= 40 ? 4 : 0;
    s += pe;
    factors.push({ k: 'ls.seismic', v: { e: eqScore }, pts: pe });
  }
  // Düz alanlarda heyelan olasılığı çok düşüktür; komşu yamaçlardan gelen etkiyi küçük tutar.
  if (sl < 5 && terrain.maxSlope < 15) s = Math.min(s, 10);
  return { score: clamp(Math.round(s)), factors, confidence: climate ? 'high' : 'medium' };
}

export function scoreAvalanche({ terrain, climate }) {
  if (!terrain) return null;
  const factors = [];
  const snow = climate ? climate.annualSnowCm : null;
  const e = terrain.elevation;
  const pSnow = snow == null ? 0 : step(snow, [[20, 0], [60, 8], [150, 15], [300, 25], [Infinity, 35]]);
  const pSteep = Math.round(40 * Math.min(1, terrain.steepFraction / 0.5));
  const pElev = step(e, [[600, 0], [1000, 5], [1500, 10], [Infinity, 15]]);
  factors.push({ k: 'av.snow', v: { s: snow }, pts: pSnow });
  factors.push({ k: 'av.steep', v: { f: terrain.steepFraction, mx: terrain.maxSlope }, pts: pSteep });
  factors.push({ k: 'av.elev', v: { e }, pts: pElev });
  let s = pSnow + pSteep + pElev;
  // Kar yağışı yoksa veya alçak ve az eğimli ise çığ tehlikesi pratikte yoktur.
  if ((snow != null && snow < 10) || (e < 400 && terrain.maxSlope < 25) || terrain.maxSlope < 20) s = Math.min(s, 5);
  return { score: clamp(Math.round(s)), factors, confidence: climate ? 'high' : 'low' };
}

// Konum güvenlik puanı: en yüksek tehlike belirleyicidir, ikinci tehlike ve genel ortalama ek etki yapar.
export function overall(scores) {
  const v = Object.values(scores).filter((x) => x && x.score != null).map((x) => x.score).sort((a, b) => b - a);
  if (!v.length) return null;
  const mx = v[0], second = v[1] ?? 0, mean = v.reduce((a, b) => a + b, 0) / v.length;
  const risk = 0.55 * mx + 0.2 * second + 0.25 * mean;
  return clamp(Math.round(100 - risk));
}

// Overpass yanıtından en yakın akarsu / su kütlesi ve kıyı çizgisi mesafesi (m).
// Kapalı alanın yaklaşık yüzölçümü (m²), yerel düzlem yaklaşımıyla.
function areaM2(geom) {
  if (!geom || geom.length < 3) return 0;
  const lat0 = geom[0].lat, kx = 111320 * Math.cos(toRad(lat0)), ky = 110574;
  let a = 0;
  for (let i = 0; i < geom.length; i++) {
    const p = geom[i], q = geom[(i + 1) % geom.length];
    a += (p.lon * kx) * (q.lat * ky) - (q.lon * kx) * (p.lat * ky);
  }
  return Math.abs(a) / 2;
}
const BIG_WATER = new Set(['lake', 'reservoir', 'river', 'oxbow', 'lagoon', 'canal']);
export function waterStats(lat, lon, elements) {
  if (!elements) return null;
  let river = null, coast = null;
  for (const el of elements) {
    // Büyük göller çoğu zaman çok parçalı "relation" olarak kayıtlıdır: parçaların geometrisi birleştirilir.
    const geoms = el.geometry ? [el.geometry] : (el.members || []).map((m) => m.geometry).filter(Boolean);
    if (!geoms.length) continue;
    let d = Infinity;
    for (const gm of geoms) {
      const flat = [];
      for (const g of gm) flat.push(g.lon, g.lat);
      d = Math.min(d, distToPolylineKm(lat, lon, flat) * 1000);
    }
    const t = el.tags || {};
    if (t.natural === 'coastline') { if (!coast || d < coast.d) coast = { d }; continue; }
    let kind;
    if (t.waterway) {
      kind = t.waterway;
      if (kind === 'stream' && d > 150) continue; // küçük dereler yalnızca çok yakınsa sayılır
    } else if (t.natural === 'water') {
      // Havuz, gölet, süs havuzu gibi küçük su alanları taşkın kaynağı sayılmaz (5 hektardan küçük).
      const big = BIG_WATER.has(t.water) || (el.type === 'relation' ? !t.water : areaM2(el.geometry) >= 50000);
      if (!big || ['pond', 'basin', 'reflecting_pool', 'wastewater', 'fountain'].includes(t.water)) continue;
      kind = t.water === 'river' ? 'river' : t.water === 'reservoir' ? 'reservoir' : 'lake';
    } else continue;
    if (!river || d < river.d) river = { d, name: t.name || null, kind };
  }
  return { riverDistM: river ? Math.round(river.d) : null, riverName: river?.name ?? null, riverKind: river?.kind ?? null, coastDistM: coast ? Math.round(coast.d) : null };
}
