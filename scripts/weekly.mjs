// « La semaine en bref » : bilans hebdomadaires du lundi au dimanche, à partir des relevés déjà collectés.
// - weekly.json : la semaine en cours (du lundi à maintenant) + toutes les semaines passées, du lundi au dimanche ;
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

// Lundi 00:00 UTC de la semaine qui contient ms (les relevés quotidiens sont pris à 00:00 UTC : les semaines tombent pile dessus)
function mondayOf(ms) { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY; }

// Bilan d'une semaine calendaire (lundi → dimanche) entre deux relevés.
// connAt(id) : connexions au relevé de début ; connEnd(r) : connexions au relevé de fin (ou maintenant pour la semaine en cours).
function summarize({ from, to, live }, latest, daily, names) {
  const pos = new Map((daily.idx || []).map(([id], k) => [id, k]));
  const snapAt = ms => { let best = null, gap = Infinity; for (const s of daily.snaps) { const g = Math.abs(Date.parse(s.t) - ms); if (g < gap) { gap = g; best = s; } } return gap <= 1.5 * DAY ? best : null; };
  const s0 = snapAt(from); if (!s0) return null;
  const s1 = live ? null : snapAt(to); if (!live && !s1) return null;
  const conn = (snap, id) => { const k = pos.get(id); if (k == null || snap.i[k] == null) return null; return snap.i[k] + (snap.f?.[k] || 0); };
  const t0 = Date.parse(s0.t), t1 = live ? Date.parse(latest.generated_at) : Date.parse(s1.t);
  const nameOf = u => names?.[u] || null;
  const born = r => r.p ? Date.parse(r.p) : null;
  const milestones = [], gains = [], fresh = [];
  for (const r of latest.recipes) {
    const b = born(r);
    if (b && b >= t1) continue;                                   // publiée après la semaine
    const end = live ? r.s : conn(s1, r.id);
    if (end == null) continue;
    const start = conn(s0, r.id) ?? (b && b >= t0 ? 0 : null);
    if (start == null) continue;
    const top = MILESTONES.filter(T => start < T && T <= end).pop();
    if (top) milestones.push({ id: r.id, n: r.n, u: r.u, T: top, s: end });
    if (end - start > 0) gains.push({ id: r.id, n: r.n, u: r.u, g: end - start });
    if (b && b >= t0) fresh.push({ id: r.id, n: r.n, u: r.u, s: end });
  }
  milestones.sort((a, b) => b.T - a.T || b.s - a.s);
  gains.sort((a, b) => b.g - a.g);
  fresh.sort((a, b) => b.s - a.s);
  const newCreators = latest.creators.filter(c => c.first && Date.parse(c.first) >= t0 && Date.parse(c.first) < t1).length;
  return {
    from: new Date(from).toISOString(), to: new Date(live ? t1 : to).toISOString(), week: isoWeek(from + 3 * DAY), live: !!live,
    new_recipes: fresh.length, new_creators: newCreators, gained: gains.reduce((n, g) => n + g.g, 0),
    new_list: fresh.slice(0, 8).map(r => ({ ...r, un: nameOf(r.u) })),
    milestones: milestones.slice(0, 15).map(m => ({ ...m, un: nameOf(m.u) })),
    top: gains.slice(0, 10).map(g => ({ ...g, un: nameOf(g.u) })),
    totals: live ? latest.totals || null : null,
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
  if (!latest || !daily?.snaps?.length) { log('Données manquantes : semaine en bref ignorée pour ce passage.'); return; }
  const names = await readJSON(path.join(ROOT, 'names.json'), {});
  const now = Date.parse(latest.generated_at);

  // Toutes les semaines complètes depuis le premier relevé quotidien, recalculées à chaque passage (les noms suivent les revendications)
  const first = mondayOf(Date.parse(daily.snaps[0].t) + DAY - 1);   // premier lundi couvert par un relevé
  const thisMonday = mondayOf(now);
  const weeks = [];
  for (let m = first; m < thisMonday; m += 7 * DAY) {
    const w = summarize({ from: m, to: m + 7 * DAY }, latest, daily, names);
    if (w) weeks.unshift(w);
  }
  const current = summarize({ from: thisMonday, to: now, live: true }, latest, daily, names);

  const store = { v: 2, current, weeks: weeks.slice(0, KEEP_ISSUES * 2), issues: weeks.slice(0, KEEP_ISSUES) };
  await fs.writeFile(path.join(DATA, 'weekly.json'), JSON.stringify(store));
  if (SITE !== '/') {
    await fs.writeFile(path.join(ROOT, 'feed.xml'), feed(store.issues, false));
    await fs.writeFile(path.join(ROOT, 'feed-en.xml'), feed(store.issues, true));
  }
  log(`Semaine en cours : ${current ? current.new_recipes + ' nouvelles recettes' : 'pas encore de relevé'} ; ${weeks.length} semaine(s) archivée(s).`);
}

try { await main(); } catch (e) { log(`${e.message} (ignoré, le reste du workflow continue).`); }
