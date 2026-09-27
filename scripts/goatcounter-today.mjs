// Récupère le nombre de visites du jour (GoatCounter, compteur public) et le publie
// dans un petit fichier JSON statique — pour que le widget Rainmeter puisse le lire
// avec une simple URL fixe, sans jamais avoir à construire la date lui-même.
import fs from 'node:fs/promises';

const OUT = process.argv[2] || 'public/data';
const today = new Date().toISOString().slice(0, 10);

async function main() {
  const res = await fetch(`https://trmnl-leaderboard.goatcounter.com/counter/TOTAL.json?start=${today}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const out = { v: 1, generated_at: new Date().toISOString(), date: today, count: data.count ?? null };
  await fs.writeFile(`${OUT}/visits-today.json`, JSON.stringify(out));
  console.log(`Visites du jour (${today}) : ${out.count}`);
}

try { await main(); } catch (e) { console.log(`Visites du jour : ${e.message} (ignoré, le reste du workflow continue).`); }
