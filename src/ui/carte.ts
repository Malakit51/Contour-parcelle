// Carte Leaflet : photo aérienne IGN ou fond blanc, parcelles, sélection, position GPS.
//
// Les touchers sont renvoyés avec une fonction qui donne la position à l'écran (en pixels) de
// n'importe quel point : c'est la page qui cherche la limite ou le sommet le plus proche.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLon } from '../geometrie/plan';

export interface AnneauDessin {
  pts: LatLon[];
  couleur: string;
  /** Parcelle mise en avant (sommets visibles, trait plus épais). */
  courant: boolean;
  nom: string | null;
}

export interface Dessin {
  anneaux: AnneauDessin[];
  /** Segments surlignés (limite sélectionnée…). */
  traits: { a: LatLon; b: LatLon; couleur: string; epaisseur: number }[];
  /** Points surlignés (sommet sélectionné). */
  points: { p: LatLon; couleur: string; rayon: number }[];
  /** Contours affichés en pointillés (état actuel pendant un aperçu). */
  fantomes?: LatLon[][];
  /** Contours d'un ancien fichier affichés en référence (gris pointillé, avec leurs points). */
  reference?: LatLon[][];
  /** Lignes de guidage (en pointillés pour l'aperçu de celle en cours). */
  guidages?: { pts: LatLon[]; apercu: boolean }[];
  /** Flèches à toucher, posées en `depuis` et pointant vers `vers` (choix du sens d'un décalage). */
  fleches?: { depuis: LatLon; vers: LatLon; choisie: boolean; action: () => void }[];
}

export type VersEcran = (p: LatLon) => { x: number; y: number };

// Géoplateforme IGN, service WMTS en projection Web Mercator (« PM »), sans clé.
const wmts = (couche: string, format: string, style = 'normal') =>
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  `&LAYER=${couche}&STYLE=${encodeURIComponent(style)}&TILEMATRIXSET=PM&FORMAT=${format}` +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
const ATTRIBUTION = '© IGN – Géoplateforme';

const ll = (p: LatLon) => L.latLng(p[0], p[1]);

export class Carte {
  readonly element: HTMLDivElement;
  private readonly carte: L.Map;
  private readonly calque = L.layerGroup();
  private readonly noms = L.layerGroup();
  private readonly gps = L.layerGroup();
  private suiviGps: number | null = null;
  /** Boutons posés sur la carte, en haut à gauche (flèches de déplacement d'un point). */
  private readonly commandes = L.DomUtil.create('div', 'commandes-carte');
  private dernierePosition: GeolocationPosition | null = null;

  constructor(
    private readonly auToucher: (
      ecran: { x: number; y: number },
      versEcran: VersEcran,
      position: LatLon,
    ) => void,
    private readonly surGps: (etat: string) => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'carte';
    this.carte = L.map(this.element, {
      zoomControl: false,
      doubleClickZoom: false,
      maxZoom: 22,
      zoomSnap: 0.25,
    });
    this.carte.attributionControl.setPrefix(false);
    const options = { maxNativeZoom: 19, maxZoom: 22, attribution: ATTRIBUTION };
    const fonds = {
      Photo: L.tileLayer(wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), options),
      // Aucune tuile : on ne voit que les contours, sur le fond blanc de la carte.
      'Fond blanc': L.layerGroup(),
    };
    fonds.Photo.addTo(this.carte);
    L.control.layers(fonds, {}, { position: 'topright' }).addTo(this.carte);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.carte);
    L.DomEvent.disableClickPropagation(this.commandes);
    L.DomEvent.disableScrollPropagation(this.commandes);
    new (L.Control.extend({ onAdd: () => this.commandes }))({ position: 'topleft' }).addTo(
      this.carte,
    );
    this.calque.addTo(this.carte);
    this.noms.addTo(this.carte);
    this.gps.addTo(this.carte);
    this.carte.setView([46.6, 2.5], 6);
    this.carte.on('click', (e: L.LeafletMouseEvent) =>
      this.auToucher(e.containerPoint, (p) => this.carte.latLngToContainerPoint(ll(p)), [
        e.latlng.lat,
        e.latlng.lng,
      ]),
    );
    // Les noms n'apparaissent qu'à partir d'un certain zoom, pour ne pas encombrer.
    this.carte.on('zoomend', () => this.majNoms());
    new ResizeObserver(() => this.carte.invalidateSize()).observe(this.element);
  }

  /** Hauteur (px) cachée en haut et en bas de la carte (barre du haut, volet posés dessus). */
  margeHaut = 0;
  margeBas = 0;

  cadrer(points: LatLon[]): void {
    if (points.length === 0) return;
    this.carte.invalidateSize();
    this.carte.fitBounds(L.latLngBounds(points.map(ll)), {
      paddingTopLeft: [20, 20 + this.margeHaut],
      paddingBottomRight: [20, 20 + this.margeBas],
      maxZoom: 19,
    });
  }

  zoomer(sens: 1 | -1): void {
    if (sens > 0) this.carte.zoomIn();
    else this.carte.zoomOut();
  }

  afficher(dessin: Dessin): void {
    this.calque.clearLayers();
    this.noms.clearLayers();
    for (const a of dessin.anneaux) {
      L.polygon(a.pts.map(ll), {
        color: a.couleur,
        weight: a.courant ? 3 : 2,
        fillOpacity: a.courant ? 0.15 : 0.05,
        interactive: false,
      }).addTo(this.calque);
      if (a.courant) {
        for (const p of a.pts) {
          L.circleMarker(ll(p), {
            radius: 4,
            color: '#fff',
            weight: 1,
            fillColor: a.couleur,
            fillOpacity: 1,
            interactive: false,
          }).addTo(this.calque);
        }
      }
      if (a.nom) {
        const n = a.pts.length;
        const centre: LatLon = [
          a.pts.reduce((s, p) => s + p[0], 0) / n,
          a.pts.reduce((s, p) => s + p[1], 0) / n,
        ];
        L.marker(ll(centre), {
          interactive: false,
          icon: L.divIcon({ className: 'nom-parcelle', html: echapper(a.nom), iconSize: [0, 0] }),
        }).addTo(this.noms);
      }
    }
    for (const r of dessin.reference ?? []) {
      L.polygon(r.map(ll), {
        color: '#555',
        weight: 2,
        dashArray: '4 6',
        fill: false,
        interactive: false,
      }).addTo(this.calque);
      for (const p of r) {
        L.circleMarker(ll(p), {
          radius: 4,
          color: '#333',
          weight: 2,
          fillColor: '#fff',
          fillOpacity: 1,
          interactive: false,
        }).addTo(this.calque);
      }
    }
    for (const f of dessin.fantomes ?? []) {
      L.polygon(f.map(ll), {
        color: '#333',
        weight: 2,
        dashArray: '6 6',
        fill: false,
        interactive: false,
      }).addTo(this.calque);
    }
    for (const t of dessin.traits) {
      L.polyline([ll(t.a), ll(t.b)], {
        color: t.couleur,
        weight: t.epaisseur,
        interactive: false,
      }).addTo(this.calque);
    }
    for (const g of dessin.guidages ?? []) {
      // Liseré blanc puis trait bleu : lisible sur la photo comme sur le fond blanc.
      for (const [couleur, epaisseur] of [
        ['#fff', 6],
        ['#2962ff', 3],
      ] as const) {
        L.polyline(g.pts.map(ll), {
          color: couleur,
          weight: epaisseur,
          dashArray: g.apercu ? '8 8' : undefined,
          interactive: false,
        }).addTo(this.calque);
      }
    }
    for (const p of dessin.points) {
      L.circleMarker(ll(p.p), {
        radius: p.rayon,
        color: '#fff',
        weight: 2,
        fillColor: p.couleur,
        fillOpacity: 1,
        interactive: false,
      }).addTo(this.calque);
    }
    for (const f of dessin.fleches ?? []) {
      // Direction de la flèche à l'écran (le plan Web Mercator conserve les angles).
      // Projection sans arrondi au pixel : `vers` n'est qu'à 1 m de `depuis`.
      const p0 = this.carte.project(ll(f.depuis), 22);
      const p1 = this.carte.project(ll(f.vers), 22);
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const dx = Math.cos(angle) * 38;
      const dy = Math.sin(angle) * 38;
      L.marker(ll(f.depuis), {
        bubblingMouseEvents: false,
        icon: L.divIcon({
          className: '',
          iconSize: [0, 0],
          html: `<div class="fleche-limite${f.choisie ? ' choisie' : ''}" style="transform: translate(-50%, -50%) translate(${dx}px, ${dy}px) rotate(${angle}rad)">➜</div>`,
        }),
      })
        .on('click', f.action)
        .addTo(this.calque);
    }
    this.majNoms();
  }

  /** Remplace les boutons posés sur la carte (rien : on les retire). */
  definirCommandes(contenu: HTMLElement | null): void {
    // Le contenu est remplacé pendant l'appui sur un de ses boutons : Leaflet remonte alors depuis
    // le bouton (détaché de la page) sans retrouver le conteneur. On protège donc aussi le contenu,
    // sinon l'appui serait pris pour un toucher sur la carte.
    if (contenu) {
      L.DomEvent.disableClickPropagation(contenu);
      L.DomEvent.disableScrollPropagation(contenu);
    }
    this.commandes.replaceChildren(...(contenu ? [contenu] : []));
    this.commandes.style.display = contenu ? '' : 'none';
  }

  private majNoms(): void {
    const visibles = this.carte.getZoom() >= 14;
    if (visibles && !this.carte.hasLayer(this.noms)) this.noms.addTo(this.carte);
    if (!visibles && this.carte.hasLayer(this.noms)) this.noms.remove();
  }

  /** Allume ou éteint le suivi de la position GPS. Au premier point reçu, la carte s'y centre. */
  basculerGps(): void {
    if (this.suiviGps !== null) {
      navigator.geolocation.clearWatch(this.suiviGps);
      this.suiviGps = null;
      this.dernierePosition = null;
      this.gps.clearLayers();
      this.surGps('');
      return;
    }
    if (!('geolocation' in navigator)) {
      this.surGps('Position GPS indisponible sur cet appareil.');
      return;
    }
    let premier = true;
    this.surGps('Recherche de la position…');
    this.suiviGps = navigator.geolocation.watchPosition(
      (pos) => {
        this.dernierePosition = pos;
        const ici = L.latLng(pos.coords.latitude, pos.coords.longitude);
        this.gps.clearLayers();
        L.circle(ici, {
          radius: pos.coords.accuracy,
          color: '#1976d2',
          weight: 1,
          fillOpacity: 0.1,
          interactive: false,
        }).addTo(this.gps);
        L.circleMarker(ici, {
          radius: 7,
          color: '#fff',
          weight: 2,
          fillColor: '#1976d2',
          fillOpacity: 1,
          interactive: false,
        }).addTo(this.gps);
        this.surGps(`Position du téléphone : précision ± ${Math.round(pos.coords.accuracy)} m`);
        if (premier) {
          premier = false;
          this.carte.setView(ici, Math.max(this.carte.getZoom(), 18));
        }
      },
      (err) =>
        this.surGps(
          err.code === err.PERMISSION_DENIED
            ? 'Position refusée : autorise la localisation pour ce site dans Chrome.'
            : `Position indisponible (${err.message}).`,
        ),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
    );
  }

  /** Recentre la carte sur la dernière position GPS reçue. */
  centrerSurGps(): void {
    const p = this.dernierePosition;
    if (p) {
      this.carte.setView(
        [p.coords.latitude, p.coords.longitude],
        Math.max(this.carte.getZoom(), 18),
      );
    }
  }

  gpsActif(): boolean {
    return this.suiviGps !== null;
  }
}

function echapper(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
