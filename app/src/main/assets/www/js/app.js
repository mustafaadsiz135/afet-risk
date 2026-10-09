import { T, fmt, langName } from './i18n.js';
import { scoreCrime, scoreLocalCrime, scoreTransport, languageInfo, transportLevel } from './guide.js';
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
const state = { countries: [], places: [], report: null, view: 'home', tab: 'risk', info: {} };

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
  renderHistory();
  if (state.report && state.view === 'report') renderReport(state.report);
  if (state.view === 'compare') renderCompare();
}

// ---------- Görünümler ----------
function show(v) {
  state.view = v;
  $('#vHome').hidden = v !== 'home';
  $('#vProgress').hidden = v !== 'progress';
  $('#vReport').hidden = v !== 'report';
  $('#vCompare').hidden = v !== 'compare';
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
  const cur = (keep && sel.value) || store.get('country') || 'TR';
  const list = state.countries.map((c) => ({ code: c[0], name: countryName(c[0], c[1]) }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
  sel.innerHTML = list.map((c) => `<option value="${c.code}">${esc(c.name)}</option>`).join('');
  sel.value = cur || 'TR';
  const optS = $('#selState').options[0]; if (optS && optS.value === '') optS.textContent = t().choose;
  const optC = $('#selCity').options[0]; if (optC && optC.value === '') optC.textContent = t().allCities;
}
async function onCountry() {
  const cc = $('#selCountry').value;
  if (!restoring) { store.set('country', cc); store.set('stateName', ''); store.set('cityName', ''); }
  state.places = await api.loadPlaces(cc);
  const s = $('#selState');
  s.innerHTML = `<option value="">${esc(t().choose)}</option>` +
    state.places.map((p, i) => `<option value="${i}">${esc(p[1])}</option>`).join('');
  s.disabled = !state.places.length;
  if (restoring && store.get('stateName')) {
    const i = state.places.findIndex((p) => p[1] === store.get('stateName'));
    if (i >= 0) s.value = String(i);
  }
  onState();
}
let restoring = true;
function onState() {
  const p = state.places[$('#selState').value];
  const c = $('#selCity');
  const cities = p ? p[4] : [];
  c.innerHTML = `<option value="">${esc(t().allCities)}</option>` +
    cities.filter((x) => x[0] !== p[1]).map((x, i) => `<option value="${cities.indexOf(x)}">${esc(x[0])}</option>`).join('');
  c.disabled = !p || !cities.length;
  if (restoring && p && store.get('cityName')) {
    const i = cities.findIndex((x) => x[0] === store.get('cityName'));
    if (i >= 0) c.value = String(i);
  }
  if (!restoring) store.set('stateName', p ? p[1] : '');
}
function onCity() {
  const p = state.places[$('#selState').value];
  const city = p && p[4][$('#selCity').value];
  store.set('cityName', city ? city[0] : '');
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
  const hasLocal = !!api.localCrimeSource(place.lat, place.lon, place.cc);
  const keys = ['faults', 'quakes', 'terrain', 'climate', 'water', 'country', ...(hasLocal ? ['local'] : [])];
  $('#stepList').innerHTML = keys.map((k) => `<li id="st-${k}" class="run">${esc(t().steps[k] || t().localStep)}</li>`).join('');
  const mark = (k, ok) => {
    const li = $('#st-' + k);
    if (!li) return;
    li.className = ok ? 'ok' : 'fail';
    if (!ok) li.textContent = `${t().steps[k] || t().localStep} — ${t().stepFail}`;
  };
  const run = (k, fn) => fn().then((v) => { mark(k, true); return v; }, (e) => { console.warn(k, e); mark(k, false); return null; });
  const { lat, lon } = place;
  const [faults, quakes, elev, daily, water, country, localCrime] = await Promise.all([
    run('faults', () => api.faultsAround(lat, lon)),
    run('quakes', () => api.earthquakes(lat, lon, 150)),
    run('terrain', () => api.elevationGrid(lat, lon)),
    run('climate', () => api.climateHistory(lat, lon)),
    run('water', () => api.waterways(lat, lon)),
    run('country', () => loadCountry(place.cc)),
    hasLocal ? run('local', () => api.localCrime(place.lat, place.lon, place.cc)) : Promise.resolve(null),
  ]);
  const data = {
    place,
    fault: faults ? nearestFault(lat, lon, faults) : null,
    quakes: quakes ? quakeStats(quakes) : null,
    terrain: elev ? terrainStats(elev) : null,
    climate: daily ? climateStats(daily) : null,
    water: water ? waterStats(lat, lon, water) : null,
    country,
    localCrime,
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
  computeGuide(data);
  state.report = data;
  state.tab = 'risk';
  saveHistory(data);
  renderReport(data);
  show('report');
}

// ---------- Ülke rehberi (suç, sağlık, ulaşım, finans, dil) ----------
async function loadCountry(cc) {
  const en = state.countries.find((c) => c[0] === cc)?.[1];
  const [stats, advice] = await Promise.allSettled([api.countryStats(cc), en ? api.travelAdvice(en) : Promise.resolve(null)]);
  const out = { stats: stats.status === 'fulfilled' ? stats.value : null, advice: advice.status === 'fulfilled' ? advice.value : null };
  if (!out.stats && !out.advice) throw new Error('country data unavailable');
  // Resmi metinden yalnızca ilgili bölümler saklanır (düz metin).
  const P = out.advice?.parts || {};
  out.text = out.advice ? {
    crime: api.extractSection(P['safety-and-security'], /^\s*crime\s*$/i),
    transport: api.extractSection(P['safety-and-security'], /transport risks/i),
  } : null;
  if (out.advice) { out.base = out.advice.base; out.updated = out.advice.updated; delete out.advice; }
  return out;
}
function computeGuide(d) {
  const c = d.country, st = c?.stats || null, info = state.info[d.place.cc];
  d.guide = {
    cr: scoreLocalCrime(d.localCrime) || scoreCrime(st, !!c?.text?.crime?.blocks.length),
    crCountry: scoreCrime(st, !!c?.text?.crime?.blocks.length),
    tr: scoreTransport(st, d.place.cc),
    la: languageInfo(info),
  };
}
function blocksHtml(bl) {
  return bl.map((b) => b.h ? `<h4>${esc(b.h)}</h4>` : b.li ? `<ul>${b.li.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p>${esc(b.p)}</p>`).join('');
}
function officialHtml(d, sections, title) {
  const L = t(), c = d.country;
  const bl = sections.flatMap((x) => x?.blocks || []);
  if (!bl.length) return c?.base ? '' : `<p class="small muted">${esc(L.adviceNone)}</p>`;
  return `<h3>${esc(title || L.officialTitle)}</h3>
    ${L.adviceLang ? `<p class="small muted">${esc(L.adviceLang)}</p>` : ''}
    <details><summary>${esc(L.adviceShow)}</summary><div class="advice" lang="en">${blocksHtml(bl)}</div></details>
    <p class="small muted">${c.updated ? `${esc(L.adviceUpdated)}: ${esc(L.when(c.updated, lang))} · ` : ''}<a href="${esc(c.base)}" target="_blank" rel="noopener">${esc(L.adviceMore)}</a></p>`;
}
function scoreCard(key, icon, sc, extra = '', opts = {}) {
  const L = t(), C = L.cat[key];
  const lvInfo = sc && sc.score != null ? (opts.levelFn ? opts.levelFn(sc.score) : { lv: levelOf(sc.score), label: L.lv[levelOf(sc.score)] }) : null;
  const lv = lvInfo ? lvInfo.lv : 0;
  const facs = (sc?.factors || []).map((f) => `<li><span>${esc(L.f[f.k](f.v, lang))}</span>${f.pts != null ? `<b>${f.pts ? L.pts(f.pts) : '0'}</b>` : ''}</li>`).join('');
  const head = `<div class="hz-top"><i class="hz-ic ${icon}"></i><h3>${esc(C.t)}</h3>${lv ? `<span class="badge">${esc(lvInfo.label)}</span>` : ''}</div>`;
  const bar = lv ? `<div class="bar${opts.levelFn ? ' three' : ''}"><i style="left:${sc.score}%"></i></div>
    <div class="bar-meta"><span>${sc.score}/100${C.m ? ' · ' + esc(C.m) : ''}</span><span>${esc(L.conf[sc.confidence])}</span></div>`
    : (opts.noScoreText !== false ? `<p class="small muted" style="margin:.5rem 0 0">${esc(opts.noScoreText || L.noScore)}</p>` : '');
  const fac = facs ? `<details${opts.open ? ' open' : ''}><summary>${esc(L.factors)}</summary><ul class="factors">${facs}</ul></details>` : '';
  return `<div class="card hz-card lv${lv}">${head}${opts.scope ? `<p class="small muted" style="margin:.3rem 0 0">${esc(opts.scope)}</p>` : ''}${bar}${fac}${extra}</div>`;
}
function tipList(arr) { return `<h3>${esc(t().tips)}</h3><ul class="tips small">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`; }
function crimeCard(d) {
  const L = t(), x = d.country?.text, g = d.guide;
  if (g.cr?.local) {
    const loc = d.localCrime;
    const cats = loc.categories.slice(0, 8).map((c) => `<li><span>${esc(L.catName[c.k] || titleCase(c.k))}</span><b>${fmt.n0(c.n, lang)}</b></li>`).join('');
    const cc = g.crCountry;
    const ctry = cc ? `<h3>${esc(L.countryInfo)}</h3><ul class="factors">${cc.factors.map((f) => `<li><span>${esc(L.f[f.k](f.v, lang))}</span></li>`).join('')}</ul>` : '';
    const extra = `${cats ? `<h3>${esc(L.localTitle)}</h3><ul class="factors">${cats}</ul>` : ''}
      <p class="note">${esc(L.localNote)}</p>
      <p class="small"><a href="${esc(loc.url)}" target="_blank" rel="noopener">${esc(L.localSource)}</a></p>
      ${ctry}${x?.crime?.blocks?.length ? officialHtml(d, [x.crime]) : ''}${tipList(L.tip.cr)}`;
    return scoreCard('cr', 'cr', g.cr, extra, { scope: L.crimeScopeLocal(loc.source), noScoreText: L.crimeFail, open: true });
  }
  return scoreCard('cr', 'cr', g.cr, `${officialHtml(d, [x?.crime])}<p class="note">${esc(L.crimeNoLocal)}</p>${tipList(L.tip.cr)}`,
    { scope: L.crimeScope, noScoreText: L.crimeFail, open: true });
}
function titleCase(s) { return String(s).toLowerCase().replace(/(^|[\s/-])\p{L}/gu, (m) => m.toUpperCase()); }
function trLevel(score) { const k = transportLevel(score); return { lv: [1, 3, 5][k], label: t().trLv[k] }; }
function guideHtml(d) {
  const L = t(), g = d.guide, x = d.country?.text;
  const cr = crimeCard(d);
  const tr = scoreCard('tr', 'trp', g.tr, `${officialHtml(d, [x?.transport])}${tipList(L.tip.trp)}`, { levelFn: trLevel });
  const la = g.la;
  const names = la.langs.map((l) => langName(l.code, lang, l.name)).join(', ');
  const laCard = `<div class="card hz-card lv0"><div class="hz-top"><i class="hz-ic la"></i><h3>${esc(L.cat.la.t)}</h3></div>
    <ul class="factors">${names ? `<li><span>${esc(L.langOfficial(names))}</span></li>` : ''}<li><span>${esc(L.langEng(la.englishOfficial))}</span></li></ul>
    <p class="note">${esc(L.langNote)}</p>${tipList(L.tip.la)}</div>`;
  return `<p class="small muted" style="margin:0 2px 10px">${esc(L.guideIntro)}</p><div class="hz-grid">${cr}${tr}${laCard}</div>`;
}

// ---------- Kayıtlı değerlendirmeler ----------
const HKEY = 'history';
function loadHistory() { try { return JSON.parse(store.get(HKEY) || '[]'); } catch (_) { return []; } }
function saveHistory(d) {
  let h = loadHistory().filter((e) => !(Math.abs(e.d.place.lat - d.place.lat) < 1e-4 && Math.abs(e.d.place.lon - d.place.lon) < 1e-4));
  h.unshift({ id: Date.now(), d });
  h = h.slice(0, 15);
  while (h.length) {
    try { localStorage.setItem(HKEY, JSON.stringify(h)); break; } catch (_) { h.pop(); }
  }
  renderHistory();
}
const MAX_CMP = 3;
function renderHistory() {
  const box = $('#history');
  if (!box) return;
  const h = loadHistory(), L = t();
  box.hidden = !h.length;
  if (!h.length) return;
  const sel = state.cmpSel || (state.cmpSel = new Set());
  for (const id of [...sel]) if (!h.some((e) => String(e.id) === id)) sel.delete(id);
  const mode = !!state.cmpMode;
  box.innerHTML = `<div class="hist-head"><h3>${esc(L.history)}</h3>
      <div>${h.length >= 2 ? `<button class="link-btn" id="btnCmpMode">${esc(mode ? L.cancel : L.compare)}</button>` : ''}${mode ? '' : `<button class="link-btn" id="btnClearHist">${esc(L.clearAll)}</button>`}</div></div>
    ${mode ? `<p class="small muted" style="margin:.3rem 0 0">${esc(L.cmpHint(MAX_CMP))}</p>` : ''}
    <ul class="results">${h.map((e) => {
      const lv = e.d.safety == null ? 0 : 6 - levelOf(e.d.safety);
      const on = sel.has(String(e.id));
      const right = mode ? `<span class="check ${on ? 'on' : ''}" aria-hidden="true">${on ? '✓' : ''}</span>` : `<button class="x-btn" data-del="${e.id}" aria-label="${esc(L.del)}">×</button>`;
      return `<li data-id="${e.id}" class="lv${lv}${mode && on ? ' picked' : ''}"><span class="chip">${e.d.safety ?? '—'}</span><div style="flex:1"><b>${esc(e.d.place.name)}</b><small>${esc(e.d.place.label)}</small><small>${esc(L.when(e.d.date, lang))}</small></div>${right}</li>`;
    }).join('')}</ul>
    ${mode ? `<button class="btn primary" id="btnDoCmp" style="width:100%;margin-top:.6rem" ${sel.size >= 2 ? '' : 'disabled'}>${esc(L.cmpGo(sel.size))}</button>` : ''}`;
  box.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', (ev) => {
    const id = li.dataset.id;
    if (mode) {
      if (sel.has(id)) sel.delete(id);
      else if (sel.size < MAX_CMP) sel.add(id);
      renderHistory();
      return;
    }
    const del = ev.target.closest('[data-del]');
    const all = loadHistory();
    if (del) {
      store.set(HKEY, JSON.stringify(all.filter((e) => String(e.id) !== del.dataset.del)));
      renderHistory();
      return;
    }
    const e = all.find((x) => String(x.id) === id);
    if (!e) return;
    computeGuide(e.d);
    state.report = e.d; state.report.saved = true; state.tab = 'risk';
    renderReport(e.d);
    show('report');
  }));
  if ($('#btnCmpMode')) $('#btnCmpMode').onclick = () => { state.cmpMode = !mode; if (!state.cmpMode) sel.clear(); renderHistory(); };
  if ($('#btnClearHist')) $('#btnClearHist').onclick = () => { if (confirm(L.confirmClear)) { store.set(HKEY, '[]'); renderHistory(); } };
  if ($('#btnDoCmp')) $('#btnDoCmp').onclick = () => { renderCompare(); show('compare'); };
}

// ---------- Karşılaştırma ----------
function renderCompare() {
  const L = t();
  const ids = [...(state.cmpSel || [])];
  const items = loadHistory().filter((e) => ids.includes(String(e.id))).map((e) => { computeGuide(e.d); return e.d; });
  if (items.length < 2) { show('home'); return; }
  // Her satır: değer, gösterilecek etiket, renk düzeyi; "better" = hangi yön daha iyi.
  const hz = (k) => (d) => { const sc = d.scores?.[k]; return sc ? { v: sc.score, txt: `${L.lv[levelOf(sc.score)]} · ${sc.score}`, lv: levelOf(sc.score) } : null; };
  const rows = [
    { name: L.safety, better: 'high', get: (d) => d.safety == null ? null : { v: d.safety, txt: `${d.safety}/100`, lv: 6 - levelOf(d.safety) }, strong: true },
    { name: L.hz.eq, better: 'low', get: hz('eq') },
    { name: L.hz.fl, better: 'low', get: hz('fl') },
    { name: L.hz.ls, better: 'low', get: hz('ls') },
    { name: L.hz.av, better: 'low', get: hz('av') },
    { name: L.cat.cr.t, better: 'low', get: (d) => { const sc = d.guide?.cr; return sc && sc.score != null ? { v: sc.score, txt: `${L.lv[levelOf(sc.score)]} · ${sc.score}`, lv: levelOf(sc.score), sub: sc.local ? L.cmpLocal : L.cmpCountry } : null; } },
    { name: L.cat.tr.t, better: 'low', get: (d) => { const sc = d.guide?.tr; if (!sc || sc.score == null) return null; const x = trLevel(sc.score); return { v: sc.score, txt: x.label, lv: x.lv }; } },
  ];
  const head = items.map((d) => `<th><b>${esc(d.place.name)}</b><small>${esc(d.place.label)}</small></th>`).join('');
  const body = rows.map((r) => {
    const vals = items.map(r.get);
    const nums = vals.filter(Boolean).map((x) => x.v);
    const best = nums.length >= 2 ? (r.better === 'high' ? Math.max(...nums) : Math.min(...nums)) : null;
    const allSame = nums.length >= 2 && nums.every((n) => n === nums[0]);
    return `<tr${r.strong ? ' class="strong"' : ''}><th scope="row">${esc(r.name)}</th>${vals.map((x) => !x ? `<td class="muted">—</td>` :
      `<td class="lv${x.lv}${best != null && !allSame && x.v === best ? ' best' : ''}"><span class="cell-chip">${esc(x.txt)}</span>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</td>`).join('')}</tr>`;
  }).join('');
  const safest = items.filter((d) => d.safety != null).sort((a, b) => b.safety - a.safety);
  const lead = safest.length >= 2 && safest[0].safety !== safest[1].safety ? L.cmpLead(safest[0].place.name, safest[0].safety, safest[1].safety) : L.cmpTie;
  $('#vCompare').innerHTML = `<div class="card"><h2 style="margin-bottom:.3rem">${esc(L.compareTitle)}</h2><p>${esc(lead)}</p></div>
    <div class="card cmp-wrap"><table class="cmp"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="small muted">${esc(L.cmpNote)}</p>
    <div class="actions"><button id="btnCmpBack" class="btn ghost">${esc(L.back)}</button></div>`;
  $('#btnCmpBack').onclick = () => show('home');
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

  const saved = d.saved ? `<div class="saved-bar"><span>${esc(L.savedOn(L.when(d.date, lang)))}</span><button id="btnRefresh" class="link-btn">${esc(L.refresh)}</button></div>` : '';
  const tabs = `<div class="tabs" role="tablist"><button data-tab="risk" class="${state.tab === 'risk' ? 'on' : ''}">${esc(L.tabRisk)}</button><button data-tab="guide" class="${state.tab === 'guide' ? 'on' : ''}">${esc(L.tabGuide)}</button></div>`;
  const riskTab = `
    <div class="card"><h3 style="margin-top:0">${esc(L.summary)}</h3>${summaryText(d).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
    <div class="hz-grid">${HZ.map((h) => hazardCard(h, d.scores[h])).join('')}</div>
    <div class="card" style="margin-top:14px">
      <h3 style="margin-top:0">${esc(L.map)}</h3>
      <div id="map" class="map"></div>
      <div class="legend"><span><i></i>${esc(L.faultLegend)}</span><span><i class="dot"></i> ${esc(L.selected)}</span></div>
      <div class="actions" style="margin-top:.7rem"><button id="btnOpenMap" class="btn ghost">${esc(L.openMap)}</button></div>
    </div>
    ${quakeHtml}
    <div class="card"><h3 style="margin-top:0">${esc(L.tips)}</h3><ul class="tips">${tipsFor(d).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  $('#vReport').innerHTML = saved + `
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
    ${tabs}
    ${state.tab === 'risk' ? riskTab : guideHtml(d)}
    <div class="actions" style="margin-top:14px"><button id="btnShare" class="btn primary">${esc(L.share)}</button><button id="btnNew" class="btn ghost">${esc(L.newSearch)}</button></div>
    <div class="card" style="margin-top:14px"><h3 style="margin-top:0">${esc(L.sources)}</h3>
      <ul class="small" style="padding-left:1.1rem">${L.srcList.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <p class="small muted">${esc(L.disclaimer)}</p></div>`;

  if (state.tab === 'risk') {
    drawMap($('#map'), d.place.lat, d.place.lon, d.fault?.nearby || [], fitZoom(d.place.lat, d.fault?.nearby?.length ? d.fault.distKm : null));
    $('#btnOpenMap').onclick = () => openMap(d.place);
  }
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => { b.onclick = () => { state.tab = b.dataset.tab; renderReport(d); }; });
  if ($('#btnRefresh')) $('#btnRefresh').onclick = () => evaluate(d.place);
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
  const g = d.guide || {};
  if (g.cr && g.cr.score != null) lines.push(`• ${L.cat.cr.t}: ${L.lv[levelOf(g.cr.score)]} (${g.cr.score}/100)`);
  if (g.tr && g.tr.score != null) lines.push(`• ${L.cat.tr.t}: ${trLevel(g.tr.score).label}`);
  if (g.cr || g.tr) lines.push(`  (${L.guideIntro})`);
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
  $('#selState').onchange = () => { onState(); onCity(); };
  $('#selCity').onchange = onCity;
  $('#btnFind').onclick = onFind;
  $('#btnCenter').onclick = onCenter;
  $('#inpPlace').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onFind(); } });
  state.countries = await api.loadCountries();
  try { state.info = await (await fetch('data/countryinfo.json')).json(); } catch (_) { state.info = {}; }
  applyLang();
  await onCountry();
  restoring = false;
  show('home');
}
init();
