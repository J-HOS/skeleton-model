/*
 * Service worker - deliberately EMPTY for the Microsoft Store beta (team review 2026-11-14, web + qa).
 * It caches nothing and has no fetch handler, so every request goes to the network exactly as before:
 * no old/new file mix after a deploy (the 2026-10-15 failure), and the deploy gate's routes still see
 * every request. A caching worker (one versioned cache for code + data + integrity.json, the model by
 * hash, names prefixed "skeleton-model-") is planned as a follow-up; changing this file needs no Store
 * resubmission.
 */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
