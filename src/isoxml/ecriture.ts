// Export d'un TASKDATA.XML : on part du texte d'origine et on ne remplace que les valeurs modifiées.

import type { Parcelle, Plage, Point, TaskData, ValeurBrute } from './lecture';

export interface Changements {
  /** Nouvelles coordonnées, en degrés décimaux. */
  points?: ReadonlyArray<{ point: Point; lat: number; lon: number }>;
  /** Points ajoutés, écrits sur de nouvelles lignes juste après la ligne du point `apres`. */
  insertions?: ReadonlyArray<{ apres: Point; points: ReadonlyArray<{ lat: number; lon: number }> }>;
  /** Points retirés : leur ligne entière disparaît. */
  suppressions?: ReadonlyArray<Point>;
  /** Nouvelles surfaces, en m². */
  surfaces?: ReadonlyArray<{ parcelle: Parcelle; m2: number }>;
  /** Retire les segments LSG A="5" (oui par défaut). */
  retirerSegments?: boolean;
  /** Lignes de guidage à écrire (LSG A="5"), juste avant le contour de leur parcelle. */
  guidages?: ReadonlyArray<{
    parcelle: Parcelle;
    lignes: ReadonlyArray<{ nom: string; points: ReadonlyArray<{ lat: number; lon: number }> }>;
  }>;
  /** Parcelles retirées du fichier, avec les tâches (TSK) qui s'y rapportent. */
  parcellesRetirees?: ReadonlyArray<Parcelle>;
  /** Zones exclues retirées : lignes entières de leur LSG. */
  zonesRetirees?: ReadonlyArray<Plage>;
  /**
   * Zones exclues créées (LSG A="2"), écrites à la position `apres` (fin des lignes du dernier
   * anneau de la parcelle), sur le modèle des points du contour de la parcelle.
   */
  zonesAjoutees?: ReadonlyArray<{
    parcelle: Parcelle;
    apres: number;
    zones: ReadonlyArray<ReadonlyArray<{ lat: number; lon: number }>>;
  }>;
}

/** Étend une plage aux lignes entières qu'elle occupe (fin de ligne comprise). */
function lignesDe(texte: string, plage: Plage): Plage {
  const debut = texte.lastIndexOf('\n', plage.debut - 1) + 1;
  const n = texte.indexOf('\n', plage.fin);
  return { debut, fin: n < 0 ? texte.length : n + 1 };
}

/** Fin de l'élément ouvert par la balise `debut..finBalise` (`<X …/>` ou jusqu'à `</X>`). */
function finElement(texte: string, nom: string, finBalise: number): number {
  if (texte[finBalise - 2] === '/') return finBalise;
  const f = texte.indexOf(`</${nom}>`, finBalise);
  if (f < 0) throw new Error(`Élément ${nom} non fermé.`);
  return f + nom.length + 3;
}

/**
 * Bloc d'une parcelle (son PFD, lignes entières) et des tâches qui s'y rapportent (TSK dont
 * l'attribut E est l'identifiant de la parcelle), avec le nom de chaque tâche.
 */
export function blocsDeParcelle(
  texte: string,
  id: string,
): { pfd: Plage | null; taches: { plage: Plage; nom: string }[] } {
  const echappe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pfd: Plage | null = null;
  const ouvrant = new RegExp(`<PFD\\b[^>]*\\sA="${echappe}"[^>]*>`).exec(texte);
  if (ouvrant) {
    const fin = finElement(texte, 'PFD', ouvrant.index + ouvrant[0].length);
    pfd = lignesDe(texte, { debut: ouvrant.index, fin });
  }
  const taches: { plage: Plage; nom: string }[] = [];
  for (const m of texte.matchAll(/<TSK\b[^>]*>/g)) {
    if (!new RegExp(`\\sE="${echappe}"`).test(m[0])) continue;
    const fin = finElement(texte, 'TSK', m.index + m[0].length);
    taches.push({
      plage: lignesDe(texte, { debut: m.index, fin }),
      nom: /\sB="([^"]*)"/.exec(m[0])?.[1] ?? '',
    });
  }
  return { pfd, taches };
}

const echapper = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Lignes de guidage au format de la console Claas : un LSG A="5" nommé, des PNT de type 2 avec
 * 13 décimales et une altitude E="0".
 */
export function texteGuidages(
  lignes: ReadonlyArray<{ nom: string; points: ReadonlyArray<{ lat: number; lon: number }> }>,
  finDeLigne: string,
): string {
  return lignes
    .map(
      ({ nom, points }) =>
        `<LSG A="5" B="${echapper(nom)}">${finDeLigne}` +
        points
          .map((p) => {
            if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
              throw new Error(`Ligne « ${nom} » : coordonnée invalide (calcul impossible).`);
            }
            return `<PNT A="2" C="${p.lat.toFixed(13)}" D="${p.lon.toFixed(13)}" E="0"/>${finDeLigne}`;
          })
          .join('') +
        `</LSG>${finDeLigne}`,
    )
    .join('');
}

/**
 * Zone exclue au format du fichier : `<LSG A="2">`, puis une ligne par point sur le modèle du
 * premier point du contour (mêmes attributs, autant de décimales), le premier marqué B="start",
 * le dernier répétant le premier avec B="end", comme la zone de 13 Jard ; `</LSG>`.
 */
export function texteZoneExclue(
  texte: string,
  modele: Point,
  zone: ReadonlyArray<{ lat: number; lon: number }>,
  finDeLigne: string,
): string {
  const balise = texte.slice(modele.balise.debut, modele.balise.fin).replace(/\sB="[^"]*"/, '');
  const ligne = (p: { lat: number; lon: number }, b: string | null) =>
    balise
      .replace(/(\sC=")[^"]*"/, `$1${formaterComme(p.lat, modele.latBrute)}"`)
      .replace(/(\sD=")[^"]*"/, `$1${formaterComme(p.lon, modele.lonBrute)}"`)
      .replace(/^<PNT(\s+A="[^"]*")?/, (m) => (b ? `${m} B="${b}"` : m)) + finDeLigne;
  const premier = zone[0]!;
  return (
    `<LSG A="2">${finDeLigne}` +
    zone.map((p, k) => ligne(p, k === 0 ? 'start' : null)).join('') +
    ligne(premier, 'end') +
    `</LSG>${finDeLigne}`
  );
}

interface Remplacement {
  plage: Plage;
  texte: string;
}

/** Écrit `valeur` avec autant de décimales que la valeur d'origine. */
export function formaterComme(valeur: number, origine: ValeurBrute): string {
  if (!Number.isFinite(valeur)) throw new Error('Coordonnée invalide (calcul impossible).');
  const decimales = origine.texte.split('.')[1]?.length ?? 0;
  return valeur.toFixed(decimales);
}

/**
 * La ligne entière (fin de ligne comprise) qui contient `balise`, si elle ne contient rien d'autre
 * que des espaces ; sinon null.
 */
function ligneSeule(texte: string, balise: Plage): Plage | null {
  const debut = texte.lastIndexOf('\n', balise.debut - 1) + 1;
  const n = texte.indexOf('\n', balise.fin);
  const fin = n < 0 ? texte.length : n + 1;
  const autour = texte.slice(debut, balise.debut) + texte.slice(balise.fin, fin);
  if (n < 0 || autour.trim() !== '') return null;
  return { debut, fin };
}

export function remplacer(texte: string, remplacements: Remplacement[]): string {
  const tries = [...remplacements].sort(
    (a, b) => a.plage.debut - b.plage.debut || a.plage.fin - b.plage.fin,
  );
  let resultat = '';
  let curseur = 0;
  let precedent: Plage | null = null;
  for (const r of tries) {
    // Deux insertions au même endroit : leur ordre serait arbitraire, on refuse.
    const memeInsertion =
      precedent !== null &&
      precedent.debut === precedent.fin &&
      r.plage.debut === r.plage.fin &&
      r.plage.debut === precedent.debut;
    if (r.plage.debut < curseur || memeInsertion) {
      throw new Error(`Deux modifications se chevauchent (position ${r.plage.debut}).`);
    }
    precedent = r.plage;
    resultat += texte.slice(curseur, r.plage.debut) + r.texte;
    curseur = r.plage.fin;
  }
  return resultat + texte.slice(curseur);
}

export function exporterTaskData(td: TaskData, changements: Changements = {}): string {
  const remplacements: Remplacement[] = [];
  for (const { point, lat, lon } of changements.points ?? []) {
    remplacements.push({ plage: point.latBrute.plage, texte: formaterComme(lat, point.latBrute) });
    remplacements.push({ plage: point.lonBrute.plage, texte: formaterComme(lon, point.lonBrute) });
  }
  for (const { apres, points } of changements.insertions ?? []) {
    // Modèle : la ligne du point précédent (ou sa seule balise, si la ligne contient autre chose),
    // sans son attribut B (start / end).
    const ligne = ligneSeule(td.texte, apres.balise);
    const modele = (
      ligne
        ? td.texte.slice(ligne.debut, ligne.fin)
        : td.texte.slice(apres.balise.debut, apres.balise.fin)
    ).replace(/\sB="[^"]*"/, '');
    const position = ligne ? ligne.fin : apres.balise.fin;
    const texte = points
      .map(({ lat, lon }) =>
        modele
          .replace(/(\sC=")[^"]*"/, `$1${formaterComme(lat, apres.latBrute)}"`)
          .replace(/(\sD=")[^"]*"/, `$1${formaterComme(lon, apres.lonBrute)}"`),
      )
      .join('');
    remplacements.push({ plage: { debut: position, fin: position }, texte });
  }
  for (const point of changements.suppressions ?? []) {
    // La ligne entière si le point est seul dessus, sinon seulement sa balise.
    remplacements.push({ plage: ligneSeule(td.texte, point.balise) ?? point.balise, texte: '' });
  }
  for (const { parcelle, m2 } of changements.surfaces ?? []) {
    if (!parcelle.surface) continue;
    remplacements.push({ plage: parcelle.surface.plage, texte: String(Math.round(m2)) });
  }
  if (changements.retirerSegments ?? true) {
    for (const plage of td.segmentsIgnores) remplacements.push({ plage, texte: '' });
  }
  const finDeLigne = td.texte.includes('\r\n') ? '\r\n' : '\n';
  for (const { parcelle, lignes } of changements.guidages ?? []) {
    if (lignes.length === 0) continue;
    if (parcelle.debutContour === null) {
      throw new Error(
        `${parcelle.nom} : pas de contour, impossible d'y écrire une ligne de guidage.`,
      );
    }
    const p = parcelle.debutContour;
    remplacements.push({ plage: { debut: p, fin: p }, texte: texteGuidages(lignes, finDeLigne) });
  }
  for (const { parcelle, apres, zones } of changements.zonesAjoutees ?? []) {
    const modele = parcelle.anneaux[0]?.points[0];
    if (!modele) throw new Error(`${parcelle.nom} : contour sans point, zone exclue impossible.`);
    remplacements.push({
      plage: { debut: apres, fin: apres },
      texte: zones.map((z) => texteZoneExclue(td.texte, modele, z, finDeLigne)).join(''),
    });
  }
  // Parcelles retirées : leur bloc et leurs tâches disparaissent, avec tout ce qu'on allait
  // modifier à l'intérieur.
  const retraits: Plage[] = [];
  for (const parcelle of changements.parcellesRetirees ?? []) {
    const { pfd, taches } = blocsDeParcelle(td.texte, parcelle.id);
    if (!pfd) throw new Error(`${parcelle.nom} : parcelle introuvable dans le fichier.`);
    retraits.push(pfd, ...taches.map((t) => t.plage));
  }
  retraits.push(...(changements.zonesRetirees ?? []));
  // Une insertion posée pile au bord d'un retrait (zone créée juste avant une zone retirée) n'est
  // pas dedans.
  const dedans = (p: Plage) =>
    retraits.some(
      (r) =>
        p.debut >= r.debut &&
        p.fin <= r.fin &&
        !(p.debut === p.fin && (p.debut === r.debut || p.debut === r.fin)),
    );
  return remplacer(td.texte, [
    ...remplacements.filter((x) => !dedans(x.plage)),
    ...retraits.map((plage) => ({ plage, texte: '' })),
  ]);
}
