// Archive .zip sans compression (méthode « stockée »), suffisante pour quelques fichiers.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(octets: Uint8Array): number {
  let c = 0xffffffff;
  for (const o of octets) c = TABLE[(c ^ o) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(
  fichiers: readonly { nom: string; octets: Uint8Array }[],
  date = new Date(),
): Uint8Array {
  const enc = new TextEncoder();
  const heure = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const jour = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locaux: Uint8Array[] = [];
  const centraux: Uint8Array[] = [];
  let decalage = 0;
  for (const f of fichiers) {
    const nom = enc.encode(f.nom);
    const crc = crc32(f.octets);
    const local = new Uint8Array(30 + nom.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true); // noms en UTF-8
    l.setUint16(8, 0, true); // stocké
    l.setUint16(10, heure, true);
    l.setUint16(12, jour, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, f.octets.length, true);
    l.setUint32(22, f.octets.length, true);
    l.setUint16(26, nom.length, true);
    local.set(nom, 30);
    const central = new Uint8Array(46 + nom.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, heure, true);
    c.setUint16(14, jour, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, f.octets.length, true);
    c.setUint32(24, f.octets.length, true);
    c.setUint16(28, nom.length, true);
    c.setUint32(42, decalage, true);
    central.set(nom, 46);
    locaux.push(local, f.octets);
    centraux.push(central);
    decalage += local.length + f.octets.length;
  }
  const tailleCentral = centraux.reduce((s, c) => s + c.length, 0);
  const fin = new Uint8Array(22);
  const e = new DataView(fin.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, fichiers.length, true);
  e.setUint16(10, fichiers.length, true);
  e.setUint32(12, tailleCentral, true);
  e.setUint32(16, decalage, true);
  const parts = [...locaux, ...centraux, fin];
  const sortie = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    sortie.set(p, o);
    o += p.length;
  }
  return sortie;
}
