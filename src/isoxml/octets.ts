// Conversion octets <-> texte sans aucune perte : BOM éventuel conservé, UTF-8 strict.

export function decoder(octets: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(octets);
}

export function encoder(texte: string): Uint8Array {
  return new TextEncoder().encode(texte);
}
