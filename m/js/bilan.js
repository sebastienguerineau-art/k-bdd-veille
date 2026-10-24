/* Contrôle des comptes de bilan à partir des balances ICS (RESSOURCES\BALANCES\<n° copro>.csv, ou édition globale) :
   avance de trésorerie (103), fonds travaux (105, copros d'habitation), comptes d'attente 46 à 49 (soldes à justifier),
   soldes des copropriétaires (45) rapprochés des relances. Chaque import et chaque justification est historisé. */
(function (K) {
  "use strict";
  const U = K.U, S = K.S, I = K.I, M = K.M;
  const v = (x) => (x === null || x === undefined ? 0 : Number(x) || 0);
  const nul = (x) => Math.abs(v(x)) < 0.005;

  // ------------------------------------------------------------------ lecture
  /** Une ligne de compte : « 46210000 VIREMENTS EN ATTENTE;débits;crédits;débiteur;créditeur ». */
  const LIGNE = /^(\d{6,10})\s+(.*)$/;
  /** Balance d'une ou plusieurs copros. Les sections sont fermées par « Total <nom de la copro> » (édition globale). */
  I.parseBalance = (contenu) => {
    const sections = [];
    let cour = { nom: "", comptes: [] };
    for (const l of U.lireCsv(contenu, 5)) {
      const lib = String(l[0] || "").trim();
      const m = lib.match(LIGNE);
      if (m) {
        const debit = U.nombreFr(l[1]) ?? 0, credit = U.nombreFr(l[2]) ?? 0;
        const sd = U.nombreFr(l[3]), sc = U.nombreFr(l[4]);
        // solde : débiteur positif, créditeur négatif
        const solde = sd !== null || sc !== null ? U.arrondi(v(sd) - v(sc), 2) : U.arrondi(debit - credit, 2);
        cour.comptes.push({ compte: m[1], libelle: U.compacter(m[2]), debit, credit, solde });
        continue;
      }
      const t = lib.match(/^Total\s+(.+)$/i);
      if (t && !/^(des\s+copro|general|g[ée]n[ée]ral)/i.test(t[1].trim())) {
        if (cour.comptes.length) sections.push({ ...cour, nom: U.compacter(t[1]) });
        cour = { nom: "", comptes: [] };
      }
    }
    if (cour.comptes.length) sections.push(cour);
    return sections;
  };
  I.estBalance = (contenu) => /T O T A U X|^Libelles;Debits;Credits/m.test(U.lireTexte(new Uint8Array(contenu).slice(0, 300)));

  const etat = () => {
    if (!S.db.bilan) S.db.bilan = { balances: {}, historique: {}, justifs: {}, journal: [] };
    const b = S.db.bilan;
    if (!b.sections) b.sections = {};             // édition globale : dernière balance de chaque section « Total <nom ICS> »
    if (!b.correspondances) b.correspondances = {}; // nom de section -> { copro, valide }
    return b;
  };
  const journal = (copro, type, texte) => {
    const j = etat().journal;
    j.unshift({ le: U.horodatage(), date: U.aujourdhui(), copro, type, texte });
    if (j.length > 3000) j.length = 3000;
  };

  // ------------------------------------------------------------------ calculs
  M.COMPTE_ARRONDIS = /ARRONDI/;
  /** Comptes 46 à 49 hors contrôle : arrondis de répartition et 471006 « répartition en cours » (compte temporaire avant clôture). */
  M.estAttente = (x) => /^4[6-9]/.test(x.compte) && !M.COMPTE_ARRONDIS.test(U.normaliser(x.libelle))
    && !/^471006/.test(x.compte) && !/REPARTITION EN COURS/.test(U.normaliser(x.libelle));
  M.estHabitation = (c) => /HAB/.test(U.normaliser(c && c.type));
  /** Contrôles d'une balance : avances (montants positifs = au crédit), attente non soldés, copropriétaires. */
  M.controlerBalance = (comptes) => {
    const somme = (f) => U.arrondi(comptes.filter(f).reduce((t, x) => t - x.solde, 0), 2); // crédit positif
    const copros = comptes.filter((x) => /^45/.test(x.compte));
    return {
      avance: somme((x) => /^103/.test(x.compte)),
      fonds_travaux: somme((x) => /^105/.test(x.compte)),
      attente: comptes.filter((x) => M.estAttente(x) && !nul(x.solde)).map((x) => ({ compte: x.compte, libelle: x.libelle, solde: x.solde })),
      debiteurs: copros.filter((x) => x.solde > 0.005).map((x) => ({ compte: x.compte, libelle: x.libelle, solde: x.solde })).sort((a, b) => b.solde - a.solde),
      crediteurs: U.arrondi(copros.filter((x) => x.solde < -0.005).reduce((t, x) => t - x.solde, 0), 2),
    };
  };

  /** Enregistre la balance d'une copro ; nouvel état historisé seulement si le contenu a changé. */
  M.enregistrerBalance = (numero, comptes, { fichier = "", date = U.aujourdhui(), section = "" } = {}) => {
    const e = etat();
    const ctl = M.controlerBalance(comptes);
    const signature = comptes.map((x) => `${x.compte}:${x.solde}`).join("|");
    const avant = e.balances[numero];
    // balance individuelle et édition globale dans le même dossier : la plus récente l'emporte
    if (avant && avant.date > date) return { nouveau: false, ctl: M.controlerBalance(avant.comptes), ignoree: true };
    e.balances[numero] = { numero, fichier, date, importe_le: U.horodatage(), comptes, signature, ...(section ? { section } : {}) };
    if (avant && avant.signature === signature) return { nouveau: false, ctl };
    const hist = e.historique[numero] = e.historique[numero] || [];
    hist.push({ date, le: U.horodatage(), fichier, avance: ctl.avance, fonds_travaux: ctl.fonds_travaux,
      attente: Object.fromEntries(ctl.attente.map((x) => [x.compte, x.solde])),
      libelles: Object.fromEntries(ctl.attente.map((x) => [x.compte, x.libelle])),
      debiteurs: U.arrondi(ctl.debiteurs.reduce((t, x) => t + x.solde, 0), 2) });
    if (hist.length > 60) hist.splice(0, hist.length - 60);
    // comptes d'attente soldés depuis la balance précédente
    const prec = hist.length > 1 ? hist[hist.length - 2].attente : {};
    const soldes = Object.keys(prec).filter((k) => !(k in hist[hist.length - 1].attente));
    journal(numero, "balance", `Balance ${fichier || ""} du ${U.jjmmaaaa(date)} : ${ctl.attente.length} compte(s) d'attente non soldé(s)`
      + `${soldes.length ? ` · soldé(s) depuis la précédente : ${soldes.join(", ")}` : ""}`);
    return { nouveau: true, ctl };
  };

  /** Import d'un fichier balance : « 9226.csv » (une copro) ou édition globale (copros reconnues par le nom de leur total). */
  I.importerBalance = (nom, contenu, date) => {
    const sections = I.parseBalance(contenu);
    if (!sections.length) throw new Error(`${nom} : aucun compte lu.`);
    const num = (String(nom).split(/[\\/]/).pop().match(/^(\d{4})\b/) || [])[1];
    const res = { copros: [], inconnues: [], nouveaux: 0, a_valider: [] };
    if (sections.length > 1 || /GENERALE/i.test(nom)) etat().generale_le = (date || U.aujourdhui()).slice(0, 10); // rappel mensuel de la balance générale
    const fichier = String(nom).split(/[\\/]/).pop();
    const enregistrer = (numero, comptes, section = "") => {
      const r = M.enregistrerBalance(numero, comptes, { fichier, date: date || U.aujourdhui(), section });
      res.copros.push(numero); if (r.nouveau) res.nouveaux++;
    };
    if (num && sections.length === 1) enregistrer(num, sections[0].comptes);
    else {
      const copros = S.copros();
      for (const s of sections) {
        const n = U.normaliser(s.nom);
        const e = etat();
        e.sections[s.nom] = { comptes: s.comptes, date: date || U.aujourdhui(), fichier };
        // 1. nom ICS validé dans la fiche de la copro : correspondance sûre
        const sure = copros.find((x) => x.nom_ics_valide && U.normaliser(x.nom_ics) === n);
        if (sure) { e.correspondances[s.nom] = { copro: sure.numero, valide: true }; enregistrer(sure.numero, s.comptes, s.nom); continue; }
        // 2. correspondance déjà validée sur la page Comptes d'attente
        const deja = e.correspondances[s.nom];
        if (deja && deja.valide && S.copro(deja.copro)) { enregistrer(deja.copro, s.comptes, s.nom); continue; }
        // 3. recherche par nom : retenue, mais à valider
        const partiel = (x) => [x.nom, x.nom_ics].map(U.normaliser).some((m) => m && n.length >= 5 && (` ${m} `.includes(` ${n} `) || ` ${n} `.includes(` ${m} `)));
        const c = copros.find((x) => s.nom && (U.normaliser(x.nom) === n || U.normaliser(x.nom_ics) === n))
          || copros.find((x) => s.nom && (n.startsWith(`${x.numero} `) || n.endsWith(` ${x.numero}`) || n.includes(`C${x.numero}`)))
          || (() => { const t = copros.filter(partiel); return t.length === 1 ? t[0] : t.filter((x) => x.actif).length === 1 ? t.find((x) => x.actif) : null; })();
        const exact = !!c && (U.normaliser(c.nom_ics) === n || U.normaliser(c.nom) === n);
        if (c) { e.correspondances[s.nom] = { copro: c.numero, valide: false, type: exact ? "exact" : "approchant" }; enregistrer(c.numero, s.comptes, s.nom); res.a_valider.push(s.nom); }
        else { e.correspondances[s.nom] = { copro: "", valide: false }; res.inconnues.push(s.nom || "(sans nom)"); }
      }
    }
    return res;
  };

  /** RESSOURCES\BALANCES : toutes les balances (n° de copro.csv et éditions globales), seules les nouvelles versions sont historisées. */
  I.importerBalancesDossier = async (base) => {
    const d = (await S.sousDossier(base, "RESSOURCES", "BALANCES")) || (await S.sousDossier(base, "BALANCES"));
    if (!d) return null;
    const res = { fichiers: 0, nouveaux: 0, inconnues: [] };
    for (const fh of await S.fichiers(d, (n) => /\.csv$/i.test(n))) {
      const f = await fh.getFile();
      const contenu = new Uint8Array(await f.arrayBuffer());
      if (!I.estBalance(contenu)) continue;
      const r = I.importerBalance(f.name, contenu, f.lastModified ? new Date(f.lastModified).toISOString().slice(0, 10) : U.aujourdhui());
      res.fichiers++; res.nouveaux += r.nouveaux; res.inconnues.push(...r.inconnues);
    }
    return res;
  };

  /** Sections de l'édition globale dont la copro n'est pas confirmée (nom ICS non validé). */
  M.correspondancesAValider = () => Object.entries(etat().correspondances).filter(([, x]) => !x.valide)
    .map(([section, x]) => ({ section, copro: x.copro, type: x.type || (x.copro ? "approchant" : "inconnu"), date: (etat().sections[section] || {}).date || "" })).sort((a, b) => a.section.localeCompare(b.section));
  /** Confirme (ou corrige) la copro d'une section de l'édition globale : son nom ICS est validé dans la fiche. */
  M.validerCorrespondance = (section, numero) => {
    const e = etat(), avant = e.correspondances[section] || {};
    const c = S.copro(numero);
    if (!c) throw new Error("Copro introuvable.");
    if (avant.copro && avant.copro !== numero && e.balances[avant.copro] && e.balances[avant.copro].section === section) {
      delete e.balances[avant.copro]; // balance attribuée à tort
      journal(avant.copro, "balance", `Balance « ${section} » retirée : elle concerne ${numero}`);
    }
    for (const x of S.copros()) if (x.nom_ics_valide && x.numero !== numero && U.normaliser(x.nom_ics) === U.normaliser(section)) x.nom_ics_valide = false;
    c.nom_ics = section; c.nom_ics_valide = true;
    e.correspondances[section] = { copro: numero, valide: true };
    const sec = e.sections[section];
    if (sec && (!e.balances[numero] || e.balances[numero].section === section || e.balances[numero].date <= sec.date)) {
      M.enregistrerBalance(numero, sec.comptes, { fichier: sec.fichier, date: sec.date, section });
    }
    journal(numero, "validation", `Nom ICS « ${section} » validé pour ${numero} ${c.nom}`);
  };

  // ------------------------------------------------------------------ lecture des contrôles
  M.balanceCopro = (numero) => etat().balances[numero] || null;
  M.historiqueBalances = (numero) => etat().historique[numero] || [];
  M.journalBilan = () => etat().journal;
  const cleJustif = (numero, compte) => `${numero}|${compte}`;
  M.justifAttente = (numero, compte) => etat().justifs[cleJustif(numero, compte)] || null;
  /** Justification d'un solde d'attente : valable tant que le solde ne change pas. */
  M.justifierAttente = (numero, ligne, texte) => {
    const k = cleJustif(numero, ligne.compte), t = String(texte || "").trim();
    const avant = etat().justifs[k];
    if (t) etat().justifs[k] = { texte: t, solde: ligne.solde, le: U.aujourdhui() };
    else delete etat().justifs[k];
    if ((avant && avant.texte) !== t) journal(numero, "justification", `${ligne.compte} ${ligne.libelle} (${U.euro(ligne.solde)}) : ${t || "justification retirée"}`);
  };

  /** Reprise des justifications d'un tableau Excel de suivi des comptes d'attente (une ligne par copro et compte :
      Code, Compte, Libellé compte, Solde, Constat, Action à mener, Responsable, Statut, Commentaire).
      La justification est rattachée au solde du tableau : elle ne vaut que si la balance affiche encore ce solde. */
  I.importerJustifsExcel = (contenu, nomFichier = "") => {
    const wb = globalThis.XLSX.read(contenu, { type: "array" });
    const res = { lignes: 0, valides: 0, anciennes: 0, hors_balance: 0, sans_texte: 0 };
    const norm = (x) => U.normaliser(x).replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    for (const nom of wb.SheetNames) {
      const rows = globalThis.XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, defval: "" });
      const iTete = rows.findIndex((r) => r.some((x) => norm(x) === "CODE") && r.some((x) => norm(x) === "SOLDE"));
      if (iTete < 0) continue;
      const tete = rows[iTete].map(norm);
      const col = (...noms) => tete.findIndex((x) => noms.includes(x));
      const cCode = col("CODE"), cCompte = col("COMPTE"), cLib = col("LIBELLE COMPTE", "LIBELLE"), cSolde = col("SOLDE"), cConstat = col("CONSTAT"),
        cAction = col("ACTION A MENER", "ACTION"), cResp = col("RESPONSABLE"), cStatut = col("STATUT"), cComm = col("COMMENTAIRE");
      for (const r of rows.slice(iTete + 1)) {
        const code = String(r[cCode] ?? "").trim();
        if (!/^\d{4}$/.test(code)) continue;
        const lib = String(r[cLib] ?? "").trim();
        let compte = String(cCompte >= 0 ? r[cCompte] : "").trim();
        if (!/^\d{6,10}$/.test(compte)) compte = (lib.match(/^(\d{6,10})\b/) || [])[1] || (/^\d{6,10}$/.test(String(r[cCompte - 1] ?? "")) ? String(r[cCompte - 1]) : "");
        if (!compte && cCompte < 0) compte = String(r[cLib - 1] ?? "").trim();
        if (!/^\d{6,10}$/.test(compte)) continue;
        res.lignes++;
        const v2 = (k) => (k >= 0 ? U.compacter(r[k]) : "");
        const statut = v2(cStatut), comm = v2(cComm), action = v2(cAction), constat = v2(cConstat), resp = v2(cResp);
        const texte = [comm, action && !/^RAF$/i.test(action) ? `action : ${action}` : "", constat && !/^OK$/i.test(constat) ? `constat : ${constat}` : ""].filter(Boolean).join(" · ");
        if (!texte && !/justifi|corrig/i.test(statut)) { res.sans_texte++; continue; }
        const complet = `${statut ? `${statut} — ` : ""}${texte || "sans commentaire"}${resp ? ` (${resp})` : ""}`;
        const soldeXl = U.arrondi(Number(U.nombreFr(r[cSolde])) || 0, 2);
        const b = etat().balances[code];
        const ligne = b && M.controlerBalance(b.comptes).attente.find((x) => x.compte === compte);
        // statut « à traiter » : le texte est repris, mais le solde reste à justifier
        const enCours = /traiter/i.test(statut) && !/justifi|corrig/i.test(statut);
        etat().justifs[cleJustif(code, compte)] = { texte: complet, solde: soldeXl, le: U.aujourdhui(), source: nomFichier, ...(enCours ? { en_cours: true } : {}) };
        if (!ligne) res.hors_balance++;
        else if (enCours) res.en_cours = (res.en_cours || 0) + 1;
        else if (Math.abs(ligne.solde - soldeXl) < 0.01) res.valides++;
        else res.anciennes++;
      }
    }
    journal("", "justification", `Reprise des justifications de « ${nomFichier || "fichier Excel"} » : ${res.valides} valable(s) sur le solde actuel, `
      + `${res.anciennes} à revoir (solde changé), ${res.hors_balance} hors comptes d'attente contrôlés`);
    return res;
  };

  /** Contrôle de bilan d'une copro (null sans balance) : avances, alertes, attente (avec justification et historique). */
  M.bilanCopro = (c, budgetPropose) => {
    const b = c && M.balanceCopro(c.numero);
    if (!b) return null;
    const ctl = M.controlerBalance(b.comptes);
    const hab = M.estHabitation(c);
    const hist = M.historiqueBalances(c.numero);
    const prec = hist.length > 1 ? hist[hist.length - 2] : null;
    const attente = ctl.attente.map((x) => {
      const j = M.justifAttente(c.numero, x.compte);
      const depuis = (() => { let d = b.date; for (let i = hist.length - 1; i >= 0; i--) { if (hist[i].attente[x.compte] === undefined) break; d = hist[i].date; } return d; })();
      const meme = j && Math.abs(v(j.solde) - x.solde) < 0.005;
      return { ...x, justif: meme && !j.en_cours ? j : null, justif_en_cours: meme && j.en_cours ? j : null, justif_ancienne: j && !meme ? j : null,
        solde_prec: prec ? prec.attente[x.compte] ?? 0 : null, depuis };
    });
    const sansAvance = ctl.avance < 0.005, sansFonds = hab && ctl.fonds_travaux < 0.005;
    // contrôle interne : fonds travaux alimenté (105) mais aucun compte bancaire fonds travaux identifié (rappro)
    const compteFt = M.rapprochementFondsTravaux ? M.rapprochementFondsTravaux(c) : null;
    const sansCompteFt = Math.abs(ctl.fonds_travaux || 0) >= 0.005 && !compteFt;
    const proposition = budgetPropose ? Math.round(v(budgetPropose) / 6) : null;
    return {
      date: b.date, fichier: b.fichier, importe_le: b.importe_le, habitation: hab,
      avance: ctl.avance, fonds_travaux: hab ? ctl.fonds_travaux : null, sans_avance: sansAvance, sans_fonds: sansFonds, proposition_avance: proposition,
      solde_105: ctl.fonds_travaux, sans_compte_ft: sansCompteFt, compte_ft: compteFt ? { libelle: compteFt.libelle, solde: compteFt.solde_releve, date: compteFt.date_releve } : null,
      attente, a_justifier: attente.filter((x) => !x.justif), debiteurs: ctl.debiteurs, crediteurs: ctl.crediteurs,
      total_debiteurs: U.arrondi(ctl.debiteurs.reduce((t, x) => t + x.solde, 0), 2),
      commentaires: [
        ...(sansAvance ? [`Absence d'avance de trésorerie ! on peut proposer ${proposition ? U.euro(proposition) : "1/6e du budget"}`] : []),
        ...(sansFonds ? ["Mise en place fonds travaux ?"] : []),
      ],
    };
  };

  /** Soldes des copropriétaires (balance) rapprochés de la dernière campagne de relances : bloc de la page 2 de la synthèse. */
  M.soldesCopro = (c) => {
    const b = c && M.bilanCopro(c);
    if (!b) return null;
    const camps = M.campagnesRelance ? M.campagnesRelance() : [];
    const suivi = camps.length ? M.suiviRelances(camps[camps.length - 1].date) : null;
    const parCle = suivi ? Object.fromEntries(suivi.lignes.map((l) => [l.cle, l])) : {};
    const lignes = b.debiteurs.map((x) => {
      const r = parCle[`${c.numero}-${x.compte.slice(-4)}`] || null;
      return { ...x, nom: x.libelle, relance: r && !r.sorti ? r : null };
    });
    return { date: b.date, campagne: suivi ? suivi.campagne.date : "", total: b.total_debiteurs, nb: lignes.length, crediteurs: b.crediteurs, lignes,
      med: lignes.filter((x) => x.relance && x.relance.nb_med).length, a_relancer: lignes.filter((x) => x.relance && x.relance.a_relancer).length };
  };

  /** Rappel : balance générale à importer vers le 20 du mois quand la dernière date de plus de 30 jours. */
  M.rappelBalanceGenerale = (aujourdhui = U.aujourdhui()) => {
    const der = etat().generale_le || "";
    const jours = der ? Math.round((new Date(aujourdhui) - new Date(der)) / 86400000) : null;
    if (Number(aujourdhui.slice(8, 10)) < 20 || (jours !== null && jours <= 30)) return null;
    return { derniere: der, jours };
  };

  /** Vue d'ensemble pour la page « Comptes d'attente ». */
  M.controleAttente = (portefeuille = "") => S.copros().filter((c) => c.actif && M.dansPortefeuille(c, portefeuille))
    .map((c) => ({ c, b: M.bilanCopro(c) })).filter((x) => x.b);
})(globalThis.K = globalThis.K || {});
