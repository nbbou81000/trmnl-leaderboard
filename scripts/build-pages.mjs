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
