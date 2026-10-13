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

1. « Ouvrir TASKDATA.XML » : choisir le fichier exporté par la console.
2. Choisir une parcelle dans la liste pour zoomer (ou pincer, glisser, boutons + et −).
3. « Décaler une limite » : toucher la limite, taper les centimètres, « Appliquer ».
   « Déplacer un point » : toucher le sommet, choisir la limite le long de laquelle il glisse, taper
   les centimètres, « Appliquer ». Le sens du + est écrit en orange.
4. « Vérifier avant export », puis « Télécharger TASKDATA.XML ».

## Commandes

| Commande        | Effet                                                   |
| --------------- | ------------------------------------------------------- |
| `npm install`   | Installe les outils (une seule fois)                    |
| `npm run dev`   | Lance la page sur http://localhost:5173                 |
| `npm test`      | Lance les tests                                         |
| `npm run check` | Mise en forme, typage et tests (ce que vérifiera la CI) |
