// Dessin des parcelles en SVG, avec déplacement au doigt et zoom (boutons ou pincement).
//
// Les coordonnées sont en mètres dans un plan local (x vers l'Est, y vers le Nord). Les touchers
// sont renvoyés en mètres : c'est la page qui cherche la limite ou le sommet le plus proche.

import type { XY } from '../geometrie/plan';
import { svg } from './dom';

export interface AnneauDessin {
  pts: XY[];
  couleur: string;
  /** Parcelle mise en avant (remplissage plus marqué). */
  courant: boolean;
  nom: string | null;
}

export interface Dessin {
  anneaux: AnneauDessin[];
  /** Segments surlignés (limite sélectionnée…). */
  traits: { a: XY; b: XY; couleur: string; epaisseur: number }[];
  /** Points surlignés (sommets). */
  points: { p: XY; couleur: string; rayon: number }[];
}

export class Carte {
  readonly element: SVGSVGElement;
  private centre: XY = [0, 0];
  private largeur = 1000; // mètres visibles en largeur
  private dessin: Dessin = { anneaux: [], traits: [], points: [] };
  private pointeurs = new Map<number, { x: number; y: number }>();
  private glisse = false;
  private depart: { x: number; y: number } | null = null;
  private ecartPincement = 0;

  constructor(private readonly auToucher: (p: XY, pixelsParMetre: number) => void) {
    this.element = svg('svg', { class: 'carte' });
    this.element.addEventListener('pointerdown', (e) => this.appui(e));
    this.element.addEventListener('pointermove', (e) => this.mouvement(e));
    this.element.addEventListener('pointerup', (e) => this.relache(e));
    this.element.addEventListener('pointercancel', (e) => this.pointeurs.delete(e.pointerId));
    new ResizeObserver(() => this.redessiner()).observe(this.element);
  }

  /** Pixels par mètre à l'écran. */
  echelle(): number {
    return (this.element.clientWidth || 1) / this.largeur;
  }

  cadrer(min: XY, max: XY): void {
    const marge = 1.15;
    const ratio = (this.element.clientHeight || 1) / (this.element.clientWidth || 1);
    this.centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    this.largeur = Math.max(20, (max[0] - min[0]) * marge, ((max[1] - min[1]) * marge) / ratio);
    this.redessiner();
  }

  zoomer(facteur: number): void {
    this.largeur = Math.max(2, this.largeur / facteur);
    this.redessiner();
  }

  afficher(dessin: Dessin): void {
    this.dessin = dessin;
    this.redessiner();
  }

  private versEcran(e: { clientX: number; clientY: number }): XY {
    const r = this.element.getBoundingClientRect();
    const k = this.echelle();
    return [
      this.centre[0] + (e.clientX - r.left - r.width / 2) / k,
      this.centre[1] - (e.clientY - r.top - r.height / 2) / k,
    ];
  }

  private appui(e: PointerEvent): void {
    this.pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointeurs.size === 1) {
      this.glisse = false;
      this.depart = { x: e.clientX, y: e.clientY };
    } else if (this.pointeurs.size === 2) {
      this.glisse = true;
      this.ecartPincement = this.ecart();
    }
  }

  private ecart(): number {
    const [a, b] = [...this.pointeurs.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private mouvement(e: PointerEvent): void {
    const avant = this.pointeurs.get(e.pointerId);
    if (!avant) return;
    const k = this.echelle();
    if (this.pointeurs.size === 1) {
      if (
        !this.glisse &&
        this.depart &&
        Math.hypot(e.clientX - this.depart.x, e.clientY - this.depart.y) > 10
      ) {
        this.glisse = true;
        this.element.setPointerCapture(e.pointerId);
      }
      if (this.glisse) {
        this.centre = [
          this.centre[0] - (e.clientX - avant.x) / k,
          this.centre[1] + (e.clientY - avant.y) / k,
        ];
      }
    }
    this.pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointeurs.size === 2) {
      const ecart = this.ecart();
      if (this.ecartPincement > 0 && ecart > 0) this.largeur /= ecart / this.ecartPincement;
      this.ecartPincement = ecart;
    }
    if (this.glisse) this.redessiner();
  }

  private relache(e: PointerEvent): void {
    const etaitSeul = this.pointeurs.size === 1;
    this.pointeurs.delete(e.pointerId);
    if (etaitSeul && !this.glisse) this.auToucher(this.versEcran(e), this.echelle());
  }

  private redessiner(): void {
    const s = this.element;
    const k = this.echelle();
    const hauteur = (s.clientHeight || 1) / k;
    s.setAttribute(
      'viewBox',
      `${this.centre[0] - this.largeur / 2} ${-this.centre[1] - hauteur / 2} ${this.largeur} ${hauteur}`,
    );
    s.replaceChildren();
    const chemin = (pts: XY[]) => pts.map((p) => `${p[0]},${-p[1]}`).join(' ');
    for (const a of this.dessin.anneaux) {
      s.append(
        svg('polygon', {
          points: chemin(a.pts),
          fill: a.couleur,
          'fill-opacity': a.courant ? 0.25 : 0.1,
          stroke: a.couleur,
          'stroke-width': a.courant ? 2.5 : 1.5,
          'vector-effect': 'non-scaling-stroke',
          'stroke-linejoin': 'round',
        }),
      );
      if (a.courant) {
        for (const p of a.pts) {
          s.append(svg('circle', { cx: p[0], cy: -p[1], r: 3.5 / k, fill: a.couleur }));
        }
      }
    }
    for (const t of this.dessin.traits) {
      s.append(
        svg('line', {
          x1: t.a[0],
          y1: -t.a[1],
          x2: t.b[0],
          y2: -t.b[1],
          stroke: t.couleur,
          'stroke-width': t.epaisseur,
          'stroke-linecap': 'round',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }
    for (const p of this.dessin.points) {
      s.append(svg('circle', { cx: p.p[0], cy: -p.p[1], r: p.rayon / k, fill: p.couleur }));
    }
    // Noms au centre des parcelles assez grandes à l'écran.
    for (const a of this.dessin.anneaux) {
      if (!a.nom) continue;
      const xs = a.pts.map((p) => p[0]);
      const ys = a.pts.map((p) => p[1]);
      if ((Math.max(...xs) - Math.min(...xs)) * k < 50) continue;
      const t = svg('text', {
        x: xs.reduce((u, v) => u + v, 0) / xs.length,
        y: -ys.reduce((u, v) => u + v, 0) / ys.length,
        'font-size': 13 / k,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        fill: 'currentColor',
        'paint-order': 'stroke',
        stroke: 'var(--carte)',
        'stroke-width': 3 / k,
        'pointer-events': 'none',
      });
      t.textContent = a.nom;
      s.append(t);
    }
  }
}
