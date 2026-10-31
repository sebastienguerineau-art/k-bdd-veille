/* Registre national d'immatriculation des copropriétés (Anah) : extrait quotidien des copropriétés du cabinet
   (open data data.gouv.fr, publié par le dépôt public de la veille), rapprochement avec la base et contrôles :
   mise à jour annuelle (2 mois après l'AG d'approbation des comptes), fin de mandat, nombre de lots, copro perdue. */
(function (K) {
  "use strict";
  const U = K.U, S = K.S, M = K.M, E = K.E;

  M.registreCopros = () => (S.db.registre && S.db.registre.copros) || [];
  /** Intègre un extrait du registre ({donnees_du, copros}) ; renvoie true s'il est plus récent que celui en base. */
  M.integrerRegistre = (d) => {
    if (!d || !Array.isArray(d.copros) || !d.copros.every((x) => x && x.numero_immatriculation)) throw new Error("Ce fichier n'est pas un extrait du registre des copropriétés.");
    const avant = S.db.registre, signe = (x) => `${(x.suivies || []).join(",")}|${x.copros.length}|${x.annuaire_le || ""}`; // annuaire en direct : nouvel extrait le même jour
    if (avant && avant.donnees_du && d.donnees_du && avant.copros.length && (d.donnees_du < avant.donnees_du || (d.donnees_du === avant.donnees_du && signe(avant) === signe(d)))) return false; // même jour : liste des suivies modifiée
    S.db.registre = { donnees_du: d.donnees_du || U.aujourdhui(), annuaire_le: d.annuaire_le || "", recu_le: U.horodatage(), syndic: d.syndic || null,
      suivies: d.suivies || [], introuvables: d.introuvables || [], copros: d.copros };
    cache = null;
    return true;
  };

  // ------------------------------------------------------------------ rapprochement registre ↔ base
  const MOTS_VIDES = new Set(["SDC", "SYNDICAT", "COPROPRIETAIRES", "COPROPRIETE", "RESIDENCE", "RES", "LE", "LA", "LES", "DU", "DE", "DES", "D", "L", "ET", "IMMEUBLE", "AU", "AUX", "EN"]);
  const TYPES_VOIE = /\b(RUE|AVENUE|AV|BOULEVARD|BD|ALLEE|ALLEES|PLACE|PL|MAIL|SQUARE|SQ|CHEMIN|IMPASSE|IMP|QUAI|ROUTE|RTE|COURS|PROMENADE|RESIDENCE|LIEU DIT)\b/g;
  const mots = (s) => new Set(U.normaliser(s).replace(/[^A-Z0-9 ]/g, " ").split(" ").filter((w) => w.length > 1 && !MOTS_VIDES.has(w) && !/^C?\d{4}$/.test(w)));
  const voie = (s) => { const n = U.normaliser(s).replace(/[^A-Z0-9 ]/g, " ").replace(TYPES_VOIE, " ").replace(/\s+/g, " ").trim(); const m = n.match(/^(\d+)\s*(?:BIS|TER)?\s*(.*)$/); return m ? { num: m[1], rue: mots(m[2]) } : { num: "", rue: mots(n) }; };
  const commun = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
  /** Score de ressemblance d'une ligne du registre avec une copro : n° de copro dans le nom d'usage (certain), sinon nom + adresse. */
  M.scoreRegistre = (c, r) => {
    if (new RegExp(`^\\s*${c.numero}\\b`).test(r.nom_usage_copropriete || "")) return 100;
    let s = 0;
    const a = mots(c.nom), b = mots(r.nom_usage_copropriete);
    if (a.size && b.size) s += Math.round(50 * commun(a, b) / Math.max(a.size, b.size));
    if (c.code_postal && String(c.code_postal).trim() === r.code_postal_adresse) s += 10;
    const v = voie(c.adresse);
    if (v.rue.size) {
      const meilleure = Math.max(0, ...[r.numero_voie_adresse, r.adresse_complementaire_1, r.adresse_complementaire_2].filter(Boolean).map((x) => {
        const w = voie(x), part = commun(v.rue, w.rue) / Math.max(v.rue.size, w.rue.size);
        return part < 0.5 ? 0 : v.num && w.num && v.num === w.num ? 40 : 25;
      }));
      s += meilleure;
    }
    return Math.min(s, 99);
  };
  /** Types de la base sans obligation d'immatriculation : pas un syndicat de copropriétaires (ASL, AFUL, monopropriété GT) ou pas de lot d'habitation (immobilier d'entreprise). */
  M.TYPES_HORS_REGISTRE = { ASL: "association syndicale libre : pas un syndicat de copropriétaires", AFUL: "association foncière urbaine libre : pas un syndicat de copropriétaires",
    "COPRO IE": "immobilier d'entreprise sans lot d'habitation", GT: "monopropriété : pas de syndicat de copropriétaires" };
  let cache = null;
  /** Rattachement de chaque copro de la base : manuel (c.immatriculation), automatique (meilleur score net), ou candidats à choisir. */
  const rattachements = () => {
    const cle = `${S.db.registre ? S.db.registre.donnees_du + M.registreCopros().length : ""}|${S.copros().map((c) => `${c.numero}:${c.immatriculation || ""}:${c.nom}:${c.adresse}:${c.code_postal}`).join(",")}`;
    if (cache && cache.cle === cle) return cache.res;
    const reg = M.registreCopros(), res = new Map(), pris = new Set(S.copros().map((c) => c.immatriculation).filter((x) => x && x !== "aucune"));
    for (const c of S.copros()) {
      if (c.immatriculation === "aucune") { res.set(c.numero, { statut: "ignoree" }); continue; }
      if (c.immatriculation) { const r = reg.find((x) => x.numero_immatriculation === c.immatriculation); res.set(c.numero, r ? { statut: "manuel", r } : { statut: "absente_registre", numero: c.immatriculation }); continue; }
      const cands = reg.filter((r) => !pris.has(r.numero_immatriculation)).map((r) => ({ r, score: M.scoreRegistre(c, r) })).filter((x) => x.score >= 30).sort((a, b) => b.score - a.score);
      const [p, d] = cands;
      if (p && p.score >= 60 && (!d || d.score <= p.score - 15)) res.set(c.numero, { statut: "auto", r: p.r, score: p.score });
      else if (M.TYPES_HORS_REGISTRE[c.type]) res.set(c.numero, { statut: "ignoree", motif: M.TYPES_HORS_REGISTRE[c.type] }); // non rapprochée et non soumise
      else res.set(c.numero, { statut: "a_rattacher", candidats: cands.slice(0, 4) });
    }
    cache = { cle, res };
    return res;
  };
  M.rattachementRegistre = (c) => (M.registreCopros().length ? rattachements().get(c.numero) || { statut: "a_rattacher", candidats: [] } : null);
  /** Lignes du registre au nom du cabinet sans copro correspondante dans la base. */
  M.registreHorsBase = () => {
    const rat = rattachements(), utilises = new Set([...rat.values()].filter((x) => x.r).map((x) => x.r.numero_immatriculation));
    return M.registreCopros().filter((r) => !utilises.has(r.numero_immatriculation));
  };
  M.FORMAT_IMMATRICULATION = /^[A-Z]{2}\d{7}$/;
  /** Rattache (n° d'immatriculation), « aucune » (copro hors registre) ou "" (retour au rattachement automatique). */
  M.definirImmatriculation = (c, numero) => {
    const v = String(numero || "").trim().toUpperCase().replace(/\s/g, "");
    if (v && v !== "AUCUNE" && !M.FORMAT_IMMATRICULATION.test(v)) throw new Error("N° d'immatriculation attendu : 2 lettres et 7 chiffres (ex. AB1234567).");
    c.immatriculation = v === "AUCUNE" ? "aucune" : v; cache = null;
  };
  /** Copros rattachées à un n° absent de l'extrait : à ajouter à la liste des copros suivies du dépôt public ;
      etat : a_ajouter (pas dans la liste), en_attente (dans la liste, prochain extrait), introuvable (absent du registre). */
  M.immatriculationsASuivre = () => {
    const reg = S.db.registre || {}, suivies = new Set(reg.suivies || []), introuvables = new Set(reg.introuvables || []);
    return S.copros().filter((c) => c.immatriculation && c.immatriculation !== "aucune" && !M.registreCopros().some((r) => r.numero_immatriculation === c.immatriculation))
      .map((c) => ({ c, numero: c.immatriculation, etat: introuvables.has(c.immatriculation) ? "introuvable" : suivies.has(c.immatriculation) ? "en_attente" : "a_ajouter" }));
  };

  // ------------------------------------------------------------------ contrôles
  const ajouterMois = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); }; // fin du mois
  M.DELAI_REGISTRE_MOIS = 8; // AG au plus tard 6 mois après la clôture + 2 mois pour la mise à jour
  /** Mise à jour annuelle : due au plus tard 8 mois après la clôture (AG sous 6 mois + 2 mois). */
  M.echeanceRegistre = (exo) => ajouterMois(exo.fin, M.DELAI_REGISTRE_MOIS);
  M.controleRegistre = (c, aujourdhui = U.aujourdhui()) => {
    const rat = M.rattachementRegistre(c);
    if (!rat) return null;
    if (rat.statut === "ignoree") return { statut: "ignoree", rat, alertes: [] };
    if (!rat.r) return { statut: rat.statut, rat, alertes: [] };
    const r = rat.r, alertes = [], maj = r.date_derniere_maj || "";
    const exo = E.exerciceClos(c.exercice || "01/01 au 31/12", aujourdhui), prec = exo.decale(-1);
    let m;
    if (maj > exo.fin) m = { statut: "a_jour", exercice: exo.libelle, echeance: M.echeanceRegistre(exo) };
    else if (aujourdhui > M.echeanceRegistre(exo)) m = { statut: "en_retard", exercice: exo.libelle, echeance: M.echeanceRegistre(exo) };
    else if (maj > prec.fin) m = { statut: "a_faire", exercice: exo.libelle, echeance: M.echeanceRegistre(exo) };
    else m = { statut: "en_retard", exercice: prec.libelle, echeance: M.echeanceRegistre(prec) };
    if (m.statut === "en_retard") alertes.push({ niveau: "alerte", texte: `Mise à jour annuelle ${m.exercice} en retard (due au ${U.jjmmaaaa(m.echeance)}, dernière le ${U.jjmmaaaa(maj) || "—"})` });
    if (r.mandat_en_cours && r.mandat_en_cours !== "Mandat en cours") alertes.push({ niveau: "alerte", texte: `Registre : « ${r.mandat_en_cours} »` });
    const finFiche = M.finMandat ? M.finMandat(c.mandat) : "", finReg = r.date_fin_dernier_mandat || "";
    const debutFiche = (c.mandat || {}).debut || "";
    // renouvellement voté (fiche) mais registre resté sur l'ancien mandat : à déclarer dans le mois suivant la fin du mandat précédent
    if (finReg && finFiche > finReg && ajouterMois(debutFiche && debutFiche > finReg ? debutFiche : finReg, 1) < aujourdhui)
      alertes.push({ niveau: "alerte", texte: `Renouvellement du mandat non déclaré : le registre s'arrête au ${U.jjmmaaaa(finReg)}, nouveau mandat jusqu'au ${U.jjmmaaaa(finFiche)} (à déclarer dans le mois)` });
    else if (finReg && finFiche && Math.abs(Date.parse(finReg) - Date.parse(finFiche)) > 31 * 864e5)
      alertes.push({ niveau: "attention", texte: `Fin de mandat : ${U.jjmmaaaa(finReg)} au registre, ${U.jjmmaaaa(finFiche)} dans la fiche` });
    if (finReg && finReg < aujourdhui && !c.perdue && !(finFiche > finReg)) alertes.push({ niveau: "alerte", texte: `Mandat déclaré au registre terminé le ${U.jjmmaaaa(finReg)} : renouvellement à déclarer` });
    const lots = [Number(r.nombre_total_lots), Number(r.nombre_lots_habitation)].filter(Boolean);
    if (String(c.lots_surface || "").toUpperCase() === "LOTS" && Number(c.quantite) && lots.length && !lots.includes(Number(c.quantite)))
      alertes.push({ niveau: "info", texte: `Lots : ${r.nombre_total_lots} au registre (${r.nombre_lots_habitation} d'habitation), ${c.quantite} dans la fiche` });
    if (c.perdue && c.perdue.le && ajouterMois(c.perdue.le, 1) < aujourdhui) alertes.push({ niveau: "alerte", texte: `Copro perdue le ${U.jjmmaaaa(c.perdue.le)} mais toujours au nom du cabinet : fin de mandat à déclarer (1 mois)` });
    const statut = alertes.some((a) => a.niveau === "alerte") ? "alerte" : alertes.some((a) => a.niveau === "attention") ? "attention" : "ok";
    return { statut, rat, r, maj: m, fin_mandat_registre: finReg, alertes };
  };

  // ------------------------------------------------------------------ après l'AG : mandat, PV à la banque, déclaration au registre
  /* c.ag[exercice] = { date, mandat: "renouvele" | "non_renouvele", pv_banque_le, registre_le } : AG d'approbation des comptes de l'exercice. */
  M.SEUIL_DEBITEUR_REGISTRE = 300; // nombre de copropriétaires débiteurs de plus de 300 € (déclaration annuelle)
  M.agCopro = (c, exercice) => ((c.ag || {})[exercice]) || {};
  M.majAg = (c, exercice, champs) => {
    c.ag = c.ag || {};
    const a = { ...(c.ag[exercice] || {}), ...champs };
    for (const k of Object.keys(a)) if (a[k] === "" || a[k] === null || a[k] === undefined) delete a[k];
    if (Object.keys(a).length) c.ag[exercice] = a; else delete c.ag[exercice];
    return a;
  };
  /** Mandat à traiter lors de cette AG : non renseigné, expiré, ou se terminant avant l'AG suivante (≈ 12 mois plus tard). */
  M.mandatATraiter = (c, dateAg) => {
    const fin = M.finMandat ? M.finMandat(c.mandat) : "";
    if (!fin) return { motif: "non_renseigne", fin: "" };
    if (!dateAg) return null;
    const suivante = ajouterMois(dateAg, 13);
    return fin <= suivante ? { motif: fin < dateAg ? "expire" : "fin_proche", fin } : null;
  };
  /** Renouvellement voté : nouveau mandat (début = AG, fin saisie), l'ancien est gardé pour mémoire. */
  M.renouvelerMandat = (c, exercice, { debut, fin }) => {
    if (!debut || !fin || fin <= debut) throw new Error("Indiquez le début et la fin du nouveau mandat (fin après le début).");
    const avant = c.mandat || {};
    c.mandat = { ...avant, debut, fin, duree_mois: "", precedent: avant.debut || avant.fin ? { debut: avant.debut || "", fin: M.finMandat(avant) } : avant.precedent };
    M.majAg(c, exercice, { mandat: "renouvele" });
  };
  /** Nouveau mandat proposé : même durée que le précédent (3 ans à défaut), à partir de la date de l'AG. */
  M.mandatPropose = (c, dateAg) => {
    const duree = (M.dureeMandat && M.dureeMandat(c.mandat)) || 36;
    const d = new Date(`${dateAg}T12:00:00Z`); const j = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + duree);
    d.setUTCDate(Math.min(j, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate())); d.setUTCDate(d.getUTCDate() - 1);
    return { debut: dateAg, fin: d.toISOString().slice(0, 10), duree_mois: duree };
  };
  /** Données de la mise à jour annuelle du registre, préparées depuis l'appli (à vérifier avant de les recopier). */
  M.declarationRegistre = (c, exo) => {
    const a = M.agCopro(c, exo.libelle), b = S.db.budgets[`${c.numero}|${exo.libelle}`];
    const tc = b && M.totauxCourants ? M.totauxCourants(b) : null, tg = b ? (b.lignes.find((l) => l.total === "general") || {}) : {};
    const bal = M.balanceCopro ? M.balanceCopro(c.numero) : null, bil = M.bilanCopro ? M.bilanCopro(c) : null;
    const fournisseurs = bal ? U.arrondi(bal.comptes.filter((x) => /^40/.test(x.compte)).reduce((t, x) => t - x.solde, 0), 2) : null;
    const src = { budget: b ? `extraction ${exo.libelle}` : "extraction absente", balance: bal ? `balance du ${U.jjmmaaaa(bal.date)}` : "balance absente" };
    const lots = String(c.lots_surface || "").toUpperCase() === "LOTS" ? Number(c.quantite) || null : null;
    const m = c.mandat || {};
    return [
      { cle: "exercice", libelle: "Exercice comptable", valeur: `du ${U.jjmmaaaa(exo.debut)} au ${U.jjmmaaaa(exo.fin)}` },
      { cle: "ag", libelle: "Date de l'AG d'approbation des comptes", valeur: a.date ? U.jjmmaaaa(a.date) : "", source: "saisie ci-dessus" },
      { cle: "courantes", libelle: "Charges pour opérations courantes", valeur: tc && tc.charges !== null ? U.euro(tc.charges) : "", source: src.budget },
      { cle: "travaux", libelle: "Charges pour travaux et opérations exceptionnelles", valeur: tc && tg.charges !== null && tg.charges !== undefined ? U.euro(U.arrondi(tg.charges - tc.charges, 2)) : "", source: src.budget },
      { cle: "fournisseurs", libelle: "Dettes fournisseurs, rémunérations et autres", valeur: fournisseurs !== null ? U.euro(Math.max(0, fournisseurs)) : "", source: src.balance },
      { cle: "impayes", libelle: "Sommes restant dues par les copropriétaires", valeur: bil ? U.euro(bil.total_debiteurs) : "", source: src.balance },
      { cle: "debiteurs", libelle: `Copropriétaires débiteurs de plus de ${M.SEUIL_DEBITEUR_REGISTRE} €`, valeur: bil ? String(bil.debiteurs.filter((x) => x.solde > M.SEUIL_DEBITEUR_REGISTRE).length) : "", source: src.balance },
      { cle: "fonds_travaux", libelle: "Montant du fonds de travaux", valeur: bil ? U.euro(Math.max(0, bil.solde_105 || 0)) : "", source: src.balance },
      { cle: "mandat", libelle: "Mandat du syndic", valeur: m.debut || M.finMandat(m) ? `${m.debut ? `du ${U.jjmmaaaa(m.debut)} ` : ""}au ${U.jjmmaaaa(M.finMandat(m))}` : "", source: "fiche copro" },
      { cle: "lots", libelle: "Nombre de lots", valeur: lots ? String(lots) : "", source: "fiche copro" },
    ];
  };
  /** Process après l'AG d'approbation des comptes de l'exercice : étapes et avancement. */
  M.apresAg = (c, exo) => {
    const a = M.agCopro(c, exo.libelle), mandat = M.mandatATraiter(c, a.date);
    const k = M.controleRegistre ? M.controleRegistre(c) : null, majReg = k && k.r ? k.r.date_derniere_maj || "" : "";
    const etapes = [{ id: "date", titre: "Date de l'AG", fait: !!a.date }];
    if (a.date && (mandat || a.mandat)) etapes.push({ id: "mandat", titre: "Mandat de syndic", fait: !!a.mandat, mandat });
    if (a.mandat === "renouvele") etapes.push({ id: "pv_banque", titre: "PV à la conseillère bancaire", fait: !!a.pv_banque_le });
    if (a.date) etapes.push({ id: "registre", titre: "Déclaration au registre", fait: !!a.registre_le || (!!majReg && majReg >= a.date), auto: !a.registre_le && !!majReg && majReg >= a.date });
    return { exo, ag: a, mandat, etapes, fini: etapes.every((e) => e.fait), commence: !!a.date };
  };
  /** Process post-AG commencés et non terminés (tableau de bord). */
  M.apresAgEnCours = (portefeuille = "") => S.copros().filter((c) => c.actif && M.dansPortefeuille(c, portefeuille))
    .map((c) => M.apresAg(c, E.exerciceClos(c.exercice || "01/01 au 31/12"))).filter((x) => x.commence && !x.fini);

  // ------------------------------------------------------------------ contrôle réglementaire (synthèse) : avance de trésorerie
  M.PART_AVANCE_MAX = 1 / 6;   // avance de trésorerie permanente : au plus 1/6 du budget prévisionnel
  /** Budget prévisionnel de référence : budget de l'exercice en cours (N+1 de l'extraction N), sinon budget N. */
  M.budgetReference = (c, exo) => {
    const b = S.db.budgets[`${c.numero}|${exo.libelle}`], t = b && M.totauxCourants ? M.totauxCourants(b) : null;
    if (!t) return null;
    return t.budget_n1 ? { montant: t.budget_n1, exercice: exo.decale(1).libelle } : t.budget ? { montant: t.budget, exercice: exo.libelle } : null;
  };
  M.controlesReglementaires = (c, exo) => {
    const ref = M.budgetReference(c, exo), bil = M.bilanCopro ? M.bilanCopro(c) : null, res = [];
    if (!ref) return res;
    if (bil && bil.avance >= 0.005) {
      const max = U.arrondi(ref.montant * M.PART_AVANCE_MAX, 2), ok = bil.avance <= max + 1;
      res.push({ id: "avance", ok, titre: "Avance de trésorerie", texte: ok ? `${U.euro(bil.avance)} : dans la limite du 1/6 du budget (${U.euro(max)})`
        : `${U.euro(bil.avance)} au-dessus du 1/6 du budget ${ref.exercice} (${U.euro(max)} au plus)` });
    }
    return res;
  };

  // ------------------------------------------------------------------ avant la clôture : sous-compteurs à relever, comptes d'attente à solder
  M.JOURS_AVANT_CLOTURE = 30;
  /** Copros dont l'exercice en cours se clôture dans les 30 jours : sous-compteurs à relever, comptes d'attente non soldés. */
  M.avantCloture = (portefeuille = "", aujourdhui = U.aujourdhui()) => {
    const res = { sous_compteurs: [], attente: [] };
    for (const c of S.copros().filter((x) => x.actif && M.dansPortefeuille(x, portefeuille))) {
      const exo = E.exerciceClos(c.exercice || "01/01 au 31/12", aujourdhui).decale(1); // exercice en cours
      const jours = Math.round((Date.parse(exo.fin) - Date.parse(aujourdhui)) / 864e5);
      if (jours < 0 || jours > M.JOURS_AVANT_CLOTURE) continue;
      const sc = (c.sous_compteurs || []).filter((x) => !(x.releves || {})[exo.libelle]);
      if (sc.length) res.sous_compteurs.push({ c, exo, jours, n: sc.length });
      const b = M.bilanCopro ? M.bilanCopro(c) : null;
      if (b && b.attente.length) res.attente.push({ c, exo, jours, n: b.attente.length, total: U.arrondi(b.attente.reduce((t, x) => t + Math.abs(x.solde), 0), 2) });
    }
    return res;
  };
})(globalThis.K = globalThis.K || {});
