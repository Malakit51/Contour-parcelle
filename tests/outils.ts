import { etatInitial, latLon, type Etat } from '../src/edition/etat';
import { planLocal, type XY } from '../src/geometrie/plan';
import { lireTaskData } from '../src/isoxml/lecture';

// Les parcelles de test sont décrites en mètres (x vers l'Est, y vers le Nord) autour d'un point fictif.
export const plan = planLocal([45, 2]);

export function fichier(parcelles: Record<string, XY[]>): string {
  const lignes = ['<?xml version="1.0" encoding="UTF-8"?>', '<ISO11783_TaskData VersionMajor="3">'];
  Object.entries(parcelles).forEach(([nom, pts], i) => {
    lignes.push(`<PFD A="PFD${i + 1}" C="${nom}" D="10000">`, `<PLN A="1">`, `<LSG A="1">`);
    [...pts, pts[0]!].forEach((p, j) => {
      const [lat, lon] = plan.versLatLon(p);
      const b = j === 0 ? ' B="start"' : j === pts.length ? ' B="end"' : '';
      lignes.push(`<PNT A="2"${b} C="${lat.toFixed(13)}" D="${lon.toFixed(13)}"/>`);
    });
    lignes.push('</LSG>', '</PLN>', '</PFD>');
  });
  lignes.push('</ISO11783_TaskData>', '');
  return lignes.join('\r\n');
}

export function preparer(parcelles: Record<string, XY[]>) {
  const td = lireTaskData(fichier(parcelles));
  return { td, etat: etatInitial(td) };
}

export const enMetres = (etat: Etat, anneau: number) =>
  etat.anneaux[anneau]!.sommets.map((s) =>
    plan.versXY(latLon(s)).map((v) => Math.round(v * 1000) / 1000),
  );
