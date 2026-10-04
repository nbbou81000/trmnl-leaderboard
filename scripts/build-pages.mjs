// Construit une page par recette (public/r/<id>.html) avec les balises d'aperçu de lien :
// coller l'adresse sur Discord, Reddit, Slack ou X affiche une vignette automatiquement.
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'public';
const SITE = (process.env.SITE_URL || '').replace(/\/?$/, '/');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = n => new Intl.NumberFormat('en-US').format(n || 0);

const data = JSON.parse(await fs.readFile(path.join(OUT, 'data/latest.json'), 'utf8'));
let names = {};
try { names = JSON.parse(await fs.readFile(path.join(OUT, 'names.json'), 'utf8')); } catch {}
const nameOf = u => (names[u] && String(names[u]).trim()) || `Creator #${u}`;
const creators = new Map(data.creators.map(c => [c.u, c]));

const dir = path.join(OUT, 'r');
await fs.rm(dir, { recursive: true, force: true });
await fs.mkdir(dir, { recursive: true });

const page = r => {
  const c = creators.get(r.u);
  const author = nameOf(r.u);
  const stats = `${nf(r.i)} installs · ${nf(r.f)} forks · #${r.r} on the leaderboard`;
  const desc = r.d ? `${r.d} — by ${author}. ${stats}.` : `By ${author}. ${stats}.`;
  const title = `${r.n} — TRMNL recipe`;
  const img = r.sc || `${SITE}og.png`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="TRMNL Creator Leaderboard">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(SITE)}r/${r.id}.html">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:alt" content="${esc(`Preview of the ${r.n} TRMNL recipe`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<meta name="theme-color" content="#f8654b">
<link rel="icon" href="${esc(SITE)}icon-192.png">
<link rel="canonical" href="${esc(SITE)}r/${r.id}.html">
<style>
:root{--paper:#f2f0ed;--sheet:#fbfaf8;--ink:#1d1d1b;--ink2:#5d5c58;--rule:#dcdbd9;--accent:#f8654b;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--paper:#1a1a1a;--sheet:#242423;--ink:#ecebe8;--ink2:#a9a8a3;--rule:#363634;--accent:#ff7c66}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;border-top:4px solid var(--accent)}
main{max-width:860px;margin:0 auto;padding:28px 18px 60px}
a{color:inherit}
.shot{background:#fff;border:1px solid var(--rule);border-radius:12px;overflow:hidden;margin:0 0 20px}
.shot img{width:100%;display:block}
h1{font-size:1.9rem;line-height:1.15;margin:0 0 8px;letter-spacing:-.02em}
.by{color:var(--ink2);margin:0 0 16px}
.by a{color:var(--accent);text-decoration:none;font-weight:600}
.facts{display:flex;flex-wrap:wrap;gap:6px 22px;list-style:none;padding:0;margin:0 0 22px;font-variant-numeric:tabular-nums}
.facts b{font-size:1.25rem}
.facts span{display:block;color:var(--ink2);font-size:.82rem}
p.desc{background:var(--sheet);border:1px solid var(--rule);border-left:4px solid var(--accent);border-radius:0 10px 10px 0;padding:14px 16px;margin:0 0 22px}
.btns{display:flex;flex-wrap:wrap;gap:10px}
.btn{background:var(--accent);color:#fff;border-radius:9px;padding:11px 18px;text-decoration:none;font-weight:650}
.btn.ghost{background:var(--sheet);color:var(--ink);border:1.5px solid var(--rule)}
footer{color:var(--ink2);font-size:.8rem;margin-top:34px;border-top:1px solid var(--rule);padding-top:14px}
</style>
</head>
<body>
<main>
  ${r.sc ? `<div class="shot"><img src="${esc(r.sc)}" alt="${esc(`Preview of ${r.n}`)}" width="800" height="480"></div>` : ''}
  <h1>${esc(r.n)}</h1>
  <p class="by">by <a href="${esc(SITE)}?lang=en#creator/${esc(r.u)}">${esc(author)}</a>${c ? ` · ranked #${c.r} of ${nf(data.creators.length)} creators` : ''}${r.c.length ? ` · ${esc(r.c.join(', '))}` : ''}</p>
  ${r.d ? `<p class="desc">${esc(r.d)}</p>` : ''}
  <ul class="facts">
    <li><b>${nf(r.i)}</b><span>installs</span></li>
    <li><b>${nf(r.f)}</b><span>forks</span></li>
    <li><b>#${r.r}</b><span>of ${nf(data.recipes.length)} recipes</span></li>
    ${r.p ? `<li><b>${new Date(r.p).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</b><span>published</span></li>` : ''}
  </ul>
  <div class="btns">
    <a class="btn" href="https://trmnl.com/recipes/${r.id}">Install on TRMNL</a>
    <a class="btn ghost" href="${esc(SITE)}?lang=en#gallery">Browse all recipes</a>
  </div>
  <footer>Unofficial page from the TRMNL Creator Leaderboard, built from the public recipes API. Preview image and description belong to their creator.</footer>
</main>
</body>
</html>`;
};

let n = 0;
for (const r of data.recipes) { await fs.writeFile(path.join(dir, `${r.id}.html`), page(r)); n++; }
console.log(`${n} pages de recette écrites dans r/.`);

// ─── Pages de partage des articles « Actu e-ink » (public/a/<id>.html en français, <id>-en.html en anglais) ───
// Discord, Reddit, X… lisent ces balises pour afficher la vignette ; un visiteur, lui, est renvoyé aussitôt sur l'article dans le site.
let news = { articles: [] };
try { news = JSON.parse(await fs.readFile(path.join(OUT, 'data/eink-news.json'), 'utf8')); } catch {}
const adir = path.join(OUT, 'a');
await fs.rm(adir, { recursive: true, force: true });
await fs.mkdir(adir, { recursive: true });
const CAT = {
  displays: ["Écrans d'affichage", 'Display screens'], screens: ["Écrans d'affichage", 'Display screens'], diy: ['Bidouille e-ink', 'E-ink hacks'],
  dashboards: ['Dashboards & domotique', 'Dashboards & home automation'], maker: ['Bidouille geek', 'Maker & geek'],
};
const BODY_TAGS = /^(p|h2|h3|ul|ol|li|strong|em)$/i;
const cleanBody = h => String(h || '').replace(/<\s*(\/?)\s*([a-z0-9]+)[^>]*>/gi, (m, sl, t) => BODY_TAGS.test(t) ? `<${sl}${t.toLowerCase()}>` : ' ');
const articlePage = (a, en) => {
  const t = (fr, e) => en ? e : fr;
  const title = en ? a.title_en : a.title_fr, lead = (en ? a.lead_en : a.lead_fr) || '', body = en ? a.body_en : a.body_fr;
  const file = `${a.id}${en ? '-en' : ''}.html`, self = `${SITE}a/${file}`;
  const target = `${SITE}${en ? '?lang=en' : '?lang=fr'}#eink/${a.id}`;
  const img = a.img || `${SITE}og.png`;
  const site = t('Palmarès des créateurs TRMNL · Actu e-ink', 'TRMNL Creator Leaderboard · E-ink news');
  const cat = (CAT[a.cat] || [a.cat, a.cat])[en ? 1 : 0];
  const date = new Date(a.d).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!DOCTYPE html>
<html lang="${en ? 'en' : 'fr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · ${esc(site)}</title>
<meta name="description" content="${esc(lead)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(site)}">
<meta property="og:locale" content="${en ? 'en_US' : 'fr_FR'}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(lead)}">
<meta property="og:url" content="${esc(self)}">
<meta property="og:image" content="${esc(img)}">
<meta property="article:published_time" content="${esc(a.d)}">
<meta property="article:section" content="${esc(cat)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(lead)}">
<meta name="twitter:image" content="${esc(img)}">
<meta name="theme-color" content="#f8654b">
<link rel="icon" href="${esc(SITE)}icon-192.png">
<link rel="canonical" href="${esc(self)}">
<link rel="alternate" hreflang="${en ? 'fr' : 'en'}" href="${esc(SITE)}a/${a.id}${en ? '' : '-en'}.html">
<script>
// Renvoie sur l'article dans le site, en transmettant l'étiquette du lien (?via=reddit…) et le site d'origine
(function () {
  var t = ${JSON.stringify(target)}, i = t.indexOf('#'), q = new URLSearchParams(location.search), extra = '';
  var via = (q.get('via') || q.get('utm_source') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30);
  if (via) extra += '&via=' + via;
  try { var h = new URL(document.referrer).hostname; if (h && h !== location.hostname) extra += '&ref=' + encodeURIComponent(h); } catch (e) {}
  location.replace(t.slice(0, i) + extra + t.slice(i));
})();
</script>
<style>
:root{--paper:#f2f0ed;--sheet:#fbfaf8;--ink:#1d1d1b;--ink2:#5d5c58;--rule:#dcdbd9;--accent:#f8654b;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--paper:#1a1a1a;--sheet:#242423;--ink:#ecebe8;--ink2:#a9a8a3;--rule:#363634;--accent:#ff7c66}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;border-top:4px solid var(--accent)}
main{max-width:760px;margin:0 auto;padding:28px 18px 60px}
a{color:inherit}
img.hero{width:100%;max-height:360px;object-fit:cover;border-radius:12px;display:block;margin:0 0 18px;background:var(--rule)}
.meta{color:var(--ink2);font-size:.85rem;margin:0 0 6px}
h1{font-size:1.8rem;line-height:1.2;margin:0 0 10px;letter-spacing:-.02em}
.lead{font-size:1.08rem;font-weight:600;margin:0 0 18px}
.btn{display:inline-block;background:var(--accent);color:#fff;border-radius:9px;padding:11px 18px;text-decoration:none;font-weight:650;margin:8px 0 18px}
footer{color:var(--ink2);font-size:.8rem;margin-top:30px;border-top:1px solid var(--rule);padding-top:14px}
</style>
</head>
<body>
<main>
  ${a.img ? `<img class="hero" src="${esc(a.img)}" alt="" referrerpolicy="no-referrer">` : ''}
  <p class="meta">${esc(cat)} · ${esc(date)} · ${t('source', 'source')} : ${esc(a.src)}</p>
  <h1>${esc(title)}</h1>
  ${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
  <a class="btn" href="${esc(target)}">${t("Lire l'article sur le Palmarès TRMNL", 'Read the article on the TRMNL Leaderboard')} →</a>
  ${cleanBody(body)}
  <footer>${t("Article rédigé par une IA (Mistral) à partir de la source citée. Vérifiez les détails importants chez la source.", 'Article written by an AI (Mistral) from the cited source. Check important details at the source.')}</footer>
</main>
</body>
</html>`;
};
let na = 0;
for (const a of news.articles || []) {
  if (!a.id || !a.body_fr || !a.body_en) continue;
  await fs.writeFile(path.join(adir, `${a.id}.html`), articlePage(a, false));
  await fs.writeFile(path.join(adir, `${a.id}-en.html`), articlePage(a, true));
  na++;
}
console.log(`${na} article(s) e-ink : pages de partage écrites dans a/ (français et anglais).`);

// ─── Pages de partage des projets « En élaboration » (public/p/<id>.html et <id>-en.html) ───
// Lues dans Supabase avec la clé publique (seuls les projets visibles), au moment de la publication du site.
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), SB_KEY = process.env.SUPABASE_ANON_KEY || '';
const pdir = path.join(OUT, 'p');
await fs.rm(pdir, { recursive: true, force: true });
await fs.mkdir(pdir, { recursive: true });
const STATUS = { idea: ['💡 Idée', '💡 Idea'], building: ['🔨 En construction', '🔨 Building'], testing: ['🧪 En test', '🧪 Testing'], submitted: ['📬 Soumise', '📬 Submitted'] };
let projects = [];
if (/^https:\/\/[\w-]+\.supabase\.co$/.test(SB_URL) && SB_KEY.length > 30) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/projects?select=id,name,description,status,images,created_at,shipped_recipe,profiles(name)&hidden=eq.false&order=id`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Encoding': 'identity' } });
    if (r.ok) projects = await r.json(); else console.log(`Projets : réponse ${r.status}, pages de partage ignorées.`);
  } catch (e) { console.log(`Projets indisponibles (${e.message}), pages de partage ignorées.`); }
}
const projectPage = (p, en) => {
  const t = (fr, e) => en ? e : fr;
  const self = `${SITE}p/${p.id}${en ? '-en' : ''}.html`, target = `${SITE}${en ? '?lang=en' : '?lang=fr'}#elaboration/${p.id}`;
  const img = p.images?.[0] ? (/^https?:/.test(p.images[0]) ? p.images[0] : `${SB_URL}/storage/v1/object/public/wip/${p.images[0]}`) : `${SITE}og.png`;
  const who = p.profiles?.name || '';
  const st = p.shipped_recipe ? t('🎉 Disponible', '🎉 Now available') : (STATUS[p.status] || STATUS.building)[en ? 1 : 0];
  const title = `${p.name}${who ? ' · ' + who : ''}`;
  const desc = `${st} · ${p.description || t('Une recette TRMNL en cours d\'élaboration.', 'A TRMNL recipe in the making.')}`;
  const site = t('Palmarès des créateurs TRMNL · En élaboration', 'TRMNL Creator Leaderboard · In the making');
  return `<!DOCTYPE html>
<html lang="${en ? 'en' : 'fr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · ${esc(site)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(site)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(self)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<meta name="theme-color" content="#f8654b">
<link rel="icon" href="${esc(SITE)}icon-192.png">
<link rel="canonical" href="${esc(self)}">
<script>
(function () {
  var t = ${JSON.stringify(target)}, i = t.indexOf('#'), q = new URLSearchParams(location.search), extra = '';
  var via = (q.get('via') || q.get('utm_source') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30);
  if (via) extra += '&via=' + via;
  try { var h = new URL(document.referrer).hostname; if (h && h !== location.hostname) extra += '&ref=' + encodeURIComponent(h); } catch (e) {}
  location.replace(t.slice(0, i) + extra + t.slice(i));
})();
</script>
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#f2f0ed;color:#1d1d1b;border-top:4px solid #f8654b}main{max-width:700px;margin:0 auto;padding:28px 18px}a{color:#c0412a}img{max-width:100%;border-radius:12px}</style>
</head>
<body><main>
  ${p.images?.[0] ? `<img src="${esc(img)}" alt="">` : ''}
  <p>${esc(st)}${who ? ' · ' + esc(who) : ''}</p>
  <h1>${esc(p.name)}</h1>
  <p>${esc(p.description || '')}</p>
  <p><a href="${esc(target)}">${t('Voir le projet sur le Palmarès TRMNL', 'See the project on the TRMNL Leaderboard')} →</a></p>
</main></body>
</html>`;
};
for (const p of projects) {
  await fs.writeFile(path.join(pdir, `${p.id}.html`), projectPage(p, false));
  await fs.writeFile(path.join(pdir, `${p.id}-en.html`), projectPage(p, true));
}
console.log(`${projects.length} projet(s) : pages de partage écrites dans p/.`);

// ─── Page « introuvable » de GitHub Pages : un lien de partage pas encore généré (projet ou article tout neuf) renvoie quand même au bon endroit
await fs.writeFile(path.join(OUT, '404.html'), `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Palmarès des créateurs TRMNL</title>
<script>
(function () {
  var site = ${JSON.stringify(SITE)}, path = location.pathname, m, dest = site;
  if ((m = path.match(/\\/p\\/(\\d+)(-en)?\\.html$/))) dest = site + (m[2] ? '?lang=en' : '') + '#elaboration/' + m[1];
  else if ((m = path.match(/\\/a\\/([0-9a-f]+)(-en)?\\.html$/))) dest = site + (m[2] ? '?lang=en' : '') + '#eink/' + m[1];
  else if ((m = path.match(/\\/r\\/(\\d+)\\.html$/))) dest = site;
  location.replace(dest);
})();
</script></head><body><p><a href="${esc(SITE)}">Palmarès des créateurs TRMNL</a></p></body></html>`);
