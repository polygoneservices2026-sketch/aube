// AUBE — Service worker (Déployeur)
// À CHAQUE MISE À JOUR du site, changer le numéro ci-dessous (ex. aube-1.0.1).
const VERSION = "aube-1.0.2";

// Fichiers pré-chargés à l'installation (chemins relatifs).
// Un fichier absent (police non déposée, jour pas encore publié) est simplement ignoré.
const JOURS = [];
for (let i = 1; i <= 30; i++) {
  JOURS.push("data/jours/jour-" + (i < 10 ? "0" + i : i) + ".json");
}
const PRECACHE = [
  "./",
  "index.html",
  "css/aube.css",
  "js/aube-core.js",
  "js/router.js",
  "js/ui.js",
  "js/pwa-register.js",
  "manifest.webmanifest",
  "assets/logo-aube.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/symbole.png",
  "fonts/Manrope-Variable.ttf",
  "fonts/CormorantGaramond-Regular.ttf",
  "fonts/CormorantGaramond-Italic.ttf",
  "fonts/CormorantGaramond-SemiBold.ttf",
  "data/programme.json",
  "data/semaines.json",
  "data/introduction.json",
  "data/infos.json"
].concat(JOURS);

// Adresse complète d'un chemin relatif (calculée à partir de l'emplacement de sw.js).
function adresse(chemin) {
  return new URL(chemin, self.location.href).href;
}
const INDEX = adresse("index.html");
const RACINE = new URL("./", self.location.href).pathname;
// Seuls les fichiers listés ci-dessus sont mis en cache.
const ATTENDUS = new Set(PRECACHE.map(adresse));

// Clé de cache d'une adresse : sans les paramètres (?date=…).
function cle(url) {
  return url.origin + url.pathname;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Pas de cache.addAll : un fichier manquant ne doit jamais bloquer l'installation.
    await Promise.allSettled(PRECACHE.map(async (chemin) => {
      const reponse = await fetch(adresse(chemin), { cache: "reload" });
      if (reponse && reponse.ok) {
        await cache.put(adresse(chemin), reponse);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(
      noms
        .filter((nom) => nom.startsWith("aube-") && nom !== VERSION)
        .map((nom) => caches.delete(nom))
    );
    await self.clients.claim();
  })());
});

// Navigation : cache d'abord (index.html), puis réseau ; en dernier recours, index.html du cache.
async function navigation(requete) {
  const cache = await caches.open(VERSION);
  const enCache = (await cache.match(requete, { ignoreSearch: true })) || (await cache.match(INDEX));
  if (enCache) {
    return enCache;
  }
  try {
    const reponse = await fetch(requete);
    if (reponse && reponse.ok) {
      await cache.put(INDEX, reponse.clone());
    }
    return reponse;
  } catch (erreur) {
    return (await cache.match(INDEX)) || Response.error();
  }
}

// data/*.json : cache tout de suite, rafraîchi en arrière-plan (jamais de réponse non OK en cache).
async function donnees(event, url) {
  const cache = await caches.open(VERSION);
  const adr = cle(url);
  const enCache = await cache.match(adr);
  const rafraichir = fetch(adr, { cache: "no-cache" }).then(async (reponse) => {
    if (reponse && reponse.ok && ATTENDUS.has(adr)) {
      await cache.put(adr, reponse.clone());
    }
    return reponse;
  });
  if (enCache) {
    event.waitUntil(rafraichir.catch(() => {}));
    return enCache;
  }
  try {
    return await rafraichir;
  } catch (erreur) {
    return Response.error();
  }
}

// CSS, JS, polices, images, manifeste : cache d'abord, puis réseau (et mise en cache).
async function statique(requete, url) {
  const cache = await caches.open(VERSION);
  const adr = cle(url);
  const enCache = await cache.match(adr);
  if (enCache) {
    return enCache;
  }
  try {
    const reponse = await fetch(requete);
    if (reponse && reponse.ok && ATTENDUS.has(adr)) {
      await cache.put(adr, reponse.clone());
    }
    return reponse;
  } catch (erreur) {
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const requete = event.request;
  if (requete.method !== "GET") {
    return;
  }
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (requete.mode === "navigate") {
    event.respondWith(navigation(requete));
    return;
  }
  if (!url.pathname.startsWith(RACINE)) {
    return;
  }
  const relatif = url.pathname.slice(RACINE.length);
  if (relatif.startsWith("data/") && relatif.endsWith(".json")) {
    event.respondWith(donnees(event, url));
    return;
  }
  if (ATTENDUS.has(cle(url))) {
    event.respondWith(statique(requete, url));
  }
});
