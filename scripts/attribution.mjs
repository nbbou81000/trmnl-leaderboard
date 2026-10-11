// Installations apportées par le site (estimation).
// Chaque heure : reprend les clics du site vers une page de recette (compteur de visites Supabase),
// et compare chacun aux relevés horaires d'installations + forks de la recette (public/data/hourly.json).
// Un clic est « probable » si la recette a gagné, dans les 2 heures qui suivent, plus que son rythme habituel
// ne l'expliquerait. Le résultat est enregistré dans la table privée recipe_clicks (supabase/installations.sql).
// Nécessite les secrets SUPABASE_URL (variable) et SUPABASE_SERVICE_KEY ; sans eux, l'étape ne fait rien.
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'public/data';
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const H = 3600e3;
const WINDOW = 2 * H;          // fenêtre d'observation après le clic
const LOOKBACK = 9 * 24 * H;   // clics repris (le relevé horaire garde ~8 jours)
const BEFORE_MAX = 75 * 60e3;  // le relevé « avant » doit dater de moins de 75 min avant le clic
const SPAN_MAX = 5 * H;        // au-delà, un trou dans les relevés empêche de conclure
const BASE = 7 * 24 * H;       // rythme habituel calculé sur 7 jours
const BASE_MIN = 12 * H;       // moins d'historique : recette trop récente pour conclure
const BUSY = 0.5;              // au-delà d'une demi-installation « attendue » dans la fenêtre : impossible de trancher
const REPEAT = 24 * H;         // même visiteur, même recette, dans les 24 h : pas une nouvelle chance

const headers = KEY.startsWith('sb_secret_') ? { apikey: KEY } : { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function sb(p, opt = {}) {
  const r = await fetch(`${SB}/rest/v1/${p}`, { ...opt, headers: { ...headers, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(`${p.split('?')[0]} : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
async function all(p) {
  const rows = [];
  for (let f = 0; ; f += 1000) {
    const page = await sb(p, { headers: { Range: `${f}-${f + 999}` } });
    rows.push(...page); if (page.length < 1000) break;
  }
  return rows;
}

// « recipe:123@jour » → { id: '123', source: 'jour' } ; les anciens clics des Incontournables n'ont pas de source
function parseTarget(path, target) {
  const m = /^recipe:(\d+)(?:@([a-z0-9_-]+))?/.exec(target || '');
  if (!m) return null;
  return { id: m[1], source: m[2] || (path === 'incontournable-installe' ? 'incontournables' : 'autre') };
}

export function evaluate(clicks, done, hourly, now = Date.now()) {
  const pos = new Map(hourly.idx.map(([id, u], k) => [id, { k, u }]));
  const snaps = hourly.snaps.map(s => ({ t: Date.parse(s.t), i: s.i, f: s.f }));
  const val = (s, k) => (s.i[k] == null ? null : s.i[k] + (s.f[k] || 0));
  const before = t => { let r = null; for (const s of snaps) { if (s.t <= t) r = s; else break; } return r; };
  const after = t => snaps.find(s => s.t >= t) || null;
  const credits = new Map();   // recette → fenêtres [début, fin] déjà créditées d'une installation
  const lastSeen = new Map();  // visiteur|recette → heure du dernier clic
  const rows = [];

  for (const c of clicks.slice().sort((a, b) => a.at - b.at || a.id - b.id)) {
    const key = `${c.visitor}|${c.recipe}`, prev = lastSeen.get(key);
    lastSeen.set(key, c.at);
    const old = done.get(c.id);
    if (old) {   // déjà vérifié lors d'un passage précédent : sert seulement de contexte
      if (old.verdict === 'probable' && old.win_start) (credits.get(c.recipe) || credits.set(c.recipe, []).get(c.recipe)).push([Date.parse(old.win_start), Date.parse(old.win_end)]);
      continue;
    }
    const p = pos.get(c.recipe);
    const row = { hit_id: c.id, at: new Date(c.at).toISOString(), recipe_id: c.recipe, creator_id: p?.u ?? null, source: c.source,
      verdict: 'indetermine', gained: null, expected: null, win_start: null, win_end: null };
    if (prev != null && c.at - prev < REPEAT) { row.verdict = 'repetition'; rows.push(row); continue; }
    if (!p) { rows.push(row); continue; }                       // recette absente des relevés
    const A = before(c.at), B = after(c.at + WINDOW);
    if (!B) { if (now - c.at < 6 * H) continue; rows.push(row); continue; }   // relevé suivant pas encore là : on réessaiera
    if (!A || c.at - A.t > BEFORE_MAX || B.t - A.t > SPAN_MAX) { rows.push(row); continue; }
    const vA = val(A, p.k), vB = val(B, p.k);
    if (vA == null || vB == null) { rows.push(row); continue; }
    const B0 = snaps.find(s => s.t >= A.t - BASE && val(s, p.k) != null);
    const baseH = (A.t - B0.t) / H;
    row.win_start = new Date(A.t).toISOString(); row.win_end = new Date(B.t).toISOString();
    row.gained = vB - vA;
    if (baseH * H < BASE_MIN) { rows.push(row); continue; }       // recette trop récente
    const expected = Math.max(0, (vA - val(B0, p.k)) / baseH) * ((B.t - A.t) / H);
    row.expected = Math.round(expected * 100) / 100;
    if (expected > BUSY) { rows.push(row); continue; }             // recette trop active pour trancher
    const list = credits.get(c.recipe) || [];
    const overlap = list.filter(([s, e]) => s < B.t && e > A.t).length;
    if (row.gained - overlap - expected >= 0.5) {
      row.verdict = 'probable';
      list.push([A.t, B.t]); credits.set(c.recipe, list);
    } else row.verdict = 'aucune';
    rows.push(row);
  }
  return rows;
}

async function main() {
  if (!SB || !KEY) { console.log('Installations apportées : secret SUPABASE_SERVICE_KEY absent, étape ignorée.'); return; }
  const hourly = JSON.parse(await fs.readFile(path.join(OUT, 'hourly.json'), 'utf8'));
  const since = new Date(Date.now() - LOOKBACK).toISOString();
  const hits = await all(`visit_hits?select=id,at,visitor,path,target&kind=eq.event&path=in.(recette-cliquee,incontournable-installe)&target=like.recipe:*&at=gte.${since}&order=id`);
  const clicks = hits.map(h => { const t = parseTarget(h.path, h.target); return t && { id: h.id, at: Date.parse(h.at), visitor: h.visitor, recipe: t.id, source: t.source }; }).filter(Boolean);
  let doneRows;
  try { doneRows = await all(`recipe_clicks?select=hit_id,verdict,win_start,win_end&at=gte.${since}`); }
  catch (e) { if (/404|PGRST205|does not exist/i.test(e.message)) { console.log('Installations apportées : table pas encore créée (coller supabase/installations.sql dans Supabase).'); return; } throw e; }
  const done = new Map(doneRows.map(r => [Number(r.hit_id), r]));
  const rows = evaluate(clicks, done, hourly);
  if (rows.length) await sb('recipe_clicks?on_conflict=hit_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  await sb(`recipe_clicks?at=lt.${new Date(Date.now() - 395 * 24 * H).toISOString()}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  const n = v => rows.filter(r => r.verdict === v).length;
  console.log(`Installations apportées : ${clicks.length} clics sur 9 jours, ${rows.length} vérifiés maintenant (probables ${n('probable')}, aucune ${n('aucune')}, indéterminés ${n('indetermine')}, répétitions ${n('repetition')}).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { await main(); } catch (e) { console.log(`Installations apportées : ${e.message} (ignoré, le reste du workflow continue).`); }
}
