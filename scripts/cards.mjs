// Vignettes des recettes pour les aperçus de liens (Discord, Reddit, Slack, X…).
// Dessine, pour chaque recette, la même vignette 1200 × 630 que le bouton « Vignette » du site (fonction shareCard
// d'index.html, en anglais comme les pages r/<id>.html), puis l'envoie dans le stockage Supabase (dossier public « cards »).
// build-pages.mjs met ensuite son adresse dans les balises og:image des pages de recette.
//
// Pour ne pas tout redessiner chaque heure, une vignette n'est refaite que si son nom, sa description, son auteur,
// ses installations ou ses forks ont changé, ou si elle a plus de STALE_D jours (capture d'écran et rangs rafraîchis).
// Au plus MAX_PER_RUN vignettes par passage : le premier remplissage se fait donc en quelques heures.
// État gardé dans data/cards.json. Si Supabase ou le moteur de dessin manquent, rien ne casse : les pages
// de recette gardent la capture d'écran comme aperçu.
//
// Usage : SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/cards.mjs public/data
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const OUT = process.argv[2] || 'public/data';
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = 'cards';
const SITE_LABEL = 'nbbou81000.github.io/trmnl-leaderboard';
const MAX_PER_RUN = Number(process.env.CARDS_MAX || 300);
const STALE_D = 3, RETRY_MISS_H = 24, PARALLEL = 6;
const W = 1200, H = 630, DAY = 864e5;
const log = (...a) => console.log('[vignettes]', ...a);

async function readJSON(p, fb) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fb; } }
const nf = n => new Intl.NumberFormat('en-US').format(n || 0);
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 10);

// ─── Dessin (doit rester identique à shareCard dans index.html) ─────────────────
const PAPER = '#f2f0ed', INK = '#1d1d1b', INK2 = '#5d5c58', ACC = '#f8654b';
const F = (w, size) => `${w} ${size}px Archivo`;
// Texte sur plusieurs lignes, coupé par mots ; la dernière ligne autorisée se termine par « … » si le texte déborde.
function wrapText(x, t, max, size, weight, color, y0, lh, limit) {
  x.font = F(weight, size); x.fillStyle = color;
  const words = String(t).split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (let k = 0; k < words.length; k++) {
    const test = line ? line + ' ' + words[k] : words[k];
    if (x.measureText(test).width <= max || !line) { line = test; continue; }
    if (lines.length === limit - 1) { line = words.slice(k - line.split(' ').length, words.length).join(' '); break; }
    lines.push(line); line = words[k];
  }
  if (line) {
    let last = line;
    if (x.measureText(last).width > max) { while (last.length > 1 && x.measureText(last + '…').width > max) last = last.slice(0, -1).trimEnd(); last += '…'; }
    lines.push(last);
  }
  let y = y0;
  for (const l of lines.slice(0, limit)) { x.fillText(l, 60, y); y += lh; }
  return y;
}
export function draw(x, r, { author, creatorRank, creators, img }) {
  x.fillStyle = PAPER; x.fillRect(0, 0, W, H);
  x.fillStyle = ACC; x.fillRect(0, 0, W, 10);
  const bx = 660, by = 120, bw = 500, bh = 300;
  x.fillStyle = '#fff'; x.fillRect(bx, by, bw, bh);
  if (img) x.drawImage(img, bx, by, bw, bh);
  x.strokeStyle = INK; x.lineWidth = 3; x.strokeRect(bx, by, bw, bh);
  x.font = F(700, 24); x.fillStyle = ACC; x.fillText(r.k === 'p' ? 'TRMNL PLUGIN' : 'TRMNL RECIPE', 60, 96);
  let y = wrapText(x, r.n, 540, 60, 800, INK, 168, 66, 2);
  y = wrapText(x, r.d || '', 540, 26, 400, INK2, y + 16, 34, 3);
  x.font = F(600, 26); x.fillStyle = INK;
  x.fillText(`by ${author}`, 60, Math.min(y + 34, 468));
  x.font = F(700, 30); x.fillStyle = INK;
  x.fillText(`${nf(r.i)} install${r.i === 1 ? '' : 's'}   ·   ${nf(r.f)} fork${r.f === 1 ? '' : 's'}   ·   #${r.r} overall`, 60, 520);
  x.strokeStyle = '#dcdbd9'; x.lineWidth = 2; x.beginPath(); x.moveTo(60, 556); x.lineTo(W - 60, 556); x.stroke();
  x.font = F(400, 22); x.fillStyle = INK2;
  x.fillText(SITE_LABEL, 60, 590);
  x.textAlign = 'right'; x.fillStyle = ACC; x.font = F(700, 22);
  x.fillText(creatorRank ? `${author} · #${creatorRank} / ${nf(creators)}` : '', W - 60, 590);
  x.textAlign = 'left';
}

// ─── Supabase Storage ───────────────────────────────────────────────────────────
const sb = (p, init = {}) => fetch(`${SB_URL}/storage/v1/${p}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
async function ensureBucket() {
  const r = await sb(`bucket/${BUCKET}`);
  if (r.ok) return;
  const c = await sb('bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 2_000_000, allowed_mime_types: ['image/png'] }) });
  if (!c.ok) throw new Error(`création du dossier « ${BUCKET} » : HTTP ${c.status} ${(await c.text()).slice(0, 160)}`);
  log(`Dossier public « ${BUCKET} » créé dans Supabase.`);
}
async function upload(id, buf) {
  const r = await sb(`object/${BUCKET}/${encodeURIComponent(id)}.png`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'x-upsert': 'true', 'Cache-Control': 'max-age=3600' }, body: buf });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
}
async function remove(ids) {
  for (let k = 0; k < ids.length; k += 100) {
    await sb(`object/${BUCKET}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: ids.slice(k, k + 100).map(id => `${id}.png`) }) }).catch(() => {});
  }
}

async function main() {
  if (!/^https:\/\/[\w-]+\.supabase\.co$/.test(SB_URL) || SB_KEY.length < 30) { log('Supabase non configuré : vignettes ignorées, les aperçus gardent la capture d\'écran.'); return; }
  let canvas;
  try { canvas = await import('@napi-rs/canvas'); } catch { log('Moteur de dessin absent (@napi-rs/canvas) : vignettes ignorées.'); return; }
  const { createCanvas, loadImage, GlobalFonts } = canvas;
  if (!GlobalFonts.registerFromPath(path.resolve('fonts/Archivo[wdth,wght].ttf'), 'Archivo')) log('Police Archivo introuvable : police de secours utilisée.');

  const latest = await readJSON(path.join(OUT, 'latest.json'), null);
  if (!latest?.recipes?.length) { log('latest.json absent : vignettes ignorées.'); return; }
  const names = await readJSON('names.json', {});
  const nameOf = u => (names[u] && String(names[u]).trim()) || `Creator #${u}`;
  const creators = new Map(latest.creators.map(c => [c.u, c]));
  const state = await readJSON(path.join(OUT, 'cards.json'), null) || { v: 1, items: {} };
  const now = Date.now();

  await ensureBucket();

  // Recettes sorties du palmarès : leur vignette est retirée
  const live = new Set(latest.recipes.map(r => r.id));
  const gone = Object.keys(state.items).filter(id => !live.has(id));
  if (gone.length) { await remove(gone); gone.forEach(id => delete state.items[id]); log(`${gone.length} vignette(s) retirée(s) (recettes sorties du palmarès).`); }

  // À faire : jamais dessinée, contenu changé, trop ancienne, ou capture manquante à retenter
  const todo = [];
  for (const r of latest.recipes) {
    const key = hash(JSON.stringify([r.n, r.d, nameOf(r.u), r.i, r.f, r.k || '']));
    const s = state.items[r.id];
    const age = s ? now - Date.parse(s.t) : Infinity;
    const prio = !s ? 0 : s.key !== key ? 1 : s.miss && r.sc && age > RETRY_MISS_H * 36e5 ? 2 : age > STALE_D * DAY ? 3 : null;
    if (prio != null) todo.push({ r, key, prio });
  }
  todo.sort((a, b) => a.prio - b.prio || b.r.s - a.r.s);   // les plus populaires d'abord
  const batch = todo.slice(0, MAX_PER_RUN);
  log(`${todo.length} vignette(s) à refaire, ${batch.length} ce passage (${Object.keys(state.items).length} déjà en ligne).`);

  let done = 0, failed = 0, miss = 0, bytes = 0;
  const work = async ({ r, key }) => {
    let img = null;
    if (r.sc) {   // capture téléchargée par nous, avec un délai maximum : une capture qui ne répond pas ne bloque rien
      try { const res = await fetch(r.sc, { signal: AbortSignal.timeout(20000) }); if (res.ok) img = await loadImage(Buffer.from(await res.arrayBuffer())); } catch {}
    }
    const cv = createCanvas(W, H), x = cv.getContext('2d');
    const c = creators.get(r.u);
    draw(x, r, { author: nameOf(r.u), creatorRank: c?.r, creators: latest.creators.length, img });
    const buf = await cv.encode('png');
    try { await upload(r.id, buf); } catch (e) { failed++; if (failed <= 3) log(`envoi de ${r.id} : ${e.message}`); return; }
    state.items[r.id] = { key, v: hash(key + now), t: new Date(now).toISOString(), ...(img || !r.sc ? {} : { miss: 1 }) };
    done++; bytes += buf.length; if (!img && r.sc) miss++;
  };
  for (let k = 0; k < batch.length; k += PARALLEL) await Promise.all(batch.slice(k, k + PARALLEL).map(work));

  state.updated = new Date(now).toISOString();
  await fs.writeFile(path.join(OUT, 'cards.json'), JSON.stringify(state));
  log(`${done} vignette(s) envoyée(s) (${(bytes / 1e6).toFixed(1)} Mo)${miss ? `, ${miss} sans capture (retentées dans ${RETRY_MISS_H} h)` : ''}${failed ? `, ${failed} échec(s)` : ''}.`);
}

// Lancé directement (workflow) ; importé seulement pour tester le dessin
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { await main(); } catch (e) { log(`${e.message} (ignoré, le reste du workflow continue).`); }
  process.exit(0);   // rien ne doit rester en attente une fois le travail fini
}
