/* Extrait quotidien du Registre national d'immatriculation des copropriétés (open data Anah, data.gouv.fr) :
   copropriétés gérées par le cabinet, lues par K-BDD (fiche copro, registre, calendrier), complétées par l'annuaire
   public du registre en direct (mandat, syndic, date de mise à jour : l'open data est publié avec une à deux semaines de retard).
   Usage : node outils/registre.js [fichier.csv local, pour essai]   (Node 20+) */
"use strict";
const fs = require("fs");
const path = require("path");

// cabinet : SIREN du syndic, établissement et département suivis
const SIREN = "326650165";
const ETABLISSEMENT = "32665016500185"; // KERMARREC SYNDIC, établissement de Rennes
const DEPARTEMENT = "35";
const JEU = "https://www.data.gouv.fr/api/1/datasets/registre-national-dimmatriculation-des-coproprietes/";
const SORTIE = path.join(__dirname, "..", "registre", "registre-copros.js");
// copropriétés suivies en plus (autre établissement, autre syndic…) : un n° d'immatriculation par ligne, # = commentaire
const SUIVIES = path.join(__dirname, "..", "registre", "suivies.txt");
const lireSuivies = () => {
  if (!fs.existsSync(SUIVIES)) return new Set();
  return new Set(fs.readFileSync(SUIVIES, "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim().toUpperCase()).filter((l) => /^[A-Z]{2}\d{7}$/.test(l)));
};
const CHAMPS = ["numero_immatriculation", "date_immatriculation", "date_derniere_maj", "mandat_en_cours", "date_fin_dernier_mandat",
  "nom_usage_copropriete", "numero_voie_adresse", "code_postal_adresse", "commune_adresse", "adresse_complementaire_1", "adresse_complementaire_2",
  "nombre_total_lots", "nombre_lots_habitation", "nombre_lots_stationnement", "periode_construction", "syndicat_principal_ou_secondaire",
  "siret_representant_legal", "copro_aidee"];

/** Une ligne CSV (séparateur virgule, champs entre guillemets) en tableau de valeurs. */
const lireLigne = (l) => {
  const res = []; let v = "", q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) { if (ch === '"') { if (l[i + 1] === '"') { v += '"'; i++; } else q = false; } else v += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { res.push(v); v = ""; }
    else v += ch;
  }
  res.push(v);
  return res;
};

/** Lit le CSV ligne par ligne (flux) et garde les copropriétés du cabinet. */
async function filtrer(lignes, suivies) {
  let entete = null; const copros = [];
  for await (const l of lignes) {
    if (!entete) { entete = lireLigne(l.replace(/^﻿/, "")); continue; }
    const numero = (l.match(/\b[A-Z]{2}\d{7}\b/) || [""])[0];
    if (!l.includes(SIREN) && !suivies.has(numero)) continue; // filtre rapide avant le découpage
    const v = lireLigne(l), x = Object.fromEntries(entete.map((k, i) => [k, (v[i] || "").trim()]));
    const suivie = suivies.has(x.numero_immatriculation);
    if (!suivie && !x.siret_representant_legal.startsWith(SIREN)) continue;
    if (!suivie && x.siret_representant_legal !== ETABLISSEMENT && !String(x.code_postal_adresse).startsWith(DEPARTEMENT)) continue;
    copros.push({ ...Object.fromEntries(CHAMPS.map((k) => [k, x[k] || ""])), ...(suivie ? { suivie: true } : {}) });
  }
  if (!entete || !entete.includes("numero_immatriculation")) throw new Error("Format du fichier du registre inattendu.");
  return copros.sort((a, b) => a.numero_immatriculation.localeCompare(b.numero_immatriculation));
}
async function* lignesDe(flux) {
  const dec = new TextDecoder("utf-8"); let reste = "";
  for await (const morceau of flux) {
    const t = reste + dec.decode(morceau, { stream: true }), ls = t.split("\n");
    reste = ls.pop();
    for (const l of ls) yield l.replace(/\r$/, "");
  }
  if (reste) yield reste;
}

// ------------------------------------------------------------------ annuaire public en direct (plus à jour que l'open data, publié avec retard)
const ANNUAIRE = "https://www.registre-coproprietes.gouv.fr/api/public/annuaire/";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (fr) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(fr || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
/** Fiche de l'annuaire d'une copropriété (null si introuvable ou service indisponible). */
async function ficheAnnuaire(numero) {
  const r = await fetch(ANNUAIRE + "rechercherAnnuaire", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isRechercheAvancee: true, adresseNonSelectionnee: null, adresseNonStructuree: null, numeroImmatriculation: numero }) });
  if (!r.ok) return null;
  const t = await r.text(), liste = t ? JSON.parse(t) : [];
  const x = liste.find((y) => y.numeroImmatriculation === numero);
  if (!x) return null;
  const d = await fetch(ANNUAIRE + "coproannuairedetail/" + x.id);
  if (!d.ok) return null;
  const f = await d.json(), rat = (f.immatCopropriete && f.immatCopropriete.infoRattachement) || {}, id = (f.immatCopropriete && f.immatCopropriete.identification) || {};
  return { id: x.id, nom: id.nomCopropriete || x.nomCopropriete || "", syndic: f.raisonSocialeOuNomSyndic || "", siret: f.siret || "", type_syndic: f.typeTeledeclarant || "",
    etat: f.etatCopropriete || "", date_derniere_modif: iso(f.dateDerniereModif), mandat_debut: iso(rat.dateDebutMandat), mandat_fin: iso(rat.dateFinMandat),
    justificatif: rat.typeJustifMandat || "", depose_le: iso(rat.dateTeleversement) };
}
/** Complète les lignes de l'open data par l'annuaire : mandat, syndic, nom et date de mise à jour quand l'annuaire est plus récent. */
async function completerParAnnuaire(copros, aujourdhui) {
  let lues = 0, erreurs = 0;
  for (const c of copros) {
    try {
      const a = await ficheAnnuaire(c.numero_immatriculation);
      await pause(300); // service public : une requête à la fois
      if (!a) continue;
      lues++;
      c.annuaire = a;
      if (a.date_derniere_modif && a.date_derniere_modif > (c.date_derniere_maj || "")) c.date_derniere_maj = a.date_derniere_modif;
      if (a.mandat_fin) { c.date_fin_dernier_mandat = a.mandat_fin; c.mandat_en_cours = a.mandat_fin >= aujourdhui ? "Mandat en cours" : "Pas de mandat en cours"; }
      if (a.siret) c.siret_representant_legal = a.siret;
      if (a.nom) c.nom_usage_copropriete = a.nom;
    } catch (e) { erreurs++; if (erreurs > 5) { console.error(`Annuaire indisponible : ${e.message}`); break; } }
  }
  return { lues, erreurs };
}

(async () => {
  let lignes, source = "", donneesDu = "";
  if (process.argv[2]) { lignes = lignesDe(fs.createReadStream(process.argv[2])); source = process.argv[2]; donneesDu = new Date().toISOString().slice(0, 10); }
  else {
    const jeu = await (await fetch(JEU)).json();
    const csv = jeu.resources.filter((r) => r.format === "csv" && !/dictionnaire/i.test(r.title));
    const r = csv.find((x) => /quotidien/i.test(x.title)) || csv.sort((a, b) => String(b.last_modified).localeCompare(String(a.last_modified)))[0];
    if (!r) throw new Error("Aucun fichier CSV dans le jeu de données du registre.");
    const rep = await fetch(r.url);
    if (!rep.ok) throw new Error(`Téléchargement impossible (HTTP ${rep.status}).`);
    lignes = lignesDe(rep.body); source = r.url; donneesDu = String(r.last_modified || "").slice(0, 10);
  }
  const suivies = lireSuivies();
  const copros = await filtrer(lignes, suivies);
  const absentes = [...suivies].filter((n) => !copros.some((c) => c.numero_immatriculation === n));
  if (!copros.length) throw new Error("Aucune copropriété du cabinet trouvée : fichier publié sans données ou SIREN modifié ?");
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const ann = process.env.SANS_ANNUAIRE ? { lues: 0, erreurs: 0 } : await completerParAnnuaire(copros, aujourdhui);
  const d = { donnees_du: donneesDu, annuaire_le: ann.lues ? aujourdhui : "", source: "Registre national d'immatriculation des copropriétés (Anah, data.gouv.fr, Licence Ouverte)", fichier: source,
    syndic: { siren: SIREN, etablissement: ETABLISSEMENT, departement: DEPARTEMENT }, suivies: [...suivies].sort(), introuvables: absentes, copros };
  fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
  fs.writeFileSync(SORTIE, `/* Généré par outils/registre.js : ne pas modifier à la main. */\nglobalThis.K_REGISTRE = ${JSON.stringify(d)};\n`);
  console.log(`${copros.length} copropriété(s), dont ${copros.filter((c) => c.suivie).length} suivie(s) en plus, données du ${donneesDu}, annuaire : ${ann.lues} fiche(s) lue(s).${absentes.length ? ` Introuvables : ${absentes.join(", ")}.` : ""}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
