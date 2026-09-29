// Flux RSS du palmarès (en plus de « La semaine en bref », produit par weekly.mjs) :
//  - feed-eink.xml / feed-eink-en.xml         : les articles complets de l'onglet « Actu e-ink » ;
//  - feed-recettes.xml / feed-recettes-en.xml : chaque nouvelle recette publique, avec le texte « About This Plugin »
//                                               de son auteur et, quand TRMNL l'a annoncée, sa petite phrase d'annonce ;
//  - feed-paliers.xml / feed-paliers-en.xml   : chaque fois qu'une recette franchit 50, 100, 250, 500… connexions ;
//  - feed-createur-<n°>.xml (+ -en)           : les statistiques heure par heure d'un créateur (voir STATS_FEEDS).
// Aucune IA ici : un seul appel à l'API publique de TRMNL par passage (les 50 dernières recettes publiées).
// Usage : SITE_URL=https://…/ node scripts/feeds.mjs public
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.argv[2] || 'public';
const DATA = path.join(ROOT, 'data');
const SITE = (process.env.SITE_URL || '').replace(/\/?$/, '/');
const MILESTONES = [50, 100, 250, 500, 1000, 2000, 5000];
// Créateurs qui ont leur flux de statistiques horaires : ajoutez un numéro pour en créer un autre
const STATS_FEEDS = ['40325'];
// Parmi eux, ceux qui veulent un article à chaque relevé horaire, même quand rien n'a bougé
const STATS_EVERY_HOUR = ['40325'];
const KEEP = { eink: 30, recipes: 40, milestones: 60 };
const DAY = 864e5;
const log = (...a) => console.log('[flux RSS]', ...a);

async function readJSON(p, fb) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fb; } }
const xml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cdata = s => `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]&gt;')}]]>`;
const recipeURL = id => `https://trmnl.com/recipes/${id}`;

function channel({ file, en, title, desc, link, items }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<title>${xml(title)}</title>
<link>${xml(link)}</link>
<description>${xml(desc)}</description>
<language>${en ? 'en' : 'fr'}</language>
<atom:link href="${xml(SITE + file)}" rel="self" type="application/rss+xml"/>
${items.map(it => `<item><title>${xml(it.title)}</title><link>${xml(it.link)}</link><guid isPermaLink="false">${xml(it.guid)}</guid><pubDate>${new Date(it.date).toUTCString()}</pubDate>${it.cats ? it.cats.map(c => `<category>${xml(c)}</category>`).join('') : ''}${it.img ? `<media:content url="${xml(it.img)}" medium="image"/>` : ''}<description>${cdata(it.summary)}</description><content:encoded>${cdata(it.html)}</content:encoded></item>`).join('\n')}
</channel></rss>
`;
}

// ─── 1. Actu e-ink ────────────────────────────────────────────────────────────
function einkFeed(news, en) {
  const t = (fr, e) => en ? e : fr;
  const cat = { screens: t('Écrans & liseuses', 'Screens & e-readers'), diy: t('DIY & projets', 'DIY & projects'), dashboards: 'Dashboards' };
  const items = (news?.articles || []).filter(a => a.body_fr).slice(0, KEEP.eink).map(a => {
    const title = en ? a.title_en : a.title_fr, lead = en ? a.lead_en : a.lead_fr, body = en ? a.body_en : a.body_fr;
    return {
      title, date: a.d, guid: `eink-${a.id}${en ? '-en' : ''}`, img: a.img, cats: [cat[a.cat] || a.cat],
      link: `${SITE}${en ? '?lang=en' : ''}#eink/${a.id}`, summary: lead,
      html: `${a.img ? `<p><img src="${xml(a.img)}" alt=""></p>` : ''}${lead ? `<p><strong>${xml(lead)}</strong></p>` : ''}${body}
        <p>${t('Source', 'Source')} : <a href="${xml(a.u)}">${xml(a.src)}</a>${a.hn ? ` · <a href="${xml(a.hn)}">${t('discussion Hacker News', 'Hacker News thread')}</a>` : ''}</p>
        <p><em>${t("Article rédigé par une IA (Mistral) à partir de la source citée : vérifiez les détails importants chez la source.", 'Article written by an AI (Mistral) from the cited source: check important details at the source.')}</em></p>`,
    };
  });
  return channel({
    file: en ? 'feed-eink-en.xml' : 'feed-eink.xml', en, items, link: `${SITE}${en ? '?lang=en' : ''}#eink`,
    title: t('Palmarès TRMNL : actu e-ink & dashboards', 'TRMNL Leaderboard: e-ink & dashboards news'),
    desc: t("Écrans e-ink, liseuses, projets DIY et tableaux de bord maison : des articles complets, rédigés en français à partir de sources spécialisées.", 'E-ink screens, e-readers, DIY projects and home dashboards: complete articles written from specialized sources.'),
  });
}

// ─── 2. Nouvelles recettes ────────────────────────────────────────────────────
async function freshRecipes() {
  const res = await fetch('https://trmnl.com/recipes.json?page=1&per_page=50', { headers: { 'User-Agent': 'Mozilla/5.0 (TRMNL Creator Leaderboard; RSS)' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`API TRMNL HTTP ${res.status}`);
  const j = await res.json();
  return (j.data || j || []).map(r => ({
    id: String(r.id), u: String(r.user_id), n: r.name, d: r.description || '', p: r.published_at,
    sc: r.screenshot_url || null, ic: r.icon_url || null,
    about: String(r.author_bio?.description || '').trim().slice(0, 2000),
    cats: String(r.author_bio?.category || '').split(',').map(c => c.trim()).filter(Boolean),
  }));
}
function recipesFeed(list, names, en) {
  const t = (fr, e) => en ? e : fr;
  const items = list.slice(0, KEEP.recipes).map(r => {
    const handle = r.ann?.s?.match(/community member\s+([^.,;]+)/i)?.[1]?.trim();   // pseudo donné par l'annonce de TRMNL
    const who = names[r.u] || handle || t(`Créateur #${r.u}`, `Creator #${r.u}`);
    const about = r.about ? r.about.split(/\n{2,}|\r\n\r\n/).map(p => `<p>${xml(p).replace(/\n/g, '<br>')}</p>`).join('') : '';
    return {
      title: t(`Nouvelle recette : ${r.n}`, `New recipe: ${r.n}`), date: r.p, guid: `recipe-${r.id}${en ? '-en' : ''}`,
      link: recipeURL(r.id), img: r.sc, cats: r.cats,
      summary: r.ann ? r.ann.s : `${t('Par', 'By')} ${who}${r.d ? ` · ${r.d}` : ''}`,
      html: `${r.sc ? `<p><img src="${xml(r.sc)}" alt="${xml(r.n)}"></p>` : ''}
        <p><strong>${xml(r.n)}</strong>${r.d ? ` : ${xml(r.d)}` : ''}</p>
        <p>${t('Par', 'By')} <a href="${xml(`${SITE}${en ? '?lang=en' : ''}#${en ? 'creator' : 'createur'}/${r.u}`)}">${xml(who)}</a>${r.cats.length ? ` · ${xml(r.cats.join(', '))}` : ''}</p>
        ${r.ann ? `<blockquote><p>${xml(r.ann.s)}</p><p><em>${t('Annonce de TRMNL', 'TRMNL announcement')}</em></p></blockquote>` : ''}
        ${about ? `<h3>${t("Le mot de l'auteur (About This Plugin)", 'From the author (About This Plugin)')}</h3>${about}` : ''}
        <p><a href="${xml(recipeURL(r.id))}">${t('Installer la recette sur trmnl.com', 'Install the recipe on trmnl.com')}</a></p>`,
    };
  });
  return channel({
    file: en ? 'feed-recettes-en.xml' : 'feed-recettes.xml', en, items, link: `${SITE}${en ? '?lang=en' : ''}#${en ? 'recipes' : 'recettes'}`,
    title: t('Palmarès TRMNL : nouvelles recettes', 'TRMNL Leaderboard: new recipes'),
    desc: t("Chaque nouvelle recette publique de TRMNL, avec sa capture, le mot de son auteur et l'annonce de TRMNL quand il y en a une.", "Every new public TRMNL recipe, with its screenshot, its author's note and TRMNL's announcement when there is one."),
  });
}

// ─── 3. Paliers ───────────────────────────────────────────────────────────────
function detectMilestones(latest, state, now) {
  const first = !state.lastS;
  state.lastS ||= {};
  const events = [];
  for (const r of latest.recipes) {
    const prev = state.lastS[r.id];
    // Recette jamais vue : on part de 0 seulement si elle vient d'être publiée, sinon on prend son niveau actuel comme base
    const base = prev ?? (r.p && now - Date.parse(r.p) < 2 * DAY ? 0 : r.s);
    const T = MILESTONES.filter(m => base < m && m <= r.s).pop();
    if (T && !first) events.push({ id: r.id, n: r.n, u: r.u, T, s: r.s, d: new Date(now).toISOString() });
    state.lastS[r.id] = Math.max(prev ?? 0, r.s);
  }
  return { events, first };
}
function milestonesFeed(list, names, en) {
  const t = (fr, e) => en ? e : fr;
  const items = list.slice(0, KEEP.milestones).map(m => {
    const who = names[m.u] || t(`Créateur #${m.u}`, `Creator #${m.u}`);
    const cf = m.T === 50 ? t(' : le seuil du Creator Fund', ': the Creator Fund threshold') : '';
    return {
      title: t(`🏁 ${m.n} franchit ${m.T} connexions`, `🏁 ${m.n} reaches ${m.T} connections`), date: m.d, guid: `milestone-${m.id}-${m.T}${en ? '-en' : ''}`,
      link: recipeURL(m.id), summary: t(`${m.n} (${who}) vient de passer ${m.T} connexions${cf}.`, `${m.n} (${who}) just passed ${m.T} connections${cf}.`),
      html: `<p><strong>${xml(m.n)}</strong> ${t('de', 'by')} <a href="${xml(`${SITE}${en ? '?lang=en' : ''}#${en ? 'creator' : 'createur'}/${m.u}`)}">${xml(who)}</a> ${t(`vient de passer <strong>${m.T} connexions</strong>${xml(cf)}`, `just passed <strong>${m.T} connections</strong>${xml(cf)}`)} (${t('installs + forks', 'installs + forks')}).</p>
        <p><a href="${xml(recipeURL(m.id))}">${t('Voir la recette sur trmnl.com', 'See the recipe on trmnl.com')}</a> · <a href="${xml(`${SITE}${en ? '?lang=en' : ''}#${en ? 'recipes' : 'recettes'}`)}">${t('Voir le classement', 'See the ranking')}</a></p>`,
    };
  });
  return channel({
    file: en ? 'feed-paliers-en.xml' : 'feed-paliers.xml', en, items, link: `${SITE}${en ? '?lang=en' : ''}#${en ? 'this-week' : 'semaine'}`,
    title: t('Palmarès TRMNL : paliers atteints', 'TRMNL Leaderboard: milestones'),
    desc: t('Chaque fois qu\'une recette TRMNL franchit 50 (le seuil du Creator Fund), 100, 250, 500, 1 000 connexions ou plus.', 'Every time a TRMNL recipe passes 50 (the Creator Fund threshold), 100, 250, 500, 1,000 connections or more.'),
  });
}

// ─── 4. Statistiques horaires d'un créateur ──────────────────────────────────
// Un article à chaque relevé où quelque chose a bougé (total, classement ou une recette),
// ou à chaque relevé horaire sans exception pour les créateurs listés dans STATS_EVERY_HOUR.
function statsSnapshot(latest, u) {
  const c = latest.creators.find(x => x.u === u); if (!c) return null;
  const recipes = latest.recipes.filter(r => r.u === u).sort((a, b) => b.s - a.s).map(r => ({ id: r.id, n: r.n, i: r.i, f: r.f, s: r.s }));
  return { at: latest.generated_at, total: c.s, i: c.i, f: c.f, rank: c.r, of: latest.creators.length, d24: c.d24 ?? null, recipes };
}
function statsUpdate(state, cur, everyHour) {
  const prev = state.last;
  const before = new Map((prev?.recipes || []).map(r => [r.id, r.s]));
  const recipes = cur.recipes.map(r => ({ ...r, ds: before.has(r.id) ? r.s - before.get(r.id) : null }));
  const changed = !prev || prev.total !== cur.total || prev.rank !== cur.rank || recipes.some(r => r.ds !== 0) || prev.recipes.length !== cur.recipes.length;
  state.last = cur;
  if (!changed && !everyHour) return false;
  state.items = [{ ...cur, recipes, first: !prev, dTotal: prev ? cur.total - prev.total : null, dRank: prev ? prev.rank - cur.rank : null, since: prev?.at || null }, ...(state.items || [])].slice(0, 72);
  return true;
}
const ordEN = n => { const m = n % 100; return n + (m >= 11 && m <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); };
function statsFeed(u, st, names, en) {
  const t = (fr, e) => en ? e : fr;
  const who = names[u] || t(`Créateur #${u}`, `Creator #${u}`);
  const sg = n => n == null ? '' : n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '=';
  const nfmt = n => Number(n).toLocaleString(en ? 'en-US' : 'fr-FR');
  const rankTxt = x => t(`${x.rank}${x.rank === 1 ? 'er' : 'e'} au général`, `${ordEN(x.rank)} overall`);
  const moveTxt = d => d == null || d === 0 ? '' : d > 0 ? t(`▲ ${d} place${d > 1 ? 's' : ''}`, `▲ ${d} spot${d > 1 ? 's' : ''}`) : t(`▼ ${-d} place${-d > 1 ? 's' : ''}`, `▼ ${-d} spot${-d > 1 ? 's' : ''}`);
  const items = (st.items || []).map(x => {
    const title = x.first
      ? t(`📊 ${nfmt(x.total)} connexions · ${rankTxt(x)} (point de départ)`, `📊 ${nfmt(x.total)} connections · ${rankTxt(x)} (starting point)`)
      : `📊 ${nfmt(x.total)} ${t('connexions', 'connections')} (${sg(x.dTotal)}) · ${rankTxt(x)}${moveTxt(x.dRank) ? ` (${moveTxt(x.dRank)})` : ''}`;
    const rows = x.recipes.map(r => `<tr><td><a href="${xml(recipeURL(r.id))}">${xml(r.n)}</a></td><td align="right"><strong>${nfmt(r.s)}</strong> <small>(${r.i} + ${r.f})</small></td><td align="right">${r.ds == null ? t('nouvelle', 'new') : sg(r.ds)}</td></tr>`).join('');
    const moved = x.recipes.filter(r => r.ds).map(r => `${r.n} ${sg(r.ds)}`);
    return {
      title, date: x.at, guid: `stats-${u}-${x.at}${en ? '-en' : ''}`, link: `${SITE}${en ? '?lang=en' : ''}#${en ? 'creator' : 'createur'}/${u}`,
      summary: x.first ? t('Premier relevé : les prochains articles indiqueront les gains et les pertes.', 'First snapshot: the next items will show gains and losses.')
        : (moved.length ? moved.join(' · ') : x.dRank ? t('Changement de classement uniquement.', 'Ranking change only.') : t('Aucun changement depuis le relevé précédent.', 'No change since the previous snapshot.')),
      html: `<p><strong>${t('Total', 'Total')} : ${nfmt(x.total)} ${t('connexions', 'connections')}</strong> (${nfmt(x.i)} installs + ${nfmt(x.f)} forks)${x.first ? '' : ` · <strong>${sg(x.dTotal)}</strong> ${t('depuis le relevé précédent', 'since the previous snapshot')}`}${x.d24 != null ? ` · ${sg(x.d24)} ${t('sur 24 h', 'over 24 h')}` : ''}</p>
        <p>${t('Classement', 'Ranking')} : <strong>${rankTxt(x)}</strong> ${t(`sur ${x.of} créateurs`, `out of ${x.of} creators`)}${moveTxt(x.dRank) ? ` · ${moveTxt(x.dRank)}` : ''}</p>
        <table><tr><th align="left">${t('Recette', 'Recipe')}</th><th align="right">${t('Connexions (installs + forks)', 'Connections (installs + forks)')}</th><th align="right">${t('Évolution', 'Change')}</th></tr>${rows}</table>
        ${x.since ? `<p><small>${t('Évolution depuis le relevé du', 'Change since the snapshot of')} ${new Date(x.since).toLocaleString(en ? 'en-GB' : 'fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</small></p>` : ''}`,
    };
  });
  return channel({
    file: `feed-createur-${u}${en ? '-en' : ''}.xml`, en, items, link: `${SITE}${en ? '?lang=en' : ''}#${en ? 'creator' : 'createur'}/${u}`,
    title: t(`Palmarès TRMNL : les statistiques de ${who}`, `TRMNL Leaderboard: ${who}'s stats`),
    desc: t(`Chaque heure où quelque chose bouge : les connexions (installs + forks) de chaque recette de ${who}, le total, les gains et les pertes, et le classement général.`,
      `Every hour something moves: the connections (installs + forks) of each of ${who}'s recipes, the total, gains and losses, and the overall ranking.`),
  });
}

async function main() {
  if (SITE === '/') { log('SITE_URL manquant : flux non générés.'); return; }
  const latest = await readJSON(path.join(DATA, 'latest.json'), null);
  if (!latest) { log('latest.json absent : flux non générés.'); return; }
  const names = await readJSON(path.join(ROOT, 'names.json'), {});
  const news = await readJSON(path.join(DATA, 'eink-news.json'), {});
  const trmnl = await readJSON(path.join(DATA, 'trmnl.json'), {});
  const state = await readJSON(path.join(DATA, 'feeds-state.json'), {});
  state.recipes ||= []; state.milestones ||= []; state.ann ||= {};
  const now = Date.parse(latest.generated_at) || Date.now();

  // Petites phrases d'annonce de TRMNL (« New Recipe: X — Created by community member… »), gardées même après leur sortie du flux d'annonces
  for (const a of trmnl.announcements || []) {
    const m = String(a.t || '').match(/^New Recipe:\s*(.+)$/i);
    if (m && a.s) state.ann[m[1].trim().toLowerCase()] = { s: a.s, u: a.u, d: a.d };
  }
  const annFor = r => state.ann[String(r.n || '').trim().toLowerCase()] || null;

  // Nouvelles recettes : on fusionne avec celles déjà connues (pour ne rien perdre si l'API ne répond pas)
  try {
    const fresh = await freshRecipes();
    const byId = new Map(state.recipes.map(r => [r.id, r]));
    for (const r of fresh) byId.set(r.id, { ...byId.get(r.id), ...r });
    state.recipes = [...byId.values()].sort((a, b) => Date.parse(b.p) - Date.parse(a.p)).slice(0, KEEP.recipes);
  } catch (e) { log(`${e.message} : flux des recettes gardé tel quel.`); }
  state.recipes.forEach(r => { r.ann = annFor(r); });

  // Paliers
  const { events, first } = detectMilestones(latest, state, now);
  if (first) {
    // Premier passage : on amorce avec les paliers de la semaine en cours plutôt que de laisser le flux vide
    const week = (await readJSON(path.join(DATA, 'weekly.json'), {}))?.current;
    for (const m of week?.milestones || []) state.milestones.push({ id: m.id, n: m.n, u: m.u, T: m.T, s: m.s, d: week.to });
    log('Premier passage : niveaux de référence enregistrés, flux des paliers amorcé avec la semaine en cours.');
  }
  state.milestones = [...events, ...state.milestones].slice(0, KEEP.milestones);
  if (events.length) log(`${events.length} palier(s) franchi(s) : ${events.map(e => `${e.n} (${e.T})`).join(', ')}.`);

  // Statistiques horaires des créateurs suivis
  state.stats ||= {};
  for (const u of STATS_FEEDS) {
    const cur = statsSnapshot(latest, u); if (!cur) continue;
    state.stats[u] ||= {};
    if (state.stats[u].last?.at === cur.at) continue;   // même relevé que le passage précédent (publication seule)
    if (statsUpdate(state.stats[u], cur, STATS_EVERY_HOUR.includes(u))) log(`Statistiques de ${names[u] || u} : ${cur.total} connexions, ${cur.rank}e.`);
  }

  await fs.writeFile(path.join(DATA, 'feeds-state.json'), JSON.stringify(state));
  const out = [
    ['feed-eink.xml', einkFeed(news, false)], ['feed-eink-en.xml', einkFeed(news, true)],
    ['feed-recettes.xml', recipesFeed(state.recipes, names, false)], ['feed-recettes-en.xml', recipesFeed(state.recipes, names, true)],
    ['feed-paliers.xml', milestonesFeed(state.milestones, names, false)], ['feed-paliers-en.xml', milestonesFeed(state.milestones, names, true)],
  ];
  for (const u of STATS_FEEDS) if (state.stats[u]) out.push([`feed-createur-${u}.xml`, statsFeed(u, state.stats[u], names, false)], [`feed-createur-${u}-en.xml`, statsFeed(u, state.stats[u], names, true)]);
  for (const [f, body] of out) await fs.writeFile(path.join(ROOT, f), body);
  log(`Flux écrits : ${(news.articles || []).filter(a => a.body_fr).length} article(s) e-ink, ${state.recipes.length} recette(s), ${state.milestones.length} palier(s).`);
}

try { await main(); } catch (e) { log(`${e.message} (ignoré, le reste du workflow continue).`); }
