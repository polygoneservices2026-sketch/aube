/* ============================================================================
   AUBE — js/aube-core.js  (lot Développeur)
   Moteur de l'application : données, temps, progression, journal, sauvegarde,
   calendrier. Définit uniquement window.Aube. Aucune dépendance, aucun module,
   aucun accès au DOM (sauf le lien temporaire de téléchargement).
   ============================================================================ */
(function () {
  'use strict';

  // ==========================================================================
  // 1. CONSTANTES
  // ==========================================================================
  const NOM_BASE = 'aube-v1';
  const NOM_STORE = 'kv';
  const PREFIXE_LS = 'aube:';
  const NB_JOURS = 30;
  const NB_SEMAINES = 5;
  const MAX_TEXTE = 20000;
  const MAX_SAUVEGARDE = 5 * 1024 * 1024;
  const TYPES_NOTES = ['notes', 'action_de_grace'];
  const TAILLES_TEXTE = ['normale', 'grande', 'tres_grande'];
  const MS_PAR_JOUR = 86400000;
  const DUREE_PHRASE_MIN = 15;
  const DELAI_IDB_MS = 5000;

  // ==========================================================================
  // 2. UTILITAIRES
  // ==========================================================================

  /** Crée une erreur portant un code. */
  function erreur(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
  }

  /** Garantit qu'une erreur porte un .code. */
  function normaliser(e) {
    if (e instanceof Error) {
      if (!e.code) e.code = 'INTERNE';
      return e;
    }
    return erreur('INTERNE', String(e));
  }

  /** Enveloppe une fonction asynchrone : toute erreur rejette avec un .code. */
  function sure(fn) {
    return async function () {
      try {
        return await fn.apply(null, arguments);
      } catch (e) {
        throw normaliser(e);
      }
    };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function iso() { return new Date().toISOString(); }
  function estObjet(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /** Accepte 3 ou "3" ; renvoie l'entier ou rejette HORS_PLAGE. */
  function numeroJour(n) {
    let v = n;
    if (typeof v === 'string' && /^\d+$/.test(v)) v = parseInt(v, 10);
    if (!Number.isInteger(v) || v < 1 || v > NB_JOURS) {
      throw erreur('HORS_PLAGE', 'Numéro de jour invalide (1 à ' + NB_JOURS + ') : ' + n);
    }
    return v;
  }

  function verifierTexte(texte) {
    if (typeof texte !== 'string') throw erreur('ARGUMENT', 'Le texte doit être une chaîne.');
    if (texte.length > MAX_TEXTE) throw erreur('TROP_LONG', 'Texte trop long (maximum ' + MAX_TEXTE + ' caractères).');
  }

  function verifierNotes(semaine, type) {
    let s = semaine;
    if (typeof s === 'string' && /^\d+$/.test(s)) s = parseInt(s, 10);
    if (!Number.isInteger(s) || s < 1 || s > NB_SEMAINES) throw erreur('ARGUMENT', 'Semaine invalide (1 à ' + NB_SEMAINES + ').');
    if (TYPES_NOTES.indexOf(type) === -1) throw erreur('ARGUMENT', 'Type de notes invalide.');
    return s;
  }

  /** Longueur en octets UTF-8 d'une chaîne. */
  function tailleOctets(texte) {
    let total = 0;
    for (const c of texte) total += octetsDe(c.codePointAt(0));
    return total;
  }

  function octetsDe(cp) {
    if (cp < 0x80) return 1;
    if (cp < 0x800) return 2;
    if (cp < 0x10000) return 3;
    return 4;
  }

  /** Lit un Blob/File en texte (.text() si possible, sinon FileReader). */
  function lireBlob(blob) {
    if (typeof blob.text === 'function') return blob.text();
    return new Promise(function (resolve, reject) {
      const lecteur = new FileReader();
      lecteur.onload = function () { resolve(String(lecteur.result)); };
      lecteur.onerror = function () { reject(erreur('FORMAT_INVALIDE', 'Lecture du fichier impossible.')); };
      lecteur.readAsText(blob, 'utf-8');
    });
  }

  /** Déclenche le téléchargement d'un fichier (seule action sur le DOM). */
  function telechargerFichier(contenu, type, nom) {
    const blob = new Blob([contenu], { type: type });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nom;
    lien.style.display = 'none';
    document.body.appendChild(lien);
    lien.click();
    if (lien.parentNode) lien.parentNode.removeChild(lien);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function dateLocaleReelle() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // ==========================================================================
  // 3. STOCKAGE (IndexedDB → localStorage → mémoire)
  // ==========================================================================
  let mode = 'memoire';
  let db = null;
  const mem = new Map(); // toutes les entrées, en mémoire : clé → valeur

  function ouvrirIndexedDB() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        reject(erreur('STOCKAGE', 'IndexedDB indisponible.'));
        return;
      }
      let fini = false;
      const minuteur = setTimeout(function () {
        if (!fini) { fini = true; reject(erreur('STOCKAGE', 'IndexedDB : délai dépassé.')); }
      }, DELAI_IDB_MS);
      function echec(msg) {
        if (fini) return;
        fini = true;
        clearTimeout(minuteur);
        reject(erreur('STOCKAGE', msg));
      }
      let req;
      try {
        req = indexedDB.open(NOM_BASE, 1);
      } catch (e) {
        echec('IndexedDB : ouverture impossible.');
        return;
      }
      req.onupgradeneeded = function () {
        const base = req.result;
        if (!base.objectStoreNames.contains(NOM_STORE)) base.createObjectStore(NOM_STORE, { keyPath: 'cle' });
      };
      req.onsuccess = function () {
        if (fini) { try { req.result.close(); } catch (e) { /* rien */ } return; }
        fini = true;
        clearTimeout(minuteur);
        resolve(req.result);
      };
      req.onerror = function () { echec('IndexedDB : erreur d’ouverture.'); };
      req.onblocked = function () { echec('IndexedDB : ouverture bloquée.'); };
    });
  }

  function lireToutIDB(base) {
    return new Promise(function (resolve, reject) {
      try {
        const req = base.transaction(NOM_STORE, 'readonly').objectStore(NOM_STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(erreur('STOCKAGE', 'IndexedDB : lecture impossible.')); };
      } catch (e) {
        reject(erreur('STOCKAGE', 'IndexedDB : lecture impossible.'));
      }
    });
  }

  function testerLocalStorage() {
    try {
      const k = PREFIXE_LS + '__test';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function chargerLocalStorage() {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.indexOf(PREFIXE_LS) === 0) {
        try { mem.set(k.slice(PREFIXE_LS.length), JSON.parse(ls.getItem(k))); } catch (e) { /* entrée illisible ignorée */ }
      }
    }
  }

  /** Ouvre le meilleur stockage disponible et charge tout en mémoire. */
  async function ouvrirStockage() {
    try {
      db = await ouvrirIndexedDB();
      db.onversionchange = function () { try { db.close(); } catch (e) { /* rien */ } };
      const entrees = await lireToutIDB(db);
      mem.clear();
      entrees.forEach(function (e) { if (e && typeof e.cle === 'string') mem.set(e.cle, e.valeur); });
      mode = 'indexeddb';
      return;
    } catch (e) {
      db = null;
      mem.clear();
    }
    if (testerLocalStorage()) {
      chargerLocalStorage();
      mode = 'localstorage';
      return;
    }
    mode = 'memoire';
  }

  function persisterIDB(ops) {
    return new Promise(function (resolve, reject) {
      let tx;
      try {
        tx = db.transaction(NOM_STORE, 'readwrite');
        const store = tx.objectStore(NOM_STORE);
        ops.forEach(function (op) {
          if (op.valeur === undefined) store.delete(op.cle);
          else store.put({ cle: op.cle, valeur: op.valeur });
        });
      } catch (e) {
        reject(erreur('STOCKAGE', 'IndexedDB : écriture impossible.'));
        return;
      }
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(erreur('STOCKAGE', 'IndexedDB : écriture refusée.')); };
      tx.onabort = function () { reject(erreur('STOCKAGE', 'IndexedDB : écriture annulée.')); };
    });
  }

  function persisterLS(ops) {
    const ls = window.localStorage;
    ops.forEach(function (op) {
      if (op.valeur === undefined) ls.removeItem(PREFIXE_LS + op.cle);
      else ls.setItem(PREFIXE_LS + op.cle, JSON.stringify(op.valeur));
    });
  }

  /**
   * Applique un lot d'écritures (valeur === undefined → suppression) en
   * mémoire puis dans la base. En cas d'échec : retour arrière, rejet STOCKAGE.
   */
  async function appliquer(ops) {
    const avant = ops.map(function (op) { return { cle: op.cle, valeur: mem.get(op.cle) }; });
    ops.forEach(function (op) {
      if (op.valeur === undefined) mem.delete(op.cle);
      else mem.set(op.cle, op.valeur);
    });
    try {
      if (mode === 'indexeddb') await persisterIDB(ops);
      else if (mode === 'localstorage') persisterLS(ops);
    } catch (e) {
      avant.forEach(function (a) {
        if (a.valeur === undefined) mem.delete(a.cle);
        else mem.set(a.cle, a.valeur);
      });
      if (mode === 'localstorage') { try { persisterLS(avant); } catch (e2) { /* rien */ } }
      throw erreur('STOCKAGE', 'Écriture impossible (espace insuffisant ou stockage refusé).');
    }
  }

  function ecrireCle(cle, valeur) { return appliquer([{ cle: cle, valeur: valeur }]); }

  function clesAvecPrefixe(prefixe) {
    const res = [];
    mem.forEach(function (v, k) { if (k.indexOf(prefixe) === 0) res.push(k); });
    return res;
  }

  async function mettreAJourMeta(champs) {
    const meta = mem.get('meta') || { premiere_ouverture: iso(), derniere_sauvegarde: null };
    await ecrireCle('meta', Object.assign({}, meta, champs));
  }

  // ==========================================================================
  // 4. DONNÉES (fetch relatif + cache mémoire)
  // ==========================================================================
  let programme = null;           // programme.json, une fois chargé
  const cacheReseau = {};         // réponses de fetch réussies
  const injectees = {};           // données injectées par les tests
  let modeInjecte = false;        // si vrai : plus aucun fetch

  async function charger(cle, chemin) {
    if (Object.prototype.hasOwnProperty.call(injectees, cle)) return injectees[cle];
    if (Object.prototype.hasOwnProperty.call(cacheReseau, cle)) return cacheReseau[cle];
    if (modeInjecte) throw erreur('INTROUVABLE', 'Donnée absente : ' + chemin);
    let reponse;
    try {
      reponse = await fetch(chemin);
    } catch (e) {
      throw erreur('INTROUVABLE', 'Réseau indisponible pour : ' + chemin);
    }
    if (!reponse.ok) throw erreur('INTROUVABLE', 'Fichier introuvable : ' + chemin);
    let json;
    try {
      json = JSON.parse(await reponse.text());
    } catch (e) {
      throw erreur('DONNEES_INVALIDES', 'JSON invalide : ' + chemin);
    }
    cacheReseau[cle] = json;
    return json;
  }

  const donnees = {
    programme: sure(function () { return charger('programme', 'data/programme.json'); }),
    semaines: sure(function () { return charger('semaines', 'data/semaines.json'); }),
    introduction: sure(function () { return charger('introduction', 'data/introduction.json'); }),
    infos: sure(function () { return charger('infos', 'data/infos.json'); }),
    jour: sure(function (n) {
      const num = numeroJour(n);
      return charger('jour:' + num, 'data/jours/jour-' + pad2(num) + '.json');
    }),
    /** Réservé aux tests : remplace le chargement par fetch. */
    utiliserDonnees: function (lot) {
      if (!estObjet(lot)) throw erreur('ARGUMENT', 'Objet attendu.');
      modeInjecte = true;
      ['programme', 'semaines', 'introduction', 'infos'].forEach(function (cle) {
        if (lot[cle] !== undefined) injectees[cle] = lot[cle];
      });
      if (lot.programme !== undefined) programme = lot.programme;
      if (estObjet(lot.jours)) {
        Object.keys(lot.jours).forEach(function (n) { injectees['jour:' + parseInt(n, 10)] = lot.jours[n]; });
      }
    }
  };

  // ==========================================================================
  // 5. TEMPS
  // ==========================================================================
  let dateSimulee = null;  // { a, m, j }
  let heureForcee = null;  // { h, m }

  function programmeOuErreur() {
    if (!programme) throw erreur('NON_PRET', 'Le programme n’est pas chargé : attendre Aube.pret.');
    return programme;
  }

  /** "AAAA-MM-JJ" → { a, m, j } ou null si invalide. */
  function analyserDate(s) {
    const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!r) return null;
    const a = +r[1], m = +r[2], j = +r[3];
    const t = new Date(Date.UTC(a, m - 1, j));
    if (t.getUTCFullYear() !== a || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== j) return null;
    return { a: a, m: m, j: j };
  }

  function formaterDateUTC(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** "HH:MM" → minutes depuis minuit. */
  function hhmmEnMinutes(s) {
    const r = /^(\d{2}):(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!r || +r[1] > 23 || +r[2] > 59) throw erreur('DONNEES_INVALIDES', 'Heure invalide : ' + s);
    return +r[1] * 60 + +r[2];
  }

  function minutesEnHHMM(min) { return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }

  function dateDebutProgramme() {
    const d = analyserDate(programmeOuErreur().date_debut);
    if (!d) throw erreur('DONNEES_INVALIDES', 'date_debut invalide dans programme.json.');
    return d;
  }

  /** Heure réelle ; la date (et l'heure) peuvent être simulées pour les tests. */
  function maintenant() {
    const reel = new Date();
    let h = reel.getHours(), mi = reel.getMinutes(), s = reel.getSeconds(), ms = reel.getMilliseconds();
    if (heureForcee) { h = heureForcee.h; mi = heureForcee.m; s = 0; ms = 0; }
    if (dateSimulee) return new Date(dateSimulee.a, dateSimulee.m - 1, dateSimulee.j, h, mi, s, ms);
    if (heureForcee) return new Date(reel.getFullYear(), reel.getMonth(), reel.getDate(), h, mi, s, ms);
    return reel;
  }

  function aujourdhui() {
    const d = maintenant();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** Numéro brut du jour (≤ 0 avant le début, > 30 après la fin). */
  function numeroBrut() {
    const deb = dateDebutProgramme();
    const d = maintenant();
    const auj = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.floor((auj - Date.UTC(deb.a, deb.m - 1, deb.j)) / MS_PAR_JOUR) + 1;
  }

  function jourCourant() {
    const n = numeroBrut();
    if (n <= 0) return { numero: 0, phase: 'avant' };
    if (n <= NB_JOURS) return { numero: n, phase: 'en_cours' };
    return { numero: NB_JOURS + 1, phase: 'apres' };
  }

  function joursAvantDebut() {
    const deb = dateDebutProgramme();
    const d = maintenant();
    const auj = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((Date.UTC(deb.a, deb.m - 1, deb.j) - auj) / MS_PAR_JOUR);
    return diff > 0 ? diff : 0;
  }

  function dateDuJour(n) {
    const num = numeroJour(n);
    const deb = dateDebutProgramme();
    return formaterDateUTC(Date.UTC(deb.a, deb.m - 1, deb.j) + (num - 1) * MS_PAR_JOUR);
  }

  function statutJour(n) {
    const num = numeroJour(n);
    const c = jourCourant();
    if (c.phase === 'avant' || num > c.numero) return 'verrouille';
    if (c.phase === 'en_cours' && num === c.numero) return 'aujourdhui';
    return 'passe';
  }

  /** Plage en cours, sinon la prochaine (gère le passage de minuit). */
  function prochainTempsFort() {
    const prog = programmeOuErreur();
    const plages = prog.temps_forts;
    if (!Array.isArray(plages) || plages.length === 0) throw erreur('DONNEES_INVALIDES', 'Aucun temps fort dans programme.json.');
    const d = maintenant();
    const m = d.getHours() * 60 + d.getMinutes();
    let suivante = null;
    for (const p of plages) {
      const deb = hhmmEnMinutes(p.debut);
      const fin = hhmmEnMinutes(p.fin);
      const enCours = deb < fin ? (m >= deb && m < fin) : (m >= deb || m < fin);
      if (enCours) {
        return { id: p.id, nom: p.nom, debut: p.debut, fin: p.fin, en_cours: true, dans_minutes: 0 };
      }
      const delta = (deb - m + 1440) % 1440;
      if (!suivante || delta < suivante.delta) suivante = { p: p, delta: delta };
    }
    return {
      id: suivante.p.id, nom: suivante.p.nom, debut: suivante.p.debut, fin: suivante.p.fin,
      en_cours: false, dans_minutes: suivante.delta
    };
  }

  function simulerDate(valeur) {
    if (valeur === null || valeur === undefined) { dateSimulee = null; return; }
    const d = analyserDate(valeur);
    if (!d) throw erreur('ARGUMENT', 'Date invalide (AAAA-MM-JJ attendu).');
    dateSimulee = d;
  }

  function definirHeure(valeur) {
    if (valeur === null || valeur === undefined) { heureForcee = null; return; }
    const min = hhmmEnMinutes(valeur);
    heureForcee = { h: Math.floor(min / 60), m: min % 60 };
  }

  const temps = {
    aujourdhui: aujourdhui,
    jourCourant: jourCourant,
    joursAvantDebut: joursAvantDebut,
    dateDuJour: dateDuJour,
    statutJour: statutJour,
    maintenant: maintenant,
    prochainTempsFort: prochainTempsFort,
    simulerDate: simulerDate,
    _definirHeure: definirHeure
  };

  // ==========================================================================
  // 6. PROGRESSION
  // ==========================================================================
  function estFait(n) {
    const a = mem.get('action:' + n);
    return !!(a && a.fait);
  }

  const progression = {
    actionFaite: sure(function (n) { return estFait(numeroJour(n)); }),
    definirAction: sure(async function (n, fait) {
      const num = numeroJour(n);
      if (fait) await ecrireCle('action:' + num, { fait: true, date: iso() });
      else await ecrireCle('action:' + num, undefined);
    }),
    resume: sure(function () {
      let termines = 0;
      for (let n = 1; n <= NB_JOURS; n++) if (estFait(n)) termines++;
      const c = jourCourant();
      let serie = 0;
      const retards = [];
      if (c.phase !== 'avant') {
        let depart = NB_JOURS;
        if (c.phase === 'en_cours') depart = estFait(c.numero) ? c.numero : c.numero - 1;
        for (let n = depart; n >= 1 && estFait(n); n--) serie++;
        for (let n = 1; n < c.numero && n <= NB_JOURS; n++) if (!estFait(n)) retards.push(n);
      }
      return {
        termines: termines,
        total: NB_JOURS,
        pourcentage: Math.round(termines / NB_JOURS * 100),
        serie: serie,
        retards: retards
      };
    })
  };

  // ==========================================================================
  // 7. JOURNAL, NOTES, PRÉFÉRENCES
  // ==========================================================================
  const journal = {
    lire: sure(function (n) {
      const e = mem.get('journal:' + numeroJour(n));
      return e && typeof e.texte === 'string' ? e.texte : '';
    }),
    ecrire: sure(async function (n, texte) {
      const num = numeroJour(n);
      verifierTexte(texte);
      await ecrireCle('journal:' + num, { texte: texte, modifie: iso() });
    }),
    tous: sure(function () {
      const res = [];
      for (let n = 1; n <= NB_JOURS; n++) {
        const e = mem.get('journal:' + n);
        if (e && typeof e.texte === 'string' && e.texte.trim() !== '') {
          res.push({ jour: n, texte: e.texte, modifie: e.modifie });
        }
      }
      return res;
    })
  };

  const notes = {
    lire: sure(function (semaine, type) {
      const s = verifierNotes(semaine, type);
      const e = mem.get('notes:' + s + ':' + type);
      return e && typeof e.texte === 'string' ? e.texte : '';
    }),
    ecrire: sure(async function (semaine, type, texte) {
      const s = verifierNotes(semaine, type);
      verifierTexte(texte);
      await ecrireCle('notes:' + s + ':' + type, { texte: texte, modifie: iso() });
    })
  };

  function tailleTexteCourante() {
    const p = mem.get('prefs');
    return p && TAILLES_TEXTE.indexOf(p.taille_texte) !== -1 ? p.taille_texte : 'normale';
  }

  const preferences = {
    lire: sure(function () { return { taille_texte: tailleTexteCourante() }; }),
    ecrire: sure(async function (prefs) {
      if (!estObjet(prefs) || TAILLES_TEXTE.indexOf(prefs.taille_texte) === -1) {
        throw erreur('ARGUMENT', 'taille_texte doit valoir : ' + TAILLES_TEXTE.join(', ') + '.');
      }
      await ecrireCle('prefs', { taille_texte: prefs.taille_texte });
    })
  };

  // ==========================================================================
  // 8. SAUVEGARDE
  // ==========================================================================

  /** Construit l'objet de sauvegarde (contrat, section 9). */
  function construireSauvegarde() {
    const actions = {};
    const jr = {};
    const nt = {};
    for (let n = 1; n <= NB_JOURS; n++) {
      const a = mem.get('action:' + n);
      if (a && a.fait) actions[n] = { fait: true, date: a.date };
      const j = mem.get('journal:' + n);
      if (j && typeof j.texte === 'string' && j.texte.trim() !== '') jr[n] = { texte: j.texte, modifie: j.modifie };
    }
    for (let s = 1; s <= NB_SEMAINES; s++) {
      TYPES_NOTES.forEach(function (type) {
        const e = mem.get('notes:' + s + ':' + type);
        if (e && typeof e.texte === 'string' && e.texte.trim() !== '') nt[s + ':' + type] = { texte: e.texte, modifie: e.modifie };
      });
    }
    return {
      app: 'aube',
      format: 1,
      programme: (programme && programme.id) || 'tenebres-30-jours',
      exporte_le: iso(),
      donnees: {
        actions: actions,
        journal: jr,
        notes: nt,
        preferences: { taille_texte: tailleTexteCourante() }
      }
    };
  }

  function exporterTexte() { return JSON.stringify(construireSauvegarde(), null, 2); }

  async function texteDeSource(source) {
    if (typeof source === 'string') return source;
    if (source && typeof Blob !== 'undefined' && source instanceof Blob) return lireBlob(source);
    if (source && typeof source.text === 'function') return source.text();
    throw erreur('FORMAT_INVALIDE', 'Source de sauvegarde non reconnue.');
  }

  /** Valide tout AVANT d'écrire, puis remplace les données locales. */
  async function importer(source) {
    const texte = await texteDeSource(source);
    if (tailleOctets(texte) >= MAX_SAUVEGARDE) throw erreur('FORMAT_INVALIDE', 'Fichier trop volumineux.');
    let obj;
    try { obj = JSON.parse(texte); } catch (e) { throw erreur('FORMAT_INVALIDE', 'Fichier illisible.'); }
    if (!estObjet(obj) || obj.app !== 'aube' || obj.format !== 1 || !estObjet(obj.donnees)) {
      throw erreur('FORMAT_INVALIDE', 'Ce fichier n’est pas une sauvegarde Aube.');
    }
    const d = obj.donnees;
    ['actions', 'journal', 'notes', 'preferences'].forEach(function (section) {
      if (d[section] !== undefined && !estObjet(d[section])) throw erreur('FORMAT_INVALIDE', 'Section invalide : ' + section);
    });

    const nouvelles = new Map();
    const jours = new Set();

    function cleJour(k) {
      if (!/^\d+$/.test(k)) return 0;
      const n = parseInt(k, 10);
      return (String(n) === k && n >= 1 && n <= NB_JOURS) ? n : 0;
    }

    Object.keys(d.actions || {}).forEach(function (k) {
      const n = cleJour(k);
      const v = d.actions[k];
      if (!n || !estObjet(v) || typeof v.fait !== 'boolean' || !v.fait) return;
      nouvelles.set('action:' + n, { fait: true, date: typeof v.date === 'string' ? v.date : iso() });
      jours.add(n);
    });
    Object.keys(d.journal || {}).forEach(function (k) {
      const n = cleJour(k);
      const v = d.journal[k];
      if (!n || !estObjet(v) || typeof v.texte !== 'string' || v.texte.length > MAX_TEXTE || v.texte.trim() === '') return;
      nouvelles.set('journal:' + n, { texte: v.texte, modifie: typeof v.modifie === 'string' ? v.modifie : iso() });
      jours.add(n);
    });
    Object.keys(d.notes || {}).forEach(function (k) {
      const r = /^([1-5]):(notes|action_de_grace)$/.exec(k);
      const v = d.notes[k];
      if (!r || !estObjet(v) || typeof v.texte !== 'string' || v.texte.length > MAX_TEXTE || v.texte.trim() === '') return;
      nouvelles.set('notes:' + r[1] + ':' + r[2], { texte: v.texte, modifie: typeof v.modifie === 'string' ? v.modifie : iso() });
    });
    if (d.preferences && TAILLES_TEXTE.indexOf(d.preferences.taille_texte) !== -1) {
      nouvelles.set('prefs', { taille_texte: d.preferences.taille_texte });
    }

    // Remplacement : on efface d'abord les anciennes entrées, puis on pose les nouvelles
    const lot = new Map();
    mem.forEach(function (v, k) {
      if (k === 'prefs' || /^(action|journal|notes):/.test(k)) lot.set(k, undefined);
    });
    nouvelles.forEach(function (v, k) { lot.set(k, v); });
    const ops = [];
    lot.forEach(function (v, k) { ops.push({ cle: k, valeur: v }); });
    await appliquer(ops);
    return { ok: true, jours: jours.size };
  }

  const sauvegarde = {
    telecharger: sure(async function () {
      telechargerFichier(exporterTexte(), 'application/json;charset=utf-8', 'aube-sauvegarde-' + dateLocaleReelle() + '.json');
      await mettreAJourMeta({ derniere_sauvegarde: iso() });
    }),
    importer: sure(importer),
    effacerTout: sure(async function () {
      const ops = [];
      mem.forEach(function (v, k) { if (k !== 'meta') ops.push({ cle: k, valeur: undefined }); });
      const meta = mem.get('meta');
      ops.push({ cle: 'meta', valeur: { premiere_ouverture: (meta && meta.premiere_ouverture) || iso(), derniere_sauvegarde: null } });
      await appliquer(ops);
    }),
    derniereSauvegarde: sure(function () {
      const meta = mem.get('meta');
      return (meta && meta.derniere_sauvegarde) || null;
    }),
    /** Réservé aux tests : JSON de sauvegarde en chaîne, sans téléchargement. */
    _exporterTexte: exporterTexte
  };

  // ==========================================================================
  // 9. CALENDRIER (.ics)
  // ==========================================================================

  /** Échappe un texte iCalendar : \ ; , et sauts de ligne. */
  function echapperICS(t) {
    return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
  }

  /** Replie une ligne à 75 octets maximum (continuation : CRLF + espace). */
  function replierLigne(ligne) {
    let sortie = '';
    let courant = 0;
    for (const c of ligne) {
      const n = octetsDe(c.codePointAt(0));
      if (courant + n > 75) { sortie += '\r\n '; courant = 1; }
      sortie += c;
      courant += n;
    }
    return sortie;
  }

  /** ms (arithmétique UTC, heure « flottante ») → AAAAMMJJTHHMMSS. */
  function formaterICS(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' +
      pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds());
  }

  function listerPlages(prog) {
    const liste = [];
    (prog.temps_forts || []).forEach(function (tf) {
      liste.push({ id: tf.id, nom: tf.nom, debut: tf.debut, fin: tf.fin, description: tf.description || '' });
    });
    const pg = prog.phrase_de_guerre;
    if (pg && pg.heure) {
      const deb = hhmmEnMinutes(pg.heure);
      liste.push({
        id: 'phrase_de_guerre', nom: 'Phrase de guerre', debut: pg.heure,
        fin: minutesEnHHMM((deb + DUREE_PHRASE_MIN) % 1440), description: pg.texte || ''
      });
    }
    return liste;
  }

  function genererICS(prog, ids) {
    const toutes = listerPlages(prog);
    let choisies = toutes;
    if (ids && ids.length > 0) {
      choisies = [];
      ids.forEach(function (id) {
        const p = toutes.filter(function (x) { return x.id === id; })[0];
        if (!p) throw erreur('ARGUMENT', 'Plage inconnue : ' + id);
        if (choisies.indexOf(p) === -1) choisies.push(p);
      });
    }
    const deb = analyserDate(prog.date_debut);
    if (!deb) throw erreur('DONNEES_INVALIDES', 'date_debut invalide dans programme.json.');
    const base = Date.UTC(deb.a, deb.m - 1, deb.j);
    const nbJours = Number.isInteger(prog.nb_jours) && prog.nb_jours > 0 ? prog.nb_jours : NB_JOURS;
    const horodatage = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    const lignes = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aube//Bio\'El//FR', 'CALSCALE:GREGORIAN'];
    choisies.forEach(function (p) {
      const dm = hhmmEnMinutes(p.debut);
      const fm = hhmmEnMinutes(p.fin);
      const debutMs = base + dm * 60000;
      const finMs = base + (fm <= dm ? MS_PAR_JOUR : 0) + fm * 60000;
      lignes.push(
        'BEGIN:VEVENT',
        'UID:aube-' + p.id + '@aube.local',
        'DTSTAMP:' + horodatage,
        'DTSTART:' + formaterICS(debutMs),
        'DTEND:' + formaterICS(finMs),
        'RRULE:FREQ=DAILY;COUNT=' + nbJours,
        'SUMMARY:' + echapperICS('Aube · ' + p.nom),
        'DESCRIPTION:' + echapperICS(p.description),
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Aube',
        'TRIGGER:-PT10M',
        'END:VALARM',
        'END:VEVENT'
      );
    });
    lignes.push('END:VCALENDAR');
    return lignes.map(replierLigne).join('\r\n') + '\r\n';
  }

  const calendrier = {
    telechargerICS: sure(async function (options) {
      const prog = programmeOuErreur();
      let ids = [];
      if (options !== undefined && options !== null) {
        if (!estObjet(options)) throw erreur('ARGUMENT', 'Options invalides.');
        if (options.plages !== undefined && options.plages !== null) {
          if (!Array.isArray(options.plages)) throw erreur('ARGUMENT', 'plages doit être un tableau.');
          ids = options.plages;
        }
      }
      const texte = genererICS(prog, ids);
      telechargerFichier(texte, 'text/calendar;charset=utf-8', 'aube-priere.ics');
    })
  };

  // ==========================================================================
  // 10. DÉMARRAGE (Aube.pret)
  // ==========================================================================
  const stockage = { mode: function () { return mode; } };

  /** Réservé aux tests : vide le stockage, le cache réseau et les simulations. */
  const reinitialiser = sure(async function () {
    const ops = [];
    mem.forEach(function (v, k) { ops.push({ cle: k, valeur: undefined }); });
    if (ops.length) await appliquer(ops);
    Object.keys(cacheReseau).forEach(function (k) { delete cacheReseau[k]; });
    dateSimulee = null;
    heureForcee = null;
  });

  async function demarrer() {
    // 1. Stockage
    await ouvrirStockage();

    // 2. Programme (ou celui injecté par les tests)
    try {
      const p = await donnees.programme();
      if (!programme) programme = p;
    } catch (e) {
      if (!programme) throw e;
    }

    // 3. Mode test : ?date=AAAA-MM-JJ
    try {
      const param = new URLSearchParams(window.location.search).get('date');
      if (param && analyserDate(param)) simulerDate(param);
    } catch (e) { /* paramètre ignoré */ }

    // 4. Stockage persistant (sans attendre, sans planter)
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        const r = navigator.storage.persist();
        if (r && typeof r.catch === 'function') r.catch(function () { /* ignoré */ });
      }
    } catch (e) { /* ignoré */ }

    // 5. Première ouverture
    if (!mem.get('meta')) {
      try { await mettreAJourMeta({ premiere_ouverture: iso() }); } catch (e) { /* non bloquant */ }
    }
  }

  const pret = demarrer().catch(function (e) { throw normaliser(e); });
  pret.catch(function () { /* évite l'alerte « rejet non géré » ; l'interface reçoit l'erreur via await */ });

  window.Aube = {
    pret: pret,
    donnees: donnees,
    temps: temps,
    progression: progression,
    journal: journal,
    notes: notes,
    preferences: preferences,
    sauvegarde: sauvegarde,
    calendrier: calendrier,
    stockage: stockage,
    _reinitialiser: reinitialiser
  };
})();
