/* AUBE — interface (ui.js)
   Tout passe par window.Aube : ce fichier ne touche ni au stockage ni au réseau.
   Les textes issus des données sont toujours posés avec textContent (jamais innerHTML). */
(function () {
  "use strict";

  const NBSP = " ";
  const NS_SVG = "http://www.w3.org/2000/svg";
  const JOURS_SEMAINE = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const MSG_ERREUR = "Une erreur est survenue. Veuillez réessayer.";
  const MSG_INDISPO = "Ce contenu n’est pas encore disponible.";

  const contenu = document.getElementById("contenu");
  const bandeau = document.getElementById("bandeau");
  const btnRetour = document.getElementById("btn-retour");

  let jeton = 0;                 // identifie le rendu en cours (évite les rendus périmés)
  const cache = {};              // contenus du livret déjà chargés (jamais les données de l'utilisateur)
  const enAttente = [];          // sauvegardes automatiques à terminer avant de quitter un écran

  /* ========== Outils DOM ========== */

  // Crée un élément. Les chaînes passées en enfants deviennent des nœuds texte (jamais du HTML).
  function el(balise, props, ...enfants) {
    const n = document.createElement(balise);
    if (props) {
      Object.keys(props).forEach(function (k) {
        const v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") n.className = v;
        else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? "" : String(v));
      });
    }
    enfants.flat().forEach(function (e) { if (e !== null && e !== undefined && e !== false) n.append(e); });
    return n;
  }

  // Mini-analyseur de balisage (contrat 4.1) : **gras**, *italique*, ^exposant^
  function balisage(parent, texte) {
    const t = String(texte === null || texte === undefined ? "" : texte);
    const re = /\*\*(.+?)\*\*|\*(.+?)\*|\^(.+?)\^/g;
    let dernier = 0;
    let m;
    while ((m = re.exec(t))) {
      if (m.index > dernier) parent.append(t.slice(dernier, m.index));
      let n;
      if (m[1] !== undefined) { n = document.createElement("strong"); balisage(n, m[1]); }
      else if (m[2] !== undefined) { n = document.createElement("em"); balisage(n, m[2]); }
      else { n = document.createElement("sup"); n.textContent = m[3]; }
      parent.append(n);
      dernier = re.lastIndex;
    }
    if (dernier < t.length) parent.append(t.slice(dernier));
    return parent;
  }
  function paragraphe(texte, classe) { return balisage(el("p", { class: classe || "paragraphe" }), texte); }
  function etiquette(texte, balise) { return el(balise || "p", { class: "etiquette" }, texte); }

  // Icônes SVG inline (traits fins), textes fixes sans donnée externe
  const ICONES = {
    cadenas: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    coche: '<path d="M4 12.5l5 5L20 6.5"/>',
    cercle: '<circle cx="12" cy="12" r="8"/>',
    point: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    telephone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>'
  };
  function icone(nom, classe, libelle) {
    const s = document.createElementNS(NS_SVG, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.6");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("class", "icone" + (classe ? " " + classe : ""));
    if (libelle) { s.setAttribute("role", "img"); s.setAttribute("aria-label", libelle); }
    else s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONES[nom];
    return s;
  }

  /* ========== Dates et heures en français ========== */

  function partiesDate(iso) {
    const p = String(iso).split("-").map(Number);
    return { a: p[0], m: p[1], j: p[2], js: new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() };
  }
  function jourMois(p) { return (p.j === 1 ? "1er" : String(p.j)) + NBSP + MOIS[p.m - 1]; }
  // « lundi 30 novembre » (avec l'année si demandé)
  function dateLongue(iso, avecAnnee) {
    const p = partiesDate(iso);
    return JOURS_SEMAINE[p.js] + " " + jourMois(p) + (avecAnnee ? " " + p.a : "");
  }
  // « 23 – 29 novembre » ou « 30 novembre – 6 décembre »
  function plageDates(d1, d2) {
    const a = partiesDate(d1);
    const b = partiesDate(d2);
    const tiret = NBSP + "–" + NBSP;
    if (a.m === b.m) return (a.j === 1 ? "1er" : a.j) + tiret + jourMois(b);
    return jourMois(a) + tiret + jourMois(b);
  }
  // « 23 h », « 0 h 30 »
  function heureFr(hhmm) {
    const p = String(hhmm).split(":").map(Number);
    return p[0] + NBSP + "h" + (p[1] ? NBSP + (p[1] < 10 ? "0" : "") + p[1] : "");
  }
  function plageHeures(debut, fin) { return heureFr(debut) + NBSP + "–" + NBSP + heureFr(fin); }
  function dansDuree(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return "Dans " + m + NBSP + "min";
    return "Dans " + h + NBSP + "h" + (m ? NBSP + (m < 10 ? "0" : "") + m : "");
  }
  function pluriel(n, mot) { return n + " " + mot + (n > 1 ? "s" : ""); }
  function dateIsoVersFr(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return jourMois({ j: d.getDate(), m: d.getMonth() + 1 }) + " " + d.getFullYear();
  }

  /* ========== Accès aux données du livret (avec cache mémoire) ========== */

  async function charger(cle, fn) {
    if (!cache[cle]) cache[cle] = await fn();   // un échec n'est jamais mis en cache
    return cache[cle];
  }
  const programmeData = function () { return charger("programme", function () { return Aube.donnees.programme(); }); };
  const semainesData = function () { return charger("semaines", function () { return Aube.donnees.semaines(); }); };
  const jourData = function (n) { return charger("jour" + n, function () { return Aube.donnees.jour(n); }); };
  function estIntrouvable(e) { return !!e && e.code === "INTROUVABLE"; }

  function titreDansSemaines(semaines, n) {
    for (let i = 0; i < semaines.length; i++) {
      const j = (semaines[i].jours || []).filter(function (x) { return x.jour === n; })[0];
      if (j) return j.titre;
    }
    return "";
  }
  function semaineDuJour(semaines, n) {
    return semaines.filter(function (s) { return n >= s.jour_debut && n <= s.jour_fin; })[0] || null;
  }
  // Tableau de 30 booléens : l'action de chaque jour est-elle cochée ?
  function actionsFaites() {
    const l = [];
    for (let n = 1; n <= 30; n++) l.push(Aube.progression.actionFaite(n).catch(function () { return false; }));
    return Promise.all(l);
  }

  /* ========== Composants communs ========== */

  function blocErreur(retour) {
    return el("div", { class: "message", role: "alert" },
      el("p", null, MSG_ERREUR),
      retour ? el("a", { class: "btn btn-contour", href: "#/accueil", style: "margin-top:12px" }, "Retour à l’accueil") : null);
  }

  function boutonRetourParcours() {
    return el("a", { class: "btn btn-contour", href: "#/parcours" }, "Retour au parcours");
  }

  // En-tête façon livret : lignes d'étiquettes, très gros numéro, filet vertical, titre
  function enteteJour(o) {
    return el("div", { class: "entete-jour" },
      o.lignes && o.lignes.length ? el("div", { class: "entete-lignes" }, o.lignes.map(function (l) { return el("p", { class: "etiquette" }, l); })) : null,
      el("div", { class: "entete-corps" },
        el("div", { class: "entete-numero", "aria-hidden": "true" }, String(o.numero)),
        el("div", { class: "entete-texte" },
          etiquette(o.etiquette),
          el("h1", { class: "entete-titre" }, o.titre || ""))));
  }

  // Barre de 30 segments : noir = fait, or = aujourd'hui, contour = à venir (beige = passé non fait)
  function blocSegments(actions, termines) {
    const g = el("div", { class: "segments", role: "img", "aria-label": pluriel(termines, "jour") + " sur 30" });
    for (let n = 1; n <= 30; n++) {
      const st = Aube.temps.statutJour(n);
      const fait = !!actions[n - 1];
      let c = "segment";
      if (fait) c += " seg-fait";
      if (st === "aujourdhui") c += " seg-courant";
      else if (st === "passe" && !fait) c += " seg-manque";
      g.append(el("span", { class: c }));
    }
    return g;
  }
  function blocProgression(actions, resume) {
    return el("div", { class: "progression" },
      blocSegments(actions, resume.termines),
      el("p", { class: "progression-txt" },
        el("strong", null, pluriel(resume.termines, "jour") + " sur 30"),
        resume.serie >= 2 ? "  ·  Série" + NBSP + ": " + resume.serie + " jours de suite" : null));
  }

  // Un passage biblique : référence dorée + texte avec filet vertical
  // (si le livret n'imprime que la référence, texte vaut null : on n'affiche que la référence)
  function passage(item) {
    if (item.texte === null || item.texte === undefined || item.texte === "") {
      return el("div", { class: "passage passage-ref" }, etiquette(item.reference));
    }
    return el("div", { class: "passage" },
      etiquette(item.reference),
      paragraphe(item.texte, "passage-texte"));
  }

  // Rendu des blocs du contrat 4.3 (jour, introduction, figure)
  function rendreBlocs(parent, blocs) {
    (blocs || []).forEach(function (b) {
      if (!b) return;
      if (b.type === "textes") {
        parent.append(etiquette("Textes"));
        (b.items || []).forEach(function (it) { parent.append(passage(it)); });
      } else if (b.type === "citation") {
        parent.append(el("blockquote", { class: "citation" },
          el("span", { class: "guillemet", "aria-hidden": "true" }, "“"),
          paragraphe(b.texte, "")));
      } else if (b.type === "paragraphe") {
        // Intertitre : ligne courte entièrement en majuscules (le livret n'a pas de type dédié)
        const t = String(b.texte || "");
        const intertitre = t.length > 0 && t.length <= 90 && /[A-ZÀ-Ý]/.test(t) && !/[a-zà-ÿ]/.test(t.replace(/\^\d+\^/g, ""));
        parent.append(intertitre ? paragraphe(b.texte, "intertitre") : paragraphe(b.texte));
      } else if (b.type === "liste") {
        if (b.titre) parent.append(etiquette(b.titre));
        const liste = el("ul", { class: "liste " + (b.ordonnee ? "liste-ord" : "liste-puces") });
        if (b.ordonnee) liste.setAttribute("role", "list");
        (b.items || []).forEach(function (t) { liste.append(balisage(el("li"), t)); });
        parent.append(liste);
      } else if (b.type === "figure") {
        const f = el("section", { class: "figure" },
          etiquette("Figure biblique"),
          el("h2", { class: "figure-titre" }, b.titre || ""),
          b.sous_titre ? paragraphe(b.sous_titre, "figure-sous-titre") : null);
        const corps = el("div", { class: "figure-corps" });
        rendreBlocs(corps, b.blocs);
        f.append(corps);
        parent.append(f);
      }
    });
  }

  // Zone de texte à sauvegarde automatique (600 ms après la frappe, et à la perte de focus)
  function zoneAuto(o) {
    const zone = el("textarea", { id: o.id, class: "zone " + (o.classe || ""), rows: o.lignes || 6, spellcheck: "true" });
    zone.value = o.valeur || "";
    const statut = el("p", { class: "statut", "aria-live": "polite" });
    let minuteur = null;
    let sale = false;

    async function enregistrer() {
      clearTimeout(minuteur);
      minuteur = null;
      if (!sale) return;
      sale = false;
      try {
        await o.ecrire(zone.value);
        if (!sale) statut.textContent = "Enregistré";
      } catch (e) {
        sale = true;
        statut.textContent = "L’enregistrement a échoué.";
      }
    }
    zone.addEventListener("input", function () {
      sale = true;
      statut.textContent = "Enregistrement…";
      clearTimeout(minuteur);
      minuteur = setTimeout(enregistrer, 600);
    });
    zone.addEventListener("blur", enregistrer);
    enAttente.push(enregistrer);

    return el("div", { class: "zone-auto" },
      el("label", { class: "etiquette", for: o.id }, o.etiquette),
      zone,
      statut);
  }
  // Termine les sauvegardes en cours avant de changer d'écran
  function viderEnAttente() {
    const l = enAttente.splice(0);
    return Promise.all(l.map(function (f) { return f(); }));
  }

  // Case à cocher native, stylée
  function caseACocher(o) {
    const input = el("input", { type: "checkbox", id: o.id });
    input.checked = !!o.cochee;
    if (o.onchange) input.addEventListener("change", function () { o.onchange(input); });
    return el("label", { class: "case" + (o.compacte ? " case-compacte" : ""), for: o.id },
      input,
      el("span", { class: "case-boite" }, icone("coche")),
      el("span", { class: "case-libelle" }, o.libelle, o.detail ? el("small", null, o.detail) : null));
  }

  /* ========== Cadre : navigation, taille du texte ========== */

  function mettreAJourCadre(route) {
    const cible = { accueil: "accueil", parcours: "parcours", jour: "parcours", introduction: "parcours", espace: "espace", infos: "infos" }[route.nom];
    document.querySelectorAll(".nav-item").forEach(function (a) {
      if (a.getAttribute("data-nav") === cible) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    btnRetour.hidden = route.nom !== "jour";
  }

  function appliquerTaille(taille) {
    const classes = { normale: "taille-normale", grande: "taille-grande", tres_grande: "taille-tres-grande" };
    const h = document.documentElement;
    Object.keys(classes).forEach(function (k) { h.classList.remove(classes[k]); });
    h.classList.add(classes[taille] || classes.normale);
  }

  /* ========== Écran : Accueil ========== */

  async function ecranAccueil(racine) {
    const prog = await programmeData();
    const jc = Aube.temps.jourCourant();

    if (jc.phase === "avant") {
      const n = Aube.temps.joursAvantDebut();
      racine.append(
        el("h1", { class: "titre-programme" }, prog.titre),
        el("p", { class: "sous-titre" }, prog.sous_titre),
        el("div", { class: "compte" },
          etiquette("Début dans"),
          el("p", { class: "compte-nombre" }, pluriel(n, "jour")),
          el("p", { class: "compte-date" }, dateLongue(prog.date_debut, true))),
        el("a", { class: "btn", href: "#/introduction" }, "Lire l’introduction"),
        el("p", { style: "margin-top:12px;text-align:center" }, el("a", { class: "lien", href: "#/parcours" }, "Voir le parcours")));
      return;
    }

    if (jc.phase === "apres") {
      racine.append(
        el("h1", { class: "titre-programme" }, "Les 30 jours sont terminés."),
        el("div", { class: "btn-groupe" },
          el("a", { class: "btn", href: "#/parcours" }, "Revoir le parcours"),
          el("a", { class: "btn btn-contour", href: "#/espace" }, "Mon espace")));
      return;
    }

    // Phase « en_cours »
    const n = jc.numero;
    let titre = "";
    try { titre = (await jourData(n)).titre; }
    catch (e) {
      try { titre = titreDansSemaines(await semainesData(), n); } catch (e2) { titre = ""; }
    }
    racine.append(
      enteteJour({
        numero: n,
        lignes: [dateLongue(Aube.temps.dateDuJour(n))],
        etiquette: "Jour " + n + " sur 30",
        titre: titre
      }),
      el("a", { class: "btn", href: "#/jour/" + n }, "Ouvrir le jour"));

    // Progression
    try {
      const resultats = await Promise.all([actionsFaites(), Aube.progression.resume()]);
      const bloc = el("section", { class: "bloc-accueil" }, blocProgression(resultats[0], resultats[1]));
      if (resultats[1].retards.length > 0) {
        bloc.append(el("p", { class: "rattrapage" },
          "Il vous reste " + pluriel(resultats[1].retards.length, "jour") + " à rattraper",
          el("a", { class: "lien", href: "#/parcours" }, "Voir")));
      }
      racine.append(bloc);
    } catch (e) { /* la progression est secondaire : on continue sans elle */ }

    // Prochain temps fort
    try {
      const t = Aube.temps.prochainTempsFort();
      racine.append(el("section", { class: "bloc-accueil temps-fort" },
        etiquette(t.en_cours ? "Temps fort" : "Prochain temps fort"),
        el("p", { class: "temps-fort-nom" }, t.nom),
        el("p", { class: "temps-fort-horaire" }, plageHeures(t.debut, t.fin)),
        el("p", { class: "temps-fort-etat" }, t.en_cours ? "En cours maintenant" : dansDuree(t.dans_minutes))));
    } catch (e) { /* idem */ }

    // Phrase de guerre
    if (prog.phrase_de_guerre) {
      racine.append(el("section", { class: "bloc-accueil carte-beige" },
        etiquette("Phrase de guerre · " + heureFr(prog.phrase_de_guerre.heure)),
        paragraphe(prog.phrase_de_guerre.texte, "phrase")));
    }
  }

  /* ========== Écran : Parcours ========== */

  function iconeEtat(statut, fait) {
    if (statut === "verrouille") return icone("cadenas", "icone-grise", "Jour verrouillé");
    if (statut === "aujourdhui") return icone("point", "icone-point", "Aujourd’hui");
    return fait ? icone("coche", "", "Action faite") : icone("cercle", "", "Action non faite");
  }

  async function ecranParcours(racine) {
    const semaines = await semainesData();
    const actions = await actionsFaites();
    const jc = Aube.temps.jourCourant();
    racine.append(
      el("h1", { class: "sr-only" }, "Parcours"),
      el("p", { class: "parcours-intro" }, el("a", { class: "lien", href: "#/introduction" }, "Introduction du programme")));

    let ouverte = 0;
    if (jc.phase === "en_cours") {
      const idx = semaines.findIndex(function (s) { return jc.numero >= s.jour_debut && jc.numero <= s.jour_fin; });
      if (idx >= 0) ouverte = idx;
    }

    const entetes = [];
    const panneaux = [];
    function ouvrir(i) {
      entetes.forEach(function (b, k) {
        b.setAttribute("aria-expanded", String(k === i));
        panneaux[k].hidden = k !== i;
      });
    }

    const liste = el("div");
    semaines.forEach(function (s, i) {
      const idBtn = "sem-btn-" + s.numero;
      const idPan = "sem-pan-" + s.numero;
      const bouton = el("button", { type: "button", class: "semaine-entete", id: idBtn, "aria-controls": idPan, "aria-expanded": "false" },
        el("span", null,
          etiquette("Semaine " + s.numero + " sur " + semaines.length, "span"),
          el("span", { class: "semaine-nom" }, s.nom),
          el("span", { class: "semaine-dates" }, plageDates(s.date_debut, s.date_fin)),
          s.verset ? el("span", { class: "semaine-verset" }, s.verset.reference) : null),
        icone("chevron"));

      const panneau = el("div", { class: "semaine-panneau", id: idPan, role: "region", "aria-labelledby": idBtn, hidden: true });
      if (s.verset) {
        panneau.append(el("details", { class: "depliant" },
          el("summary", null, "Voir le verset"),
          el("div", { class: "depliant-corps" }, passage(s.verset))));
      }
      const ul = el("ul", { class: "jours" });
      (s.jours || []).forEach(function (j) {
        const st = Aube.temps.statutJour(j.jour);
        const msg = el("p", { class: "msg-verrou", role: "status", hidden: true },
          "Ce jour sera disponible le " + dateLongue(Aube.temps.dateDuJour(j.jour)) + ".");
        const ligne = el("button", { type: "button", class: "jour-btn" + (st === "verrouille" ? " verrouille" : "") },
          el("span", { class: "jour-num" }, "J" + j.jour),
          el("span", { class: "jour-titre" }, j.titre),
          iconeEtat(st, actions[j.jour - 1]));
        ligne.addEventListener("click", function () {
          if (st === "verrouille") msg.hidden = !msg.hidden;
          else Routeur.aller("#/jour/" + j.jour);
        });
        ul.append(el("li", null, ligne, msg));
      });
      panneau.append(ul);

      bouton.addEventListener("click", function () {
        ouvrir(bouton.getAttribute("aria-expanded") === "true" ? -1 : i);
      });
      entetes.push(bouton);
      panneaux.push(panneau);
      liste.append(el("section", { class: "semaine" }, bouton, panneau));
    });
    racine.append(liste);
    ouvrir(ouverte);
  }

  /* ========== Écran : Jour ========== */

  function ongletLire(panneau, jour, n) {
    rendreBlocs(panneau, jour.lire);
    panneau.append(el("button", { type: "button", class: "btn", style: "margin-top:24px", onclick: function () { Routeur.remplacer("#/jour/" + n + "/agir"); } }, "Agir et prier →"));
  }

  async function ongletAgir(panneau, jour, n) {
    const agir = jour.agir || {};
    const action = agir.action || { consigne: "", versets: [] };
    const fait = await Aube.progression.actionFaite(n).catch(function () { return false; });
    const msg = el("p", { class: "msg-etat erreur", role: "status" });

    // Jours sans action dans le livret (consigne null) : simple case « J’ai terminé ce jour »
    const avecAction = typeof action.consigne === "string" && action.consigne.trim() !== "";
    const sectionAction = el("section", { class: "section-jour" },
      etiquette(avecAction ? "Action" : "Progression"),
      avecAction ? paragraphe(action.consigne, "paragraphe action-consigne") : null,
      caseACocher({
        id: "case-action", libelle: avecAction ? "J’ai fait cette action" : "J’ai terminé ce jour", cochee: fait,
        onchange: async function (input) {
          const voulu = input.checked;
          msg.textContent = "";
          try { await Aube.progression.definirAction(n, voulu); }
          catch (e) { input.checked = !voulu; msg.textContent = MSG_ERREUR; }
        }
      }),
      msg);
    if (action.versets && action.versets.length > 0) {
      const corps = el("div", { class: "depliant-corps" });
      action.versets.forEach(function (v) { corps.append(passage(v)); });
      sectionAction.append(el("details", { class: "depliant" }, el("summary", null, "Voir les versets"), corps));
    }
    panneau.append(sectionAction);

    const prieres = agir.prieres || [];
    if (prieres.length > 0) {
      const ol = el("ol", { class: "liste liste-ord prieres" });
      prieres.forEach(function (t) { ol.append(balisage(el("li"), t)); });
      panneau.append(el("section", { class: "section-jour" }, etiquette("Sujets de prière"), ol));
    }
  }

  async function ongletJournal(panneau, n) {
    const valeur = await Aube.journal.lire(n);
    panneau.append(
      zoneAuto({
        id: "journal-jour", etiquette: "Ce que Dieu m’a dit · Mes engagements", classe: "zone-journal", valeur: valeur,
        ecrire: function (t) { return Aube.journal.ecrire(n, t); }
      }),
      el("p", { class: "petit" }, "Votre journal reste sur ce téléphone."));
  }

  // Pied du jour : jour précédent / suivant
  function piedJour(n, onglet) {
    const suivantVerrouille = n < 30 && Aube.temps.statutJour(n + 1) === "verrouille";
    const pied = el("nav", { class: "pied-jour", "aria-label": "Changer de jour" },
      el("div", { class: "pied-jour-boutons" },
        el("button", { type: "button", class: "btn btn-contour", disabled: n <= 1, onclick: function () { Routeur.aller("#/jour/" + (n - 1) + "/" + onglet); } }, "← Jour précédent"),
        el("button", { type: "button", class: "btn btn-contour", disabled: n >= 30 || suivantVerrouille, onclick: function () { Routeur.aller("#/jour/" + (n + 1) + "/" + onglet); } }, "Jour suivant →")));
    if (suivantVerrouille) pied.append(el("p", { class: "pied-dispo" }, "Disponible le " + dateLongue(Aube.temps.dateDuJour(n + 1))));
    return pied;
  }

  async function ecranJour(racine, n, onglet) {
    if (Aube.temps.statutJour(n) === "verrouille") {
      racine.append(
        el("div", { class: "message", role: "status" }, "Ce jour sera disponible le " + dateLongue(Aube.temps.dateDuJour(n)) + "."),
        boutonRetourParcours());
      return;
    }
    let jour;
    try { jour = await jourData(n); }
    catch (e) {
      if (!estIntrouvable(e)) throw e;
      racine.append(el("div", { class: "message", role: "status" }, MSG_INDISPO), boutonRetourParcours());
      return;
    }
    const semaines = await semainesData().catch(function () { return []; });
    const sem = semaineDuJour(semaines, n);
    const lignes = [];
    lignes.push("Semaine " + (jour.semaine || (sem && sem.numero) || "") + (sem ? " · " + sem.nom : ""));
    lignes.push(dateLongue(Aube.temps.dateDuJour(n)));

    racine.append(enteteJour({ numero: n, lignes: lignes, etiquette: "Jour · " + n + " sur 30", titre: jour.titre }));

    // Onglets (routes /lire, /agir, /journal)
    const DEF = [["lire", "Lire"], ["agir", "Agir et prier"], ["journal", "Journal"]];
    const onglets = el("div", { class: "segmente onglets", role: "tablist", "aria-label": "Sections du jour" });
    DEF.forEach(function (d, i) {
      const actif = d[0] === onglet;
      const b = el("button", {
        type: "button", role: "tab", id: "onglet-" + d[0], "aria-controls": "panneau-jour",
        "aria-selected": String(actif), tabindex: actif ? "0" : "-1"
      }, d[1]);
      b.addEventListener("click", function () { if (!actif) Routeur.remplacer("#/jour/" + n + "/" + d[0]); });
      b.addEventListener("keydown", function (ev) {
        let k = -1;
        if (ev.key === "ArrowRight") k = (i + 1) % DEF.length;
        else if (ev.key === "ArrowLeft") k = (i + DEF.length - 1) % DEF.length;
        if (k >= 0) { ev.preventDefault(); Routeur.remplacer("#/jour/" + n + "/" + DEF[k][0]); }
      });
      onglets.append(b);
    });
    racine.append(onglets);

    const panneau = el("div", { class: "panneau-jour", id: "panneau-jour", role: "tabpanel", "aria-labelledby": "onglet-" + onglet, tabindex: "0" });
    if (onglet === "agir") await ongletAgir(panneau, jour, n);
    else if (onglet === "journal") await ongletJournal(panneau, n);
    else ongletLire(panneau, jour, n);
    racine.append(panneau, piedJour(n, onglet));
  }

  /* ========== Écran : Introduction ========== */

  async function ecranIntroduction(racine) {
    let intro;
    try { intro = await charger("introduction", function () { return Aube.donnees.introduction(); }); }
    catch (e) {
      if (!estIntrouvable(e)) throw e;
      racine.append(el("div", { class: "message", role: "status" }, MSG_INDISPO), boutonRetourParcours());
      return;
    }
    racine.append(el("h1", { class: "titre-programme" }, intro.titre));
    rendreBlocs(racine, intro.blocs);
    racine.append(el("a", { class: "btn", href: "#/parcours", style: "margin-top:24px" }, "Voir le parcours"));
  }

  /* ========== Écran : Mon espace ========== */

  // Après un rechargement de l'écran : affiche un message dans un élément et le met en vue
  function annoncer(id, texte) {
    const m = document.getElementById(id);
    if (!m) return;
    m.textContent = texte;
    if (m.scrollIntoView) m.scrollIntoView({ block: "center" });
  }

  // Construit une section ; une erreur dans une section n'empêche pas les autres de s'afficher.
  async function sectionEspace(racine, titre, construire) {
    const sec = el("section", { class: "section-espace" }, el("h2", null, titre));
    racine.append(sec);
    try { await construire(sec); }
    catch (e) { sec.append(el("p", { class: "msg-etat erreur", role: "alert" }, MSG_ERREUR)); }
  }

  async function ecranEspace(racine) {
    const prog = await programmeData().catch(function () { return null; });
    const semaines = await semainesData().catch(function () { return []; });
    racine.append(el("h1", { class: "sr-only" }, "Mon espace"));

    // 1. Progression
    await sectionEspace(racine, "Ma progression", async function (sec) {
      const r = await Promise.all([actionsFaites(), Aube.progression.resume()]);
      sec.append(blocProgression(r[0], r[1]));
    });

    // 2. Journal
    await sectionEspace(racine, "Mon journal", async function (sec) {
      const entrees = await Aube.journal.tous();
      if (!entrees.length) { sec.append(el("p", null, "Aucune note pour le moment.")); return; }
      entrees.forEach(function (e) {
        const court = String(e.texte).replace(/\s+/g, " ").trim();
        sec.append(el("a", { class: "ligne-journal", href: "#/jour/" + e.jour + "/journal" },
          etiquette("Jour " + e.jour, "span"),
          el("span", null, court.length > 80 ? court.slice(0, 80) + "…" : court)));
      });
    });

    // 3. Notes de la semaine
    await sectionEspace(racine, "Notes de la semaine", async function (sec) {
      const jc = Aube.temps.jourCourant();
      let courante = 1;
      if (jc.phase === "en_cours") { const s = semaineDuJour(semaines, jc.numero); if (s) courante = s.numero; }
      const choix = el("div", { class: "segmente", role: "group", "aria-label": "Choix de la semaine" });
      const titreSem = el("p", { class: "etiquette espace-semaine", "aria-live": "polite" });
      const zones = el("div");
      const boutons = [];
      let tour = 0;
      async function afficher(num) {
        const mon = ++tour;
        await viderEnAttente();
        boutons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-num") === String(num))); });
        const s = semaines.filter(function (x) { return x.numero === num; })[0];
        titreSem.textContent = "Semaine " + num + (s ? " · " + s.nom : "");
        const v = await Promise.all([Aube.notes.lire(num, "notes"), Aube.notes.lire(num, "action_de_grace")]);
        if (mon !== tour) return;
        zones.textContent = "";
        zones.append(
          zoneAuto({ id: "notes-" + num, etiquette: "Notes", classe: "zone-notes", lignes: 6, valeur: v[0], ecrire: function (t) { return Aube.notes.ecrire(num, "notes", t); } }),
          zoneAuto({ id: "grace-" + num, etiquette: "Action de grâce", classe: "zone-notes", lignes: 6, valeur: v[1], ecrire: function (t) { return Aube.notes.ecrire(num, "action_de_grace", t); } }));
      }
      semaines.forEach(function (s) {
        const b = el("button", { type: "button", "data-num": s.numero, "aria-label": "Semaine " + s.numero, "aria-pressed": "false" }, String(s.numero));
        b.addEventListener("click", function () { afficher(s.numero).catch(function () { zones.textContent = MSG_ERREUR; }); });
        boutons.push(b);
        choix.append(b);
      });
      sec.append(choix, titreSem, zones);
      await afficher(courante);
    });

    // 4. Prière et calendrier
    await sectionEspace(racine, "Prière et calendrier", async function (sec) {
      const plages = [];
      if (prog) {
        (prog.temps_forts || []).forEach(function (t) { plages.push({ id: t.id, nom: t.nom, detail: plageHeures(t.debut, t.fin) }); });
        if (prog.phrase_de_guerre) plages.push({ id: "phrase_de_guerre", nom: "Phrase de guerre " + heureFr(prog.phrase_de_guerre.heure) });
      }
      const boite = [];
      const bouton = el("button", { type: "button", class: "btn", style: "margin-top:12px" }, "Ajouter à mon calendrier");
      const etat = el("p", { class: "msg-etat", role: "status" });
      function maj() { bouton.disabled = !boite.some(function (c) { return c.input.checked; }); }
      plages.forEach(function (p) {
        const input = el("input", { type: "checkbox", id: "plage-" + p.id });
        input.checked = true;
        input.addEventListener("change", maj);
        boite.push({ id: p.id, input: input });
        sec.append(el("label", { class: "case case-compacte", for: "plage-" + p.id },
          input, el("span", { class: "case-boite" }, icone("coche")),
          el("span", { class: "case-libelle" }, p.nom, p.detail ? el("small", null, p.detail) : null)));
      });
      bouton.addEventListener("click", async function () {
        etat.textContent = "";
        etat.className = "msg-etat";
        try {
          await Aube.calendrier.telechargerICS({ plages: boite.filter(function (c) { return c.input.checked; }).map(function (c) { return c.id; }) });
        } catch (e) { etat.textContent = MSG_ERREUR; etat.className = "msg-etat erreur"; }
      });
      sec.append(bouton, el("p", { class: "petit" }, "Un fichier s’ouvre dans l’application Calendrier de votre téléphone."), etat);
      maj();
    });

    // 5. Taille du texte
    await sectionEspace(racine, "Taille du texte", async function (sec) {
      const prefs = await Aube.preferences.lire();
      const DEF = [["normale", "Normale"], ["grande", "Grande"], ["tres_grande", "Très grande"]];
      const groupe = el("div", { class: "segmente", role: "group", "aria-label": "Taille du texte" });
      const btns = [];
      function marquer(t) { btns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-t") === t)); }); }
      DEF.forEach(function (d) {
        const b = el("button", { type: "button", "data-t": d[0], "aria-pressed": "false" }, d[1]);
        b.addEventListener("click", async function () {
          appliquerTaille(d[0]);
          marquer(d[0]);
          try { await Aube.preferences.ecrire({ taille_texte: d[0] }); } catch (e) { /* le changement visuel reste actif */ }
        });
        btns.push(b);
        groupe.append(b);
      });
      marquer(prefs.taille_texte || "normale");
      sec.append(groupe);
    });

    // 6. Sauvegarde
    await sectionEspace(racine, "Sauvegarde", async function (sec) {
      const derniere = el("p", { class: "paragraphe" });
      const etat = el("p", { class: "msg-etat", role: "status" });
      async function majDerniere() {
        let d = null;
        try { d = await Aube.sauvegarde.derniereSauvegarde(); } catch (e) { d = null; }
        derniere.textContent = "Dernière sauvegarde" + NBSP + ": " + (d ? dateIsoVersFr(d) || "jamais" : "jamais");
      }
      function dire(texte, erreur) { etat.textContent = texte; etat.className = "msg-etat" + (erreur ? " erreur" : ""); }
      const fichier = el("input", { type: "file", accept: ".json,application/json", hidden: true, "aria-label": "Fichier de sauvegarde" });
      fichier.addEventListener("change", async function () {
        const f = fichier.files && fichier.files[0];
        fichier.value = "";
        if (!f) return;
        if (!window.confirm("Cela remplacera vos données actuelles. Continuer ?")) return;
        try {
          await Aube.sauvegarde.importer(f);
          const p = await Aube.preferences.lire();
          appliquerTaille(p.taille_texte);
          await Routeur.recharger();
          annoncer("msg-restauration", "Vos données ont été restaurées.");
        } catch (e) {
          dire(e && e.code === "FORMAT_INVALIDE" ? "Ce fichier n’est pas une sauvegarde Aube valide. Vos données n’ont pas été modifiées." : MSG_ERREUR, true);
        }
      });
      const bSauver = el("button", { type: "button", class: "btn" }, "Sauvegarder mes données");
      bSauver.addEventListener("click", async function () {
        dire("");
        try { await Aube.sauvegarde.telecharger(); await majDerniere(); dire("Sauvegarde téléchargée."); }
        catch (e) { dire(MSG_ERREUR, true); }
      });
      const bRestaurer = el("button", { type: "button", class: "btn btn-contour" }, "Restaurer une sauvegarde");
      bRestaurer.addEventListener("click", function () { fichier.click(); });
      await majDerniere();
      sec.append(
        el("p", { class: "paragraphe" }, "Vos données restent sur ce téléphone. Si vous changez de téléphone ou effacez les données du navigateur, elles seront perdues. Faites une sauvegarde de temps en temps."),
        derniere,
        el("div", { class: "btn-groupe", style: "margin-top:12px" }, bSauver, bRestaurer),
        fichier,
        el("p", { class: "msg-etat", id: "msg-restauration", role: "status" }),
        etat);
    });

    // 7. Effacer mes données
    await sectionEspace(racine, "Effacer mes données", async function (sec) {
      const etat = el("p", { class: "msg-etat erreur", role: "status", id: "msg-efface" });
      const b = el("button", { type: "button", class: "btn btn-danger" }, "Effacer mes données");
      b.addEventListener("click", async function () {
        if (!window.confirm("Effacer toutes vos notes et votre progression sur ce téléphone ?")) return;
        if (!window.confirm("Cette action est définitive. Effacer toutes mes données ?")) return;
        try {
          await Aube.sauvegarde.effacerTout();
          const p = await Aube.preferences.lire();
          appliquerTaille(p.taille_texte);
          await Routeur.recharger();
          annoncer("msg-efface", "Vos données ont été effacées.");
        } catch (e) { etat.textContent = MSG_ERREUR; }
      });
      sec.append(b, etat);
    });
  }

  /* ========== Écran : Infos ========== */

  async function ecranInfos(racine) {
    const infos = await charger("infos", function () { return Aube.donnees.infos(); });
    racine.append(
      el("h1", { class: "infos-mission" }, infos.mission),
      infos.pasteur ? el("p", { class: "infos-ligne" }, infos.pasteur) : null,
      infos.lieu ? el("p", { class: "infos-ligne" }, infos.lieu) : null);

    const actions = el("div", { class: "infos-actions" });
    if (infos.telephone) {
      const chiffres = String(infos.telephone).replace(/\D/g, "");
      actions.append(el("a", { class: "btn", href: "tel:" + chiffres, "aria-label": "Appeler le " + infos.telephone }, icone("telephone"), infos.telephone));
    }
    if (infos.whatsapp && /^https:\/\//i.test(infos.whatsapp)) {
      actions.append(el("a", { class: "btn btn-contour", href: infos.whatsapp, target: "_blank", rel: "noopener noreferrer" }, "WhatsApp"));
    }
    racine.append(actions,
      el("img", { class: "infos-logo", src: "assets/logo-aube.png", alt: "Logo Aube" }),
      el("section", { class: "infos-bloc" },
        etiquette("Confidentialité"),
        el("p", null, "Aucun compte n’est demandé. Vos notes restent sur votre téléphone et ne sont jamais envoyées.")),
      el("p", { class: "infos-version" }, "Version 1.0"));
  }

  /* ========== Rendu principal ========== */

  async function rendre(route) {
    const mien = ++jeton;
    await viderEnAttente();
    if (mien !== jeton) return;
    mettreAJourCadre(route);

    const racine = el("div", { class: "page" });
    try {
      if (route.nom === "parcours") await ecranParcours(racine);
      else if (route.nom === "jour") await ecranJour(racine, route.jour, route.onglet);
      else if (route.nom === "introduction") await ecranIntroduction(racine);
      else if (route.nom === "espace") await ecranEspace(racine);
      else if (route.nom === "infos") await ecranInfos(racine);
      else await ecranAccueil(racine);
    } catch (e) {
      if (window.console) console.error(e);
      racine.textContent = "";
      racine.append(blocErreur(route.nom !== "accueil"));
    }
    if (mien !== jeton) return;
    contenu.textContent = "";
    contenu.append(racine);
  }

  /* ========== Démarrage ========== */

  function afficherFatal() {
    document.getElementById("chargement").hidden = true;
    document.getElementById("appli").hidden = false;
    contenu.textContent = "";
    contenu.append(el("div", { class: "page" },
      el("div", { class: "message", role: "alert" }, el("p", null, MSG_ERREUR)),
      el("button", { type: "button", class: "btn", onclick: function () { window.location.reload(); } }, "Réessayer")));
  }

  async function demarrer() {
    if (!window.Aube || !window.Routeur) { afficherFatal(); return; }
    try { await Aube.pret; } catch (e) { afficherFatal(); return; }

    try { const p = await Aube.preferences.lire(); appliquerTaille(p.taille_texte); } catch (e) { /* taille normale par défaut */ }
    try {
      if (Aube.stockage.mode() === "memoire") {
        bandeau.append(el("p", { class: "bandeau-msg", role: "status" }, "Le stockage est indisponible sur ce navigateur : vos notes ne seront pas conservées."));
      }
    } catch (e) { /* sans importance */ }

    btnRetour.addEventListener("click", function () { Routeur.aller(Routeur.origine()); });
    // Les saisies en cours sont enregistrées si l'application passe en arrière-plan
    document.addEventListener("visibilitychange", function () { if (document.hidden) viderEnAttente(); });
    window.addEventListener("pagehide", viderEnAttente);

    await Routeur.demarrer(rendre);
    document.getElementById("appli").hidden = false;
    document.getElementById("chargement").hidden = true;
  }

  demarrer();
})();
