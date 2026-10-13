// Liste ligne par ligne les différences entre deux versions d'un fichier.

export interface Difference {
  /** Numéro de ligne dans l'original (à partir de 1), ou null pour une ligne ajoutée. */
  ligneAvant: number | null;
  /** Numéro de ligne dans le nouveau fichier (à partir de 1), ou null pour une ligne retirée. */
  ligneApres: number | null;
  avant: string | null;
  apres: string | null;
}

function lignes(texte: string): string[] {
  return texte.split(/(?<=\n)/);
}

/**
 * Différences ligne par ligne (plus longue sous-suite commune). Une ligne modifiée apparaît comme
 * une seule différence avec `avant` et `apres` quand une ligne retirée est suivie d'une ligne ajoutée.
 * Les fins de ligne font partie des lignes comparées : un CRLF devenu LF est une différence.
 */
export function comparer(original: string, nouveau: string): Difference[] {
  const a = lignes(original);
  const b = lignes(nouveau);
  let debut = 0;
  while (debut < a.length && debut < b.length && a[debut] === b[debut]) debut++;
  let finA = a.length;
  let finB = b.length;
  while (finA > debut && finB > debut && a[finA - 1] === b[finB - 1]) {
    finA--;
    finB--;
  }
  const n = finA - debut;
  const m = finB - debut;
  // lcs[i][j] = longueur de la plus longue sous-suite commune de a[debut+i..finA) et b[debut+j..finB)
  const lcs = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[at(i, j)] =
        a[debut + i] === b[debut + j]
          ? lcs[at(i + 1, j + 1)]! + 1
          : Math.max(lcs[at(i + 1, j)]!, lcs[at(i, j + 1)]!);
    }
  }
  const diffs: Difference[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[debut + i] === b[debut + j]) {
      i++;
      j++;
    } else if (i < n && j < m && lcs[at(i + 1, j + 1)] === lcs[at(i, j)]) {
      diffs.push({
        ligneAvant: debut + i + 1,
        ligneApres: debut + j + 1,
        avant: a[debut + i]!,
        apres: b[debut + j]!,
      });
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[at(i + 1, j)]! >= lcs[at(i, j + 1)]!)) {
      diffs.push({
        ligneAvant: debut + i + 1,
        ligneApres: null,
        avant: a[debut + i]!,
        apres: null,
      });
      i++;
    } else {
      diffs.push({
        ligneAvant: null,
        ligneApres: debut + j + 1,
        avant: null,
        apres: b[debut + j]!,
      });
      j++;
    }
  }
  return diffs;
}
