// Écriture d'un shapefile de polygones (.shp, .shx, .dbf, .prj, .cpg), sans bibliothèque.
// Format ESRI : en-têtes en gros-boutiste pour les longueurs, petit-boutiste pour le reste ;
// anneau extérieur dans le sens des aiguilles d'une montre, trous dans l'autre sens, fermés.

export type Anneau = readonly (readonly [number, number])[];

export interface Champ {
  nom: string; // 10 caractères au plus
  type: 'C' | 'N';
  longueur: number;
  decimales?: number;
}

export interface Polygone {
  /** Contour extérieur puis zones exclues, en coordonnées du système choisi (x, y). */
  anneaux: readonly Anneau[];
  valeurs: readonly (string | number)[];
}

const aire = (a: Anneau) => {
  let s = 0;
  for (let k = 0; k < a.length; k++) {
    const [x1, y1] = a[k]!;
    const [x2, y2] = a[(k + 1) % a.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
};

/** Anneau fermé, dans le sens voulu (horaire pour l'extérieur, anti-horaire pour un trou). */
function oriente(a: Anneau, horaire: boolean): Anneau {
  const pts = [...a];
  if (pts.length > 1) {
    const [p, q] = [pts[0]!, pts.at(-1)!];
    if (p[0] === q[0] && p[1] === q[1]) pts.pop();
  }
  if (aire(pts) < 0 !== horaire) pts.reverse();
  return [...pts, pts[0]!];
}

function boite(points: readonly (readonly [number, number])[]): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function entete(vue: DataView, longueurMots: number, b: [number, number, number, number]): void {
  vue.setInt32(0, 9994, false);
  vue.setInt32(24, longueurMots, false);
  vue.setInt32(28, 1000, true);
  vue.setInt32(32, 5, true); // polygone
  b.forEach((v, i) => vue.setFloat64(36 + 8 * i, v, true));
}

const texte = new TextEncoder();

/** Valeur d'un champ dBase, sur `longueur` octets (UTF-8 coupé sans casser un caractère). */
function champDbf(v: string | number, c: Champ): Uint8Array {
  const sortie = new Uint8Array(c.longueur).fill(0x20);
  if (c.type === 'N') {
    const s = typeof v === 'number' ? v.toFixed(c.decimales ?? 0) : String(v);
    const o = texte.encode(s.slice(0, c.longueur));
    sortie.set(o, c.longueur - o.length); // nombres calés à droite
    return sortie;
  }
  let s = String(v);
  let o = texte.encode(s);
  while (o.length > c.longueur) {
    s = s.slice(0, -1);
    o = texte.encode(s);
  }
  sortie.set(o, 0);
  return sortie;
}

export function shapefilePolygones(
  polygones: readonly Polygone[],
  champs: readonly Champ[],
  prj: string,
  date = new Date(),
): { shp: Uint8Array; shx: Uint8Array; dbf: Uint8Array; prj: Uint8Array; cpg: Uint8Array } {
  // --- .shp et .shx
  const contenus = polygones.map((p) => {
    const anneaux = p.anneaux.map((a, i) => oriente(a, i === 0));
    const points = anneaux.flat();
    const n = points.length;
    const taille = 44 + 4 * anneaux.length + 16 * n;
    const buf = new ArrayBuffer(taille);
    const v = new DataView(buf);
    v.setInt32(0, 5, true);
    boite(points).forEach((x, i) => v.setFloat64(4 + 8 * i, x, true));
    v.setInt32(36, anneaux.length, true);
    v.setInt32(40, n, true);
    let debut = 0;
    anneaux.forEach((a, i) => {
      v.setInt32(44 + 4 * i, debut, true);
      debut += a.length;
    });
    const p0 = 44 + 4 * anneaux.length;
    points.forEach(([x, y], i) => {
      v.setFloat64(p0 + 16 * i, x, true);
      v.setFloat64(p0 + 16 * i + 8, y, true);
    });
    return { octets: new Uint8Array(buf), points };
  });
  const tous = contenus.flatMap((c) => c.points);
  const b = tous.length ? boite(tous) : ([0, 0, 0, 0] as [number, number, number, number]);
  const longueurShp = 100 + contenus.reduce((s, c) => s + 8 + c.octets.length, 0);
  const shp = new Uint8Array(longueurShp);
  const shx = new Uint8Array(100 + 8 * contenus.length);
  const vShp = new DataView(shp.buffer);
  const vShx = new DataView(shx.buffer);
  entete(vShp, longueurShp / 2, b);
  entete(vShx, shx.length / 2, b);
  let pos = 100;
  contenus.forEach((c, i) => {
    vShx.setInt32(100 + 8 * i, pos / 2, false);
    vShx.setInt32(104 + 8 * i, c.octets.length / 2, false);
    vShp.setInt32(pos, i + 1, false);
    vShp.setInt32(pos + 4, c.octets.length / 2, false);
    shp.set(c.octets, pos + 8);
    pos += 8 + c.octets.length;
  });

  // --- .dbf (dBase III)
  const longueurEnreg = 1 + champs.reduce((s, c) => s + c.longueur, 0);
  const longueurEntete = 32 + 32 * champs.length + 1;
  const dbf = new Uint8Array(longueurEntete + longueurEnreg * polygones.length + 1);
  const vDbf = new DataView(dbf.buffer);
  dbf[0] = 0x03;
  dbf[1] = date.getFullYear() - 1900;
  dbf[2] = date.getMonth() + 1;
  dbf[3] = date.getDate();
  vDbf.setUint32(4, polygones.length, true);
  vDbf.setUint16(8, longueurEntete, true);
  vDbf.setUint16(10, longueurEnreg, true);
  champs.forEach((c, i) => {
    const o = 32 + 32 * i;
    dbf.set(texte.encode(c.nom.slice(0, 10)), o);
    dbf[o + 11] = c.type.charCodeAt(0);
    dbf[o + 16] = c.longueur;
    dbf[o + 17] = c.decimales ?? 0;
  });
  dbf[longueurEntete - 1] = 0x0d;
  polygones.forEach((p, i) => {
    let o = longueurEntete + longueurEnreg * i;
    dbf[o++] = 0x20;
    champs.forEach((c, k) => {
      dbf.set(champDbf(p.valeurs[k] ?? '', c), o);
      o += c.longueur;
    });
  });
  dbf[dbf.length - 1] = 0x1a;
  return { shp, shx, dbf, prj: texte.encode(prj), cpg: texte.encode('UTF-8') };
}
