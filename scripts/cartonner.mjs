// =====================================================================
//  « Ça va cartonner » : 3 ou 4 recettes repérées chaque jour pour leur potentiel.
//  Lancé à chaque relevé horaire par .github/workflows/stats.yml (après spotlight.mjs).
//
//  1. PRÉSÉLECTION CHIFFRÉE (gratuite) : une vingtaine de candidates de 150 connexions au plus
//     (connexions = installs + forks) : celles qui accélèrent par rapport à leur rythme habituel,
//     les jeunes recettes qui démarrent mieux que les autres au même âge, et celles qui gagnent du terrain sur 7 jours.
//  2. DOSSIER PAR CANDIDATE : élan de sa catégorie, réglages à remplir (clé API, compte…), description,
//     antécédents du créateur, démarrage comparé aux recettes du même âge, habitudes d'installation.
//  3. CHOIX (une fois par jour, un seul appel Mistral, captures d'écran comprises) : 3 ou 4 recettes.
//     Sans Mistral (clé absente, panne), repli sur la formule mécanique : le site n'est jamais vide.
//
//  Ce que voit le public (data/breakout.json) : les recettes choisies, leur prévision et le verdict à 24 h,
//  48 h et 7 jours, comme avant. Aucune mention de la méthode.
//  Ce que voit l'administrateur seul (table Supabase breakout_ai, lisible par l'admin uniquement) :
//  le raisonnement, les candidates écartées, le choix qu'aurait fait la formule, la courbe heure par heure
//  de chaque recette suivie pendant 7 jours et le match « sélection contre formule ».
// =====================================================================
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'public/data';
const KEY = process.env.MISTRAL_API_KEY || '';
const MODEL = process.env.CARTONNER_MODEL || 'mistral-medium-latest';
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_ANON_KEY || '';
const SB_TOKEN = process.env.BREAKOUT_AI_TOKEN || '';
const FORCE = process.env.CARTONNER_FORCE === 'true';   // case « cartonner » du lancement manuel : refaire la sélection du jour
const H = 3600e3, DAY = 24 * H;
const VERIFY_DAYS = 7;         // verdict public et bilan détaillé au bout de 7 jours
const MAX_S = 150;             // au-delà, la recette a déjà fait ses preuves
const COOLDOWN_DAYS = 7;       // une recette choisie n'est pas reproposée pendant son suivi
const N_PICKS = [3, 4];        // 3 ou 4 recettes par jour
const N_SHOTS = 8;             // captures d'écran envoyées à Mistral (les candidates les mieux placées)
const N_SETTINGS = 14;         // pages trmnl.com consultées pour lire les réglages
const EXCLUDE_CREATORS = [];   // identifiants de créateurs à ne jamais sélectionner, ex. ['40325']
const nowMs = Date.now();
const today = new Date(nowMs).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[ça va cartonner]', ...a);
const round = (x, k = 0) => (x == null || !isFinite(x)) ? null : Math.round(x * 10 ** k) / 10 ** k;
const sum = a => a.reduce((x, y) => x + (y || 0), 0);
const q = (arr, p) => { const a = arr.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const k = (a.length - 1) * p, lo = Math.floor(k); return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (k - lo); };
async function readJSON(f, fb) { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return fb; } }

const latest = await readJSON(path.join(OUT, 'latest.json'), null);
if (!latest?.recipes?.length) { log('Pas de latest.json : rien à faire.'); process.exit(0); }
const daily = await readJSON(path.join(OUT, 'daily.json'), { idx: [], snaps: [] });
const hourly = await readJSON(path.join(OUT, 'hourly.json'), { idx: [], snaps: [] });
const hist = await readJSON(path.join(OUT, 'breakout.json'), { v: 1, picks: [] });
const names = await readJSON('names.json', {});
const R = latest.recipes, byId = new Map(R.map(r => [r.id, r]));
const who = u => names[u] || `#${u}`;

// ---------- Historiques : valeur (installs + forks) d'une recette à une date donnée
function history(h) {
  const pos = new Map(h.idx.map(([id], k) => [id, k]));
  const at = (target, tol) => { let best = null; for (const s of h.snaps) if (Date.parse(s.t) <= target + tol) best = s; return best; };
  const val = (snap, id) => { const k = pos.get(id); if (!snap || k == null || snap.i[k] == null) return null; return snap.i[k] + (snap.f?.[k] ?? 0); };
  return { pos, snaps: h.snaps, at, val };
}
const HD = history(daily), HH = history(hourly);
const ageD = r => r.p ? Math.max(0.1, (nowMs - Date.parse(r.p)) / DAY) : null;

// ---------- 1. Verdicts publics (inchangé : 24 h, 48 h, 7 jours)
const BREAKOUT_HALF_LIFE_DAYS = 3;
function predictInstalls(r) {
  const base = r.s / Math.max(1, ageD(r));
  const boost = Math.max(0, (r.d24 ?? 0) - base), hl = BREAKOUT_HALF_LIFE_DAYS;
  const at = d => Math.round(r.s + base * d + boost * (hl / Math.LN2) * (1 - Math.pow(0.5, d / hl)));
  return { h24: at(1), h48: at(2), d7: at(7) };
}
for (const p of hist.picks) {
  const ageP = (nowMs - Date.parse(p.date)) / DAY, now = byId.get(p.id);
  const cur = now ? (p.s != null ? now.s : now.i) : null;
  const snap = () => ({ i: cur, checked_at: new Date(nowMs).toISOString() });
  if (!p.check_h24 && ageP >= 1) p.check_h24 = snap();
  if (!p.check_h48 && ageP >= 2) p.check_h48 = snap();
  if (!p.result && ageP >= VERIFY_DAYS) p.result = now ? { i_now: cur, gain: cur - (p.s != null ? p.s : p.i), checked_at: new Date(nowMs).toISOString() }
                                                        : { i_now: null, gain: null, checked_at: new Date(nowMs).toISOString() };
}

// ---------- Supabase (coulisses réservées à l'administrateur)
const sbOn = !!(SB_URL && SB_KEY && SB_TOKEN);
async function rpc(fn, body) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Supabase ${fn} : HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  const t = await res.text(); return t ? JSON.parse(t) : null;
}

// Courbe heure par heure d'une recette depuis le moment du choix (7 jours au plus)
function curve(id, fromMs) {
  const pts = [];
  for (const s of HH.snaps) {
    const t = Date.parse(s.t); if (t < fromMs - 30 * 60e3 || t > fromMs + VERIFY_DAYS * DAY + 30 * 60e3) continue;
    const v = HH.val(s, id); if (v != null) pts.push([round((t - fromMs) / H, 1), v]);
  }
  return pts;
}
const mergeCurve = (old, add) => { const m = new Map((old || []).map(p => [p[0], p[1]])); for (const [h, v] of add) m.set(h, v); return [...m].sort((a, b) => a[0] - b[0]); };

async function updateTracking() {
  if (!sbOn) return;
  let rows = [];
  try { rows = (await rpc('breakout_ai_recent', { p_token: SB_TOKEN, p_days: 45 })) || []; } catch (e) { log(`Coulisses illisibles (${e.message}).`); return; }
  const changed = [];
  for (const row of rows) {
    const d = row.data, from = Date.parse(d.made_at || `${row.day}T00:10:00Z`);
    if (d.results || !from) continue;
    const ids = [...new Set([...(d.picks || []), ...(d.formula || [])].map(x => x.id))];
    d.curves = d.curves || {};
    for (const id of ids) d.curves[id] = mergeCurve(d.curves[id], curve(id, from));
    if (nowMs - from >= VERIFY_DAYS * DAY) {
      const end = from + VERIFY_DAYS * DAY;
      const s7 = id => { const v = HH.val(HH.at(end, 45 * 60e3), id); return v ?? byId.get(id)?.s ?? null; };
      const res = (d.shortlist || []).map(c => { const v = s7(c.id); return { id: c.id, s0: c.s0, s7: v, gain: v == null ? null : v - c.s0 }; });
      const g = ids2 => res.filter(x => ids2.has(x.id) && x.gain != null);
      const pickIds = new Set((d.picks || []).map(x => x.id)), formIds = new Set((d.formula || []).map(x => x.id));
      const others = res.filter(x => !pickIds.has(x.id) && !formIds.has(x.id) && x.gain != null);
      const hit = x => x.gain >= Math.max(10, x.s0);   // au moins doublé, et au moins +10
      const sumUp = a => ({ n: a.length, avg_gain: a.length ? round(sum(a.map(x => x.gain)) / a.length, 1) : null, median_gain: round(q(a.map(x => x.gain), 0.5), 1), hits: a.filter(hit).length });
      d.results = { checked_at: new Date(nowMs).toISOString(), all: res, selection: sumUp(g(pickIds)), formula: sumUp(g(formIds)), others: sumUp(others) };
    }
    changed.push({ day: row.day, data: d });
  }
  if (changed.length) {
    try { await rpc('breakout_ai_put_many', { p_token: SB_TOKEN, p_rows: changed }); log(`Suivi mis à jour (${changed.length} jour(s)).`); }
    catch (e) { log(`Suivi non enregistré (${e.message}).`); }
  }
}

// ---------- 2. Choix du jour (une fois par jour)
async function pickToday() {
  if (FORCE && hist.picks.some(x => x.date === today)) { hist.picks = hist.picks.filter(x => x.date !== today); log('Lancement manuel : la sélection du jour est refaite.'); }
  if (hist.picks.some(x => x.date === today)) { log('Sélection du jour déjà faite.'); return; }

  // Interrupteur des coulisses : coupé = ancienne formule (une recette, aucun appel à Mistral)
  let enabled = true;
  if (sbOn) { try { enabled = (await rpc('breakout_ai_enabled', { p_token: SB_TOKEN })) !== false; } catch (e) { log(`Interrupteur illisible (${e.message}) : nouvelle formule par défaut.`); } }
  if (!enabled) return legacyPick();

  const recent = new Set(hist.picks.filter(x => nowMs - Date.parse(x.date) < COOLDOWN_DAYS * DAY).map(x => x.id));

  // Formule mécanique (l'ancienne méthode) : vitesse des dernières 24 h comparée au rythme moyen depuis la publication
  const formulaScore = r => { if (r.s > MAX_S || r.d24 == null || r.d24 < 3 || !r.p) return null; const ipd = r.s / Math.max(1, ageD(r)); return (ipd > 0 ? r.d24 / ipd : r.d24) * Math.log(1 + r.d24); };

  // Démarrage comparé : connexions des recettes publiées depuis le début de l'historique, au même âge (1 à 30 jours)
  const firstMs = HD.snaps.length ? Date.parse(HD.snaps[0].t) : nowMs;
  const atAge = new Map();
  for (const r of R) {
    const p = r.p ? Date.parse(r.p) : null; if (!p || p < firstMs) continue;
    for (let k = 1; k <= 30 && p + k * DAY <= nowMs; k++) { const v = HD.val(HD.at(p + k * DAY, 3 * H), r.id); if (v != null) { if (!atAge.has(k)) atAge.set(k, []); atAge.get(k).push(v); } }
  }
  const launchPct = r => { const a = Math.round(ageD(r)); const arr = atAge.get(Math.min(30, Math.max(1, a))); if (!arr || arr.length < 10 || a > 30) return null; return round(100 * arr.filter(v => v < r.s).length / arr.length); };
  const typical = Object.fromEntries([1, 3, 7, 14, 30].filter(k => atAge.get(k)?.length >= 10).map(k => [`${k}j`, { median: round(q(atAge.get(k), 0.5), 1), top_quarter: round(q(atAge.get(k), 0.75)) }]));

  const pool = R.filter(r => r.s <= MAX_S && r.p && !recent.has(r.id) && !EXCLUDE_CREATORS.includes(String(r.u)));
  const scored = pool.map(r => ({ r, f: formulaScore(r), lp: launchPct(r) }));
  const pick = new Map();
  const add = (arr, n) => { for (const o of arr.slice(0, n)) if (!pick.has(o.r.id)) pick.set(o.r.id, o); };
  add(scored.filter(o => o.f != null).sort((a, b) => b.f - a.f), 12);
  add(scored.filter(o => o.lp != null && o.lp >= 60 && (o.r.d7 || 0) > 0 && ageD(o.r) <= 30).sort((a, b) => b.lp - a.lp || b.r.s - a.r.s), 8);
  add(scored.filter(o => (o.r.d7 || 0) >= 3).sort((a, b) => b.r.d7 - a.r.d7), 6);
  const cands = [...pick.values()].slice(0, 22);
  const formulaTop = scored.filter(o => o.f != null).sort((a, b) => b.f - a.f).slice(0, 4);
  if (!cands.length) { log("Aucune candidate aujourd'hui : pas de sélection."); return; }

  // Catégories : élan de la semaine par rapport au mois, part des gains
  const cat = new Map();
  for (const r of R) for (const c of r.c) { const o = cat.get(c) || { g7: 0, g30: 0, n: 0 }; o.g7 += r.d7 || 0; o.g30 += r.d30 || 0; o.n++; cat.set(c, o); }
  const totG7 = Math.max(1, sum([...cat.values()].map(o => o.g7)));
  const catInfo = c => { const o = cat.get(c); return o ? { cat: c, recipes: o.n, gained_7d: o.g7, share_of_gains_pct: round(100 * o.g7 / totG7), momentum: o.g30 > 0 ? round(o.g7 / (o.g30 * 7 / 30), 2) : null } : null; };

  // Créateur : ses autres recettes
  const byU = new Map(); for (const r of R) { if (!byU.has(r.u)) byU.set(r.u, []); byU.get(r.u).push(r); }
  const creatorInfo = r => { const o = (byU.get(r.u) || []).filter(x => x.id !== r.id); return { name: who(r.u), other_recipes: o.length, median_other: round(q(o.map(x => x.s), 0.5), 1), best_other: o.length ? Math.max(...o.map(x => x.s)) : null, gained_7d_all: sum((byU.get(r.u) || []).map(x => x.d7)) }; };

  // Habitudes d'installation : jours de la semaine (8 semaines) et heures (8 jours), heure UTC
  const dow = new Array(7).fill(0);
  for (let k = 1; k < HD.snaps.length; k++) { const a = HD.snaps[k - 1], b = HD.snaps[k]; if (nowMs - Date.parse(b.t) > 56 * DAY) continue; let g = 0; for (const [, i] of HD.pos) { const x = a.i[i], y = b.i[i]; if (x != null && y != null) g += (y + (b.f?.[i] ?? 0)) - (x + (a.f?.[i] ?? 0)); } dow[new Date(Date.parse(a.t) + 12 * H).getUTCDay()] += g; }
  const hrs = new Array(24).fill(0);
  for (let k = 1; k < HH.snaps.length; k++) { const a = HH.snaps[k - 1], b = HH.snaps[k]; const dt = (Date.parse(b.t) - Date.parse(a.t)) / H; if (dt > 1.6) continue; let g = 0; for (const [, i] of HH.pos) { const x = a.i[i], y = b.i[i]; if (x != null && y != null) g += (y + (b.f?.[i] ?? 0)) - (x + (a.f?.[i] ?? 0)); } hrs[new Date(Date.parse(b.t)).getUTCHours()] += g; }
  const DOWN = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const habits = { gains_share_by_weekday_pct: Object.fromEntries(dow.map((v, k) => [DOWN[k], round(100 * v / Math.max(1, sum(dow)))])),
                   gains_share_by_hour_utc_pct: Object.fromEntries(hrs.map((v, k) => [`${k}h`, round(100 * v / Math.max(1, sum(hrs)))])),
                   typical_launch_connections: typical };

  // Réglages à remplir (lus sur la page trmnl.com des candidates les mieux placées)
  const order = cands.slice().sort((a, b) => (b.f ?? 0) - (a.f ?? 0) || (b.lp ?? 0) - (a.lp ?? 0));
  const settings = new Map();
  for (const o of order.slice(0, N_SETTINGS)) {
    try {
      const res = await fetch(`https://trmnl.com/recipes/${o.r.id}`, { headers: { 'User-Agent': 'trmnl-creators-stats (GitHub Actions)' }, signal: AbortSignal.timeout(20000) });
      const html = res.ok ? await res.text() : '';
      const out = []; const re = /<p class="uppercase[^"]*">([^<]+)<\/p>[\s\S]*?<p class="text-gray-500 dark:text-gray-400 leading-7 text-sm mt-3">([\s\S]*?)<\/p>/g; let m;
      if (/Available settings/.test(html)) while ((m = re.exec(html))) out.push({ n: m[1].replace(/\s+/g, ' ').trim(), d: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) });
      settings.set(o.r.id, out);
    } catch { /* page indisponible : réglages inconnus */ }
    await sleep(600);
  }
  const FRICTION = /api[ _-]?key|token|secret|password|mot de passe|client[ _-]?id|log ?in|account|compte|oauth|webhook|bearer/i;

  const dossier = cands.map(o => { const r = o.r, st = settings.get(r.id); return {
    id: r.id, name: r.n.trim(), description: (r.d || '').slice(0, 300), categories: r.c, age_days: round(ageD(r), 1),
    connections: r.s, installs: r.i, forks: r.f, gained_1h: r.d1, gained_24h: r.d24, gained_7d: r.d7, gained_30d: r.d30,
    pace_per_day_since_launch: round(r.s / Math.max(1, ageD(r)), 2), acceleration_score: round(o.f, 2), launch_percentile_same_age: o.lp,
    settings: st ? st.map(s => s.n) : 'inconnus', needs_account_or_key: st ? st.some(s => FRICTION.test(`${s.n} ${s.d}`)) : null,
    has_screenshot: !!r.sc, has_github: !!r.ab?.gh, creator: creatorInfo(r), category_context: r.c.map(catInfo).filter(Boolean),
  }; });
  const shots = order.filter(o => o.r.sc).slice(0, N_SHOTS);

  const SYSTEM = `Tu es un fin connaisseur de la communauté TRMNL (un écran e-ink connecté ; une « recette » est un plugin public que chacun peut installer ou forker).
Chaque jour, tu repères les recettes qui ont le plus de chances de décoller dans les 7 prochains jours, parmi des candidates de 150 connexions au plus (connexions = installs + forks).
Va au-delà des chiffres bruts : pense comme un utilisateur TRMNL qui parcourt le catalogue.
- Attrait grand public : une météo, un calendrier, une citation, de l'art, un compte à rebours parlent à presque tout le monde ; un tableau pour un service très pointu, une langue ou un pays précis touche moins de monde.
- Friction : une recette qui exige une clé API, un compte ou un token tiers s'installe beaucoup moins facilement qu'une recette prête à l'emploi.
- Saison et actualité : la date du jour compte (saisons sportives, fêtes, rentrée, événements).
- Soin et style : une capture d'écran nette, lisible et belle sur un écran e-ink noir et blanc donne envie ; une capture brouillonne ou vide freine. Juge les captures fournies.
- Élan : l'accélération récente, le démarrage comparé aux recettes du même âge, l'élan de la catégorie et les antécédents du créateur.
- Habitudes : à quels jours et heures la communauté installe le plus.
- Méfie-toi des pics isolés sans fond solide (un seul gros jour, puis plus rien) et des recettes trop niches.
N'utilise que les données fournies ; n'invente rien.
Réponds UNIQUEMENT avec un objet JSON valide :
{"picks": [{"id": "identifiant exact d'une candidate", "conviction": 1 à 5, "pourquoi": "2 ou 3 phrases", "atouts": ["…"], "risques": ["…"], "attendu_7j": "modeste|net|fort"}],
 "ecartees": [{"id": "…", "raison": "une phrase"}],
 "lecture_du_jour": "2 ou 3 phrases sur ce que tu observes aujourd'hui"}
Choisis 3 ou 4 recettes (4 seulement si la quatrième le mérite vraiment), triées de la plus convaincante à la moins convaincante. Dans "ecartees", explique 3 à 5 refus notables, en particulier les candidates aux meilleurs chiffres.`;
  const dateTxt = new Date(nowMs).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const userTxt = `Nous sommes le ${dateTxt}.\n\nHabitudes d'installation de la communauté (JSON) :\n${JSON.stringify(habits)}\n\nCandidates (JSON) :\n${JSON.stringify(dossier)}\n\n`
    + (shots.length ? `Captures d'écran jointes, dans cet ordre : ${shots.map((o, k) => `n°${k + 1} = ${o.r.id} (${o.r.n.trim()})`).join(' ; ')}.` : 'Pas de capture jointe.');

  async function ask(withImages) {
    const content = withImages && shots.length ? [{ type: 'text', text: userTxt }, ...shots.map(o => ({ type: 'image_url', image_url: o.r.sc }))] : userTxt;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(180000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, temperature: 0.4, max_tokens: 2500, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }] }) });
      if (res.ok) { const j = await res.json(); return { data: JSON.parse((j.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim()), tokens: j.usage?.total_tokens || null }; }
      const txt = (await res.text()).slice(0, 200);
      if (res.status === 429 || res.status >= 500) { log(`Mistral HTTP ${res.status}, nouvel essai dans ${attempt ? 40 : 20} s.`); await sleep(attempt ? 40000 : 20000); continue; }
      throw new Error(`Mistral HTTP ${res.status} ${txt}`);
    }
    throw new Error('Mistral indisponible');
  }

  let ai = null, tokens = null, mode = 'formule', note = '';
  if (KEY) {
    try { ({ data: ai, tokens } = await ask(true)); mode = 'ia+captures'; }
    catch (e) { note = `captures refusées (${e.message})`; log(`${note} : nouvel essai sans images.`);
      try { ({ data: ai, tokens } = await ask(false)); mode = 'ia'; } catch (e2) { note += ` ; texte seul refusé (${e2.message})`; log(`Mistral indisponible : repli sur la formule.`); } }
  } else note = 'pas de clé Mistral';

  const candIds = new Set(cands.map(o => o.r.id));
  let chosen = [];
  if (ai?.picks?.length) {
    const seen = new Set();
    chosen = ai.picks.filter(p => candIds.has(String(p.id)) && !seen.has(String(p.id)) && seen.add(String(p.id))).slice(0, N_PICKS[1])
      .map(p => ({ ...p, id: String(p.id), conviction: Math.max(1, Math.min(5, Number(p.conviction) || 3)) }));
  }
  if (chosen.length < N_PICKS[0]) {   // complète (ou remplace) avec la formule
    if (ai) note += `${note ? ' ; ' : ''}${chosen.length} choix valide(s) seulement, complété(s) par la formule`;
    for (const o of formulaTop.concat(order)) { if (chosen.length >= N_PICKS[0]) break; if (!chosen.some(c => c.id === o.r.id)) chosen.push({ id: o.r.id, conviction: null, pourquoi: '(choix de la formule)', atouts: [], risques: [], attendu_7j: null, from_formula: true }); }
  }

  for (const c of chosen) {
    const r = byId.get(c.id);
    hist.picks.push({ id: r.id, u: r.u, n: r.n, c: r.c, ic: r.ic, sc: r.sc, d: r.d, i: r.i, s: r.s, d24: r.d24,
      score: round(formulaScore(r), 2), date: today, pred: predictInstalls(r), check_h24: null, check_h48: null, result: null });
  }
  log(`Sélection du jour (${mode}) : ${chosen.map(c => `« ${byId.get(c.id).n.trim()} »`).join(', ')}${note ? ` — ${note}` : ''}.`);

  if (sbOn) {
    const nm = id => byId.get(id)?.n?.trim() || id;
    const data = { made_at: new Date(nowMs).toISOString(), mode, model: mode === 'formule' ? null : MODEL, tokens, note: note || null,
      reading: ai?.lecture_du_jour || null,
      picks: chosen.map(c => ({ ...c, n: nm(c.id), by: who(byId.get(c.id).u), s0: byId.get(c.id).s, d24_0: byId.get(c.id).d24, pred: predictInstalls(byId.get(c.id)) })),
      formula: formulaTop.map(o => ({ id: o.r.id, n: nm(o.r.id), by: who(o.r.u), s0: o.r.s, score: round(o.f, 2) })),
      rejected: (ai?.ecartees || []).filter(x => candIds.has(String(x.id))).map(x => ({ id: String(x.id), n: nm(String(x.id)), raison: x.raison })),
      shortlist: dossier.map(x => ({ id: x.id, n: x.name, s0: x.connections, d24: x.gained_24h, lp: x.launch_percentile_same_age, friction: x.needs_account_or_key, shot: shots.some(o => o.r.id === x.id) })),
      curves: {}, results: null };
    try { await rpc('breakout_ai_put_many', { p_token: SB_TOKEN, p_rows: [{ day: today, data }] }); log('Coulisses enregistrées.'); }
    catch (e) { log(`Coulisses non enregistrées (${e.message}).`); }
  } else log('Coulisses non configurées (BREAKOUT_AI_TOKEN absent) : seule la sélection publique est faite.');
}

// Ancienne formule, telle qu'elle était : la recette qui accélère le plus par rapport à son propre rythme (une par jour)
function legacyPick() {
  const recent = new Set(hist.picks.filter(x => nowMs - Date.parse(x.date) < 3 * DAY).map(x => x.id));
  let best = null, bestScore = -Infinity;
  for (const r of R) {
    if (recent.has(r.id) || r.s > MAX_S || r.d24 == null || r.d24 < 3 || !r.p) continue;
    const ipd = r.s / Math.max(1, ageD(r)), sc = (ipd > 0 ? r.d24 / ipd : r.d24) * Math.log(1 + r.d24);
    if (sc > bestScore) { bestScore = sc; best = r; }
  }
  if (!best) { log("Ancienne formule : aucune recette ne montre un signal suffisant aujourd'hui."); return; }
  hist.picks.push({ id: best.id, u: best.u, n: best.n, c: best.c, ic: best.ic, sc: best.sc, d: best.d, i: best.i, s: best.s, d24: best.d24,
    score: round(bestScore, 2), date: today, pred: predictInstalls(best), check_h24: null, check_h48: null, result: null });
  log(`Ancienne formule (nouvelle formule coupée dans les coulisses) : « ${best.n.trim()} ».`);
}

try { await pickToday(); } catch (e) { log(`Sélection impossible : ${e.message}`); }
try { await updateTracking(); } catch (e) { log(`Suivi impossible : ${e.message}`); }
hist.picks = hist.picks.filter(p => nowMs - Date.parse(p.date) <= 400 * DAY);
await fs.writeFile(path.join(OUT, 'breakout.json'), JSON.stringify(hist));
