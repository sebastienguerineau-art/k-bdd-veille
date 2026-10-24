/* Intégration des extractions du logiciel métier (remplace les requêtes Power Query).
   Chaque format a un « parseur » pur (testé) et une fonction d'import dans la base. */
(function (K) {
  "use strict";
  const U = K.U, E = K.E, S = K.S;
  const I = {};
  const TOTAL_GENERAL = "T O T A L  G E N E R A L";
  I.TOTAL_GENERAL = TOTAL_GENERAL;
  const stem = (nom) => String(nom).split(/[\\/]/).pop().replace(/\.[^.]+$/, "");

  // ======================================================================== BUDGETS / CHARGES
  /** '8059 2025.csv' -> ['8059','2025'] ; '9016 20252026.csv' -> ['9016','2025/2026'] */
  I.parseNomBudget = (nom) => {
    const m = stem(nom).match(/^\s*(\d{4})\s+(\d{4}(?:\d{4})?)\b/);
    return m ? [m[1], E.libelleDepuisCle(m[2])] : null;
  };

  /** Extraction « Budget prévisionnel / charges » : libellé ; budget N ; charges N ; « REGUL BUD » (budget proposé, comparé au budget N dans le bloc « Budgets N / N+2 ») ; budget N+2 (souvent absent).
      Clef = ligne dont le 5e caractère est un espace ; compte = 8 premiers caractères si la ligne commence par 6 ou 7. */
  I.parseBudget = (contenu) => {
    const lignes = U.lireCsv(contenu, 5);
    const entete = { debut: null, fin: null };
    for (const l of lignes.slice(0, 3)) for (const c of l.slice(1, 3)) {
      const m = c.match(/^(Du|Au)\s+(\d{2}\/\d{2}\/\d{4})/);
      if (m) entete[m[1] === "Du" ? "debut" : "fin"] = U.dateFr(m[2]);
    }
    const res = [];
    let cle = "", code = "", operation = "";
    lignes.slice(3).forEach((l, ordre) => {
      const lib = l[0];
      if (!lib) return;
      if (lib.length > 5 && lib[4] === " " && /^\d{4}$/.test(lib.slice(0, 4))) { cle = lib.slice(5).trim(); code = lib.slice(0, 4); operation = ""; return; }
      // travaux votés en AG : bloc « * * AG 09/12/2025 - RESO 07 & 08 * * » … « * * Total AG … --> »
      const bloc = lib.trim().match(/^\*\s*\*\s*(.*?)\s*(\*\s*\*|-->)\s*$/);
      if (bloc) { operation = /^Total\b/i.test(bloc[1]) ? "" : bloc[1]; return; }
      const v = { budget: U.nombreFr(l[1]), charges: U.nombreFr(l[2]), budget_n1: U.nombreFr(l[3]), budget_n2: U.nombreFr(l[4]) };
      if ("67".includes(lib[0]) && /^\d{8}/.test(lib)) res.push({ ordre, cle, cle_code: code, compte: lib.slice(0, 8), libelle: lib.slice(9).trim(), total: "", ...v, ...(operation ? { travaux: operation } : {}) });
      else if (lib.trim() === TOTAL_GENERAL) res.push({ ordre, cle: "", compte: "", libelle: TOTAL_GENERAL, total: "general", ...v });
      else if (lib.startsWith("Total ")) res.push({ ordre, cle: lib.slice(6).trim(), compte: "", libelle: lib, total: "cle", ...v });
    });
    return { entete, lignes: I.blocsTravaux(res) };
  };
  /** Un bloc « * * … * * » n'est une opération de travaux que s'il contient au moins un compte 67 : sinon ses lignes restent des charges courantes. */
  I.blocsTravaux = (lignes) => {
    const avec67 = new Set(lignes.filter((l) => l.travaux && /^67/.test(l.compte || "")).map((l) => `${l.cle}|${l.travaux}`));
    for (const l of lignes) if (l.travaux && !avec67.has(`${l.cle}|${l.travaux}`)) delete l.travaux;
    return lignes;
  };

  I.importerBudget = (nom, contenu) => {
    const id = I.parseNomBudget(nom);
    if (!id) throw new Error(`Nom de fichier inattendu « ${nom} » (attendu : '8059 2025.csv' ou '9016 20252026.csv')`);
    const [copro, exercice] = id;
    const { entete, lignes } = I.parseBudget(contenu);
    S.db.budgets[`${copro}|${exercice}`] = { copro, exercice, date_debut: entete.debut || "", date_fin: entete.fin || "", fichier: nom, lignes, importe_le: U.horodatage() };
    return lignes.length;
  };

  // ======================================================================== CONTRÔLE RAPPRO BQ
  I.parseRapprochement = (contenu) => {
    const res = [];
    for (const l of U.lireCsv(contenu, 7).slice(3)) {
      if (!/^\d{5}-\d{5}-\w{11,13}$/.test(l[0] || "")) continue;
      const compta = (l[5] || "").split(/\s+/).filter(Boolean);
      res.push({
        rib: l[0], date_releve: U.dateFr(l[1]) || "", solde_releve: U.nombreFr(l[2]), non_rapproche: U.compacter(l[3]),
        solde_final: U.nombreFr(l[4]), solde_comptable: compta[0] !== undefined ? U.nombreFr(compta[0]) : null,
        ecart: compta[1] !== undefined ? U.nombreFr(compta[1]) : null, libelle: U.compacter(l[6]),
      });
    }
    return res;
  };
  /** Remplace l'état du contrôle rappro (tous les CSV du dossier, triés par nom comme Power Query). */
  I.importerRapprochement = (fichiers) => {
    const res = [];
    for (const f of fichiers.slice().sort((a, b) => a.nom.localeCompare(b.nom))) {
      for (const r of I.parseRapprochement(f.contenu)) res.push({ ...r, id: res.length + 1, fichier: f.nom });
    }
    // nouveau contenu (et non simple relecture du même fichier) : les retards déclarés « normaux » sont à revoir
    const signature = res.map((r) => [r.rib, r.date_releve, r.solde_releve, r.solde_comptable, r.ecart].join("|")).join(";");
    if (signature !== S.db.rappro_signature) { S.db.rappro_justifs = {}; S.db.rappro_signature = signature; }
    S.db.rapprochements = res;
    S.db.rappro_importe_le = U.horodatage();
    return res.length;
  };

  // ======================================================================== LISTE DES COPROS ICS
  I.typeDepuisNom = (nom) => {
    const n = U.normaliser(nom);
    if (/\bA\.?F\.?U\.?L\b/.test(n)) return "AFUL";
    if (/\bASL\b/.test(n)) return "ASL";
    return "";
  };
  I.parseListeCopros = (contenu) => U.lireCsv(contenu, 4).slice(1)
    .map((l) => U.compacter(l[0]).match(/^(\d{4})\s+(.+)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]);

  I.nouvelleCopro = (numero, champs = {}) => Object.assign({
    numero, type: "", nom: "", nom_ics: "", comptable: "", gestionnaire: "", assistante: "", adresse: "", code_postal: "", ville: "",
    lots_surface: "", quantite: null, decret_tertiaire: false, exercice: "", honos_ttc: null, compte_bancaire: "", compte_fonds_travaux: "", bic: "",
    lien_compta: "", actif: true, a_verifier: false, origine: "", notes: "", modifie_le: U.horodatage(),
  }, champs);

  /** Met à jour le nom ICS et crée les copros manquantes (gestion à l'échelle du cabinet). */
  I.importerListeCopros = (contenu) => {
    let crees = 0;
    for (const [numero, nom] of I.parseListeCopros(contenu)) {
      const c = S.db.copros[numero];
      // la liste ICS est indexée par n° de copro : son nom ICS est sûr (il suit les renommages faits dans ICS)
      if (c) { c.nom_ics = nom; c.nom_ics_valide = true; if (!c.nom) c.nom = nom; continue; }
      S.db.copros[numero] = I.nouvelleCopro(numero, {
        nom, nom_ics: nom, nom_ics_valide: true, type: I.typeDepuisNom(nom), actif: !/IMM SOLD/i.test(nom), a_verifier: true, origine: "Liste des copros ICS",
      });
      crees++;
    }
    return crees;
  };

  // ======================================================================== PORTEFEUILLES
  /** COMPTABLES.csv / GESTIONNAIRES.csv : une colonne par personne, 'x' sur la ligne de la copro. */
  I.parsePortefeuille = (contenu) => {
    const lignes = U.lireCsv(contenu);
    if (lignes.length < 2) return { personnes: [], affect: {} };
    const [entete, sous] = lignes;
    const cols = [];
    for (let i = 2; i < entete.length; i++) if (entete[i].trim()) cols.push([i, entete[i].trim(), (sous[i] || "").trim()]);
    const affect = {};
    for (const l of lignes.slice(2)) {
      let numero = U.numeroCopro(l[1]);
      if (!numero) { const m = (l[0] || "").match(/^(\d{4})/); numero = m ? m[1] : null; }
      if (!numero) continue;
      cols.forEach(([i], k) => { if ((l[i] || "").trim().toLowerCase() === "x") affect[numero] = k; });
    }
    return { personnes: cols.map(([, nom, prenom]) => [nom, prenom]), affect };
  };

  const prenomDepuisNom = (role, nom) => {
    for (const p of S.db.personnes.filter((x) => x.role === role)) {
      if (p.nom && U.normaliser(p.nom) === U.normaliser(nom)) return p.prenom;
      if (nom && (p.emails || "").toLowerCase().includes(nom.toLowerCase())) return p.prenom;
    }
    return null;
  };

  I.importerPortefeuille = (role, contenu, ecraser = false) => {
    const { personnes, affect } = I.parsePortefeuille(contenu);
    const prenoms = personnes.map(([nom, prenom]) => {
      prenom = prenom || prenomDepuisNom(role, nom) || (nom.charAt(0) + nom.slice(1).toLowerCase());
      S.ajouterPersonne(role, prenom, nom);
      return prenom;
    });
    let n = 0;
    for (const [numero, k] of Object.entries(affect)) {
      const c = S.db.copros[numero];
      if (!c) continue;
      if (ecraser || !c[role]) { if (c[role] !== prenoms[k]) n++; c[role] = prenoms[k]; }
    }
    return n;
  };

  // ======================================================================== CATALOGUE COPROPRIÉTAIRES
  I.parseCatalogue = (contenu) => {
    const res = [];
    let courant = null;
    for (const l of U.lireCsv(contenu, 5).slice(1)) {
      const no = l[0], texte = U.compacter(l[1]);
      if (no && /^\d+$/.test(no)) {
        courant = { numero: no.padStart(4, "0"), lignes: texte ? [texte] : [], mandataire: l[2], domiciliation: l[4] };
        res.push(courant);
      } else if (courant) {
        if (texte) courant.lignes.push(texte);
        if (l[4] && !courant.domiciliation) courant.domiciliation = l[4];
      }
    }
    return res;
  };
  I.importerCatalogue = (nom, contenu) => {
    const copro = U.numeroCopro(stem(nom).trim().slice(0, 4));
    if (!copro || !/^\d{4}$/.test(copro)) throw new Error(`Nom de fichier inattendu « ${nom} » (attendu : '<n° copro>.csv')`);
    S.db.catalogue[copro] = I.parseCatalogue(contenu);
    return S.db.catalogue[copro].length;
  };

  // ======================================================================== EXTRACTION COPROPRIÉTAIRES
  I.parseContacts = (contenu) => {
    const res = [];
    let courant = null;
    for (const l of U.lireCsv(contenu, 3).slice(1)) {
      const imm = U.compacter(l[1]), coord = U.compacter(l[2]);
      const m = (l[0] || "").match(/^(\d{6})\s+(.*)$/);
      if (m) {
        const mi = imm.match(/^(\d{4})\b/);
        courant = { code: m[1], nom: U.compacter(m[2]), immeuble: imm, copro: mi ? mi[1] : "", coordonnees: coord ? [coord] : [] };
        res.push(courant);
      } else if (courant && coord) courant.coordonnees.push(coord);
    }
    return res.map((c) => ({ ...c, coordonnees: c.coordonnees.join(" / ") }));
  };
  I.importerContacts = (contenu) => { S.db.contacts = I.parseContacts(contenu); return S.db.contacts.length; };

  // ======================================================================== EDF (DÉCRET TERTIAIRE)
  const lireFeuille = (contenu) => {
    const wb = globalThis.XLSX.read(contenu, { type: "array", cellDates: false });
    const nom = wb.SheetNames.includes("Synthèse ELECTRICITE") ? "Synthèse ELECTRICITE" : wb.SheetNames[0];
    return globalThis.XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null });
  };
  /** Date de la ligne « Période de production » : texte « 2025/01/01 » ou date Excel. */
  const dateEdf = (v) => {
    if (typeof v === "number" && v > 20000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
    const m = String(v ?? "").match(/^(\d{4})[/-](\d{2})[/-](\d{2})/) || String(v ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return !m ? null : m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
  };
  I.parseEdf = (lignesFeuille) => {
    let annee = null, dans = false, du = null, au = null;
    const res = [];
    for (let row of lignesFeuille) {
      row = (row || []).concat(Array(27).fill(null)).slice(0, 27);
      if (!dans) {
        if (String(row[0] || "").startsWith("Période")) {
          const dates = row.slice(1).map(dateEdf).filter(Boolean);
          if (dates.length) { du = dates[0]; au = dates[1] || null; annee = Number(du.slice(0, 4)); }
        }
        if (String(row[0] || "").trim() === "RAE") dans = true;
        continue;
      }
      if (!row[0] && !row[2]) continue;
      res.push({
        rae: U.texteCompte(row[0]), segment: row[1] || "", compte_facturation: U.texteCompte(row[2]),
        compte_commercial: U.texteCompte(row[3]), nom_site: U.compacter(row[4]), adresse: U.compacter(row[5]),
        conso_kwh: U.nombreFr(row[9]), total_htva: U.nombreFr(row[24]), total_tva: U.nombreFr(row[25]), total_ttc: U.nombreFr(row[26]),
      });
    }
    return { annee, du, au, lignes: res };
  };
  /** Synthèse EDF : année civile complète → edf_conso[année] ; autre période (mois, exercice…) → edf_periodes["du|au"]. */
  I.importerEdf = (nom, contenu) => {
    const r = I.parseEdf(lireFeuille(contenu));
    const t = stem(nom).match(/(20\d{2})\D*T([1-4])\b|\bT([1-4])\D*(20\d{2})/i); // « EDF 2025 T1 » si la période n'est pas lue
    const f = stem(nom).match(/\b(\d{2})[ ._-](\d{2})[ ._-](20\d{2})\b/); // « 30 09 2026 » : date de fin, 12 mois glissants
    if (!r.du && f) { const a = Number(f[3]), m = Number(f[2]); r.au = `${f[3]}-${f[2]}-${f[1]}`; r.du = new Date(Date.UTC(a - 1, m, 1)).toISOString().slice(0, 10); }
    if (!r.du && t) { const a = Number(t[1] || t[4]), q = Number(t[2] || t[3]); r.du = U.iso(a, 3 * q - 2, 1); r.au = new Date(Date.UTC(a, 3 * q, 0)).toISOString().slice(0, 10); }
    if (r.du && r.au && !(r.du.slice(5) === "01-01" && r.au.slice(5) === "12-31" && r.du.slice(0, 4) === r.au.slice(0, 4))) {
      if (!S.db.edf_periodes) S.db.edf_periodes = {};
      S.db.edf_periodes[`${r.du}|${r.au}`] = { du: r.du, au: r.au, fichier: stem(nom), lignes: r.lignes };
      if (K.M.agregerAnneesEdf) K.M.agregerAnneesEdf();
      if (K.M.rattacherParPdl) K.M.rattacherParPdl();
      return r.lignes.length;
    }
    const m = stem(nom).match(/(20\d{2})/);
    const annee = r.du ? r.annee : m ? Number(m[1]) : r.annee;
    if (!annee) throw new Error("Impossible de déterminer l'année du fichier EDF (nommez-le 'EDF 2025.xlsx').");
    if ((S.db.edf_agreges || {})[annee] === "factures EDF") return r.lignes.length; // l'export des factures fait foi pour cette année
    S.db.edf_conso[annee] = r.lignes;
    if (S.db.edf_agreges) delete S.db.edf_agreges[annee];
    if (K.M.rattacherParPdl) K.M.rattacherParPdl();
    return r.lignes.length;
  };
  /** [[compte, copro, reference]] — ex-onglet LISTECPTFACTEDF */
  I.importerListeComptesEdf = (lignes) => {
    let n = 0;
    for (const [compteBrut, coproBrut, ref] of lignes) {
      const compte = U.texteCompte(compteBrut), copro = U.numeroCopro(coproBrut);
      if (!compte) continue;
      const ex = S.db.edf_comptes.find((k) => k.compte === compte && k.copro === copro);
      if (ex) ex.reference = ref || ex.reference;
      else S.db.edf_comptes.push({ id: S.nouvelId(), compte, copro, reference: ref || "" });
      n++;
    }
    return n;
  };

  // ======================================================================== IMPAYÉS CIC
  /** Traduction fidèle de la macro Extraire340 (IMPAYES_CIC.xlsm). */
  I.parseLigneCic = (ligne) => {
    if (!ligne.startsWith("340")) return null;
    const pos = ligne.toUpperCase().indexOf("PRL");
    if (pos < 0) return null;
    const zone = ligne.slice(0, pos).slice(40);
    const m = zone.match(/^(.*?)(\d{6})\s+(\d{20,21})([A-Z \-']+)$/);
    let copro = m ? m[1].trim() : "";
    const debiteur = m ? m[4].trim() : "";
    if (/\d{6}$/.test(copro)) copro = copro.slice(0, -6);
    if (copro.startsWith("01")) copro = copro.slice(2);
    copro = copro.trim();
    const d = ligne.trim().slice(-26).slice(0, 6);
    const date = /^\d{6}$/.test(d) ? `${d.slice(0, 2)}/${d.slice(2, 4)}/20${d.slice(4)}` : "";
    const mm = ligne.match(/(\d{8})\s*$/);
    return { date, copro_libelle: copro, debiteur, montant: mm ? Number(mm[1]) / 100 : 0 };
  };
  I.parseCic = (contenu) => U.lireTexte(contenu).split(/\r?\n/).map(I.parseLigneCic).filter(Boolean);

  /** Le relevé CIC tronque le nom (≈24 caractères) : on cherche le nom ICS qui commence pareil. */
  I.trouverCoproParNom = (libelle, copros) => {
    const cible = U.normaliser(libelle);
    if (!cible) return null;
    const m = cible.match(/^(\d{4})\b/);
    if (m && copros.some((c) => c.numero === m[1])) return m[1];
    const cands = [];
    for (const c of copros) for (const nom of new Set([c.nom_ics, c.nom])) {
      const n = U.normaliser(nom);
      if (n && (n === cible || n.startsWith(cible) || cible.startsWith(n))) cands.push([Math.abs(n.length - cible.length), c.numero]);
    }
    cands.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
    return cands.length ? cands[0][1] : null;
  };

  I.importerCic = (nom, contenu) => {
    const copros = S.copros();
    const lignes = I.parseCic(contenu);
    const cles = new Set(S.db.impayes.map((i) => i.cle));
    let nouveaux = 0;
    for (const r of lignes) {
      const cle = `${r.date}|${U.normaliser(r.copro_libelle)}|${U.normaliser(r.debiteur)}|${r.montant.toFixed(2)}`;
      if (cles.has(cle)) continue;
      cles.add(cle);
      S.db.impayes.push({
        id: S.nouvelId(), date_impaye: U.dateFr(r.date) || r.date, copro_libelle: r.copro_libelle,
        copro: I.trouverCoproParNom(r.copro_libelle, copros), debiteur: r.debiteur, montant: r.montant,
        statut: "À traiter", date_relance: "", note: "", fichier: nom, cle, importe_le: U.horodatage(),
      });
      nouveaux++;
    }
    return [lignes.length, nouveaux];
  };

  // ------------------------------------------------------------------ incidents de paiement CIC (Excel « Vos incidents de paiement »)
  /* Deux volets : « Prélèvement émis » = prélèvement d'un copropriétaire rejeté (impayé copropriétaire) ;
     autres types (« Prélèvement à payer », virement…) = incident sur le compte bancaire de la copro (rejet faute de provision…). */
  const lignesClasseur = (contenu) => {
    const wb = globalThis.XLSX.read(contenu, { type: "array", cellDates: false });
    return globalThis.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
  };
  // ------------------------------------------------------------------ production photovoltaïque (rapport mensuel de l'onduleur / supervision)
  /** « Rapport de centrale_<nom> - Année 2026 » : une ligne par mois « 2026-01 » (production PV kWh, capacité kWc, puissance crête kW). */
  I.estProductionPv = (contenu) => {
    try { const l = lignesClasseur(contenu); return l.some((r) => r.some((x) => /production pv/i.test(String(x)))) && l.some((r) => /^\d{4}-\d{2}$/.test(String(r[0]).trim())); }
    catch (e) { return false; }
  };
  I.parseProductionPv = (contenu) => {
    const l = lignesClasseur(contenu);
    const iEntete = l.findIndex((r) => r.some((x) => /production pv/i.test(String(x))));
    if (iEntete < 0) throw new Error("Colonne « Production PV (kWh) » introuvable : est-ce bien un rapport de production de la centrale ?");
    const ent = l[iEntete].map((x) => U.normaliser(x));
    const col = (re) => ent.findIndex((x) => re.test(x));
    const cProd = col(/^PRODUCTION PV/), cOnd = col(/ONDULEUR/), cCap = col(/CAPACITE/), cPic = col(/PUISSANCE CRETE/);
    const nb = (v) => (typeof v === "number" ? v : U.nombreFr(String(v || "").replace(/\s/g, "").replace(/\.(\d+)$/, ",$1")));
    const titre = String((l.slice(0, iEntete).flat().find((x) => /rapport de centrale/i.test(String(x)))) || "");
    const mois = l.slice(iEntete + 1).filter((r) => /^\d{4}-\d{2}$/.test(String(r[0]).trim())).map((r) => ({
      mois: String(r[0]).trim(), kwh: nb(r[cProd]), onduleur: cOnd >= 0 ? nb(r[cOnd]) : null, pic: cPic >= 0 ? nb(r[cPic]) : null, capacite: cCap >= 0 ? nb(r[cCap]) : null }));
    if (!mois.length) throw new Error("Aucune ligne mensuelle « AAAA-MM » dans le rapport de production.");
    return { centrale: titre.replace(/^rapport de centrale_?/i, "").replace(/\s*-\s*Ann[ée]e\s+\d{4}\s*$/i, "").trim(), capacite: mois.find((m) => m.capacite)?.capacite || null, mois };
  };
  /** Ajoute (ou met à jour) les mois du rapport dans la production PV de la copro. */
  I.importerProductionPv = (numero, nom, contenu) => {
    const r = I.parseProductionPv(contenu);
    if (!S.db.pv) S.db.pv = {};
    const pv = S.db.pv[numero] = S.db.pv[numero] || { centrale: "", capacite: null, mois: {}, compte_injection: "", fichiers: [] };
    pv.centrale = r.centrale || pv.centrale; pv.capacite = r.capacite || pv.capacite;
    for (const m of r.mois) pv.mois[m.mois] = { kwh: m.kwh, onduleur: m.onduleur, pic: m.pic };
    pv.fichiers = [...pv.fichiers.filter((f) => f.nom !== nom), { nom, le: U.horodatage(), du: r.mois[0].mois, au: r.mois[r.mois.length - 1].mois }];
    return r.mois.length;
  };

  I.estIncidentsCic = (contenu) => {
    try { const l = lignesClasseur(contenu); return /incidents de paiement/i.test(String((l[0] || [])[0])) || l.some((r) => /^Date de l'incident$/i.test(String(r[0]).trim()) && /^Type d'incident$/i.test(String(r[1]).trim())); }
    catch (e) { return false; }
  };
  // date en texte « 06/10/2026 » ou date Excel (nombre de jours)
  const dateCellule = (v) => (typeof v === "number" ? new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10) : U.dateFr(String(v || "").trim()) || String(v || "").trim());
  // « FR76…0000BANKFRPPXXX » : IBAN suivi du BIC, séparés selon la longueur de l'IBAN du pays
  const LONG_IBAN = { FR: 27, MC: 27, IT: 27, DE: 22, GB: 22, BE: 16, ES: 24, LU: 20, NL: 18, PT: 25, CH: 21, IE: 22, AT: 20 };
  const ibanBic = (v) => {
    const x = String(v || "").replace(/\s/g, "").toUpperCase(), n = LONG_IBAN[x.slice(0, 2)];
    return n && x.length > n && /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(x.slice(n)) ? { iban_contrepartie: x.slice(0, n), bic_contrepartie: x.slice(n) } : { iban_contrepartie: x, bic_contrepartie: "" };
  };
  I.parseIncidentsCic = (contenu) => {
    const l = lignesClasseur(contenu);
    const iEntete = l.findIndex((r) => /^Date de l'incident$/i.test(String(r[0]).trim()));
    if (iEntete < 0) throw new Error("En-tête « Date de l'incident » introuvable : est-ce bien l'export « Vos incidents de paiement » du CIC ?");
    const ix = Object.fromEntries(l[iEntete].map((k, i) => [U.normaliser(k), i]));
    const g = (r, k) => U.compacter(String(r[ix[U.normaliser(k)]] ?? "").replace(/\u00a0/g, " "));
    const nc = (v) => (/^non communiqu/i.test(v) ? "" : v);
    return l.slice(iEntete + 1).filter((r) => g(r, "Date de l'incident")).map((r) => ({
      date: dateCellule(r[ix[U.normaliser("Date de l'incident")]]), type: g(r, "Type d'incident"),
      ...ibanBic(nc(g(r, "Compte de contrepartie"))), contrepartie: nc(g(r, "Contrepartie")),
      montant: (() => { const v = r[ix[U.normaliser("Montant de l'incident")]]; return typeof v === "number" ? v : U.nombreFr(String(v).replace(/\s/g, "").replace(/\.(\d{1,2})$/, ",$1")) ?? 0; })(), compte: g(r, "Compte de l'incident").replace(/\s/g, ""),
      libelle_compte: g(r, "Libellé compte incident"), code_motif: g(r, "Code motif"), motif: g(r, "Motif"),
      date_reglement: dateCellule(r[ix[U.normaliser("Date de règlement")]]),
    }));
  };
  /** Copro d'un compte CIC « 30047 10000 00000000404 » : RIB du contrôle rappro, sinon libellé du compte (« 8024 - ALPHA II … »). */
  I.coproDuCompte = (compte, libelle, copros = S.copros()) => {
    const c = String(compte || "").replace(/\D/g, "");
    if (c.length >= 21) {
      const r = (S.db.rapprochements || []).find((x) => String(x.rib).replace(/\D/g, "").startsWith(c.slice(0, 21)));
      if (r) { const n = U.extraireNumeroCopro(r.libelle, new Set(copros.map((x) => x.numero))); if (n) return n; }
      const c2 = copros.find((x) => [x.compte_bancaire, x.compte_fonds_travaux].some((lib) => lib && (S.db.rapprochements || []).some((y) => U.normaliser(y.libelle) === U.normaliser(lib) && String(y.rib).replace(/\D/g, "").startsWith(c.slice(0, 21)))));
      if (c2) return c2.numero;
    }
    return I.trouverCoproParNom(libelle, copros);
  };
  I.importerIncidentsCic = (nom, contenu) => {
    const copros = S.copros();
    const lignes = I.parseIncidentsCic(contenu);
    S.db.incidents_cic_le = U.aujourdhui(); // efface le rappel du lundi
    if (!S.db.incidents_bq) S.db.incidents_bq = [];
    const cles = new Set([...S.db.impayes.map((i) => i.cle), ...S.db.incidents_bq.map((i) => i.cle)]);
    const r = { lus: lignes.length, impayes: 0, incidents: 0 };
    for (const x of lignes) {
      const cle = `INC|${x.date}|${x.compte}|${U.normaliser(x.contrepartie)}|${x.montant.toFixed(2)}|${x.code_motif}`;
      if (cles.has(cle)) continue;
      cles.add(cle);
      const copro = I.coproDuCompte(x.compte, x.libelle_compte, copros);
      const commun = { id: S.nouvelId(), copro, copro_libelle: x.libelle_compte, montant: x.montant, code_motif: x.code_motif, motif: x.motif, compte: x.compte,
        date_reglement: x.date_reglement, note: "", fichier: nom, cle, importe_le: U.horodatage() };
      if (/pr[ée]l[èe]vement [ée]mis/i.test(x.type)) {
        S.db.impayes.push({ ...commun, date_impaye: x.date, debiteur: x.contrepartie || "N/A", iban_debiteur: x.iban_contrepartie, bic_debiteur: x.bic_contrepartie, statut: "À traiter", date_relance: "", source: "incidents" });
        r.impayes++;
      } else {
        S.db.incidents_bq.push({ ...commun, date: x.date, type: x.type, contrepartie: x.contrepartie, iban_contrepartie: x.iban_contrepartie, bic_contrepartie: x.bic_contrepartie, statut: "À traiter" });
        r.incidents++;
      }
    }
    return r;
  };

  // ======================================================================== DÉTECTION / DOSSIER
  I.TYPES = {
    budget: "Budget / charges (ex. 8059 2025.csv)",
    rapprochement: "Contrôle rappro BQ (CONTROLE RAPPRO.csv)",
    catalogue: "Catalogue copropriétaires (ex. 9189.csv)",
    balance: "Balance comptable (ex. 9226.csv, ou édition globale)",
    liste_copros: "Liste des copros ICS (LISTE COPROS.csv)",
    contacts: "Extraction copropriétaires",
    portefeuille_comptable: "Portefeuille comptables (COMPTABLES.csv)",
    portefeuille_gestionnaire: "Portefeuille gestionnaires (GESTIONNAIRES.csv)",
    edf: "Consommations EDF (EDF 2025.xlsx)",
    factures_edf: "Export des factures EDF (.csv)",
    contrats_ics: "Contrats d'énergie ICS (CONTRATS_ICS.csv)",
    cic: "Impayés CIC (.txt)",
    incidents_cic: "Incidents de paiement CIC (.xlsx)",
    classeur: "Ancien classeur BASE DE DONNÉES.xlsm",
    sauvegarde: "Sauvegarde K-BDD (.json)",
  };

  I.detecterType = (nom, contenu) => {
    const n = U.normaliser(nom.split(/[\\/]/).pop());
    if (n.endsWith(".ZIP") && I.estFacturesEdf && I.estFacturesEdf(contenu)) return "factures_edf";
    if (n.endsWith(".XLSX") && I.estIncidentsCic(contenu)) return "incidents_cic";
    if (n.endsWith(".XLSX")) return "edf";
    if (n.endsWith(".TXT")) return "cic";
    if (n.endsWith(".XLSM")) return "classeur";
    if (n.endsWith(".JSON")) return "sauvegarde";
    if (n.includes("LISTE COPROS")) return "liste_copros";
    if (n.includes("COMPTABLES")) return "portefeuille_comptable";
    if (n.includes("GESTIONNAIRES")) return "portefeuille_gestionnaire";
    if (n.includes("EXTRACTION")) return "contacts";
    if (I.parseNomRelance && I.parseNomRelance(nom)) return "relance";
    if (I.estContratsIcs && I.estContratsIcs(contenu)) return "contrats_ics";
    if (I.estFacturesEdf && I.estFacturesEdf(contenu)) return "factures_edf";
    if (I.estBalance && I.estBalance(contenu)) return "balance";
    if (I.parseNomBudget(nom)) return "budget";
    const debut = U.lireTexte(new Uint8Array(contenu).slice(0, 400));
    if (debut.includes("R I B") || debut.includes("Der releve")) return "rapprochement";
    if (debut.startsWith("No;Nom et adresse")) return "catalogue";
    return null;
  };

  /** Import d'un fichier déposé dans l'application. Renvoie le message à afficher. */
  I.importerFichier = (type, nom, contenu) => {
    switch (type) {
      case "budget": return `${I.importerBudget(nom, contenu)} ligne(s)`;
      case "rapprochement": return `${I.importerRapprochement([{ nom, contenu }])} compte(s)`;
      case "catalogue": return `${I.importerCatalogue(nom, contenu)} copropriétaire(s)`;
      case "liste_copros": return `${I.importerListeCopros(contenu)} copro(s) ajoutée(s)`;
      case "contacts": return `${I.importerContacts(contenu)} fiche(s)`;
      case "portefeuille_comptable": return `${I.importerPortefeuille("comptable", contenu, true)} affectation(s)`;
      case "portefeuille_gestionnaire": return `${I.importerPortefeuille("gestionnaire", contenu, true)} affectation(s)`;
      case "edf": return `${I.importerEdf(nom, contenu)} point(s) de livraison`;
      case "incidents_cic": { const r = I.importerIncidentsCic(nom, contenu); return `${r.lus} incident(s) lu(s) : ${r.impayes} impayé(s) copropriétaire, ${r.incidents} incident(s) sur les comptes des copros (nouveaux)`; }
      case "cic": { const [t, n] = I.importerCic(nom, contenu); return `${t} impayé(s) lu(s), ${n} nouveau(x)`; }
      case "classeur": return K.M.importerClasseur(contenu).join(" ; ");
      case "balance": { const r = I.importerBalance(nom, contenu); return `balance : ${r.copros.join(", ") || "aucune copro reconnue"}${r.inconnues.length ? ` (non reconnues : ${r.inconnues.join(", ")})` : ""}`; }
      case "factures_edf": { const r = I.importerFacturesEdf(nom, contenu); return `${r.factures} ligne(s) de facture (${r.nouvelles} nouvelle(s)), factures du ${U.jjmmaaaa(r.du)} au ${U.jjmmaaaa(r.au)}${r.pdl_rattaches ? `, ${r.pdl_rattaches} compte(s) rattaché(s) par le PDL` : ""}`; }
      case "contrats_ics": { const r = I.importerContratsIcs(nom, contenu); return `${r.contrats} contrat(s) : ${r.confirmes} rattachement(s) confirmé(s), ${r.ajoutes.length} ajouté(s), ${r.conflits.length} conflit(s), ${r.introuvables.length} compte(s) absent(s) de l'export`; }
      case "relance": { const r = I.importerRelance(nom, contenu); return `relances du ${U.jjmmaaaa(r.date)} (${r.type}) : ${r.nb} copropriétaire(s)`; }
      case "sauvegarde": S.restaurer(U.lireTexte(contenu)); return "base restaurée";
      default: throw new Error("Type de fichier non reconnu : choisissez le type dans la liste.");
    }
  };

  const lire = async (fh) => new Uint8Array(await (await fh.getFile()).arrayBuffer());

  /** Équivalent du bouton UPDATE DATA / Actualiser tout : relit toutes les extractions du dossier. */
  I.actualiserDepuisDossier = async (base) => {
    const ressources = (await S.sousDossier(base, "RESSOURCES")) || base;
    const rapport = [];
    let d = await S.sousDossier(ressources, "CATALOGUE COPROPRIETAIRES");
    const liste = d && (await S.fichier(d, "LISTE COPROS.csv"));
    if (liste) {
      const n = I.importerListeCopros(await lire(liste));
      S.journal("Liste des copros ICS", liste.name, `${n} copro(s) ajoutée(s)`);
      rapport.push(`Liste des copros ICS : ${n} copro(s) ajoutée(s)`);
    }
    const pf = await S.sousDossier(base, "PORTEFEUILLES");
    for (const [role, nom] of [["comptable", "COMPTABLES.csv"], ["gestionnaire", "GESTIONNAIRES.csv"]]) {
      const f = pf && (await S.fichier(pf, nom));
      if (f) {
        const n = I.importerPortefeuille(role, await lire(f));
        S.journal(`Portefeuille ${role}s`, f.name, `${n} affectation(s) complétée(s)`);
        rapport.push(`Portefeuille ${role}s : ${n} affectation(s) complétée(s)`);
      }
    }
    d = await S.sousDossier(ressources, "BUDGETS CHARGES");
    if (d) {
      let n = 0;
      for (const f of await S.fichiers(d, (x) => /\.csv$/i.test(x) && I.parseNomBudget(x))) { I.importerBudget(f.name, await lire(f)); n++; }
      S.journal("Budgets / charges", "BUDGETS CHARGES", `${n} fichier(s)`);
      rapport.push(`Budgets / charges : ${n} fichier(s)`);
    }
    d = await S.sousDossier(ressources, "CONTROLE RAPPRO BQ");
    if (d) {
      const fs = await S.fichiers(d, (x) => /\.csv$/i.test(x));
      if (fs.length) {
        const n = I.importerRapprochement(await Promise.all(fs.map(async (f) => ({ nom: f.name, contenu: await lire(f) }))));
        S.journal("Contrôle rappro BQ", fs.map((f) => f.name).join(", "), `${n} compte(s)`);
        rapport.push(`Contrôle rappro : ${n} compte(s) bancaire(s)`);
      }
    }
    d = await S.sousDossier(ressources, "CATALOGUE COPROPRIETAIRES");
    if (d) {
      let n = 0;
      for (const f of await S.fichiers(d, (x) => /^\d{4}\.csv$/i.test(x.trim()))) { I.importerCatalogue(f.name, await lire(f)); n++; }
      S.journal("Catalogue copropriétaires", "CATALOGUE COPROPRIETAIRES", `${n} copro(s)`);
      rapport.push(`Catalogue copropriétaires : ${n} copro(s)`);
    }
    const ext = await S.fichier(ressources, "EXTRACTION COPROPRIETAIRES.csv");
    if (ext) {
      const n = I.importerContacts(await lire(ext));
      S.journal("Extraction copropriétaires", ext.name, `${n} fiche(s)`);
      rapport.push(`Extraction copropriétaires : ${n} fiche(s)`);
    }
    d = await S.sousDossier(ressources, "CONSOS EDF");
    if (d) for (const f of await S.fichiers(d, (x) => /\.(csv|zip)$/i.test(x))) { // export des factures EDF (source principale), CSV ou .zip d'EDF
      const fi = f.getFile ? await f.getFile() : null;
      const empreinte = fi ? `${f.name}|${fi.size}|${fi.lastModified}` : "";
      if (empreinte && (S.db.edf_factures || {}).source === empreinte) continue; // fichier déjà lu, inchangé
      const contenu = await lire(f);
      if (!I.estFacturesEdf || !I.estFacturesEdf(contenu)) { if (/\.csv$/i.test(f.name)) rapport.push(`CONSOS EDF : ${f.name} non reconnu (l'en-tête doit commencer par « date_facture;num_facture;compte_de_facturation »)`); continue; }
      const r = I.importerFacturesEdf(f.name, contenu);
      if (empreinte) S.db.edf_factures.source = empreinte;
      rapport.push(`${f.name} : ${r.factures} ligne(s) de facture, factures du ${U.jjmmaaaa(r.du)} au ${U.jjmmaaaa(r.au)}`);
    }
    if (d) for (const f of await S.fichiers(d, (x) => /\.xlsx$/i.test(x) && !x.startsWith("~$"))) {
      const n = I.importerEdf(f.name, await lire(f));
      S.journal("Consos EDF", f.name, `${n} point(s) de livraison`);
      rapport.push(`${f.name} : ${n} point(s) de livraison`);
    }
    const ci = (await S.fichier(ressources, "CONTRATS_ICS.csv")) || (d && (await S.fichier(d, "CONTRATS_ICS.csv")));
    if (ci && I.importerContratsIcs) {
      const r = I.importerContratsIcs(ci.name, await lire(ci));
      rapport.push(`Contrats ICS : ${r.confirmes} rattachement(s) confirmé(s), ${r.ajoutes.length} ajouté(s), ${r.conflits.length} conflit(s)`);
    }
    const bal = I.importerBalancesDossier ? await I.importerBalancesDossier(base) : null;
    if (bal) rapport.push(`Balances : ${bal.fichiers} fichier(s), ${bal.nouveaux} nouvelle(s) version(s)${bal.inconnues.length ? ` · copro(s) non reconnue(s) : ${bal.inconnues.join(", ")}` : ""}`);
    const rel = I.importerRelancesDossier ? await I.importerRelancesDossier(base) : null;
    if (rel) rapport.push(`Relances : ${rel.nouveaux.length} export(s) importé(s)${rel.deja ? `, ${rel.deja} déjà à jour` : ""}`);
    return rapport;
  };

  K.I = I;
})(globalThis.K = globalThis.K || {});
