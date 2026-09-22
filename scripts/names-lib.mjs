// Outils partagés pour la gestion des noms de créateurs (names.json)
import fs from 'node:fs/promises';

export const FILE = 'names.json';

export function sanitize(name) {
  return String(name || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim();
}

// Lit les champs d'un formulaire d'issue (« ### Libellé » puis la valeur)
export function parseForm(body) {
  const fields = {};
  for (const p of String(body || '').split(/^###\s+/m).slice(1)) {
    const nl = p.indexOf('\n');
    const label = (nl < 0 ? p : p.slice(0, nl)).trim().toLowerCase();
    let value = (nl < 0 ? '' : p.slice(nl + 1)).trim();
    if (value === '_No response_') value = '';
    fields[label] = value;
  }
  return fields;
}
export const isClaim = body => /^###\s+Creator number/mi.test(String(body || ''));
export const claimId = f => String(f['creator number'] || '').replace(/[^\d]/g, '');

export async function loadNames() {
  try { return JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { return {}; }
}
export async function saveNames(names) {
  const sorted = Object.fromEntries(Object.entries(names).sort((a, b) => Number(a[0]) - Number(b[0])));
  await fs.writeFile(FILE, JSON.stringify(sorted, null, 2) + '\n');
}

// Numéros de créateurs connus d'après les données publiées (null si indisponible)
export async function knownCreators(repo) {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/gh-pages/data/latest.json`);
    if (!res.ok) return null;
    return new Set((await res.json()).creators.map(c => String(c.u)));
  } catch { return null; }
}

// Applique un nom (ou le retire si vide et autorisé). Renvoie { ok, action, message }.
export function applyName(names, id, name, known, { allowRemove = false } = {}) {
  if (!id) return { ok: false, message: "I couldn't find a valid creator number in this request. Could you edit the issue with the right number?" };
  if (known && !known.has(id)) return { ok: false, message: `Creator #${id} doesn't have any public recipe on the leaderboard right now. Could you double-check the number?` };
  if (!name) {
    if (!allowRemove) return { ok: false, message: 'The name to display is empty. Could you edit the issue and add one?' };
    if (!(id in names)) return { ok: false, message: `Creator #${id} has no name yet, nothing to remove.` };
    delete names[id];
    return { ok: true, action: 'removed', message: `Done: creator #${id} is back to showing a number.` };
  }
  const taken = Object.entries(names).find(([k, v]) => k !== id && String(v).toLowerCase() === name.toLowerCase());
  if (taken) return { ok: false, message: `The name "${name}" is already used by creator #${taken[0]}. Could you pick another one?` };
  const action = names[id] ? 'updated' : 'added';
  names[id] = name;
  return { ok: true, action, message: `All set! Creator #${id} will show up as **${name}** on the leaderboard within a few minutes. Thanks for joining in 🙌` };
}

// Résultat d'un passage, lu ensuite par reply-issues.mjs
export async function saveResults(results) {
  await fs.writeFile('results.json', JSON.stringify(results, null, 2));
}
