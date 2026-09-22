// Ajoute, modifie ou retire un nom dans names.json.
// Appelé par le workflow « Noms des créateurs » : soit depuis une issue « Claim profile »
// (commentaire /approve ou /reject du propriétaire du dépôt), soit à la main (Run workflow).
import fs from 'node:fs/promises';

const env = process.env;
const FILE = 'names.json';
const out = {};

function sanitize(name) {
  return String(name || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim();
}

// Lit les champs d'un formulaire d'issue (« ### Libellé » puis la valeur)
function parseForm(body) {
  const fields = {};
  const parts = String(body || '').split(/^###\s+/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n');
    const label = (nl < 0 ? p : p.slice(0, nl)).trim().toLowerCase();
    let value = (nl < 0 ? '' : p.slice(nl + 1)).trim();
    if (value === '_No response_') value = '';
    fields[label] = value;
  }
  return fields;
}

async function knownCreator(id) {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${env.GITHUB_REPOSITORY}/gh-pages/data/latest.json`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.creators.some(c => String(c.u) === id);
  } catch { return null; }   // vérification impossible : on ne bloque pas
}

async function writeOutputs() {
  if (!env.GITHUB_OUTPUT) { console.log(out); return; }
  let s = '';
  for (const [k, v] of Object.entries(out)) s += `${k}<<__EOF__\n${v}\n__EOF__\n`;
  await fs.appendFile(env.GITHUB_OUTPUT, s);
}

let names = {};
try { names = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { names = {}; }

let id = '', name = '', fromIssue = env.EVENT === 'issue_comment';

if (fromIssue) {
  const cmd = String(env.COMMENT || '').trim();
  const f = parseForm(env.ISSUE_BODY);
  id = String(f['creator number'] || '').replace(/[^\d]/g, '');
  if (cmd.startsWith('/reject')) {
    out.message = `Thanks for the request! It won't be added this time${sanitize(cmd.slice(7)) ? `: ${sanitize(cmd.slice(7)).replace(/[.!]$/, '')}.` : '.'} Feel free to open a new one if anything changes.`;
    out.close = 'not_planned';
    await writeOutputs(); process.exit(0);
  }
  // « /approve » seul, ou « /approve Autre nom » pour corriger le nom proposé
  const override = sanitize(cmd.replace(/^\/approve/, ''));
  name = override || sanitize(f['name to display']);
} else {
  id = String(env.IN_ID || '').replace(/[^\d]/g, '');
  name = sanitize(env.IN_NAME);
}

const fail = msg => { out.message = msg; out.close = ''; out.changed = 'no'; return writeOutputs().then(() => process.exit(fromIssue ? 0 : 1)); };

if (!id) await fail("I couldn't find a valid creator number in this request. Could you edit the issue with the right number?");
const known = await knownCreator(id);
if (known === false) await fail(`Creator #${id} doesn't have any public recipe on the leaderboard right now. Could you double-check the number?`);

if (!name) {
  // Sans nom : retrait (uniquement possible à la main)
  if (fromIssue) await fail('The name to display is empty. Could you edit the issue and add one?');
  if (!(id in names)) await fail(`Creator #${id} has no name in names.json, nothing to remove.`);
  delete names[id];
  out.action = 'removed';
} else {
  const taken = Object.entries(names).find(([k, v]) => k !== id && String(v).toLowerCase() === name.toLowerCase());
  if (taken) await fail(`The name "${name}" is already used by creator #${taken[0]}. Could you pick another one?`);
  out.action = names[id] ? 'updated' : 'added';
  names[id] = name;
}

const sorted = Object.fromEntries(Object.entries(names).sort((a, b) => Number(a[0]) - Number(b[0])));
await fs.writeFile(FILE, JSON.stringify(sorted, null, 2) + '\n');
out.changed = 'yes';
out.id = id;
out.message = out.action === 'removed'
  ? `Done: creator #${id} is back to showing a number.`
  : `All set! Creator #${id} will show up as **${name}** on the leaderboard within a few minutes. Thanks for joining in 🙌`;
out.close = 'completed';
console.log(`${out.action} #${id}${name ? ' → ' + name : ''}`);
await writeOutputs();
