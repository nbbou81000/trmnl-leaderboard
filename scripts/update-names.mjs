// Une demande à la fois : commentaire /approve ou /reject sur une issue, ou saisie manuelle.
import { sanitize, parseForm, claimId, loadNames, saveNames, knownCreators, applyName, saveResults } from './names-lib.mjs';

const env = process.env;
const names = await loadNames();
const results = { changed: false, replies: [], errors: [] };
const known = await knownCreators(env.GITHUB_REPOSITORY);

if (env.EVENT === 'issue_comment') {
  const cmd = String(env.COMMENT || '').trim();
  const issue = Number(env.ISSUE_NUMBER);
  if (cmd.startsWith('/reject')) {
    const why = sanitize(cmd.slice(7)).replace(/[.!]$/, '');
    results.replies.push({ issue, close: 'not_planned', message: `Thanks for the request! It won't be added this time${why ? `: ${why}.` : '.'} Feel free to open a new one if anything changes.` });
  } else {
    const f = parseForm(env.ISSUE_BODY);
    const override = sanitize(cmd.replace(/^\/approve/, ''));   // « /approve Autre nom »
    const r = applyName(names, claimId(f), override || sanitize(f['name to display']), known);
    results.changed = r.ok;
    results.replies.push({ issue, close: r.ok ? 'completed' : '', message: r.message });
  }
} else {
  const id = String(env.IN_ID || '').replace(/[^\d]/g, '');
  const r = applyName(names, id, sanitize(env.IN_NAME), known, { allowRemove: true });
  results.changed = r.ok;
  if (!r.ok) results.errors.push(r.message);
  console.log(r.message);
}

if (results.changed) await saveNames(names);
await saveResults(results);
