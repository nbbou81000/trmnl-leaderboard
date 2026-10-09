// « Ce que la communauté cherche » : les recherches qui ne trouvent aucune recette sur trmnl.com
// (au moins 5 personnes sur 30 jours, tranches 5+/10+/15+/20+, source officielle TRMNL rafraîchie chaque heure).
// Source : GET https://trmnl.com/api/search_insights avec la clé de compte (secret TRMNL_API_KEY, capacité Read).
//
// On garde notre propre historique dans data/wanted.json : depuis quand chaque terme est demandé, son pic de demande,
// et s'il a été comblé. Si TRMNL retire l'adresse ou si la clé manque, la section garde son dernier état.
// Chaque nouveau terme passe UNE fois par Mistral pour trouver ses équivalents anglais (météo → weather, uhr → clock),
// puis on le rapproche du catalogue : recettes déjà là (publiées avant) ou recette qui l'a comblé (publiée après).
// Aucune dépendance : Node 20+. Ne casse jamais le workflow.
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'public/data';
const FILE = path.join(OUT, 'wanted.json');
const API = 'https://trmnl.com/api/search_insights';
const MISTRAL_MODEL = 'mistral-small-latest';
const DAY = 864e5;
const BANDS = ['5+', '10+', '15+', '20+'];
const band = d => Math.max(0, BANDS.indexOf(d));
const now = new Date().toISOString();

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

// Garde-fous en plus de ceux de TRMNL : rien qui ressemble à une donnée personnelle ou à du bruit
const keyOf = q => String(q || '').normalize('NFC').toLowerCase().replace(/^#+/, '').replace(/\s+/g, ' ').trim();
function acceptable(k) {
  if (k.length < 2 || k.length > 40) return false;
  if (k.split(' ').length > 5) return false;
  if (/[@]|https?:|www\.|\.com\b|\d{4,}|[<>{}\\]/.test(k)) return false;
  if (!/\p{L}/u.test(k)) return false;
  return true;
}

async function fetchInsights() {
  const key = process.env.TRMNL_API_KEY;
  if (!key) { console.log('TRMNL_API_KEY absente : liste gardée telle quelle.'); return null; }
  try {
    const res = await fetch(API, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'trmnl-creators-stats (GitHub Actions)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const list = Array.isArray(j) ? j : j.data;
    if (!Array.isArray(list)) throw new Error('format inattendu');
    return list.filter(x => x && typeof x.query === 'string');
  } catch (e) {
    console.log(`Search insights indisponible (${e.message}) : liste gardée telle quelle.`);
    return null;
  }
}

// Un seul appel Mistral pour tous les termes jamais vus : équivalents anglais + courte explication FR/EN
async function enrich(keys) {
  const key = process.env.MISTRAL_API_KEY;
  if (!keys.length || !key) return {};
  const prompt = `People searched these terms in the plugin catalog of TRMNL (a small e-ink dashboard screen) and found nothing.
For each term, give:
- "kw": 1 to 4 lowercase English keywords that a plugin answering this search would likely contain in its name or description. Translate non-English words (météo → weather, uhr → clock, vær → weather), fix typos (calander → calendar), keep brand or product names as they are (obsidian, todoist, paprika). Keep them specific: no generic words like "app", "display", "data", "info".
- "fr": what the person is probably looking for, in French, 2 to 7 words (e.g. "Météo locale", "Notes Obsidian", "Horloge").
- "en": the same in English, 2 to 7 words.
- "ok": false only if the term is meaningless noise or looks like personal data; otherwise true.
Terms: ${JSON.stringify(keys)}
Reply with only a JSON object mapping each term exactly as given to {"kw":[...],"fr":"...","en":"...","ok":true}.`;
  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MISTRAL_MODEL, temperature: 0.1, max_tokens: 2500, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const out = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    return out && typeof out === 'object' ? out : {};
  } catch (e) {
    console.log(`Appel Mistral : ${e.message} (nouvel essai au prochain passage)`);
    return {};
  }
}

const clean = s => String(s || '').replace(/[<>]/g, '').trim().slice(0, 60);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = w => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}($|[^\\p{L}\\p{N}])`, 'iu');

async function main() {
  const prev = await readJSON(FILE, { v: 1, terms: {} });
  const terms = prev.terms || {};
  const latest = await readJSON(path.join(OUT, 'latest.json'), null);
  const recipes = latest?.recipes || [];

  const list = await fetchInsights();
  if (list) {
    const seen = new Set();
    for (const x of list) {
      const k = keyOf(x.query);
      if (!acceptable(k) || seen.has(k)) continue;
      seen.add(k);
      const t = terms[k] || (terms[k] = { q: k, first: now, peak: x.demand });
      t.demand = BANDS.includes(x.demand) ? x.demand : '5+';
      if (band(t.demand) > band(t.peak)) t.peak = t.demand;
      t.last = now; t.active = true;
    }
    for (const [k, t] of Object.entries(terms)) if (!seen.has(k) && t.active) { t.active = false; t.gone = now; }
    prev.fetched_at = now;
    console.log(`Search insights : ${list.length} terme(s) reçus, ${seen.size} retenus.`);
  }

  // Équivalents anglais : seulement pour les termes jamais traités (un appel par passage au plus)
  const todo = Object.keys(terms).filter(k => terms[k].active && !terms[k].kw).slice(0, 40);
  const ai = await enrich(todo);
  for (const k of todo) {
    const a = ai[k] || ai[terms[k].q];
    if (!a) continue;
    const kw = [...new Set([k, ...(Array.isArray(a.kw) ? a.kw : [])].map(w => String(w).toLowerCase().trim()).filter(w => w.length >= 2 && w.length <= 30))].slice(0, 5);
    Object.assign(terms[k], { kw, fr: clean(a.fr), en: clean(a.en), ok: a.ok !== false });
  }

  // Rapprochement avec le catalogue (refait à chaque passage : de nouvelles recettes arrivent)
  if (recipes.length) {
    const txt = recipes.map(r => ({ r, t: `${r.n} ${r.d || ''} ${(r.c || []).join(' ')}` }));
    for (const t of Object.values(terms)) {
      const kws = t.kw || [t.q];
      const res = kws.map(wordRe);
      const hits = txt.filter(({ t: s }) => res.some(re => re.test(s))).map(x => x.r);
      const first = Date.parse(t.first);
      const before = hits.filter(r => Date.parse(r.p) < first).sort((a, b) => b.s - a.s);
      // Comblé : une recette publiée APRÈS l'apparition du terme dans notre relevé (on garde le premier trouvé)
      const after = hits.filter(r => Date.parse(r.p) >= first).sort((a, b) => Date.parse(a.p) - Date.parse(b.p));
      t.existing = before.slice(0, 3).map(r => r.id);
      t.n_existing = before.length;
      if (!t.filled && after.length) t.filled = { id: after[0].id, at: now };
      if (t.filled && !recipes.some(r => r.id === t.filled.id)) delete t.filled;
    }
  }

  // Ménage : un terme disparu depuis plus de 90 jours et jamais comblé sort de l'historique
  for (const [k, t] of Object.entries(terms)) if (!t.active && !t.filled && t.gone && Date.now() - Date.parse(t.gone) > 90 * DAY) delete terms[k];

  prev.v = 1; prev.updated_at = now; prev.terms = terms;
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(prev));
  const act = Object.values(terms).filter(t => t.active).length;
  console.log(`wanted.json : ${act} terme(s) demandé(s), ${Object.values(terms).filter(t => t.filled).length} comblé(s).`);
}

main().catch(e => console.log(`Plugins recherchés : erreur ${e.message} (sans gravité, le site est publié quand même)`));
