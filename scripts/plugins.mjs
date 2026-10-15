// Plugins TRMNL (trmnl.com/integrations/…) rattachés à un créateur et validés par l'administrateur.
// Chaque heure : lit la liste validée dans Supabase (table creator_plugins, lecture publique), puis la page
// publique de chaque plugin (nom, description, icône, aperçu, nombre de connexions).
// Écrit public/data/plugins.json, que fetch-stats.mjs ajoute aux recettes pour les classements.
// Si une page ne répond pas, la dernière valeur connue est gardée (le plugin ne disparaît pas des classements).
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'public/data';
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || '';
const FILE = path.join(OUT, 'plugins.json');
const UA = 'trmnl-creators-stats (GitHub Actions)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, ' ').trim();

// Lecture d'une page de plugin. Renvoie null si la page n'est pas celle du plugin demandé
// (une adresse inconnue renvoie la liste des plugins, avec une autre og:url).
export function parsePluginPage(html, slug) {
  const meta = p => (html.match(new RegExp(`<meta[^>]+property="${p}"[^>]+content="([^"]*)"`, 'i')) || [])[1];
  const url = meta('og:url') || '';
  if (!url.toLowerCase().replace(/\/$/, '').endsWith(`/integrations/${slug}`)) return null;
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = text.match(/(\d[\d,.\s]*)\s+Connections?\b/i);
  if (!m) return null;
  const connections = Number(m[1].replace(/[^\d]/g, ''));
  if (!Number.isFinite(connections)) return null;
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const name = decode((h1 || '').replace(/<[^>]+>/g, '')) || decode((meta('og:title') || '').replace(/\s*Plugin\s*$/i, '')) || slug;
  const after = h1 ? html.slice(html.indexOf(h1) + h1.length, html.indexOf(h1) + h1.length + 1500) : '';
  const desc = decode(((after.match(/<p[^>]*font-light[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '').replace(/<[^>]+>/g, ''))
    || decode((meta('og:description') || '').replace(/^.*? on TRMNL\.\s*/i, ''));
  const icon = (html.match(/<img[^>]+alt="[^"]*TRMNL plugin"[^>]+src="([^"]+)"/i) || html.match(/<img[^>]+src="([^"]+)"[^>]+alt="[^"]*TRMNL plugin"/i) || [])[1] || '';
  const abs = u => (u && u.startsWith('/') ? 'https://trmnl.com' + u : u || '');
  return { name, desc: desc.slice(0, 180), icon: abs(icon), shot: abs(meta('og:image')), connections };
}

async function fetchPage(slug) {
  for (let k = 1; k <= 3; k++) {
    try {
      const res = await fetch(`https://trmnl.com/integrations/${encodeURIComponent(slug)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { if (k === 3) throw e; await sleep(2000 * k); }
  }
}

// Les images des plugins passent par une redirection trmnl.com/rails/active_storage/… qui n'autorise pas
// l'affichage depuis un autre site (pas d'en-tête CORS). On garde donc l'adresse finale (stockage public TRMNL).
async function finalURL(u) {
  if (!u || !/\/rails\/active_storage\//.test(u)) return u;
  try {
    const r = await fetch(u, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    const loc = r.headers.get('location');
    return loc && /^https:\/\//.test(loc) ? loc : u;
  } catch { return u; }
}

async function main() {
  const prev = JSON.parse(await fs.readFile(FILE, 'utf8').catch(() => '{"plugins":[]}'));
  const old = new Map((prev.plugins || []).map(p => [p.slug, p]));
  if (!SB || !KEY) { console.log('Plugins : Supabase non configuré, liste précédente gardée.'); return; }
  let claims;
  try {
    const r = await fetch(`${SB}/rest/v1/creator_plugins?select=slug,creator_id,decided_at&status=eq.verified&order=slug`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    claims = await r.json();
  } catch (e) { console.log(`Plugins : liste illisible (${e.message}), liste précédente gardée.`); return; }

  const out = [];
  for (const c of claims) {
    const before = old.get(c.slug);
    let page = null;
    try { page = parsePluginPage(await fetchPage(c.slug), c.slug); } catch (e) { console.log(`  ${c.slug} : ${e.message}`); }
    if (!page && !before) { console.log(`  ${c.slug} : page introuvable, ignoré pour l'instant.`); continue; }
    if (page) { page.icon = await finalURL(page.icon); page.shot = await finalURL(page.shot); }
    const p = page ? {
      slug: c.slug, u: String(c.creator_id), n: page.name, d: page.desc, ic: page.icon, sc: page.shot, i: page.connections,
      p: before?.p || c.decided_at || new Date().toISOString(), seen: new Date().toISOString(),
    } : { ...before, u: String(c.creator_id) };   // page muette : dernière valeur connue
    out.push(p);
    console.log(`  ${c.slug} : ${p.i} connexions${page ? '' : ' (dernière valeur connue)'}`);
    await sleep(800);
  }
  await fs.writeFile(FILE, JSON.stringify({ v: 1, generated_at: new Date().toISOString(), plugins: out }));
  console.log(`Plugins : ${out.length} plugin(s) rattaché(s) à un créateur.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { await main(); } catch (e) { console.log(`Plugins : ${e.message} (ignoré, le reste du workflow continue).`); }
}
