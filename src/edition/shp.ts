// Export des contours des parcelles en shapefile (Lambert 93), dans un .zip : un polygone par
// parcelle (contour et zones exclues), avec nom, surface, état du contour, identifiants.

import { versLambert93, PRJ_LAMBERT93 } from '../geometrie/lambert93';
import { shapefilePolygones, type Champ } from '../formats/shapefile';
import { zip } from '../formats/zip';
import type { TaskData } from '../isoxml/lecture';
import { anneauIgnore, estSupprimee, latLon, type Etat } from './etat';
import { nouvelleSurface } from './export';

const CHAMPS: Champ[] = [
  { nom: 'NOM', type: 'C', longueur: 80 },
  { nom: 'SURF_HA', type: 'N', longueur: 12, decimales: 4 },
  { nom: 'ETAT', type: 'C', longueur: 20 },
  { nom: 'ID_PFD', type: 'C', longueur: 10 },
  { nom: 'GUID', type: 'C', longueur: 32 },
];

/**
 * Le .zip du shapefile `base` (.shp, .shx, .dbf, .prj, .cpg). `etatContour` donne l'état du
 * suivi d'une parcelle (« vérifié »…).
 */
export function shapefileParcelles(
  td: TaskData,
  etat: Etat,
  etatContour: (p: number) => string,
  base: string,
  date = new Date(),
): Uint8Array {
  const polygones = td.parcelles.flatMap((parcelle, p) => {
    if (estSupprimee(etat, p)) return [];
    const anneaux = etat.anneaux
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => a.parcelle === p && !anneauIgnore(etat, i))
      .sort((x, y) => x.a.type - y.a.type)
      .map(({ a }) => a.sommets.map((s) => versLambert93(latLon(s))));
    if (anneaux.length === 0) return [];
    const m2 = nouvelleSurface(td, etat, p) ?? 0;
    return [
      {
        anneaux,
        valeurs: [parcelle.nom, m2 / 10000, etatContour(p), parcelle.id, parcelle.guid],
      },
    ];
  });
  const f = shapefilePolygones(polygones, CHAMPS, PRJ_LAMBERT93, date);
  return zip(
    [
      { nom: `${base}.shp`, octets: f.shp },
      { nom: `${base}.shx`, octets: f.shx },
      { nom: `${base}.dbf`, octets: f.dbf },
      { nom: `${base}.prj`, octets: f.prj },
      { nom: `${base}.cpg`, octets: f.cpg },
    ],
    date,
  );
}
