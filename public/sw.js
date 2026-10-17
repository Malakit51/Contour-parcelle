// Service worker : il permet à Chrome de proposer « Installer l'application », et il sert la
// photo aérienne enregistrée sur le téléphone (onglet Fichier, « Photo hors réseau »).
// La page elle-même n'est jamais gardée en cache : elle vient toujours d'Internet (version à jour).
const PHOTO = 'photo-ign';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.hostname !== 'data.geopf.fr' || url.searchParams.get('REQUEST') !== 'GetTile') return;
  // Tuile enregistrée : servie depuis le téléphone ; sinon, demandée à l'IGN comme d'habitude.
  e.respondWith(
    caches
      .open(PHOTO)
      .then((c) => c.match(e.request.url, { ignoreVary: true }))
      .then((r) => r || fetch(e.request))
      .catch(() => fetch(e.request)),
  );
});
