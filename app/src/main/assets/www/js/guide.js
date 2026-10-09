// Ülke geneli seyahat göstergeleri: suç, sağlık, ulaşım, finans, dil.
// Puanlar 0–100 arasıdır (yüksek = daha fazla risk / zorluk) ve yalnızca resmi açık istatistiklere dayanır.

// Soldan akan trafik (sol şerit) uygulanan ülkeler ve bölgeler.
export const LEFT_DRIVE = new Set(('AG AI AU BB BD BM BN BS BT BW CC CK CX CY DM FJ FK GB GD GG GY HK IE IM IN ID JE JM JP KE KI KN KY ' +
  'LC LK LS MO MS MT MU MV MW MY MZ NA NF NP NR NU NZ PG PK PN SB SC SG SH SR SZ TC TH TK TL TO TT TV TZ UG VC VG VI WS ZA ZM ZW').split(' '));

// DSÖ: sarıhumma bulaşma riski bulunan ülkeler (ülkenin tamamı veya bir bölümü; Kasım 2022 listesi).
export const YELLOW_FEVER = new Set(('AO BJ BF BI CM CF TD CG CI CD GQ ET GA GM GH GN GW KE LR ML MR NE NG SN SL SS SD TG UG ' +
  'AR BO BR CO EC GF GY PA PY PE SR TT VE').split(' '));

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const thisYear = new Date().getFullYear();
const conf = (n, total) => (n >= total ? 'high' : n >= Math.ceil(total / 2) ? 'medium' : 'low');
const stale = (x) => x && thisYear - +x.year > 6;

// ---------- Suç ----------
// Oran = ülke kasten öldürme oranı / dünya ortalaması. 1,5 kat ve üzeri "yüksek" (60+).
export function crimeScoreFromRatio(r) {
  let s;
  if (r < 0.5) s = 40 * r;
  else if (r < 1) s = 20 + 40 * (r - 0.5);
  else if (r < 1.5) s = 40 + 40 * (r - 1);
  else if (r < 3) s = 60 + ((r - 1.5) / 1.5) * 20;
  else s = 80 + ((r - 3) / 3) * 20;
  return clamp(Math.floor(s + 1e-9)); // aşağı yuvarlama: 1,49 kat "orta", 1,5 kat "yüksek" kalır
}
const WORLD_HOMICIDE_FALLBACK = 5.8; // UNODC küresel ortalama (yaklaşık), dünya verisi alınamazsa
export function scoreCrime(stats, hasAdvice) {
  const h = stats?.hom;
  if (!h) return null;
  const w = stats.homWorld?.value ?? WORLD_HOMICIDE_FALLBACK;
  const r = h.value / w;
  const factors = [
    { k: 'cr.hom', v: { x: h.value, y: h.year } },
    { k: 'cr.world', v: { x: w, y: stats.homWorld?.year ?? null } },
    { k: 'cr.ratio', v: { r } },
  ];
  let n = 1 + (stats.homWorld ? 1 : 0) + (hasAdvice ? 1 : 0);
  if (stale(h)) n--;
  return { score: crimeScoreFromRatio(r), factors, confidence: conf(n, 3), ratio: r };
}

// ---------- Sağlık ve hijyen ----------
export function scoreHealth(stats, cc, lat) {
  if (!stats) return null;
  const f = [];
  let s = 0, n = 0;
  const m = stats.malaria;
  if (m) {
    n++;
    const p = m.value >= 100 ? 30 : m.value >= 10 ? 22 : m.value >= 1 ? 14 : m.value > 0 ? 8 : 0;
    s += p; f.push({ k: 'he.malaria', v: { x: m.value, y: m.year }, pts: p });
  } else f.push({ k: 'he.malaria', v: { x: null }, pts: 0 });
  if (YELLOW_FEVER.has(cc)) { s += 15; f.push({ k: 'he.yf', v: { yes: true }, pts: 15 }); }
  else f.push({ k: 'he.yf', v: { yes: false }, pts: 0 });
  if (lat != null && Math.abs(lat) <= 23.5) { s += 5; f.push({ k: 'he.tropic', v: {}, pts: 5 }); }
  const w = stats.water;
  if (w) { n++; const p = Math.min(30, Math.round((100 - w.value) * 0.3)); s += p; f.push({ k: 'he.water', v: { x: w.value, y: w.year }, pts: p }); }
  const u = stats.uhc;
  if (u) { n++; const p = Math.round(clamp((80 - u.value) * 0.6, 0, 25)); s += p; f.push({ k: 'he.uhc', v: { x: u.value, y: u.year }, pts: p }); }
  const d = stats.phys;
  if (d) { n++; const p = d.value < 1 ? 10 : d.value < 2 ? 5 : 0; s += p; f.push({ k: 'he.phys', v: { x: d.value, y: d.year }, pts: p }); }
  if (n < 2) return { score: null, factors: f, confidence: 'low' };
  return { score: clamp(Math.round(s)), factors: f, confidence: conf(n, 4) };
}

// ---------- Ulaşım ve iletişim ----------
export function scoreTransport(stats, cc) {
  if (!stats) return null;
  const f = [];
  let s = 0, n = 0;
  const r = stats.road;
  if (r) { n++; const p = Math.min(50, Math.round(r.value * 1.5)); s += p; f.push({ k: 'tr.road', v: { x: r.value, y: r.year }, pts: p }); }
  const i = stats.internet;
  if (i) { n++; const p = Math.min(35, Math.round((100 - i.value) * 0.35)); s += p; f.push({ k: 'tr.net', v: { x: i.value, y: i.year }, pts: p }); }
  f.push({ k: 'tr.side', v: { left: LEFT_DRIVE.has(cc) }, pts: null });
  if (!n) return { score: null, factors: f, confidence: 'low' };
  return { score: clamp(Math.round(s)), factors: f, confidence: conf(n, 2) };
}

// ---------- Finans ve ödeme (nakit ihtiyacı) ----------
export function scoreFinance(stats, info) {
  const f = [];
  const cur = (info?.c || []).map((c) => c[0]);
  f.push({ k: 'fi.cur', v: { cur, names: info?.c || [] }, pts: null });
  const a = stats?.account;
  if (!a) return { score: null, factors: f, confidence: 'low' };
  const p = Math.round(clamp((100 - a.value) * 0.9));
  f.unshift({ k: 'fi.acc', v: { x: a.value, y: a.year }, pts: p });
  return { score: p, factors: f, confidence: stale(a) ? 'medium' : 'high' };
}

// ---------- Dil (puan yok, bilgi) ----------
export function languageInfo(info) {
  const langs = (info?.l || []).map(([code, name]) => ({ code, name }));
  return { langs, englishOfficial: langs.some((l) => l.code === 'eng') };
}
