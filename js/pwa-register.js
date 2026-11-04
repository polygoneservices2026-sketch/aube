// AUBE — Enregistrement du service worker, bannière de mise à jour, invite d'installation.
// Script classique, sans dépendance. Ne touche au DOM que pour la bannière.
(function () {
  "use strict";

  var evenementInstallation = null;
  var banniereDejaVue = false;
  var avaitControleur = false;

  // Installation (Android / Chrome) : aucune interface ici, seulement une API pour plus tard.
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    evenementInstallation = e;
  });
  window.addEventListener("appinstalled", function () {
    evenementInstallation = null;
  });
  window.AubeInstaller = {
    disponible: function () { return evenementInstallation !== null; },
    proposer: async function () {
      if (!evenementInstallation) { return false; }
      try {
        evenementInstallation.prompt();
        var choix = await evenementInstallation.userChoice;
        evenementInstallation = null;
        return !!choix && choix.outcome === "accepted";
      } catch (erreur) {
        return false;
      }
    }
  };

  function bouton(texte, fond, couleur, soulige) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = texte;
    b.style.cssText = "font:inherit;font-size:16px;min-height:44px;padding:0 14px;border:0;" +
      "border-radius:8px;cursor:pointer;background:" + fond + ";color:" + couleur + ";" +
      (soulige ? "text-decoration:underline;" : "");
    return b;
  }

  function afficherBanniere() {
    if (banniereDejaVue) { return; }
    banniereDejaVue = true;
    var barre = document.createElement("div");
    barre.setAttribute("role", "status");
    barre.style.cssText = "position:fixed;bottom:72px;left:12px;right:12px;z-index:10000;" +
      "background:#EDE9E0;color:#171717;font:16px/1.4 Manrope,system-ui,sans-serif;" +
      "padding:12px;border-radius:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;";
    var message = document.createElement("span");
    message.style.cssText = "flex:1 1 100%;";
    message.textContent = "Une nouvelle version d’Aube est disponible.";
    var actualiser = bouton("Actualiser", "#171717", "#FFFFFF", false);
    actualiser.addEventListener("click", function () { window.location.reload(); });
    var plusTard = bouton("Plus tard", "transparent", "#171717", true);
    plusTard.addEventListener("click", function () {
      if (barre.parentNode) { barre.parentNode.removeChild(barre); }
    });
    barre.appendChild(message);
    barre.appendChild(actualiser);
    barre.appendChild(plusTard);
    document.body.appendChild(barre);
  }

  if (!("serviceWorker" in navigator)) { return; }

  avaitControleur = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    // Première installation : pas de bannière. Mise à jour : on prévient.
    if (avaitControleur) { afficherBanniere(); }
    avaitControleur = true;
  });

  window.addEventListener("load", function () {
    try {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    } catch (erreur) {
      // Aucune erreur affichée à l'utilisateur.
    }
  });
})();
