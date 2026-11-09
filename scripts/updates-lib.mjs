// « Recettes mises à jour » : empreinte de ce que l'API publique de TRMNL dit d'une recette, et comparaison de deux empreintes.
// On ne suit que des signaux sûrs, modifiés par l'auteur lui-même : nom, description courte, catégories,
// texte « About This Plugin » et réglages proposés à l'installation (ajoutés, retirés, options, libellé ou valeur par défaut).
// La capture d'écran n'est PAS suivie : TRMNL la régénère tout seul (son adresse change plusieurs fois par heure dans le catalogue).
// Un changement du seul code d'affichage n'est pas visible dans l'API publique : il n'apparaît donc pas ici.
import { createHash } from 'node:crypto';

const h = s => createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const OPT_MAX = 40;                       // au-delà, la liste d'options est résumée par son nombre et une empreinte
const SKIP_TYPES = new Set(['author_bio', 'hidden']);

// Libellé d'une option : « Texte » ou { 'Texte': 'valeur' }
const optLabel = o => o && typeof o === 'object' ? clean(Object.keys(o)[0]) : clean(o);

// Empreinte d'une recette telle que renvoyée par https://trmnl.com/recipes.json
// { n: nom, d: description, c: catégories, a: empreinte du texte About, f: [[clé, libellé, type, options, empreinte du reste], …] }
export function fingerprint(r) {
  const bio = r.author_bio && typeof r.author_bio === 'object' ? r.author_bio : {};
  const fields = [];
  const seen = new Set();
  for (const f of Array.isArray(r.custom_fields) ? r.custom_fields : []) {
    if (!f || typeof f !== 'object' || SKIP_TYPES.has(f.field_type)) continue;
    const key = clean(f.keyname); if (!key || seen.has(key)) continue;
    seen.add(key);
    const { keyname, name, field_type, options, ...rest } = f;
    let opts = null;
    if (Array.isArray(options)) {
      const labels = options.map(optLabel);
      opts = labels.length <= OPT_MAX ? labels : `#${labels.length}:${h(JSON.stringify(labels))}`;
    }
    const restKeys = Object.keys(rest).sort();
    fields.push([key, clean(name) || key, clean(field_type), opts, restKeys.length ? h(JSON.stringify(restKeys.map(k => [k, rest[k]]))) : '']);
  }
  return {
    n: clean(r.name) || 'Sans titre',
    d: clean(r.description),
    c: clean(bio.category).split(',').map(x => x.trim()).filter(Boolean).join(', '),
    a: h(clean(bio.description)),
    f: fields,
  };
}

const CAP = 8;   // nombre de noms listés par changement (le total reste indiqué)
const cap = list => list.length > CAP ? { x: list.slice(0, CAP), more: list.length - CAP } : { x: list };

// Liste des changements entre deux empreintes (vide si rien n'a bougé).
//  n / d / c : { k, a: avant, b: après }      a : texte About réécrit
//  f+ / f- / fm : réglages ajoutés / retirés / modifiés { k, x: [libellés], more? }
//  fo : options d'un réglage { k, x: libellé, add: […], del: […], more? }
export function diff(A, B) {
  const ch = [];
  if (A.n !== B.n) ch.push({ k: 'n', a: A.n, b: B.n });
  if (A.d !== B.d) ch.push({ k: 'd', a: A.d, b: B.d });
  if (A.c !== B.c) ch.push({ k: 'c', a: A.c, b: B.c });
  if (A.a !== B.a) ch.push({ k: 'a' });
  const fa = new Map((A.f || []).map(f => [f[0], f])), fb = new Map((B.f || []).map(f => [f[0], f]));
  const added = [...fb.values()].filter(f => !fa.has(f[0])).map(f => f[1]);
  const removed = [...fa.values()].filter(f => !fb.has(f[0])).map(f => f[1]);
  if (added.length) ch.push({ k: 'f+', ...cap(added) });
  if (removed.length) ch.push({ k: 'f-', ...cap(removed) });
  const modified = [];
  for (const [key, b] of fb) {
    const a = fa.get(key); if (!a) continue;
    const oa = a[3], ob = b[3];
    if (JSON.stringify(oa) !== JSON.stringify(ob)) {
      if (Array.isArray(oa) && Array.isArray(ob)) {
        const add = ob.filter(x => !oa.includes(x)), del = oa.filter(x => !ob.includes(x));
        if (add.length || del.length) { ch.push({ k: 'fo', x: b[1], add: add.slice(0, CAP), del: del.slice(0, CAP), ...(add.length + del.length > 2 * CAP ? { more: 1 } : {}) }); continue; }
      }
      modified.push(b[1]); continue;                       // liste trop longue, réordonnée, apparue ou disparue
    }
    if (a[1] !== b[1] || a[2] !== b[2] || a[4] !== b[4]) modified.push(b[1]);
  }
  if (modified.length) ch.push({ k: 'fm', ...cap(modified) });
  return ch;
}

// Fusionne deux listes de changements d'une même recette détectés à peu d'intervalle (l'auteur qui tâtonne) :
// pour n/d/c on garde l'état d'avant le plus ancien et l'état d'après le plus récent ; un aller-retour s'annule.
export function merge(oldCh, newCh) {
  const out = [];
  const one = k => {
    const a = oldCh.find(c => c.k === k), b = newCh.find(c => c.k === k);
    if (!a && !b) return;
    const m = { k, a: (a || b).a, b: (b || a).b };
    if (m.a !== m.b) out.push(m);
  };
  ['n', 'd', 'c'].forEach(one);
  if (oldCh.some(c => c.k === 'a') || newCh.some(c => c.k === 'a')) out.push({ k: 'a' });
  const names = k => [...new Set([...oldCh, ...newCh].filter(c => c.k === k).flatMap(c => c.x))];
  let plus = names('f+'), minus = names('f-');
  const both = plus.filter(x => minus.includes(x));          // ajouté puis retiré (ou l'inverse) : sans effet
  plus = plus.filter(x => !both.includes(x)); minus = minus.filter(x => !both.includes(x));
  if (plus.length) out.push({ k: 'f+', ...cap(plus) });
  if (minus.length) out.push({ k: 'f-', ...cap(minus) });
  const fo = new Map();
  for (const c of [...oldCh, ...newCh].filter(c => c.k === 'fo')) {
    const p = fo.get(c.x);
    if (!p) { fo.set(c.x, { k: 'fo', x: c.x, add: [...c.add], del: [...c.del] }); continue; }
    for (const o of c.add) { if (p.del.includes(o)) p.del = p.del.filter(y => y !== o); else if (!p.add.includes(o)) p.add.push(o); }
    for (const o of c.del) { if (p.add.includes(o)) p.add = p.add.filter(y => y !== o); else if (!p.del.includes(o)) p.del.push(o); }
  }
  for (const c of fo.values()) if (c.add.length || c.del.length) out.push({ ...c, add: c.add.slice(0, CAP), del: c.del.slice(0, CAP) });
  const mod = names('fm').filter(x => !plus.includes(x));
  if (mod.length) out.push({ k: 'fm', ...cap(mod) });
  return out;
}
