# Éditeur de contours parcellaires

Page web, utilisable sur téléphone, pour corriger les contours de parcelles d'un export ISOXML
(`TASKDATA.XML`) de console tracteur et produire un fichier réimportable. Tout se fait dans le
navigateur : aucun fichier n'est envoyé à un serveur.

Contexte complet et règles métier : [`CLAUDE.md`](CLAUDE.md).

## Données

Les vrais exports (`TASKDATA.XML`, `.BIN`, `.zip`) ne doivent **jamais** être committés : ils
contiennent une adresse e-mail et la position exacte des parcelles. Les mettre dans
`donnees_locales/` (ignoré par git). Les tests utilisent `tests/fixtures/exemple.xml`, un fichier
fictif ; si `donnees_locales/TASKDATA.XML` existe, des tests supplémentaires tournent dessus.

## Commandes

| Commande        | Effet                                                   |
| --------------- | ------------------------------------------------------- |
| `npm install`   | Installe les outils (une seule fois)                    |
| `npm test`      | Lance les tests                                         |
| `npm run check` | Mise en forme, typage et tests (ce que vérifiera la CI) |
