// Identifiant « client OAuth » Google de l'éditeur (type « Application Web », origine autorisée
// https://malakit51.github.io). Ce n'est pas un secret : il identifie l'application auprès de
// Google, qui n'accepte les connexions que depuis l'origine autorisée.
// Créé le 13/10/2026 (marche à suivre : docs/google-drive.md). Vide : pas de sauvegarde Drive.
// (VITE_GOOGLE_CLIENT_ID permet d'en fournir un autre à la construction, pour les essais.)
const PAR_DEFAUT = '967187502421-qvkd6g47cbthb97d5l4mck1762fsk8dd.apps.googleusercontent.com';
export const GOOGLE_CLIENT_ID: string =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || PAR_DEFAUT;
