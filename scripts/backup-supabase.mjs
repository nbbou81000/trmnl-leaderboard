// Sauvegarde du contenu Supabase : toutes les tables, les comptes, et les images envoyées sur le site.
// Lancé chaque semaine par le workflow « Sauvegarde » ; le résultat est chiffré avant d'être mis à disposition.
// Besoin : SUPABASE_URL et SUPABASE_SERVICE_KEY (clé secrète « service_role », qui passe outre les règles d'accès).
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'backup/supabase';
const URL0 = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const MAX_FILES_MB = 800;    // les images au-delà sont ignorées, pour que l'archive reste raisonnable
const log = (...a) => console.log(...a);
if (!URL0 || !KEY) { console.error("SUPABASE_URL ou SUPABASE_SERVICE_KEY manquant : voir le mode d'emploi en tête du workflow."); process.exit(1); }

// Les nouvelles clés secrètes (sb_secret_…) passent seulement dans « apikey » ; les anciennes (JWT) aussi dans Authorization
const H = KEY.startsWith('sb_secret_') ? { apikey: KEY } : { apikey: KEY, Authorization: `Bearer ${KEY}` };
const get = async (url, opt = {}) => {
  const r = await fetch(url, { ...opt, headers: { ...H, ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
};
const save = (file, data) => fs.writeFile(path.join(OUT, file), JSON.stringify(data, null, 1));
const summary = { generated_at: new Date().toISOString(), tables: {}, users: null, files: { count: 0, mb: 0, skipped: 0 }, errors: [] };
await fs.mkdir(path.join(OUT, 'tables'), { recursive: true });

// 1. Tables : la liste vient de la description automatique de l'API, puis lecture page par page
let tables = [];
try {
  const spec = await (await get(`${URL0}/rest/v1/`, { headers: { Accept: 'application/openapi+json' } })).json();
  tables = Object.keys(spec.definitions || {});
} catch (e) { summary.errors.push(`liste des tables : ${e.message}`); }
if (!tables.length) tables = ['profiles', 'projects', 'updates', 'comments', 'reports', 'predictions', 'disclaimer', 'visit_days', 'visit_hits', 'page_days'];
for (const t of tables) {
  try {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const page = await (await get(`${URL0}/rest/v1/${encodeURIComponent(t)}?select=*`, { headers: { 'Range-Unit': 'items', Range: `${from}-${from + 999}` } })).json();
      rows.push(...page);
      if (page.length < 1000) break;
    }
    await save(`tables/${t}.json`, rows);
    summary.tables[t] = rows.length; log(`Table ${t} : ${rows.length} ligne(s)`);
  } catch (e) { summary.errors.push(`table ${t} : ${e.message}`); log(`Table ${t} ignorée (${e.message})`); }
}

// 2. Comptes (connexions Discord) : nécessaires pour tout restaurer ailleurs
try {
  const users = [];
  for (let p = 1; p < 100; p++) {
    const j = await (await get(`${URL0}/auth/v1/admin/users?page=${p}&per_page=1000`)).json();
    const list = j.users || [];
    users.push(...list);
    if (list.length < 1000) break;
  }
  await save('users.json', users);
  summary.users = users.length; log(`Comptes : ${users.length}`);
} catch (e) { summary.errors.push(`comptes : ${e.message}`); log(`Comptes ignorés (${e.message})`); }

// 3. Images envoyées par les visiteurs (stockage Supabase)
let bytes = 0;
try {
  const buckets = await (await get(`${URL0}/storage/v1/bucket`)).json();
  for (const b of buckets) {
    const walk = async prefix => {
      for (let offset = 0; ; offset += 1000) {
        const items = await (await get(`${URL0}/storage/v1/object/list/${encodeURIComponent(b.id)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }) })).json();
        for (const it of items) {
          const p = prefix ? `${prefix}/${it.name}` : it.name;
          if (!it.id) { await walk(p); continue; }   // un dossier
          if (bytes > MAX_FILES_MB * 1e6) { summary.files.skipped++; continue; }
          try {
            const buf = Buffer.from(await (await get(`${URL0}/storage/v1/object/${encodeURIComponent(b.id)}/${p.split('/').map(encodeURIComponent).join('/')}`)).arrayBuffer());
            const dest = path.join(OUT, 'files', b.id, p);
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, buf);
            bytes += buf.length; summary.files.count++;
          } catch (e) { summary.files.skipped++; }
        }
        if (items.length < 1000) break;
      }
    };
    await walk('');
  }
  summary.files.mb = +(bytes / 1e6).toFixed(1); log(`Images : ${summary.files.count} fichier(s), ${summary.files.mb} Mo${summary.files.skipped ? `, ${summary.files.skipped} ignoré(s)` : ''}`);
} catch (e) { summary.errors.push(`images : ${e.message}`); log(`Images ignorées (${e.message})`); }

await save('resume.json', summary);
if (!Object.keys(summary.tables).length) { console.error('Aucune table sauvegardée : vérifiez la clé SUPABASE_SERVICE_KEY.'); process.exit(1); }
log(summary.errors.length ? `Terminé avec ${summary.errors.length} avertissement(s).` : 'Terminé sans erreur.');
