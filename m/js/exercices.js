/* Exercices comptables — reprise des formules de l'onglet SYNTHÈSE CPTES.
   L1/L2 : début / fin (« 01/07 au 30/06 ») ; K1 : date de référence ;
   M1/M2 : dernier exercice clos (exercice N) ; N1/N2 : exercice N-1. */
(function (K) {
  "use strict";
  const U = K.U;

  function parseExercice(texte) {
    const m = String(texte || "").match(/^\s*(\d{1,2})\/(\d{1,2})\s*au\s*(\d{1,2})\/(\d{1,2})/);
    if (!m) return null;
    return { j1: +m[1], m1: +m[2], j2: +m[3], m2: +m[4] };
  }
  const jourFin = (j, m) => (m === 2 ? Math.min(j, 28) : j);

  class Exercice {
    constructor(debut, fin) { this.debut = debut; this.fin = fin; }
    get calendaire() { return this.debut.slice(5) === "01-01"; }
    /** '2025' ou '2025/2026' (cellule E10) */
    get libelle() { return this.calendaire ? this.fin.slice(0, 4) : `${this.debut.slice(0, 4)}/${this.fin.slice(0, 4)}`; }
    /** suffixe des extractions : '2025' ou '20252026' */
    get cleFichier() { return this.libelle.replace("/", ""); }
    /** suffixe des PDF : '2025' ou '2025 2026' (cellule K2) */
    get libelleFichier() { return this.libelle.replace("/", " "); }
    decale(n) {
      const f = (d) => { const a = Number(d.slice(0, 4)) + n; const md = d.slice(5) === "02-29" ? "02-28" : d.slice(5); return `${a}-${md}`; };
      return new Exercice(f(this.debut), f(this.fin));
    }
  }

  function exerciceClos(texte, reference) {
    const p = parseExercice(texte) || { j1: 1, m1: 1, j2: 31, m2: 12 };
    const ref = reference || U.aujourdhui();
    const annee = Number(ref.slice(0, 4));
    const finCetteAnnee = U.iso(annee, p.m2, jourFin(p.j2, p.m2));
    const anneeFin = finCetteAnnee < ref ? annee : annee - 1;
    const anneeDebut = p.j1 === 1 && p.m1 === 1 ? anneeFin : anneeFin - 1;
    return new Exercice(U.iso(anneeDebut, p.m1, p.j1), U.iso(anneeFin, p.m2, jourFin(p.j2, p.m2)));
  }

  function exerciceDepuisLibelle(texte, libelle) {
    const p = parseExercice(texte) || { j1: 1, m1: 1, j2: 31, m2: 12 };
    const annees = String(libelle || "").match(/\d{4}/g);
    if (!annees) return null;
    const anneeFin = Number(annees[annees.length - 1]);
    const anneeDebut = p.j1 === 1 && p.m1 === 1 ? anneeFin : anneeFin - 1;
    return new Exercice(U.iso(anneeDebut, p.m1, p.j1), U.iso(anneeFin, p.m2, jourFin(p.j2, p.m2)));
  }

  const libelleDepuisCle = (cle) => {
    const c = String(cle || "").replace(/\D/g, "");
    return c.length === 8 ? `${c.slice(0, 4)}/${c.slice(4)}` : c;
  };

  K.E = { Exercice, parseExercice, exerciceClos, exerciceDepuisLibelle, libelleDepuisCle };
})(globalThis.K = globalThis.K || {});
