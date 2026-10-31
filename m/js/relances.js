/* Relances des copropriétaires débiteurs.
   Chaque campagne de relance est datée et se construit à partir de trois exports :
   « <date> GLOBAL » (tous les débiteurs relançables, avec leur solde), « <date> RAR » (mises en demeure envoyées ce jour-là)
   et « <date> RS » (relances simples). D'une campagne à l'autre on suit chaque copropriétaire (« copro-compte ») :
   évolution du solde (mouvements de la période), historique des MED et des relances simples, notes. */
(function (K) {
  "use strict";
  const U = K.U, S = K.S, I = K.I, M = K.M;
  const v = (x) => (x === null || x === undefined ? 0 : Number(x) || 0);

  M.TYPES_RELANCE = { GLOBAL: "Liste des débiteurs (GLOBAL)", RAR: "Mises en demeure (RAR)", RS: "Relances simples (RS)" };
  M.DELAI_SUIVI_MED = 30; // jours après une MED sans paiement : à relancer
  M.DELAI_RS_MED = 15;    // jours après une relance simple sans paiement : mise en demeure
  M.SEUIL_CONTENTIEUX = 500; // solde à partir duquel une MED restée sans effet part au contentieux
  M.SEUIL_RELANCE = 15;   // en dessous : pas de relance
  M.ETAPES_RELANCE = { rs: "Relance simple", med: "Mise en demeure", med2: "Nouvelle mise en demeure", contentieux: "Contentieux", attendre: "Attendre", suivre: "Suivre", aucune: "Aucune" };
  const plusJours = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  /** Prochaine étape proposée pour un débiteur : relance simple → mise en demeure → contentieux, selon l'historique et l'évolution du solde. */
  M.prochaineEtapeRelance = (l, aujourdhui = U.aujourdhui(), rsConnues = true) => {
    const e = (code, detail, des = "") => ({ code, libelle: M.ETAPES_RELANCE[code], detail, des });
    if (l.sorti) return e("aucune", "soldé ou plus relançable");
    if (v(l.solde) < M.SEUIL_RELANCE) return e("aucune", "solde faible");
    if (/[ée]ch[ée]ancier|accord|plan d.apurement/i.test(l.note || "")) return e("suivre", "échéancier : surveiller les versements");
    if (l.nb_med) {
      if (l.delai_med < M.DELAI_SUIVI_MED) return e("attendre", `délai de la mise en demeure du ${U.jjmmaaaa(l.derniere_med)}`, plusJours(l.derniere_med, M.DELAI_SUIVI_MED));
      if (l.a_relancer) return v(l.solde) >= M.SEUIL_CONTENTIEUX ? e("contentieux", `MED du ${U.jjmmaaaa(l.derniere_med)} sans effet : transmettre (huissier, avocat)`)
        : e("med2", `MED du ${U.jjmmaaaa(l.derniere_med)} sans effet, solde sous ${M.SEUIL_CONTENTIEUX} €`);
      return e("suivre", "paiement reçu depuis la mise en demeure");
    }
    if (l.derniere_rs) {
      const j = jours(l.derniere_rs, aujourdhui);
      if (j < M.DELAI_RS_MED) return e("attendre", `relance simple du ${U.jjmmaaaa(l.derniere_rs)}`, plusJours(l.derniere_rs, M.DELAI_RS_MED));
      if (l.mouvement !== null && l.mouvement < -0.005) return e("suivre", "paiement reçu depuis la relance simple");
      return e("med", `relance simple du ${U.jjmmaaaa(l.derniere_rs)} sans paiement`);
    }
    return e("rs", l.nouveau ? "nouveau débiteur" : rsConnues ? "aucune relance enregistrée" : "aucune relance simple importée (export RS)");
  };

  /** « 16_10_2026_GLOBAL.csv », « 16-10-2026 RAR.csv »… -> { date: "2026-10-16", type: "RAR" } (null sinon). */
  I.parseNomRelance = (nom) => {
    const n = U.normaliser(String(nom).split(/[\\/]/).pop());
    const m = n.match(/(\d{2})[ _.-](\d{2})[ _.-](\d{4})[ _.-]*(GLOBAL|RAR|RS)\b/) || n.match(/(GLOBAL|RAR|RS)[ _.-]*(\d{2})[ _.-](\d{2})[ _.-](\d{4})/);
    if (!m) return null;
    const [j, mo, a, type] = m[4] && /^\d/.test(m[1]) ? [m[1], m[2], m[3], m[4]] : [m[2], m[3], m[4], m[1]];
    return { date: `${a}-${mo}-${j}`, type };
  };

  /** Lignes « copro ; immeuble ; compte ; copropriétaire ; solde ; frais » (en-tête, lignes vides et total ignorés). */
  I.parseRelance = (contenu) => {
    const res = [];
    for (const l of U.lireCsv(contenu, 6)) {
      const copro = String(l[0] || "").trim(), compte = String(l[2] || "").trim();
      if (!/^\d{4}$/.test(copro) || !/^\d{1,4}$/.test(compte)) continue;
      res.push({ cle: `${copro}-${compte.padStart(4, "0")}`, copro, immeuble: String(l[1] || "").trim(), compte: compte.padStart(4, "0"),
        nom: String(l[3] || "").replace(/\s+/g, " ").trim(), solde: U.nombreFr(l[4]) ?? 0, frais: U.nombreFr(l[5]) ?? 0 });
    }
    return res;
  };

  const etat = () => {
    if (!S.db.relances) S.db.relances = { campagnes: {}, suivi: {} };
    return S.db.relances;
  };
  /** Enregistre un export dans la campagne de sa date (un nouvel import du même type remplace le précédent). */
  I.importerRelance = (nom, contenu) => {
    const info = I.parseNomRelance(nom);
    if (!info) throw new Error(`${nom} : le nom doit contenir la date et GLOBAL, RAR ou RS (ex. 16_10_2026_GLOBAL.csv).`);
    const lignes = I.parseRelance(contenu);
    if (!lignes.length) throw new Error(`${nom} : aucun copropriétaire lu.`);
    const r = etat();
    const c = r.campagnes[info.date] = r.campagnes[info.date] || { date: info.date };
    c[info.type] = Object.fromEntries(lignes.map((l) => [l.cle, l]));
    c[`${info.type}_fichier`] = nom.split(/[\\/]/).pop();
    c[`${info.type}_importe_le`] = U.horodatage();
    S.journal("Relances", nom, `${M.TYPES_RELANCE[info.type]} du ${U.jjmmaaaa(info.date)} : ${lignes.length} copropriétaire(s)`);
    return { ...info, nb: lignes.length };
  };

  /** Lit RESSOURCES\\RELANCES : importe les exports nouveaux ou modifiés depuis leur dernier import (les autres sont ignorés). */
  I.importerRelancesDossier = async (base) => {
    const d = (await S.sousDossier(base, "RESSOURCES", "RELANCES")) || (await S.sousDossier(base, "RELANCES"));
    if (!d) return null;
    const r = etat();
    const res = { nouveaux: [], deja: 0 };
    for (const fh of await S.fichiers(d, (n) => /\.csv$/i.test(n) && I.parseNomRelance(n))) {
      const f = await fh.getFile();
      const info = I.parseNomRelance(f.name);
      const c = r.campagnes[info.date];
      if (c && c[info.type] && c[`${info.type}_fichier`] === f.name && (c[`${info.type}_modifie`] || 0) >= f.lastModified) { res.deja++; continue; }
      const x = I.importerRelance(f.name, new Uint8Array(await f.arrayBuffer()));
      r.campagnes[info.date][`${info.type}_modifie`] = f.lastModified;
      res.nouveaux.push(x);
    }
    return res;
  };

  M.campagnesRelance = () => Object.values(etat().campagnes).sort((a, b) => a.date.localeCompare(b.date));
  M.noteRelance = (cle) => (etat().suivi[cle] || {}).note || "";
  M.majNoteRelance = (cle, note) => {
    const r = etat();
    r.suivi[cle] = { ...(r.suivi[cle] || {}), note: String(note || "").trim(), le: U.horodatage() };
    S.sauver();
  };
  M.supprimerCampagne = (date) => { delete etat().campagnes[date]; S.sauver(); };

  const jours = (de, a) => Math.round((new Date(a) - new Date(de)) / 86400000);

  /** Tableau de suivi pour une campagne : un débiteur par ligne (présents dans le GLOBAL de la campagne ou de la précédente). */
  M.suiviRelances = (date, aujourdhui = U.aujourdhui()) => {
    const camps = M.campagnesRelance();
    const i = camps.findIndex((c) => c.date === date);
    if (i < 0) return null;
    const cur = camps[i], prec = i > 0 ? camps[i - 1] : null;
    const glob = cur.GLOBAL || {}, globPrec = (prec && prec.GLOBAL) || {};
    const anterieures = camps.slice(0, i + 1);
    const cles = new Set([...Object.keys(glob), ...Object.keys(globPrec), ...Object.keys(cur.RAR || {}), ...Object.keys(cur.RS || {})]);
    const lignes = [...cles].map((cle) => {
      const g = glob[cle], gp = globPrec[cle], rar = (cur.RAR || {})[cle], rs = (cur.RS || {})[cle];
      const ref = g || rar || rs || gp;
      const meds = anterieures.filter((c) => c.RAR && c.RAR[cle]).map((c) => ({ date: c.date, solde: c.RAR[cle].solde, frais: c.RAR[cle].frais }));
      const rss = anterieures.filter((c) => c.RS && c.RS[cle]).map((c) => c.date);
      const solde = g ? g.solde : rar || rs ? (rar || rs).solde + v((rar || rs).frais) : 0;
      const derniereMed = meds[meds.length - 1] || null;
      // solde depuis la dernière MED : la MED donne le solde hors frais au jour de l'envoi
      const soldeMed = derniereMed ? derniereMed.solde + v(derniereMed.frais) : null;
      const action = rar ? "MED" : rs ? "RS" : g ? "aucune" : "sortie";
      const delaiMed = derniereMed ? jours(derniereMed.date, aujourdhui) : null;
      return {
        cle, copro: ref.copro, immeuble: ref.immeuble, compte: ref.compte, nom: ref.nom,
        solde, solde_prec: gp ? gp.solde : null, mouvement: prec ? U.arrondi(solde - (gp ? gp.solde : 0), 2) : null,
        nouveau: !!prec && !gp, sorti: !g && !!gp, action, frais: rar ? rar.frais : rs ? rs.frais : 0,
        meds, nb_med: meds.length, derniere_med: derniereMed ? derniereMed.date : "", delai_med: delaiMed,
        rss, derniere_rs: rss[rss.length - 1] || "",
        // MED envoyée depuis plus de N jours sans que le solde ait baissé : à relancer
        a_relancer: !!(derniereMed && g && delaiMed >= M.DELAI_SUIVI_MED && soldeMed !== null && solde >= soldeMed - 0.01),
        note: M.noteRelance(cle),
      };
    }).map((l) => ({ ...l, etape: M.prochaineEtapeRelance(l, aujourdhui, anterieures.some((c) => c.RS)) })).sort((a, b) => a.copro.localeCompare(b.copro) || b.solde - a.solde);
    const somme = (l, k) => l.reduce((t, x) => t + v(x[k]), 0);
    const actifs = lignes.filter((l) => !l.sorti);
    return {
      campagne: cur, precedente: prec, lignes,
      totaux: {
        debiteurs: actifs.length, solde: somme(actifs, "solde"), solde_prec: prec ? somme(Object.values(globPrec), "solde") : null,
        mouvements: prec ? somme(lignes, "mouvement") : null,
        med: lignes.filter((l) => l.action === "MED").length, rs: lignes.filter((l) => l.action === "RS").length,
        sans_action: actifs.filter((l) => l.action === "aucune").length, nouveaux: lignes.filter((l) => l.nouveau).length,
        sortis: lignes.filter((l) => l.sorti).length, a_relancer: lignes.filter((l) => l.a_relancer).length,
        solde_med: somme(lignes.filter((l) => l.action === "MED"), "solde"), frais: somme(lignes, "frais"),
      },
    };
  };

  /** Débiteurs sous mise en demeure dans la dernière campagne (pour le tableau de bord). */
  M.medASuivre = (portefeuille = "", aujourdhui = U.aujourdhui()) => {
    const camps = M.campagnesRelance();
    if (!camps.length) return null;
    const s = M.suiviRelances(camps[camps.length - 1].date, aujourdhui);
    const dans = (l) => { const c = S.copro(l.copro); return !portefeuille || (c && M.dansPortefeuille(c, portefeuille)); };
    const lignes = s.lignes.filter((l) => !l.sorti && dans(l));
    // débiteurs encore présents ayant reçu au moins une MED, la plus ancienne d'abord
    const meds = lignes.filter((l) => l.nb_med).sort((a, b) => b.delai_med - a.delai_med || b.solde - a.solde);
    return { date: s.campagne.date, med: meds.length, a_relancer: lignes.filter((l) => l.a_relancer).length,
      debiteurs: lignes.length, solde: lignes.reduce((t, l) => t + v(l.solde), 0),
      meds, solde_med: meds.reduce((t, l) => t + v(l.solde), 0), delai_max: meds.length ? meds[0].delai_med : null };
  };
})(globalThis.K = globalThis.K || {});
