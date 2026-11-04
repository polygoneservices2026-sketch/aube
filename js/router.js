/* AUBE — routeur par hash (router.js)
   Routes : #/accueil · #/parcours · #/jour/N[/lire|agir|journal] · #/introduction · #/espace · #/infos
   Aucun pushState : l'hébergeur n'a pas de règles de réécriture. */
(function () {
  "use strict";

  const TITRES = {
    accueil: "Accueil",
    parcours: "Parcours",
    introduction: "Introduction",
    espace: "Mon espace",
    infos: "Infos"
  };

  let gestionnaire = null;
  let ignorer = 0;            // nombre de hashchange provoqués par nos propres corrections
  let origine = "#/parcours"; // dernier écran « hors jour », cible du bouton retour

  // Analyse un hash et renvoie une route normalisée.
  // `corrige` vaut true quand le hash est inconnu (on revient alors à l'accueil).
  function analyser(hash) {
    const h = String(hash || "").replace(/^#\/?/, "").replace(/\/+$/, "");
    if (h === "" || h === "accueil") return { nom: "accueil", hash: "#/accueil", corrige: h === "" };
    if (h === "parcours") return { nom: "parcours", hash: "#/parcours" };
    if (h === "introduction") return { nom: "introduction", hash: "#/introduction" };
    if (h === "espace") return { nom: "espace", hash: "#/espace" };
    if (h === "infos") return { nom: "infos", hash: "#/infos" };
    const m = /^jour\/(\d{1,2})(?:\/(lire|agir|journal))?$/.exec(h);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 30) {
        const onglet = m[2] || "lire";
        return { nom: "jour", jour: n, onglet: onglet, hash: "#/jour/" + n + "/" + onglet };
      }
    }
    return { nom: "accueil", hash: "#/accueil", corrige: true };
  }

  function titreDe(route) {
    if (route.nom === "jour") return "Jour " + route.jour + " · Aube";
    return (TITRES[route.nom] || "Accueil") + " · Aube";
  }

  // Traite la route courante : titre, rendu, retour en haut de page, focus.
  async function traiter() {
    const route = analyser(window.location.hash);
    if (route.corrige && window.location.hash !== route.hash) {
      // Hash inconnu ou vide : on le remplace (sans empiler l'historique) et on affiche l'accueil tout de suite.
      ignorer++;
      window.location.replace(route.hash);
    }
    if (route.nom !== "jour") origine = route.hash;
    document.title = titreDe(route);
    if (gestionnaire) {
      try {
        await gestionnaire(route);
      } catch (e) {
        if (window.console) console.error(e);
      }
    }
    window.scrollTo(0, 0);
    const contenu = document.getElementById("contenu");
    if (contenu) contenu.focus({ preventScroll: true });
  }

  window.Routeur = {
    analyser: analyser,
    // Démarre l'écoute ; `fn(route)` est appelée (et attendue) à chaque changement d'écran.
    demarrer: function (fn) {
      gestionnaire = fn;
      window.addEventListener("hashchange", function () {
        if (ignorer > 0) { ignorer--; return; }
        traiter();
      });
      return traiter();
    },
    aller: function (hash) { window.location.hash = hash; },
    remplacer: function (hash) { window.location.replace(hash); },
    recharger: function () { return traiter(); },
    origine: function () { return origine; }
  };
})();
