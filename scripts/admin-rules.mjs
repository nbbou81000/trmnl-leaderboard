// Règles de l'espace d'administration (#admin › Contenus), appliquées à chaque mise à jour.
//   node scripts/admin-rules.mjs fetch public/data  → récupère les règles dans Supabase et les écrit dans rules.json
//   node scripts/admin-rules.mjs eink  public/data  → retire de l'actu e-ink les articles masqués et les sources bloquées
// Si Supabase ne répond pas, les règles du passage précédent (rules.json) sont gardées. Aucune note privée n'est publiée.
import fs from 'node:fs/promises';
import path from 'node:path';

const [mode = 'fetch', OUT = 'public/data'] = process.argv.slice(2);
const FILE = path.join(OUT, 'rules.json');
const readJSON = async (f, fb) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return fb; } };

if (mode === 'fetch') {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key = process.env.SUPABASE_ANON_KEY || '';
  const prev = await readJSON(FILE, null);
  let rules = null;
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/public_rules`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}',
      });
      if (res.ok) rules = await res.json();
      else console.log(`Règles : Supabase a répondu ${res.status} (admin.sql pas encore installé ?).`);
    } catch (e) { console.log(`Règles : Supabase injoignable (${e.message}).`); }
  } else console.log('Règles : Supabase non configuré.');
  if (Array.isArray(rules)) {
    await fs.mkdir(OUT, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify({ v: 1, fetched_at: new Date().toISOString(), rules }));
    const n = k => rules.filter(r => r.kind === k).length;
    console.log(`Règles : ${n('recipe')} recette(s) et ${n('creator')} créateur(s) retirés du palmarès, ${n('article')} article(s) masqué(s), ${n('source')} source(s) bloquée(s), ${n('spotlight')} recette(s) du jour imposée(s).`);
  } else if (prev) console.log('Règles du passage précédent conservées.');
  else await fs.writeFile(FILE, JSON.stringify({ v: 1, fetched_at: null, rules: [] }));
}

if (mode === 'eink') {
  const rules = (await readJSON(FILE, {})).rules || [];
  const hidden = new Set(rules.filter(r => r.kind === 'article').map(r => r.target));
  const blocked = new Set(rules.filter(r => r.kind === 'source').map(r => r.target));
  const EF = path.join(OUT, 'eink-news.json');
  const data = await readJSON(EF, null);
  if (!data?.articles || (!hidden.size && !blocked.size)) process.exit(0);
  const out = a => hidden.has(a.id) || blocked.has(a.src);
  const gone = data.articles.filter(out);
  const queued = (data.queue || []).filter(out);
  if (!gone.length && !queued.length) process.exit(0);
  data.articles = data.articles.filter(a => !out(a));
  data.queue = (data.queue || []).filter(a => !out(a));
  data.seen = [...new Set([...(data.seen || []), ...gone.map(a => a.id), ...queued.map(a => a.id)])];   // ne reviendront pas
  await fs.writeFile(EF, JSON.stringify(data));
  console.log(`Actu e-ink : ${gone.length} article(s) retiré(s) et ${queued.length} en attente écarté(s) sur demande de l'administrateur.`);
}
