// Limites GitHub (#admin › Santé) : mesurées à chaque mise à jour, juste avant la publication du site.
//   node scripts/github-limits.mjs public  → écrit public/data/github.json
// La page d'administration lit ce fichier : aucune consultation de l'API GitHub depuis le navigateur.
// Ne fait jamais échouer le workflow : en cas de souci, les mesures manquantes sont simplement absentes.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.argv[2] || 'public';
const repo = process.env.GITHUB_REPOSITORY || '';
const token = process.env.GH_TOKEN || '';
const H = 3600e3;
const out = { v: 1, measured_at: new Date().toISOString() };

async function gh(p) {
  const res = await fetch(`https://api.github.com/${p}`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${p.split('?')[0]} : ${res.status}`);
  return res.json();
}
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`Limites GitHub, ${name} : ${e.message}`); } };

// 1. Le site tel qu'il va être publié (mesure exacte, sur le disque)
await step('site', async () => {
  let bytes = 0, files = 0, big = { path: '', bytes: 0 };
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else { const s = (await fs.stat(p)).size; bytes += s; files++; if (s > big.bytes) big = { path: path.relative(ROOT, p), bytes: s }; }
    }
  }
  await walk(ROOT);
  // Poids d'une première visite (compressé comme le sert GitHub Pages) : la page et les données chargées au démarrage
  let first = 0;
  for (const f of ['index.html', 'names.json', 'data/latest.json', 'data/daily.json', 'data/spotlight.json', 'data/spotlight-history.json', 'data/breakout.json']) {
    try { first += zlib.gzipSync(await fs.readFile(path.join(ROOT, f))).length; } catch {}
  }
  out.site = { bytes, files, largest: big, first_visit_bytes: first };
});

if (repo) {
  // 2. Taille du dépôt (toutes branches et historique compris, d'après GitHub)
  await step('dépôt', async () => { const r = await gh(`repos/${repo}`); out.repo = { kb: r.size, private: r.private }; });

  // 3. GitHub Actions sur 24 h : passages, durée, échecs, republications du site sur la dernière heure
  await step('actions', async () => {
    const since = new Date(Date.now() - 24 * H).toISOString();
    const runs = [];
    for (let page = 1; page <= 3; page++) {
      const r = await gh(`repos/${repo}/actions/runs?per_page=100&page=${page}&created=>=${since}`);
      const got = r.workflow_runs || [];
      runs.push(...got.filter(x => x.created_at >= since));
      if (got.length < 100 || got.some(x => x.created_at < since)) break;
    }
    const dur = r => Math.max(0, (Date.parse(r.updated_at) - Date.parse(r.run_started_at || r.created_at)) / 60e3);
    const by = {};
    for (const r of runs) {
      const o = by[r.name] ||= { runs: 0, minutes: 0, failures: 0 };
      o.runs++; o.minutes += dur(r); if (r.conclusion === 'failure') o.failures++;
    }
    for (const o of Object.values(by)) o.minutes = Math.round(o.minutes);
    out.actions = {
      runs_24h: runs.length,
      minutes_24h: Math.round(runs.reduce((a, r) => a + dur(r), 0)),
      failures_24h: runs.filter(r => r.conclusion === 'failure').length,
      pages_builds_1h: runs.filter(r => /pages build and deployment/i.test(r.name) && Date.now() - Date.parse(r.created_at) < H).length,
      by_workflow: by,
    };
  });

  // 4. Stockage des Actions : sauvegardes (artefacts) et caches
  await step('artefacts', async () => {
    let bytes = 0, count = 0;
    for (let page = 1; page <= 5; page++) {
      const r = await gh(`repos/${repo}/actions/artifacts?per_page=100&page=${page}`);
      for (const a of r.artifacts || []) if (!a.expired) { bytes += a.size_in_bytes || 0; count++; }
      if ((r.artifacts || []).length < 100) break;
    }
    out.artifacts = { bytes, count };
  });
  await step('caches', async () => { const r = await gh(`repos/${repo}/actions/cache/usage`); out.caches = { bytes: r.active_caches_size_in_bytes || 0, count: r.active_caches_count || 0 }; });

  // 5. Quota d'API restant pour les workflows
  await step('quota', async () => { const r = await gh('rate_limit'); out.api = { remaining: r.rate?.remaining, limit: r.rate?.limit }; });
}

try {
  await fs.mkdir(path.join(ROOT, 'data'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'data', 'github.json'), JSON.stringify(out));
  const mb = b => (b / 1048576).toFixed(1);
  console.log(`Limites GitHub : site ${out.site ? mb(out.site.bytes) + ' Mo' : '?'}, dépôt ${out.repo ? mb(out.repo.kb * 1024) + ' Mo' : '?'}, ${out.actions?.runs_24h ?? '?'} passages en 24 h.`);
} catch (e) { console.log(`Limites GitHub : écriture impossible (${e.message}).`); }
