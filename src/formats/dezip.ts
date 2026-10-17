// Lecture d'une archive .zip (fichiers stockés ou compressés « deflate », le cas courant), par
// son répertoire central. La décompression passe par le navigateur (DecompressionStream).

async function inflater(octets: Uint8Array): Promise<Uint8Array> {
  const flux = new Blob([octets.slice()])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

/** Fichiers de l'archive (nom avec son chemin → contenu), dossiers exclus. */
export async function dezipper(octets: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  // Fin du répertoire central : cherchée depuis la fin (un commentaire peut suivre).
  let fin = -1;
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('ce n’est pas une archive .zip');
  const nombre = v.getUint16(fin + 10, true);
  let pos = v.getUint32(fin + 16, true);
  const fichiers = new Map<string, Uint8Array>();
  for (let k = 0; k < nombre; k++) {
    if (v.getUint32(pos, true) !== 0x02014b50) throw new Error('archive .zip abîmée');
    const methode = v.getUint16(pos + 10, true);
    const taille = v.getUint32(pos + 20, true);
    const lgNom = v.getUint16(pos + 28, true);
    const lgExtra = v.getUint16(pos + 30, true);
    const lgComm = v.getUint16(pos + 32, true);
    const local = v.getUint32(pos + 42, true);
    const nom = new TextDecoder().decode(octets.subarray(pos + 46, pos + 46 + lgNom));
    pos += 46 + lgNom + lgExtra + lgComm;
    if (nom.endsWith('/')) continue;
    const debut = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const brut = octets.subarray(debut, debut + taille);
    if (methode === 0) fichiers.set(nom, brut.slice());
    else if (methode === 8) fichiers.set(nom, await inflater(brut));
    else throw new Error(`${nom} : compression non prise en charge (méthode ${methode})`);
  }
  return fichiers;
}
