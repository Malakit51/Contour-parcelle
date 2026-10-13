// Page principale : charger TASKDATA.XML, toucher une limite ou un sommet, saisir les cm, exporter.

import './style.css';
import { controler, sommetsPresqueCommuns, type Alerte } from './edition/controles';
import {
  etatInitial,
  latLon,
  limitesJumelles,
  sommetsEn,
  suivant,
  precedent,
  type Etat,
  type RefLimite,
  type RefSommet,
} from './edition/etat';
import { exporterEtat, nouvelleSurface, parcellesModifiees } from './edition/export';
import { decalerLimite, ErreurEdition, glisserSommet, sensPositif } from './edition/operations';
import { planLocal, positionSurSegment, type Plan, type XY } from './geometrie/plan';
import { comparer } from './isoxml/comparaison';
import { lireTaskData, type TaskData } from './isoxml/lecture';
import { decoder, encoder } from './isoxml/octets';
import { Carte, type Dessin } from './ui/carte';
import { el } from './ui/dom';

const COULEURS = [
  '#2e7d32',
  '#1565c0',
  '#6a1b9a',
  '#00838f',
  '#ad1457',
  '#5d4037',
  '#827717',
  '#283593',
];
const SEL = '#e65100';
/** Rayon de toucher, en pixels à l'écran. */
const RAYON_TOUCHER_PX = 26;

interface Session {
  td: TaskData;
  plan: Plan;
  initial: Etat;
  etat: Etat;
  historique: Etat[];
  alertesChargement: string[];
}

let session: Session | null = null;
let mode: 'limite' | 'sommet' = 'limite';
let selLimite: RefLimite | null = null;
let selSommet: RefSommet | null = null;
let limiteGlisse: RefLimite | null = null;
let parcelleCourante: number | null = null;
let saisie = '50';
let message: { texte: string; erreur: boolean } | null = null;
let exportPrepare: { texte: string; alertes: Alerte[]; resume: string; details: string } | null =
  null;

const app = document.getElementById('app')!;
const carte = new Carte(toucher);

// ---------- Chargement ----------

async function charger(fichier: File): Promise<void> {
  try {
    const td = lireTaskData(decoder(new Uint8Array(await fichier.arrayBuffer())));
    if (td.parcelles.length === 0) throw new Error('Aucune parcelle (PFD) dans ce fichier.');
    const initial = etatInitial(td);
    const tous = initial.anneaux.flatMap((a) => a.sommets.map(latLon));
    const centre: [number, number] = [
      tous.reduce((s, p) => s + p[0], 0) / tous.length,
      tous.reduce((s, p) => s + p[1], 0) / tous.length,
    ];
    const alertesChargement = [];
    if (td.segmentsIgnores.length > 0) {
      alertesChargement.push(
        `${td.segmentsIgnores.length} segment(s) à deux points (LSG A="5") ignoré(s) : ils seront retirés à l'export.`,
      );
    }
    const vus = new Set<string>();
    for (const p of sommetsPresqueCommuns(td, initial, 1)) {
      const cle = `${p.noms[0]}|${p.noms[1]}|${p.distance.toFixed(3)}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      alertesChargement.push(
        `${p.noms[0]} / ${p.noms[1]} : deux sommets presque communs, à ${(p.distance * 100).toFixed(0)} cm.`,
      );
    }
    session = {
      td,
      plan: planLocal(centre),
      initial,
      etat: initial,
      historique: [],
      alertesChargement,
    };
    parcelleCourante = null;
    effacerSelection();
    message = {
      texte: `${fichier.name} chargé : ${td.parcelles.length} parcelles.`,
      erreur: false,
    };
    afficher();
    cadrerTout();
  } catch (e) {
    message = { texte: `Lecture impossible : ${(e as Error).message}`, erreur: true };
    afficher();
  }
}

// ---------- Géométrie d'affichage ----------

function anneauxXY(s: Session): XY[][] {
  return s.etat.anneaux.map((a) => a.sommets.map((p) => s.plan.versXY(latLon(p))));
}

function boite(pts: XY[]): [XY, XY] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

function cadrerTout(): void {
  if (!session) return;
  carte.cadrer(...boite(anneauxXY(session).flat()));
}

function cadrerParcelle(p: number): void {
  if (!session) return;
  const s = session;
  const pts = anneauxXY(s)
    .filter((_, i) => s.etat.anneaux[i]!.parcelle === p)
    .flat();
  carte.cadrer(...boite(pts));
}

/** « Nord », « Sud », « Est » ou « Ouest » : côté de la parcelle où se trouve la limite. */
function coteLimite(s: Session, ref: RefLimite): string {
  const pts = anneauxXY(s)[ref.anneau]!;
  const a = pts[ref.debut]!;
  const b = pts[(ref.debut + 1) % pts.length]!;
  const c: XY = [
    pts.reduce((u, p) => u + p[0], 0) / pts.length,
    pts.reduce((u, p) => u + p[1], 0) / pts.length,
  ];
  const m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) return m[1] > c[1] ? 'Nord' : 'Sud';
  return m[0] < c[0] ? 'Ouest' : 'Est';
}

function longueur(s: Session, ref: RefLimite): number {
  // Mesurée dans un plan centré sur la limite : le plan d'affichage déforme un peu les distances.
  const a = latLon(s.etat.anneaux[ref.anneau]!.sommets[ref.debut]!);
  const b = latLon(s.etat.anneaux[ref.anneau]!.sommets[suivant(s.etat, ref.anneau, ref.debut)]!);
  return Math.hypot(...planLocal(a).versXY(b));
}

const nomParcelle = (s: Session, anneau: number) =>
  s.td.parcelles[s.etat.anneaux[anneau]!.parcelle]!.nom;

// ---------- Sélection au doigt ----------

function toucher(p: XY, pixelsParMetre: number): void {
  if (!session) return;
  const s = session;
  const rayon = RAYON_TOUCHER_PX / pixelsParMetre;
  const anneaux = anneauxXY(s);
  // La parcelle courante passe en premier : en cas d'égalité (limite partagée), c'est elle qui gagne.
  const ordre = anneaux
    .map((_, i) => i)
    .sort(
      (i, j) =>
        Number(s.etat.anneaux[j]!.parcelle === parcelleCourante) -
        Number(s.etat.anneaux[i]!.parcelle === parcelleCourante),
    );
  let meilleur: { anneau: number; indice: number; d: number } | null = null;
  for (const i of ordre) {
    const pts = anneaux[i]!;
    pts.forEach((q, k) => {
      let d: number;
      if (mode === 'sommet') {
        d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      } else {
        const r = pts[(k + 1) % pts.length]!;
        const pos = positionSurSegment(p, q, r);
        d =
          pos.t < 0
            ? Math.hypot(p[0] - q[0], p[1] - q[1])
            : pos.t > 1
              ? Math.hypot(p[0] - r[0], p[1] - r[1])
              : pos.ecart;
      }
      if (d <= rayon && (!meilleur || d < meilleur.d - 1e-6))
        meilleur = { anneau: i, indice: k, d };
    });
  }
  const choix = meilleur as { anneau: number; indice: number } | null;
  effacerSelection();
  if (choix) {
    parcelleCourante = s.etat.anneaux[choix.anneau]!.parcelle;
    if (mode === 'limite') selLimite = { anneau: choix.anneau, debut: choix.indice };
    else selSommet = { anneau: choix.anneau, sommet: choix.indice };
  }
  message = null;
  afficher();
}

function effacerSelection(): void {
  selLimite = null;
  selSommet = null;
  limiteGlisse = null;
  exportPrepare = null;
}

// ---------- Appliquer, annuler ----------

function cm(): number {
  const v = Number(saisie);
  return Number.isFinite(v) ? v : 0;
}

function appliquer(): void {
  if (!session) return;
  const s = session;
  const d = cm() / 100;
  try {
    let nouveau: Etat;
    let quoi: string;
    if (mode === 'limite' && selLimite) {
      quoi = `Limite ${coteLimite(s, selLimite)} de ${nomParcelle(s, selLimite.anneau)} décalée de ${signe(cm())} cm`;
      nouveau = decalerLimite(s.etat, selLimite, d);
    } else if (mode === 'sommet' && selSommet && limiteGlisse) {
      quoi = `Sommet de ${nomParcelle(s, selSommet.anneau)} déplacé de ${signe(cm())} cm`;
      nouveau = glisserSommet(s.etat, selSommet, limiteGlisse, d);
    } else {
      return;
    }
    if (nouveau === s.etat) return;
    s.historique.push(s.etat);
    s.etat = nouveau;
    effacerSelection();
    message = { texte: `${quoi}.`, erreur: false };
  } catch (e) {
    message = {
      texte: e instanceof ErreurEdition ? e.message : `Erreur : ${(e as Error).message}`,
      erreur: true,
    };
  }
  afficher();
}

const signe = (v: number) => (v > 0 ? `+${v}` : String(v));

function annuler(): void {
  const precedentEtat = session?.historique.pop();
  if (!session || !precedentEtat) return;
  session.etat = precedentEtat;
  effacerSelection();
  message = { texte: 'Dernière modification annulée.', erreur: false };
  afficher();
}

function reinitialiser(): void {
  if (!session || session.historique.length === 0) return;
  if (!confirm('Revenir au fichier d’origine ? Toutes les modifications seront perdues.')) return;
  session.etat = session.initial;
  session.historique = [];
  effacerSelection();
  message = { texte: 'Retour au fichier d’origine.', erreur: false };
  afficher();
}

// ---------- Export ----------

function preparerExport(): void {
  if (!session) return;
  const s = session;
  const texte = exporterEtat(s.td, s.etat);
  const alertes = controler(s.td, s.etat, parcellesModifiees(s.etat));
  const diffs = comparer(s.td.texte, texte);
  const modifiees = diffs.filter((d) => d.avant !== null && d.apres !== null).length;
  const ajoutees = diffs.filter((d) => d.avant === null).length;
  const retirees = diffs.filter((d) => d.apres === null).length;
  const resume = `${modifiees} ligne(s) modifiée(s), ${ajoutees} ajoutée(s), ${retirees} retirée(s).`;
  const details = diffs
    .map((d) =>
      d.avant !== null && d.apres !== null
        ? `ligne ${d.ligneAvant} modifiée\n  avant : ${d.avant.trimEnd()}\n  après : ${d.apres.trimEnd()}`
        : d.avant !== null
          ? `ligne ${d.ligneAvant} retirée : ${d.avant.trimEnd()}`
          : `ligne ajoutée (${d.ligneApres}) : ${d.apres!.trimEnd()}`,
    )
    .join('\n');
  exportPrepare = { texte, alertes, resume, details };
  afficher();
}

function telecharger(): void {
  if (!exportPrepare) return;
  if (
    exportPrepare.alertes.some((a) => a.grave) &&
    !confirm('Des problèmes graves ont été trouvés. Télécharger quand même ?')
  ) {
    return;
  }
  const blob = new Blob([encoder(exportPrepare.texte) as BlobPart], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'TASKDATA.XML' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- Affichage ----------

function dessin(s: Session): Dessin {
  const anneaux = anneauxXY(s);
  const d: Dessin = {
    anneaux: anneaux.map((pts, i) => {
      const a = s.etat.anneaux[i]!;
      return {
        pts,
        couleur: COULEURS[a.parcelle % COULEURS.length]!,
        courant: a.parcelle === parcelleCourante,
        nom: a.type === 1 ? s.td.parcelles[a.parcelle]!.nom : null,
      };
    }),
    traits: [],
    points: [],
  };
  const trait = (ref: RefLimite, epaisseur: number) => {
    const pts = anneaux[ref.anneau]!;
    d.traits.push({
      a: pts[ref.debut]!,
      b: pts[(ref.debut + 1) % pts.length]!,
      couleur: SEL,
      epaisseur,
    });
  };
  if (selLimite) trait(selLimite, 7);
  if (selSommet) {
    if (limiteGlisse) trait(limiteGlisse, 5);
    d.points.push({ p: anneaux[selSommet.anneau]![selSommet.sommet]!, couleur: SEL, rayon: 9 });
  }
  return d;
}

function panneauSelection(s: Session): HTMLElement {
  if (mode === 'limite') {
    if (!selLimite) return el('div', { class: 'info doux' }, 'Touchez une limite sur la carte.');
    const ref = selLimite;
    const x = nomParcelle(s, ref.anneau);
    const jum = limitesJumelles(s.etat, ref);
    const type = s.etat.anneaux[ref.anneau]!.type;
    let titre: string;
    let sens: string;
    if (jum.length > 0) {
      const y = jum.map((j) => nomParcelle(s, j.anneau)).join(', ');
      titre = `Limite commune ${x} / ${y}`;
      sens = `+ = vers ${y} (${x} s'agrandit) · − = vers ${x} (${y} s'agrandit)`;
    } else if (type === 1) {
      titre = `Limite ${coteLimite(s, ref)} de ${x}`;
      sens = `+ = vers l'extérieur (${x} s'agrandit) · − = vers l'intérieur`;
    } else {
      titre = `Bord de la zone exclue de ${x}`;
      sens = `+ = la zone exclue rétrécit (${x} s'agrandit) · − = elle s'agrandit`;
    }
    return el(
      'div',
      { class: 'info' },
      el('div', {}, el('strong', {}, titre)),
      el('div', { class: 'doux' }, `Longueur : ${longueur(s, ref).toFixed(1).replace('.', ',')} m`),
      el('div', { class: 'sens' }, sens),
    );
  }
  if (!selSommet) return el('div', { class: 'info doux' }, 'Touchez un sommet sur la carte.');
  const ref = selSommet;
  const autres = new Set(
    sommetsEn(s.etat, latLon(s.etat.anneaux[ref.anneau]!.sommets[ref.sommet]!))
      .map((r) => nomParcelle(s, r.anneau))
      .filter((n) => n !== nomParcelle(s, ref.anneau)),
  );
  const limites: RefLimite[] = [
    { anneau: ref.anneau, debut: ref.sommet },
    { anneau: ref.anneau, debut: precedent(s.etat, ref.anneau, ref.sommet) },
  ];
  const boutons = el(
    'div',
    { class: 'rangee' },
    ...limites.map((l) =>
      el(
        'button',
        {
          class: limiteGlisse?.debut === l.debut ? 'actif' : '',
          onclick: () => {
            limiteGlisse = l;
            afficher();
          },
        },
        `Limite ${coteLimite(s, l)} (${Math.round(longueur(s, l))} m)`,
      ),
    ),
  );
  let sens: string | null = null;
  if (limiteGlisse) {
    sens =
      sensPositif(s.etat, limiteGlisse) === 'Est'
        ? '+ = vers l’Est · − = vers l’Ouest'
        : '+ = vers le Nord · − = vers le Sud';
  }
  return el(
    'div',
    { class: 'info' },
    el(
      'div',
      {},
      el('strong', {}, `Sommet de ${nomParcelle(s, ref.anneau)}`),
      autres.size > 0 ? ` (commun avec ${[...autres].join(', ')})` : '',
    ),
    el('div', { class: 'doux' }, 'Le long de quelle limite le faire glisser ?'),
    boutons,
    sens && el('div', { class: 'sens' }, sens),
  );
}

function pave(): HTMLElement {
  const changer = (v: string) => {
    saisie = v;
    afficher();
  };
  const touche = (k: string) => {
    let v = saisie;
    if (k === '⌫') v = v.slice(0, -1);
    else if (k === 'C') v = '';
    else if (k === '+') v = v.replace(/^-/, '');
    else if (k === '−') v = v.startsWith('-') ? v : '-' + v;
    else {
      if (v === '0') v = '';
      if (v === '-0') v = '-';
      if (v.replace('-', '').length >= 5) return;
      v += k;
    }
    changer(v);
  };
  const touches = ['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', '+', '−', '0'];
  return el(
    'div',
    {},
    el(
      'div',
      { class: 'rangee' },
      'Distance :',
      el('span', { class: 'affichage-cm' }, saisie === '' ? '0' : saisie),
      'cm',
    ),
    el(
      'div',
      { class: 'raccourcis' },
      ...[-100, -50, -10, 10, 50, 100].map((v) =>
        el('button', { onclick: () => changer(String(cm() + v)) }, v > 0 ? `+${v}` : `−${-v}`),
      ),
    ),
    el(
      'div',
      { class: 'pave', style: 'margin-top:6px' },
      ...touches.map((k) =>
        el(
          'button',
          { onclick: () => touche(k), style: k === '0' ? 'grid-column: span 3' : '' },
          k,
        ),
      ),
    ),
  );
}

function tableauSurfaces(s: Session): HTMLElement | null {
  const modifiees = parcellesModifiees(s.etat);
  if (modifiees.length === 0) return null;
  const ha = (m2: number) => (m2 / 10_000).toFixed(4).replace('.', ',');
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Surfaces (D)'),
    el(
      'table',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Parcelle'),
        el('th', {}, 'avant (ha)'),
        el('th', {}, 'après (ha)'),
        el('th', {}, 'écart (m²)'),
      ),
      ...modifiees.map((p) => {
        const avant = Number(s.td.parcelles[p]!.surface?.texte ?? NaN);
        const apres = nouvelleSurface(s.td, s.etat, p) ?? NaN;
        const ecart = Math.round(apres) - avant;
        return el(
          'tr',
          {},
          el('td', {}, s.td.parcelles[p]!.nom),
          el('td', {}, ha(avant)),
          el('td', {}, ha(Math.round(apres))),
          el('td', {}, signe(ecart)),
        );
      }),
    ),
  );
}

function panneauExport(): HTMLElement {
  const bloc = el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Export'),
    el(
      'div',
      { class: 'rangee' },
      el('button', { onclick: preparerExport }, 'Vérifier avant export'),
    ),
  );
  if (exportPrepare) {
    const graves = exportPrepare.alertes.filter((a) => a.grave);
    bloc.append(
      el(
        'div',
        {},
        exportPrepare.alertes.length === 0
          ? el(
              'div',
              {},
              '✓ Contrôles : aucun problème (contours fermés, pas de recoupement ni de chevauchement, sommets communs identiques).',
            )
          : el(
              'div',
              {},
              ...exportPrepare.alertes.map((a) =>
                el('div', { class: a.grave ? 'erreur' : '' }, (a.grave ? '✗ ' : '⚠ ') + a.message),
              ),
            ),
        el('div', {}, `Différences avec l’original : ${exportPrepare.resume}`),
        el(
          'details',
          {},
          el('summary', {}, 'Voir chaque différence'),
          el('pre', {}, exportPrepare.details),
        ),
        el(
          'div',
          { class: 'rangee' },
          el(
            'button',
            { class: 'principal', onclick: telecharger },
            graves.length > 0 ? 'Télécharger malgré tout' : 'Télécharger TASKDATA.XML',
          ),
        ),
        el(
          'div',
          { class: 'doux' },
          'Le fichier arrive dans « Téléchargements ». Copiez-le ensuite à la place de TASKDATA.XML dans une copie du dossier sur la clé.',
        ),
      ),
    );
  }
  return bloc;
}

function afficher(): void {
  const choixFichier = el(
    'label',
    { class: 'bouton-fichier' },
    session ? 'Autre fichier' : 'Ouvrir TASKDATA.XML',
  );
  const input = el('input', { type: 'file' });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void charger(f);
  });
  choixFichier.append(input);

  const enTete = el(
    'div',
    { class: 'rangee' },
    el('h1', { style: 'flex:1' }, 'Contours parcelles'),
    choixFichier,
  );
  const msg =
    message && el('div', { class: message.erreur ? 'info erreur' : 'info' }, message.texte);

  if (!session) {
    app.replaceChildren(
      enTete,
      msg || '',
      el(
        'div',
        { class: 'info' },
        'Ouvrez le fichier TASKDATA.XML exporté par la console (depuis la clé USB ou les téléchargements). ',
        'Tout reste sur le téléphone : rien n’est envoyé sur Internet.',
      ),
    );
    return;
  }
  const s = session;

  const choixParcelle = el('select', {});
  choixParcelle.append(el('option', { value: '' }, 'Toutes les parcelles'));
  s.td.parcelles
    .map((p, i) => ({ nom: p.nom, i }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }))
    .forEach(({ nom, i }) => {
      const o = el('option', { value: String(i) }, nom);
      if (i === parcelleCourante) o.selected = true;
      choixParcelle.append(o);
    });
  choixParcelle.addEventListener('change', () => {
    parcelleCourante = choixParcelle.value === '' ? null : Number(choixParcelle.value);
    effacerSelection();
    afficher();
    if (parcelleCourante === null) cadrerTout();
    else cadrerParcelle(parcelleCourante);
  });

  const peutAppliquer =
    (mode === 'limite' && selLimite !== null) ||
    (mode === 'sommet' && selSommet !== null && limiteGlisse !== null);

  const modeBouton = (m: typeof mode, texte: string) =>
    el(
      'button',
      {
        class: mode === m ? 'principal' : '',
        onclick: () => {
          mode = m;
          effacerSelection();
          afficher();
        },
      },
      texte,
    );

  app.replaceChildren(
    enTete,
    el(
      'div',
      { class: 'rangee' },
      choixParcelle,
      el('button', { onclick: () => carte.zoomer(1.6) }, '+'),
      el('button', { onclick: () => carte.zoomer(1 / 1.6) }, '−'),
    ),
    carte.element,
    el(
      'div',
      { class: 'rangee' },
      modeBouton('limite', 'Décaler une limite'),
      modeBouton('sommet', 'Déplacer un point'),
    ),
    panneauSelection(s),
    pave(),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        { class: 'principal', onclick: appliquer, ...(peutAppliquer ? {} : { disabled: '' }) },
        'Appliquer',
      ),
      el(
        'button',
        { onclick: annuler, ...(s.historique.length > 0 ? {} : { disabled: '' }) },
        'Annuler',
      ),
      el(
        'button',
        { onclick: reinitialiser, ...(s.historique.length > 0 ? {} : { disabled: '' }) },
        'Réinitialiser',
      ),
    ),
    msg || '',
    tableauSurfaces(s) || '',
    panneauExport(),
    s.alertesChargement.length > 0
      ? el(
          'details',
          { class: 'info' },
          el('summary', {}, `Remarques sur le fichier (${s.alertesChargement.length})`),
          ...s.alertesChargement.map((a) => el('div', {}, a)),
        )
      : '',
  );
  carte.afficher(dessin(s));
}

afficher();
