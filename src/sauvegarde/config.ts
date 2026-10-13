// Identifiant « client OAuth » Google de l'éditeur (type « Application Web », origine autorisée
// https://malakit51.github.io). Ce n'est pas un secret : il identifie l'application auprès de
// Google, qui n'accepte les connexions que depuis l'origine autorisée.
// Vide : la sauvegarde Google Drive n'est pas proposée. Marche à suivre : docs/google-drive.md.
// (VITE_GOOGLE_CLIENT_ID permet d'en fournir un autre à la construction, pour les essais.)
const PAR_DEFAUT = '';
export const GOOGLE_CLIENT_ID: string =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || PAR_DEFAUT;
