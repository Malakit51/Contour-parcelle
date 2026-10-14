// Service worker minimal : il permet à Chrome de proposer « Installer l'application ».
// Il ne garde rien en cache : la page est toujours chargée depuis Internet (version à jour).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
