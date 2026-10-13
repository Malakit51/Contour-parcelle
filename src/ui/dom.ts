// Petite aide pour construire le DOM sans bibliothèque.

type Enfant = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributs: Record<string, string | (() => void) | undefined> = {},
  ...enfants: Enfant[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attributs)) {
    if (typeof v === 'function') e.addEventListener(k.replace(/^on/, ''), v);
    else if (v !== undefined) e.setAttribute(k, v);
  }
  for (const enfant of enfants) if (enfant) e.append(enfant);
  return e;
}

const NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attributs)) e.setAttribute(k, String(v));
  return e;
}
