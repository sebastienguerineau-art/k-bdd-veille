/* Règles de gestion reprises des formules du classeur BASE DE DONNÉES. */
(function (K) {
  "use strict";
  const U = K.U, E = K.E, S = K.S;
  const M = {};
  M.NB_LIGNES = { s12: 14, s3: 5 };
  M.COMPTE_HONORAIRES = "62110300";
  const v = (x) => (x === null || x === undefined ? 0 : x);

  // ======================================================================== BASE DE DONNÉES
  /** Colonne N : =ARRONDI(M/1,2;2) */
  M.honosHt = (ttc) => (ttc === null || ttc === undefined || ttc === "" ? null : U.arrondi(Number(ttc) / 1.2, 2));
  /** Colonne O : honoraires HT / lot ou m² */
  M.honosParUnite = (ttc, q) => { const ht = M.honosHt(ttc); return ht === null || !q ? null : ht / Number(q); };

  /** Colonne P (CONTRÔLE RAPPRO BQ) : dernier relevé du compte de la copro.
      Libellé renseigné (ex-onglet OUTILS) -> sa dernière occurrence (« MAX ... ») ;
      sinon n° de copro trouvé dans les libellés (hors livrets), relevé le plus récent. */
  M.rapprochementCopro = (c, lignes = S.db.rapprochements, numeros) => {
    const cible = U.normaliser(c.compte_bancaire);
    if (cible) {
      const t = lignes.filter((l) => U.normaliser(l.libelle) === cible);
      return t.length ? t[t.length - 1] : null;
    }
    numeros = numeros || new Set([c.numero]);
    const ft = M.rapprochementFondsTravaux(c, lignes, numeros);
    const t = lignes.filter((l) => U.extraireNumeroCopro(l.libelle, numeros) === c.numero && !M.estCompteFondsTravaux(l.libelle) && l !== ft);
    return t.length ? t.reduce((a, b) => ((b.date_releve || "") > (a.date_releve || "") ? b : a)) : null;
  };
  /** Comptes bancaires (principal ou fonds travaux) rattachés à plusieurs copros actives : [{rib, libelle, copros: [{c, type}]}]. */
  M.comptesPartages = (portefeuille = "") => {
    const numeros = new Set(Object.keys(S.db.copros)), par = {};
    for (const c of S.copros().filter((x) => x.actif)) {
      for (const [type, r] of [["principal", M.rapprochementCopro(c, S.db.rapprochements, numeros)], ["fonds travaux", M.rapprochementFondsTravaux(c, S.db.rapprochements, numeros)]]) {
        if (r) (par[r.rib] = par[r.rib] || { rib: r.rib, libelle: r.libelle, copros: [] }).copros.push({ c, type });
      }
    }
    return Object.values(par).filter((x) => new Set(x.copros.map((y) => y.c.numero)).size > 1)
      .filter((x) => !portefeuille || x.copros.some((y) => M.dansPortefeuille(y.c, portefeuille)));
  };
  /** Comptes du CONTROLE RAPPRO proposés pour remplacer un compte partagé : comptes rattachés à aucune copro,
      portant le n° de la copro (prioritaire) ou un mot significatif de son nom, du même type (principal / fonds travaux).
      [{libelle, rib, date_releve, raison}] — vide tant que le compte n'apparaît pas dans l'export. */
  M.propositionsCompte = (c, type = "principal", lignes = S.db.rapprochements || []) => {
    const numeros = new Set(Object.keys(S.db.copros)), pris = new Set();
    for (const x of S.copros().filter((y) => y.actif)) for (const r of [M.rapprochementCopro(x, lignes, numeros), M.rapprochementFondsTravaux(x, lignes, numeros)]) if (r) pris.add(r.rib);
    const VIDES = new Set(["SDC", "SC", "ASL", "AFUL", "A", "F", "U", "L", "DE", "DU", "DES", "LA", "LE", "LES", "ET", "BAT", "RESIDENCE", "SYNDIC", "SYNDICAT", "COPRO", "COPROPRIETE", "MAISON", "PARC", "RUE", "AVENUE", "BUREAUX", "LIVRET", "FT", "FONDS", "TRAVAUX", "COMPTE"]);
    const mots = (t) => U.normaliser(t).split(/[^A-Z0-9]+/).filter((m) => m.length >= 4 && !VIDES.has(m) && !/^\d+$/.test(m));
    const nom = new Set([...mots(c.nom), ...mots(c.nom_ics)]);
    const derniers = {};
    for (const l of lignes) if (!derniers[l.rib] || (l.date_releve || "") > (derniers[l.rib].date_releve || "")) derniers[l.rib] = l;
    const res = [];
    for (const l of Object.values(derniers)) {
      if (pris.has(l.rib) || M.estCompteFondsTravaux(l.libelle) !== (type === "fonds travaux")) continue;
      const n = U.extraireNumeroCopro(l.libelle, numeros);
      if (n && n !== c.numero) continue;
      const communs = mots(l.libelle).filter((m) => nom.has(m));
      if (n === c.numero) res.push({ ...l, raison: `n° ${c.numero}`, score: 10 + communs.length });
      else if (communs.length) res.push({ ...l, raison: `nom : ${communs.join(", ").toLowerCase()}`, score: communs.length });
    }
    return res.sort((a, b) => b.score - a.score || a.libelle.localeCompare(b.libelle)).slice(0, 3);
  };
  /** Libellé de compte de fonds travaux (loi ALUR) : livret, « FT », « fonds travaux », « ALUR ». */
  M.estCompteFondsTravaux = (libelle) => /\bLIVRET\b|(^|[\s-])FT\b|FONDS?\s+(DE\s+)?TRAVAUX|\bALUR\b/.test(U.normaliser(libelle));
  /** Compte du fonds travaux d'une copro : libellé renseigné dans la fiche, sinon compte « livret / FT » portant son n°. */
  M.rapprochementFondsTravaux = (c, lignes = S.db.rapprochements, numeros) => {
    const cible = U.normaliser(c.compte_fonds_travaux);
    if (cible) { const t = lignes.filter((l) => U.normaliser(l.libelle) === cible); return t.length ? t[t.length - 1] : null; }
    numeros = numeros || new Set([c.numero]);
    const t = lignes.filter((l) => U.extraireNumeroCopro(l.libelle, numeros) === c.numero && M.estCompteFondsTravaux(l.libelle));
    return t.length ? t.reduce((a, b) => ((b.date_releve || "") > (a.date_releve || "") ? b : a)) : null;
  };
  /** ok = relevé du mois dernier rapproché ; retard = un mois ; alerte = au-delà */
  M.statutRapprochement = (d, ref) => {
    if (!d) return "absent";
    const limite = U.finMoisPrecedent(ref);
    if (d >= limite) return "ok";
    if (d >= U.finMoisPrecedent(limite)) return "retard";
    return "alerte";
  };

  /** Retard de rapprochement déclaré normal (aucun mouvement…) : {motif, le} ou null. */
  M.justifRappro = (rib) => (rib && (S.db.rappro_justifs || {})[rib]) || null;
  M.justifierRappro = (ligne, motif) => {
    if (!S.db.rappro_justifs) S.db.rappro_justifs = {};
    const m = String(motif || "").trim();
    if (m) S.db.rappro_justifs[ligne.rib] = { motif: m, le: U.aujourdhui(), date_releve: ligne.date_releve };
    else delete S.db.rappro_justifs[ligne.rib];
  };
  /** Copro sans compte dans le CONTROLE RAPPRO (nouveau compte jamais exporté faute de mouvement…) : motif {motif, le} ou null. */
  M.justifSansCompte = (numero) => (S.db.rappro_justifs_copro || {})[numero] || null;
  M.justifierSansCompte = (numero, motif) => {
    if (!S.db.rappro_justifs_copro) S.db.rappro_justifs_copro = {};
    const m = String(motif || "").trim();
    if (m) S.db.rappro_justifs_copro[numero] = { motif: m, le: U.aujourdhui() };
    else delete S.db.rappro_justifs_copro[numero];
  };
  /** Rappel hebdomadaire : chaque lundi, importer l'export CIC « incidents de paiement ». Reste affiché tant que le fichier
      n'a pas été importé depuis ce lundi : {lundi, derniere} ou null. */
  M.rappelIncidentsCic = (aujourdhui = U.aujourdhui()) => {
    const d = new Date(`${aujourdhui}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const lundi = d.toISOString().slice(0, 10), derniere = S.db.incidents_cic_le || "";
    return derniere >= lundi ? null : { lundi, derniere };
  };
  /** Extrait de compte CIC téléchargé (« Extrait de comptes Compte 10000 000123456 01 C_C SEPARE … 9234 - SDC LE PRISME au 2026-08-31.pdf »)
      → nom codifié « 9234 CIC 08 2026.pdf » (« 9234 CIC 08 2026 FT.pdf » pour le compte du fonds travaux).
      Copro : RIB du CONTROLE RAPPRO (banque CIC 30047), sinon n° de copro dans le libellé. null si le nom n'est pas reconnu. */
  M.CODE_BANQUE_CIC = "30047";
  /** Extraction budget / charges du dossier différente de celle en mémoire (comptes modifiés depuis le premier export) ? */
  M.budgetDifferent = (cle, contenu) => {
    const b = S.db.budgets[cle];
    if (!b) return true;
    const { entete, lignes } = K.I.parseBudget(contenu);
    // comparaison sur les données de l'extraction seulement (les lignes en mémoire portent des marquages ajoutés : travaux rattachés…)
    const empreinte = (ls) => JSON.stringify(ls.map((l) => [l.cle, l.compte, l.libelle, l.total, l.budget, l.charges, l.budget_n1, l.budget_n2, l.travaux || ""]));
    return empreinte(lignes) !== empreinte(b.lignes) || (entete.debut || "") !== (b.date_debut || "") || (entete.fin || "") !== (b.date_fin || "");
  };
  M.nomCodifieCic = (copro, mois, annee, ft, ext = "") => `${copro} CIC ${mois} ${annee}${ft ? " FT" : ""}${ext}`;
  /** Analyse d'un fichier du dossier : {copro, mois, annee, ft, compte, ext, nouveau, deja}. nouveau = "" tant qu'il manque la copro ou la période
      (à compléter à la main). Les corrections faites à la main sont mémorisées par n° de compte (S.db.extraits_cic). */
  M.nomExtraitCic = (nom) => {
    nom = String(nom);
    const ext = (nom.match(/\.\w{2,4}$/) || [""])[0];
    const deja = nom.match(/^(\d{4}) CIC (\d{2}) (\d{4})( FT)?(\.\w+)?$/); // déjà codifié (resté à la racine) : seulement à ranger
    if (deja) return { copro: deja[1], mois: deja[2], annee: deja[3], ft: !!deja[4], compte: "", ext, nouveau: nom, deja: true };
    const numeros = new Set(Object.keys(S.db.copros));
    const d = nom.match(/(\d{4})-(\d{2})-\d{2}/) || nom.match(/(?<!\d)(\d{2})[ ._-](20\d{2})(?!\d)/);
    const [annee, mois] = !d ? ["", ""] : d[1].length === 4 ? [d[1], d[2]] : [d[2], d[1]];
    const m = nom.match(/Compte\s+(\d{5})\s+(\d{9,11})\s+(\d{2})\s+(.*?)\s+au\s+\d{4}-\d{2}-\d{2}/i);
    let copro = null, ft = false, compte = "";
    if (m) {
      const [, guichet, num, suffixe, libelle] = m;
      compte = `${guichet} ${num} ${suffixe}`;
      const chiffres = M.CODE_BANQUE_CIC + guichet + (num + suffixe).padStart(11, "0").slice(-11); // banque + guichet + n° de compte (sans clé RIB)
      const ligne = (S.db.rapprochements || []).find((r) => String(r.rib).replace(/\D/g, "").startsWith(chiffres));
      copro = K.I.coproDuCompte(chiffres, "") || U.extraireNumeroCopro(libelle, numeros);
      ft = M.estCompteFondsTravaux(ligne ? ligne.libelle : libelle);
    } else copro = U.extraireNumeroCopro(nom, numeros);
    const memo = compte && (S.db.extraits_cic || {})[compte];
    if (memo) { copro = memo.copro || copro; ft = !!memo.ft; }
    return { copro, mois, annee, ft, compte, ext, nouveau: copro && mois && annee ? M.nomCodifieCic(copro, mois, annee, ft, ext) : "" };
  };
  /** Correction manuelle d'un compte (copro, fonds travaux) : resservira pour les extraits suivants du même compte. */
  M.memoriserCompteCic = (compte, copro, ft) => {
    if (!compte) return;
    if (!S.db.extraits_cic) S.db.extraits_cic = {};
    S.db.extraits_cic[compte] = { copro, ft: !!ft, le: U.aujourdhui() };
  };
  /** Statut affiché : « justifie » quand un retard a été déclaré normal. */
  M.statutRapproLigne = (l, ref) => {
    const st = M.statutRapprochement(l.date_releve, ref);
    return st !== "ok" && M.justifRappro(l.rib) ? "justifie" : st;
  };

  M.listeCopros = () => {
    const numeros = new Set(Object.keys(S.db.copros));
    const nbBudgets = {}, nbImpayes = {};
    for (const b of Object.values(S.db.budgets)) nbBudgets[b.copro] = (nbBudgets[b.copro] || 0) + 1;
    for (const i of S.db.impayes) if (i.statut !== "Régularisé" && i.copro) nbImpayes[i.copro] = (nbImpayes[i.copro] || 0) + 1;
    return S.copros().map((c) => {
      const r = M.rapprochementCopro(c, S.db.rapprochements, numeros), ft = M.rapprochementFondsTravaux(c, S.db.rapprochements, numeros);
      return {
        ft_date: ft ? ft.date_releve : "", ft_statut: ft ? M.statutRapproLigne(ft) : "absent", ft_libelle: ft ? ft.libelle : "",
        ...c, honos_ht: M.honosHt(c.honos_ttc), honos_unite: M.honosParUnite(c.honos_ttc, c.quantite),
        rappro_date: r ? r.date_releve : "", rappro_ecart: r ? r.ecart : null,
        rappro_statut: r ? M.statutRapproLigne(r) : M.justifSansCompte(c.numero) ? "justifie" : "absent",
        rappro_motif: r ? (M.justifRappro(r.rib) || {}).motif || "" : (M.justifSansCompte(c.numero) || {}).motif || "",
        nb_budgets: nbBudgets[c.numero] || 0, nb_impayes: nbImpayes[c.numero] || 0,
      };
    });
  };

  M.emailsPersonne = (role, prenom) => (prenom && (S.db.personnes.find((p) => p.role === role && p.prenom === prenom) || {}).emails) || "";
  M.emailsGestionnaire = (prenom) => M.emailsPersonne("gestionnaire", prenom);
  /** Destinataires de la synthèse : gestionnaire + assistante de la copro, sans doublon (« a ; b »). */
  M.destinatairesSynthese = (c) => {
    const vus = new Set(), res = [];
    for (const e of `${M.emailsPersonne("gestionnaire", c.gestionnaire)};${M.emailsPersonne("assistante", c.assistante)}`.split(/[;,]/)) {
      const x = e.trim();
      if (x && !vus.has(x.toLowerCase())) { vus.add(x.toLowerCase()); res.push(x); }
    }
    return res.join(" ; ");
  };
  M.ribCopro = (c) => { const r = c && M.rapprochementCopro(c); return r ? r.rib : ""; };

  // ======================================================================== SYNTHÈSE COMPTES
  M.exercicesDisponibles = (numero) => Object.values(S.db.budgets).filter((b) => b.copro === numero)
    .sort((a, b) => (b.date_fin || "").localeCompare(a.date_fin || "") || b.exercice.localeCompare(a.exercice)).map((b) => b.exercice);

  // ------------------------------------------------------------------ travaux votés en AG (hors charges courantes)
  /** Ligne de travaux : uniquement les lignes comprises dans un bloc « * * AG … * * » … « * * Total AG … --> » de l'extraction
      (repérées à la lecture du CSV). Aucune déduction par n° de compte ou par libellé. */
  M.estTravaux = (l) => !!(l && l.compte && l.travaux);
  M.reperageTravaux = (f) => { if (f && f.lignes) K.I.blocsTravaux(f.lignes); return f; }; // blocs sans compte 67 : pas des travaux
  const COLONNES = ["budget", "charges", "budget_n1", "budget_n2"];
  /** Totaux des charges courantes : total général de l'extraction moins les lignes de travaux. */
  M.totauxCourants = (f) => {
    M.reperageTravaux(f);
    const g = f.lignes.find((l) => l.total === "general");
    const t = Object.fromEntries(COLONNES.map((k) => [k, g ? g[k] : null]));
    const vus = new Set();
    for (const l of f.lignes) {
      if (!M.estTravaux(l)) continue;
      const cleL = `${l.travaux || l.cle}|${l.compte}`;
      if (vus.has(cleL)) continue;
      vus.add(cleL);
      for (const k of COLONNES) if (l[k] !== null && l[k] !== undefined && t[k] !== null && t[k] !== undefined) t[k] = U.arrondi(t[k] - l[k], 2);
    }
    return g ? { ...g, ...t } : null;
  };
  /** Opérations de travaux d'un exercice : budget voté (colonne budget, sinon N+2 ou N+1), dépensé sur l'exercice,
      cumul des exercices précédents importés (même opération), reste et avancement. */
  M.travauxExercice = (numero, exercice) => {
    const f = M.reperageTravaux(S.db.budgets[`${numero}|${exercice}`]);
    if (!f) return [];
    const ops = {};
    for (const l of f.lignes) {
      if (!M.estTravaux(l)) continue;
      const op = l.travaux || l.cle || "Travaux";
      const cle = `${l.cle}|${op}`;
      const x = ops[cle] = ops[cle] || { cle, operation: op, cle_repartition: l.cle, lignes: [], b: 0, b1: 0, b2: 0, charges: 0 };
      x.lignes.push(l);
      x.b += v(l.budget); x.b1 += v(l.budget_n1); x.b2 += v(l.budget_n2); x.charges += v(l.charges);
    }
    const anterieurs = Object.values(S.db.budgets).filter((b) => b.copro === numero && b.exercice !== exercice && (b.date_fin || "") < (f.date_fin || ""));
    return Object.values(ops).map((x) => {
      const vote = x.b || x.b2 || x.b1 || null;
      const avant = v(((S.db.travaux_anterieurs || {})[`${numero}|${x.cle}`] || {}).montant); // dépensé avant les exercices importés (saisi)
      let cumul = avant;
      for (const b of anterieurs) for (const l of M.reperageTravaux(b).lignes) if (M.estTravaux(l) && `${l.cle}|${l.travaux || l.cle || "Travaux"}` === x.cle) cumul += v(l.charges);
      const depense = U.arrondi(cumul + x.charges, 2);
      return { cle: x.cle, operation: x.operation, cle_repartition: x.cle_repartition, budget_vote: vote, charges: U.arrondi(x.charges, 2),
        anterieur: cumul ? U.arrondi(cumul, 2) : null, hors_import: avant || null, depense, reste: vote === null ? null : U.arrondi(vote - depense, 2),
        avancement: vote ? depense / vote : null, lignes: x.lignes.map((l) => ({ compte: l.compte, libelle: l.libelle, charges: l.charges })) };
    }).sort((a, b) => b.depense - a.depense);
  };

  // ------------------------------------------------------------------ process spécifiques d'une copro (catalogue extensible)
  /** Catalogue : chaque process ajoute un reporting à importer lors de la synthèse des comptes. */
  M.PROCESS = {
    pv_sbm: { libelle: "Panneaux Photovoltaïques : Reporting SBM", fournisseur: "SBM", todo: "Récupérer le reporting SBM",
      modes: { revente_totale: "Revente totale", autoconso_injection: "Autoconsommation + injection (surplus non rémunéré)",
        autoconso_revente: "Autoconsommation + revente du surplus", autoconso_pure: "Autoconsommation pure (sans injection)" } },
  };
  const ANCIENS_MODES_PV = { autoconso: "autoconso_injection", surplus: "autoconso_revente", vente_totale: "revente_totale" };
  /** Process d'une copro ({type, mode, pdl_conso, compte_vente…}) ou null. Reprise des réglages photovoltaïques antérieurs au catalogue. */
  M.processCopro = (c, type) => {
    if (!c) return null;
    if (!c.process) c.process = [];
    let p = c.process.find((x) => x.type === type);
    const pv = type === "pv_sbm" && (S.db.pv || {})[c.numero];
    if (!p && pv && Object.keys(pv.mois || {}).length) {
      p = { type, mode: ANCIENS_MODES_PV[pv.mode] || "autoconso_injection", pdl_conso: pv.pdl_conso || "", compte_vente: pv.compte_injection || "", cree_le: U.aujourdhui() };
      c.process.push(p);
      assurerTodoProcess(c, type);
    }
    return p || null;
  };
  /** Tâche annuelle du process (to do de la synthèse), créée avec le process, cochée à l'import du reporting. */
  M.todoProcess = (c, type) => M.todos(c.numero).find((t) => t.process === type) || null;
  const assurerTodoProcess = (c, type) => {
    const libelle = (M.PROCESS[type] || {}).todo;
    if (!libelle || M.todoProcess(c, type)) return;
    const t = M.ajouterTodo(c.numero, K.E.exerciceClos(c.exercice || "01/01 au 31/12", U.aujourdhui()), libelle, "chaque_annee");
    t.process = type;
  };
  M.cocherTodoProcess = (c, type, exercice) => { const t = M.todoProcess(c, type); if (t) M.cocherTodo(c.numero, t.id, exercice, true); };
  M.ajouterProcess = (c, type) => {
    if (!M.PROCESS[type]) throw new Error(`Process inconnu : ${type}`);
    let p = M.processCopro(c, type);
    if (!p) { p = { type, mode: Object.keys(M.PROCESS[type].modes || {})[0] || "", pdl_conso: "", compte_vente: "", cree_le: U.aujourdhui() }; c.process.push(p); }
    assurerTodoProcess(c, type);
    return p;
  };
  M.majProcess = (c, type, champs) => { const p = M.processCopro(c, type); if (p) Object.assign(p, champs); return p; };
  M.retirerProcess = (c, type) => {
    if (!c || !c.process) return;
    c.process = c.process.filter((x) => x.type !== type);
    if (S.db.todos && S.db.todos[c.numero]) S.db.todos[c.numero] = S.db.todos[c.numero].filter((t) => t.process !== type);
  };

  /** Montant déjà dépensé sur une opération avant les exercices importés (ex. honoraires 2021) : ajouté au cumul et au reste. */
  M.definirTravauxAnterieur = (numero, cle, montant) => {
    if (!S.db.travaux_anterieurs) S.db.travaux_anterieurs = {};
    const m = U.arrondi(Number(montant) || 0, 2);
    if (m) S.db.travaux_anterieurs[`${numero}|${cle}`] = { montant: m, le: U.aujourdhui() };
    else delete S.db.travaux_anterieurs[`${numero}|${cle}`];
  };
  /** Opération clôturée dans les comptes ? Choix de la fiche de l'exercice, sinon du dernier exercice antérieur qui l'a indiqué. */
  M.travauxCloture = (numero, cle, exercice, fiche) => {
    if (fiche && fiche.travaux_clos && cle in fiche.travaux_clos) return !!fiche.travaux_clos[cle];
    const fin = (S.db.budgets[`${numero}|${exercice}`] || {}).date_fin || "";
    const prec = Object.entries(S.db.syntheses).filter(([k, r]) => k.startsWith(numero + "|") && r.travaux_clos && cle in r.travaux_clos)
      .map(([k, r]) => ({ fin: (S.db.budgets[k] || {}).date_fin || k.split("|")[1], clos: r.travaux_clos[cle] }))
      .filter((x) => x.fin <= fin).sort((a, b) => b.fin.localeCompare(a.fin));
    return prec.length ? !!prec[0].clos : false;
  };

  /** Tableaux CH N / CH N-1 (charges courantes : les travaux votés en AG sont traités à part). */
  M.chargerBudget = (numero, exercice) => {
    const f = M.reperageTravaux(S.db.budgets[`${numero}|${exercice}`]);
    if (!f) return null;
    const comptes = {};
    for (const l of f.lignes) if (l.compte && !M.estTravaux(l) && !comptes[l.compte]) comptes[l.compte] = l;
    return { fichier: f, comptes, total: M.totauxCourants(f) };
  };

  /** Premier exercice de la copro (indiqué lors de la synthèse) : pas d'exercice N-1 à comparer. */
  M.estPremierExercice = (c, n) => !!(c && c.premier_exercice && n && c.premier_exercice === n.libelle);
  M.marquerPremierExercice = (c, libelle) => { if (libelle) c.premier_exercice = libelle; else delete c.premier_exercice; };

  M.exerciceCourant = (c, reference, choisi) => (choisi ? E.exerciceDepuisLibelle(c.exercice, choisi) : E.exerciceClos(c.exercice, reference));

  const ratio = (num, den, lib) => (den ? num / den : lib);

  /** État de synthèse d'une copro pour un exercice et une fiche.
      Tableau 1 (« s12 ») : pour chaque compte, écart charges N / budget N ET écart charges N / charges N-1
      (anciens comparatifs 1 et 2 de l'Excel, réunis). Tableau 2 (« s3 ») : budgets N / N+2 (budget proposé : colonne « REGUL BUD » de l'extraction, comme l'Excel). */
  M.calculerSynthese = (c, n, fiche) => {
    const n1 = n.decale(-1);
    const premier = M.estPremierExercice(c, n);
    const chN = M.chargerBudget(c.numero, n.libelle), chN1 = premier ? null : M.chargerBudget(c.numero, n1.libelle);
    const manquants = [];
    if (!chN) manquants.push({ fichier: `${c.numero} ${n.cleFichier}.csv`, exercice: n, role: "N" });
    if (!chN1 && !premier) manquants.push({ fichier: `${c.numero} ${n1.cleFichier}.csv`, exercice: n1, role: "N-1" });
    const cn = chN ? chN.comptes : {}, cn1 = chN1 ? chN1.comptes : {};
    const tn = (chN && chN.total) || {}, tn1 = (chN1 && chN1.total) || {};

    const calc = {
      /** écart charges N - budget N (ex-comparatif 1) */
      budget: (k) => { const l = cn[k]; if (!l) return [null, "absent"]; const d = v(l.charges) - v(l.budget); return [d, ratio(d, l.budget, "0 budget")]; },
      /** écart charges N - charges N-1 (ex-comparatif 2) */
      n1: (k) => { if (premier) return [null, undefined]; const l = cn[k], l1 = cn1[k]; const d = v(l && l.charges) - v(l1 && l1.charges); const p = Math.abs(v(l1 && l1.charges)); return [d, p && l ? d / p : "0 en N-1"]; },
      /** écart budget N+2 (proposé) - budget N */
      s3: (k) => { const l = cn[k]; if (!l) return [null, "absent"]; const d = v(l.budget_n1) - v(l.budget); return [d, ratio(d, l.budget, "0 budget")]; },
    };
    const lignes = (s, calcul) => {
      const res = [];
      let prec = null;
      for (const item of M.trierLignes((fiche[s] || []).slice(0, M.NB_LIGNES[s]), cn, cn1)) {
        const compte = String(item.compte || "").trim();
        if (!compte) continue;
        const ref = cn[compte] || cn1[compte] || {};
        const cle = ref.cle || "";
        res.push({ compte, cle: cle !== prec ? cle : "", libelle: ref.libelle || "?", commentaire: item.commentaire || "", inconnu: !ref.compte, ...calcul(compte) });
        prec = cle;
      }
      return res;
    };
    const eb = chN ? v(tn.charges) - v(tn.budget) : null;
    const en1 = chN && chN1 ? v(tn.charges) - v(tn1.charges) : null;
    const e3 = chN ? v(tn.budget_n1) - v(tn.budget) : null;
    return {
      premier, exercice: n, exercice_n1: n1, exercice_n_plus_1: n.decale(1), exercice_n_plus_2: n.decale(2), honoraires: M.honorairesSynthese(c, cn), mandat: M.controleMandat(c, n, M.honorairesSynthese(c, cn)), manquants, calc, cn, cn1,
      travaux: chN ? M.travauxExercice(c.numero, n.libelle).map((t) => ({ ...t, commentaire: ((fiche && fiche.travaux) || {})[t.cle] || "",
        cloture: M.travauxCloture(c.numero, t.cle, n.libelle, fiche) })).sort((a, b) => a.cloture - b.cloture) : [],
      comptes_n: Object.values(cn).sort((a, b) => a.ordre - b.ordre),
      comptes_union: Object.values({ ...cn1, ...cn }).sort((a, b) => (cn[a.compte] ? a.ordre : 1e6 + a.ordre) - (cn[b.compte] ? b.ordre : 1e6 + b.ordre)),
      s12: {
        charges: tn.charges, budget: tn.budget, charges_n1: tn1.charges,
        ecart_budget: eb, pct_budget: eb === null ? null : ratio(eb, tn.budget, "0 budget"),
        ecart_n1: en1, pct_n1: en1 === null ? null : ratio(en1, tn1.charges, "0 en N-1"),
        lignes: lignes("s12", (k) => {
          const [mb, pb] = calc.budget(k), [m1, p1] = calc.n1(k);
          return { budget: cn[k] ? cn[k].budget : null, charges: cn[k] ? cn[k].charges : null, charges_n1: cn1[k] ? cn1[k].charges : null,
            ecart_budget: mb, pct_budget: pb, ecart_n1: m1, pct_n1: p1 };
        }),
      },
      // I50 = I49 / E50 : l'Excel rapporte l'écart au budget proposé — conservé à l'identique.
      s3: { budget: tn.budget, budget_propose: tn.budget_n1, ecart: e3, pct: e3 === null ? null : ratio(e3, tn.budget_n1, ""),
        lignes: lignes("s3", (k) => { const [montant, pct] = calc.s3(k); return { budget: cn[k] ? cn[k].budget : null, budget_n1: cn[k] ? cn[k].budget_n1 : null, montant, pct }; }) },
    };
  };

  /** Ordre de l'extraction : comptes de N (clef de répartition puis compte), puis comptes présents seulement en N-1,
      puis comptes inconnus ; les lignes vides restent à la fin. */
  M.trierLignes = (items, cn, cn1) => {
    const rang = (k) => (cn[k] ? cn[k].ordre : cn1[k] ? 1e6 + cn1[k].ordre : 2e6);
    const pleines = items.filter((x) => String(x.compte || "").trim());
    const vides = items.filter((x) => !String(x.compte || "").trim());
    return pleines.map((x, i) => [x, i]).sort((a, b) => rang(a[0].compte) - rang(b[0].compte) || a[1] - b[1]).map((x) => x[0]).concat(vides);
  };

  M.ficheVide = () => Object.fromEntries(Object.entries(M.NB_LIGNES).map(([s, nb]) => [s, Array.from({ length: nb }, () => ({ compte: "", commentaire: "" }))]));

  /** Réunit les anciens comparatifs 1 (charges / budget) et 2 (charges N / N-1) en un seul tableau,
      sans perdre de commentaire : un compte présent dans les deux garde les deux commentaires. */
  M.fusionnerComparatifs = (s1 = [], s2 = []) => {
    const res = [];
    for (const it of [...s1, ...s2]) {
      const compte = String(it.compte || "").trim(), com = String(it.commentaire || "").trim();
      if (!compte) continue;
      const ex = res.find((r) => r.compte === compte);
      if (!ex) res.push({ compte, commentaire: com });
      else if (com && !ex.commentaire.split(" / ").includes(com)) ex.commentaire = ex.commentaire ? `${ex.commentaire} / ${com}` : com;
    }
    return res;
  };

  M.normaliserFiche = (d) => {
    const f = M.ficheVide();
    const src = { ...(d || {}) };
    if (!src.s12 && (src.s1 || src.s2)) src.s12 = M.fusionnerComparatifs(src.s1, src.s2);
    for (const [s, nb] of Object.entries(M.NB_LIGNES)) {
      const items = (src[s] || []).filter((x) => x && String(x.compte || "").trim() || (x && x.commentaire));
      for (let i = 0; i < Math.min(nb, items.length); i++) f[s][i] = { compte: String(items[i].compte || "").trim(), commentaire: String(items[i].commentaire || "") };
    }
    return f;
  };
  /** SAVE SYNTH */
  M.chargerFiche = (numero, exercice) => {
    const r = S.db.syntheses[`${numero}|${exercice}`];
    if (!r) return null;
    // Ancien format (2 lignes de commentaires en en-tête) -> un seul commentaire général
    const commentaire = r.commentaire !== undefined ? r.commentaire : [r.commentaire1, r.commentaire2].map((x) => String(x || "").trim()).filter(Boolean).join("\n");
    return { ...M.normaliserFiche(r.donnees), lien: r.lien || "", commentaire,
      note_suivante: r.note_suivante || "", modifie_le: r.modifie_le || "", analyses: r.analyses || null, travaux: r.travaux || {}, travaux_clos: r.travaux_clos || null,
      bilan_vu: !!r.bilan_vu };
  };
  M.sauverFiche = (numero, exercice, fiche) => {
    const avant = S.db.syntheses[`${numero}|${exercice}`] || {};
    S.db.syntheses[`${numero}|${exercice}`] = {
      donnees: { s12: fiche.s12, s3: fiche.s3 }, lien: fiche.lien || "",
      commentaire: fiche.commentaire || "", note_suivante: fiche.note_suivante || "",
      ...(fiche.analyses ? { analyses: fiche.analyses } : {}), // options de la page 2 (analyses) du PDF
      ...(fiche.travaux && Object.keys(fiche.travaux).length ? { travaux: fiche.travaux } : {}), // commentaires des opérations de travaux
      ...(fiche.travaux_clos && Object.keys(fiche.travaux_clos).length ? { travaux_clos: fiche.travaux_clos } : {}), // opérations clôturées dans les comptes
      ...(fiche.bilan_vu ? { bilan_vu: true } : {}), // commentaires automatiques du contrôle de bilan déjà proposés
      modifie_le: U.horodatage(),
      // suivi de campagne : l'envoi n'est pas perdu quand on réenregistre la fiche
      ...(avant.envoyee_le ? { envoyee_le: avant.envoyee_le, envoyee_a: avant.envoyee_a || "" } : {}),
    };
    S.sauver();
  };
  /** Mail de synthèse préparé (« Exécution finale ») ou envoi indiqué à la main depuis le suivi ; annuler = false. */
  /** Synthèse « considérée comme faite » (antériorités, synthèse faite hors de l'application) : sort du suivi sans fiche. */
  M.considererFaite = (numero, exercice, faite = true) => {
    if (!S.db.syntheses_faites) S.db.syntheses_faites = {};
    const cle = `${numero}|${exercice}`;
    if (faite) S.db.syntheses_faites[cle] = { le: U.horodatage() };
    else { delete S.db.syntheses_faites[cle]; const r = S.db.syntheses[cle]; if (r && r.envoyee_a === "considérée comme faite") { delete r.envoyee_le; delete r.envoyee_a; } }
    S.sauver();
  };
  M.marquerEnvoi = (numero, exercice, a = "", envoye = true) => {
    const r = S.db.syntheses[`${numero}|${exercice}`];
    if (!r) return false;
    if (envoye) { r.envoyee_le = U.horodatage(); r.envoyee_a = a; } else { delete r.envoyee_le; delete r.envoyee_a; }
    S.sauver();
    return true;
  };
  /** Note laissée lors de la synthèse de l'exercice précédent, pour l'exercice affiché. */
  M.notePrecedente = (numero, exercice) => {
    const f = M.chargerFiche(numero, exercice.decale(-1).libelle);
    return f && f.note_suivante ? { exercice: exercice.decale(-1).libelle, texte: f.note_suivante, le: f.modifie_le } : null;
  };
  // ------------------------------------------------------------------ to do list de la copro (synthèse)
  /** Tâches propres à une copro, affichées lors de la synthèse :
      « chaque année » : à partir de l'exercice où elle est créée, puis toutes les années suivantes ;
      « année prochaine » : uniquement dans la synthèse de l'exercice suivant. Chaque tâche se coche par exercice. */
  M.REPETITIONS = { chaque_annee: "Chaque année", annee_suivante: "L'année prochaine seulement" };
  M.todos = (numero) => (S.db.todos || {})[numero] || [];
  /** Exercice (libellé et date de début) où la tâche apparaît pour la première fois. */
  const premierExercice = (exercice, repetition) => (repetition === "annee_suivante" ? exercice.decale(1) : exercice);
  M.todosPour = (numero, exercice) => {
    const actives = [], prevues = [];
    for (const t of M.todos(numero)) {
      const debut = t.depuis_debut;
      if (t.repetition === "annee_suivante" ? debut === exercice.debut : debut <= exercice.debut) actives.push(t);
      else if (debut > exercice.debut) prevues.push(t);
    }
    return { actives, prevues };
  };
  /** Lien d'un fichier : espaces et guillemets retirés (« Copier en tant que chemin d'accès » de Windows ajoute des guillemets). */
  M.nettoyerLien = (lien) => String(lien || "").trim().replace(/^"(.*)"$/, "$1").trim();
  /** Lien Office pour ouvrir directement un fichier d'un disque ou d'un partage réseau (X:\…, \\serveur\…)
      dans l'application de bureau : ms-excel:ofe|u|file:///X:/… ; null si le lien est web ou le type non géré. */
  M.OFFICE = { xlsx: "ms-excel", xlsm: "ms-excel", xls: "ms-excel", xlsb: "ms-excel", csv: "ms-excel",
    docx: "ms-word", docm: "ms-word", doc: "ms-word", pptx: "ms-powerpoint", ppt: "ms-powerpoint" };
  M.lienOffice = (chemin) => {
    chemin = M.nettoyerLien(chemin);
    if (!chemin || /^https?:\/\//i.test(chemin)) return null;
    const ext = (chemin.match(/\.([a-z0-9]+)$/i) || [])[1];
    const appli = ext && M.OFFICE[ext.toLowerCase()];
    if (!appli) return null;
    const url = chemin.startsWith("\\\\") ? "file:" + chemin.replace(/\\/g, "/") : "file:///" + chemin.replace(/\\/g, "/");
    return { appli, url: `${appli}:ofe|u|${encodeURI(url)}` };
  };
  /** Adresse utilisable dans un lien (bouton FICHIER COMPTA, to do) : web tel quel, fichier Office -> application de bureau,
      autre fichier ou dossier (X:\…, \\serveur\…) -> file:/// encodé. Un chemin brut serait lu comme relatif à index.html. */
  M.urlLien = (chemin) => {
    chemin = M.nettoyerLien(chemin);
    if (!chemin) return "";
    if (/^(https?|file):\/\//i.test(chemin)) return chemin;
    if (/^[a-z][a-z0-9+.-]*:/i.test(chemin) && !/^[a-z]:[\\/]/i.test(chemin)) return "#"; // autre protocole (javascript:…) refusé
    const office = M.lienOffice(chemin);
    if (office) return office.url;
    const url = chemin.startsWith("\\\\") ? "file:" + chemin.replace(/\\/g, "/") : "file:///" + chemin.replace(/\\/g, "/");
    return encodeURI(url).replace(/#/g, "%23");
  };
  M.ajouterTodo = (numero, exercice, texte, repetition, lien = "") => {
    texte = String(texte || "").trim();
    if (!texte) throw new Error("Saisissez la tâche.");
    if (!M.REPETITIONS[repetition]) repetition = "chaque_annee";
    const e = premierExercice(exercice, repetition);
    const t = { id: S.nouvelId(), texte, lien: M.nettoyerLien(lien), repetition, depuis: e.libelle, depuis_debut: e.debut, fait: {}, cree_le: U.horodatage(), cree_exercice: exercice.libelle };
    if (!S.db.todos) S.db.todos = {};
    (S.db.todos[numero] = S.db.todos[numero] || []).push(t);
    return t;
  };
  M.cocherTodo = (numero, id, exercice, fait) => {
    const t = M.todos(numero).find((x) => x.id === id);
    if (!t) return;
    if (fait) t.fait[exercice.libelle] = U.horodatage(); else delete t.fait[exercice.libelle];
  };
  M.modifierTodo = (numero, id, champs) => {
    const t = M.todos(numero).find((x) => x.id === id);
    if (!t) return;
    if (champs.texte !== undefined && String(champs.texte).trim()) t.texte = String(champs.texte).trim();
    if (champs.lien !== undefined) t.lien = M.nettoyerLien(champs.lien);
  };
  M.supprimerTodo = (numero, id) => {
    if (S.db.todos && S.db.todos[numero]) S.db.todos[numero] = S.db.todos[numero].filter((x) => x.id !== id);
  };

  /** Bloc « Honoraires syndic » de la synthèse : honoraires de l'exercice N (budget N du compte 62110300)
      et honoraires proposés, affichés en N+1 (même colonne que le budget N+2 du bloc budgets, qui sert aussi à mettre à jour N+1). Le compte 62110300 est en HT : TTC = HT × 1,2.
      Alerte si l'évolution est inférieure à 0,5 % (question au gestionnaire sur une augmentation). */
  M.SEUIL_ALERTE_HONORAIRES = 0.005;
  M.honorairesSynthese = (c, cn) => {
    const l = cn[M.COMPTE_HONORAIRES];
    const surface = String(c.lots_surface || "").toUpperCase() === "SURFACE";
    const q = Number(c.quantite) || null;
    const detail = (ht) => (ht === null || ht === undefined ? null : { ht, ttc: U.arrondi(ht * 1.2, 2), unite: q ? ht / q : null });
    const n = l ? detail(l.budget) : null, propose = l ? detail(l.budget_n1) : null;
    const ecart = n && propose ? U.arrondi(propose.ht - n.ht, 2) : null;
    const pct = ecart !== null && n.ht ? ecart / n.ht : null;
    return { n, propose, ecart, pct, unite: surface ? "m²" : "lot principal", quantite: q,
      alerte: pct !== null && Math.abs(pct) < M.SEUIL_ALERTE_HONORAIRES };
  };

  // ------------------------------------------------------------------ mandat de syndic (AG) : durée, révision annuelle des honoraires
  const ajouterMoisIso = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); const j = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(j, fin)); return d.toISOString().slice(0, 10); };
  /** Fin du mandat : date saisie, sinon début + durée (veille de la date anniversaire). */
  M.finMandat = (m) => {
    if (!m) return "";
    if (m.fin) return m.fin;
    if (!m.debut || !Number(m.duree_mois)) return "";
    const d = new Date(`${ajouterMoisIso(m.debut, Number(m.duree_mois))}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  /** Durée du mandat déduite des dates (début → lendemain de la fin), arrondie au mois ; sinon l'ancienne durée saisie. */
  M.dureeMandat = (m) => {
    if (!m) return null;
    if (m.debut && m.fin && m.fin > m.debut) {
      const a = new Date(`${m.debut}T12:00:00Z`), b = new Date(`${m.fin}T12:00:00Z`); b.setUTCDate(b.getUTCDate() + 1);
      return Math.round((b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + (b.getUTCDate() - a.getUTCDate()) / 30);
    }
    return Number(m.duree_mois) || null;
  };
  M.TOLERANCE_REVISION = 0.001; // 0,1 point
  /** Contrôle des honoraires de la synthèse au regard du mandat : révision N → N+1 conforme au % prévu, fin de mandat à renouveler.
      Fin « proche » : avant l'AG qui suivra la prochaine (≈ 18 mois après la clôture N), le renouvellement doit être voté à la prochaine AG. */
  M.controleMandat = (c, exo, honos, aujourdhui = U.aujourdhui()) => {
    const m = c.mandat;
    if (!m || (!m.debut && !m.fin && m.revision_pct === undefined)) return { renseigne: false };
    const fin = M.finMandat(m), pct = m.revision_pct === "" || m.revision_pct === null || m.revision_pct === undefined ? null : Number(m.revision_pct) / 100;
    const res = { renseigne: true, debut: m.debut || "", fin, duree_mois: M.dureeMandat(m), revision_pct: pct, modalites: m.modalites || "" };
    if (pct !== null && honos && honos.n && honos.propose && honos.n.ht) {
      res.attendu_ht = U.arrondi(honos.n.ht * (1 + pct), 2);
      res.ecart_revision = U.arrondi(honos.propose.ht - res.attendu_ht, 2);
      res.revision_reelle = honos.propose.ht / honos.n.ht - 1;
      const diff = res.revision_reelle - pct;
      res.statut_revision = Math.abs(diff) <= M.TOLERANCE_REVISION || Math.abs(res.ecart_revision) < 1 ? "conforme" : diff > 0 ? "au_dessus" : "en_dessous";
    }
    if (fin) {
      const limite = ajouterMoisIso(exo.fin, 18);
      res.expire = fin < aujourdhui;
      res.a_renouveler = !res.expire && fin <= limite;
      res.jours_restants = Math.round((Date.parse(fin) - Date.parse(aujourdhui)) / 864e5);
    }
    return res;
  };
  /** Messages du contrôle de mandat pour la synthèse : [{niveau: ok|attention|alerte, texte}]. */
  M.messagesMandat = (r) => {
    if (!r || !r.renseigne) return [];
    const pc = (x) => `${(x * 100).toFixed(1).replace(".", ",").replace(",0", "")} %`, eur = (x) => U.euro(x);
    const res = [];
    if (r.statut_revision === "conforme") res.push({ niveau: "ok", texte: `Révision conforme au mandat : ${pc(r.revision_reelle)} pour ${pc(r.revision_pct)} prévus.` });
    else if (r.statut_revision === "au_dessus") res.push({ niveau: "alerte", texte: `Honoraires N+1 au-dessus de la révision du mandat : ${pc(r.revision_reelle)} pour ${pc(r.revision_pct)} prévus (${eur(r.ecart_revision)} HT de plus que les ${eur(r.attendu_ht)} attendus).` });
    else if (r.statut_revision === "en_dessous") res.push({ niveau: "attention", texte: `Révision du mandat non appliquée en totalité : ${pc(r.revision_reelle)} pour ${pc(r.revision_pct)} prévus (manque ${eur(-r.ecart_revision)} HT pour atteindre ${eur(r.attendu_ht)}).` });
    if (r.expire) res.push({ niveau: "alerte", texte: `Mandat expiré depuis le ${U.jjmmaaaa(r.fin)} : renouvellement à faire voter en urgence.` });
    else if (r.a_renouveler) res.push({ niveau: "alerte", texte: `Fin de mandat le ${U.jjmmaaaa(r.fin)} : renouvellement à inscrire à l'ordre du jour de la prochaine AG.` });
    return res;
  };
  M.suggestionHonoraires = (c) => {
    const u = M.honosParUnite(c.honos_ttc, c.quantite);
    if (u === null) return "";
    return String(c.lots_surface).toUpperCase() === "LOTS" ? `${Math.round(u)} € HT / Lot` : `${u.toFixed(2).replace(".", ",")} € HT / m²`;
  };

  // ======================================================================== FACTURE MANUELLE
  M.totauxFacture = (type, lignes, taux) => {
    const somme = U.arrondi(lignes.filter((l) => l.designation).reduce((s, l) => s + v(l.pu) * v(l.qte), 0), 2);
    const t = v(taux) / 100;
    if (type === "APPEL DE FONDS") {
      const total = U.arrondi(somme * (1 + t), 2);
      return { total_ht: total, tva: U.arrondi(total - somme, 2), a_payer: total, libelle_total: "TOTAL", libelle_tva: "TVA pour information", libelle_payer: "À PAYER" };
    }
    const tva = U.arrondi(somme * t, 2);
    return { total_ht: somme, tva, a_payer: U.arrondi(somme + tva, 2), libelle_total: "TOTAL Hors Taxes", libelle_tva: "TVA",
      libelle_payer: type === "AVOIR" ? "EN VOTRE FAVEUR" : "À PAYER" };
  };
  /** '9215-0006' -> lignes nom / adresse (ex-CATALOGUE COPROPRIETAIRES) */
  M.destinataireCatalogue = (ref) => {
    const m = String(ref || "").match(/^\s*(\d{4})\s*-\s*(\d{1,4})\s*$/);
    if (!m) return null;
    const e = (S.db.catalogue[m[1]] || []).find((x) => x.numero === m[2].padStart(4, "0"));
    return e ? e.lignes.slice() : null;
  };
  // ------------------------------------------------------------------ numérotation et historique des factures
  /** Préfixe du numéro : référence copropriétaire (« 9215-0006 ») ; à défaut (destinataire manuel), n° de copro. */
  M.prefixeFacture = (f) => {
    const m = String(f.ref_destinataire || "").match(/^\s*(\d{4})\s*-\s*(\d{1,4})\s*$/);
    return !f.manuel && m ? `${m[1]}-${m[2].padStart(4, "0")}` : String(f.copro || "");
  };
  /** Prochain numéro chronologique (unique pour tout le cabinet, jamais réutilisé). */
  M.prochaineSequence = () => {
    const max = S.db.factures.reduce((m, r) => Math.max(m, Number(r.sequence) || 0), 0);
    return Math.max(Number(S.db.prochaine_facture) || 1, max + 1);
  };
  M.numeroFacture = (f, sequence) => `${M.prefixeFacture(f)}-${String(sequence).padStart(4, "0")}`;
  /** Enregistre la facture dans l'historique : numéro attribué à la première sauvegarde (puis conservé),
      et instantané des informations imprimées (copro, RIB, cabinet) pour ressortir le PDF à l'identique. */
  M.enregistrerFacture = (f, instantane) => {
    const existante = f.id ? S.db.factures.find((r) => r.id === f.id) : null;
    const sequence = existante && existante.sequence ? existante.sequence : M.prochaineSequence();
    const totaux = M.totauxFacture(f.type_doc, f.lignes, f.taux_tva);
    const r = { ...f, lignes: f.lignes.filter((l) => l.designation), sequence, numero: M.numeroFacture(f, sequence),
      total_ht: totaux.total_ht, tva: totaux.tva, total_ttc: totaux.a_payer, instantane, modifie_le: U.horodatage() };
    if (existante) Object.assign(existante, r);
    else { r.id = S.nouvelId(); r.cree_le = U.horodatage(); S.db.factures.push(r); S.db.prochaine_facture = sequence + 1; }
    S.sauver();
    return existante || r;
  };
  /** C18 (ancien classeur) : copro + destinataire + date jjmmaaaa si pas de n° manuel */
  M.numeroFactureDefaut = (copro, dest, d) => {
    const x = d || U.aujourdhui();
    return `${copro || ""} ${(dest && dest[0]) || ""} ${x.slice(8, 10)}${x.slice(5, 7)}${x.slice(0, 4)}`.replace(/\s+/g, " ").trim();
  };

  // ======================================================================== TABLEAU DE BORD / SUIVI DES SYNTHÈSES
  /** Portefeuille « rôle:prénom » (ex. « gestionnaire:Alice ») ; vide = tout le cabinet. */
  M.dansPortefeuille = (c, portefeuille) => {
    if (!portefeuille) return true;
    const [role, prenom] = portefeuille.split(":");
    return (c[role] || "") === prenom;
  };
  M.STATUTS_SYNTHESE = { a_faire: "À faire", en_cours: "Fiche sauvegardée", envoyee: "Mail préparé" };
  /** État de la synthèse d'une copro pour son dernier exercice clos (décalage 1 = exercice précédent). */
  /** Charges de l'exercice intégrées : extraction N importée après la clôture (avant, les charges sont incomplètes).
      Une synthèse émise ne compte comme faite qu'à cette condition. Import sans date (anciennes bases) : accepté. */
  M.chargesIntegrees = (c, exo) => {
    const b = S.db.budgets[`${c.numero}|${exo.libelle}`];
    if (!b) return false;
    const le = b.importe_le ? U.dateFr(String(b.importe_le).slice(0, 10)) : null;
    return !le || le >= exo.fin;
  };
  /** Clôture explicite de la synthèse (bouton « Clôturer la synthèse ») : la sort des synthèses à faire, quelles que soient les extractions ; rouvrir = false. */
  M.cloturerSynthese = (numero, exercice, oui = true) => {
    if (!S.db.syntheses_cloturees) S.db.syntheses_cloturees = {};
    const cle = `${numero}|${exercice}`;
    if (oui) S.db.syntheses_cloturees[cle] = { le: U.horodatage() }; else delete S.db.syntheses_cloturees[cle];
    S.sauver();
  };
  /** Depuis le 01/11/2026, seule la clôture (bouton « Clôturer la synthèse ») rend une synthèse faite. Les synthèses émises
      jusqu'au 31/10/2026 restent faites si leurs charges sont intégrées (règle précédente, anciennes synthèses inchangées). */
  M.CLOTURE_OBLIGATOIRE_DEPUIS = "2026-11-01";
  const emiseAvantCloture = (r) => !!(r && r.envoyee_le) && (U.dateFr(String(r.envoyee_le).slice(0, 10)) || "") < M.CLOTURE_OBLIGATOIRE_DEPUIS;
  M.emiseAncienneRegle = emiseAvantCloture;
  M.syntheseCloturee = (numero, exercice) => (S.db.syntheses_cloturees || {})[`${numero}|${exercice}`] || null;
  M.etatSynthese = (c, decalage = 0, reference) => {
    const exo = E.exerciceClos(c.exercice, reference).decale(-decalage);
    const cle = `${c.numero}|${exo.libelle}`;
    const r = S.db.syntheses[cle];
    const n1 = exo.decale(-1);
    const faite = (S.db.syntheses_faites || {})[cle];
    const manquants = [[exo, "N"], ...(M.estPremierExercice(c, exo) ? [] : [[n1, "N-1"]])].filter(([e]) => !S.db.budgets[`${c.numero}|${e.libelle}`]).map(([e, role]) => ({ exercice: e.libelle, role }));
    const chN = M.chargerBudget(c.numero, exo.libelle);
    const honos = chN ? M.honorairesSynthese(c, chN.comptes) : null;
    if (M.synchroTodoSousCompteurs && M.sousCompteurs(c).length) M.synchroTodoSousCompteurs(c, exo); // tâche cochée par le contrôle des écritures
    const todos = M.todosPour(c.numero, exo).actives;
    const bN = S.db.budgets[cle], chargesN = M.chargesIntegrees(c, exo), cloturee = M.syntheseCloturee(c.numero, exo.libelle);
    const emise = !!(r && r.envoyee_le), sansCharges = emise && !chargesN;
    return {
      copro: c, exercice: exo, cle, statut: cloturee || (emiseAvantCloture(r) && chargesN) || faite ? "envoyee" : r ? "en_cours" : "a_faire",
      cloturee_le: cloturee ? cloturee.le : "", emise_sans_charges: sansCharges && !faite && !cloturee, a_cloturer: emise && !cloturee && !faite && !(emiseAvantCloture(r) && chargesN), charges_n: chargesN, extraction_n_le: bN ? bN.importe_le || "" : "",
      fiche_le: r ? r.modifie_le || "" : "", envoyee_le: (r && r.envoyee_le) || (faite ? faite.le : ""), envoyee_a: (r && r.envoyee_a) || (faite ? "considérée comme faite" : ""),
      faite: !!faite && !(r && r.envoyee_le),
      manquants, exercice_renseigne: !!c.exercice, alerte_honoraires: !!(honos && honos.alerte),
      todos_ouvertes: todos.filter((t) => !t.fait[exo.libelle]), todos_total: todos.length,
    };
  };
  M.suiviSyntheses = (portefeuille = "", decalage = 0, reference) => S.copros().filter((c) => c.actif && M.dansPortefeuille(c, portefeuille))
    .map((c) => M.etatSynthese(c, decalage, reference))
    .sort((a, b) => a.exercice.fin.localeCompare(b.exercice.fin) || a.copro.numero.localeCompare(b.copro.numero));
  M.compterSuivi = (lignes) => {
    const n = { total: lignes.length, a_faire: 0, en_cours: 0, envoyee: 0, manquants: 0, sans_exercice: 0, todos: 0 };
    for (const l of lignes) { n[l.statut]++; if (l.manquants.length && l.statut !== "envoyee") n.manquants++; if (!l.exercice_renseigne) n.sans_exercice++; n.todos += l.todos_ouvertes.length; }
    return n;
  };

  // ======================================================================== HISTORIQUE ET HONORAIRES
  const evolution = (a, b) => (a === null || a === undefined || !b ? null : a / b - 1);
  /** Historique pluriannuel d'une copro d'après les extractions « budget / charges » importées (du plus récent au plus ancien) :
      budget, charges, budget proposé, honoraires HT (compte 62110300) et leurs évolutions d'un exercice à l'autre. */
  M.historiqueCopro = (c) => {
    const q = Number(c.quantite) || null;
    const lignes = Object.values(S.db.budgets).filter((b) => b.copro === c.numero).map((b) => {
      const t = M.totauxCourants(b) || {};
      const hon = b.lignes.find((l) => l.compte === M.COMPTE_HONORAIRES) || {};
      const r = S.db.syntheses[`${c.numero}|${b.exercice}`];
      return { exercice: b.exercice, date_fin: b.date_fin || "", budget: t.budget ?? null, charges: t.charges ?? null, propose: t.budget_n1 ?? null,
        honos_ht: hon.budget ?? null, honos_propose: hon.budget_n1 ?? null, honos_unite: hon.budget && q ? hon.budget / q : null,
        synthese: r ? (r.envoyee_le ? "envoyee" : "en_cours") : "" };
    }).sort((a, b) => (b.date_fin || b.exercice).localeCompare(a.date_fin || a.exercice));
    lignes.forEach((l, i) => {
      const prec = lignes[i + 1];
      l.ecart_budget = l.charges !== null && l.budget ? l.charges / l.budget - 1 : null;
      l.evol_charges = prec ? evolution(l.charges, prec.charges) : null;
      l.evol_honos = prec ? evolution(l.honos_ht, prec.honos_ht) : null;
    });
    return lignes;
  };
  /** Nombre d'exercices consécutifs sans hausse des honoraires (évolution < 0,5 %), en partant du budget proposé. */
  M.anneesSansHausse = (historique) => {
    const h0 = historique[0];
    if (!h0) return 0;
    const suite = [h0.honos_propose, ...historique.map((l) => l.honos_ht)].filter((v) => v !== null && v !== undefined);
    let n = 0;
    for (let i = 0; i + 1 < suite.length; i++) { if (!suite[i + 1] || suite[i] / suite[i + 1] - 1 >= M.SEUIL_ALERTE_HONORAIRES) break; n++; }
    return n;
  };
  const mediane = (v) => { const s = v.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  /** Honoraires à revoir : copros actives dont les honoraires proposés n'augmentent pas (< 0,5 %), sans hausse depuis 2 exercices ou plus,
      ou dont le HT par lot (ou par m²) est nettement sous la médiane des copros du même type et de la même unité. */
  M.SEUIL_SOUS_MEDIANE = 0.85;
  M.honorairesARevoir = (portefeuille = "") => {
    const toutes = S.copros().filter((c) => c.actif).map((c) => {
      const hist = M.historiqueCopro(c);
      const d = hist[0];
      const lots = String(c.lots_surface || "LOTS").toUpperCase() !== "SURFACE";
      const groupe = `${c.type || "(non renseigné)"}|${lots ? "lot" : "m²"}`;
      return { copro: c, hist, dernier: d || null, lots, groupe, unite: d && d.honos_propose && Number(c.quantite) ? d.honos_propose / Number(c.quantite) : (d ? d.honos_unite : null),
        evolution: d ? evolution(d.honos_propose, d.honos_ht) : null, sans_hausse: M.anneesSansHausse(hist) };
    }).filter((x) => x.dernier && x.dernier.honos_ht);
    // médiane par groupe (même type de copro, même unité), à partir de 3 copros
    const medianes = {};
    for (const g of new Set(toutes.map((x) => x.groupe))) {
      const vals = toutes.filter((x) => x.groupe === g && x.copro.type).map((x) => x.unite).filter((u) => u !== null);
      if (vals.length >= 3) medianes[g] = { mediane: mediane(vals), n: vals.length };
    }
    return {
      medianes,
      lignes: toutes.filter((x) => M.dansPortefeuille(x.copro, portefeuille)).map((x) => {
        const med = x.copro.type && medianes[x.groupe] ? medianes[x.groupe].mediane : null;
        return { ...x, mediane: med,
          alerte: x.evolution !== null && Math.abs(x.evolution) < M.SEUIL_ALERTE_HONORAIRES,
          sous_mediane: !!(med && x.unite !== null && x.unite < med * M.SEUIL_SOUS_MEDIANE),
          ecart_mediane: med && x.unite !== null ? x.unite / med - 1 : null };
      }).filter((x) => x.alerte || x.sans_hausse >= 2 || x.sous_mediane)
        .sort((a, b) => b.sans_hausse - a.sans_hausse || (a.ecart_mediane ?? 0) - (b.ecart_mediane ?? 0)),
    };
  };

  // ======================================================================== COPRO PERDUE
  /** Copro perdue (mandat non renouvelé, changement de syndic…) : conservée avec son historique, mais inactive
      et donc hors tableau de bord, suivi des synthèses, honoraires et vérification. */
  M.MOTIFS_PERTE = ["Changement de syndic (vote en AG)", "Non-renouvellement du mandat", "Résiliation du mandat", "Fusion / fin de la copropriété", "Autre"];
  M.marquerPerdue = (c, { le, motif = "", commentaire = "" } = {}) => {
    c.perdue = { le: le || U.aujourdhui(), motif, commentaire, saisie_le: U.horodatage() };
    c.actif = false;
    c.a_verifier = false;
    c.modifie_le = U.horodatage();
    S.sauver();
  };
  M.annulerPerdue = (c) => {
    delete c.perdue;
    c.actif = true;
    c.modifie_le = U.horodatage();
    S.sauver();
  };
  M.coprosPerdues = (depuis = "") => S.copros().filter((c) => c.perdue && (!depuis || c.perdue.le >= depuis)).sort((a, b) => b.perdue.le.localeCompare(a.perdue.le));

  // ======================================================================== VÉRIFICATION DES FICHES DÉDUITES
  /** Informations déduites automatiquement d'après l'origine de la fiche (pour les mettre en évidence). */
  M.champsDeduits = (c) => {
    const o = String(c.origine || "");
    const res = new Set();
    if (/exercice déduit/.test(o)) res.add("exercice");
    if (/honoraires déduits/.test(o)) res.add("honos_ttc");
    if (/adresse déduite/.test(o)) { res.add("adresse"); res.add("code_postal"); res.add("ville"); }
    if (/type déduit/.test(o) || (c.type && /^(ASL|AFUL)$/.test(c.type) && /Liste des copros ICS/.test(o))) res.add("type");
    if (/inactivité déduite/.test(o)) res.add("actif");
    if (/portefeuille/i.test(o)) { res.add("comptable"); res.add("gestionnaire"); }
    return res;
  };
  /** Champs encore vides sur une fiche active (utiles à la synthèse et aux honoraires). */
  M.champsManquants = (c) => ["type", "nom", "comptable", "gestionnaire", "exercice", "lots_surface", "quantite", "honos_ttc"]
    .filter((k) => c[k] === null || c[k] === undefined || c[k] === "");
  M.fichesAVerifier = (portefeuille = "") => S.copros().filter((c) => c.a_verifier && M.dansPortefeuille(c, portefeuille))
    .sort((a, b) => (b.actif - a.actif) || a.numero.localeCompare(b.numero));
  M.validerFiche = (c, champs = {}) => {
    Object.assign(c, champs);
    if (M.appliquerRegles) M.appliquerRegles(c);
    c.a_verifier = false;
    c.verifiee_le = U.horodatage();
    c.modifie_le = U.horodatage();
    S.sauver();
  };

  K.M = Object.assign(K.M || {}, M);
})(globalThis.K = globalThis.K || {});
