/* Export des factures EDF (espace client, CSV « date_facture;num_facture;compte_de_facturation;… ») : source principale des consommations.
   Les montants sont pris à la DATE DE FACTURE, comme la comptabilité et les synthèses EDF (vérifié : synthèse EDF 2025 = factures émises
   en 2025, au centime) ; d'où des consommations par exercice comptable sans prorata. L'export ne reprend pas les contrats clos :
   les synthèses annuelles restent la source des comptes absents de l'export. Donne aussi l'historique compte ↔ PDL et les résiliations. */
(function (K) {
  "use strict";
  const U = K.U, S = K.S, I = K.I, M = K.M;
  const sansZeros = (x) => String(x || "").trim().replace(/^0+/, "");
  const jour = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
  const isoJour = (j) => new Date(j * 864e5).toISOString().slice(0, 10);
  const nb = (x) => { const v = parseFloat(String(x || "").replace(/[\s\u00a0\u202f]/g, "").replace(",", ".")); return Number.isFinite(v) ? v : 0; };

  const estZip = (octets) => octets[0] === 0x50 && octets[1] === 0x4b && octets[2] === 0x03 && octets[3] === 0x04;
  const enTete = (texte) => texte.replace(/^(\uFEFF|ï»¿)/, "").replace(/"/g, "").trim().toLowerCase();
  const estCsvFactures = (octets) => /^date_facture;num_facture;compte_de_facturation/.test(enTete(new TextDecoder("windows-1252").decode(octets.slice(0, 300))));
  /** CSV de l'export des factures EDF, tel quel ou dans le .zip téléchargé sur l'espace client. Renvoie les octets du CSV ou null. */
  I.csvFacturesEdf = (contenu) => {
    const octets = new Uint8Array(contenu);
    if (!estZip(octets)) return estCsvFactures(octets) ? octets : null;
    try {
      const z = globalThis.XLSX.CFB.read(octets, { type: "array" });
      for (const f of z.FileIndex) if (f.type === 2 && /\.csv$/i.test(f.name) && f.content && estCsvFactures(new Uint8Array(f.content))) return new Uint8Array(f.content);
    } catch (e) { console.warn(e); }
    return null;
  };
  I.estFacturesEdf = (contenu) => !!I.csvFacturesEdf(contenu);
  /** Date ISO : « 2024-07-22 » tel quel, « 22/07/2024 » (CSV réenregistré par Excel) converti. */
  const dateIso = (v) => { const m = String(v || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v || "").trim().slice(0, 10); };

  /** Lignes ';' avec champs entre guillemets (adresses « 19 BD …;BAT A;44600 … »). */
  const champs = (ligne) => {
    const res = [];
    let cur = "", q = false;
    for (let i = 0; i < ligne.length; i++) {
      const ch = ligne[i];
      if (ch === '"') { if (q && ligne[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === ";" && !q) { res.push(cur); cur = ""; } else cur += ch;
    }
    res.push(cur);
    return res;
  };
  const PS = ["base", "hp", "hc", "hpsb", "hcsb", "hpsh", "hcsh", "pointe"];
  /** Une ligne par facture et par PDL / PCE : n° facture, date, compte, PDL, énergie (E / G), période de consommation, kWh, montants. */
  I.parseFacturesEdf = (contenu) => {
    const csv = I.csvFacturesEdf(contenu) || new Uint8Array(contenu);
    const lignes = U.lireTexte(csv).split(/\r?\n/);
    const t = champs(lignes[0].replace(/^(\uFEFF|ï»¿)/, "").replace(/"/g, ""));
    const ix = Object.fromEntries(t.map((k, i) => [k.trim().toLowerCase(), i]));
    for (const k of ["date_facture", "num_facture", "compte_de_facturation", "ref_acheminement", "date_de_debut_de_consommation", "montant_total_ttc_euros"]) if (ix[k] === undefined) throw new Error(`Colonne « ${k} » absente de l'export des factures EDF.`);
    const res = [];
    for (const brut of lignes.slice(1)) {
      if (!brut.trim()) continue;
      const c = champs(brut), g = (k) => (ix[k] === undefined ? "" : String(c[ix[k]] ?? "").trim());
      const e = g("energie") || (g("gaz_ref_pce") ? "G" : "E");
      res.push({ n: g("num_facture"), df: dateIso(g("date_facture")), c: g("compte_de_facturation"), r: e === "G" ? g("gaz_ref_pce") || g("ref_acheminement") : g("ref_acheminement"), e,
        du: dateIso(g("date_de_debut_de_consommation")), au: dateIso(g("date_de_fin_de_consommation")), k: nb(e === "G" ? g("gaz_conso_facturee_kwh") : g("conso_elec_facturee_kwh")),
        ht: nb(g("total_htva_euros")), t: nb(g("montant_total_ttc_euros")), s: U.compacter(g("nom_site")), a: U.compacter(g("adresse_site")), res: dateIso(g("date_de_resiliation")),
        // contrat : puissance souscrite (kVA), puissance max atteinte (compteurs > 36 kVA seulement), segment, offre, tarif d'acheminement, compteur
        ps: Math.max(0, ...PS.map((k) => nb(g(`puissance_souscrite_${k}`)))) || "", pm: Math.max(0, ...PS.map((k) => nb(g(`puissance_max_atteinte_${k}`)))) || "",
        seg: g("segment_or"), of: g("type_offre"), fta: g("fta"), ta: g("tarif_acheminement").replace(/^[^-]*-/, ""), cpt: g("libelle_compteur") });
    }
    return res;
  };

  // stockage compact (sauvegarde OneDrive) : une ligne = tableau, nom de site et adresse une fois par PDL
  // sites : [nom, adresse, segment, offre, code FTA, tarif d'acheminement, compteur] de la dernière facture du PDL
  const COLS = ["n", "df", "c", "r", "e", "du", "au", "k", "ht", "t", "res", "ps", "pm"];
  const SITE = ["s", "a", "seg", "of", "fta", "ta", "cpt"];
  const decoder = (f) => (f && f.lignes ? f.lignes.map((v) => { const x = Object.fromEntries(COLS.map((k, i) => [k, v[i] ?? ""])); const st = (f.sites || {})[x.r] || []; return { ...x, ...Object.fromEntries(SITE.map((k, i) => [k, st[i] || ""])) }; }) : []);
  const encoder = (lignes) => {
    const sites = {}, dates = {};
    for (const x of lignes) if (!dates[x.r] || x.df >= dates[x.r]) { dates[x.r] = x.df; sites[x.r] = SITE.map((k) => x[k] || ""); }
    return { lignes: lignes.map((x) => COLS.map((k) => x[k] ?? "")), sites };
  };
  M.facturesEdf = () => decoder(S.db.edf_factures);

  /** Import : fusion avec les factures déjà connues (un nouvel export complète l'historique), puis années civiles et rattachements par PDL. */
  I.importerFacturesEdf = (nom, contenu, aujourdhui = U.aujourdhui()) => {
    const nouvelles = I.parseFacturesEdf(contenu);
    if (!nouvelles.length) throw new Error(`${nom} : aucune facture lue.`);
    const cle = (x) => `${x.n}|${x.r}|${x.du}|${x.au}|${x.c}`;
    const avantImport = S.db.edf_factures;
    const toutes = new Map(M.facturesEdf().map((x) => [cle(x), x]));
    const avant = toutes.size;
    for (const x of nouvelles) toutes.set(cle(x), x);
    // date d'import : seulement si l'export apporte de nouvelles factures (relire le même fichier ne fait pas disparaître le rappel trimestriel)
    const importeLe = toutes.size > avant || !avantImport ? aujourdhui : avantImport.importe_le;
    S.db.edf_factures = { fichier: String(nom).split(/[\\/]/).pop(), importe_le: importeLe, source: avantImport && avantImport.source, ...encoder([...toutes.values()]) };
    const filtre = S.db.edf_factures.filtre_cabinet = !!(avantImport && avantImport.filtre_cabinet);
    const pdl = M.rattacherParPdl ? M.rattacherParPdl() : [];
    if (filtre) M.garderFacturesCabinet(false);
    const annees = M.anneesDepuisFactures();
    const r = { factures: nouvelles.length, nouvelles: toutes.size - avant, annees, pdl_rattaches: pdl.length, ...M.etendueFactures() };
    S.journal("Factures EDF", nom, `${r.factures} ligne(s), ${r.nouvelles} nouvelle(s) · factures du ${U.jjmmaaaa(r.du)} au ${U.jjmmaaaa(r.au)}`);
    return r;
  };

  /** PDL du cabinet : PDL des comptes rattachés aux copros actives (toutes factures et synthèses) et de leurs contrats ICS. */
  const pdlCabinet = () => {
    const actifs = S.db.edf_comptes.filter((k) => (S.copro(k.copro) || {}).actif);
    const att = new Set(actifs.map((k) => sansZeros(k.compte)));
    const res = new Set(actifs.map((k) => k.pdl_ics).filter(Boolean));
    for (const x of (S.db.contrats_ics || {}).liste || []) if (x.pdl && (S.copro(x.copro) || {}).actif) res.add(x.pdl);
    for (const l of [...Object.values(S.db.edf_conso).flat(), ...M.facturesEdf().map((x) => ({ compte_facturation: x.c, rae: x.r }))]) if (att.has(sansZeros(l.compte_facturation))) res.add(l.rae);
    return { att, pdl: res };
  };
  /** Ne garde que les factures des PDL / comptes rattachés aux copros du cabinet (les autres agences sont retirées de la base, pas du fichier).
      actif = true : le filtre s'applique aussi aux exports importés ensuite. Renvoie {avant, apres}. */
  M.garderFacturesCabinet = (actif = true) => {
    const f = S.db.edf_factures;
    if (!f) return { avant: 0, apres: 0 };
    const { att, pdl } = pdlCabinet();
    const toutes = M.facturesEdf(), gardees = toutes.filter((x) => att.has(sansZeros(x.c)) || pdl.has(x.r));
    Object.assign(f, encoder(gardees), { filtre_cabinet: actif || f.filtre_cabinet });
    if (actif) { M.anneesDepuisFactures(); S.journal("Factures EDF", f.fichier, `${toutes.length - gardees.length} ligne(s) hors cabinet retirée(s)`); }
    return { avant: toutes.length, apres: gardees.length };
  };
  M.lignesFacturesHorsCabinet = () => { const { att, pdl } = pdlCabinet(); return M.facturesEdf().filter((x) => !att.has(sansZeros(x.c)) && !pdl.has(x.r)).length; };

  let cache = null; // index des factures d'électricité par compte (recalculé quand les factures changent)
  const facturesElec = () => {
    const f = S.db.edf_factures;
    if (!f || !f.lignes || !f.lignes.length) return null;
    if (cache && cache.ref === f.lignes) return cache;
    const parCompte = {};
    let d0 = Infinity, f0 = -Infinity;
    const lignes = decoder(f).filter((x) => x.e !== "G" && x.df).map((x) => {
      const y = { ...x, j: jour(x.df) }; // date de facture
      d0 = Math.min(d0, y.j); f0 = Math.max(f0, y.j + 1);
      (parCompte[sansZeros(x.c)] = parCompte[sansZeros(x.c)] || []).push(y);
      return y;
    });
    cache = { ref: f.lignes, lignes, parCompte, d0, f0 };
    return cache;
  };
  /** Factures EDF datées dans la période (comme en compta), sans complément par les synthèses annuelles :
      {kwh, ttc, n, du, au} — n factures, du/au : première et dernière date de facture retenues. */
  M.facturesEdfPeriode = (comptes, debut, fin) => {
    const c = facturesElec(), d0 = jour(debut), f0 = jour(fin) + 1;
    const lignes = c ? [...new Set(comptes.map(sansZeros))].flatMap((z) => c.parCompte[z] || []).filter((x) => x.j >= d0 && x.j < f0) : [];
    const dates = lignes.map((x) => x.df).sort();
    return { kwh: Math.round(lignes.reduce((t, x) => t + (x.k || 0), 0)), ttc: U.arrondi(lignes.reduce((t, x) => t + (x.t || 0), 0), 2), n: lignes.length, du: dates[0] || "", au: dates[dates.length - 1] || "" };
  };
  M.etendueFactures = () => { const c = facturesElec(); return c ? { du: isoJour(c.d0), au: isoJour(c.f0 - 1) } : {}; };
  /** Somme des factures émises dans [d0, f0[. */
  const sommer = (lignes, d0, f0, champ) => lignes.reduce((t, x) => (x.j >= d0 && x.j < f0 ? t + x[champ] : t), 0);

  /** Années civiles entièrement couvertes par l'export (factures émises de janvier à décembre) et sans synthèse annuelle importée
      → edf_conso[année] par compte et PDL, identique à une synthèse EDF. Une vraie synthèse annuelle est conservée (plus complète). */
  M.anneesDepuisFactures = () => {
    const c = facturesElec();
    if (!c) return [];
    if (!S.db.edf_agreges) S.db.edf_agreges = {};
    const res = [];
    for (let a = new Date(c.d0 * 864e5).getUTCFullYear(); a <= new Date((c.f0 - 1) * 864e5).getUTCFullYear(); a++) {
      const d0 = jour(`${a}-01-01`), f0 = jour(`${a}-12-31`) + 1;
      if (c.d0 > d0 + 31 || c.f0 < f0 - 31) continue; // année incomplète dans l'export
      if (S.db.edf_conso[a] && S.db.edf_agreges[a] !== "factures EDF") continue;
      const groupes = {};
      for (const x of c.lignes) if (x.j >= d0 && x.j < f0) (groupes[`${sansZeros(x.c)}|${x.r}`] = groupes[`${sansZeros(x.c)}|${x.r}`] || []).push(x);
      S.db.edf_conso[a] = Object.values(groupes).map((g) => {
        const der = g.reduce((p, x) => (x.df > p.df ? x : p));
        return { rae: der.r, segment: "", compte_facturation: der.c, compte_commercial: "", nom_site: der.s, adresse: der.a,
          conso_kwh: Math.round(sommer(g, d0, f0, "k")), total_htva: U.arrondi(sommer(g, d0, f0, "ht"), 2), total_tva: null, total_ttc: U.arrondi(sommer(g, d0, f0, "t"), 2) };
      }).filter((l) => l.conso_kwh || l.total_ttc);
      S.db.edf_agreges[a] = "factures EDF";
      res.push(a);
    }
    return res;
  };
  /** Couples compte / PDL des factures (tout l'historique) : rattachement PDL → comptes successifs. */
  M.lignesFacturesPdl = () => { const c = facturesElec(); return c ? c.lignes.map((x) => ({ compte_facturation: x.c, rae: x.r, nom_site: x.s })) : []; };
  /** Date de résiliation d'un compte d'après les factures. */
  M.resiliationCompte = (compte) => { const c = facturesElec(); const l = c && c.parCompte[sansZeros(compte)]; return l ? l.map((x) => x.res).filter(Boolean).sort().pop() || "" : ""; };

  // ------------------------------------------------------------------ remplace le calcul par synthèses quand les factures sont importées
  const parSyntheses = M.consoEdfPeriode;
  M.consoEdfPeriode = (comptes, debut, fin, periodes) => {
    const c = facturesElec();
    const d0 = jour(debut), f0 = jour(fin) + 1;
    if (!c || c.f0 <= d0 || c.d0 >= f0) return parSyntheses(comptes, debut, fin, periodes); // période hors de l'export : synthèses
    const partiel = c.d0 > d0 + 7 || c.f0 < f0 - 7; // export commencé après le début ou arrêté avant la fin de la période
    if (partiel) { const x = parSyntheses(comptes, debut, fin, periodes); if (x.couverture >= 0.99) return x; }
    const zs = [...new Set([...comptes].map(sansZeros))];
    const avec = zs.filter((z) => c.parCompte[z]), sans = zs.filter((z) => !c.parCompte[z]); // comptes absents de l'export (contrats clos)
    const lignes = avec.flatMap((z) => c.parCompte[z]);
    const couverture = partiel ? Math.max(0, Math.min(f0, c.f0) - Math.max(d0, c.d0)) / (f0 - d0) : 1;
    const res = { kwh: Math.round(sommer(lignes, d0, f0, "k")), ttc: U.arrondi(sommer(lignes, d0, f0, "t"), 2), couverture, exact: !partiel, sources: ["factures EDF"] };
    if (sans.length) {
      const x = parSyntheses(sans, debut, fin, periodes);
      if (x.kwh || x.ttc) Object.assign(res, { kwh: res.kwh + x.kwh, ttc: U.arrondi(res.ttc + x.ttc, 2), exact: x.exact, sources: [...res.sources, ...x.sources] });
    }
    return res;
  };
  const couvertureSyntheses = M.couvertureEdf;
  M.couvertureEdf = (n = 6, aujourdhui = U.aujourdhui()) => {
    const res = couvertureSyntheses(n, aujourdhui), c = facturesElec();
    if (!c) return res;
    return res.map((a) => ({ ...a, trimestres: a.trimestres.map((t, i) => {
      const d = jour(U.iso(a.annee, 3 * i + 1, 1)), f = jour(new Date(Date.UTC(a.annee, 3 * i + 3, 0)).toISOString().slice(0, 10)) + 1;
      return t === "futur" ? t : c.d0 <= d + 31 && c.f0 >= f - 15 ? "factures" : t;
    }) }));
  };
  /** Avec l'export des factures : rappel dès le premier jour ouvré du trimestre si l'export n'a pas été refait depuis. */
  const rappelSyntheses = M.rappelEdfTrimestre;
  M.rappelEdfTrimestre = (aujourdhui = U.aujourdhui()) => {
    const f = S.db.edf_factures;
    if (!f || !f.lignes || !f.lignes.length) return rappelSyntheses(aujourdhui);
    const a = Number(aujourdhui.slice(0, 4)), m = Number(aujourdhui.slice(5, 7));
    const debutT = M.premierJourOuvre(a, Math.floor((m - 1) / 3) * 3 + 1);
    if (aujourdhui < debutT || (f.importe_le || "") >= debutT) return null;
    const t = Math.floor((m - 1) / 3) || 4;
    return { factures: true, trimestre: `T${t} ${t === 4 ? a - 1 : a}`, depuis: M.etendueFactures().au, importe_le: f.importe_le };
  };

  // ------------------------------------------------------------------ contrôle compta ↔ EDF
  /** Charges d'électricité de la compta (lignes de fourniture du budget / charges) comparées aux factures EDF des compteurs rattachés
      sur l'exercice. statut : ok (écart ≤ 1 % ou 5 €), ecart, sans_edf, sans_compta, partiel (export EDF ne couvrant pas l'exercice). */
  M.controleEdfCompta = (c, libelle, aujourdhui = U.aujourdhui()) => {
    const b = S.db.budgets[`${c.numero}|${libelle}`];
    if (!b || !b.date_debut || !b.date_fin) return null;
    const lignes = M.lignesElectricite(c.numero, b).filter((l) => l.charges);
    const compta = U.arrondi(lignes.reduce((t, l) => t + (l.charges || 0), 0), 2);
    const comptes = S.db.edf_comptes.filter((k) => k.copro === c.numero && (!k.energie || k.energie === "Électricité"));
    const fin = b.date_fin < aujourdhui ? b.date_fin : aujourdhui;
    const detail = comptes.map((k) => ({ compte: k.compte, objet: k.objet || k.reference || "", ...M.consoEdfPeriode([k.compte], b.date_debut, fin) })).filter((x) => x.ttc || x.kwh);
    const tot = M.consoEdfPeriode(comptes.map((k) => k.compte), b.date_debut, fin);
    const edf = tot.ttc, ecart = U.arrondi(edf - compta, 2);
    const statut = !lignes.length && !edf ? null : !edf ? "sans_edf" : !lignes.length ? "sans_compta" : tot.couverture < 0.99 ? "partiel"
      : Math.abs(ecart) <= Math.max(5, Math.abs(compta) * 0.01) ? "ok" : "ecart";
    // piste : un compte EDF non rattaché dont les factures de l'exercice égalent l'écart
    const pistes = [];
    const fc = facturesElec();
    if (fc && statut === "ecart" && ecart < 0) {
      const attaches = new Set(S.db.edf_comptes.map((k) => sansZeros(k.compte)));
      const d0 = jour(b.date_debut), f0 = jour(fin) + 1;
      const mots = U.normaliser(`${c.nom} ${c.nom_ics || ""}`).split(/[^A-Z0-9]+/).filter((m) => m.length > 3 && !/^(RESIDENCE|COPROPRIETE|SYNDICAT|SOUS|BATIMENT|ILOT)$/.test(m));
      for (const [z, l] of Object.entries(fc.parCompte)) {
        if (attaches.has(z)) continue;
        if (!mots.some((m) => U.normaliser(`${l[0].s} ${l[0].a}`).includes(m))) continue; // site au nom proche de la copro
        const t = sommer(l, d0, f0, "t");
        if (t && Math.abs(t + ecart) <= Math.max(1, Math.abs(ecart) * 0.005)) pistes.push({ compte: l[0].c, site: l[0].s, ttc: U.arrondi(t, 2) });
      }
    }
    // période des factures EDF des comptes rattachés (ex. contrat souscrit après l'exercice)
    let factures = null;
    if (fc) { const dates = comptes.flatMap((k) => (fc.parCompte[sansZeros(k.compte)] || []).map((x) => x.df)).sort(); if (dates.length) factures = { du: dates[0], au: dates[dates.length - 1] }; }
    const note = statut !== "sans_edf" ? "" : !comptes.length ? "aucun compte EDF rattaché à la copro"
      : !factures ? "aucun compte rattaché n'est dans l'export des factures EDF (autre fournisseur ou contrat clos ?)"
      : factures.du > b.date_fin ? `contrat EDF postérieur à l'exercice : factures à partir du ${U.jjmmaaaa(factures.du)}`
      : factures.au < b.date_debut ? `contrat EDF antérieur : dernière facture le ${U.jjmmaaaa(factures.au)}` : "";
    return { exercice: libelle, debut: b.date_debut, fin: b.date_fin, en_cours: b.date_fin >= aujourdhui, compta, edf, ecart, statut, couverture: tot.couverture, factures, note,
      lignes: lignes.map((l) => ({ compte: l.compte, libelle: l.libelle, charges: l.charges })), detail, pistes: pistes.slice(0, 3), sources: tot.sources };
  };
  /** Clé de tri d'un exercice importé : année de fin du libellé (« 2024/2025 » → 2025), puis date de fin (format variable selon l'extraction). */
  const finExercice = (b) => `${(String(b.exercice).match(/\d{4}/g) || [""]).pop()}|${b.date_fin || ""}`;
  /** Contrôles des derniers exercices importés d'une copro (plus récent en premier). */
  M.controlesEdfCopro = (c, n = 3) => Object.values(S.db.budgets).filter((b) => b.copro === c.numero && b.date_fin)
    .sort((a, b) => finExercice(b).localeCompare(finExercice(a))).slice(0, n).map((b) => M.controleEdfCompta(c, b.exercice)).filter((x) => x && x.statut);

  // ------------------------------------------------------------------ tous les PDL connus (factures + synthèses) : recherche, ajout / retrait
  let cacheIndex = null;
  /** Index des PDL : comptes de facturation successifs, site, adresse, dernière facture, montants des factures, kWh / TTC par année
      (factures à leur date ; à défaut synthèses annuelles). */
  M.indexPdl = () => {
    const fc = facturesElec();
    const cle = `${fc ? fc.lignes.length : 0}|${Object.entries(S.db.edf_conso).map(([a, l]) => `${a}:${l.length}`).join(",")}|${Object.keys(S.db.edf_periodes || {}).join(",")}`;
    if (cacheIndex && cacheIndex.cle === cle && cacheIndex.fc === fc) return cacheIndex.index;
    const index = new Map(), parCompte = new Map();
    const entree = (rae) => { let e = index.get(rae); if (!e) index.set(rae, (e = { rae, comptes: new Map(), site: "", adresse: "", dernier: "", montants: new Set(), fact: {}, synth: {} })); return e; };
    const compte = (e, c, date) => {
      const z = sansZeros(c);
      if (!z) return;
      const x = e.comptes.get(z);
      if (!x || date > x.dernier) e.comptes.set(z, { compte: c, dernier: date > ((x && x.dernier) || "") ? date : x.dernier });
      if (!parCompte.has(z)) parCompte.set(z, new Set());
      parCompte.get(z).add(e.rae);
    };
    for (const x of fc ? fc.lignes : []) {
      if (!x.r) continue;
      const e = entree(x.r);
      compte(e, x.c, x.df);
      if (x.df >= e.dernier) Object.assign(e, { dernier: x.df, site: x.s || e.site, adresse: x.a || e.adresse });
      if (x.t) e.montants.add(Math.round(x.t * 100));
      const a = x.df.slice(0, 4), y = e.fact[a] = e.fact[a] || { kwh: 0, ttc: 0 };
      y.kwh += x.k; y.ttc += x.t;
    }
    for (const [a, lignes] of Object.entries(S.db.edf_conso)) {
      if ((S.db.edf_agreges || {})[a] === "factures EDF") continue; // déjà dans les factures
      for (const l of lignes) {
        if (!l.rae) continue;
        const e = entree(l.rae);
        compte(e, l.compte_facturation, `${a}-12-31`);
        if (!e.site) Object.assign(e, { site: l.nom_site, adresse: l.adresse });
        if (!e.dernier) e.dernier = `${a}-12-31`;
        const y = e.synth[a] = e.synth[a] || { kwh: 0, ttc: 0 };
        y.kwh += l.conso_kwh || 0; y.ttc += l.total_ttc || 0;
        if (l.total_ttc) e.montants.add(Math.round(y.ttc * 100));
      }
    }
    for (const p of Object.values(S.db.edf_periodes || {})) for (const l of p.lignes) if (l.rae) { const e = entree(l.rae); compte(e, l.compte_facturation, p.au); if (!e.site) Object.assign(e, { site: l.nom_site, adresse: l.adresse }); }
    for (const e of index.values()) { e.annees = { ...e.synth }; for (const [a, y] of Object.entries(e.fact)) e.annees[a] = y; } // une année : factures, sinon synthèse
    index.parCompte = parCompte;
    cacheIndex = { cle, fc, index };
    return index;
  };
  /** PDL d'un compte de facturation (factures, synthèses, contrat ICS). */
  M.pdlDuCompte = (compte) => { const s2 = M.indexPdl().parCompte.get(sansZeros(compte)); const k = S.db.edf_comptes.find((x) => sansZeros(x.compte) === sansZeros(compte)); return [...new Set([...(s2 || []), ...(k && k.pdl_ics ? [k.pdl_ics] : [])])]; };

  /** Recherche de PDL : n° de PDL ou de compte, nom du site, adresse (tous les mots), ou montant d'une facture / d'une année (« 1089,41 »). */
  M.chercherPdl = (texte, numero = "", max = 12) => {
    const q = U.normaliser(texte).trim();
    if (q.length < 3) return [];
    const montant = /^-?\d[\d ]*[.,]\d{1,2}$/.test(q) ? Math.round(parseFloat(q.replace(/ /g, "").replace(",", ".")) * 100) : null;
    const mots = q.split(/\s+/);
    const attache = new Map(S.db.edf_comptes.map((k) => [sansZeros(k.compte), k.copro]));
    const res = [];
    for (const e of M.indexPdl().values()) {
      let parMontant = false;
      if (montant !== null) { if (!e.montants.has(montant) && !Object.values(e.annees).some((y) => Math.round(y.ttc * 100) === montant)) continue; parMontant = true; }
      else { const t = U.normaliser(`${e.rae} ${[...e.comptes.values()].map((x) => x.compte).join(" ")} ${e.site} ${e.adresse}`); if (!mots.every((m) => t.includes(m))) continue; }
      const copros = [...new Set([...e.comptes.keys()].map((z) => attache.get(z)).filter(Boolean))];
      const exact = e.rae === q || e.comptes.has(q.replace(/^0+/, ""));
      res.push({ ...e, comptes: [...e.comptes.values()].sort((a, b) => b.dernier.localeCompare(a.dernier)), copros, deja: copros.includes(numero), exact, parMontant });
    }
    return res.sort((a, b) => b.exact - a.exact || a.deja - b.deja || (a.copros.length > 0) - (b.copros.length > 0) || b.dernier.localeCompare(a.dernier)).slice(0, max);
  };

  /** Ajoute un PDL à une copro : rattache tous ses comptes de facturation (déplace ceux d'une autre copro si deplacer). */
  M.ajouterPdlCopro = (numero, rae, deplacer = false) => {
    const e = M.indexPdl().get(rae);
    const res = { ajoutes: [], deplaces: [], conflits: [] };
    if (!e) return res;
    const exclus = new Set(S.db.edf_exclus || []);
    for (const [z, x] of e.comptes) {
      const k = S.db.edf_comptes.find((y) => sansZeros(y.compte) === z);
      exclus.delete(z);
      if (!k) { S.db.edf_comptes.push({ id: S.nouvelId(), compte: x.compte, copro: numero, reference: e.site, energie: "Électricité", fournisseur: "EDF", origine: `ajout manuel du PDL ${rae}` }); res.ajoutes.push(x.compte); }
      else if (k.copro !== numero) { if (deplacer) { res.deplaces.push({ compte: k.compte, de: k.copro }); k.copro = numero; } else res.conflits.push({ compte: k.compte, copro: k.copro }); }
    }
    S.db.edf_exclus = [...exclus];
    S.journal("Compteurs EDF", "", `PDL ${rae} → ${numero} : ${res.ajoutes.length} compte(s) ajouté(s)${res.deplaces.length ? `, ${res.deplaces.length} déplacé(s)` : ""}`);
    S.sauver();
    return res;
  };
  /** Rattache un compte de facturation sans facture connue (nouveau contrat). */
  M.ajouterCompteCopro = (numero, compte, reference = "") => {
    const z = sansZeros(compte);
    if (!z || S.db.edf_comptes.some((k) => sansZeros(k.compte) === z)) return false;
    S.db.edf_comptes.push({ id: S.nouvelId(), compte: String(compte).trim(), copro: numero, reference, energie: "Électricité", origine: "ajout manuel" });
    S.db.edf_exclus = (S.db.edf_exclus || []).filter((x) => x !== z);
    S.sauver();
    return true;
  };
  /** Retire un PDL d'une copro : détache ses comptes de facturation (ils ne seront plus rattachés automatiquement). */
  M.retirerPdlCopro = (numero, rae) => {
    const comptes = S.db.edf_comptes.filter((k) => k.copro === numero && M.pdlDuCompte(k.compte).includes(rae));
    return M.detacherComptesEdf(comptes.map((k) => k.id));
  };

  /** Vue d'une copro : une ligne par PDL (comptes successifs, conso par année, clé), puis les comptes sans PDL connu. */
  M.pdlCopro = (c) => {
    const index = M.indexPdl(), ded = M.deductionsPdl(c.numero), ics = new Map(((S.db.contrats_ics || {}).liste || []).map((x) => [sansZeros(x.contrat), x]));
    const comptes = S.db.edf_comptes.filter((k) => k.copro === c.numero);
    const groupes = new Map(), seuls = [];
    for (const k of comptes) {
      const raes = M.pdlDuCompte(k.compte);
      if (!raes.length) { seuls.push(k); continue; }
      for (const r of raes) { if (!groupes.has(r)) groupes.set(r, []); groupes.get(r).push(k); }
    }
    const etat = (k) => { const res = M.resiliationCompte(k.compte), x = ics.get(sansZeros(k.compte)); return res ? `résilié le ${U.jjmmaaaa(res)}` : x ? (x.statut === "terminé" ? "terminé (ICS)" : "actif (ICS)") : ""; };
    const pdl = [...groupes.entries()].map(([rae, ks]) => {
      const e = index.get(rae) || { comptes: new Map(), annees: {}, site: "", adresse: "", dernier: "" };
      const parDate = ks.map((k) => ({ k, dernier: (e.comptes.get(sansZeros(k.compte)) || {}).dernier || "" })).sort((a, b) => b.dernier.localeCompare(a.dernier));
      const actuel = parDate[0].k;
      const d = M.clePdl(c.numero, { rae, compte_facturation: actuel.compte }, ded);
      return { rae, site: e.site || actuel.objet || actuel.reference || "", adresse: e.adresse, dernier: e.dernier, annees: e.annees, energie: actuel.energie || "Électricité",
        comptes: parDate.map(({ k, dernier }, i) => ({ k, dernier, actuel: i === 0, etat: etat(k), partage: M.pdlDuCompte(k.compte).length > 1 })),
        reference: actuel.reference || "", cle: d.cle, origine: d.origine,
        incoherence: M.incoherenceCompteCharge(c.numero, rae, actuel.compte, ded),
        compte_saisi: (M.operat(c.numero).compte_pdl || {})[rae] || "", compte_charge: (M.operat(c.numero).compte_pdl || {})[rae] || d.compte || actuel.compte_charge || "" };
    }).sort((a, b) => (b.dernier || "").localeCompare(a.dernier || "") || a.rae.localeCompare(b.rae));
    return { pdl, seuls: seuls.map((k) => ({ k, etat: etat(k) })) };
  };

  // ------------------------------------------------------------------ contrat et puissance de chaque PDL (export des factures)
  const OFFRES = { OH: "tarif réglementé (TRV)", NO: "offre de marché" };
  const SEGMENTS = { C5: "BT ≤ 36 kVA", C4: "BT > 36 kVA", C3: "HTA", C2: "HTA", C1: "HTB" };
  /** Contrat d'un PDL : puissance souscrite (dernière facture), puissance max atteinte sur les 12 derniers mois (compteurs > 36 kVA),
      taux d'utilisation et avis : > 100 % dépassement (pénalités) ; ≥ 90 % proche ; < 50 % puissance surdimensionnée (abonnement à réduire ?). */
  M.contratPdl = (rae) => {
    const fc = facturesElec();
    const l = fc ? fc.lignes.filter((x) => x.r === rae) : [];
    if (!l.length) return null;
    const der = l.reduce((p, x) => (x.df > p.df ? x : p));
    const debut = new Date(jour(der.df) * 864e5 - 365 * 864e5).toISOString().slice(0, 10);
    const pms = l.filter((x) => x.df > debut && Number(x.pm) > 0);
    const ps = Number(der.ps) || null, pm = pms.length ? Math.max(...pms.map((x) => Number(x.pm))) : null;
    // mois de la puissance max : période de consommation de la facture (milieu de la période, la plupart sont mensuelles)
    const fmax = pm ? pms.filter((x) => Number(x.pm) === pm).sort((a, b) => b.df.localeCompare(a.df))[0] : null;
    const milieu = fmax && fmax.du && fmax.au ? new Date(((jour(fmax.du) + jour(fmax.au)) / 2) * 864e5).toISOString().slice(0, 10) : fmax ? fmax.df : "";
    const pm_mois = milieu ? `${U.MOIS[Number(milieu.slice(5, 7)) - 1]} ${milieu.slice(0, 4)}` : "";
    const taux = ps && pm ? pm / ps : null;
    return { ps, pm, taux, seg: der.seg, segment: SEGMENTS[der.seg] || der.seg, offre: OFFRES[der.of] || der.of, fta: der.fta, tarif: der.ta, compteur: der.cpt,
      pm_mois, pm_periode: fmax && fmax.du ? { du: fmax.du, au: fmax.au } : null,
      avis: taux === null ? "" : taux > 1 ? "depassement" : taux >= 0.9 ? "proche" : taux < 0.5 ? "surdimensionne" : "ok", depuis: pms.length ? debut : "" };
  };
  /** PDL des copros (portefeuille) dont la puissance max est connue (> 36 kVA), triés par taux d'utilisation. */
  M.puissancesPortefeuille = (pf = "") => S.copros().filter((c) => c.actif && (!pf || M.dansPortefeuille(c, pf)))
    .flatMap((c) => M.pdlCopro(c).pdl.map((p) => ({ c, p, x: M.contratPdl(p.rae) }))).filter((y) => y.x && y.x.taux !== null)
    .sort((a, b) => b.x.taux - a.x.taux);

  const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  /** Puissance max atteinte mois par mois d'un PDL entre deux dates (mois de la période de consommation de chaque facture ;
      plusieurs factures sur un mois : la plus forte). [{mois: "2025-07", libelle: "juil.", pm}] ; pm null si pas de relevé. */
  M.puissancesMensuelles = (rae, debut, fin) => {
    const fc = facturesElec();
    const res = [];
    for (let d = new Date(`${debut.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= fin; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const m = d.toISOString().slice(0, 7);
      res.push({ mois: m, libelle: MOIS_COURTS[d.getUTCMonth()], annee: m.slice(0, 4), pm: null });
    }
    if (!fc) return res;
    const parMois = new Map(res.map((x) => [x.mois, x]));
    for (const x of fc.lignes) {
      if (x.r !== rae || !(Number(x.pm) > 0)) continue;
      const milieu = x.du && x.au ? new Date(((jour(x.du) + jour(x.au)) / 2) * 864e5).toISOString().slice(0, 7) : x.df.slice(0, 7);
      const y = parMois.get(milieu);
      if (y) y.pm = Math.max(y.pm || 0, Number(x.pm));
    }
    return res;
  };
  /** Courbes de puissance des PDL d'une copro (compteurs > 36 kVA) sur une période. */
  M.courbesPuissanceCopro = (c, debut, fin) => M.pdlCopro(c).pdl.map((p) => {
    const x = M.contratPdl(p.rae);
    if (!x || !x.ps) return null;
    const serie = M.puissancesMensuelles(p.rae, debut, fin);
    if (!serie.some((y) => y.pm)) return null;
    const max = Math.max(...serie.map((y) => y.pm || 0));
    return { rae: p.rae, site: p.reference || p.site, ps: x.ps, serie, max, taux: max / x.ps, avis: max > x.ps ? "depassement" : max >= 0.9 * x.ps ? "proche" : max < 0.5 * x.ps ? "surdimensionne" : "ok" };
  }).filter(Boolean);

  // ------------------------------------------------------------------ production photovoltaïque ↔ contrat EDF d'injection
  /** Production PV d'une copro sur une période (mois du rapport compris dans [debut, fin]) rapprochée de l'énergie
      facturée sur le contrat EDF d'injection (factures prises à leur date, comme pour la consommation). */
  M.productionPv = (numero, debut, fin) => {
    const pv = (S.db.pv || {})[numero];
    if (!pv) return null;
    const mois = [];
    for (let d = new Date(`${debut.slice(0, 7)}-01T12:00:00Z`); d.toISOString().slice(0, 7) <= fin.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) {
      const k = d.toISOString().slice(0, 7), m = pv.mois[k];
      mois.push({ mois: k, kwh: m ? m.kwh : null, pic: m ? m.pic : null });
    }
    const connus = mois.filter((m) => m.kwh !== null);
    const production = Math.round(connus.reduce((t, m) => t + (m.kwh || 0), 0));
    const proc = M.processCopro(S.copro(numero), "pv_sbm") || {};
    const compte = proc.compte_vente || "";
    const edf = compte && /revente/.test(proc.mode || "") ? M.consoEdfPeriode([compte], debut, fin) : null;
    const injecte = edf ? Math.abs(edf.kwh || 0) : null;
    return { centrale: pv.centrale, capacite: pv.capacite, compte_injection: compte, mode: proc.mode || "", pdl_conso: proc.pdl_conso || "", mois, manquants: mois.length - connus.length, production,
      edf, injecte, ecart: injecte === null ? null : injecte - production, taux: injecte && production ? injecte / production : null,
      productible: pv.capacite && connus.length ? Math.round(production / pv.capacite) : null, fichiers: pv.fichiers || [] };
  };
  /** Consommation mensuelle d'un PDL : kWh et € TTC de chaque facture répartis au prorata des jours de sa période (du / au). */
  M.consoMensuellePdl = (rae, debut, fin) => {
    const c = facturesElec(), res = {};
    if (!c || !rae) return res;
    const d0 = jour(debut), f0 = jour(fin) + 1;
    for (const x of c.lignes) {
      if (x.r !== rae || !x.du || !x.au) continue;
      const a = jour(x.du), b = jour(x.au) + 1, n = b - a;
      if (n <= 0 || b <= d0 || a >= f0) continue;
      for (let j = Math.max(a, d0); j < Math.min(b, f0); j++) {
        const m = isoJour(j).slice(0, 7), r = (res[m] = res[m] || { kwh: 0, ttc: 0 });
        r.kwh += (x.k || 0) / n; r.ttc += (x.t || 0) / n;
      }
    }
    return res;
  };
  /** Économie estimée si la production était autoconsommée sur le PDL : chaque mois min(production, consommation),
      valorisé au prix moyen payé sur le PDL. Estimation haute : la production ne coïncide pas toujours avec les heures de consommation. */
  M.economiePv = (numero, debut, fin) => {
    const p = M.productionPv(numero, debut, fin);
    if (!p || !p.pdl_conso) return null;
    const conso = M.consoMensuellePdl(p.pdl_conso, debut, fin);
    const kwh = Object.values(conso).reduce((t, m) => t + m.kwh, 0), ttc = Object.values(conso).reduce((t, m) => t + m.ttc, 0);
    if (!kwh) return { pdl: p.pdl_conso, conso_kwh: 0, mois: [] };
    const prix = ttc / kwh;
    const mois = p.mois.map((m) => { const cm = conso[m.mois]; const auto = m.kwh === null || !cm ? null : Math.min(m.kwh, cm.kwh); return { mois: m.mois, production: m.kwh, conso: cm ? Math.round(cm.kwh) : null, autoconso: auto === null ? null : Math.round(auto) }; });
    const auto = mois.reduce((t, m) => t + (m.autoconso || 0), 0);
    const revenu = p.edf && p.edf.ttc ? Math.abs(p.edf.ttc) : null;
    return { pdl: p.pdl_conso, conso_kwh: Math.round(kwh), conso_ttc: U.arrondi(ttc, 2), prix: U.arrondi(prix, 4), mois, autoconso_kwh: auto,
      couverture: kwh ? auto / kwh : null, economie: U.arrondi(auto * prix, 2), revenu, gain: revenu === null ? null : U.arrondi(auto * prix - revenu, 2) };
  };
  /** Autoconsommation sans revente : impact réel sur les factures du PDL = consommation des mêmes mois avant la mise en service
      (moyenne des années précédentes disponibles) moins consommation depuis, valorisée au prix moyen payé. */
  M.autoconsommationPv = (numero, debut, fin) => {
    const p = M.productionPv(numero, debut, fin), pv = (S.db.pv || {})[numero];
    if (!p || !pv || !p.pdl_conso) return null;
    const avecProd = Object.keys(pv.mois).filter((m) => (pv.mois[m].kwh || 0) > 0).sort();
    const mise = pv.mise_en_service || (avecProd[0] || "");
    const etendue = M.etendueFactures();
    const apres = M.consoMensuellePdl(p.pdl_conso, debut, fin);
    const avant = etendue.du && mise ? M.consoMensuellePdl(p.pdl_conso, `${Number(mise.slice(0, 4)) - 4}-01-01`, `${mise}-01`) : {};
    delete avant[mise];
    const c = facturesElec(), couvert = (m) => c && jour(`${m}-01`) >= c.d0 - 45; // mois couvert par l'export (factures émises ensuite)
    const mois = p.mois.map((m) => {
      if (m.mois < mise) return { mois: m.mois, production: m.kwh, apres: null, avant: null, baisse: null };
      const refs = [1, 2, 3].map((n) => `${Number(m.mois.slice(0, 4)) - n}${m.mois.slice(4)}`).filter((k) => k < mise && avant[k] && couvert(k));
      const ref = refs.length ? refs.reduce((t, k) => t + avant[k].kwh, 0) / refs.length : null;
      const ap = apres[m.mois] ? apres[m.mois].kwh : null;
      return { mois: m.mois, production: m.kwh, apres: ap === null ? null : Math.round(ap), avant: ref === null ? null : Math.round(ref), annees_ref: refs.map((k) => k.slice(0, 4)),
        baisse: ref === null || ap === null ? null : Math.round(ref - ap) };
    });
    const comp = mois.filter((m) => m.baisse !== null);
    const kwh = Object.values(apres).reduce((t, m) => t + m.kwh, 0), ttc = Object.values(apres).reduce((t, m) => t + m.ttc, 0);
    const prix = kwh ? ttc / kwh : null;
    const baisse = comp.reduce((t, m) => t + m.baisse, 0), prodComp = comp.reduce((t, m) => t + (m.production || 0), 0);
    return { pdl: p.pdl_conso, mise_en_service: mise, mois, mois_compares: comp.length, avant_kwh: comp.reduce((t, m) => t + m.avant, 0), apres_kwh: comp.reduce((t, m) => t + m.apres, 0),
      baisse_kwh: baisse, prix: prix === null ? null : U.arrondi(prix, 4), economie: prix === null ? null : U.arrondi(baisse * prix, 2),
      taux: prodComp ? baisse / prodComp : null };
  };
  /** Résumé de l'exercice selon le type de production (PDF de la synthèse) : indicateurs {libelle, valeur, detail} et série mensuelle. */
  M.bilanPv = (c, exo) => {
    const proc = c && M.processCopro(c, "pv_sbm"), p = proc && M.productionPv(c.numero, exo.debut, exo.fin);
    if (!p) return null;
    const a = M.autoconsommationPv(c.numero, exo.debut, exo.fin), eco = M.economiePv(c.numero, exo.debut, exo.fin);
    const prix = (a && a.prix) || (eco && eco.prix) || null, kwh = (v) => `${U.nombre(v, 0)} kWh`, euro = (v) => (prix ? ` ≈ ${U.euro(v * prix)}` : "");
    const ind = [], revenu = p.edf && p.edf.ttc ? Math.abs(p.edf.ttc) : null;
    const baisse = () => (a && a.mois_compares ? { libelle: "Baisse mesurée sur les factures", valeur: `${kwh(a.baisse_kwh)}${a.economie !== null ? ` ≈ ${U.euro(a.economie)}` : ""}`,
      detail: `consommation du PDL ${U.nombre(a.avant_kwh, 0)} → ${kwh(a.apres_kwh)} sur ${a.mois_compares} mois comparables` } : null);
    if (proc.mode === "revente_totale") {
      if (p.injecte !== null) ind.push({ libelle: "Production vendue", valeur: kwh(p.injecte), detail: revenu !== null ? `revenu ${U.euro(revenu)}` : "" });
      if (p.taux) ind.push({ libelle: "Vendu / produit", valeur: `${Math.round(p.taux * 100)} %`, detail: "" });
    } else if (proc.mode === "autoconso_revente") {
      if (p.injecte !== null) {
        const auto = Math.max(0, p.production - p.injecte);
        ind.push({ libelle: "Surplus vendu", valeur: kwh(p.injecte), detail: revenu !== null ? `revenu ${U.euro(revenu)}` : "" });
        ind.push({ libelle: "Autoconsommé", valeur: `${kwh(auto)}${euro(auto)}`, detail: prix ? `au prix payé ${U.nombre(prix, 3)} €/kWh` : "" });
        if (prix && revenu !== null) ind.push({ libelle: "Gain total", valeur: U.euro(auto * prix + revenu), detail: "économie + revenu de la vente" });
      }
    } else if (proc.mode === "autoconso_pure") {
      ind.push({ libelle: "Autoconsommé", valeur: `${kwh(p.production)}${euro(p.production)}`, detail: "toute la production, consommée sur place" });
      if (baisse()) ind.push(baisse());
    } else {
      if (baisse()) ind.push(baisse());
      if (a && a.taux !== null) ind.push({ libelle: "Part de la production utilisée", valeur: `${Math.round(a.taux * 100)} %`, detail: `≈ ${kwh(Math.max(0, p.production - a.baisse_kwh))} injectés sans être rémunérés` });
    }
    const series = Object.fromEntries(((a && a.mois) || []).map((m) => [m.mois, m]));
    return { mode: proc.mode, mode_libelle: M.PROCESS.pv_sbm.modes[proc.mode] || "", centrale: p.centrale, capacite: p.capacite, production: p.production,
      manquants: p.manquants, productible: p.productible, indicateurs: ind,
      mois: p.mois.map((m) => ({ mois: m.mois, production: m.kwh, conso: series[m.mois] ? series[m.mois].apres : null, avant: series[m.mois] ? series[m.mois].avant : null })) };
  };
  M.definirModePv = (numero, mode) => { M.majProcess(S.copro(numero), "pv_sbm", { mode }); };
  M.definirPdlConsoPv = (numero, rae) => { M.majProcess(S.copro(numero), "pv_sbm", { pdl_conso: String(rae || "").trim() }); };
  M.definirCompteInjection = (numero, compte) => { M.majProcess(S.copro(numero), "pv_sbm", { compte_vente: String(compte || "").trim() }); };

  // ------------------------------------------------------------------ sous-compteurs (électricité et eau)
  /** Sous-compteurs d'une copro : {id, type, nom, emplacement, pdl, depart, arrivee, releves: {exercice: {date, index, ancien_final}}}.
      Relevé à chaque clôture ; conso = index N − index N-1, refacturée du compte de départ vers le compte d'arrivée au coût moyen complet :
      électricité (type « elec ») : TTC ÷ kWh des factures EDF du PDL principal datées dans l'exercice ;
      eau (type « eau ») : TTC ÷ m³ des factures d'eau de l'exercice, saisis pour la copro (c.factures_eau[exercice] = {ttc, m3}). */
  M.TODO_SOUS_COMPTEURS = "Relever les sous-compteurs";
  M.TYPES_SOUS_COMPTEUR = { elec: { libelle: "Électricité", unite: "kWh", icone: "⚡" }, eau: { libelle: "Eau", unite: "m³", icone: "💧" } };
  M.typeSc = (x) => (x && x.type === "eau" ? "eau" : "elec");
  M.uniteSc = (x) => M.TYPES_SOUS_COMPTEUR[M.typeSc(x)].unite;
  /** Factures d'eau d'un exercice saisies pour la copro : {ttc, m3} ou null. */
  M.facturesEau = (c, exo) => ((c.factures_eau || {})[exo] || null);
  M.definirFacturesEau = (c, exo, { ttc = "", m3 = "" } = {}) => {
    const t = String(ttc ?? "").trim() === "" ? null : U.nombreFr(ttc), v = String(m3 ?? "").trim() === "" ? null : U.nombreFr(m3);
    if ((t !== null && t < 0) || (v !== null && v < 0) || (String(ttc ?? "").trim() !== "" && t === null) || (String(m3 ?? "").trim() !== "" && v === null)) throw new Error("Montant ou volume invalide.");
    c.factures_eau = c.factures_eau || {};
    if (t === null && v === null) delete c.factures_eau[exo]; else c.factures_eau[exo] = { ttc: t, m3: v };
  };
  M.STATUTS_SOUS_COMPTEUR = { a_relever: "à relever", index_initial: "index de départ", index_incoherent: "index incohérent", sans_edf: "factures EDF manquantes", sans_eau: "eau facturée à saisir",
    sans_extraction: "extraction à importer", a_passer: "écriture à passer", passee: "écriture passée", ecart: "écart", meme_poste: "même compte : non contrôlable" };
  M.sousCompteurs = (c) => (c && c.sous_compteurs) || [];
  const champsSousCompteur = ["type", "nom", "emplacement", "pdl", "depart", "arrivee"];
  const pdlParRae = (c) => new Map(M.pdlCopro(c).pdl.map((p) => [p.rae, p]));
  /** Postes de charge (compte + clé de répartition) des extractions de la copro. Un même compte peut servir sous plusieurs clés :
      le poste s'écrit alors « compte|clé », sinon « compte » seul. */
  M.postesChargeCopro = (numero) => {
    const res = new Map();
    for (const b of Object.values(S.db.budgets).filter((x) => x.copro === numero))
      for (const l of b.lignes) if (/^6/.test(l.compte || "")) res.set(`${l.compte}|${l.cle || ""}`, { compte: l.compte, cle: l.cle || "", libelle: l.libelle });
    const parCompte = {};
    for (const x of res.values()) parCompte[x.compte] = (parCompte[x.compte] || 0) + 1;
    return [...res.values()].map((x) => ({ ...x, poste: parCompte[x.compte] > 1 ? `${x.compte}|${x.cle}` : x.compte }))
      .sort((a, b) => a.compte.localeCompare(b.compte) || a.cle.localeCompare(b.cle));
  };
  M.lirePoste = (poste) => { const [compte, cle] = String(poste || "").split("|"); return { compte: compte || "", cle: cle || "" }; };
  const dansPoste = (poste, compte, cle) => { const p = M.lirePoste(poste); return compte === p.compte && (!p.cle || (cle || "") === p.cle); };
  /** Compte de départ par défaut : compte de charge du PDL principal (avec sa clé si le compte sert sous plusieurs clés). */
  const departDuPdl = (c, rae) => {
    const p = pdlParRae(c).get(rae) || {};
    if (!p.compte_charge) return "";
    const postes = M.postesChargeCopro(c.numero).filter((x) => x.compte === p.compte_charge);
    return (postes.find((x) => x.cle === p.cle) || postes[0] || { poste: p.compte_charge }).poste;
  };
  const verifierSousCompteur = (x) => {
    if (!x.nom) throw new Error("Donnez un nom au sous-compteur.");
    x.type = M.typeSc(x);
    if (x.type === "eau") x.pdl = ""; // pas de PDL pour l'eau
  };
  M.ajouterSousCompteur = (c, champs) => {
    const x = { id: S.nouvelId(), type: "elec", nom: "", emplacement: "", pdl: "", depart: "", arrivee: "", releves: {}, cree_le: U.aujourdhui() };
    for (const k of champsSousCompteur) if (champs[k] !== undefined) x[k] = String(champs[k] || "").trim();
    if (M.typeSc(x) === "elec" && x.pdl && !x.depart) x.depart = departDuPdl(c, x.pdl); // départ = compte de charge du PDL principal
    verifierSousCompteur(x);
    (c.sous_compteurs = c.sous_compteurs || []).push(x);
    if (!M.todoProcess(c, "sous_compteurs")) {
      const t = M.ajouterTodo(c.numero, K.E.exerciceClos(c.exercice || "01/01 au 31/12", U.aujourdhui()), M.TODO_SOUS_COMPTEURS, "chaque_annee");
      t.process = "sous_compteurs"; // cochée seulement par le contrôle des écritures
    }
    return x;
  };
  M.majSousCompteur = (c, id, champs) => {
    const x = M.sousCompteurs(c).find((y) => y.id === id);
    if (!x) return null;
    const avant = { ...x };
    for (const k of champsSousCompteur) if (champs[k] !== undefined) x[k] = String(champs[k] || "").trim();
    if (champs.pdl !== undefined && M.typeSc(x) === "elec" && x.pdl && !x.depart) x.depart = departDuPdl(c, x.pdl);
    try { verifierSousCompteur(x); } catch (e) { Object.assign(x, avant); throw e; }
    return x;
  };
  M.supprimerSousCompteur = (c, id) => {
    c.sous_compteurs = M.sousCompteurs(c).filter((y) => y.id !== id);
    if (!c.sous_compteurs.length && S.db.todos && S.db.todos[c.numero]) S.db.todos[c.numero] = S.db.todos[c.numero].filter((t) => t.process !== "sous_compteurs");
  };
  /** Relevé de clôture d'un exercice ; index vide = relevé effacé. ancien_final : dernier index de l'ancien compteur s'il a été remplacé. */
  M.releverSousCompteur = (c, id, exercice, { date = "", index = "", ancien_final = "", photo = "", source = "" } = {}) => {
    const x = M.sousCompteurs(c).find((y) => y.id === id);
    if (!x) return;
    if (String(index ?? "").trim() === "") { delete x.releves[exercice]; return; }
    const i = U.nombreFr(index), af = String(ancien_final ?? "").trim() === "" ? null : U.nombreFr(ancien_final);
    if (i === null || i < 0) throw new Error("Index invalide.");
    if (String(ancien_final ?? "").trim() !== "" && (af === null || af < 0)) throw new Error("Index final de l'ancien compteur invalide.");
    x.releves[exercice] = { date: date || "", index: i, ...(af !== null ? { ancien_final: af } : {}), ...(photo ? { photo } : {}), ...(source ? { source } : {}) };
  };
  // ------------------------------------------------------------------ relevés saisis sur le téléphone (fichier déposé dans RESSOURCES\RELEVÉS)
  M.TYPE_FICHIER_RELEVES = "kbdd-releves-sous-compteurs";
  /** Exercice d'un relevé : celui dont la clôture est la plus proche de sa date (un relevé se fait à la clôture) ;
      doute si la date est à plus de 75 jours de cette clôture. */
  M.exercicePourReleve = (c, date) => {
    const exo = K.E.exerciceClos(c.exercice || "01/01 au 31/12", U.decalerJours(date, 120));
    const ecart = Math.abs(Date.parse(date) - Date.parse(exo.fin)) / 864e5;
    return { exo, doute: ecart > 75 };
  };
  /** Dernier relevé connu d'un sous-compteur : {exercice, date, index}. */
  M.dernierReleve = (x) => {
    const fin = (e) => (String(e).match(/\d{4}/g) || [""]).pop();
    const e = Object.keys(x.releves || {}).sort((a, b) => fin(b).localeCompare(fin(a)))[0];
    return e ? { exercice: e, ...x.releves[e] } : null;
  };
  /** Lit un fichier de relevés du téléphone et prépare leur intégration : exercice proposé, conso, relevé déjà saisi, anomalies. */
  M.lireRelevesTelephone = (texte) => {
    let d;
    try { d = JSON.parse(texte); } catch (e) { throw new Error("Fichier de relevés illisible."); }
    if (!d || d.type !== M.TYPE_FICHIER_RELEVES || !Array.isArray(d.releves)) throw new Error("Ce fichier n'est pas un fichier de relevés K-BDD.");
    return { cree_le: d.cree_le || "", lignes: d.releves.map((r, i) => {
      const c = S.copro(String(r.copro || "")), x = c && M.sousCompteurs(c).find((y) => y.id === r.sous_compteur);
      const base = { n: i, copro: r.copro, nom: r.nom || "", date: r.date || "", index: r.index, ancien_final: r.ancien_final ?? "", photo: r.photo || "" };
      if (!c || !x) return { ...base, erreur: "sous-compteur introuvable dans la base (supprimé ?)" };
      const { exo, doute } = M.exercicePourReleve(c, r.date || U.aujourdhui());
      const prec = x.releves[exo.decale(-1).libelle], existant = x.releves[exo.libelle];
      const index = U.nombreFr(r.index), af = r.ancien_final === "" || r.ancien_final === undefined ? null : U.nombreFr(r.ancien_final);
      const conso = prec && index !== null ? U.arrondi(af !== null ? af - prec.index + index : index - prec.index, 2) : null;
      const alertes = [];
      if (index === null) alertes.push("index invalide");
      if (conso !== null && conso < 0) alertes.push("index inférieur au précédent");
      if (doute) alertes.push(`relevé loin de la clôture (${U.jjmmaaaa(exo.fin)}) : vérifiez l'exercice`);
      if (existant && existant.index !== index) alertes.push(`remplace l'index ${U.nombre(existant.index, 0)} déjà saisi`);
      return { ...base, c, x, exercice: exo.libelle, doute, conso, existant: existant || null, alertes };
    }) };
  };
  const comptesDuPdl = (c, rae) => S.db.edf_comptes.filter((k) => k.copro === c.numero && M.pdlDuCompte(k.compte).includes(rae)).map((k) => k.compte);
  /** Conso, prix et montant d'un sous-compteur pour un exercice. */
  M.calculSousCompteur = (c, x, exo) => {
    const r = x.releves[exo.libelle] || null, p = x.releves[exo.decale(-1).libelle] || null;
    const res = { exercice: exo.libelle, releve: r, precedent: p, conso: null, prix: null, montant: null, edf: null, eau: null, unite: M.uniteSc(x) };
    if (!r) return { ...res, statut: "a_relever" };
    if (!p) return { ...res, statut: "index_initial" };
    res.conso = U.arrondi(r.ancien_final !== undefined ? r.ancien_final - p.index + r.index : r.index - p.index, 2);
    if (res.conso < 0) return { ...res, statut: "index_incoherent" };
    if (M.typeSc(x) === "eau") {
      const f = M.facturesEau(c, exo.libelle); // coût moyen : factures d'eau de l'exercice saisies pour la copro
      res.eau = f;
      if (!f || !f.ttc || !f.m3) return { ...res, statut: "sans_eau" };
      res.prix = f.ttc / f.m3;
      res.montant = U.arrondi(res.conso * res.prix, 2);
      return { ...res, statut: "calcule" };
    }
    const comptes = x.pdl ? comptesDuPdl(c, x.pdl) : [];
    const edf = comptes.length ? M.facturesEdfPeriode(comptes, exo.debut, exo.fin) : null; // coût moyen : factures EDF de l'exercice seulement
    res.edf = edf;
    if (!edf || !edf.kwh || !edf.ttc) return { ...res, statut: "sans_edf" };
    res.prix = edf.ttc / edf.kwh;
    res.montant = U.arrondi(res.conso * res.prix, 2);
    return { ...res, statut: "calcule" };
  };
  /** Contrôle des écritures d'un exercice d'après l'extraction des charges, sans dépendre du moment de l'extraction :
      montant initial d'un compte = factures EDF des PDL imputés sur ce compte (compta ≈ EDF) ; après écritures = initial − sorties + entrées.
      Compte de départ et d'arrivée comparés aux deux états : « passée » (après), « à passer » (avant), sinon « écart ». */
  M.controleSousCompteurs = (c, exo) => {
    const liste = M.sousCompteurs(c);
    if (!liste.length) return null;
    const b = S.db.budgets[`${c.numero}|${exo.libelle}`];
    const calc = liste.map((x) => ({ x, ...M.calculSousCompteur(c, x, exo) }));
    const reel = (k) => U.arrondi((b ? b.lignes : []).filter((l) => dansPoste(k, l.compte, l.cle)).reduce((t, l) => t + (Number(l.charges) || 0), 0), 2);
    const pdls = M.pdlCopro(c).pdl, edfPdl = new Map();
    const coutPdl = (rae) => { if (!edfPdl.has(rae)) { const ks = comptesDuPdl(c, rae); edfPdl.set(rae, ks.length ? M.consoEdfPeriode(ks, exo.debut, exo.fin).ttc || 0 : 0); } return edfPdl.get(rae); };
    const initial = (k) => {
      let v = pdls.filter((p) => dansPoste(k, p.compte_charge, p.cle)).reduce((t, p) => t + coutPdl(p.rae), 0); // factures des PDL imputés sur ce poste
      if (!v) v = [...new Set(liste.filter((x) => M.typeSc(x) === "elec" && x.depart === k && x.pdl).map((x) => x.pdl))].reduce((t, r) => t + coutPdl(r), 0); // compte de charge du PDL non renseigné
      const eau = M.facturesEau(c, exo.libelle); // factures d'eau imputées sur le compte de départ des sous-compteurs d'eau
      if (eau && eau.ttc && liste.some((x) => M.typeSc(x) === "eau" && x.depart === k)) v += eau.ttc;
      return U.arrondi(v, 2);
    };
    const flux = {};
    for (const l of calc) if (l.statut === "calcule" && l.x.depart && l.x.arrivee && l.x.depart !== l.x.arrivee) {
      flux[l.x.depart] = (flux[l.x.depart] || 0) - l.montant; flux[l.x.arrivee] = (flux[l.x.arrivee] || 0) + l.montant;
    }
    const etat = (k) => { const avant = initial(k); return { compte: k, avant, apres: U.arrondi(avant + (flux[k] || 0), 2), reel: reel(k), present: !!(b && b.lignes.some((l) => dansPoste(k, l.compte, l.cle))) }; };
    const lignes = calc.map((l) => {
      if (l.statut !== "calcule") return l;
      if (!l.x.depart || !l.x.arrivee) return { ...l, statut: "a_passer", incomplet: true };
      if (l.x.depart === l.x.arrivee) return { ...l, statut: "meme_poste" }; // débit et crédit du même compte : solde inchangé, rien à contrôler
      if (!b) return { ...l, statut: "sans_extraction" };
      const d = etat(l.x.depart), a = etat(l.x.arrivee);
      const tol = Math.max(2, Math.abs(d.avant) * 0.005), pres = (e, v) => Math.abs(e.reel - v) <= tol;
      const statut = pres(d, d.apres) && pres(a, a.apres) ? "passee" : pres(d, d.avant) && pres(a, a.avant) ? "a_passer" : "ecart";
      return { ...l, statut, depart: d, arrivee: a, passe_estime: U.arrondi(a.reel - a.avant, 2) /* reçu par le poste d'arrivée (le départ peut être commun à plusieurs sous-compteurs) */ };
    });
    const ok = lignes.every((l) => ["passee", "index_initial", "meme_poste"].includes(l.statut));
    return { exercice: exo.libelle, extraction: !!b, lignes, ok };
  };
  /** Tâche « Relever les sous-compteurs » : cochée si et seulement si le contrôle des écritures de l'exercice est bon. */
  M.synchroTodoSousCompteurs = (c, exo) => {
    const t = M.todoProcess(c, "sous_compteurs"), ctl = M.controleSousCompteurs(c, exo);
    if (!t || !ctl || t.depuis_debut > exo.debut) return ctl;
    const fait = !!t.fait[exo.libelle];
    if (ctl.ok && !fait) { M.cocherTodo(c.numero, t.id, exo, true); S.sauver(); }
    else if (!ctl.ok && fait) { M.cocherTodo(c.numero, t.id, exo, false); S.sauver(); }
    return ctl;
  };
})(globalThis.K = globalThis.K || {});
