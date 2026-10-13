# Activer la sauvegarde Google Drive

À faire une seule fois, de préférence sur un ordinateur (c'est possible sur téléphone, mais les
pages de Google sont chargées). Durée : une dizaine de minutes. Gratuit.

L'éditeur demande à Google l'accès le plus restreint qui existe (« drive.file ») : il ne voit que
le fichier de sauvegarde qu'il crée lui-même (`contour-parcelle-sauvegarde.json`), rien d'autre
de ton Drive.

## 1. Créer un projet

1. Ouvre <https://console.cloud.google.com> avec ton compte Google.
2. En haut, à côté du logo, choisis le sélecteur de projet, puis **Nouveau projet**.
3. Nom : `Contour parcelle`. Crée-le, puis sélectionne-le.

## 2. Activer l'API Google Drive

1. Menu (☰) → **API et services** → **Bibliothèque**.
2. Cherche **Google Drive API**, ouvre-la, touche **Activer**.

## 3. Écran de consentement

1. Menu (☰) → **API et services** → **Écran de consentement OAuth** (ou « Google Auth
   Platform »), puis **Commencer**.
2. Nom de l'application : `Contour parcelle` ; adresse d'assistance : ton adresse.
3. Public : **Externe**.
4. Coordonnées : ton adresse. Accepte les conditions, crée.
5. Dans **Public** (ou « Audience »), laisse l'état **En test** et ajoute dans **Utilisateurs
   test** les adresses Gmail qui pourront se connecter (la tienne, et celle de ton frère si
   besoin).

## 4. Créer l'identifiant

1. **Clients** (ou « Identifiants ») → **Créer un client** (ou « Créer des identifiants » → «
   ID client OAuth »).
2. Type d'application : **Application Web**. Nom : `Contour parcelle`.
3. **Origines JavaScript autorisées** → **Ajouter un URI** : `https://malakit51.github.io`
   (exactement, sans barre à la fin ni « /Contour-parcelle »).
4. Rien dans « URI de redirection ». Crée.
5. Copie l'**ID client** : il ressemble à `123456789-abc…apps.googleusercontent.com`.

## 5. Me le donner

Envoie cet ID client dans la conversation : je l'ajoute au code (il n'est pas secret, il
n'autorise les connexions que depuis la page de l'éditeur). Après la mise en ligne, dans
l'onglet **Fichier**, la partie « Sauvegarde Google Drive » propose **Se connecter à Google**.

## À la première connexion

Si Google affiche « Accès bloqué … Erreur 403 : access_denied », le compte choisi n'est pas dans
les **Utilisateurs test** (étape 3) : ajoute-le, puis réessaie.

Google affiche « Google n'a pas validé cette application » : c'est normal pour une application
« en test » que tu as créée toi-même. Touche **Continuer**, puis autorise l'accès aux fichiers
créés par l'application.

La connexion dure environ une heure ; ensuite, un appui sur **Se connecter à Google** suffit.
