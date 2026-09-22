// Répond sur chaque issue traitée et la ferme si besoin (après l'enregistrement de names.json).
import fs from 'node:fs/promises';

const env = process.env, repo = env.GITHUB_REPOSITORY;
const results = JSON.parse(await fs.readFile('results.json', 'utf8'));
const call = (method, path, body) => fetch(`https://api.github.com/repos/${repo}${path}`, {
  method, body: JSON.stringify(body),
  headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const r of results.replies) {
  await call('POST', `/issues/${r.issue}/comments`, { body: r.message });
  if (r.close) await call('PATCH', `/issues/${r.issue}`, { state: 'closed', state_reason: r.close });
  await sleep(800);   // doux avec l'API GitHub quand il y a beaucoup de demandes
}
console.log(`${results.replies.length} réponse(s) envoyée(s).`);
if (results.errors.length) { console.error(results.errors.join('\n')); process.exit(1); }
