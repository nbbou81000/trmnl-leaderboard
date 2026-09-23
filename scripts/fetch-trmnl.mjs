// Récupère l'actualité publique de TRMNL : statut des services, annonces, blog, firmware.
// Écrit data/trmnl.json (le site lit aussi le statut en direct, ce fichier sert de secours).
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'public/data';
const UA = { 'User-Agent': 'trmnl-leaderboard (GitHub Actions)' };

async function get(url, json = false) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return json ? res.json() : res.text();
}
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};
const entities = t => String(t || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
// Le contenu est du HTML échappé : on décode, puis on retire les balises (deux passes).
const unesc = t => entities(String(t || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' '))
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Flux Atom de TRMNL : on garde titre, lien, date et un court résumé
function parseFeed(xml, limit = 12) {
  return [...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi)].slice(0, limit).map(m => {
    const e = m[0];
    const href = (e.match(/<link[^>]*href="([^"]+)"/i) || [, ''])[1];
    const body = unesc(tag(e, 'summary') || tag(e, 'content'));
    return {
      t: unesc(tag(e, 'title')),
      u: href.startsWith('http') ? href : `https://trmnl.com${href}`,
      d: unesc(tag(e, 'published') || tag(e, 'updated')),
      s: body.length > 240 ? body.slice(0, 239) + '…' : body,
    };
  });
}

const out = { generated_at: new Date().toISOString() };
const jobs = [
  ['status', async () => {
    const s = await get('https://trmnl.statuspage.io/api/v2/summary.json', true);
    return {
      indicator: s.status?.indicator, description: s.status?.description,
      updated: s.page?.updated_at,
      components: (s.components || []).filter(c => !c.group).map(c => ({ n: c.name, s: c.status })),
      incidents: (s.incidents || []).map(i => ({ n: i.name, s: i.status, u: i.shortlink, d: i.updated_at })),
      maintenances: (s.scheduled_maintenances || []).map(i => ({ n: i.name, s: i.status, u: i.shortlink, d: i.scheduled_for })),
    };
  }],
  ['announcements', async () => parseFeed(await get('https://trmnl.com/feeds/announcements.xml'))],
  ['posts', async () => parseFeed(await get('https://trmnl.com/feeds/posts.xml'))],
  ['firmware', async () => await get('https://trmnl.com/api/firmware/latest', true)],
];

for (const [key, fn] of jobs) {
  try { out[key] = await fn(); console.log(`${key} : ok`); }
  catch (e) { console.log(`${key} : ${e.message} (ignoré)`); }
}

await fs.mkdir(OUT, { recursive: true });
// En cas d'échec partiel, on conserve ce qui avait été récupéré au passage précédent
try {
  const prev = JSON.parse(await fs.readFile(path.join(OUT, 'trmnl.json'), 'utf8'));
  for (const [key] of jobs) if (out[key] == null && prev[key] != null) out[key] = prev[key];
} catch {}
await fs.writeFile(path.join(OUT, 'trmnl.json'), JSON.stringify(out));
console.log('trmnl.json écrit.');
