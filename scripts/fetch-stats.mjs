// Récupère toutes les recettes publiques TRMNL, met à jour l'historique
// et calcule les classements. Aucune dépendance : Node 20+.
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'public/data';
const API = 'https://trmnl.com/recipes.json';
const HOURLY_KEEP_H = 24 * 8;      // 8 jours d'instantanés horaires
const DAILY_KEEP_D = 400;          // ~13 mois d'instantanés quotidiens
const H = 3600e3, D = 24 * H;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, tries = 5) {
  for (let k = 1; ; k++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'trmnl-creators-stats (GitHub Actions)', Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (k >= tries) throw new Error(`${url} : ${e.message}`);
      console.log(`  nouvelle tentative ${k} (${e.message})`);
      await sleep(3000 * k);
    }
  }
}

async function fetchAll() {
  const all = [];
  let total = null;
  for (let page = 1; page <= 200; page++) {
    const d = await getJSON(`${API}?page=${page}&per_page=100`);
    if (page === 1) total = d.total ?? null;
    const rows = d.data || [];
    all.push(...rows);
    console.log(`page ${page} : ${rows.length} recettes (${all.length}/${total ?? '?'})`);
    if (!rows.length || !d.next_page_url) break;
    await sleep(1500);
  }
  return { all, total };
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

// Historique compact : idx = [[idRecette, idCréateur], ...] et, pour chaque instantané,
// deux tableaux i (installations) et f (forks) alignés sur idx (null = absente).
function addSnapshot(hist, t, recipes, sameSlot) {
  const pos = new Map(hist.idx.map(([id], k) => [id, k]));
  for (const r of recipes) if (!pos.has(r.id)) { pos.set(r.id, hist.idx.length); hist.idx.push([r.id, r.u]); }
  const i = new Array(hist.idx.length).fill(null), f = new Array(hist.idx.length).fill(null);
  for (const r of recipes) { const k = pos.get(r.id); i[k] = r.i; f[k] = r.f; }
  const snap = { t, i, f };
  const last = hist.snaps[hist.snaps.length - 1];
  if (last && sameSlot(last.t, t)) hist.snaps[hist.snaps.length - 1] = snap; else hist.snaps.push(snap);
  return hist;
}

// Instantané le plus récent au plus tard à `target` (+20 min de tolérance)
function snapAt(hist, target) {
  let best = null;
  for (const s of hist.snaps) if (Date.parse(s.t) <= target + 20 * 60e3) best = s;
  return best;
}

function scoresOf(hist, snap) {
  const m = new Map();
  hist.idx.forEach(([id], k) => {
    const i = snap.i[k], f = snap.f[k];
    if (i != null) m.set(id, i + (f || 0));
  });
  return m;
}

function rankMap(entries) { // entries: [[key, score, tiebreak]] -> Map key->rang (classement "compétition")
  entries.sort((a, b) => b[1] - a[1] || b[2] - a[2]);
  const m = new Map(); let rank = 0, prev = null;
  entries.forEach(([k, s], n) => { if (s !== prev) { rank = n + 1; prev = s; } m.set(k, rank); });
  return m;
}

const nowMs = Date.now();
const now = new Date(nowMs).toISOString();

const { all, total } = await fetchAll();
await fs.mkdir(OUT, { recursive: true });
const prevLatest = await readJSON(path.join(OUT, 'latest.json'), null);

if (!all.length) throw new Error('Aucune recette reçue : données précédentes conservées.');
if (total && all.length < total * 0.9) throw new Error(`Récupération incomplète (${all.length}/${total}) : données précédentes conservées.`);
if (prevLatest && all.length < prevLatest.totals.recipes * 0.8) throw new Error('Chute anormale du nombre de recettes : données précédentes conservées.');

const seen = new Set();
const recipes = [];
for (const r of all) {
  const id = String(r.id);
  if (seen.has(id)) continue;
  seen.add(id);
  const bio = r.author_bio && typeof r.author_bio === 'object' ? r.author_bio : {};
  const i = Number(r.stats?.installs) || 0, f = Number(r.stats?.forks) || 0;
  const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  recipes.push({
    id, n: r.name || 'Sans titre', u: String(r.user_id ?? r.author_id ?? '0'),
    i, f, s: i + f, p: r.published_at || null,
    c: (bio.category || '').split(',').map(x => x.trim()).filter(Boolean),
    ic: r.icon_url || '',
    sc: r.screenshot_url || '',                 // aperçu 800x480 de la recette
    d: clip(r.description, 180),                // description courte
    ab: { gh: bio.github_url || '', w: bio.learn_more_url || '' },   // liens de l'auteur
  });
}

// --- Historique
const hourly = await readJSON(path.join(OUT, 'hourly.json'), { v: 1, idx: [], snaps: [] });
const daily = await readJSON(path.join(OUT, 'daily.json'), { v: 1, idx: [], snaps: [] });
addSnapshot(hourly, now, recipes, (a, b) => a.slice(0, 13) === b.slice(0, 13));
addSnapshot(daily, now, recipes, (a, b) => a.slice(0, 10) === b.slice(0, 10));
hourly.snaps = hourly.snaps.filter(s => nowMs - Date.parse(s.t) <= HOURLY_KEEP_H * H);
daily.snaps = daily.snaps.filter(s => nowMs - Date.parse(s.t) <= DAILY_KEEP_D * D);

// --- Variations
const windows = { d1: [hourly, H], d24: [hourly, D], d7: [hourly, 7 * D], d30: [daily, 30 * D] };
const past = {};   // clé -> { at, scores } ou null
for (const [key, [hist, span]] of Object.entries(windows)) {
  let src = hist, snap = snapAt(hist, nowMs - span);
  // L'instantané doit vraiment couvrir la fenêtre (au moins 80 % de sa durée)
  const covers = s => s && nowMs - Date.parse(s.t) >= span * 0.8;
  if (!covers(snap) && key === 'd7') { src = daily; snap = snapAt(daily, nowMs - span); }
  past[key] = covers(snap) ? { at: snap.t, from: Date.parse(snap.t), scores: scoresOf(src, snap) } : null;
}

for (const r of recipes) {
  for (const key of Object.keys(windows)) {
    const P = past[key];
    if (!P) { r[key] = null; continue; }
    const old = P.scores.get(r.id);
    if (old != null) r[key] = r.s - old;
    else if (r.p && Date.parse(r.p) > P.from) r[key] = r.s;   // publiée pendant la fenêtre
    else r[key] = null;
  }
}

// --- Rangs des recettes
const recipeRank = rankMap(recipes.map(r => [r.id, r.s, r.i]));
recipes.forEach(r => { r.r = recipeRank.get(r.id); });

// --- Créateurs
const byUser = new Map();
for (const r of recipes) {
  let c = byUser.get(r.u);
  if (!c) byUser.set(r.u, c = { u: r.u, n: 0, i: 0, f: 0, s: 0, best: null, bestS: -1, first: null, last: null, d1: 0, d24: 0, d7: 0, d30: 0 });
  c.n++; c.i += r.i; c.f += r.f; c.s += r.s;
  if (r.s > c.bestS) { c.bestS = r.s; c.best = r.id; }
  if (r.p) { if (!c.first || r.p < c.first) c.first = r.p; if (!c.last || r.p > c.last) c.last = r.p; }
  for (const key of Object.keys(windows)) c[key] += r[key] ?? 0;
}
const creators = [...byUser.values()];
for (const key of Object.keys(windows)) if (!past[key]) creators.forEach(c => { c[key] = null; });

const rNow = rankMap(creators.map(c => [c.u, c.s, c.i]));
creators.forEach(c => { c.r = rNow.get(c.u); });

// Rang il y a 24 h et 7 j
const userOf = new Map(hourly.idx.concat(daily.idx).map(([id, u]) => [id, u]));
for (const [key, label] of [['d24', 'r24'], ['d7', 'r7']]) {
  const P = past[key];
  if (!P) { creators.forEach(c => { c[label] = null; }); continue; }
  const tot = new Map();
  for (const [id, s] of P.scores) { const u = userOf.get(id); tot.set(u, (tot.get(u) || 0) + s); }
  const rk = rankMap([...tot.entries()].map(([u, s]) => [u, s, 0]));
  creators.forEach(c => { c[label] = rk.get(c.u) ?? null; });
}
creators.forEach(c => { delete c.bestS; });
creators.sort((a, b) => a.r - b.r);
recipes.sort((a, b) => a.r - b.r);

const latest = {
  v: 1,
  generated_at: now,
  source: API,
  history: {
    hourly_from: hourly.snaps[0]?.t ?? null,
    daily_from: daily.snaps[0]?.t ?? null,
    windows: Object.fromEntries(Object.entries(past).map(([k, P]) => [k, P ? P.at : null])),
  },
  totals: {
    recipes: recipes.length,
    creators: creators.length,
    installs: recipes.reduce((a, r) => a + r.i, 0),
    forks: recipes.reduce((a, r) => a + r.f, 0),
  },
  recipes,
  creators,
};

await fs.writeFile(path.join(OUT, 'latest.json'), JSON.stringify(latest));
await fs.writeFile(path.join(OUT, 'hourly.json'), JSON.stringify(hourly));
await fs.writeFile(path.join(OUT, 'daily.json'), JSON.stringify(daily));
console.log(`OK : ${recipes.length} recettes, ${creators.length} créateurs, ${hourly.snaps.length} instantanés horaires, ${daily.snaps.length} quotidiens.`);
