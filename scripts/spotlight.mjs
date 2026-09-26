// Choisit une "recette du jour" parmi celles à moins de 50 installations (seuil Creator Fund),
// en rotation équitable (chaque recette éligible passe avant qu'aucune ne repasse), récupère ses
// réglages sur sa page publique trmnl.com, et fait rédiger une présentation par Mistral.
// Aucune dépendance : Node 20+. Ne casse jamais le workflow : en cas d'erreur, on log et on sort proprement.
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'public/data';
const THRESHOLD = 50;
const MIN_AGE_DAYS = 2; // on écarte les recettes publiées il y a 48h ou moins (voir runSpotlight)
const DAY = 86400e3;
const MISTRAL_MODEL = 'mistral-small-latest';
const today = new Date().toISOString().slice(0, 10); // date UTC du jour, ex. 2026-09-26

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function fetchText(url, tries = 3) {
  for (let k = 1; ; k++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'trmnl-creators-stats (GitHub Actions)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (k >= tries) throw new Error(`${url} : ${e.message}`);
      console.log(`  nouvelle tentative ${k} (${e.message})`);
      await sleep(2000 * k);
    }
  }
}

// La page publique d'une recette (https://trmnl.com/recipes/<id>) affiche, quand il y en a,
// un bloc "Available settings" avec, pour chaque réglage, son nom (en majuscules) puis sa description.
// Structure observée (peut casser si TRMNL change son thème ; on renvoie [] sans planter le cas échéant).
function extractSettings(html) {
  if (!/Available settings/.test(html)) return [];
  const out = [];
  const re = /<p class="uppercase[^"]*">([^<]+)<\/p>[\s\S]*?<p class="text-gray-500 dark:text-gray-400 leading-7 text-sm mt-3">([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html))) {
    const name = m[1].replace(/\s+/g, ' ').trim();
    const desc = m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (name) out.push({ n: name, d: desc });
  }
  return out;
}

async function scrapeRecipePage(id) {
  try {
    const html = await fetchText(`https://trmnl.com/recipes/${id}`);
    return extractSettings(html);
  } catch (e) {
    console.log(`Page recette #${id} : ${e.message} (réglages ignorés)`);
    return [];
  }
}

async function mistralText(r, settings, lang) {
  const key = process.env.MISTRAL_API_KEY;
  const fr = lang === 'fr';
  const settingsTxt = settings.length
    ? settings.map(s => `- ${s.n} : ${s.d}`).join('\n')
    : (fr ? 'Aucun réglage particulier.' : 'No particular setting.');
  if (!key) {
    // Repli sans IA : on garde quelque chose d'affichable plutôt que de bloquer la mise en avant.
    return r.d || (fr ? `${r.n}, une recette TRMNL publique.` : `${r.n}, a public TRMNL recipe.`);
  }
  const prompt = fr
    ? `Tu rédiges une courte présentation (2 à 3 phrases, en français, ton chaleureux et clair, sans jargon technique) `
      + `d'un plugin communautaire pour l'écran e-ink TRMNL, à partir de ces informations vérifiées :\n`
      + `Nom : ${r.n}\nCatégories : ${r.c.join(', ') || 'non précisées'}\n`
      + `Description du créateur : ${r.d || '(aucune)'}\n`
      + `Réglages disponibles :\n${settingsTxt}\n\n`
      + `Explique à quoi sert ce plugin et, si des réglages existent, comment le configurer. `
      + `N'invente aucune information absente de ces données. Réponds uniquement par le texte de présentation, sans titre ni guillemets.`
    : `Write a short presentation (2 to 3 sentences, in English, warm and clear tone, no technical jargon) `
      + `of a community plugin for the TRMNL e-ink screen, from this verified information:\n`
      + `Name: ${r.n}\nCategories: ${r.c.join(', ') || 'unspecified'}\n`
      + `Creator's description: ${r.d || '(none)'}\n`
      + `Available settings:\n${settingsTxt}\n\n`
      + `Explain what this plugin does and, if settings exist, how to configure it. `
      + `Do not invent any information absent from this data. Reply with only the presentation text, no title or quotes.`;
  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MISTRAL_MODEL, temperature: 0.5, max_tokens: 220, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const txt = data.choices?.[0]?.message?.content?.trim();
    return txt || r.d || r.n;
  } catch (e) {
    console.log(`Appel Mistral (${lang}) : ${e.message} (repli sur la description brute)`);
    return r.d || (fr ? `${r.n}, une recette TRMNL publique.` : `${r.n}, a public TRMNL recipe.`);
  }
}

async function runSpotlight(latest) {
  const hist = await readJSON(path.join(OUT, 'spotlight-history.json'), { v: 1, cycle: 1, shown: [] });

  // Déjà traité aujourd'hui (le workflow tourne toutes les heures) : on ne fait rien de plus.
  if (hist.shown.some(x => x.date === today)) { console.log('Recette du jour déjà choisie aujourd\'hui.'); return; }

  // On écarte les recettes trop récentes : elles auraient de toute façon moins de 50 installations,
  // pas parce qu'elles sont délaissées mais simplement parce qu'elles viennent de sortir.
  const eligible = latest.recipes.filter(r => r.i < THRESHOLD && r.p && Date.now() - Date.parse(r.p) >= MIN_AGE_DAYS * DAY);
  if (!eligible.length) {
    console.log('Aucune recette sous le seuil actuellement : rien à mettre en avant.');
    await fs.writeFile(path.join(OUT, 'spotlight.json'), JSON.stringify({ v: 1, generated_at: new Date().toISOString(), empty: true }));
    return;
  }

  let shownThisCycle = new Set(hist.shown.filter(x => x.cycle === hist.cycle).map(x => x.id));
  let pool = eligible.filter(r => !shownThisCycle.has(r.id));
  if (!pool.length) {
    // Tout le monde est passé : on relance un cycle, sans perdre l'historique déjà affiché sur le site.
    hist.cycle += 1;
    pool = eligible;
    console.log(`Nouveau cycle de rotation (#${hist.cycle}) : toutes les recettes éligibles ont déjà eu leur tour.`);
  }

  // Rotation équitable : priorité à la recette publiée depuis le plus longtemps sans être passée.
  pool.sort((a, b) => (a.p ? Date.parse(a.p) : Infinity) - (b.p ? Date.parse(b.p) : Infinity));
  const picked = pool[0];

  const settings = await scrapeRecipePage(picked.id);
  const text_fr = await mistralText(picked, settings, 'fr');
  const text_en = await mistralText(picked, settings, 'en');

  const spotlight = {
    v: 1, generated_at: new Date().toISOString(), cycle: hist.cycle,
    id: picked.id, u: picked.u, n: picked.n, i: picked.i, missing: Math.max(0, THRESHOLD - picked.i),
    c: picked.c, ic: picked.ic, sc: picked.sc, p: picked.p, settings, text_fr, text_en,
  };
  await fs.writeFile(path.join(OUT, 'spotlight.json'), JSON.stringify(spotlight));

  hist.shown.push({ id: picked.id, u: picked.u, n: picked.n, date: today, cycle: hist.cycle });
  await fs.writeFile(path.join(OUT, 'spotlight-history.json'), JSON.stringify(hist));

  console.log(`Recette du jour : #${picked.id} « ${picked.n} » (${picked.i}/${THRESHOLD} installs, cycle ${hist.cycle}).`);
}

// ================= Pari du jour : "Ça va cartonner" =================
// Repéré parmi TOUTES les recettes du catalogue (pas seulement celles sous le seuil), sur un signal
// d'accélération : la vitesse des dernières 24h comparée au rythme moyen de la recette depuis sa
// publication. Un pari par jour, jamais le même que ceux des derniers jours ; chaque pari reste en
// mémoire pour être confronté aux chiffres réels BREAKOUT_VERIFY_DAYS plus tard.
const BREAKOUT_VERIFY_DAYS = 7;   // délai avant de vérifier si le pari était bon (voir note dans la réponse)
const BREAKOUT_MIN_D24 = 3;       // mouvement minimum sur 24h pour écarter le simple bruit
const BREAKOUT_COOLDOWN_DAYS = 3; // on évite de reproposer une recette déjà pariée récemment

function ageDaysOf(p) { return p ? Math.max(1, (Date.now() - Date.parse(p)) / DAY) : null; }
function breakoutScore(r) {
  if (r.d24 == null || r.d24 < BREAKOUT_MIN_D24) return null;
  const age = ageDaysOf(r.p);
  if (!age) return null;
  const ipd = r.i / age;                                  // rythme moyen historique (installs/jour)
  const accel = ipd > 0 ? r.d24 / ipd : r.d24;             // vitesse d'aujourd'hui vs ce rythme
  return accel * Math.log(1 + r.d24);                      // pondère par un volume minimum réel
}

async function runBreakout(latest) {
  const hist = await readJSON(path.join(OUT, 'breakout.json'), { v: 1, picks: [] });
  if (hist.picks.some(x => x.date === today)) { console.log('Pari du jour déjà choisi.'); return; }

  // On confronte aux chiffres actuels tout pari devenu assez ancien pour être jugé.
  const byId = new Map(latest.recipes.map(r => [r.id, r]));
  for (const p of hist.picks) {
    if (p.result) continue;
    if (Date.now() - Date.parse(p.date) < BREAKOUT_VERIFY_DAYS * DAY) continue;
    const now = byId.get(p.id);
    p.result = now
      ? { i_now: now.i, gain: now.i - p.i, checked_at: new Date().toISOString() }
      : { i_now: null, gain: null, checked_at: new Date().toISOString() }; // recette disparue de l'API
  }

  const recentIds = new Set(hist.picks.filter(x => Date.now() - Date.parse(x.date) < BREAKOUT_COOLDOWN_DAYS * DAY).map(x => x.id));
  let best = null, bestScore = -Infinity;
  for (const r of latest.recipes) {
    if (recentIds.has(r.id)) continue;
    const s = breakoutScore(r);
    if (s != null && s > bestScore) { bestScore = s; best = r; }
  }

  if (best) {
    hist.picks.push({
      id: best.id, u: best.u, n: best.n, c: best.c, ic: best.ic, sc: best.sc, d: best.d,
      i: best.i, d24: best.d24, score: Math.round(bestScore * 100) / 100, date: today, result: null,
    });
    console.log(`Pari du jour : #${best.id} « ${best.n} » (score ${bestScore.toFixed(2)}, +${best.d24} sur 24 h).`);
  } else {
    console.log("Aucune recette ne montre un signal d'accélération suffisant aujourd'hui : pas de pari.");
  }
  await fs.writeFile(path.join(OUT, 'breakout.json'), JSON.stringify(hist));
}

async function main() {
  const latest = await readJSON(path.join(OUT, 'latest.json'), null);
  if (!latest) { console.log('Pas encore de latest.json : recette du jour ignorée pour cette passe.'); return; }
  try { await runSpotlight(latest); } catch (e) { console.log(`Recette du jour : ${e.message}`); }
  try { await runBreakout(latest); } catch (e) { console.log(`Pari « ça va cartonner » : ${e.message}`); }
}

try { await main(); } catch (e) { console.log(`Recette du jour : ${e.message} (ignoré, le reste du workflow continue).`); }
