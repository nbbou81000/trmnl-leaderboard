// Valide d'un coup toutes les demandes « Claim profile » encore ouvertes.
import { sanitize, parseForm, isClaim, claimId, loadNames, saveNames, knownCreators, applyName, saveResults } from './names-lib.mjs';

const env = process.env, repo = env.GITHUB_REPOSITORY;
const api = async (path) => {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub ${res.status} sur ${path}`);
  return res.json();
};

const issues = [];
for (let page = 1; page <= 20; page++) {
  const batch = await api(`/issues?state=open&per_page=100&page=${page}&direction=asc`);
  issues.push(...batch.filter(i => !i.pull_request && isClaim(i.body)));
  if (batch.length < 100) break;
}

const names = await loadNames();
const known = await knownCreators(repo);
const results = { changed: false, replies: [], errors: [] };
let ok = 0;
for (const i of issues) {
  const f = parseForm(i.body);
  const r = applyName(names, claimId(f), sanitize(f['name to display']), known);
  if (r.ok) { ok++; results.changed = true; }
  results.replies.push({ issue: i.number, close: r.ok ? 'completed' : '', message: r.message });
}
console.log(`${issues.length} demande(s) ouverte(s) : ${ok} validée(s), ${issues.length - ok} à corriger.`);
if (results.changed) await saveNames(names);
await saveResults(results);
