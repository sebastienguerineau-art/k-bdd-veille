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
    const avant = S.db.registre, signe = (x) => `${(x.suivies || []).join(",")}|${x.copros.length}`;
    if (avant && avant.donnees_du && d.donnees_du && avant.copros.length && (d.donnees_du < avant.donnees_du || (d.donnees_du === avant.donnees_du && signe(avant) === signe(d)))) return false; // même jour : liste des suivies modifiée
    S.db.registre = { donnees_du: d.donnees_du || U.aujourdhui(), recu_le: U.horodatage(), syndic: d.syndic || null,
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
})(globalThis.K = globalThis.K || {});
