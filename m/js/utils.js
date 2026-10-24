/* Utilitaires : textes, nombres FR, dates, CSV des extractions ICS, IBAN. */
(function (K) {
  "use strict";
  const U = {};

  // ------------------------------------------------------------------ textes
  U.sansAccents = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  U.normaliser = (s) => U.sansAccents(s).toUpperCase().replace(/\s+/g, " ").trim();
  U.compacter = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  U.decoderNomZip = (nom) => String(nom).replace(/#U([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  U.echapper = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  U.numeroCopro = (v) => {
    if (v === null || v === undefined) return null;
    let s = String(typeof v === "number" && Number.isInteger(v) ? v : v).trim();
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
    if (!s) return null;
    if (/^\d+$/.test(s) && s.length < 4) s = s.padStart(4, "0");
    return s;
  };
  U.texteCompte = (v) => {
    if (v === null || v === undefined) return "";
    let s = String(v).trim();
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
    return s;
  };

  // ------------------------------------------------------------------ nombres
  U.nombreFr = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    let s = String(v).trim().replace(/[   €]/g, "");
    if (!s) return null;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const fmt = (v, d) => Math.abs(v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/\s/g, " ");
  U.euro = (v, signe = false) => {
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "";
    v = Number(v);
    if (signe) return (v >= 0 ? "+ " : "- ") + fmt(v, 2) + " €";
    return (v < 0 ? "-" : "") + fmt(v, 2) + " €";
  };
  U.nombre = (v, d = 2) => {
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "";
    v = Number(v);
    return (v < 0 ? "-" : "") + fmt(v, d);
  };
  U.pct = (v) => {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "string") return v;
    return (v >= 0 ? "+ " : "- ") + fmt(v * 100, 0) + "%";
  };
  U.pct2 = (v) => {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "string") return v;
    return (v >= 0 ? "+ " : "- ") + fmt(v * 100, 2) + "%";
  };
  U.saisie = (v) => (v === null || v === undefined || v === "" ? "" :
    Number(v).toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ","));
  U.arrondi = (v, d = 2) => Math.round((v + Number.EPSILON) * 10 ** d) / 10 ** d;

  // ------------------------------------------------------------------ dates (stockées en 'AAAA-MM-JJ')
  const iso = (a, m, j) => `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
  U.iso = iso;
  U.dateFr = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === "number") { // numéro de série Excel
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return iso(m[3], m[2], m[1]);
    m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
    if (m) return iso(m[1], m[2], m[3]);
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (m) return iso(2000 + Number(m[3]), m[2], m[1]);
    return null;
  };
  U.aujourdhui = () => U.dateFr(new Date());
  U.jjmmaaaa = (isoDate) => (isoDate ? `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}` : "");
  U.finMoisPrecedent = (ref) => {
    const r = ref || U.aujourdhui();
    const d = new Date(Date.UTC(Number(r.slice(0, 4)), Number(r.slice(5, 7)) - 1, 1) - 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  };
  U.decalerJours = (isoDate, jours) => {
    const d = new Date(Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10))) + jours * 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  };
  U.MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  U.dateLongue = (isoDate) => (isoDate ? `${Number(isoDate.slice(8, 10))} ${U.MOIS[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(0, 4)}` : "");
  U.horodatage = () => new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

  // ------------------------------------------------------------------ fichiers texte
  U.lireTexte = (contenu) => {
    if (typeof contenu === "string") return contenu;
    const octets = contenu instanceof Uint8Array ? contenu : new Uint8Array(contenu);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(octets).replace(/^﻿/, "");
    } catch (e) {
      return new TextDecoder("windows-1252").decode(octets);
    }
  };
  /* Lit un CSV ';' comme Power Query (Csv.Document, QuoteStyle.None). */
  U.lireCsv = (contenu, nbColonnes) => U.lireTexte(contenu).split(/\r?\n/).filter((l, i, t) => i < t.length - 1 || l !== "")
    .map((brut) => {
      let cols = brut.split(";");
      if (nbColonnes) cols = cols.concat(Array(nbColonnes).fill("")).slice(0, nbColonnes);
      return cols.map((c) => c.trim());
    });
  U.ecrireCsv = (lignes, entete) => "﻿" + [entete, ...lignes].map((l) => l.map((c) => {
    const s = String(c ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(";")).join("\r\n");

  // ------------------------------------------------------------------ banque
  U.ribVersIban = (rib) => {
    const bban = String(rib || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (bban.length !== 23) return "";
    const conv = (bban + "FR00").split("").map((c) => parseInt(c, 36).toString()).join("");
    let reste = 0;
    for (const ch of conv) reste = (reste * 10 + Number(ch)) % 97;
    const iban = `FR${String(98 - reste).padStart(2, "0")}${bban}`;
    return iban.match(/.{1,4}/g).join(" ");
  };
  U.decouperRib = (rib) => {
    const p = String(rib || "").split("-");
    if (p.length === 3 && p[2].length >= 13) return { banque: p[0], guichet: p[1], compte: p[2].slice(0, 11), cle: p[2].slice(11) };
    return { banque: "", guichet: "", compte: "", cle: "" };
  };
  U.extraireNumeroCopro = (libelle, numerosConnus) => {
    const re = /(?<!\d)(\d{4})(?!\d)/g;
    let m;
    while ((m = re.exec(libelle || ""))) if (numerosConnus.has(m[1])) return m[1];
    return null;
  };

  K.U = U;
})(globalThis.K = globalThis.K || {});
