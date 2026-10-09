import { T, fmt } from './i18n.js';
import * as api from './api.js';
import {
  terrainStats, climateStats, quakeStats, nearestFault, waterStats,
  scoreEarthquake, scoreFlood, scoreLandslide, scoreAvalanche, overall, levelOf,
} from './risk.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* yok say */ } },
};

let lang = store.get('lang') || ((navigator.language || 'tr').toLowerCase().startsWith('tr') ? 'tr' : 'en');
const t = () => T[lang];
const HZ = ['eq', 'fl', 'ls', 'av'];
const state = { countries: [], places: [], report: null, view: 'home' };

// ---------- Dil ----------
function get(obj, path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj); }
function applyLang() {
  document.documentElement.lang = lang;
  document.title = t().appName;
  document.querySelectorAll('[data-t]').forEach((el) => { const v = get(t(), el.dataset.t); if (typeof v === 'string') el.textContent = v; });
  document.querySelectorAll('[data-tp]').forEach((el) => { el.placeholder = get(t(), el.dataset.tp); });
  $('#btnLang').textContent = t().lang;
  $('#aboutSources').innerHTML = t().srcList.map((s) => `<li>${esc(s)}</li>`).join('');
  fillCountries(true);
  if (state.report && state.view === 'report') renderReport(state.report);
}

// ---------- Görünümler ----------
function show(v) {
  state.view = v;
  $('#vHome').hidden = v !== 'home';
  $('#vProgress').hidden = v !== 'progress';
  $('#vReport').hidden = v !== 'report';
  $('#btnBack').hidden = v === 'home';
  window.scrollTo(0, 0);
}
window.appBack = () => {
  if (!$('#about').hidden) { $('#about').hidden = true; return true; }
  if (state.view !== 'home') { show('home'); return true; }
  return false;
};

// ---------- Ülke / il / ilçe ----------
function countryName(code, fallback) {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || fallback; } catch (_) { return fallback; }
}
function fillCountries(keep) {
  const sel = $('#selCountry');
  const cur = keep ? sel.value : (store.get('country') || 'TR');
  const list = state.countries.map((c) => ({ code: c[0], name: countryName(c[0], c[1]) }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
  sel.innerHTML = list.map((c) => `<option value="${c.code}">${esc(c.name)}</option>`).join('');
  sel.value = cur || 'TR';
  const optS = $('#selState').options[0]; if (optS && optS.value === '') optS.textContent = t().choose;
  const optC = $('#selCity').options[0]; if (optC && optC.value === '') optC.textContent = t().allCities;
}
async function onCountry() {
  const cc = $('#selCountry').value;
  store.set('country', cc);
  state.places = await api.loadPlaces(cc);
  const s = $('#selState');
  s.innerHTML = `<option value="">${esc(t().choose)}</option>` +
    state.places.map((p, i) => `<option value="${i}">${esc(p[1])}</option>`).join('');
  s.disabled = !state.places.length;
  onState();
}
function onState() {
  const p = state.places[$('#selState').value];
  const c = $('#selCity');
  const cities = p ? p[4] : [];
  c.innerHTML = `<option value="">${esc(t().allCities)}</option>` +
    cities.filter((x) => x[0] !== p[1]).map((x, i) => `<option value="${cities.indexOf(x)}">${esc(x[0])}</option>`).join('');
  c.disabled = !p || !cities.length;
}
function region() {
  const cc = $('#selCountry').value;
  const country = state.countries.find((c) => c[0] === cc);
  const st = state.places[$('#selState').value];
  const city = st && st[4][$('#selCity').value];
  const ctry = countryName(cc, country?.[1]);
  if (city && city[1] != null) return { cc, lat: city[1], lon: city[2], name: city[0], label: [city[0], st[1], ctry].join(', '), level: 'city' };
  if (st && st[2] != null) {
    const same = st[4].find((x) => x[0] === st[1]); // il merkezi şehri varsa onu kullan
    const lat = same ? same[1] : st[2], lon = same ? same[2] : st[3];
    return { cc, lat, lon, name: st[1], label: [st[1], ctry].join(', '), level: 'state', stateName: st[1] };
  }
  if (country) return { cc, lat: country[2], lon: country[3], name: ctry, label: ctry, level: 'country' };
  return { cc };
}
function formMsg(s) { const m = $('#formMsg'); m.hidden = !s; m.textContent = s || ''; }

// ---------- Arama ----------
async function onFind() {
  formMsg('');
  const q = $('#inpPlace').value.trim();
  const r = region();
  if (!q) { onCenter(); return; }
  if (r.lat == null) { formMsg(t().needRegion); return; }
  const box = $('#results'), ul = $('#resultList');
  box.hidden = false;
  ul.innerHTML = `<li class="muted">${esc(t().searching)}</li>`;
  try {
    const ctx = r.level !== 'country' ? `${q}, ${r.name}` : q;
    let res = await api.geocode(ctx, { country: r.cc, lat: r.lat, lon: r.lon, lang });
    if (!res.length && ctx !== q) res = await api.geocode(q, { country: r.cc, lat: r.lat, lon: r.lon, lang });
    if (!res.length) { ul.innerHTML = `<li class="muted">${esc(t().noResults)}</li>`; return; }
    ul.innerHTML = res.map((x, i) => `<li data-i="${i}"><span class="pin">${i + 1}</span><div><b>${esc(x.name)}</b><small>${esc(x.label)}</small></div></li>`).join('');
    ul.querySelectorAll('li[data-i]').forEach((li) => li.addEventListener('click', () => {
      const x = res[+li.dataset.i];
      evaluate({ name: x.name, label: x.label, lat: x.lat, lon: x.lon, cc: r.cc });
    }));
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (_) {
    ul.innerHTML = `<li class="muted">${esc(t().searchErr)}</li>`;
  }
}
function onCenter() {
  formMsg('');
  const r = region();
  if (r.lat == null || r.level === 'country') { formMsg(t().needRegion); return; }
  evaluate({ name: r.name, label: r.label, lat: r.lat, lon: r.lon, cc: r.cc });
}

// ---------- Değerlendirme ----------
async function evaluate(place) {
  show('progress');
  $('#progPlace').textContent = place.label;
  const keys = ['faults', 'quakes', 'terrain', 'climate', 'water', 'crime'];
  $('#stepList').innerHTML = keys.map((k) => `<li id="st-${k}" class="run">${esc(t().steps[k])}</li>`).join('');
  const mark = (k, ok) => {
    const li = $('#st-' + k);
    if (!li) return;
    li.className = ok ? 'ok' : 'fail';
    if (!ok) li.textContent = `${t().steps[k]} — ${t().stepFail}`;
  };
  const run = (k, fn) => fn().then((v) => { mark(k, true); return v; }, (e) => { console.warn(k, e); mark(k, false); return null; });
  const { lat, lon } = place;
  const [faults, quakes, elev, daily, water, crime] = await Promise.all([
    run('faults', () => api.faultsAround(lat, lon)),
    run('quakes', () => api.earthquakes(lat, lon, 150)),
    run('terrain', () => api.elevationGrid(lat, lon)),
    run('climate', () => api.climateHistory(lat, lon)),
    run('water', () => api.waterways(lat, lon)),
    run('crime', () => loadCrime(place.cc)),
  ]);
  const data = {
    place,
    fault: faults ? nearestFault(lat, lon, faults) : null,
    quakes: quakes ? quakeStats(quakes) : null,
    terrain: elev ? terrainStats(elev) : null,
    climate: daily ? climateStats(daily) : null,
    water: water ? waterStats(lat, lon, water) : null,
    crime,
    failed: [!quakes && 'quakes', !elev && 'terrain', !daily && 'climate', !water && 'water'].filter(Boolean),
    date: Date.now(),
  };
  if (data.failed.length === 4) {
    $('#vReport').innerHTML = `<div class="card center"><p>${esc(t().allFailed)}</p><button class="btn primary" id="btnRetry">${esc(t().retry)}</button></div>`;
    show('report');
    $('#btnRetry').onclick = () => evaluate(place);
    return;
  }
  const eq = scoreEarthquake({ fault: data.fault, quakes: data.quakes });
  data.scores = {
    eq,
    fl: scoreFlood({ terrain: data.terrain, water: data.water, climate: data.climate }),
    ls: scoreLandslide({ terrain: data.terrain, climate: data.climate, eqScore: eq?.score }),
    av: scoreAvalanche({ terrain: data.terrain, climate: data.climate }),
  };
  data.safety = overall(data.scores);
  state.report = data;
  renderReport(data);
  show('report');
}

// ---------- Suç (ülke geneli) ----------
async function loadCrime(cc) {
  const en = state.countries.find((c) => c[0] === cc)?.[1];
  const [stats, advice] = await Promise.allSettled([api.crimeIndicator(cc), en ? api.travelAdvice(en) : Promise.resolve(null)]);
  const out = { stats: stats.status === 'fulfilled' ? stats.value : null, advice: advice.status === 'fulfilled' ? advice.value : null };
  if (!out.stats && !out.advice) throw new Error('crime data unavailable');
  return out;
}
function crimeLevel(st) {
  if (!st || !st.world) return 0;
  const r = st.country.value / st.world.value;
  return r < 0.5 ? 1 : r < 1 ? 2 : r < 2 ? 3 : r < 4 ? 4 : 5;
}
function crimeCard(c) {
  const L = t();
  const st = c?.stats, adv = c?.advice;
  const lv = crimeLevel(st);
  const statHtml = st ? `
    ${lv ? `<div class="hz-top" style="margin-top:.6rem"><span class="small muted" style="flex:1">${esc(L.crimeRatio(st.country.value / st.world.value, lang))}</span><span class="badge">${esc(L.lv[lv])}</span></div>` : ''}
    <ul class="factors">
      <li><span>${esc(L.crimeHom(st.country.value, st.country.year, lang))}</span></li>
      ${st.world ? `<li><span>${esc(L.crimeWorld(st.world.value, st.world.year, lang))}</span></li>` : ''}
    </ul>
    ${lv ? `<p class="small muted">${esc(L.crimeLvNote)}</p>` : ''}` : `<p class="small muted">${esc(L.crimeFail)}</p>`;
  const advBody = adv && adv.blocks.length ? adv.blocks.map((b) => b.h ? `<h4>${esc(b.h)}</h4>` : b.li ? `<ul>${b.li.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p>${esc(b.p)}</p>`).join('') : '';
  const advHtml = advBody ? `
    <h3>${esc(L.adviceTitle)}</h3>
    ${L.adviceLang ? `<p class="small muted">${esc(L.adviceLang)}</p>` : ''}
    <details><summary>${esc(L.adviceShow)}</summary><div class="advice" lang="en">${advBody}</div></details>
    <p class="small muted">${adv.updated ? `${esc(L.adviceUpdated)}: ${esc(L.when(adv.updated, lang))} · ` : ''}<a href="${esc(adv.url)}" target="_blank" rel="noopener">${esc(L.adviceMore)}</a></p>`
    : `<p class="small muted">${esc(L.adviceNone)}</p>`;
  return `<div class="card lv${lv}" style="margin-top:14px">
    <div class="hz-top"><i class="hz-ic cr"></i><h3>${esc(L.crimeTitle)}</h3></div>
    <p class="small muted" style="margin:.3rem 0 0">${esc(L.crimeScope)}</p>
    ${statHtml}
    ${advHtml}
    <p class="note">${esc(L.crimeNoLocal)}</p>
  </div>`;
}

// ---------- Rapor ----------
function summaryText(d) {
  const L = t(), s = L.sum, out = [];
  const ranked = HZ.filter((h) => d.scores[h]).sort((a, b) => d.scores[b].score - d.scores[a].score);
  const top = ranked[0];
  const topLv = top ? levelOf(d.scores[top].score) : 1;
  out.push(s.intro(d.place.name) + ' ' + (topLv >= 3 ? s.top(L.hz[top], L.lv[topLv]) : s.allLow));
  if (d.fault && d.fault.distKm != null && d.fault.distKm <= 50) out.push(s.eqFault(d.fault.distKm, lang));
  if (d.quakes && d.quakes.maxMag >= 5) out.push(s.eqHist(d.quakes.maxMag, lang));
  if (d.water && d.water.riverDistM != null && d.water.riverDistM <= 700) out.push(s.flRiver(d.water.riverDistM, lang));
  if (d.scores.av && d.scores.av.score <= 5) out.push(s.avNone);
  if (d.failed.length) out.push(s.partial);
  return out;
}

function tipsFor(d) {
  const L = t(), tips = [];
  const lv = (h) => (d.scores[h] ? levelOf(d.scores[h].score) : 0);
  if (lv('eq') >= 2) { tips.push(...L.tip.eq); tips.push(L.tip.eqBuild); if (d.place.cc === 'TR') tips.push(L.tip.eqTR); }
  if (lv('fl') >= 3) tips.push(...L.tip.fl);
  if (lv('ls') >= 3) tips.push(...L.tip.ls);
  if (lv('av') >= 3) tips.push(...L.tip.av);
  tips.push(...L.tip.cr);
  if (!(lv('eq') >= 2 && d.place.cc === 'TR')) tips.push(L.tip.gen);
  return tips;
}

function hazardCard(h, sc) {
  const L = t();
  if (!sc) return `<div class="card hz-card lv0"><div class="hz-top"><i class="hz-ic ${h}"></i><h3>${esc(L.hz[h])}</h3><span class="badge">${esc(L.noData)}</span></div></div>`;
  const lv = levelOf(sc.score);
  const facs = sc.factors.map((f) => `<li><span>${esc(L.f[f.k](f.v, lang))}</span><b>${f.pts ? L.pts(f.pts) : '0'}</b></li>`).join('');
  return `<div class="card hz-card lv${lv}">
    <div class="hz-top"><i class="hz-ic ${h}"></i><h3>${esc(L.hz[h])}</h3><span class="badge">${esc(L.lv[lv])}</span></div>
    <div class="bar"><i style="left:${sc.score}%"></i></div>
    <div class="bar-meta"><span>${sc.score}/100</span><span>${esc(L.conf[sc.confidence])}</span></div>
    <details><summary>${esc(L.factors)}</summary><ul class="factors">${facs}</ul></details>
  </div>`;
}

function magLevel(m) { return m >= 7 ? 5 : m >= 6 ? 4 : m >= 5.5 ? 3 : m >= 5 ? 2 : 1; }

function renderReport(d) {
  const L = t();
  const safeLv = d.safety == null ? 0 : 6 - levelOf(d.safety);
  const q = d.quakes;
  const quakeHtml = !q ? '' : `
    <div class="card">
      <h3 style="margin-top:0">${esc(L.quakesTitle)}</h3>
      ${q.strongest.length ? `<ul class="qlist">${q.strongest.map((e) => `
        <li class="lv${magLevel(e.mag)}"><span class="mag">${fmt.n1(e.mag, lang)}</span>
          <div><b>${esc(L.when(e.time, lang))}</b><small>${esc(e.place || '')}</small>
          <small>${esc(L.ago)}: ${fmt.km(e.distKm, lang)} · ${esc(L.depth)}: ${e.depth != null ? fmt.n0(e.depth, lang) + ' km' : '—'}</small></div></li>`).join('')}</ul>`
        : `<p class="muted">${esc(L.quakesNone)}</p>`}
      <h3>${esc(L.expected)}</h3>
      <p class="note">${esc(L.expectedNote)}</p>
      <div class="probs">
        ${[['p6_10', q.p6_10y], ['p6_50', q.p6_50y], ['p7_50', q.p7_50y]].map(([k, p]) => `
          <div><div class="prob"><span>${esc(L[k])}</span><b>${fmt.pct(p, lang)}</b></div><div class="pbar"><i style="width:${Math.round(p * 100)}%"></i></div></div>`).join('')}
      </div>
    </div>`;

  $('#vReport').innerHTML = `
    <div class="card">
      <div class="r-head">
        <div class="ring lv${safeLv}" style="--v:${d.safety ?? 0}"><div><span><b>${d.safety ?? '—'}</b><br><small>/ 100</small></span></div></div>
        <div class="r-place">
          <small>${esc(L.safety)}</small>
          <b>${esc(d.place.name)}</b>
          <small>${esc(d.place.label)}</small>
          <div class="kv"><span>${esc(L.coords)}: ${d.place.lat.toFixed(4)}, ${d.place.lon.toFixed(4)}</span>
          ${d.terrain ? `<span>${esc(L.elevation)}: ${fmt.n0(d.terrain.elevation, lang)} m</span>` : ''}</div>
        </div>
      </div>
      <p class="small muted" style="margin-top:.7rem">${esc(L.safetyNote)}</p>
    </div>
    <div class="card"><h3 style="margin-top:0">${esc(L.summary)}</h3>${summaryText(d).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
    <div class="hz-grid">${HZ.map((h) => hazardCard(h, d.scores[h])).join('')}</div>
    <div class="card" style="margin-top:14px">
      <h3 style="margin-top:0">${esc(L.map)}</h3>
      <div id="map" class="map"></div>
      <div class="legend"><span><i></i>${esc(L.faultLegend)}</span><span><i class="dot"></i> ${esc(L.selected)}</span></div>
      <div class="actions" style="margin-top:.7rem"><button id="btnOpenMap" class="btn ghost">${esc(L.openMap)}</button></div>
    </div>
    ${quakeHtml}
    ${crimeCard(d.crime)}
    <div class="card"><h3 style="margin-top:0">${esc(L.tips)}</h3><ul class="tips">${tipsFor(d).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="actions"><button id="btnShare" class="btn primary">${esc(L.share)}</button><button id="btnNew" class="btn ghost">${esc(L.newSearch)}</button></div>
    <div class="card" style="margin-top:14px"><h3 style="margin-top:0">${esc(L.sources)}</h3>
      <ul class="small" style="padding-left:1.1rem">${L.srcList.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <p class="small muted">${esc(L.disclaimer)}</p></div>`;

  drawMap($('#map'), d.place.lat, d.place.lon, d.fault?.nearby || [], fitZoom(d.place.lat, d.fault?.nearby?.length ? d.fault.distKm : null));
  $('#btnOpenMap').onclick = () => openMap(d.place);
  $('#btnShare').onclick = () => share(d);
  $('#btnNew').onclick = () => show('home');
}

// ---------- Mini harita (OSM karoları + fay çizgileri) ----------
// En yakın fay haritada görünecek şekilde yakınlaştırma düzeyi seçer.
function fitZoom(lat, distKm) {
  if (distKm == null) return 13;
  const mpp = (Math.max(distKm, 0.3) * 1000) / (0.4 * 230);
  const z = Math.floor(Math.log2((156543.03 * Math.cos((lat * Math.PI) / 180)) / mpp));
  return Math.max(8, Math.min(15, z));
}
function drawMap(el, lat, lon, faults, zoom) {
  let z = zoom, offX = 0, offY = 0;
  const proj = (la, lo, zz) => {
    const n = 256 * 2 ** zz, s = Math.sin((la * Math.PI) / 180);
    return [((lo + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  };
  function render() {
    const W = el.clientWidth || 320, H = el.clientHeight || 230;
    const [cx, cy] = proj(lat, lon, z);
    const ox = cx - W / 2 - offX, oy = cy - H / 2 - offY;
    const max = 2 ** z;
    let html = '';
    for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++)
      for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++) {
        if (ty < 0 || ty >= max) continue;
        const wx = ((tx % max) + max) % max;
        html += `<img alt="" onerror="this.style.visibility='hidden'" src="https://tile.openstreetmap.org/${z}/${wx}/${ty}.png" style="left:${tx * 256 - ox}px;top:${ty * 256 - oy}px">`;
      }
    const lines = faults.map((f) => {
      const pts = [];
      for (let i = 0; i + 1 < f.coords.length; i += 2) { const [x, y] = proj(f.coords[i + 1], f.coords[i], z); pts.push(`${(x - ox).toFixed(1)},${(y - oy).toFixed(1)}`); }
      return `<polyline points="${pts.join(' ')}" fill="none" stroke="#c0392b" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>`;
    }).join('');
    const mx = cx - ox, my = cy - oy;
    html += `<svg>${lines}<circle cx="${mx}" cy="${my}" r="16" fill="#1a6a7d" opacity=".18"/><circle cx="${mx}" cy="${my}" r="7" fill="#1a6a7d" stroke="#fff" stroke-width="3"/></svg>`;
    html += `<div class="zoom"><button data-z="1">+</button><button data-z="-1">−</button></div><div class="attr">© OpenStreetMap</div>`;
    el.innerHTML = html;
    el.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const nz = Math.max(5, Math.min(17, z + +b.dataset.z));
      const f = 2 ** (nz - z); offX *= f; offY *= f; z = nz; render();
    }));
  }
  let drag = null;
  el.onpointerdown = (e) => { if (e.target.closest('.zoom')) return; drag = { x: e.clientX, y: e.clientY, ox: offX, oy: offY }; el.setPointerCapture?.(e.pointerId); };
  el.onpointermove = (e) => { if (!drag) return; offX = drag.ox + e.clientX - drag.x; offY = drag.oy + e.clientY - drag.y; render(); };
  el.onpointerup = el.onpointercancel = () => { drag = null; };
  render();
}

// ---------- Paylaş / harita ----------
function openMap(p) {
  if (window.Android?.openMap) window.Android.openMap(p.lat, p.lon, p.name);
  else window.open(`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=15/${p.lat}/${p.lon}`, '_blank');
}
function share(d) {
  const L = t();
  const lines = [`${L.shareHead} — ${d.place.name}`, d.place.label, '', `${L.safety}: ${d.safety}/100`];
  for (const h of HZ) {
    const sc = d.scores[h];
    lines.push(`• ${L.hz[h]}: ${sc ? `${L.lv[levelOf(sc.score)]} (${sc.score}/100)` : L.noData}`);
  }
  const st = d.crime?.stats;
  if (st) lines.push(`• ${L.crimeTitle}: ${L.crimeHom(st.country.value, st.country.year, lang)} — ${L.crimeScope}`);
  lines.push('', ...summaryText(d), '', L.disclaimer);
  const text = lines.join('\n');
  if (window.Android?.share) window.Android.share(text);
  else if (navigator.share) navigator.share({ text }).catch(() => {});
  else navigator.clipboard?.writeText(text);
}

// ---------- Başlat ----------
async function init() {
  $('#btnLang').onclick = () => { lang = lang === 'tr' ? 'en' : 'tr'; store.set('lang', lang); applyLang(); };
  $('#btnAbout').onclick = () => { $('#about').hidden = false; };
  $('#btnCloseAbout').onclick = () => { $('#about').hidden = true; };
  $('#about').onclick = (e) => { if (e.target.id === 'about') $('#about').hidden = true; };
  $('#btnBack').onclick = () => window.appBack();
  $('#selCountry').onchange = onCountry;
  $('#selState').onchange = onState;
  $('#btnFind').onclick = onFind;
  $('#btnCenter').onclick = onCenter;
  $('#inpPlace').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onFind(); } });
  state.countries = await api.loadCountries();
  applyLang();
  await onCountry();
  show('home');
}
init();
