/* Stockage : la base vit dans le navigateur (IndexedDB) et est recopiée automatiquement
   dans le dossier BASE DE DONNÉES (OneDrive) sous forme d'un fichier de sauvegarde. */
(function (K) {
  "use strict";
  const U = K.U;
  const NOM_SAUVEGARDE = "K-BDD - sauvegarde.json";
  const DOSSIER_HISTORIQUE = "K-BDD sauvegardes";

  const PARAMETRES_DEFAUT = {
    nom_portefeuille: "Cabinet",
    ville_facture: "",
    coordonnees_cabinet: [],   // à renseigner dans Paramètres (en-tête des factures)
    bic_defaut: "",
    sas_lignes: [],
    mail_corps: "",
  };
  const LISTES_DEFAUT = {
    type_copro: ["COPRO IE", "GT", "ASL", "AFUL", "COPRO HAB"],
    lots_surface: ["LOTS", "SURFACE"],
    exercice: ["01/01 au 31/12", "01/04 au 31/03", "01/07 au 30/06", "01/10 au 30/09"],
    statut_impaye: ["À traiter", "Relancé", "Régularisé", "Contentieux"],
  };

  function baseVide() {
    return {
      version: 1,
      parametres: JSON.parse(JSON.stringify(PARAMETRES_DEFAUT)),
      listes: JSON.parse(JSON.stringify(LISTES_DEFAUT)),
      personnes: [],          // {role, prenom, nom, emails}
      copros: {},             // numero -> fiche
      budgets: {},            // 'copro|exercice' -> {copro, exercice, date_debut, date_fin, fichier, lignes}
      syntheses: {},          // 'copro|exercice' -> {donnees, lien, commentaire, note_suivante, modifie_le}
      todos: {},              // copro -> [{id, texte, lien, repetition, depuis, depuis_debut, fait: {exercice: date}, cree_le}]
      rapprochements: [],
      rappro_importe_le: "",
      incidents_cic_le: "",     // dernier import de l'export CIC « incidents de paiement » (rappel du lundi)
      gtb: {},                  // n° copro -> consommations Daikin Cloud Plus {jours: {AAAA-MM-JJ: [kWh x 4 usages]}, mois: {AAAA-MM: {fichier, complet…}}}
      pv: {},                   // n° copro -> production photovoltaïque {centrale, capacite, mois: {AAAA-MM: {kwh, pic}}, compte_injection}
      travaux_anterieurs: {},   // « n° copro|clé|opération » -> {montant} : dépensé avant les exercices importés
      extraits_cic: {},         // n° de compte CIC -> {copro, ft} : corrections manuelles du rangement des extraits
      rappro_justifs_copro: {}, // n° copro -> {motif, le} : copro sans compte dans le CONTROLE RAPPRO (nouveau compte sans mouvement…)
      rappro_justifs: {},     // rib -> {motif, le, date_releve} : retard « normal » (pas de mouvement), effacé au prochain CSV différent
      rappro_signature: "",
      bilan: { balances: {}, historique: {}, justifs: {}, journal: [] }, // balances (RESSOURCES\BALANCES), historique des contrôles, justifications des comptes d'attente
      edf_factures: null,     // export des factures EDF : {fichier, importe_le, lignes: [{n, df, c, r, e, du, au, k, ht, t, s, a, res}]}
      edf_periodes: {},
      edf_agreges: {},        // années de edf_conso reconstituées à partir des synthèses trimestrielles : {année: sources}       // synthèses EDF sur une autre période que l'année civile : {"du|au": {du, au, fichier, lignes}}
      edf_comptes: [],
      edf_exclus: [],         // comptes de facturation détachés à la main (jamais rattachés automatiquement)        // {id, compte, copro, reference}
      edf_conso: {},          // annee -> [lignes]
      catalogue: {},          // copro -> [{numero, lignes, mandataire, domiciliation}]
      lots_liste: {},         // copro -> liste des lots {fichier, maj, lots: {n° lot: {type, bt, etage, escalier, porte, plan, coproprietaire}}}
      lots: {},               // copro -> feuille de présence {fichier, maj, codes, totaux: {code clé: total}, coproprietaires: [{numero, nom, adresse, lots: [{lot, type, bt, t: {code: tantièmes}}]}]}
      contacts: [],
      coproprietaires: null,     // fichier des copropriétaires (export « AAAA-MM-JJ_copro_<cabinet>.csv ») {maj, fichier, liste: [{id, titre, nom, prenom, emails, …, copro}]}
      factures: [],           // historique complet des factures (éléments + instantané pour ressortir le PDF à l'identique)
      prochaine_facture: 1,
      operat: {},
      relances: { campagnes: {}, suivi: {} }, // campagnes de relance (exports GLOBAL / RAR / RS par date) et notes par copropriétaire             // copro -> { annee_reference, conso_reference, declarations: {annee: {...}}, energies: [...], tantiemes: {n° compte: nb}, tantiemes_total }   // numéro chronologique de la prochaine facture (4 derniers chiffres)
      impayes: [],
      incidents_bq: [],       // incidents sur les comptes des copros (export CIC « Vos incidents de paiement ») : {date, copro, type, contrepartie, montant, code_motif, motif, statut, note}
      veille: { suivi: {}, manuels: [], mots_cles: "" }, // veille juridique : suivi par article {statut, note}, infos saisies, mots-clés du cabinet
      journal: [],
      compteur: 1,
      modifie_le: "",
    };
  }

  const S = { db: baseVide(), dossier: null, permission: "absente", derniereSauvegarde: "", erreurSauvegarde: "" };

  S.nouvelId = () => S.db.compteur++;
  S.baseVide = baseVide;
  S.param = (cle, defaut = "") => (S.db.parametres[cle] ?? PARAMETRES_DEFAUT[cle] ?? defaut);
  S.liste = (nom) => S.db.listes[nom] || [];
  S.personnes = (role) => S.db.personnes.filter((p) => p.role === role).sort((a, b) => a.prenom.localeCompare(b.prenom));
  S.ajouterPersonne = (role, prenom, nom = "", emails = "", ecraser = false) => {
    let p = S.db.personnes.find((x) => x.role === role && x.prenom === prenom);
    if (!p) { p = { role, prenom, nom, emails }; S.db.personnes.push(p); return p; }
    if (ecraser || !p.nom) p.nom = nom || p.nom;
    if (ecraser || !p.emails) p.emails = emails || p.emails;
    return p;
  };
  S.journal = (type, fichier, message) => {
    S.db.journal.unshift({ le: U.horodatage(), type, fichier, message });
    S.db.journal = S.db.journal.slice(0, 200);
  };
  S.copros = () => Object.values(S.db.copros).sort((a, b) => a.numero.localeCompare(b.numero));
  S.copro = (numero) => S.db.copros[numero] || null;

  // ------------------------------------------------------------------ IndexedDB
  const idb = () => new Promise((ok, ko) => {
    if (!globalThis.indexedDB) return ko(new Error("IndexedDB indisponible"));
    const r = indexedDB.open("kbdd", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("etat");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  async function idbGet(cle) {
    const d = await idb();
    return new Promise((ok, ko) => { const t = d.transaction("etat").objectStore("etat").get(cle); t.onsuccess = () => ok(t.result); t.onerror = () => ko(t.error); });
  }
  async function idbSet(cle, valeur) {
    const d = await idb();
    return new Promise((ok, ko) => { const t = d.transaction("etat", "readwrite"); t.objectStore("etat").put(valeur, cle); t.oncomplete = ok; t.onerror = () => ko(t.error); });
  }

  /** Le navigateur a perdu des enregistrements : la base relue est plus ancienne que le dernier enregistrement réussi noté sur ce PC. */
  S.basePerdue = () => { try { const t = localStorage.getItem("kbdd.ecrit"); return t && (S.db.modifie_le || "") < t ? t : ""; } catch (e) { return ""; } };
  S.charger = async () => {
    try {
      const db = await idbGet("db");
      if (db) S.db = Object.assign(baseVide(), db);
      S.dossier = (await idbGet("dossier")) || null;
      if (S.dossier) S.permission = await S.dossier.queryPermission({ mode: "readwrite" });
      S.dossierFactures = (await idbGet("dossier_factures")) || null;
      S.dossierVirements = (await idbGet("dossier_virements")) || null;
      S.dossierCompta = (await idbGet("dossier_compta")) || null;
      S.dossiersCompta = (await idbGet("dossiers_compta_copros")) || {};
      S.racineCompta = (await idbGet("racine_compta")) || null;
    } catch (e) { console.warn(e); }
    for (const [k, v] of Object.entries(LISTES_DEFAUT)) if (!S.db.listes[k]) S.db.listes[k] = v.slice();
    S.normaliser();
  };

  // ------------------------------------------------------------------ une seule fenêtre en écriture
  /* Deux fenêtres K-BDD ouvertes = deux copies de la base en mémoire : la dernière qui enregistre écraserait l'autre.
     Un verrou (localStorage, renouvelé toutes les 5 s) désigne la fenêtre qui écrit ; les autres passent en lecture seule. */
  S.lectureSeule = false;
  const CLE_VERROU = "kbdd.verrou", DUREE_VERROU = 15000;
  const stockage = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };
  S.idFenetre = (() => {
    try { let id = sessionStorage.getItem("kbdd.fenetre"); if (!id) { id = Math.random().toString(36).slice(2); sessionStorage.setItem("kbdd.fenetre", id); } return id; }
    catch (e) { return Math.random().toString(36).slice(2); }
  })();
  const lireVerrou = () => { try { return JSON.parse(stockage().getItem(CLE_VERROU)) || null; } catch (e) { return null; } };
  /** Une autre fenêtre détient le verrou (et l'a renouvelé récemment). */
  S.verrouAilleurs = (maintenant = Date.now()) => { const v = lireVerrou(); return !!(v && v.id !== S.idFenetre && maintenant - v.t < DUREE_VERROU); };
  S.prendreVerrou = () => { try { stockage().setItem(CLE_VERROU, JSON.stringify({ id: S.idFenetre, t: Date.now() })); } catch (e) { /* stockage indisponible */ } };
  S.libererVerrou = () => { const v = lireVerrou(); if (v && v.id === S.idFenetre) try { stockage().removeItem(CLE_VERROU); } catch (e) { /* rien */ } };
  /** Démarre la surveillance ; quandPerdu() est appelé si une autre fenêtre prend la main. */
  S.surveillerVerrou = (quandPerdu, quandLibre = () => {}) => {
    if (!stockage()) return;
    const perdre = () => { if (!S.lectureSeule) { S.lectureSeule = true; quandPerdu(); } };
    // lecture seule : dès que l'autre fenêtre est fermée (verrou libre ou expiré), quandLibre() permet de reprendre la main
    setInterval(() => { if (S.lectureSeule) { if (!S.verrouAilleurs()) quandLibre(); return; } if (S.verrouAilleurs()) perdre(); else S.prendreVerrou(); }, 5000);
    globalThis.addEventListener("storage", (e) => { if (e.key === CLE_VERROU && S.verrouAilleurs()) perdre(); });
    globalThis.addEventListener("pagehide", S.libererVerrou);
  };

  let minuterie = null, minuterieFichier = null;
  /** À appeler après chaque modification : enregistre dans le navigateur puis dans le dossier. */
  S.sauver = (immediat = false) => {
    if (S.lectureSeule) { // une autre fenêtre K-BDD écrit : ne rien écraser, mais le signaler (rien de ce qui est fait ici n'est enregistré)
      if (S.surModifEnLecture) S.surModifEnLecture(); else S.nonEnregistre = true;
      return;
    }
    S.db.modifie_le = new Date().toISOString();
    S.db.ecrit_par = S.idNavigateur();
    clearTimeout(minuterie);
    const date = S.db.modifie_le;
    const faire = () => idbSet("db", S.db).then(() => {
      try { localStorage.setItem("kbdd.ecrit", date); } catch (e) { /* témoin indisponible */ } // témoin : dernier enregistrement réussi
      if (S.erreurNavigateur) { S.erreurNavigateur = ""; if (S.surErreur) S.surErreur(); }
    })
      .catch((e) => { S.erreurSauvegarde = S.erreurNavigateur = String(e && e.message || e); if (S.surErreur) S.surErreur(); });
    if (immediat || !globalThis.indexedDB) faire(); else minuterie = setTimeout(faire, 300);
    clearTimeout(minuterieFichier);
    minuterieFichier = setTimeout(() => S.sauverDansDossier().catch((e) => {
      if (e.code && S.surConflitDossier) return S.surConflitDossier(e);
      // fichier OneDrive illisible, verrouillé, « en ligne uniquement »… : ne jamais échouer en silence
      S.erreurSauvegarde = String(e && e.message || e); if (S.surErreur) S.surErreur();
    }), 4000);
  };

  /** Mise à niveau des anciennes bases : le mail des synthèses n'a plus qu'un seul champ {commentaires}. */
  S.normaliser = () => {
    const p = S.db.parametres;
    if (p && typeof p.mail_corps === "string" && /\{commentaire[12]\}/.test(p.mail_corps)) {
      p.mail_corps = p.mail_corps.replace(/\{commentaire1\}[ \t]*\r?\n?[ \t]*\{commentaire2\}/, "{commentaires}")
        .replace("{commentaire1}", "{commentaires}").replace(/[ \t]*\{commentaire2\}[ \t]*\r?\n?/, "");
    }
    if (p && !p.ville_facture) p.ville_facture = PARAMETRES_DEFAUT.ville_facture;
    // dates d'exercice des extractions au format AAAA-MM-JJ (une date « 30/06/2023 » fausse les tris et les périodes)
    for (const b of Object.values(S.db.budgets || {})) for (const k of ["date_debut", "date_fin"]) if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(b[k] || "")) b[k] = U.dateFr(b[k]);
    if (!S.db.todos) S.db.todos = {};
    // assistante rattachée au gestionnaire (profil) : reprise de l'affectation la plus fréquente de ses copros
    for (const g of (S.db.personnes || []).filter((p) => p.role === "gestionnaire" && p.assistante === undefined)) {
      const n = {};
      for (const c of Object.values(S.db.copros || {})) if (c.gestionnaire === g.prenom && c.assistante) n[c.assistante] = (n[c.assistante] || 0) + 1;
      const choix = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
      g.assistante = choix ? choix[0] : "";
    }
    // tâche des sous-compteurs : électricité et eau
    for (const l of Object.values(S.db.todos)) for (const t of l || []) if (t.process === "sous_compteurs" && t.texte === "Relever les sous-compteurs électriques") t.texte = "Relever les sous-compteurs";
    if (!S.db.rappro_justifs) S.db.rappro_justifs = {};
    if (!S.db.rappro_justifs_copro) S.db.rappro_justifs_copro = {};
    S.db.bilan = Object.assign({ balances: {}, historique: {}, justifs: {}, journal: [] }, S.db.bilan);
    if (!S.db.operat) S.db.operat = {};
    S.db.veille = Object.assign({ suivi: {}, manuels: [], mots_cles: "" }, S.db.veille);
  };

  S.exporterJson = () => JSON.stringify(S.db);
  /** Copie de secours de la base actuelle avant qu'elle soit remplacée (restauration, rechargement depuis OneDrive). */
  S.mettreDeCote = () => {
    if (!S.nbCopros(S.db)) return null;
    const json = S.exporterJson(), nom = `avant-restauration-${new Date().toISOString().slice(0, 23).replace(/[:.]/g, "-")}.json`;
    const p = Promise.all([
      idbSet("db_avant_restauration", JSON.parse(json)).catch(() => {}),
      S.dossierPret() ? S.dossier.getDirectoryHandle(DOSSIER_HISTORIQUE, { create: true }).then((hist) => S.ecrireFichier(hist, nom, json)).catch((e) => console.warn(e)) : null,
    ]);
    S.miseDeCote = p; // promesse de la dernière copie de secours (S.restaurer est synchrone)
    return p;
  };
  S.nbCopros = (db) => Object.keys((db && db.copros) || {}).length;
  /** Remplace la base par une sauvegarde. Une sauvegarde sans aucune copro est refusée (fichier vide ou abîmé) sauf accepterVide ;
      la base remplacée est d'abord mise de côté (navigateur + dossier « K-BDD sauvegardes\avant-restauration-… »). */
  S.restaurer = (texte, { accepterVide = false } = {}) => {
    let db;
    try { db = JSON.parse(texte); } catch (e) { throw new Error("Ce fichier n'est pas une sauvegarde K-BDD lisible (fichier incomplet ou abîmé)."); }
    if (!db || typeof db !== "object" || !db.copros) throw new Error("Ce fichier n'est pas une sauvegarde K-BDD.");
    if (!accepterVide && !S.nbCopros(db) && S.nbCopros(S.db)) throw new Error("Cette sauvegarde ne contient aucune copro : elle n'a pas été chargée (la base actuelle est conservée).");
    S.mettreDeCote();
    S.db = Object.assign(baseVide(), db);
    S.normaliser();
    S.sauver(true);
  };

  // ------------------------------------------------------------------ dossier BASE DE DONNÉES (File System Access)
  S.dossierDisponible = () => typeof globalThis.showDirectoryPicker === "function";

  S.choisirDossier = async () => {
    const h = await globalThis.showDirectoryPicker({ id: "kbdd", mode: "readwrite" });
    S.dossier = h;
    S.permission = "granted";
    await idbSet("dossier", h);
    return h;
  };
  S.autoriserDossier = async () => {
    if (!S.dossier) return "absente";
    S.permission = await S.dossier.requestPermission({ mode: "readwrite" });
    return S.permission;
  };
  S.dossierPret = () => S.dossier && S.permission === "granted";
  /** Oublie le dossier OneDrive dans ce navigateur (le dossier et ses fichiers ne sont pas touchés). */
  S.delierDossier = async () => {
    S.dossier = null; S.permission = "absente"; S.dossierVu = 0; S.syncLe = ""; nbDossier = null;
    try { await idbSet("dossier", null); } catch (e) { /* stockage indisponible */ }
  };
  /** Dossier choisi à part mais situé dans BASE DE DONNÉES (ex. RESSOURCES\VIREMENTS CIC) : retrouvé depuis la base, il profite de son
      autorisation (pas de seconde demande). Renvoie le dossier atteint depuis BASE DE DONNÉES, ou null s'il est ailleurs. */
  S.deriverDepuisBase = async (h) => {
    if (!h || !S.dossierPret()) return null;
    try {
      const chemin = await S.dossier.resolve(h);
      if (!chemin) return null;
      let d = S.dossier;
      for (const n of chemin) d = await d.getDirectoryHandle(n);
      return d;
    } catch (e) { return null; }
  };
  /** Accès à un dossier annexe : déjà accordé, hérité de BASE DE DONNÉES, ou demandé (demander : dans un clic). Renvoie le dossier utilisable ou null. */
  S.accesAnnexe = async (h, demander = false) => {
    if (!h) return null;
    try { if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return h; } catch (e) { /* poignée invalide */ }
    const d = await S.deriverDepuisBase(h);
    if (d) return d;
    if (!demander) return null;
    try { return (await h.requestPermission({ mode: "readwrite" })) === "granted" ? h : null; } catch (e) { return null; }
  };
  /** Après l'autorisation de BASE DE DONNÉES (même clic) : dossiers des virements et des factures manuelles autorisés aussi
      (hérités de la base s'ils y sont, sinon demandés à la suite). */
  S.autoriserAnnexes = async () => {
    const v = await S.accesAnnexe(S.dossierVirements, true); if (v) S.dossierVirements = v;
    const f = await S.accesAnnexe(S.dossierFactures, true); if (f) S.dossierFactures = f;
    const rc = await S.accesAnnexe(S.racineCompta, true); if (rc) S.racineCompta = rc;
  };

  /** Dossier des factures manuelles (facultatif, ex. X:\...\FACTURES MANUELLES). */
  S.dossierFactures = null;
  S.choisirDossierFactures = async () => {
    S.dossierFactures = await globalThis.showDirectoryPicker({ id: "kbdd-factures", mode: "readwrite" });
    await idbSet("dossier_factures", S.dossierFactures);
  };
  /** À appeler au début d'un clic (le navigateur exige une action de l'utilisateur pour autoriser). */
  S.autoriserFactures = async () => {
    const d = await S.accesAnnexe(S.dossierFactures, true);
    if (d) S.dossierFactures = d;
    return !!d;
  };

  /** Dossier de travail des virements CIC (celui qui contient A VALIDER, VALIDES, ARCHIVES, ECARTES, JOURNAL) ; écriture pour valider ou écarter. */
  S.dossierVirements = null;
  S.SOUS_DOSSIERS_VIREMENTS = ["A VALIDER", "VALIDES", "ARCHIVES", "ECARTES", "JOURNAL"];
  /** Refuse un sous-dossier ou un dossier sans aucun des sous-dossiers créés par l'installation (dossier du logiciel, par exemple). */
  S.verifierDossierVirements = async (d) => {
    const nom = String(d.name || "").toUpperCase();
    if (S.SOUS_DOSSIERS_VIREMENTS.includes(nom)) throw new Error(`« ${d.name} » est un sous-dossier : choisissez le dossier qui le contient (le dossier de travail).`);
    for (const s of S.SOUS_DOSSIERS_VIREMENTS) { try { await d.getDirectoryHandle(s); return; } catch (e) { /* absent */ } }
    throw new Error(`« ${d.name} » ne contient ni A VALIDER ni JOURNAL : ce n'est pas le dossier de travail choisi à l'installation du rangement (ni le dossier du logiciel).`);
  };
  S.choisirDossierVirements = async () => {
    const d = await globalThis.showDirectoryPicker({ id: "kbdd-virements", mode: "readwrite" });
    await S.verifierDossierVirements(d);
    S.dossierVirements = d;
    await idbSet("dossier_virements", S.dossierVirements);
  };
  /** Dossier des virements oublié par le navigateur (mémoire effacée, autre profil…) : retrouvé dans BASE DE DONNÉES\RESSOURCES\VIREMENTS CIC
      s'il contient les sous-dossiers du rangement, et mémorisé à nouveau. Renvoie true si un dossier des virements est connu. */
  S.dossierVirementsDispo = async () => {
    if (S.dossierVirements) return true;
    if (!S.dossierPret()) return false;
    try {
      const d = await S.sousDossier(S.dossier, "RESSOURCES", "VIREMENTS CIC");
      if (!d) return false;
      await S.verifierDossierVirements(d);
      S.dossierVirements = d;
      await idbSet("dossier_virements", d);
      return true;
    } catch (e) { return false; }
  };
  S.virementsAutorises = async () => { const d = await S.accesAnnexe(S.dossierVirements); if (d) S.dossierVirements = d; return !!d; };
  S.autoriserVirements = async () => { const d = await S.accesAnnexe(S.dossierVirements, true); if (d) S.dossierVirements = d; return !!d; };

  /** Dossier d'import des factures du logiciel de comptabilité (ex. U:\mails) : les PDF reçus par mail y sont envoyés depuis la page Règles factures. */
  S.dossierCompta = null;
  S.choisirDossierCompta = async () => {
    const d = await globalThis.showDirectoryPicker({ id: "kbdd-compta", mode: "readwrite" });
    if (S.dossier && (await S.dossier.isSameEntry(d) || (await S.dossier.resolve(d)))) throw new Error(`« ${d.name} » est dans BASE DE DONNÉES : choisissez le dossier lu par le logiciel de comptabilité (U:\\mails).`);
    S.dossierCompta = d;
    await idbSet("dossier_compta", d);
  };
  /** Dossier compta de chaque copro et exercice (le chemin change chaque année ; PDF de synthèse enregistrés dedans), choisi par la fenêtre Windows
      de choix de dossier : {"n° copro|exercice": dossier}. La fenêtre s'ouvre sur le dossier d'un exercice précédent de la copro.
      Dossier racine facultatif (contient tous les dossiers compta) : une seule autorisation au lancement au lieu d'une par copro. */
  S.dossiersCompta = {};
  S.racineCompta = null;
  S.choisirDossierComptaCopro = async (cle) => {
    const copro = cle.split("|")[0], precedent = Object.keys(S.dossiersCompta).filter((k) => k.split("|")[0] === copro && k !== cle).sort().pop();
    const depart = S.dossiersCompta[cle] || (precedent && S.dossiersCompta[precedent]) || S.racineCompta;
    const d = await globalThis.showDirectoryPicker({ id: "kbdd-compta-copros", mode: "readwrite", ...(depart ? { startIn: depart } : {}) });
    S.dossiersCompta = { ...S.dossiersCompta, [cle]: d };
    await idbSet("dossiers_compta_copros", S.dossiersCompta);
    return d;
  };
  S.choisirRacineCompta = async () => {
    S.racineCompta = await globalThis.showDirectoryPicker({ id: "kbdd-compta-racine", mode: "readwrite" });
    await idbSet("racine_compta", S.racineCompta);
  };
  /** Chemin Windows du dossier compta (lien du bouton du PDF de synthèse). Chrome ne donne pas le chemin d'un dossier choisi : il est
      reconstitué depuis le chemin du dossier racine saisi dans Paramètres et la position du dossier dans ce dossier racine. null sinon. */
  S.cheminDossierCompta = async (cle) => {
    const h = S.dossiersCompta[cle], base = String(S.param("chemin_racine_compta") || "").trim().replace(/[\\/]+$/, "");
    if (!h || !base || !S.racineCompta) return null;
    try {
      const chemin = await S.racineCompta.resolve(h);
      return chemin ? [base, ...chemin].join("\\") : null;
    } catch (e) { return null; }
  };
  /** Dossier compta d'une copro utilisable : autorisé, hérité du dossier racine, ou demandé (demander : dans un clic). */
  S.accesDossierCompta = async (cle, demander = false) => {
    const h = S.dossiersCompta[cle];
    if (!h) return null;
    try { if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return h; } catch (e) { /* poignée invalide */ }
    if (S.racineCompta) {
      try {
        if ((await S.racineCompta.queryPermission({ mode: "readwrite" })) === "granted") {
          const chemin = await S.racineCompta.resolve(h);
          if (chemin) { let d = S.racineCompta; for (const n of chemin) d = await d.getDirectoryHandle(n); return d; }
        }
      } catch (e) { /* hors du dossier racine */ }
    }
    if (!demander) return null;
    try { return (await h.requestPermission({ mode: "readwrite" })) === "granted" ? h : null; } catch (e) { return null; }
  };
  S.comptaAutorise = async () => !!S.dossierCompta && (await S.dossierCompta.queryPermission({ mode: "readwrite" })) === "granted";
  S.autoriserCompta = async () => !!S.dossierCompta && ((await S.comptaAutorise()) || (await S.dossierCompta.requestPermission({ mode: "readwrite" })) === "granted");

  /** Retrouve un sous-dossier en ignorant accents / casse / encodage zip (#U00c9). */
  S.sousDossier = async (base, ...noms) => {
    let courant = base;
    for (const nom of noms) {
      if (!courant) return null;
      let trouve = null;
      for await (const [n, h] of courant.entries()) {
        if (h.kind === "directory" && U.normaliser(U.decoderNomZip(n)) === U.normaliser(nom)) { trouve = h; break; }
      }
      courant = trouve;
    }
    return courant;
  };
  /** Sous-dossier retrouvé (accents / casse ignorés) ou créé, niveau par niveau. */
  S.creerSousDossier = async (base, ...noms) => {
    let courant = base;
    for (const nom of noms) courant = (await S.sousDossier(courant, nom)) || (await courant.getDirectoryHandle(nom, { create: true }));
    return courant;
  };
  S.fichiers = async (dossier, filtre = () => true) => {
    const res = [];
    if (!dossier) return res;
    for await (const [n, h] of dossier.entries()) if (h.kind === "file" && filtre(n)) res.push(h);
    return res.sort((a, b) => a.name.localeCompare(b.name));
  };
  S.fichier = async (dossier, nom) => (await S.fichiers(dossier, (n) => U.normaliser(U.decoderNomZip(n)) === U.normaliser(nom)))[0] || null;
  /** Déplace / renomme un fichier de « dossier » vers « cible » (move() de Chrome, sinon copie puis suppression). N'écrase jamais un fichier existant. */
  S.deplacerFichier = async (dossier, fh, cible, nouveau) => {
    if (await cible.getFileHandle(nouveau).then(() => true, () => false)) throw new Error(`« ${nouveau} » existe déjà`);
    if (typeof fh.move === "function") { try { await fh.move(cible, nouveau); return; } catch (e) { /* repli : copie */ } }
    await S.ecrireFichier(cible, nouveau, await (await fh.getFile()).arrayBuffer());
    await dossier.removeEntry(fh.name);
  };
  S.ecrireFichier = async (dossier, nom, contenu) => {
    const fh = await dossier.getFileHandle(nom, { create: true });
    const w = await fh.createWritable();
    await w.write(contenu);
    await w.close();
    return fh;
  };

  /** Copie dans le dossier OneDrive. verifier : ne jamais remplacer une sauvegarde plus récente que la base du navigateur
      (au démarrage, la base du navigateur peut être plus ancienne : erreur code PLUS_RECENT, avec la date de la sauvegarde). */
  /* La sauvegarde OneDrive est commune à tous les navigateurs / PC : avant d'écrire, on vérifie que personne d'autre ne l'a
     remplacée par une version plus récente. Au démarrage (verifier) : comparée à la base du navigateur ; ensuite : si le fichier
     a changé depuis notre dernière écriture (date du fichier), comparée à la version de la base que nous y avions mise. */
  S.dossierVu = 0;      // date (lastModified) du fichier de sauvegarde après notre dernière écriture / lecture
  S.syncLe = "";        // modifie_le de la base au moment de cette écriture / lecture
  /* Une seule écriture à la fois : la copie suivante (minuterie de 4 s, sauvegarde au démarrage…) attend la fin de celle en cours. Sinon,
     sur un OneDrive lent, elle voit le fichier tout juste écrit par la précédente avant que sa date ne soit notée (S.dossierVu) et le prend
     à tort pour une version écrite ailleurs (MODIFIE_AILLEURS). */
  let ecritureEnCours = null;
  S.sauverDansDossier = async (verifier = false) => {
    while (ecritureEnCours) { try { await ecritureEnCours; } catch (e) { /* l'erreur est rendue à son propre appelant */ } }
    const p = sauverDansDossierSeul(verifier);
    ecritureEnCours = p;
    try { return await p; } finally { if (ecritureEnCours === p) ecritureEnCours = null; }
  };
  /** Une base vide ou qui a perdu plus de la moitié de ses copros ne remplace pas la sauvegarde OneDrive sans accord explicite
      (S.accepterReduction, posé après confirmation) : protège d'un navigateur vidé, d'un PC neuf ou d'une reprise partielle. */
  S.accepterReduction = false;
  let nbDossier = null; // nombre de copros de la sauvegarde OneDrive lors de notre dernière écriture
  S.reductionSuspecte = (avant, apres) => avant > 0 && (apres === 0 || (avant >= 4 && apres < avant / 2));
  const sauverDansDossierSeul = async (verifier) => {
    if (!S.dossierPret()) return false;
    const f = await S.fichier(S.dossier, NOM_SAUVEGARDE);
    if (f) {
      const fi = await f.getFile();
      if (verifier || (S.dossierVu && fi.lastModified > S.dossierVu + 1000)) {
        let x = {};
        try { const d = JSON.parse(await fi.text()); x = { date: d.modifie_le || "", par: d.ecrit_par || "" }; } catch (e) { /* illisible : on écrit */ }
        const reference = verifier ? S.db.modifie_le || "" : S.syncLe;
        if (x.date && x.date > reference) {
          const e = new Error(`la sauvegarde du dossier (${x.date}${x.par ? `, ${x.par}` : ""}) est plus récente que ce navigateur`);
          Object.assign(e, { code: verifier ? "PLUS_RECENT" : "MODIFIE_AILLEURS", date: x.date, par: x.par });
          throw e;
        }
      }
      if (!S.accepterReduction) {
        // fichier inchangé depuis notre dernière écriture : son nombre de copros est connu, pas besoin de relire 8 Mo à chaque copie
        let avant = S.dossierVu && fi.lastModified <= S.dossierVu + 1000 && nbDossier !== null ? nbDossier : 0;
        if (avant === 0) try { avant = S.nbCopros(JSON.parse(await fi.text())); } catch (e) { /* illisible : rien à protéger */ }
        const apres = S.nbCopros(S.db);
        if (S.reductionSuspecte(avant, apres)) {
          const e = new Error(`la base de ce navigateur (${apres} copro(s)) remplacerait la sauvegarde OneDrive (${avant} copro(s))`);
          Object.assign(e, { code: "REDUCTION", avant, apres });
          S.erreurSauvegarde = e.message;
          throw e;
        }
      }
    }
    try { const ok = await ecrireCopies(); S.accepterReduction = false; return ok; } catch (e) { S.erreurSauvegarde = e.message || String(e); throw e; }
  };
  /** Navigateur utilisé (noté dans la sauvegarde : qui l'a écrite). */
  S.navigateur = () => { const ua = (globalThis.navigator && navigator.userAgent) || ""; return /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : "navigateur"; };
  /** Identifiant de ce navigateur / profil (chaque profil Chrome a sa propre copie de la base) : « Chrome n°k3f9 ». */
  S.idNavigateur = () => {
    let id = "";
    try { id = localStorage.getItem("kbdd.navigateur") || ""; if (!id) { id = Math.random().toString(36).slice(2, 6); localStorage.setItem("kbdd.navigateur", id); } } catch (e) { /* stockage indisponible */ }
    return `${S.navigateur()}${id ? ` n°${id}` : ""}`;
  };
  /** Date de dernière modification de la base enregistrée dans le dossier (champ modifie_le), ou "". */
  S.dateSauvegardeDossier = async () => {
    const t = await S.lireSauvegardeDossier();
    if (!t) return "";
    try { return JSON.parse(t).modifie_le || ""; } catch (e) { return ""; }
  };
  const ecrireCopies = async () => {
    const json = S.exporterJson(), version = S.db.modifie_le || "";
    const fh = await S.ecrireFichier(S.dossier, NOM_SAUVEGARDE, json);
    try { S.dossierVu = (await fh.getFile()).lastModified; S.syncLe = version; } catch (e) { /* date du fichier indisponible */ }
    nbDossier = S.nbCopros(S.db);
    const hist = await S.dossier.getDirectoryHandle(DOSSIER_HISTORIQUE, { create: true });
    await S.ecrireFichier(hist, `${U.aujourdhui()}.json`, json);
    try { await S.purgerHistorique(hist); } catch (e) { console.warn(e); }
    S.derniereSauvegarde = U.horodatage();
    S.erreurSauvegarde = "";
    S.marquerCopie("dossier");
    return true;
  };

  /** Copies quotidiennes à conserver : les 30 derniers jours, puis la première copie de chaque mois. */
  S.copiesAConserver = (noms, aujourdhui = U.aujourdhui(), jours = 30) => {
    const limite = new Date(Date.parse(aujourdhui) - jours * 86400000).toISOString().slice(0, 10);
    const dates = noms.map((n) => (n.match(/^(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean).sort();
    const premiers = new Set(Object.values(dates.reduce((m, d) => { const k = d.slice(0, 7); if (!m[k]) m[k] = d; return m; }, {})));
    return new Set(dates.filter((d) => d >= limite || premiers.has(d)).map((d) => `${d}.json`));
  };
  let derniereePurge = "";
  S.purgerHistorique = async (hist, aujourdhui = U.aujourdhui()) => {
    if (derniereePurge === aujourdhui || !hist.removeEntry) return 0;
    derniereePurge = aujourdhui;
    const noms = [];
    for await (const [n, x] of hist.entries()) if (x.kind === "file") noms.push(n);
    const garder = S.copiesAConserver(noms, aujourdhui);
    let n = 0;
    for (const nom of noms) if (/^\d{4}-\d{2}-\d{2}\.json$/.test(nom) && !garder.has(nom)) { await hist.removeEntry(nom); n++; }
    return n;
  };

  // ------------------------------------------------------------------ alerte de sauvegarde
  /** Dernière copie de la base hors du navigateur (dossier OneDrive ou téléchargement), mémorisée sur ce PC. */
  S.JOURS_ALERTE_SAUVEGARDE = 3;
  S.marquerCopie = (type) => { try { localStorage.setItem("kbdd.copie", JSON.stringify({ le: new Date().toISOString(), type })); } catch (e) { /* stockage indisponible */ } };
  S.derniereCopie = () => { try { return JSON.parse(localStorage.getItem("kbdd.copie")) || null; } catch (e) { return null; } };
  /** null si tout va bien ; sinon { jours, message } : modifications non recopiées depuis plus de 3 jours, ou échec d'écriture. */
  S.etatSauvegarde = (maintenant = new Date(), copie = S.derniereCopie()) => {
    if (!Object.keys(S.db.copros).length) return null;
    // dossier relié : la copie est automatique après chaque modification, on ne signale qu'un échec
    if (S.dossierPret()) {
      if (S.erreurSauvegarde) return { jours: null, message: `La copie dans OneDrive a échoué (${S.erreurSauvegarde}).` };
      const modifD = S.db.modifie_le ? new Date(S.db.modifie_le) : null, jd = copie ? (maintenant - new Date(copie.le)) / 86400000 : null;
      if (modifD && copie && modifD > new Date(copie.le) && jd >= 1)
        return { jours: Math.floor(jd), message: "Aucune copie réussie dans OneDrive depuis plus de 24 h alors que la base a été modifiée : vérifiez que le dossier est accessible." };
      return null;
    }
    const modif = S.db.modifie_le ? new Date(S.db.modifie_le) : null;
    if (copie && modif && modif <= new Date(copie.le)) return null; // rien de nouveau depuis la dernière copie
    const jours = copie ? Math.floor((maintenant - new Date(copie.le)) / 86400000) : null;
    if (copie && jours < S.JOURS_ALERTE_SAUVEGARDE) return null;
    return { jours, message: copie ? `Dernière copie de la base hors du navigateur il y a ${jours} jours : les modifications depuis ne sont que dans ce navigateur.`
      : "Aucune copie de la base hors du navigateur : les données ne sont que dans ce navigateur." };
  };
  S.lireSauvegardeDossier = async () => {
    if (!S.dossierPret()) return null;
    const f = await S.fichier(S.dossier, NOM_SAUVEGARDE);
    return f ? (await f.getFile()).text() : null;
  };
  S.NOM_SAUVEGARDE = NOM_SAUVEGARDE;

  K.S = S;
})(globalThis.K = globalThis.K || {});
