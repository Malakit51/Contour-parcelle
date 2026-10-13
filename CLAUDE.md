# Éditeur de contours parcellaires (ISOXML)

## Objectif

Outil web utilisable sur téléphone Android, au champ, pour corriger les contours GPS de mes parcelles agricoles et produire un fichier ISOXML réimportable dans la console de mon tracteur. Je veux me passer de xarvio Field Manager pour ce travail : il fait la même chose, mais il est peu pratique sur téléphone.

Utilisateur : un agriculteur (moi), pas un développeur. Les explications doivent rester concrètes. Me tutoyer, dans la conversation comme dans l'interface de l'éditeur.

## Contraintes d'usage

- Appareil : téléphone ou tablette Android, navigateur Chrome.
- Réseau mobile disponible au champ ; le hors-ligne n'est pas exigé.
- Transfert des fichiers : clé USB branchée directement sur le téléphone (OTG). Console → clé → téléphone → clé → console. La console exporte un **dossier** (pas un zip) ; l'éditeur ouvre le `TASKDATA.XML` de ce dossier. Au retour, il faut un dossier **non zippé** nommé `TASKDATA` contenant `TASKDATA.XML` (13/10/2026 ; la console ne lit pas les zip). Un téléchargement ne peut pas créer de dossier : si Chrome le permet (API File System Access, `showDirectoryPicker`, non vérifié sur Android), l'éditeur écrit directement `TASKDATA/TASKDATA.XML` à l'endroit choisi ; sinon il télécharge `TASKDATA.XML` et je crée le dossier `TASKDATA` à la main sur la clé.
- Saisie : les nombres se tapent sur un pavé numérique affiché à l'écran (chiffres 0-9, virgule, +, −, effacer). Les distances se saisissent en mètres, avec des raccourcis ±0,1 / ±0,5 / ±1 m (décision du 13/10/2026). Le clavier du téléphone n'est pas pratique au champ.
- Cibles tactiles larges : une limite ou un sommet doit pouvoir se sélectionner au doigt.
- Hébergement : GitHub Pages, dépôt dans mon espace personnel **Malakit51**. HTTPS est nécessaire pour la géolocalisation.

## Données : ne jamais les publier

Les fichiers ISOXML contiennent mon adresse e-mail et la position exacte de mes parcelles. Ils ne doivent jamais être committés dans le dépôt (le dépôt GitHub Pages sera public). Prévoir un `.gitignore` pour `TASKDATA*`, `*.XML`, `*.BIN`, `*.zip`. Les tests utilisent des données anonymisées ou générées. Tout le traitement se fait dans le navigateur, aucun envoi vers un serveur.

## Format des fichiers (ce qui est établi)

Norme ISO 11783-10 (TaskData), version 3.3. Deux sources :

- **Export console tracteur (référence)** : `TaskControllerManufacturer="Claas"`, `DataTransferOrigin="2"`, et dans l'en-tête `ManagementSoftwareManufacturer="xarvio Field Manager"`. C'est un dossier contenant `TASKDATA.XML`, des `GRD000xx.BIN`, des `TLG000xx.BIN` + `.XML` et des fichiers `TASK-*.CM`. UTF-8 sans BOM, fins de ligne CRLF (y compris à la fin du fichier), aucune indentation. Vérifié le 13/10/2026 sur `TASKDATA.XML` : toutes les coordonnées `PNT` sont écrites avec 13 décimales ; celles des contours n'ont que 7 décimales significatives complétées par des zéros (`49.1234567000000`).
- **Export xarvio** : zip, même contenu de parcelles. Sert seulement de comparaison : je ne veux pas passer par xarvio, l'éditeur ne lit donc pas de zip.

Structure utile dans `TASKDATA.XML` :

- `PFD` = une parcelle. `A` identifiant (PFD1…PFD30), `B` GUID, `C` nom, `D` surface en m², `E`/`F` client et exploitation, `G`/`H` culture et variété.
- `PLN` = polygone, `A="1"` pour la limite de parcelle, `B` = nom.
- `LSG` = anneau. `A="1"` anneau extérieur, `A="2"` anneau intérieur (zone exclue : par exemple un poteau électrique dans 13 Jard).
- `PNT` = point. `C` latitude, `D` longitude. Le premier point porte `B="start"`. Les anneaux sont fermés (premier point = dernier point).

30 parcelles, toutes avec un contour fermé. Les deux exports ont des contours fermés strictement identiques. Un seul anneau intérieur (`LSG A="2"`, 13 Jard).

Constaté le 13/10/2026 sur l'export console :

- 8 limites partagées, chacune formée d'un seul segment (deux sommets communs adjacents dans les deux parcelles) : 31/33 Berl, 50/51 Etie, 21/22 Huss, 22/23 Huss, 131usag/132usag, 21/22 Scay, 30/31 Noue, 130usag/131usag.
- Un sommet presque partagé : 22 Huss / 23 Huss, à 91 cm.
- La surface `D` est inférieure d'environ 0,05 % à la surface calculée sur l'ellipsoïde (écart maximal 0,07 %). Hypothèse non vérifiée : `D` est calculé dans une projection (UTM ?) qui réduit légèrement les distances.

L'export console contient en plus, pour 130usag (2) et 140 Blanc (4), des `LSG A="5"` à 2 points. Vérifié le 13/10/2026 : ils sont enfants directs du `PFD`, placés avant le `PLN` ; il n'y a aucun élément `GGP`/`GPN` dans le fichier. Leur nom a la forme `A=B 2026.10.13_11:36_4`, leurs `PNT` portent `E="0"` et 13 décimales réellement utilisées. Ils longent les bords des parcelles. **Décision : ces segments sont ignorés.** L'éditeur ne les lit pas, ne les affiche pas et ne les recopie pas. Un export produit par l'éditeur ne contient que les parcelles (`PFD`, `PLN`, `LSG` A="1" et A="2"). Ces traces s'accumuleraient à chaque export si on les gardait, et je n'en ai pas besoin. Je repars d'une copie vierge à chaque nouvel export de la console. Ne pas interpréter leur signification : hors périmètre.

## Règles métier

1. **Limites partagées.** Deux parcelles voisines peuvent partager des sommets aux coordonnées identiques. Exemple vérifié : 130usag et 131usag partagent une limite d'environ 791 m (789 m dans le prototype, qui utilisait une conversion approchée), définie par deux sommets communs (coordonnées volontairement absentes : le dépôt est public). Tout déplacement d'un sommet partagé doit s'appliquer à toutes les parcelles qui le contiennent, sinon on crée un chevauchement ou une bande non cultivée chez le voisin. Détecter les sommets partagés avec une petite tolérance (quelques centimètres) et signaler les sommets presque partagés.
2. **Décaler une limite.** Déplacer un segment parallèlement à lui-même, d'une distance en mètres. Contrairement au prototype, recalculer les deux sommets d'extrémité à l'intersection avec les limites adjacentes, pour que celles-ci gardent leur direction. Cas d'une limite partagée dont les limites voisines ne sont pas alignées de part et d'autre du sommet commun (validé le 13/10/2026) : le nouveau sommet est placé sur la limite de la parcelle qui perd du terrain ; l'autre parcelle garde l'ancien sommet et reçoit le nouveau. Le contour extérieur ne bouge jamais.
3. **Déplacer un point d'angle.** Sélectionner un sommet, choisir la limite le long de laquelle il glisse (désignée comme « limite Nord / Sud / Est / Ouest » de la parcelle), puis la distance en mètres. Convention de signe validée : pour une limite orientée Est-Ouest, + = vers l'Est ; pour une limite orientée Nord-Sud, + = vers le Nord.
   3 bis. **Autres façons de bouger un point (demandées le 13/10/2026).** Flèches Nord / Sud / Est / Ouest : chaque appui déplace le sommet de la distance réglée (valeur absolue), et le sommet reste sélectionné. « Au doigt » : le toucher suivant sur la carte place le sommet à cet endroit, à ajuster ensuite avec les flèches. Dans les deux cas, le sommet bouge dans toutes les parcelles qui le contiennent.
   3 ter. **Supprimer un point.** Refusé pour un sommet commun à plusieurs parcelles (chevauchement ou bande vide) et pour un contour qui tomberait sous 3 points. À l'export, la ligne du point disparaît ; si c'est le premier point, la ligne `B="start"` est gardée avec les coordonnées du point suivant, et la ligne `B="end"` suit.
4. **Sens pour une limite partagée.** Le signe doit être explicite à l'écran (par exemple « + = vers 131usag »).
5. **Ne pas simplifier les contours sans demande.** Un contour avec beaucoup de points a été tracé au tracteur : c'est la mesure la plus fiable. Un contour avec peu de points a souvent été tracé sur photo aérienne. Une éventuelle simplification (redresser les petites courbes parasites) viendra plus tard, avec une tolérance faible et un contrôle de l'écart maximal.
6. **Limite de travail et tournière.** L'outil est relevé quelques mètres avant le bord en bout de champ. Les traces de travail ne servent donc pas à contrôler les limites en tournière.
7. **Surfaces.** Mes parcelles font en général entre 5 et 20 ha. Recalculer `D` (m²) après modification, et l'afficher avant/après pour chaque parcelle concernée. Décision validée : on applique à `D` la variation relative calculée par l'éditeur, plutôt que d'écrire directement la surface calculée (écart d'environ 0,05 % avec le logiciel qui a écrit `D`).

## Export : priorité absolue à la fidélité

Le fichier produit doit être identique à l'original, à l'exception des points modifiés, des surfaces recalculées et des segments à deux points, qui sont retirés (voir ci-dessus). Conserver l'ordre des éléments et des attributs, les fins de ligne CRLF, l'encodage, le nombre de décimales des points non modifiés et tous les éléments inconnus. La solution la plus sûre est probablement de modifier le texte en place plutôt que de reconstruire le XML.

Test obligatoire : importer puis exporter sans modification doit produire un fichier identique octet pour octet. Puis comparer automatiquement l'original et le fichier modifié, et lister chaque différence.

Les points modifiés sont écrits avec le même nombre de décimales que le point d'origine (validé).

Contrôles avant export : anneaux fermés, aucune auto-intersection, aucun chevauchement entre parcelles voisines, sommets partagés toujours identiques.

## Fonctions attendues

Ordre de priorité :

1. Charger l'export console, modifier une limite ou un sommet, exporter le XML.
2. Afficher toutes les parcelles, avec leur nom, et zoomer sur une parcelle.
3. Suivre l'état des contours (vérifié, à confirmer), avec la date et une remarque.

Et aussi :

- Fond de carte : photo aérienne IGN (orthophotos de la Géoplateforme) et ma position GPS en direct.
- Journal des modifications : date, parcelle, élément modifié, décalage, surface avant/après. Exportable (CSV) et conservé entre les sessions sur le téléphone.
- Annuler la dernière modification et réinitialiser.

## Choix techniques

- Mise en page (choisie le 13/10/2026, option A) : la page ne défile pas. Barre du haut (parcelle, zoom, GPS), carte (environ la moitié de l'écran), onglets Modifier / Suivi / Export / Fichier dont seul le panneau défile, barre du bas toujours visible (distance, Appliquer, Annuler).

- Vite + TypeScript, tests Vitest, sans framework d'interface. Publication par GitHub Actions sur GitHub Pages (`main`).
- Carte : Leaflet 1.9 (choisi le 13/10/2026), fonds IGN Géoplateforme en WMTS sans clé. Fond par défaut : le cadastre (`CADASTRALPARCELS.PARCELLAIRE_EXPRESS`, style `PCI vecteur`, demandé le 13/10/2026) ; aussi photo + cadastre, photo (`ORTHOIMAGERY.ORTHOPHOTOS`) et plan (`GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`). Zoom natif max 19. Toucher l'intérieur d'une parcelle la sélectionne. La précision vient de la photo IGN et du GPS du téléphone (quelques mètres), pas de la bibliothèque.
- Suivi et journal (13/10/2026) : stockés dans le navigateur du téléphone (localStorage, clé `contour-parcelle/suivi`), indépendamment du fichier ouvert. Une parcelle est repérée par son GUID (attribut `B` du `PFD`), à défaut par son nom. États : vérifié, à confirmer (par défaut), à refaire, avec date et remarque. Journal : une ligne par parcelle touchée à chaque modification (retirée si on annule) et à chaque export. Export CSV (séparateur « ; », BOM UTF-8). Effacer les données de Chrome efface le suivi : pas encore d'import CSV pour le restaurer.

## Points non validés, à ne pas considérer comme acquis

- **Contenu à réimporter dans la console Claas.** Essai réussi le 13/10/2026 : un dossier d'export où seul `TASKDATA.XML` a été remplacé par celui de l'éditeur (une parcelle modifiée) s'importe dans la console avec le nouveau contour. Confirmé le 13/10/2026 : un dossier `TASKDATA` contenant seulement `TASKDATA.XML` (sans les `.BIN`) s'importe aussi. Je préfère télécharger `TASKDATA.XML` et le ranger moi-même dans le dossier `TASKDATA` (l'écriture directe d'un dossier marche sur mon téléphone mais n'est pas pratique) : c'est le bouton principal.
- **La console recalcule-t-elle la surface ?** À vérifier.
- **Lecture et écriture sur clé USB depuis Chrome Android.** Vérifier ce qui est possible (choix d'un dossier, enregistrement direct). Solution de repli : téléchargement puis copie sur la clé avec le gestionnaire de fichiers.
- **Journaux TLG.** Un décodage expérimental a été tenté puis abandonné, faute de description officielle du format. Ne pas s'appuyer dessus.

## État des parcelles au 13/10/2026

- Contours vérifiés : 110 Tom, 21 Scay, 131usag, 140 Blanc. Ils correspondent à ma version « task data 0.11 » (notation personnelle, pas un nom de fichier).
- Toutes les autres parcelles : contour créé, exactitude à confirmer.
- Les noms ne suivent pas de convention uniforme (« 130usag » sans espace, « 12 Jard/1 »…). Ne pas les renommer.

## Façon de travailler

- Avancer par petites étapes testables, et me dire à chaque fois ce que je dois vérifier sur le téléphone.
- Écrire la géométrie dans un module séparé, couvert par des tests.
- Avant toute décision importante (bibliothèques, format de stockage, structure du dépôt), me proposer les options en quelques lignes.
- Ne jamais présenter comme vérifié ce qui ne l'est pas.
