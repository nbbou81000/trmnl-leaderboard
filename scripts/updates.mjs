// « Recettes mises à jour » : compare les empreintes du relevé précédent (meta.json) à celles du relevé
// qui vient d'être fait (meta-next.json, écrit par fetch-stats.mjs) et tient le journal updates.json.
// Aucun appel réseau, aucune IA. Voir updates-lib.mjs pour ce qui est suivi (et ce qui ne peut pas l'être).
// Usage : node scripts/updates.mjs public/data
import fs from 'node:fs/promises';
import path from 'node:path';
import { diff, merge } from './updates-lib.mjs';

const OUT = process.argv[2] || 'public/data';
const H = 3600e3, DAY = 24 * H;
const KEEP_ITEMS = 300, KEEP_DAYS = 120;   // journal gardé
const MERGE_H = 24;                        // changements d'une même recette regroupés s'ils se suivent à moins de 24 h
const FORGET_DAYS = 30;                    // empreinte d'une recette disparue gardée 30 jours (retour sans fausse « mise à jour »)
const log = (...a) => console.log('[mises à jour]', ...a);

async function readJSON(p, fb) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fb; } }

async function main() {
  const nextFile = path.join(OUT, 'meta-next.json');
  const next = await readJSON(nextFile, null);
  if (!next?.r) { log('Pas de nouveau relevé (republication seule) : rien à comparer.'); return; }
  const prev = await readJSON(path.join(OUT, 'meta.json'), null);
  const store = await readJSON(path.join(OUT, 'updates.json'), null) || { v: 1, since: null, items: [] };
  const now = Date.parse(next.t) || Date.now(), day = new Date(now).toISOString().slice(0, 10);
  const ids = Object.keys(next.r);

  const events = [];
  if (!prev?.r) {
    store.since = new Date(now).toISOString();
    log(`Premier passage : ${ids.length} empreintes enregistrées, le suivi démarre maintenant.`);
  } else {
    for (const id of ids) {
      const a = prev.r[id]; if (!a) continue;                 // recette nouvelle : annoncée ailleurs (flux « Nouvelles recettes »)
      const ch = diff(a, next.r[id]);
      if (ch.length) events.push({ id, u: next.r[id].u, n: next.r[id].n, ch });
    }
    // Garde-fou : si TRMNL change la forme de son API, des centaines de recettes « changent » d'un coup.
    // Dans ce cas on n'annonce rien, on repart simplement de la nouvelle forme.
    const limit = Math.max(40, Math.round(ids.length * 0.05));
    if (events.length > limit) {
      log(`${events.length} recettes différentes d'un seul coup (plus de ${limit}) : changement de forme de l'API probable, rien n'est annoncé.`);
      events.length = 0; store.skipped = new Date(now).toISOString();
    }
  }

  const at = new Date(now).toISOString();
  for (const e of events) {
    const recent = store.items.find(x => x.id === e.id && now - Date.parse(x.at) <= MERGE_H * H);
    if (recent) {
      recent.ch = merge(recent.ch, e.ch); recent.at = at; recent.n = e.n; recent.u = e.u;
      if (!recent.ch.length) store.items = store.items.filter(x => x !== recent);   // aller-retour : plus rien à signaler
    } else store.items.push({ id: e.id, u: e.u, n: e.n, t0: at, at, ch: e.ch });
  }
  store.items = store.items.filter(x => now - Date.parse(x.at) <= KEEP_DAYS * DAY)
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, KEEP_ITEMS);
  store.checked = at;
  if (events.length) log(`${events.length} recette(s) mise(s) à jour : ${events.slice(0, 12).map(e => e.n).join(', ')}${events.length > 12 ? '…' : ''}.`);
  else if (prev?.r && store.skipped !== at) log('Aucune mise à jour repérée depuis le relevé précédent.');

  // Nouvelle référence : empreintes du jour + celles des recettes momentanément absentes (gardées FORGET_DAYS jours)
  const meta = { v: 1, t: at, r: {} };
  for (const id of ids) meta.r[id] = { ...next.r[id], seen: day };
  for (const [id, fp] of Object.entries(prev?.r || {})) {
    if (meta.r[id]) continue;
    if (fp.seen && now - Date.parse(fp.seen) > FORGET_DAYS * DAY) continue;
    meta.r[id] = fp;
  }
  await fs.writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta));
  await fs.writeFile(path.join(OUT, 'updates.json'), JSON.stringify(store));
  await fs.rm(nextFile, { force: true });
}

try { await main(); } catch (e) { log(`${e.message} (ignoré, le reste du workflow continue).`); }
