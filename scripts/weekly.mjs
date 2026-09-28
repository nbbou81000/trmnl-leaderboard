// « La semaine en bref » : résumé automatique des 7 derniers jours, à partir des relevés déjà collectés.
// - weekly.json : la semaine glissante (recalculée à chaque passage) + les éditions figées chaque lundi ;
// - feed.xml (français) et feed-en.xml (anglais) : un article RSS par édition hebdomadaire.
// Aucun appel externe, aucune IA : tout vient de latest.json et daily.json.
// Usage : SITE_URL=https://…/ node scripts/weekly.mjs public
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.argv[2] || 'public';
const DATA = path.join(ROOT, 'data');
const SITE = (process.env.SITE_URL || '').replace(/\/?$/, '/');
const DAY = 864e5;
const MILESTONES = [50, 100, 250, 500, 1000, 2000, 5000];
const KEEP_ISSUES = 26;
const log = (...a) => console.log('[semaine]', ...a);

async function readJSON(p, fallback) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; } }

// Semaine ISO (lundi → dimanche), en UTC, par exemple « 2026-W40 »
function isoWeek(ms) {
  const d = new Date(ms); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = d.getUTCFullYear();
  const w = Math.ceil(((d - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

function summarize(latest, daily, names) {
  const now = Date.parse(latest.generated_at);
  const target = now - 7 * DAY;
  // Relevé quotidien le plus proche d'il y a 7 jours (au plus 36 h d'écart)
  let snap = null, best = Infinity;
  for (const s of daily?.snaps || []) { const gap = Math.abs(Date.parse(s.t) - target); if (gap < best) { best = gap; snap = s; } }
  if (!snap || best > 1.5 * DAY) return null;
  const pos = new Map((daily.idx || []).map(([id], k) => [id, k]));
  const connThen = id => { const k = pos.get(id); if (k == null || snap.i[k] == null) return null; return snap.i[k] + (snap.f[k] || 0); };
  const from = Date.parse(snap.t);

  const nameOf = u => names?.[u] || null;
  const milestones = [], gains = [];
  for (const r of latest.recipes) {
    // Même base que la colonne « +7 j » du site quand elle existe, sinon le relevé quotidien
    const old = r.d7 != null ? r.s - r.d7 : connThen(r.id);
    const before = old ?? (r.p && Date.parse(r.p) > from ? 0 : null);
    if (before == null) continue;
    const top = MILESTONES.filter(T => before < T && T <= r.s).pop();
    if (top) milestones.push({ id: r.id, n: r.n, u: r.u, T: top, s: r.s });
    if (r.s - before > 0) gains.push({ id: r.id, n: r.n, u: r.u, g: r.s - before });
  }
  milestones.sort((a, b) => b.T - a.T || b.s - a.s);
  gains.sort((a, b) => b.g - a.g);
  const newRecipes = latest.recipes.filter(r => r.p && Date.parse(r.p) > from);
  const newCreators = latest.creators.filter(c => c.first && Date.parse(c.first) > from);

  return {
    from: new Date(from).toISOString(), to: latest.generated_at, week: isoWeek(now),
    new_recipes: newRecipes.length, new_creators: newCreators.length,
    new_list: newRecipes.sort((a, b) => b.s - a.s).slice(0, 5).map(r => ({ id: r.id, n: r.n, u: r.u, un: nameOf(r.u), s: r.s })),
    milestones: milestones.slice(0, 12).map(m => ({ ...m, un: nameOf(m.u) })),
    top: gains.slice(0, 5).map(g => ({ ...g, un: nameOf(g.u) })),
    totals: latest.totals || null,
  };
}

const xml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function issueHTML(w, en) {
  const dt = iso => new Date(iso).toLocaleDateString(en ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short' });
  const link = r => `<a href="https://trmnl.com/recipes/${r.id}">${xml(r.n)}</a>`;
  const t = (fr, e) => en ? e : fr;
  let h = `<p>${t(`Du ${dt(w.from)} au ${dt(w.to)} :`, `From ${dt(w.from)} to ${dt(w.to)}:`)} <b>${w.new_recipes}</b> ${t('nouvelles recettes', 'new recipes')}, <b>${w.new_creators}</b> ${t('nouveaux créateurs', 'new creators')}.</p>`;
  if (w.milestones.length) h += `<h3>${t('Paliers franchis', 'Milestones reached')}</h3><ul>${w.milestones.map(m => `<li>${link(m)} : ${m.T} ${t('connexions', 'connections')}${m.T === 50 ? ' (Creator Fund)' : ''}</li>`).join('')}</ul>`;
  if (w.top.length) h += `<h3>${t('Plus fortes hausses', 'Biggest gains')}</h3><ol>${w.top.map(g => `<li>${link(g)} +${g.g}</li>`).join('')}</ol>`;
  h += `<p><a href="${xml(SITE)}${en ? '?lang=en#this-week' : '#semaine'}">${t('Voir la semaine sur le palmarès', 'See the week on the leaderboard')}</a></p>`;
  return h;
}
function feed(issues, en) {
  const t = (fr, e) => en ? e : fr;
  const self = `${SITE}${en ? 'feed-en.xml' : 'feed.xml'}`;
  const items = issues.map(w => {
    const title = t(`La semaine en bref : ${new Date(w.from).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} au ${new Date(w.to).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      `The week in brief: ${new Date(w.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} to ${new Date(w.to).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`);
    return `<item><title>${xml(title)}</title><link>${xml(SITE + (en ? '?lang=en#this-week' : '#semaine'))}</link><guid isPermaLink="false">trmnl-leaderboard-${w.week}${en ? '-en' : ''}</guid><pubDate>${new Date(w.to).toUTCString()}</pubDate><description><![CDATA[${issueHTML(w, en)}]]></description></item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${xml(t('Palmarès des créateurs TRMNL : la semaine en bref', 'TRMNL Creator Leaderboard: the week in brief'))}</title>
<link>${xml(SITE + (en ? '?lang=en' : ''))}</link>
<description>${xml(t('Chaque lundi, les recettes TRMNL qui ont franchi un palier, les plus fortes hausses et les nouveaux créateurs.', 'Every Monday, the TRMNL recipes that reached a milestone, the biggest gains and the new creators.'))}</description>
<language>${en ? 'en' : 'fr'}</language>
<atom:link href="${xml(self)}" rel="self" type="application/rss+xml"/>
${items}
</channel></rss>
`;
}

async function main() {
  const latest = await readJSON(path.join(DATA, 'latest.json'), null);
  const daily = await readJSON(path.join(DATA, 'daily.json'), null);
  if (!latest || !daily) { log('Données manquantes : semaine en bref ignorée pour ce passage.'); return; }
  const names = await readJSON(path.join(ROOT, 'names.json'), {});
  const store = await readJSON(path.join(DATA, 'weekly.json'), { v: 1, current: null, issues: [] });

  const cur = summarize(latest, daily, names);
  if (!cur) { log("Pas encore 7 jours d'historique quotidien."); return; }
  store.current = cur;

  // Une édition figée par semaine : le lundi (UTC), ou tout de suite s'il n'y en a encore aucune
  const isMonday = new Date(Date.parse(latest.generated_at)).getUTCDay() === 1;
  if (!store.issues.length || (isMonday && store.issues[0].week !== cur.week)) {
    store.issues.unshift(cur);
    store.issues = store.issues.slice(0, KEEP_ISSUES);
    log(`Nouvelle édition figée : ${cur.week}.`);
  }

  await fs.writeFile(path.join(DATA, 'weekly.json'), JSON.stringify(store));
  if (SITE !== '/') {
    await fs.writeFile(path.join(ROOT, 'feed.xml'), feed(store.issues, false));
    await fs.writeFile(path.join(ROOT, 'feed-en.xml'), feed(store.issues, true));
  }
  log(`${cur.new_recipes} nouvelles recettes, ${cur.milestones.length} paliers, ${store.issues.length} édition(s) dans le flux RSS.`);
}

try { await main(); } catch (e) { log(`${e.message} (ignoré, le reste du workflow continue).`); }
