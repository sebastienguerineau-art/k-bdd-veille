/* Contrats d'énergie (export ICS « CONTRATS_ICS.csv ») : rattachement des comptes de facturation EDF aux copros
   et clé de répartition de chaque compteur d'après son compte de charge (602… → ligne du budget de la copro). */
(function (K) {
  "use strict";
  const U = K.U, S = K.S, I = K.I, M = K.M;
  const sansZeros = (x) => String(x || "").trim().replace(/^0+/, "");

  /** Énergie d'un contrat d'après son objet / libellé (les comptes de charge ne sont pas toujours les bons), puis son compte de charge. */
  M.energieContrat = (texte, compte = "") => {
    const t = U.normaliser(texte);
    if (/MAINTENANCE|ENTRETIEN|ACCES AU RESEAU|PHOTOVOLTA/.test(t)) return "Autre";
    if (/\bGAZ|\bGDF|\bPCE\b/.test(t)) return "Gaz";
    if (/ELEC|ECLAIRAGE|\bEDF\b|MINUTERIE/.test(t)) return "Électricité"; // « EDF CHAUFFERIE » : électricité de la chaufferie
    if (/COMBUSTIBLE|COMUSTIBLE|FIOUL|CHAUFFERIE/.test(t)) return "Combustible";
    return /^602/.test(compte) ? "Électricité" : /^603/.test(compte) ? "Combustible" : "Autre";
  };
  /** Lignes de fourniture d'électricité d'un budget (comptes 60 uniquement : pas les contrôles d'installation 614…) : libellé « électricité /
      éclairage / EDF », ou compte de charge d'un contrat d'électricité ou 602 au libellé neutre ; jamais combustible, eau, gaz, téléphone. */
  M.lignesElectricite = (numero, b) => {
    const comptes = new Set([...S.db.edf_comptes.filter((k) => k.copro === numero && (!k.energie || k.energie === "Électricité")).map((k) => k.compte_charge), ...Object.values(M.operat(numero).compte_pdl || {})].filter(Boolean));
    const vus = new Set();
    return (b ? b.lignes : []).filter((l) => {
      if (!l.compte || vus.has(l.compte) || !/^60/.test(l.compte)) return false;
      const t = U.normaliser(l.libelle);
      if (/COMBUSTIBLE|\bEAU\b|\bGAZ\b|CHAUFFAGE|TELEPHONE|FIOUL|CONTROLE|VERIF|DEPANNAGE|MAINTENANCE/.test(t)) return false;
      const ok = /ELEC|ECLAIRAGE|\bEDF\b|MINUTERIE|IRVE/.test(t) || comptes.has(l.compte) || /^602/.test(l.compte);
      return ok && vus.add(l.compte);
    });
  };
  I.estContratsIcs = (contenu) => /^No contrat;Immeuble/i.test(U.lireTexte(new Uint8Array(contenu).slice(0, 200)).trim());

  /** Blocs de 5 lignes : n° contrat ; immeuble « NOM  C9003-9003 » ; objet / statut ; fournisseur / téléphone / tirets / compte de charge ; libellé. */
  I.parseContratsIcs = (contenu) => {
    const l = U.lireCsv(contenu, 3);
    const res = [];
    for (let i = 0; i + 4 < l.length; i++) {
      const no = String(l[i][0] || "").trim();
      if (!no || /^No contrat/i.test(no) || !/^-{3,}/.test(String(l[i + 3][0] || ""))) continue;
      const imm = U.compacter(l[i][1]);
      const copro = (imm.match(/-(\d{4})\s*$/) || imm.match(/\bC(\d{4})\b/) || [])[1] || "";
      const cpt = String(l[i + 4][0] || "").replace(/\s+/g, "");
      const lib = U.compacter(l[i + 4][1]), objet = U.compacter(l[i][2]);
      const energie = M.energieContrat(`${objet} ${lib}`, cpt);
      res.push({ contrat: no, copro, immeuble: imm.replace(/\s*(C\d{4})?-\d{4}\s*$/, "").trim(), objet, statut: /TERMIN/i.test(l[i + 1][0]) ? "terminé" : "actif",
        fournisseur: U.compacter(l[i + 1][1]), compte_charge: /^\d{8}$/.test(cpt) ? cpt : "", libelle: lib, energie,
        pdl: (`${lib} ${objet} ${U.compacter(l[i + 4][2])}`.match(/\b\d{14}\b/) || [])[0] || "" });
      i += 4;
    }
    return res;
  };

  /** Import : enregistre les contrats et rattache les comptes de facturation d'électricité aux copros ; rapport de rapprochement. */
  I.importerContratsIcs = (nom, contenu) => {
    const liste = I.parseContratsIcs(contenu);
    if (!liste.length) throw new Error(`${nom} : aucun contrat lu.`);
    const valides = liste.filter((x) => x.copro && sansZeros(x.contrat));
    const elec = valides.filter((x) => x.energie === "Électricité");
    const parContrat = new Map(valides.map((x) => [sansZeros(x.contrat), x]));
    const r = { contrats: liste.length, electricite: elec.length, confirmes: 0, autres_energies: 0, ajoutes: [], conflits: [], introuvables: [] };
    for (const k of S.db.edf_comptes) {
      const x = parContrat.get(sansZeros(k.compte));
      if (!x) { r.introuvables.push({ compte: k.compte, copro: k.copro }); continue; }
      if (x.energie !== "Électricité") r.autres_energies++;
      if (x.copro !== k.copro) r.conflits.push({ compte: k.compte, copro: k.copro, copro_export: x.copro, immeuble: x.immeuble });
      else r.confirmes++;
      Object.assign(k, { statut: x.statut, compte_charge: x.compte_charge, objet: x.objet, fournisseur: x.fournisseur, energie: x.energie, pdl_ics: x.pdl });
      if (!k.reference) k.reference = x.objet;
    }
    const connus = new Set([...S.db.edf_comptes.map((k) => sansZeros(k.compte)), ...M.comptesExclus()]);
    for (const x of elec) {
      if (connus.has(sansZeros(x.contrat))) continue;
      S.db.edf_comptes.push({ id: S.nouvelId(), compte: /^\d+$/.test(x.contrat) ? sansZeros(x.contrat) : x.contrat, copro: x.copro, reference: x.objet, statut: x.statut, compte_charge: x.compte_charge, objet: x.objet, fournisseur: x.fournisseur, energie: x.energie, pdl_ics: x.pdl, origine: "CONTRATS ICS" });
      connus.add(sansZeros(x.contrat));
      r.ajoutes.push({ compte: x.contrat, copro: x.copro, objet: x.objet });
    }
    S.db.contrats_ics = { liste };
    r.pdl_rattaches = M.rattacherParPdl();
    S.db.contrats_ics = { fichier: String(nom).split(/[\\/]/).pop(), importe_le: U.horodatage(), liste, rapport: r };
    S.journal("Contrats ICS", nom, `${liste.length} contrat(s) · ${r.confirmes} rattachement(s) confirmé(s), ${r.ajoutes.length} ajouté(s), ${r.conflits.length} conflit(s)${r.pdl_rattaches.length ? `, ${r.pdl_rattaches.length} compte(s) retrouvé(s) par le PDL` : ""}`);
    return r;
  };

  /** Rattachement PDL → contrat → comptes de facturation : un PDL peut passer par plusieurs comptes au fil des renégociations.
      PDL connus d'une copro = PDL de ses contrats ICS + PDL des synthèses EDF sur ses comptes rattachés ; tout compte de facturation
      d'une synthèse EDF (toutes périodes) qui porte un de ces PDL et n'est rattaché nulle part est rattaché à la copro. */
  M.rattacherParPdl = () => {
    const lignes = [...Object.values(S.db.edf_conso), ...Object.values(S.db.edf_periodes || {}).map((x) => x.lignes), M.lignesFacturesPdl ? M.lignesFacturesPdl() : []].flat();
    const copro = {}, ambigu = new Set();
    const connaitre = (rae, num, source) => { if (!rae) return; if (copro[rae] && copro[rae].num !== num) ambigu.add(rae); else copro[rae] = copro[rae] || { num, source }; };
    for (const x of (S.db.contrats_ics || {}).liste || []) if (x.pdl && x.copro && x.energie === "Électricité" && (S.copro(x.copro) || {}).actif) connaitre(x.pdl, x.copro, x);
    const attache = new Map(S.db.edf_comptes.map((k) => [sansZeros(k.compte), k]));
    const exclus = M.comptesExclus();
    for (const l of lignes) { const k = attache.get(sansZeros(l.compte_facturation)); if (k && (S.copro(k.copro) || {}).actif) connaitre(l.rae, k.copro, null); }
    const res = [];
    for (const l of lignes) {
      const z = sansZeros(l.compte_facturation), c = copro[l.rae];
      if (!c || ambigu.has(l.rae) || attache.has(z) || exclus.has(z)) continue;
      const x = c.source || {};
      const k = { id: S.nouvelId(), compte: l.compte_facturation, copro: c.num, reference: x.objet || l.nom_site || "", statut: x.statut || "", compte_charge: x.compte_charge || "",
        objet: x.objet || "", fournisseur: x.fournisseur || "EDF", energie: "Électricité", pdl_ics: x.pdl || "", origine: `même PDL ${l.rae}${x.contrat ? ` (contrat ICS ${x.contrat})` : ""}` };
      S.db.edf_comptes.push(k); attache.set(z, k);
      res.push({ compte: l.compte_facturation, copro: c.num, pdl: l.rae, contrat: x.contrat || "" });
    }
    return res;
  };

  /** Clé de répartition d'après le compte de charge du contrat : ligne de ce compte dans le budget le plus récent de la copro. */
  /** Incohérence de compte de charge d'un PDL : la compta impute ses factures (montants identiques) sur un autre compte que celui saisi
      ou celui du contrat ICS (compte non partagé). Renvoie le message, ou "". */
  M.incoherenceCompteCharge = (numero, rae, compteFacturation, deductions = null) => {
    const d = (deductions || M.deductionsPdl(numero))[rae];
    if (!d || d.origine !== "montants" || !d.compte) return "";
    const saisi = (M.operat(numero).compte_pdl || {})[rae];
    const k = S.db.edf_comptes.find((x) => x.copro === numero && sansZeros(x.compte) === sansZeros(compteFacturation));
    const partage = M.pdlDuCompte ? M.pdlDuCompte(compteFacturation).length > 1 : false;
    const ref = saisi || (!partage && k && k.compte_charge) || "";
    if (!ref || ref === d.compte) return "";
    return `compta : factures de ce PDL imputées en ${d.compte} (montants identiques), pas en ${ref} (${saisi ? "compte saisi" : "contrat ICS"})`;
  };
  /** Clé de la ligne d'un compte de charge dans le budget le plus récent de la copro qui la contient. */
  M.cleDuCompteCharge = (numero, compteCharge) => {
    if (!compteCharge) return null;
    const budgets = Object.values(S.db.budgets).filter((b) => b.copro === numero).sort((a, b) => String(b.date_fin || b.exercice).localeCompare(String(a.date_fin || a.exercice)));
    for (const b of budgets) { const l = b.lignes.find((x) => x.compte === compteCharge && x.cle); if (l) return String(l.cle).trim(); }
    return null;
  };
  /** Comptes de charge (60…) des budgets de la copro, pour la saisie : {compte, libelle, cle}. */
  M.comptesChargeCopro = (numero) => {
    const res = new Map();
    for (const b of Object.values(S.db.budgets).filter((x) => x.copro === numero).sort((a, b2) => String(a.date_fin).localeCompare(String(b2.date_fin))))
      for (const l of b.lignes) if (/^60/.test(l.compte || "")) res.set(l.compte, { compte: l.compte, libelle: l.libelle, cle: l.cle });
    return [...res.values()].sort((a, b) => a.compte.localeCompare(b.compte));
  };
  /** Saisie du compte de charge d'un PDL : uniquement un compte présent dans la compta (budgets / charges) de la copro ; "" efface. */
  M.definirCompteChargePdl = (numero, rae, compte) => {
    const v = String(compte || "").replace(/\s/g, "");
    if (v && !M.comptesChargeCopro(numero).some((x) => x.compte === v)) throw new Error(`Le compte ${v} n'existe pas dans la compta de la copro ${numero}.`);
    const cp = { ...(M.operat(numero).compte_pdl || {}) };
    if (v) cp[rae] = v; else delete cp[rae];
    M.majOperat(numero, { compte_pdl: cp });
    return v;
  };
  M.cleContratEdf = (numero, compte) => {
    const k = S.db.edf_comptes.find((x) => x.copro === numero && sansZeros(x.compte) === sansZeros(compte));
    if (!k || !k.compte_charge) return null;
    const budgets = Object.values(S.db.budgets).filter((b) => b.copro === numero).sort((a, b) => String(b.date_fin || b.exercice).localeCompare(String(a.date_fin || a.exercice)));
    for (const b of budgets) { const l = b.lignes.find((x) => x.compte === k.compte_charge && x.cle); if (l) return String(l.cle).trim(); }
    return null;
  };
  M.cleCompte = (numero, compte) => M.operat(numero).cle_compte[compte] || M.cleContratEdf(numero, compte) || M.cleParDefaut(numero);
  /** Origine de la clé d'un compteur : choisie à la main, déduite du compte de charge, ou clé par défaut. */
  M.origineCleCompte = (numero, compte) => (M.operat(numero).cle_compte[compte] ? "manuelle" : M.cleContratEdf(numero, compte) ? "compte de charge" : "par défaut");

  /** Clés déduites PDL par PDL (un compte de facturation peut regrouper des PDL imputés sur des comptes de charge différents) :
      1) montants : la somme TTC d'un ou plusieurs PDL de la synthèse EDF d'une année = les charges d'une ligne 602… du budget de cette année ;
      2) libellé : PDL d'ascenseur (« ASC ») → ligne 602… « ASCENSEUR ». Renvoie { rae: { cle, origine, compte } }. */
  M.deductionsPdl = (numero) => {
    const res = {};
    const comptes = new Set(S.db.edf_comptes.filter((k) => k.copro === numero).map((k) => sansZeros(k.compte)));
    for (const a of Object.keys(S.db.edf_conso).sort().reverse()) {
      const b = S.db.budgets[`${numero}|${a}`];
      if (!b) continue;
      const lignes = M.lignesElectricite(numero, b).filter((l) => l.cle && l.charges > 0).sort((x, y) => y.charges - x.charges);
      const pdl = S.db.edf_conso[a].filter((l) => comptes.has(sansZeros(l.compte_facturation)) && !res[l.rae]);
      if (pdl.length > 12) continue;
      const libres = new Set(pdl);
      for (const l of lignes) {
        const liste = [...libres], tol = Math.max(2, l.charges * 0.005);
        let trouve = null;
        for (let m = 1; m < 1 << liste.length && !trouve; m++) {
          const sel = liste.filter((_, i) => m & (1 << i));
          if (Math.abs(sel.reduce((t, x) => t + (x.total_ttc || 0), 0) - l.charges) <= tol) trouve = sel;
        }
        if (trouve) for (const x of trouve) { libres.delete(x); res[x.rae] = { cle: String(l.cle).trim(), origine: "montants", compte: l.compte }; }
      }
      const asc = lignes.find((l) => /ASCENSEUR/i.test(l.libelle));
      if (asc) for (const x of libres) if (/\bASC\b|ASCENSEUR/i.test(x.nom_site)) res[x.rae] = { cle: String(asc.cle).trim(), origine: "libellé", compte: asc.compte };
    }
    return res;
  };
  /** Clé d'un PDL (ligne de synthèse EDF) : choisie pour ce PDL, choisie pour son compte, déduite (montants, libellé, compte de charge) ou par défaut. */
  M.clePdl = (numero, l, deductions = null) => {
    const o = M.operat(numero);
    if ((o.cle_pdl || {})[l.rae]) return { cle: o.cle_pdl[l.rae], origine: "manuelle" };
    const k = S.db.edf_comptes.find((x) => x.copro === numero && sansZeros(x.compte) === sansZeros(l.compte_facturation));
    const compte = k ? k.compte : l.compte_facturation;
    if (o.cle_compte[compte]) return { cle: o.cle_compte[compte], origine: "manuelle" };
    const saisi = (o.compte_pdl || {})[l.rae]; // compte de charge saisi pour ce PDL
    if (saisi) { const cs = M.cleDuCompteCharge(numero, saisi); if (cs) return { cle: cs, origine: "compte de charge saisi", compte: saisi }; }
    const d = (deductions || M.deductionsPdl(numero))[l.rae];
    if (d) return d;
    const cc = M.cleContratEdf(numero, compte);
    return cc ? { cle: cc, origine: "compte de charge" } : { cle: M.cleParDefaut(numero), origine: "par défaut" };
  };

  const indexer = (lignes) => {
    const res = {};
    for (const l of lignes || []) (res[sansZeros(l.compte_facturation)] = res[sansZeros(l.compte_facturation)] || []).push(l);
    return res;
  };
  const somme = (pdl, champ) => pdl.reduce((t, l) => t + (l[champ] || 0), 0);

  /** Raison de détacher probablement un compte : absent de la dernière synthèse EDF et contrat terminé, hors export ICS ou de gaz. */
  M.raisonDetacher = (x, dernier) => {
    if (dernier === undefined || x.conso[dernier] !== null) return "";
    const res = M.resiliationCompte ? M.resiliationCompte(x.compte) : "";
    if (res) return `résilié le ${U.jjmmaaaa(res)} (factures EDF)`;
    if (x.remplace_par) return `ancien n° : le PDL ${x.pdl_remplace} est suivi sur le compte ${x.remplace_par}`;
    if (x.energie && x.energie !== "Électricité") return x.energie === "Autre" ? `pas un contrat d'électricité${x.compte_charge ? ` (compte ${x.compte_charge})` : ""}` : `contrat ${x.energie.toLowerCase()}, pas d'électricité`;
    const jamais = Object.values(x.conso).every((v) => v === null);
    if (x.statut === "terminé") return `terminé dans ICS, aucune conso EDF ${jamais ? "" : dernier}`.trim();
    if (!x.statut && S.db.contrats_ics) return `hors export ICS, aucune conso EDF ${dernier}`;
    return "";
  };
  /** Tous les compteurs rattachés (portefeuille) : PDL et conso de la dernière synthèse EDF, conso par année, clé et compte probablement à détacher. */
  M.compteursEdf = (portefeuille = "", annee = null, copro = "") => {
    const annees = Object.keys(S.db.edf_conso).map(Number).sort((a, b) => b - a);
    const an = annee || annees[0];
    const index = Object.fromEntries(annees.map((a) => [a, indexer(S.db.edf_conso[a])]));
    const deds = {};
    const compteDuRae = {}; // PDL → compte de facturation dans la dernière synthèse EDF
    for (const l of S.db.edf_conso[an] || []) compteDuRae[l.rae] = sansZeros(l.compte_facturation);
    return S.db.edf_comptes.filter((k) => !copro || k.copro === copro).map((k) => ({ k, c: S.copro(k.copro) })).filter(({ c }) => c && (copro || c.actif) && (!portefeuille || M.dansPortefeuille(c, portefeuille))) // copros perdues : ignorées
      .map(({ k, c }) => {
        const z = sansZeros(k.compte);
        const pdl = (index[an] || {})[z] || [];
        const conso = Object.fromEntries(annees.map((a) => [a, index[a][z] ? somme(index[a][z], "conso_kwh") : null]));
        const ded = deds[c.numero] = deds[c.numero] || M.deductionsPdl(c.numero);
        const x = { ...k, c, annee: an, annees, pdl: pdl.map((l) => ({ ...l, ...M.clePdl(c.numero, l, ded) })), conso, kwh: somme(pdl, "conso_kwh"), ttc: somme(pdl, "total_ttc"),
          cle: M.cleCompte(c.numero, k.compte), origine_cle: M.origineCleCompte(c.numero, k.compte) };
        if (!pdl.length) {
          const raes = new Set([k.pdl_ics, ...annees.flatMap((a) => (index[a][z] || []).map((l) => l.rae))].filter(Boolean));
          const autre = [...raes].map((r) => compteDuRae[r]).find((cz) => cz && cz !== z);
          if (autre) { x.remplace_par = autre; x.pdl_remplace = [...raes].find((r) => compteDuRae[r] === autre); }
        }
        if (!pdl.length && k.pdl_ics) { const d = M.clePdl(c.numero, { rae: k.pdl_ics, compte_facturation: k.compte }, ded); Object.assign(x, { pdl_connu: k.pdl_ics, cle: d.cle, origine_cle: d.origine }); }
        x.a_detacher = x.garde ? "" : M.raisonDetacher(x, an); // « garder » : ne plus proposer de détacher / vérifier
        x.a_verifier = !x.garde && !x.a_detacher && an !== undefined && (x.conso[an] === null ? `actif dans ICS mais absent de la synthèse EDF ${an}` : x.statut === "terminé" ? `terminé dans ICS mais consomme encore en ${an}` : "");
        return x;
      }).sort((a, b) => a.copro.localeCompare(b.copro) || String(a.compte).localeCompare(String(b.compte)));
  };
  /** Points à traiter sur les compteurs d'une copro (bloc de la synthèse) : PDL sans clé déduite, comptes à détacher ou à vérifier. */
  M.compteursATraiter = (numero) => M.compteursEdf("", null, numero).flatMap((x) => {
    const sansPdl = (type, motif) => [{ x, l: x.pdl_connu ? { rae: x.pdl_connu, nom_site: x.objet || x.reference || "", conso_kwh: null } : null, type, motif, cle: x.cle }];
    const incoherences = x.pdl.map((l) => ({ l, m: M.incoherenceCompteCharge(x.copro, l.rae, x.compte) })).filter((y) => y.m)
      .map(({ l, m }) => ({ x, l, type: "verifier", motif: `compte de charge incohérent — ${m}`, cle: l.cle }));
    if (incoherences.length) return incoherences;
    if (x.a_detacher || x.a_verifier) return x.pdl.length && !x.a_detacher ? x.pdl.map((l) => ({ x, l, type: "verifier", motif: x.a_verifier, cle: l.cle })) : sansPdl(x.a_detacher ? "detacher" : "verifier", x.a_detacher || x.a_verifier);
    if (x.statut === "terminé") return [];
    if (!x.pdl.length) return x.origine_cle === "par défaut" && x.pdl_connu ? sansPdl("cle", "clé à choisir") : [];
    return x.pdl.filter((l) => l.origine === "par défaut").map((l) => ({ x, l, type: "cle", motif: x.pdl.length > 1 ? `clé à choisir · ${x.pdl.length} PDL sur ce compte` : "clé à choisir", cle: l.cle }));
  });
  /** Comptes détachés à la main : plus jamais rattachés automatiquement (contrats ICS, PDL), sauf rattachement manuel. */
  M.comptesExclus = () => new Set(S.db.edf_exclus || []);
  M.detacherComptesEdf = (ids) => {
    const set = new Set(ids.map(String));
    const avant = S.db.edf_comptes.length;
    S.db.edf_exclus = [...new Set([...(S.db.edf_exclus || []), ...S.db.edf_comptes.filter((k) => set.has(String(k.id))).map((k) => sansZeros(k.compte))])];
    S.db.edf_comptes = S.db.edf_comptes.filter((k) => !set.has(String(k.id)));
    S.journal("Compteurs EDF", "", `${avant - S.db.edf_comptes.length} compte(s) détaché(s)`);
    S.sauver();
    return avant - S.db.edf_comptes.length;
  };

  // ------------------------------------------------------------------ consommations sur l'exercice comptable
  const jour = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
  /** Synthèses EDF disponibles : années civiles (edf_conso) et autres périodes (edf_periodes), avec index par compte. */
  M.periodesEdf = () => [
    ...Object.entries(S.db.edf_conso).map(([a, lignes]) => ({ du: `${a}-01-01`, au: `${a}-12-31`, lignes })),
    ...Object.values(S.db.edf_periodes || {}),
  ].map((p) => ({ ...p, d: jour(p.du), f: jour(p.au) + 1, index: indexer(p.lignes) }));

  /** Consommation électrique de comptes (n° de facturation) entre deux dates. Chaque tranche de la période est prise dans la synthèse
      EDF la plus courte qui la couvre, au prorata des jours : exact si les synthèses tombent dans la période (mois, exercice), estimé sinon. */
  M.consoEdfPeriode = (comptes, debut, fin, periodes = M.periodesEdf()) => {
    const zs = [...comptes].map(sansZeros), d0 = jour(debut), f0 = jour(fin) + 1;
    const utiles = periodes.filter((p) => p.d < f0 && p.f > d0);
    const bornes = [...new Set([d0, f0, ...utiles.flatMap((p) => [p.d, p.f])])].filter((b) => b >= d0 && b <= f0).sort((a, b) => a - b);
    let kwh = 0, ttc = 0, couverts = 0, exact = true;
    const vus = new Set();
    for (let i = 0; i + 1 < bornes.length; i++) {
      const a = bornes[i], b = bornes[i + 1];
      // synthèse incluse dans la période d'abord (ex. 12 mois glissants = l'exercice), puis la plus courte
      const dedans = (x) => (x.d >= d0 && x.f <= f0 ? 0 : 1);
      const p = utiles.filter((x) => x.d <= a && x.f >= b).sort((x, y) => dedans(x) - dedans(y) || (x.f - x.d) - (y.f - y.d) || y.d - x.d)[0];
      if (!p) continue;
      const part = (b - a) / (p.f - p.d);
      for (const z of zs) for (const l of p.index[z] || []) { kwh += (l.conso_kwh || 0) * part; ttc += (l.total_ttc || 0) * part; }
      couverts += b - a; vus.add(p);
      if (p.d < d0 || p.f > f0) exact = false;
    }
    return { kwh: Math.round(kwh), ttc: U.arrondi(ttc, 2), couverture: couverts / (f0 - d0), exact: exact && couverts === f0 - d0,
      sources: [...vus].map((p) => (p.du.slice(5) === "01-01" && p.au.slice(5) === "12-31" ? `EDF ${p.du.slice(0, 4)}` : `${U.jjmmaaaa(p.du)}–${U.jjmmaaaa(p.au)}`)) };
  };
  /** Années civiles entièrement couvertes par des synthèses plus courtes (trimestres, mois) et sans synthèse annuelle :
      reconstituées dans edf_conso[année] (PDL par PDL) pour le décret tertiaire et les colonnes par année. */
  M.agregerAnneesEdf = () => {
    if (!S.db.edf_agreges) S.db.edf_agreges = {};
    const courtes = Object.values(S.db.edf_periodes || {}).map((p) => ({ ...p, d: jour(p.du), f: jour(p.au) + 1 }));
    const annees = [...new Set(courtes.flatMap((p) => [p.du.slice(0, 4), p.au.slice(0, 4)]))];
    const res = [];
    for (const a of annees) {
      if (S.db.edf_conso[a] && !S.db.edf_agreges[a]) continue; // vraie synthèse annuelle : prioritaire
      const d0 = jour(`${a}-01-01`), f0 = jour(`${a}-12-31`) + 1;
      const dedans = courtes.filter((p) => p.d >= d0 && p.f <= f0);
      const bornes = [...new Set([d0, f0, ...dedans.flatMap((p) => [p.d, p.f])])].sort((x, y) => x - y);
      const lignes = {}, sources = new Set();
      let complet = true;
      for (let i = 0; i + 1 < bornes.length && complet; i++) {
        const p = dedans.filter((x) => x.d <= bornes[i] && x.f >= bornes[i + 1]).sort((x, y) => (x.f - x.d) - (y.f - y.d))[0];
        if (!p) { complet = false; break; }
        const part = (bornes[i + 1] - bornes[i]) / (p.f - p.d);
        sources.add(`${U.jjmmaaaa(p.du)}–${U.jjmmaaaa(p.au)}`);
        for (const l of p.lignes) {
          const x = lignes[l.rae] = lignes[l.rae] || { ...l, conso_kwh: 0, total_htva: 0, total_tva: 0, total_ttc: 0 };
          Object.assign(x, { compte_facturation: l.compte_facturation, nom_site: l.nom_site, adresse: l.adresse });
          for (const k of ["conso_kwh", "total_htva", "total_tva", "total_ttc"]) x[k] += (l[k] || 0) * part;
        }
      }
      if (!complet) continue;
      S.db.edf_conso[a] = Object.values(lignes).map((x) => ({ ...x, conso_kwh: Math.round(x.conso_kwh), total_htva: U.arrondi(x.total_htva, 2), total_tva: U.arrondi(x.total_tva, 2), total_ttc: U.arrondi(x.total_ttc, 2) }));
      S.db.edf_agreges[a] = [...sources].join(", ");
      res.push(a);
    }
    return res;
  };
  /** Couverture des synthèses EDF par trimestre : « annee » (synthèse annuelle), « periode » (trimestre / mois importés) ou "". */
  M.couvertureEdf = (nb = 6, aujourdhui = U.aujourdhui()) => {
    const courtes = Object.values(S.db.edf_periodes || {}).map((p) => ({ d: jour(p.du), f: jour(p.au) + 1 }));
    const fin = Number(aujourdhui.slice(0, 4));
    return Array.from({ length: nb }, (_, i) => fin - i).map((a) => ({ annee: a, agregee: (S.db.edf_agreges || {})[a] || "",
      trimestres: [1, 2, 3, 4].map((t) => {
        const du = U.iso(a, 3 * t - 2, 1), au = new Date(Date.UTC(a, 3 * t, 0)).toISOString().slice(0, 10);
        if (au >= aujourdhui) return "futur";
        if (S.db.edf_conso[a] && !(S.db.edf_agreges || {})[a]) return "annee";
        const d0 = jour(du), f0 = jour(au) + 1;
        // couvert si chaque jour du trimestre est dans une synthèse courte
        const bornes = [...new Set([d0, f0, ...courtes.flatMap((p) => [p.d, p.f])])].filter((b) => b >= d0 && b <= f0).sort((x, y) => x - y);
        for (let i = 0; i + 1 < bornes.length; i++) if (!courtes.some((p) => p.d <= bornes[i] && p.f >= bornes[i + 1])) return "";
        return "periode";
      }) }));
  };
  /** Premier jour ouvré d'un mois (week-ends, 1er janvier, lundi de Pâques, 1er et 8 mai exclus). */
  M.premierJourOuvre = (annee, mois) => {
    const paques = (() => { const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h2 = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h2 - k) % 7,
      m = Math.floor((a + 11 * h2 + 22 * l) / 451), mo = Math.floor((h2 + l - 7 * m + 114) / 31), j = ((h2 + l - 7 * m + 114) % 31) + 1;
      return new Date(Date.UTC(annee, mo - 1, j + 1)).toISOString().slice(0, 10); })(); // lundi de Pâques
    const feries = new Set([`${annee}-01-01`, `${annee}-05-01`, `${annee}-05-08`, paques]);
    for (let j = 1; ; j++) {
      const d = new Date(Date.UTC(annee, mois - 1, j)), iso = d.toISOString().slice(0, 10);
      if (d.getUTCDay() % 6 && !feries.has(iso)) return iso;
    }
  };
  /** Rappel trimestriel : dès le premier jour ouvré du trimestre, télécharger la synthèse EDF des 12 mois glissants qui finissent
      avec le trimestre écoulé (= exercices clos ce trimestre), jusqu'à son import. Une synthèse du seul trimestre convient aussi. */
  M.rappelEdfTrimestre = (aujourdhui = U.aujourdhui()) => {
    const a = Number(aujourdhui.slice(0, 4)), m = Number(aujourdhui.slice(5, 7));
    const debutT = Math.floor((m - 1) / 3) * 3 + 1;
    if (aujourdhui < M.premierJourOuvre(a, debutT)) return null;
    const [ap, mp] = debutT === 1 ? [a - 1, 10] : [a, debutT - 3];
    const du = U.iso(ap, mp, 1), au = new Date(Date.UTC(ap, mp + 2, 0)).toISOString().slice(0, 10);
    if (M.periodesEdf().some((p) => p.du <= du && p.au >= au)) return null;
    return { trimestre: `T${(mp + 2) / 3} ${ap}`, du: U.iso(mp === 10 ? ap : ap - 1, mp === 10 ? 1 : mp + 3, 1), au };
  };

  /** Consommations d'électricité des parties communes par exercice comptable (exo et précédents) + charges d'électricité comptabilisées. */
  M.consoExercices = (c, exo, n = 5) => {
    const comptes = S.db.edf_comptes.filter((k) => k.copro === c.numero && (!k.energie || k.energie === "Électricité"));
    if (!comptes.length) return [];
    const periodes = M.periodesEdf();
    const res = [];
    for (let i = n - 1; i >= 0; i--) {
      const e = exo.decale(-i);
      const x = M.consoEdfPeriode(comptes.map((k) => k.compte), e.debut, e.fin, periodes);
      if (x.couverture < 0.5) continue;
      const b = S.db.budgets[`${c.numero}|${e.libelle}`];
      const lignes = M.lignesElectricite(c.numero, b);
      res.push({ exercice: e.libelle, debut: e.debut, fin: e.fin, ...x, comptabilise: lignes.length ? U.arrondi(lignes.reduce((t, l) => t + (l.charges || 0), 0), 2) : null });
    }
    if (!res.some((x) => x.kwh)) return [];
    res.forEach((x, i) => { const p = res[i - 1]; x.evol = p && p.kwh ? x.kwh / p.kwh - 1 : null; x.prix = x.kwh ? (x.ttc / x.kwh) * 1000 : null; });
    return res;
  };
})(globalThis.K = globalThis.K || {});
