// Lecture d'un TASKDATA.XML (ISO 11783-10) sans reconstruire le XML.
//
// On repère dans le texte brut la position exacte de chaque valeur utile (coordonnées des points,
// surface des parcelles) et de chaque bloc à retirer (LSG A="5"). L'export remplace ensuite
// seulement ces morceaux : tout le reste est recopié tel quel, octet pour octet.

/** Morceau du texte d'origine, de `debut` (inclus) à `fin` (exclu). */
export interface Plage {
  debut: number;
  fin: number;
}

/** Valeur d'attribut telle qu'écrite dans le fichier, avec sa position. */
export interface ValeurBrute {
  texte: string;
  plage: Plage;
}

export interface Point {
  lat: number;
  lon: number;
  latBrute: ValeurBrute;
  lonBrute: ValeurBrute;
}

/** Anneau d'une limite de parcelle. Il est fermé dans le fichier : le dernier point répète le premier. */
export interface Anneau {
  /** 1 = contour extérieur, 2 = zone exclue (poteau, mare…). */
  type: 1 | 2;
  points: Point[];
}

export interface Parcelle {
  /** Identifiant du fichier : PFD1, PFD2… */
  id: string;
  nom: string;
  /** Attribut D (surface en m²), absent dans certains fichiers. */
  surface: ValeurBrute | null;
  anneaux: Anneau[];
}

export interface TaskData {
  texte: string;
  parcelles: Parcelle[];
  /** Blocs LSG A="5" (segments à deux points), lignes entières comprises, retirés à l'export. */
  segmentsIgnores: Plage[];
}

export class ErreurLecture extends Error {
  override name = 'ErreurLecture';
}

interface Attribut {
  nom: string;
  valeur: ValeurBrute;
}

interface Balise {
  nom: string;
  fermante: boolean;
  autoFermante: boolean;
  attributs: Attribut[];
  plage: Plage;
}

const RE_BALISE =
  /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!(?:[^>])*>|<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
const RE_ATTRIBUT = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function* balises(texte: string): Generator<Balise> {
  for (const m of texte.matchAll(RE_BALISE)) {
    const nom = m[2];
    if (nom === undefined) continue; // déclaration, commentaire, CDATA
    const debutAttributs = m.index + 1 + (m[1]?.length ?? 0) + nom.length;
    const attributs: Attribut[] = [];
    for (const a of (m[3] ?? '').matchAll(RE_ATTRIBUT)) {
      const valeur = a[2] ?? a[3] ?? '';
      const debut = debutAttributs + a.index + a[0].length - 1 - valeur.length;
      attributs.push({
        nom: a[1]!,
        valeur: { texte: valeur, plage: { debut, fin: debut + valeur.length } },
      });
    }
    yield {
      nom,
      fermante: m[1] === '/',
      autoFermante: m[4] === '/',
      attributs,
      plage: { debut: m.index, fin: m.index + m[0].length },
    };
  }
}

function attribut(b: Balise, nom: string): ValeurBrute | undefined {
  return b.attributs.find((a) => a.nom === nom)?.valeur;
}

function decoderEntites(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
    switch (e) {
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'amp':
        return '&';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return String.fromCodePoint(
          e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10),
        );
    }
  });
}

/** Étend une plage aux lignes entières qu'elle occupe, si elle est seule sur ces lignes. */
function lignesEntieres(texte: string, p: Plage): Plage {
  let debut = p.debut;
  while (debut > 0 && (texte[debut - 1] === ' ' || texte[debut - 1] === '\t')) debut--;
  if (debut > 0 && texte[debut - 1] !== '\n') return p;
  let fin = p.fin;
  while (texte[fin] === ' ' || texte[fin] === '\t') fin++;
  if (texte.startsWith('\r\n', fin)) return { debut, fin: fin + 2 };
  if (texte[fin] === '\n') return { debut, fin: fin + 1 };
  if (fin === texte.length) return { debut, fin };
  return p;
}

function nombre(v: ValeurBrute, quoi: string): number {
  const n = Number(v.texte);
  if (v.texte.trim() === '' || !Number.isFinite(n)) {
    throw new ErreurLecture(`${quoi} illisible : « ${v.texte} » (position ${v.plage.debut})`);
  }
  return n;
}

export function lireTaskData(texte: string): TaskData {
  if (!/<ISO11783_TaskData\b/.test(texte)) {
    throw new ErreurLecture(
      "Ce fichier n'est pas un TASKDATA.XML (balise ISO11783_TaskData absente).",
    );
  }
  const parcelles: Parcelle[] = [];
  const segmentsIgnores: Plage[] = [];
  const pile: Balise[] = [];
  let parcelle: Parcelle | null = null;
  let anneau: Anneau | null = null;
  let debutSegment: number | null = null;

  for (const b of balises(texte)) {
    if (b.fermante) {
      const ouverte = pile.pop();
      if (ouverte?.nom !== b.nom) {
        throw new ErreurLecture(`Balise </${b.nom}> inattendue (position ${b.plage.debut}).`);
      }
      if (b.nom === 'PFD') parcelle = null;
      if (b.nom === 'LSG') {
        if (debutSegment !== null) {
          segmentsIgnores.push(lignesEntieres(texte, { debut: debutSegment, fin: b.plage.fin }));
          debutSegment = null;
        }
        anneau = null;
      }
      continue;
    }

    if (b.nom === 'PFD') {
      const id = attribut(b, 'A')?.texte ?? '';
      parcelle = {
        id,
        nom: decoderEntites(attribut(b, 'C')?.texte ?? id),
        surface: attribut(b, 'D') ?? null,
        anneaux: [],
      };
      parcelles.push(parcelle);
    } else if (b.nom === 'LSG' && parcelle) {
      const type = attribut(b, 'A')?.texte;
      const parent = pile[pile.length - 1];
      const dansLimite = parent?.nom === 'PLN' && attribut(parent, 'A')?.texte === '1';
      if (type === '5') {
        debutSegment = b.plage.debut;
        if (b.autoFermante) {
          segmentsIgnores.push(lignesEntieres(texte, b.plage));
          debutSegment = null;
        }
      } else if (dansLimite && (type === '1' || type === '2')) {
        anneau = { type: type === '1' ? 1 : 2, points: [] };
        parcelle.anneaux.push(anneau);
      }
    } else if (b.nom === 'PNT' && anneau && debutSegment === null) {
      const lat = attribut(b, 'C');
      const lon = attribut(b, 'D');
      if (!lat || !lon)
        throw new ErreurLecture(`Point sans coordonnées (position ${b.plage.debut}).`);
      anneau.points.push({
        lat: nombre(lat, 'Latitude'),
        lon: nombre(lon, 'Longitude'),
        latBrute: lat,
        lonBrute: lon,
      });
    }

    if (!b.autoFermante) pile.push(b);
  }
  if (pile.length > 0)
    throw new ErreurLecture(`Balise <${pile[pile.length - 1]!.nom}> jamais fermée.`);

  return { texte, parcelles, segmentsIgnores };
}
