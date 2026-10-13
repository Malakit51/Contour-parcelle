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

## Utilisation

Page publiée : https://malakit51.github.io/Contour-parcelle/

1. Onglet Fichier : « Ouvrir TASKDATA.XML » (dans le dossier TASKDATA exporté par la console).
2. Choisir une parcelle dans la liste du haut, ou la toucher sur la carte.
3. Onglet Modifier : « Décaler une limite » ou « Déplacer un point », toucher la limite ou le sommet,
   régler la distance au pavé, puis « Appliquer » dans la barre du bas. Le sens du + est écrit en
   orange.
4. Onglet Suivi : état du contour (vérifié, à confirmer, à refaire), remarque, liste et journal.
5. Onglet Export : « Vérifier avant export », puis « Télécharger TASKDATA.XML », à ranger dans un
   dossier TASKDATA sur la clé.

## Commandes

| Commande        | Effet                                                   |
| --------------- | ------------------------------------------------------- |
| `npm install`   | Installe les outils (une seule fois)                    |
| `npm run dev`   | Lance la page sur http://localhost:5173                 |
| `npm test`      | Lance les tests                                         |
| `npm run check` | Mise en forme, typage et tests (ce que vérifiera la CI) |
