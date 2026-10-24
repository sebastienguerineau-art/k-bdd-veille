/* Reprise de l'existant (classeur BASE DE DONNÉES.xlsm + dossier) et déduction des informations
   manquantes pour les copros absentes du tableau. Une saisie n'est jamais écrasée. */
(function (K) {
  "use strict";
  const U = K.U, S = K.S, I = K.I;
  const M = K.M = K.M || {};
  const SOCIETE = /\b(S\.?C\.?I|SAS|SARL|SASU|SNC|SCCV|SA|EURL|SOCIETE|STE|BANQUE|CREDIT|HOLDING|GROUPE|ASSOCIATION|COMMUNE|MUTUELLE|SEM|OFFICE|FONCIERE|INVEST)\b|\(\)/;

  /** Valeur enregistrée d'une cellule (null pour vide ou erreur #N/A, #DIV/0!...). */
  const cellule = (ws, adresse) => {
    const c = ws && ws[adresse];
    if (!c || c.t === "e" || c.v === undefined) return null;
    if (typeof c.v === "string" && c.v.startsWith("#")) return null;
    return c.v;
  };
  const txt = (x) => U.compacter(x ?? "");

  M.importerClasseur = (contenu) => {
    const X = globalThis.XLSX;
    const wb = X.read(contenu, { type: "array", cellFormula: false, bookVBA: false });
    const f = (nom) => wb.Sheets[nom];
    const rapport = [];
    const derniereLigne = (ws) => (ws && ws["!ref"] ? X.utils.decode_range(ws["!ref"]).e.r + 1 : 0);

    // ---- OUTILS : listes, gestionnaires + emails, libellés des comptes bancaires
    const comptesBancaires = {};
    const outils = f("OUTILS");
    if (outils) {
      for (const [col, liste] of [["A", "type_copro"], ["E", "lots_surface"], ["G", "exercice"]]) {
        for (let i = 2; i < 8; i++) {
          const val = txt(cellule(outils, col + i));
          if (val && !S.db.listes[liste].includes(val)) S.db.listes[liste].push(val);
        }
      }
      for (let i = 2; i < 10; i++) {
        const prenom = txt(cellule(outils, "C" + i)), emails = txt(cellule(outils, "D" + i));
        if (prenom) S.ajouterPersonne("gestionnaire", prenom, "", emails, true);
      }
      for (let i = 9; i <= derniereLigne(outils); i++) {
        const num = U.numeroCopro(cellule(outils, "A" + i)), lib = txt(cellule(outils, "B" + i));
        if (num && lib) comptesBancaires[num] = lib;
      }
    }

    // ---- BASE DE DONNÉES
    const bdd = f("BASE DE DONNÉES");
    if (bdd) {
      let n = 0;
      for (let r = 6; r <= derniereLigne(bdd); r++) {
        const val = (col) => cellule(bdd, col + r);
        const numero = U.numeroCopro(val("A"));
        if (!numero) continue;
        const q = val("J"), h = val("M");
        const champs = {
          type: txt(val("B")), nom: txt(val("C")), comptable: txt(val("D")), gestionnaire: txt(val("E")),
          adresse: txt(val("F")), code_postal: U.texteCompte(val("G")), ville: txt(val("H")), lots_surface: txt(val("I")).toUpperCase(),
          quantite: typeof q === "number" ? q : null, decret_tertiaire: ["x", "oui", "1"].includes(String(val("K") ?? "").trim().toLowerCase()),
          exercice: txt(val("L")), honos_ttc: typeof h === "number" ? h : null, compte_bancaire: comptesBancaires[numero] || "",
          origine: "Classeur BASE DE DONNÉES", a_verifier: false,
        };
        S.db.copros[numero] = Object.assign(S.db.copros[numero] || I.nouvelleCopro(numero), champs);
        if (champs.comptable) S.ajouterPersonne("comptable", champs.comptable);
        if (champs.gestionnaire) S.ajouterPersonne("gestionnaire", champs.gestionnaire);
        n++;
      }
      rapport.push(`${n} copro(s) reprises de l'onglet BASE DE DONNÉES (${txt(cellule(bdd, "A1"))})`);
    }

    // ---- LISTECPTFACTEDF
    const edf = f("LISTECPTFACTEDF");
    if (edf) {
      const lignes = [];
      for (let r = 2; r <= derniereLigne(edf); r++) {
        const compte = cellule(edf, "A" + r);
        if (compte !== null) lignes.push([compte, cellule(edf, "B" + r), txt(cellule(edf, "C" + r))]);
      }
      rapport.push(`${I.importerListeComptesEdf(lignes)} compte(s) de facturation EDF (onglet LISTECPTFACTEDF)`);
    }

    // ---- SAVE SYNTH : fiches de synthèse
    const save = f("SAVE SYNTH");
    if (save) {
      let k = 0;
      for (let r = 2; r <= derniereLigne(save); r++) {
        const vals = Array.from({ length: 50 }, (_, c) => String(cellule(save, X.utils.encode_cell({ r: r - 1, c })) ?? "").trim());
        const m = U.compacter(vals[0]).match(/^(\d{4})\s+(\d{4}(?:\/\d{4})?)$/);
        if (!m) continue;
        const bloc = (dc, dm, nb) => Array.from({ length: nb }, (_, i) => ({ compte: vals[dc + i], commentaire: vals[dm + i] }));
        S.db.syntheses[`${m[1]}|${m[2]}`] = {
          donnees: { s1: bloc(1, 10, 9), s2: bloc(19, 28, 9), s3: bloc(37, 42, 5) },
          lien: vals[47], commentaire1: vals[48], commentaire2: vals[49], modifie_le: "reprise Excel",
        };
        k++;
      }
      rapport.push(`${k} fiche(s) de synthèse sauvegardée(s) (onglet SAVE SYNTH)`);
    }

    // ---- PARAMÈTRES SAS
    const sas = f("PARAMÈTRES SAS");
    if (sas) {
      const a = (i) => txt(cellule(sas, "A" + i)), b = (i) => txt(cellule(sas, "B" + i));
      const lignes = [`${a(2)} - ${a(3)} ${a(4)}`, `${a(5)} - ${a(8)} - ${a(9)} - ${a(10)} ${b(10)}`, `${a(6)}${b(6)} ${a(7)}`, `${a(11)} ${b(11)} ${a(12)} ${b(12)}`];
      if (lignes.some((l) => l.replace(/[\s-]/g, ""))) { S.db.parametres.sas_lignes = lignes.map(U.compacter); rapport.push("Mentions légales de la SAS (onglet PARAMÈTRES SAS)"); }
    }
    return rapport;
  };

  // ======================================================================== DÉDUCTIONS
  const ajouterOrigine = (c, texte) => { if (!(c.origine || "").includes(texte)) c.origine = (c.origine ? c.origine + " · " : "") + texte; };

  M.parseAdresseEdf = (adresse) => {
    const p = String(adresse || "").split(";").map((x) => x.trim()).filter(Boolean);
    if (p.length < 2) return null;
    const m = p[p.length - 1].match(/^(\d{5})\s+(.+)$/);
    return m ? [p[0], m[1], m[2]] : null;
  };

  M.deduireInfos = () => {
    const stats = {};
    const plus = (k) => { stats[k] = (stats[k] || 0) + 1; };
    const unAn = U.decalerJours(U.aujourdhui(), -365);
    for (const c of S.copros()) {
      const num = c.numero;
      const budgets = Object.values(S.db.budgets).filter((b) => b.copro === num && b.date_debut).sort((a, b) => b.date_fin.localeCompare(a.date_fin));
      // Exercice comptable : dates des extractions budget / charges
      if (!c.exercice && budgets.length) {
        const b = budgets[0];
        c.exercice = `${b.date_debut.slice(8, 10)}/${b.date_debut.slice(5, 7)} au ${b.date_fin.slice(8, 10)}/${b.date_fin.slice(5, 7)}`;
        c.a_verifier = true; ajouterOrigine(c, "exercice déduit des budgets"); plus("exercice");
      }
      // Honoraires : compte 62110300 du dernier budget (HT) -> TTC
      if (c.honos_ttc === null || c.honos_ttc === undefined || c.honos_ttc === "") {
        for (const b of budgets) {
          const l = b.lignes.find((x) => x.compte === M.COMPTE_HONORAIRES);
          const ht = l && (l.budget_n1 || l.budget);
          if (ht) { c.honos_ttc = U.arrondi(ht * 1.2, 2); c.a_verifier = true; ajouterOrigine(c, "honoraires déduits du budget (compte 62110300 × 1,2)"); plus("honoraires"); }
          break;
        }
      }
      // Adresse : sites EDF rattachés à la copro
      if (!c.adresse) {
        const comptes = new Set(S.db.edf_comptes.filter((k) => k.copro === num).map((k) => k.compte));
        const freq = {};
        for (const lignes of Object.values(S.db.edf_conso)) for (const l of lignes) {
          if (!comptes.has(l.compte_facturation)) continue;
          const p = M.parseAdresseEdf(l.adresse);
          if (p) { const k = JSON.stringify(p); freq[k] = (freq[k] || 0) + 1; }
        }
        const best = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
        if (best) {
          [c.adresse, c.code_postal, c.ville] = JSON.parse(best[0]);
          c.a_verifier = true; ajouterOrigine(c, "adresse déduite des sites EDF"); plus("adresse");
        }
      }
      // Type : ASL / AFUL d'après le nom, sinon COPRO HAB si copropriétaires surtout particuliers
      if (!c.type) {
        let t = I.typeDepuisNom(c.nom || c.nom_ics);
        if (!t) {
          const noms = S.db.contacts.filter((x) => x.copro === num).map((x) => x.nom);
          const part = noms.filter((n) => !SOCIETE.test(U.normaliser(n)));
          if (noms.length >= 10 && part.length / noms.length >= 0.8) {
            t = "COPRO HAB";
            ajouterOrigine(c, `type déduit : ${part.length} copropriétaires particuliers sur ${noms.length}`);
          }
        }
        if (t) { c.type = t; c.a_verifier = true; plus("type"); }
      }
      // Copros de la liste ICS hors portefeuilles et sans relevé depuis un an : probablement plus gérées
      if ((c.origine || "").startsWith("Liste des copros ICS") && !(c.origine || "").includes("inactivité") && !c.comptable && !c.gestionnaire) {
        const dates = S.db.rapprochements.filter((r) => r.date_releve && U.extraireNumeroCopro(r.libelle, new Set([num])) === num).map((r) => r.date_releve);
        if (!dates.length || dates.sort().pop() < unAn) {
          c.actif = false; ajouterOrigine(c, "inactivité déduite (hors portefeuilles, pas de relevé bancaire depuis 1 an)"); plus("inactive");
        }
      }
    }
    return Object.entries(stats).map(([k, n]) => `${n} copro(s) : ${k} déduit(e)s`);
  };

  /** Classeur + toutes les extractions du dossier + déductions. */
  M.importInitial = async (base) => {
    const rapport = [];
    let classeur = null;
    for await (const [n, h] of base.entries()) {
      if (h.kind === "file" && /\.xlsm$/i.test(n) && U.normaliser(U.decoderNomZip(n)).startsWith("BASE DE DONNEES")) { classeur = h; break; }
    }
    if (classeur) {
      rapport.push(...M.importerClasseur(new Uint8Array(await (await classeur.getFile()).arrayBuffer())));
      S.journal("Classeur Excel", classeur.name, "reprise initiale");
    } else rapport.push("Classeur BASE DE DONNÉES.xlsm non trouvé dans le dossier : seules les extractions sont lues.");
    rapport.push(...(await I.actualiserDepuisDossier(base)));
    rapport.push(...M.deduireInfos());
    return rapport;
  };
})(globalThis.K = globalThis.K || {});
