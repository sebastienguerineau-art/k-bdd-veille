/* Analyses : charges par poste (le premier préfixe qui correspond l'emporte), fiabilité des budgets, comparaison au lot, points d'attention,
   pilotage du cabinet et énergie (décret tertiaire). Tout est calculé à partir des extractions déjà importées. */
(function (K) {
  "use strict";
  const U = K.U, E = K.E, S = K.S, M = K.M;
  const v = (x) => (x === null || x === undefined ? 0 : Number(x) || 0);

  // ------------------------------------------------------------------ postes (plan comptable des copropriétés, 3 premiers chiffres)
  const POSTES = [
    ["601", "Eau"], ["602", "Électricité"], ["603", "Chauffage, énergie"], ["604", "Produits et petit équipement"], ["605", "Produits et petit équipement"],
    ["606", "Produits et petit équipement"], ["611", "Nettoyage"], ["612", "Locations"], ["613", "Locations"], ["614", "Contrats d'entretien"],
    ["615", "Entretien et réparations"], ["616", "Assurances"],
    // rémunération du syndic (621) : honoraires de base TTC (HT + TVA), frais postaux / débours, honoraires particuliers
    ["621103", "Honoraires du syndic (TTC)"], ["621104", "Honoraires du syndic (TTC)"], ["6213", "Frais postaux et débours"],
    ["621", "Honoraires particuliers du syndic"], ["622", "Autres honoraires"], ["623", "Tiers intervenants"],
    ["624", "Conseil syndical"], ["63", "Impôts et taxes"], ["64", "Personnel"], ["66", "Frais financiers"], ["67", "Travaux et exceptionnel"],
    ["7", "Produits et remboursements"],
  ];
  M.posteDe = (compte) => {
    const c = String(compte || "");
    for (const [p, lib] of POSTES) if (c.startsWith(p)) return lib;
    return c.startsWith("6") ? "Autres charges" : "Autres";
  };

  /** Charges et budget par poste pour un exercice importé (null si pas d'extraction). */
  M.postesExercice = (numero, exercice) => {
    const b = S.db.budgets[`${numero}|${exercice}`];
    if (!b) return null;
    const res = {};
    const vus = new Set();
    for (const l of b.lignes) {
      if (!l.compte || vus.has(l.compte) || M.estTravaux(M.reperageTravaux(b) && l)) continue; // un compte peut apparaître sous plusieurs clés : une seule fois ; travaux à part
      vus.add(l.compte);
      const p = M.posteDe(l.compte);
      const x = res[p] = res[p] || { charges: 0, budget: 0 };
      x.charges += v(l.charges); x.budget += v(l.budget);
    }
    const t = M.totauxCourants(b);
    return { postes: res, charges: t ? v(t.charges) : Object.values(res).reduce((s, x) => s + x.charges, 0),
      budget: t ? v(t.budget) : Object.values(res).reduce((s, x) => s + x.budget, 0) };
  };

  const ratio = (a, b) => (b ? a / b - 1 : null);
  const mediane = (vals) => {
    const s = vals.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  M.mediane = mediane;

  // ------------------------------------------------------------------ contrats (comptes 611 nettoyage et 614 entretien), regroupés par nature d'après le libellé
  const FAMILLES_CONTRAT = [ // l'ordre compte : la première famille reconnue l'emporte
    [/ASCENSEUR|ELEVATEUR|MONTE.?CHARGE/, "Ascenseurs"],
    [/INCENDIE|DESENFUMAGE|EXTINCTEUR|\bSSI\b|SPRINKLER|EVACUATION/, "Sécurité incendie"],
    [/PARKING|\bPKG\b/, "Parkings"],
    [/ACCUEIL|GARDIEN|CONCIERGE|RESPONSABLE UNIQUE|\bRUS\b|SURVEILLANCE|GARDIENNAGE/, "Accueil, gardiennage, sécurité"],
    [/MENAGE|NETTOYAGE|REPURGATION|PARTIES COMMUNES|SANITAIRE|HALL|ABORDS|ESCALIER|PALIER|VITRERIE|HYGIENE|CENDRIER/, "Ménage et nettoyage"],
    [/DECHET|CONTAINER|CONTENEUR|COLLECTE|CARTON|\bO\.?M\b|ORDURES/, "Déchets, containers"],
    [/ESPACES? VERTS?|JARDIN|ELAGAGE|ARROSAGE/, "Espaces verts"],
    [/\bCVC\b|CHAUDIERE|CHAUFFAGE|CHAUFFERIE|\bP[23]\b|EAU CHAUDE|\bECS\b|\bCET\b|\bPAC\b|THERMODYNAMIQUE|CLIMATISATION|\bCTA\b/, "Chauffage, climatisation (CVC)"],
    [/VMC|VENTILATION|EXTRACTEUR/, "Ventilation / VMC"],
    [/MULTITECHNIQUE|MULTI.?TECHNIQUE|MAINTENANCE TECHNIQUE/, "Maintenance multitechnique"],
    [/PORTAIL|PORTE|BARRIERE|INTERPHONE|CONTROLE D.?ACCES|VIDEO/, "Portes, portails, accès"],
    [/TOITURE|TERRASSE|GOUTTIERE/, "Toitures"],
    [/RESEAU|CANALISATION|ASSAINISSEMENT|POMPE|RELEVAGE|SURPRESSEUR|COLONNE|DEBOUCHAGE|CURAGE|HYDROCARBURE|BASSIN/, "Réseaux, pompes, bassins"],
    [/COMPTEUR/, "Compteurs (relevés, location)"],
    [/VERIF|CONTROLE|REGLEMENTAIRE|INSTALL.*ELECTRI/, "Contrôles réglementaires"],
    [/DERATISATION|DESINSECT|DESINFECT|NUISIBLE/, "Dératisation, désinsectisation"],
    [/GROUPE ELECTROGENE|ELECTRICITE|ECLAIRAGE/, "Électricité, éclairage"],
    [/\bASL\b|\bAFUL\b|SYNDICAT PRINCIPAL/, "Charges ASL / AFUL"],
  ];

  M.familleContrat = (libelle) => {
    const n = U.normaliser(libelle);
    for (const [re, fam] of FAMILLES_CONTRAT) if (re.test(n)) return fam;
    return "Autres contrats";
  };
  /** Contrats d'entretien d'un exercice par nature : budget, charges et comptes qui les composent. */
  M.contratsExercice = (numero, exercice) => {
    const b = S.db.budgets[`${numero}|${exercice}`];
    if (!b) return null;
    const res = {}, vus = new Set();
    for (const l of b.lignes) {
      if (!l.compte || !/^61[14]/.test(l.compte) || vus.has(l.compte)) continue; // nettoyage (611) et contrats d'entretien (614)
      vus.add(l.compte);
      const f = M.familleContrat(l.libelle);
      const x = res[f] = res[f] || { charges: 0, budget: 0, comptes: [] };
      x.charges += v(l.charges); x.budget += v(l.budget); x.comptes.push(l.compte);
    }
    return res;
  };

  // ------------------------------------------------------------------ points d'attention (anomalies) entre N et N-1
  M.SEUIL_ANOMALIE = 1000;
  M.anomalies = (numero, exercice) => {
    const b = M.chargerBudget(numero, exercice.libelle), b1 = M.chargerBudget(numero, exercice.decale(-1).libelle);
    if (!b) return [];
    const cn = b.comptes, cn1 = b1 ? b1.comptes : {};
    const res = [];
    for (const k of new Set([...Object.keys(cn), ...Object.keys(cn1)])) {
      if (!k.startsWith("6")) continue;
      const l = cn[k], l1 = cn1[k];
      const ch = v(l && l.charges), bu = v(l && l.budget), ch1 = v(l1 && l1.charges);
      const lib = (l || l1).libelle;
      let a = null;
      if (b1 && ch1 >= M.SEUIL_ANOMALIE && !ch) a = { type: "disparu", texte: `aucune charge cette année (N-1 : ${U.euro(ch1)})`, poids: ch1 };
      else if (!bu && ch >= M.SEUIL_ANOMALIE / 2) a = { type: "sans_budget", texte: `${U.euro(ch)} de charges sans budget`, poids: ch };
      else if (b1 && ch1 > 0 && ch >= 2 * ch1 && ch - ch1 >= M.SEUIL_ANOMALIE) a = { type: "double", texte: `× ${U.nombre(ch / ch1, 1)} par rapport à N-1 (${U.euro(ch1)} → ${U.euro(ch)})`, poids: ch - ch1 };
      else if (b1 && !ch1 && ch >= M.SEUIL_ANOMALIE) a = { type: "nouveau", texte: `nouveau poste : ${U.euro(ch)} (rien en N-1)`, poids: ch };
      else if (bu > 0 && ch >= 1.5 * bu && ch - bu >= M.SEUIL_ANOMALIE) a = { type: "depassement", texte: `budget dépassé de ${U.pct(ch / bu - 1)} (${U.euro(bu)} → ${U.euro(ch)})`, poids: ch - bu };
      if (a) res.push({ compte: k, libelle: lib, ...a });
    }
    return res.sort((x, y) => y.poids - x.poids);
  };
  M.TYPES_ANOMALIE = { disparu: "Poste disparu", sans_budget: "Sans budget", double: "Doublement", nouveau: "Nouveau poste", depassement: "Budget dépassé" };

  // ------------------------------------------------------------------ référentiel du cabinet (charges au lot)
  let cacheRef = null;
  /** Charges au lot (ou au m²) du dernier exercice importé de chaque copro active, par poste ; médianes par type de copro. */
  M.referentielCabinet = () => {
    const cle = S.db.modifie_le + "|" + Object.keys(S.db.budgets).length;
    if (cacheRef && cacheRef.cle === cle) return cacheRef;
    const copros = [];
    for (const c of S.copros()) {
      const q = Number(c.quantite);
      if (!c.actif || !q) continue;
      const ex = M.historiqueCopro(c).find((l) => l.charges);
      if (!ex) continue;
      const p = M.postesExercice(c.numero, ex.exercice);
      const parLot = {};
      for (const [k, x] of Object.entries(p.postes)) parLot[k] = x.charges / q;
      const contratsLot = {};
      for (const [f, x] of Object.entries(M.contratsExercice(c.numero, ex.exercice) || {})) if (x.charges > 0) contratsLot[f] = x.charges / q;
      copros.push({ copro: c, type: c.type || "(non renseigné)", unite: M.uniteCopro(c), groupe: M.groupeComparaison(c), exercice: ex.exercice,
        total_lot: p.charges / q, postes_lot: parLot, contrats_lot: contratsLot });
    }
    // comparaison uniquement entre copros du même type ET de la même unité (COPRO HAB au lot, COPRO IE au m²…)
    const parType = {};
    for (const x of copros) (parType[x.groupe] = parType[x.groupe] || []).push(x);
    const medianes = {};
    for (const [t, liste] of Object.entries(parType)) {
      const postes = {};
      for (const k of new Set(liste.flatMap((x) => Object.keys(x.postes_lot)))) postes[k] = mediane(liste.map((x) => x.postes_lot[k] ?? 0));
      // contrats : médiane parmi les copros qui ont ce type de contrat
      const contrats = {};
      for (const f of new Set(liste.flatMap((x) => Object.keys(x.contrats_lot)))) {
        const vals = liste.map((x) => x.contrats_lot[f]).filter((y) => y);
        if (vals.length >= M.MIN_COMPARAISON) contrats[f] = { mediane: mediane(vals), n: vals.length };
      }
      medianes[t] = { n: liste.length, total_lot: mediane(liste.map((x) => x.total_lot)), postes, contrats };
    }
    cacheRef = { cle, copros, medianes };
    return cacheRef;
  };
  M.MIN_COMPARAISON = 3; // nombre minimal de copros du même type pour comparer
  /** Unité de comparaison : « lot » (lots principaux) ou « m² » selon la fiche. */
  M.uniteCopro = (c) => (String(c.lots_surface || "").toUpperCase() === "SURFACE" ? "m²" : "lot");
  /** Groupe de comparaison : même type de copro et même unité (ex. « COPRO IE|m² »). */
  M.groupeComparaison = (c) => `${c.type || "(non renseigné)"}|${M.uniteCopro(c)}`;

  // ------------------------------------------------------------------ analyse d'une copro (page 2 de la synthèse, page Analyses)
  M.analyseCopro = (c, exo, nbExercices = 5) => {
    const exercices = [];
    for (let i = nbExercices - 1; i >= 0; i--) {
      const e = exo.decale(-i);
      const p = M.postesExercice(c.numero, e.libelle);
      if (p) exercices.push({ exercice: e.libelle, ...p });
    }
    const dernier = exercices[exercices.length - 1];
    const precedent = exercices.length > 1 ? exercices[exercices.length - 2] : null;
    const cles = new Set(exercices.flatMap((x) => Object.keys(x.postes)));
    const postes = [...cles].map((p) => {
      const valeurs = exercices.map((x) => (x.postes[p] ? x.postes[p].charges : null));
      const n = dernier && dernier.exercice === exo.libelle && dernier.postes[p] ? dernier.postes[p].charges : null;
      const n1 = precedent && precedent.postes[p] ? precedent.postes[p].charges : null;
      return { poste: p, valeurs, n, n1, evol: n !== null && n1 ? ratio(n, n1) : null };
    }).filter((x) => x.valeurs.some((y) => y)).sort((a, b) => Math.abs(v(b.n)) - Math.abs(v(a.n)) || Math.abs(v(b.n1)) - Math.abs(v(a.n1)));

    // fiabilité : écart charges / budget par exercice, postes sous-estimés plusieurs années de suite
    const fiabilite = exercices.map((x) => ({ exercice: x.exercice, charges: x.charges, budget: x.budget, ecart: x.budget ? x.charges / x.budget - 1 : null }));
    const sousEstimes = [];
    for (const p of cles) {
      if (p.startsWith("Produits")) continue;
      let n = 0;
      for (let i = exercices.length - 1; i >= 0; i--) {
        const x = exercices[i].postes[p];
        if (x && x.budget > 0 && x.charges > x.budget * 1.1 && x.charges - x.budget >= 500) n++; else break;
      }
      if (n >= 2) sousEstimes.push({ poste: p, annees: n });
    }

    // comparaison au lot / au m² (copros du même type et de la même unité uniquement)
    const ref = M.referentielCabinet();
    const q = Number(c.quantite);
    const lots = true; // lots ou m² : la comparaison se fait toujours dans le même groupe (type + unité)
    const unite = M.uniteCopro(c);
    const med = c.type ? ref.medianes[M.groupeComparaison(c)] : null;
    let comparaison = null;
    if (dernier && q && lots && med && med.n >= M.MIN_COMPARAISON) {
      comparaison = { type: c.type, unite, n: med.n, total_lot: dernier.charges / q, mediane_total: med.total_lot,
        postes: postes.filter((x) => x.n && !x.poste.startsWith("Produits")).slice(0, 7).map((x) => ({ poste: x.poste, lot: x.n / q, mediane: med.postes[x.poste] ?? null })) };
    }
    // principaux contrats d'entretien : N, N-1, budget N, par lot et médiane du cabinet
    const cN = M.contratsExercice(c.numero, exo.libelle), cN1 = M.contratsExercice(c.numero, exo.decale(-1).libelle) || {};
    const contrats = cN ? Object.entries(cN).map(([f, x]) => ({ famille: f, charges: x.charges, budget: x.budget, n1: cN1[f] ? cN1[f].charges : null,
      evol: cN1[f] && cN1[f].charges ? x.charges / cN1[f].charges - 1 : null, lot: q && lots ? x.charges / q : null,
      mediane: med && med.contrats && med.contrats[f] && q && lots ? med.contrats[f].mediane : null, comptes: x.comptes.length }))
      .filter((x) => x.charges || x.budget).sort((a2, b2) => b2.charges - a2.charges) : [];
    const totalContrats = contrats.reduce((t, x) => t + x.charges, 0);
    const anomalies = M.anomalies(c.numero, exo);
    return { pv: M.bilanPv ? M.bilanPv(c, exo) : null, soldes: M.soldesCopro ? M.soldesCopro(c) : null, energie: M.consoExercices ? M.consoExercices(c, exo) : [],
      courbes: M.courbesPuissanceCopro ? M.courbesPuissanceCopro(c, exo.debut, exo.fin) : [],
      puissances: M.contratPdl && M.pdlCopro ? M.pdlCopro(c).pdl.map((p) => ({ rae: p.rae, site: p.reference || p.site, ...M.contratPdl(p.rae) })).filter((x) => x.ps) : [], exercices: exercices.map((x) => x.exercice), totaux: exercices.map((x) => ({ exercice: x.exercice, charges: x.charges, budget: x.budget })),
      postes, fiabilite, sous_estimes: sousEstimes, comparaison, anomalies, contrats, total_contrats: totalContrats, unite, type: c.type || "",
      raison_comparaison: comparaison ? "" : !c.type ? "type de copro non renseigné dans la fiche" : !q ? `nombre de ${unite === "m²" ? "m²" : "lots"} non renseigné dans la fiche`
        : !dernier ? "extraction de l'exercice manquante" : `moins de ${M.MIN_COMPARAISON} copros « ${c.type} » (${unite === "m²" ? "au m²" : "au lot"}) à comparer` };
  };

  /** Options de la page 2 : chaque analyse n'est proposée que si elle a de quoi s'appuyer, et cochée d'office si elle est parlante. */
  M.OPTIONS_ANALYSE = { postes: "Évolution des charges par poste", contrats: "Principaux contrats d'entretien", fiabilite: "Fiabilité du budget",
    comparaison: "Comparaison au cabinet", energie: "Consommations d'électricité", puissance: "Puissance max des compteurs", pv: "Production photovoltaïque", anomalies: "Points d'attention", soldes: "Soldes des copropriétaires" };
  M.pertinenceAnalyse = (a) => ({
    postes: a.exercices.length >= 2 ? { dispo: true, conseil: a.postes.some((x) => x.evol !== null && Math.abs(x.evol) >= 0.2 && Math.abs(v(x.n) - v(x.n1)) >= 1000), info: `${a.exercices.length} exercices importés` }
      : { dispo: false, info: "un seul exercice importé" },
    fiabilite: a.exercices.length >= 2 ? { dispo: true, conseil: a.sous_estimes.length > 0 || a.fiabilite.filter((x) => x.ecart !== null && Math.abs(x.ecart) >= 0.1).length >= 2,
      info: a.sous_estimes.length ? `${a.sous_estimes.length} poste(s) sous-estimé(s) plusieurs années` : `${a.fiabilite.length} exercices comparés` }
      : { dispo: false, info: "un seul exercice importé" },
    comparaison: a.comparaison ? { dispo: true, conseil: Math.abs(a.comparaison.total_lot / a.comparaison.mediane_total - 1) >= 0.2,
      info: `${U.euro(a.comparaison.total_lot)} / ${a.comparaison.unite}, médiane ${U.euro(a.comparaison.mediane_total)} (${a.comparaison.n} copros ${a.comparaison.type})` }
      : { dispo: false, info: a.raison_comparaison },
    contrats: a.contrats.length ? { dispo: true,
      conseil: a.contrats.some((x) => (x.evol !== null && Math.abs(x.evol) >= 0.15 && Math.abs(x.charges - (x.n1 || 0)) >= 500) || (x.mediane && x.lot / x.mediane - 1 >= 0.3 && x.charges >= 1000)),
      info: `${a.contrats.length} type(s) de contrat · ${U.euro(a.total_contrats)}` } : { dispo: false, info: "aucun contrat (comptes 611 / 614)" },
    energie: (a.energie || []).length ? (() => { const d = a.energie[a.energie.length - 1];
      const alerte = (a.puissances || []).filter((x) => x.avis && x.avis !== "ok").length;
      return { dispo: true, conseil: (d.evol !== null && Math.abs(d.evol) >= 0.15) || alerte > 0, info: `${U.nombre(d.kwh, 0)} kWh sur ${d.exercice}${d.evol !== null ? ` (${U.pct(d.evol)})` : ""}${d.exact ? "" : " · estimé au prorata des synthèses EDF"}${alerte ? ` · ${alerte} puissance(s) à revoir` : ""}` }; })()
      : { dispo: false, info: "pas de compteur EDF rattaché ou pas de synthèse EDF sur l'exercice" },
    puissance: (a.courbes || []).length ? { dispo: true, conseil: a.courbes.some((x) => x.avis !== "ok"),
      info: `${a.courbes.length} compteur(s) > 36 kVA${a.courbes.some((x) => x.avis === "depassement") ? " · dépassement" : a.courbes.some((x) => x.avis === "proche") ? " · proche du max" : ""}` }
      : { dispo: false, info: "pas de compteur > 36 kVA (puissance max non communiquée par EDF en dessous)" },
    pv: a.pv ? { dispo: true, conseil: true, info: `${U.nombre(a.pv.production, 0)} kWh produits · ${a.pv.mode_libelle.toLowerCase()}` }
      : { dispo: false, info: "pas de process « Panneaux Photovoltaïques » ou reporting SBM non importé" },
    anomalies: a.anomalies.length ? { dispo: true, conseil: true, info: `${a.anomalies.length} point(s) relevé(s)` } : { dispo: false, info: "rien de notable" },
    soldes: a.soldes && a.soldes.nb ? { dispo: true, conseil: a.soldes.total >= 1000 || a.soldes.med > 0,
      info: `${a.soldes.nb} débiteur(s) · ${U.euro(a.soldes.total)}${a.soldes.med ? ` · ${a.soldes.med} mise(s) en demeure` : ""} (balance du ${U.jjmmaaaa(a.soldes.date)})` }
      : { dispo: false, info: a.soldes ? "aucun copropriétaire débiteur dans la balance" : "pas de balance (RESSOURCES\\BALANCES)" },
  });
  const OPTIONS_RECENTES = new Set(["pv"]);
  M.optionsAnalyse = (fiche, a) => {
    const pert = M.pertinenceAnalyse(a);
    const choix = fiche && fiche.analyses;
    const res = {};
    // option apparue après l'enregistrement de la fiche (production photovoltaïque) : recommandation automatique
    for (const k of Object.keys(M.OPTIONS_ANALYSE)) res[k] = pert[k].dispo && (choix && (k in choix || !OPTIONS_RECENTES.has(k)) ? !!choix[k] : pert[k].conseil);
    return res;
  };

  // ------------------------------------------------------------------ pilotage du cabinet
  M.pilotageCabinet = (portefeuille = "") => {
    const actives = S.copros().filter((c) => c.actif && M.dansPortefeuille(c, portefeuille));
    const suivi = M.suiviSyntheses(portefeuille);
    const parCle = Object.fromEntries(suivi.map((l) => [l.copro.numero, l]));
    const honosHt = (c) => M.honosHt(c.honos_ttc) || 0;
    const personnes = [];
    for (const role of ["comptable", "gestionnaire", "assistante"]) {
      for (const p of S.personnes(role)) {
        const cs = actives.filter((c) => c[role] === p.prenom);
        if (!cs.length) continue;
        const st = { a_faire: 0, en_cours: 0, envoyee: 0 };
        cs.forEach((c) => { if (parCle[c.numero]) st[parCle[c.numero].statut]++; });
        personnes.push({ role, prenom: p.prenom, nom: p.nom, copros: cs.length, lots: cs.reduce((s, c) => s + (String(c.lots_surface).toUpperCase() === "LOTS" ? v(c.quantite) : 0), 0),
          honoraires: cs.reduce((s, c) => s + honosHt(c), 0), ...st });
      }
    }
    // honoraires issus des budgets : N (dernier importé) et proposés
    let hN = 0, hP = 0, nb = 0;
    for (const c of actives) {
      const d = M.historiqueCopro(c)[0];
      if (d && d.honos_ht && d.honos_propose) { hN += d.honos_ht; hP += d.honos_propose; nb++; }
    }
    const perdues = S.copros().filter((c) => c.perdue && M.dansPortefeuille(c, portefeuille));
    const parAn = {};
    for (const c of perdues) {
      const a = c.perdue.le.slice(0, 4);
      const x = parAn[a] = parAn[a] || { annee: a, nb: 0, honoraires: 0, motifs: {} };
      x.nb++; x.honoraires += honosHt(c); x.motifs[c.perdue.motif || "Autre"] = (x.motifs[c.perdue.motif || "Autre"] || 0) + 1;
    }
    return { copros: actives.length, lots: actives.reduce((s, c) => s + (String(c.lots_surface).toUpperCase() === "LOTS" ? v(c.quantite) : 0), 0),
      honoraires: actives.reduce((s, c) => s + honosHt(c), 0), sans_honoraires: actives.filter((c) => !c.honos_ttc).length,
      honos_budgets: { n: hN, propose: hP, copros: nb, evol: hN ? hP / hN - 1 : null },
      personnes, perdues: Object.values(parAn).sort((a, b) => b.annee.localeCompare(a.annee)), liste_perdues: perdues };
  };

  /** Évolution des charges du portefeuille par poste : somme sur les copros ayant les deux derniers exercices importés. */
  M.evolutionPortefeuille = (portefeuille = "") => {
    const n = {}, n1 = {};
    let copros = 0;
    for (const c of S.copros()) {
      if (!c.actif || !M.dansPortefeuille(c, portefeuille)) continue;
      const hist = M.historiqueCopro(c);
      if (hist.length < 2 || !hist[0].charges || !hist[1].charges) continue;
      const a = M.postesExercice(c.numero, hist[0].exercice), b = M.postesExercice(c.numero, hist[1].exercice);
      copros++;
      for (const [k, x] of Object.entries(a.postes)) n[k] = (n[k] || 0) + x.charges;
      for (const [k, x] of Object.entries(b.postes)) n1[k] = (n1[k] || 0) + x.charges;
    }
    const postes = [...new Set([...Object.keys(n), ...Object.keys(n1)])].filter((p) => !p.startsWith("Produits"))
      .map((p) => ({ poste: p, n: n[p] || 0, n1: n1[p] || 0, evol: n1[p] ? (n[p] || 0) / n1[p] - 1 : null }))
      .filter((x) => x.n || x.n1).sort((a, b) => b.n - a.n);
    const tn = postes.reduce((s, x) => s + x.n, 0), tn1 = postes.reduce((s, x) => s + x.n1, 0);
    return { copros, postes, total: { n: tn, n1: tn1, evol: tn1 ? tn / tn1 - 1 : null } };
  };

  /** Contrats d'entretien du portefeuille par nature : dernier exercice vs précédent (copros ayant les deux), nombre de copros concernées. */
  M.contratsPortefeuille = (portefeuille = "") => {
    const res = {};
    for (const c of S.copros()) {
      if (!c.actif || !M.dansPortefeuille(c, portefeuille)) continue;
      const hist = M.historiqueCopro(c);
      if (!hist.length || !hist[0].charges) continue;
      const n = M.contratsExercice(c.numero, hist[0].exercice) || {};
      const n1 = hist[1] ? M.contratsExercice(c.numero, hist[1].exercice) || {} : {};
      for (const [f, x] of Object.entries(n)) {
        if (!x.charges) continue;
        const r = res[f] = res[f] || { famille: f, copros: 0, n: 0, n_comparable: 0, n1_comparable: 0 };
        r.copros++; r.n += x.charges;
        if (n1[f] && n1[f].charges) { r.n_comparable += x.charges; r.n1_comparable += n1[f].charges; }
      }
    }
    return Object.values(res).map((r) => ({ ...r, evol: r.n1_comparable ? r.n_comparable / r.n1_comparable - 1 : null })).sort((a, b) => b.n - a.n);
  };

  // ------------------------------------------------------------------ énergie (décret tertiaire)
  /** Les « COPRO IE » relèvent d'office du décret tertiaire. */
  M.soumisDecret = (c) => !!(c && (c.decret_tertiaire || c.type === "COPRO IE"));
  /** Règles appliquées à chaque enregistrement : COPRO IE -> décret tertiaire. Renvoie true si la fiche a changé. */
  M.appliquerRegles = (c) => {
    if (c && c.type === "COPRO IE" && !c.decret_tertiaire) { c.decret_tertiaire = true; return true; }
    return false;
  };
  M.OBJECTIF_DECRET_2030 = -0.4;
  M.energieCopro = (c) => {
    const comptes = new Set(S.db.edf_comptes.filter((k) => k.copro === c.numero).map((k) => k.compte));
    const annees = [];
    for (const [a, lignes] of Object.entries(S.db.edf_conso)) {
      let kwh = 0, ttc = 0, n = 0;
      for (const l of lignes) if (comptes.has(l.compte_facturation)) { kwh += v(l.conso_kwh); ttc += v(l.total_ttc); n++; }
      if (n) annees.push({ annee: Number(a), kwh, ttc, prix: kwh ? ttc / kwh : null });
    }
    annees.sort((a, b) => a.annee - b.annee);
    const ref = annees[0], der = annees[annees.length - 1], avant = annees[annees.length - 2];
    return { comptes: comptes.size, annees, reference: ref || null, derniere: der || null,
      evol: der && avant && avant.kwh ? der.kwh / avant.kwh - 1 : null, depuis_reference: der && ref && ref !== der && ref.kwh ? der.kwh / ref.kwh - 1 : null };
  };
  M.energieCabinet = (portefeuille = "") => S.copros().filter((c) => c.actif && M.soumisDecret(c) && M.dansPortefeuille(c, portefeuille))
    .map((c) => ({ copro: c, ...M.energieCopro(c) }));
  // ------------------------------------------------------------------ OPERAT : consommations des parties communes, trajectoire, répartition aux tantièmes
  M.ENERGIES = ["Électricité", "Gaz naturel", "Réseau de chaleur", "Réseau de froid", "Fioul", "Bois / biomasse", "Autre"];
  M.ECHEANCE_OPERAT = "09-30"; // déclaration des consommations de l'année N-1 avant le 30 septembre de l'année N
  M.CLE_DEFAUT = "CHARGES GENERALES";
  const OPERAT_VIDE = () => ({ annee_reference: null, conso_reference: null, declarations: {}, energies: [], cles: {}, cle_compte: {}, cle_pdl: {}, compte_pdl: {} });
  /** Données OPERAT d'une copro (les anciens tantièmes uniques deviennent ceux de la clé charges générales). */
  M.operat = (numero) => {
    const o = { ...OPERAT_VIDE(), ...((S.db.operat || {})[numero] || {}) };
    if (o.tantiemes && Object.keys(o.tantiemes).length && !Object.keys(o.cles).length) o.cles = { [M.CLE_DEFAUT]: { total: o.tantiemes_total ?? null, tantiemes: o.tantiemes } };
    delete o.tantiemes; delete o.tantiemes_total;
    return o;
  };
  M.majOperat = (numero, champs) => {
    if (!S.db.operat) S.db.operat = {};
    S.db.operat[numero] = { ...M.operat(numero), ...champs };
    S.sauver();
    return S.db.operat[numero];
  };
  /** Clés de répartition proposées : celles des extractions budget / charges de la copro (charges générales en tête), plus celles déjà utilisées. */
  M.clesRepartition = (numero) => {
    const vues = new Set();
    for (const b of Object.values(S.db.budgets)) if (b.copro === numero) for (const l of b.lignes) if (l.cle && l.compte) vues.add(String(l.cle).trim()); // lignes de compte (pas les sous-totaux)
    const o = M.operat(numero);
    for (const k of [...Object.keys(o.cles), ...Object.values(o.cle_compte), ...Object.values(o.cle_pdl || {}), ...o.energies.map((e) => e.cle)]) if (k) vues.add(k);
    const liste = [...vues].filter(Boolean);
    const gen = liste.find((k) => /GENERALES?$/.test(U.normaliser(k))) || M.CLE_DEFAUT;
    return [gen, ...liste.filter((k) => k !== gen).sort()];
  };
  M.cleParDefaut = (numero) => M.clesRepartition(numero)[0];
  M.cleCompte = (numero, compte) => M.operat(numero).cle_compte[compte] || M.cleParDefaut(numero);
  M.ajouterEnergie = (numero, e) => {
    const o = M.operat(numero);
    const x = { id: S.nouvelId(), annee: Number(e.annee), energie: e.energie || "Autre", kwh: v(e.kwh), ttc: e.ttc === "" || e.ttc === null || e.ttc === undefined ? null : v(e.ttc),
      reference: String(e.reference || "").trim(), cle: e.cle || M.cleParDefaut(numero) };
    return M.majOperat(numero, { energies: [...o.energies, x] }) && x;
  };
  M.supprimerEnergie = (numero, id) => M.majOperat(numero, { energies: M.operat(numero).energies.filter((x) => x.id !== id) });
  /** Consommations des parties communes d'une année, par énergie et par clé de répartition :
      électricité (synthèse EDF, regroupée selon la clé de chaque compte de facturation) + autres énergies saisies. */
  M.consosAnnee = (c, annee) => {
    annee = Number(annee);
    const comptes = new Set(S.db.edf_comptes.filter((k) => k.copro === c.numero).map((k) => k.compte));
    const pdlTous = (S.db.edf_conso[annee] || []).filter((l) => comptes.has(l.compte_facturation));
    const parCle = {};
    const ded = M.deductionsPdl ? M.deductionsPdl(c.numero) : {};
    for (const l of pdlTous) { const cle = M.clePdl ? M.clePdl(c.numero, l, ded).cle : M.cleCompte(c.numero, l.compte_facturation); (parCle[cle] = parCle[cle] || []).push(l); }
    const lignes = Object.entries(parCle).map(([cle, pdl]) => ({ energie: "Électricité", cle, kwh: pdl.reduce((t, l) => t + v(l.conso_kwh), 0),
      ttc: pdl.reduce((t, l) => t + v(l.total_ttc), 0), source: `synthèse EDF ${annee}`, reference: `${pdl.length} point(s) de livraison`, pdl }));
    for (const e of M.operat(c.numero).energies.filter((x) => x.annee === annee))
      lignes.push({ id: e.id, energie: e.energie, cle: e.cle || M.cleParDefaut(c.numero), kwh: e.kwh, ttc: e.ttc, source: "saisie", reference: e.reference });
    return { annee, lignes, pdl: pdlTous, kwh: lignes.reduce((t, l) => t + v(l.kwh), 0), ttc: lignes.reduce((t, l) => t + v(l.ttc), 0), edf_importe: !!(S.db.edf_conso[annee] || []).length };
  };
  /** Trajectoire : année de référence (choisie, sinon la première connue), objectifs − 40 % / − 50 % / − 60 %. */
  M.OBJECTIFS_DECRET = { 2030: 0.4, 2040: 0.5, 2050: 0.6 };
  M.trajectoireOperat = (c) => {
    const o = M.operat(c.numero);
    const annees = [...new Set([...Object.keys(S.db.edf_conso).map(Number), ...o.energies.map((e) => e.annee)])].sort();
    const totaux = annees.map((a) => M.consosAnnee(c, a)).filter((x) => x.kwh > 0);
    const refAnnee = o.annee_reference || (totaux[0] ? totaux[0].annee : null);
    const refKwh = o.conso_reference ?? (totaux.find((x) => x.annee === refAnnee) || {}).kwh ?? null;
    const derniere = totaux[totaux.length - 1] || null;
    return { annees: totaux, reference: refAnnee ? { annee: refAnnee, kwh: refKwh, saisie: o.conso_reference !== null && o.conso_reference !== undefined } : null,
      objectifs: refKwh ? Object.fromEntries(Object.entries(M.OBJECTIFS_DECRET).map(([a, r]) => [a, refKwh * (1 - r)])) : {},
      derniere, reduction: derniere && refKwh ? 1 - derniere.kwh / refKwh : null };
  };
  /** Tantièmes collés depuis Excel : « n° de compte ; tantièmes » par ligne (9033-0006, 0006 ou 6). */
  M.lireTantiemes = (texte) => {
    const res = {};
    for (const ligne of String(texte || "").split(/\r?\n/)) {
      const m = ligne.trim().match(/^(?:\d{4}\s*-\s*)?(\d{1,4})\s*[;,\t ]\s*([\d\s.,]+)$/);
      if (m) res[m[1].padStart(4, "0")] = U.nombreFr(m[2].replace(/\s/g, ""));
    }
    return res;
  };
  M.majCle = (numero, cle, champs) => {
    const o = M.operat(numero);
    const x = { total: null, tantiemes: {}, ...(o.cles[cle] || {}), ...champs };
    return M.majOperat(numero, { cles: { ...o.cles, [cle]: x } });
  };
  /** Répartition des consommations entre copropriétaires : chaque énergie au prorata des tantièmes de SA clé. */
  M.repartitionTantiemes = (c, annee) => {
    const o = M.operat(c.numero);
    const conso = M.consosAnnee(c, annee);
    const cat = S.db.catalogue[c.numero] || [];
    const utilisees = [...new Set(conso.lignes.map((l) => l.cle))];
    const cles = {};
    for (const k of new Set([...utilisees, ...Object.keys(o.cles)])) {
      const x = o.cles[k] || { total: null, tantiemes: {} };
      const somme = Object.values(x.tantiemes).reduce((t, y) => t + v(y), 0);
      cles[k] = { total: Number(x.total) || somme, somme, saisi: x.total, tantiemes: x.tantiemes, utilisee: utilisees.includes(k) };
    }
    const numeros = [...new Set([...cat.map((e) => e.numero), ...Object.values(o.cles).flatMap((x) => Object.keys(x.tantiemes))])].sort();
    const lignes = numeros.map((n) => {
      const e = cat.find((x) => x.numero === n);
      const energies = conso.lignes.map((l) => {
        const k = cles[l.cle];
        const t = k.tantiemes[n] ?? null;
        const part = t !== null && k.total ? t / k.total : null;
        return { energie: l.energie, cle: l.cle, tantiemes: t, total: k.total, part, kwh: part === null ? null : l.kwh * part, ttc: part === null || l.ttc === null ? null : v(l.ttc) * part };
      });
      const connues = energies.filter((x) => x.part !== null);
      return { numero: n, ref: `${c.numero}-${n}`, nom: e ? e.lignes[0] : "", adresse: e ? e.lignes.slice(1) : [], energies,
        tantiemes: Object.fromEntries(Object.keys(cles).map((k) => [k, cles[k].tantiemes[n] ?? null])),
        concerne: energies.some((x) => x.part), complet: energies.every((x) => x.part !== null),
        kwh: connues.length ? connues.reduce((t, x) => t + v(x.kwh), 0) : null, ttc: connues.length ? connues.reduce((t, x) => t + v(x.ttc), 0) : null };
    });
    return { conso, cles, lignes, complet: lignes.length > 0 && utilisees.every((k) => Object.keys(cles[k].tantiemes).length > 0) };
  };
  M.statutOperat = (numero, annee) => M.operat(numero).declarations[annee] || {};
  M.marquerOperat = (numero, annee, champ, fait = true) => {
    const o = M.operat(numero);
    const d = { ...(o.declarations[annee] || {}) };
    if (fait) d[champ] = U.horodatage(); else delete d[champ];
    return M.majOperat(numero, { declarations: { ...o.declarations, [annee]: d } });
  };
  /** Contrôles avant déclaration. */
  M.controlesOperat = (c, annee) => {
    const res = [];
    const comptes = S.db.edf_comptes.filter((k) => k.copro === c.numero);
    const conso = M.consosAnnee(c, annee);
    if (!comptes.length) res.push("Aucun compte EDF rattaché à la copro.");
    if (conso.edf_importe && comptes.length) {
      const pdl = conso.pdl;
      const avec = new Set(pdl.map((l) => l.compte_facturation));
      const sans = comptes.filter((k) => !avec.has(k.compte));
      if (sans.length) res.push(`${sans.length} compte(s) EDF sans consommation en ${annee} : ${sans.map((k) => k.compte).join(", ")}.`);
      for (const l of pdl) {
        const prix = l.conso_kwh ? v(l.total_ttc) / v(l.conso_kwh) : null;
        if (prix !== null && (prix > 1 || prix < 0.05)) res.push(`PDL ${l.rae} : prix apparent de ${U.nombre(prix, 2)} €/kWh (${U.nombre(l.conso_kwh, 0)} kWh pour ${U.euro(l.total_ttc)}), consommation à vérifier.`);
      }
    }
    if (!conso.edf_importe) res.push(`Synthèse EDF ${annee} non importée.`);
    // tantièmes manquants pour une clé utilisée
    const o = M.operat(c.numero);
    for (const k of new Set(conso.lignes.map((l) => l.cle))) if (!o.cles[k] || !Object.keys(o.cles[k].tantiemes || {}).length) res.push(`Tantièmes de la clé « ${k} » non renseignés : attestations impossibles pour cette énergie.`);
    const prec = M.consosAnnee(c, Number(annee) - 1);
    if (prec.kwh && conso.kwh && Math.abs(conso.kwh / prec.kwh - 1) >= 0.3) res.push(`Variation de ${U.pct(conso.kwh / prec.kwh - 1)} par rapport à ${Number(annee) - 1}.`);
    return res;
  };
  /** Rappel de campagne : du 1er avril au 30 septembre, copros soumises dont les attestations de l'année écoulée ne sont pas envoyées
      (les copropriétaires déclarent eux-mêmes sur OPERAT avant le 30 septembre). */
  M.rappelOperat = (aujourdhui = U.aujourdhui()) => {
    const md = aujourdhui.slice(5);
    if (md < "04-01" || md > M.ECHEANCE_OPERAT) return null;
    const annee = Number(aujourdhui.slice(0, 4)) - 1;
    const restant = S.copros().filter((c) => c.actif && M.soumisDecret(c) && !M.statutOperat(c.numero, annee).attestations_le);
    return restant.length ? { annee, restant: restant.length, echeance: `${aujourdhui.slice(0, 4)}-${M.ECHEANCE_OPERAT}` } : null;
  };

  /** Rappel : après le 1er janvier, la synthèse EDF de l'année écoulée est à récupérer tant qu'elle n'est pas importée. */
  M.rappelConsosEdf = (aujourdhui = U.aujourdhui()) => {
    const annee = Number(aujourdhui.slice(0, 4)) - 1;
    if (S.db.edf_conso[annee] && S.db.edf_conso[annee].length) return null;
    const n = S.copros().filter((c) => c.actif && M.soumisDecret(c)).length;
    return n ? { annee, copros: n } : null;
  };
})(globalThis.K = globalThis.K || {});
/* Calendrier de l'année comptable : échéances des copros (clôtures, synthèses, AG, reportings) et du cabinet (EDF, balance, OPERAT). */
(function (K) {
  "use strict";
  const U = K.U, E = K.E, S = K.S, M = K.M;
  const ajouterMois = (iso, n) => { const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
  const finMois = (m) => { const d = new Date(`${ajouterMois(m, 1)}-01T12:00:00Z`); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
  M.TYPES_CALENDRIER = {
    cloture: "Clôture d'exercice", synthese: "Synthèse des comptes", ag: "AG : approbation des comptes", process: "Reporting à récupérer",
    mandat: "Fin de mandat de syndic", registre: "Registre des copropriétés", edf: "Consommations EDF", balance: "Balance générale", operat: "Déclaration OPERAT", rappro: "Rapprochements bancaires",
  };
  /** Échéances de « debut » (AAAA-MM) sur « nbMois » mois, pour le portefeuille : [{date, mois, type, titre, detail, copro, comptable, statut, lien}].
      Synthèse : le mois suivant la clôture ; AG : au plus tard 6 mois après la clôture (approbation des comptes). */
  M.calendrier = (debut, nbMois = 12, portefeuille = "", aujourdhui = U.aujourdhui()) => {
    const fin = finMois(ajouterMois(debut, nbMois - 1)), d0 = `${debut}-01`;
    const dans = (d) => d >= d0 && d <= fin;
    const ev = [];
    const ajouter = (x) => { if (dans(x.date)) ev.push({ ...x, mois: x.date.slice(0, 7) }); };
    for (const c of S.copros().filter((x) => x.actif && M.dansPortefeuille(x, portefeuille))) {
      const finM = M.finMandat && M.finMandat(c.mandat);
      if (finM) ajouter({ copro: c.numero, nom: c.nom, comptable: c.comptable || "", date: finM, type: "mandat", titre: `Fin de mandat le ${U.jjmmaaaa(finM)}`, detail: "renouvellement à voter en AG", statut: finM < aujourdhui ? "a_faire" : "a_venir", lien: `#/copro/${encodeURIComponent(c.numero)}` });
      if (!c.exercice) continue;
      // exercices dont la clôture, la synthèse ou l'AG tombe dans la fenêtre
      let exo = E.exerciceClos(c.exercice, `${ajouterMois(fin, 1)}-28`);
      for (let i = 0; i < 4 && exo.fin >= `${ajouterMois(debut, -7)}-01`; i++, exo = exo.decale(-1)) {
        const base = { copro: c.numero, nom: c.nom, comptable: c.comptable || "", exercice: exo.libelle };
        const cle = `${c.numero}|${exo.libelle}`, r = S.db.syntheses[cle], faite = (S.db.syntheses_faites || {})[cle];
        const close = exo.fin < aujourdhui;
        const statut = (r && r.envoyee_le && M.chargesIntegrees(c, exo)) || faite || M.syntheseCloturee(c.numero, exo.libelle) ? "faite" : r ? "en_cours" : close ? "a_faire" : "a_venir";
        ajouter({ ...base, date: exo.fin, type: "cloture", titre: `Clôture ${exo.libelle}`, statut: close ? "faite" : "a_venir" });
        ajouter({ ...base, date: `${ajouterMois(exo.fin, 1)}-01`, type: "synthese", titre: `Synthèse ${exo.libelle}`, statut, lien: `#/synthese?copro=${encodeURIComponent(c.numero)}&exercice=${encodeURIComponent(exo.libelle)}` });
        const ag = finMois(ajouterMois(exo.fin, 6));
        ajouter({ ...base, date: ag, type: "ag", titre: `AG avant le ${U.jjmmaaaa(ag)}`, detail: `approbation des comptes ${exo.libelle} (6 mois après la clôture)`, statut: ag < aujourdhui ? "passee" : "a_venir", lien: `#/copro/${encodeURIComponent(c.numero)}` });
        for (const p of c.process || []) {
          const def = M.PROCESS && M.PROCESS[p.type];
          if (!def || !def.todo) continue;
          const t = M.todoProcess && M.todoProcess(c, p.type);
          ajouter({ ...base, date: `${ajouterMois(exo.fin, 1)}-01`, type: "process", titre: def.todo, statut: t && t.fait[exo.libelle] ? "faite" : close ? "a_faire" : "a_venir", lien: `#/synthese?copro=${encodeURIComponent(c.numero)}&exercice=${encodeURIComponent(exo.libelle)}` });
        }
        const kr = M.controleRegistre && M.controleRegistre(c, aujourdhui);
        if (kr && kr.r) {
          const ech = M.echeanceRegistre(exo), faite = (kr.r.date_derniere_maj || "") > exo.fin;
          ajouter({ ...base, date: ech, type: "registre", titre: "Registre : mise à jour annuelle", detail: `au plus tard 2 mois après l'AG (immatriculation ${kr.r.numero_immatriculation})`,
            statut: faite ? "faite" : ech < aujourdhui ? "a_faire" : "a_venir", lien: "#/registre" });
        }
        const tsc = M.sousCompteurs && M.sousCompteurs(c).length && M.todoProcess(c, "sous_compteurs");
        if (tsc && tsc.depuis_debut <= exo.debut) {
          const t = tsc;
          ajouter({ ...base, date: exo.fin, type: "process", titre: M.TODO_SOUS_COMPTEURS, detail: M.sousCompteurs(c).map((x) => x.nom).join(", "),
            statut: t && t.fait[exo.libelle] ? "faite" : close ? "a_faire" : "a_venir", lien: `#/compteurs?copro=${encodeURIComponent(c.numero)}&zone=sous-compteurs` });
        }
      }
    }
    // échéances du cabinet
    for (let i = 0; i < nbMois; i++) {
      const m = ajouterMois(debut, i), mm = Number(m.slice(5)), an = Number(m.slice(0, 4));
      if ([1, 4, 7, 10].includes(mm) && M.premierJourOuvre) ajouter({ date: M.premierJourOuvre(an, mm), type: "edf", titre: "Télécharger les consommations EDF", detail: "export des factures EDF → RESSOURCES\\CONSOS EDF", lien: "#/compteurs" });
      ajouter({ date: `${m}-20`, type: "balance", titre: "Importer la balance générale", detail: "GENERALE.csv → RESSOURCES\\BALANCES", lien: "#/attente" });
      ajouter({ date: finMois(m), type: "rappro", titre: "Rapprochements bancaires du mois", detail: "relevés au dernier jour du mois · CONTROLE RAPPRO", lien: "#/rapprochement" });
      if (mm === Number((M.ECHEANCE_OPERAT || "09-30").slice(0, 2)) && S.copros().some((c) => c.actif && M.soumisDecret && M.soumisDecret(c)))
        ajouter({ date: `${an}-${M.ECHEANCE_OPERAT || "09-30"}`, type: "operat", titre: `Déclaration OPERAT ${an - 1}`, detail: "consommations de l'année précédente, copros au décret tertiaire", lien: "#/decret" });
    }
    return ev.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || String(a.copro || "").localeCompare(String(b.copro || "")));
  };
  /** Fichier iCalendar (Outlook) des échéances : une journée entière par échéance. */
  M.calendrierIcs = (evenements, maintenant = new Date()) => {
    const esc = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
    const j = (iso) => iso.replace(/-/g, ""), suivant = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
    const stamp = maintenant.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const lignes = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//K-BDD//Calendrier comptable//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    for (const e of evenements) {
      const titre = e.copro ? `${e.copro} ${e.nom} : ${e.titre}` : e.titre;
      lignes.push("BEGIN:VEVENT", `UID:kbdd-${e.type}-${e.copro || "cabinet"}-${j(e.date)}-${(e.exercice || "").replace(/\W/g, "")}@k-bdd`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${j(e.date)}`, `DTEND;VALUE=DATE:${j(suivant(e.date))}`, `SUMMARY:${esc(titre)}`,
        `DESCRIPTION:${esc([M.TYPES_CALENDRIER[e.type], e.detail, e.comptable && `Comptable : ${e.comptable}`].filter(Boolean).join(" · "))}`, "TRANSP:TRANSPARENT", "END:VEVENT");
    }
    lignes.push("END:VCALENDAR");
    return lignes.join("\r\n") + "\r\n";
  };
})(globalThis.K = globalThis.K || {});
