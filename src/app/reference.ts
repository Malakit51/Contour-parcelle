// Ancien TASKDATA affiché en référence, et remplacement d’un contour.

import { etatInitial, latLon, sommetsEn } from '../edition/etat';
import { remplacerContour } from '../edition/operations';
import { planLocal, pointDansPolygone, type XY } from '../geometrie/plan';
import { lireTaskData } from '../isoxml/lecture';
import { decoder } from '../isoxml/octets';
import { el } from '../ui/dom';
import { type Session, ui } from './etat';
import { afficher } from './mise-en-page';
import { modifier } from './travail';

export async function chargerReference(f: File): Promise<void> {
  try {
    const td = lireTaskData(decoder(new Uint8Array(await f.arrayBuffer())));
    const e = etatInitial(td);
    ui.reference = {
      nom: f.name,
      anneaux: e.anneaux.map((a) => a.sommets.map(latLon)),
      parcelles: td.parcelles.flatMap((p, i) => {
        const ext = e.anneaux.find((a) => a.parcelle === i && a.type === 1);
        return ext ? [{ nom: p.nom, guid: p.guid, contour: ext.sommets.map(latLon) }] : [];
      }),
    };
    ui.message = {
      texte: `${f.name} affiché en référence.`,
      erreur: false,
    };
  } catch (e) {
    ui.message = { texte: `Lecture impossible : ${(e as Error).message}`, erreur: true };
  }
  afficher();
}

export function panneauReference(): HTMLElement {
  const choix = el(
    'label',
    { class: 'bouton-fichier secondaire' },
    ui.reference ? 'Autre référence' : 'Afficher un ancien TASKDATA',
  );
  const input = el('input', { type: 'file' });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void chargerReference(f);
  });
  choix.append(input);
  return el(
    'div',
    { class: 'info' },
    el(
      'div',
      { class: 'doux' },
      ui.reference
        ? `${ui.reference.nom} (en gris sur la carte)`
        : 'Contours affichés en gris, pour y recoller des points (☝) ou remplacer un contour.',
    ),
    el(
      'div',
      { class: 'rangee' },
      choix,
      ui.reference &&
        el(
          'button',
          {
            onclick: () => {
              ui.reference = null;
              afficher();
            },
          },
          'Retirer',
        ),
    ),
  );
}

/** Parcelle de la référence qui correspond à la parcelle `p` : même GUID, même nom, ou qui la recouvre. */
export function parcelleDeReference(s: Session, p: number) {
  if (!ui.reference) return null;
  const parcelle = s.td.parcelles[p]!;
  const parGuid = parcelle.guid && ui.reference.parcelles.find((r) => r.guid === parcelle.guid);
  if (parGuid) return parGuid;
  const parNom = ui.reference.parcelles.find((r) => r.nom === parcelle.nom);
  if (parNom) return parNom;
  const ext = s.etat.anneaux.find((a) => a.parcelle === p && a.type === 1);
  if (!ext) return null;
  const plan = planLocal(latLon(ext.sommets[0]!));
  const pts = ext.sommets.map((x) => plan.versXY(latLon(x)));
  const centre: XY = [
    pts.reduce((u, q) => u + q[0], 0) / pts.length,
    pts.reduce((u, q) => u + q[1], 0) / pts.length,
  ];
  return (
    ui.reference.parcelles.find((r) =>
      pointDansPolygone(
        centre,
        r.contour.map((q) => plan.versXY(q)),
      ),
    ) ?? null
  );
}

export function panneauRemplacement(s: Session): HTMLElement | null {
  if (!ui.reference || ui.parcelleCourante === null) return null;
  const p = ui.parcelleCourante;
  const r = parcelleDeReference(s, p);
  const nom = s.td.parcelles[p]!.nom;
  if (!r) {
    return el('div', { class: 'info doux' }, `${nom} absente de la référence.`);
  }
  const ext = s.etat.anneaux.findIndex((a) => a.parcelle === p && a.type === 1);
  return el(
    'div',
    { class: 'info' },
    el('strong', {}, 'Référence'),
    el(
      'div',
      { class: 'doux' },
      `${r.contour.length} points (actuel : ${s.etat.anneaux[ext]!.sommets.length})`,
    ),
    el(
      'div',
      { class: 'rangee' },
      el(
        'button',
        {
          onclick: () => {
            if (!confirm(`Remplacer tout le contour de ${nom} par celui de la référence ?`)) return;
            const communs = s.etat.anneaux[ext]!.sommets.some((x) =>
              sommetsEn(s.etat, latLon(x)).some((q) => q.anneau !== ext),
            );
            modifier(
              () => remplacerContour(s.etat, ext, r.contour),
              `Contour de ${nom} remplacé par celui de ${ui.reference!.nom}` +
                (communs ? ' ; vérifie la limite avec le voisin' : ''),
              false,
            );
          },
        },
        `Remplacer ${nom}`,
      ),
    ),
  );
}
