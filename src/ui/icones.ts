// Icônes à traits (SVG), dessinées avec la couleur du texte du bouton qui les contient.

const NS = 'http://www.w3.org/2000/svg';

const TRACES = {
  modifier: '<path d="M4 20l4-1L19 8l-3-3L5 16l-1 4z"/>',
  suivi: '<path d="M5 12l4 4 10-10"/>',
  export: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  fichier: '<path d="M4 6h6l2 2h8v11H4z"/>',
  annuler: '<path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-3"/>',
  gps: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  centrer: '<path d="M12 2l7 19-7-4-7 4z"/>',
  mesure: '<path d="M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"/>',
  nuage:
    '<path d="M7 18h10a4 4 0 00.5-8A6 6 0 006 9.5 4.3 4.3 0 007 18z"/><path d="M12 11v5M9.5 13.5L12 11l2.5 2.5"/>',
  lignes: '<path d="M4 20L20 4M4 14L14 4M10 20L20 10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  moins: '<path d="M5 12h14"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
} as const;

export type Icone = keyof typeof TRACES;

export function icone(nom: Icone, taille = 22): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('width', String(taille));
  s.setAttribute('height', String(taille));
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'icone');
  s.innerHTML = TRACES[nom];
  return s;
}
