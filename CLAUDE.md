# Éditeur de contours parcellaires (ISOXML)

## Objectif

Outil web utilisable sur téléphone Android, au champ, pour corriger les contours GPS de mes parcelles agricoles et produire un fichier ISOXML réimportable dans la console de mon tracteur. Je veux me passer de xarvio Field Manager pour ce travail : il fait la même chose, mais il est peu pratique sur téléphone.

Utilisateur : un agriculteur (moi), pas un développeur. Les explications doivent rester concrètes. Me tutoyer, dans la conversation comme dans l'interface de l'éditeur.

## Contraintes d'usage

- Appareil : téléphone ou tablette Android, navigateur Chrome.
- Réseau mobile disponible au champ ; le hors-ligne n'est pas exigé.
- Transfert des fichiers : clé USB branchée directement sur le téléphone (OTG). Console → clé → téléphone → clé → console. La console exporte un **dossier** (pas un zip) ; l'éditeur ouvre le `TASKDATA.XML` de ce dossier. Au retour, il faut un dossier **non zippé** nommé `TASKDATA` contenant `TASKDATA.XML` (13/10/2026 ; la console ne lit pas les zip). Un téléchargement ne peut pas créer de dossier : si Chrome le permet (API File System Access, `showDirectoryPicker`, non vérifié sur Android), l'éditeur écrit directement `TASKDATA/TASKDATA.XML` à l'endroit choisi ; sinon il télécharge `TASKDATA.XML` et je crée le dossier `TASKDATA` à la main sur la clé.
- Saisie : distances en mètres. Depuis le 13/10/2026, plus de pavé numérique dans l'éditeur (il prenait trop de place, surtout sur tablette) : la case de distance de la barre du bas ouvre le clavier numérique du téléphone ; on garde les raccourcis ±0,1 / ±0,5 / ±1 m et un bouton ± pour le signe.
- Cibles tactiles larges : une limite ou un sommet doit pouvoir se sélectionner au doigt.
- Hébergement : GitHub Pages, dépôt dans mon espace personnel **Malakit51**. HTTPS est nécessaire pour la géolocalisation.

## Données : ne jamais les publier

Les fichiers ISOXML contiennent mon adresse e-mail et la position exacte de mes parcelles. Ils ne doivent jamais être committés dans le dépôt (le dépôt GitHub Pages sera public). Prévoir un `.gitignore` pour `TASKDATA*`, `*.XML`, `*.BIN`, `*.zip`. Les tests utilisent des données anonymisées ou générées. Tout le traitement se fait dans le navigateur, aucun envoi vers un serveur, sauf la sauvegarde en ligne dans mon propre Google Drive quand je l'active (décision du 13/10/2026).

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
3. **Déplacer un point d'angle.** Toucher le sommet, puis toucher sur la carte le bord le long duquel il glisse, puis une des deux flèches posées le long de ce bord (vers l'autre extrémité : le bord raccourcit ; à l'opposé : il s'allonge), et « Appliquer » (13/10/2026 ; remplace les boutons « limite Nord / Sud… » et la convention de signe). Plus aucun signe à saisir : la distance est toujours positive, les flèches donnent le sens.
   3 bis. **Autres façons de bouger un point (demandées le 13/10/2026).** Croix de 8 flèches (N, NE, E, SE, S, SO, O, NO) posée en haut à gauche de la carte quand un sommet est sélectionné : chaque appui déplace le sommet de la distance réglée (valeur absolue ; en diagonale, la distance est mesurée le long de la diagonale), et le sommet reste sélectionné. « Au doigt » : le toucher suivant sur la carte place le sommet à cet endroit, à ajuster ensuite avec les flèches. Dans les deux cas, le sommet bouge dans toutes les parcelles qui le contiennent.
   3 ter. **Supprimer un point.** Refusé pour un sommet commun à plusieurs parcelles (chevauchement ou bande vide) et pour un contour qui tomberait sous 3 points. À l'export, la ligne du point disparaît ; si c'est le premier point, la ligne `B="start"` est gardée avec les coordonnées du point suivant, et la ligne `B="end"` suit.
   3 quater. **Appliquer plusieurs fois.** Après « Appliquer », la limite ou le point reste sélectionné avec son sens, pour répéter le même déplacement (13/10/2026). La limite est retrouvée après chaque décalage (elle peut changer d'indice quand la parcelle qui s'agrandit reçoit un sommet).
4. **Sens d'un décalage de limite.** Choisi en touchant une des deux flèches posées sur la carte de part et d'autre de la limite (13/10/2026) ; la distance tapée est prise en valeur absolue. Le sens choisi est écrit en clair (par exemple « vers 131usag (130usag s'agrandit) »).
5. **Ne pas simplifier les contours sans demande.** Un contour avec beaucoup de points a été tracé au tracteur : c'est la mesure la plus fiable. Un contour avec peu de points a souvent été tracé sur photo aérienne. Simplification (choisie le 13/10/2026, variante B) : à la demande, mode « Simplifier », sur toute la parcelle ou sur **un seul bord** (touché du premier au dernier sommet ; par défaut le chemin le plus court en mètres, bouton pour prendre l'autre partie du contour ; tout ce qui est hors du bord reste fixe). Douglas-Peucker avec une tolérance (10, 25, 50 cm ou 1 m), puis redressement : chaque côté devient la droite des moindres carrés de ses points mesurés, les coins sont recalculés à l'intersection des droites (sauf côtés presque alignés : point mesuré ramené entre les deux droites). Le premier point du fichier et les sommets communs avec un voisin ne bougent jamais. Aperçu avant validation (contour actuel en pointillés, nombre de points, écart maximal, surface), et écart avec le contour du fichier d'origine signalé s'il dépasse la tolérance (simplifications répétées). **Pas d'alignement automatique sur le cadastre ni sur la photo** : les retouches se font à la main (flèches).
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

- Mise en page (choisie le 13/10/2026, option A) : la page ne défile pas. Barre du haut (parcelle, zoom, GPS), carte (environ la moitié de l'écran), onglets Modifier / Suivi / Export / Fichier dont seul le panneau défile, barre du bas toujours visible (distance, Appliquer, Annuler). En paysage (largeur ≥ 700 px, tablette ou téléphone tourné), automatiquement : carte sur toute la hauteur à gauche, mêmes commandes dans une colonne à droite (13/10/2026).

- Vite + TypeScript, tests Vitest, sans framework d'interface. Publication par GitHub Actions sur GitHub Pages (`main`).
- Carte : Leaflet 1.9 (choisi le 13/10/2026), fonds IGN Géoplateforme en WMTS sans clé. Fond par défaut : le cadastre (`CADASTRALPARCELS.PARCELLAIRE_EXPRESS`, style `PCI vecteur`, demandé le 13/10/2026) ; aussi photo + cadastre, photo (`ORTHOIMAGERY.ORTHOPHOTOS`) et plan (`GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`). Zoom natif max 19. Toucher l'intérieur d'une parcelle la sélectionne. La précision vient de la photo IGN et du GPS du téléphone (quelques mètres), pas de la bibliothèque.
- Suivi et journal (13/10/2026) : stockés dans le navigateur du téléphone (localStorage, clé `contour-parcelle/suivi`), indépendamment du fichier ouvert. Une parcelle est repérée par son GUID (attribut `B` du `PFD`), à défaut par son nom. États : vérifié, à confirmer (par défaut), à refaire, avec date et remarque. Journal : une ligne par parcelle touchée à chaque modification (retirée si on annule) et à chaque export. Export CSV (séparateur « ; », BOM UTF-8). Effacer les données de Chrome efface le suivi : pas encore d'import CSV pour le restaurer.
- Version des exports (13/10/2026) : chaque export de `TASKDATA.XML` reçoit un numéro qui continue ma notation (« 0.11 » → 0.12, 0.13…), affiché dans l'onglet Export (modifiable) et noté au journal. Gardé dans le suivi (donc dans les sauvegardes fichier et Drive ; la fusion garde la plus récente). À faire : que ce numéro apparaisse dans le nom affiché par la console, sans renommer à la main (en attente de savoir d'où la console tire ce nom).
- Session sur l'appareil (13/10/2026) : le fichier ouvert et les contours modifiés sont enregistrés dans le navigateur (localStorage, clé `contour-parcelle/session`) après chaque modification, et repris à la réouverture de la page. « Fermer le fichier » l'efface.
- Sauvegarde dans un fichier (13/10/2026, pour la clé USB) : onglet Fichier, « Enregistrer une sauvegarde » télécharge `contour-parcelle-sauvegarde-AAAA-MM-JJ.json` (même contenu que la sauvegarde Drive) ; « Charger une sauvegarde » le reprend sur un autre appareil (même fusion du suivi). « Partager (Bluetooth, Quick Share…) » ouvre le menu de partage d'Android (Web Share API) ; Chrome ne partage pas les .json, la sauvegarde part donc en `.txt` (même contenu, relu aussi par « Charger une sauvegarde »). Bouton affiché seulement si le navigateur sait partager des fichiers.
- Sauvegarde en ligne entre appareils (13/10/2026) : Google Drive, un seul fichier `contour-parcelle-sauvegarde.json` (fichier ouvert, contours modifiés, suivi, journal, nom de l'appareil), accès restreint « drive.file ». Connexion Google Identity Services (jeton d'environ une heure). Envoi automatique quelques secondes après chaque modification quand on est connecté ; « Reprendre depuis Drive » remplace le travail de l'appareil et fusionne le suivi (fiche la plus récente, journaux additionnés). Identifiant client dans `src/sauvegarde/config.ts` ; marche à suivre pour le créer : `docs/google-drive.md`. **Identifiant pas encore créé** : la sauvegarde en ligne n'est donc pas encore active.

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
