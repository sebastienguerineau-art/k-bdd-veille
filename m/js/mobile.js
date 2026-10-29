/* K-BDD mobile : consultation en lecture seule sur téléphone.
   La base est chargée depuis la sauvegarde OneDrive (« K-BDD - sauvegarde.json », choisie dans les fichiers du téléphone)
   et gardée dans ce navigateur ; rien n'est modifié ni renvoyé. Les calculs sont ceux de l'application (metier, registre…). */
(function (K) {
  "use strict";
  const U = K.U, S = K.S, M = K.M;
  const h = U.echapper;
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const VEILLE = "../veille/veille-donnees.js"; // même site que la page
  const memo = {
    get: (k) => { try { return JSON.parse(localStorage.getItem("kbdd.m." + k)); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem("kbdd.m." + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
  };
  const base = () => memo.get("base") || null; // {fichier, fichier_du, base_du, charge_le}
  const vide = () => !Object.keys(S.db.copros).length;

  // ------------------------------------------------------------------ portefeuille
  const pfValide = (p) => !!p && S.db.personnes.some((x) => `${x.role}:${x.prenom}` === p);
  /** Comme sur le PC : choix mémorisé, sinon portefeuille par défaut des paramètres, sinon le comptable par défaut du PC. */
  const portefeuille = () => {
    const p = memo.get("portefeuille");
    if (p === "*") return "";
    if (pfValide(p)) return p;
    const d = S.param("portefeuille_defaut");
    if (d === "*") return "";
    if (pfValide(d)) return d;
    return "";
  };
  const optionsPortefeuille = () => {
    const pf = portefeuille(), roles = { comptable: "Comptable", gestionnaire: "Gestionnaire", assistante: "Assistante" };
    return `<option value="" ${pf ? "" : "selected"}>Tout le cabinet</option>${S.db.personnes.filter((p) => roles[p.role]).sort((a, b) => a.role.localeCompare(b.role) || a.prenom.localeCompare(b.prenom))
      .map((p) => `<option value="${h(`${p.role}:${p.prenom}`)}" ${pf === `${p.role}:${p.prenom}` ? "selected" : ""}>${roles[p.role]} · ${h(p.prenom)}</option>`).join("")}`;
  };
  const coprosPf = () => S.copros().filter((c) => c.actif && M.dansPortefeuille(c, portefeuille()));

  // ------------------------------------------------------------------ petits éléments
  const pastille = (cls, t) => `<span class="m-pastille ${cls}">${t}</span>`;
  const ligne = (l, v) => (v === "" || v === null || v === undefined ? "" : `<div class="m-ligne"><span>${l}</span><b>${v}</b></div>`);
  const section = (titre, corps, ouvert = false, badge = "") => (corps ? `<details class="m-section" ${ouvert ? "open" : ""}><summary>${titre}${badge}</summary><div class="m-corps">${corps}</div></details>` : "");
  const lienCopro = (c) => `#/copro/${encodeURIComponent(c.numero)}`;

  // ------------------------------------------------------------------ accueil
  const vueAccueil = () => {
    const pf = portefeuille(), actives = coprosPf();
    const suivi = M.suiviSyntheses(pf), aFaire = suivi.filter((l) => l.statut !== "envoyee");
    const todos = suivi.flatMap((l) => l.todos_ouvertes.map((t) => ({ l, t })));
    const rappros = M.listeCopros().filter((c) => c.actif && M.dansPortefeuille(c, pf) && ["retard", "alerte"].includes(c.rappro_statut));
    const med = M.medASuivre(pf);
    const numeros = new Set(actives.map((c) => c.numero));
    const impayes = S.db.impayes.filter((i) => numeros.has(i.copro) && !["Régularisé", "Traité"].includes(i.statut)).length
      + (S.db.incidents_bq || []).filter((i) => numeros.has(i.copro) && !["Régularisé", "Traité"].includes(i.statut)).length;
    const registre = M.registreCopros().length ? actives.map((c) => ({ c, k: M.controleRegistre(c) })).filter((x) => x.k && x.k.statut === "alerte") : [];
    const tuile = (n, l, lien, cls = "") => `<a class="m-tuile ${n ? cls : "ok"}" href="${lien}"><b>${n}</b><span>${l}</span></a>`;
    const auj = U.aujourdhui(), fin = U.decalerJours(auj, 45);
    const ev = M.calendrier(auj.slice(0, 7), 3, pf).filter((e) => e.date >= auj && e.date <= fin && e.statut !== "faite").sort((a, b) => a.date.localeCompare(b.date));
    return `<label class="m-pf">Portefeuille <select id="m-pf">${optionsPortefeuille()}</select></label>
      <div class="m-tuiles">
        ${tuile(aFaire.length, "synthèses à faire", "#/copros?f=synthese", "info")}
        ${tuile(todos.length, "tâches ouvertes", "#/taches", "info")}
        ${tuile(registre.length, "registre à mettre à jour", "#/copros?f=registre", "alerte")}
        ${tuile(rappros.length, "rappros en retard", "#/copros?f=rappro", "alerte")}
        ${tuile(med ? med.a_relancer : 0, "mises en demeure à relancer", "#/copros", "alerte")}
        ${tuile(impayes, "impayés CIC à traiter", "#/copros?f=impayes", "alerte")}
      </div>
      <h2 class="m-h2">Prochains 45 jours</h2>
      ${ev.length ? `<ul class="m-liste">${ev.slice(0, 15).map(evenement).join("")}</ul>${ev.length > 15 ? `<a class="m-plus" href="#/agenda">… ${ev.length - 15} autre(s) →</a>` : ""}` : '<p class="m-muted">Aucune échéance.</p>'}`;
  };
  const evenement = (e) => `<li><a href="${e.copro ? `#/copro/${encodeURIComponent(e.copro)}` : "#/agenda"}"><span class="m-date">${U.jjmmaaaa(e.date).slice(0, 5)}</span>
      <span class="m-txt"><b>${e.copro ? `${h(e.copro)} ` : ""}${h(e.titre)}</b>${e.nom ? `<small>${h(e.nom)}</small>` : e.detail ? `<small>${h(e.detail)}</small>` : ""}</span>
      ${e.statut === "a_faire" ? pastille("retard", "à faire") : ""}</a></li>`;

  // ------------------------------------------------------------------ liste des copros (recherche, filtres de l'accueil)
  const FILTRES = { synthese: "synthèse à faire", registre: "registre à mettre à jour", rappro: "rappro en retard", impayes: "impayés à traiter" };
  const vueCopros = (params) => {
    const f = FILTRES[params.f] ? params.f : "", pf = portefeuille();
    let liste = params.tout ? S.copros() : coprosPf();
    if (f === "synthese") { const s = new Set(M.suiviSyntheses(pf).filter((l) => l.statut !== "envoyee").map((l) => l.copro.numero)); liste = liste.filter((c) => s.has(c.numero)); }
    if (f === "registre") liste = liste.filter((c) => { const k = M.controleRegistre(c); return k && k.statut === "alerte"; });
    if (f === "rappro") { const s = new Set(M.listeCopros().filter((c) => ["retard", "alerte"].includes(c.rappro_statut)).map((c) => c.numero)); liste = liste.filter((c) => s.has(c.numero)); }
    if (f === "impayes") liste = liste.filter((c) => S.db.impayes.some((i) => i.copro === c.numero && !["Régularisé", "Traité"].includes(i.statut)) || (S.db.incidents_bq || []).some((i) => i.copro === c.numero && !["Régularisé", "Traité"].includes(i.statut)));
    return `<input type="search" id="m-cherche" class="m-cherche" placeholder="N°, nom, adresse, ville…" autocomplete="off" value="${h(params.q || "")}">
      <div class="m-filtres">${f ? `<a class="m-puce actif" href="#/copros">${h(FILTRES[f])} ✕</a>` : ""}
        <a class="m-puce ${params.tout ? "actif" : ""}" href="${params.tout ? "#/copros" : "#/copros?tout=1"}">${params.tout ? "toutes les copros ✕" : "toutes les copros (actives ou non)"}</a></div>
      <ul class="m-liste" id="m-copros">${liste.map((c) => `<li data-texte="${h(U.normaliser(`${c.numero} ${c.nom} ${c.adresse} ${c.ville}`))}"><a href="${lienCopro(c)}">
        <span class="m-num">${h(c.numero)}</span><span class="m-txt"><b>${h(c.nom)}</b><small>${h([c.adresse, c.ville].filter(Boolean).join(", "))}</small></span>
        ${c.actif ? "" : pastille("neutre", c.perdue ? "perdue" : "inactive")}</a></li>`).join("") || '<li class="m-muted">Aucune copro.</li>'}</ul>`;
  };
  const brancherCopros = () => {
    const champ = $("#m-cherche");
    const filtrer = () => { const q = U.normaliser(champ.value); $$("#m-copros li[data-texte]").forEach((li) => { li.hidden = !!q && !li.dataset.texte.includes(q); }); };
    champ.addEventListener("input", filtrer); filtrer();
  };

  // ------------------------------------------------------------------ fiche copro
  const tel = (s) => String(s || "").replace(/(\+?\d[\d .]{8,}\d)/g, (m) => `<a href="tel:${m.replace(/[ .]/g, "")}">${m}</a>`)
    .replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '<a href="mailto:$1">$1</a>');
  const vueCopro = (numero) => {
    const c = S.copro(numero);
    if (!c) return '<p class="m-muted">Copro introuvable.</p>';
    const adresse = [c.adresse, [c.code_postal, c.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const ht = M.honosHt(c.honos_ttc), un = M.honosParUnite(c.honos_ttc, c.quantite);
    // synthèse et tâches du dernier exercice clos
    const e = M.etatSynthese(c), STATUT = { a_faire: ["retard", "à faire"], en_cours: ["info", "fiche sauvegardée"], envoyee: ["ok", "mail préparé"] };
    const synthese = `${ligne("Exercice", `${h(e.exercice.libelle)} ${pastille(...STATUT[e.statut])}`)}${e.manquants.length ? ligne("Extractions", `${e.manquants.map((m) => m.role).join(" + ")} manquante(s)`) : ""}
      ${e.todos_ouvertes.length ? `<ul class="m-puces">${e.todos_ouvertes.map((t) => `<li>☐ ${h(t.texte)}</li>`).join("")}</ul>` : '<p class="m-muted">Aucune tâche ouverte.</p>'}`;
    // mandat
    const m = c.mandat || {}, fin = M.finMandat(m), ctl = M.controleMandat(c, K.E.exerciceClos(c.exercice || "01/01 au 31/12"), null);
    const mandat = fin || m.debut ? `${ligne("Mandat", `${m.debut ? `du ${U.jjmmaaaa(m.debut)} ` : ""}${fin ? `au ${U.jjmmaaaa(fin)}` : ""}`)}
      ${fin ? ligne("État", ctl.expire ? pastille("alerte", "expiré") : ctl.a_renouveler ? pastille("retard", "à renouveler à la prochaine AG") : pastille("ok", "en cours")) : ""}
      ${m.revision_pct !== "" && m.revision_pct !== undefined && m.revision_pct !== null ? ligne("Révision", `${U.nombre(Number(m.revision_pct), 1)} % par an`) : ""}${m.modalites ? `<p class="m-note">${h(m.modalites)}</p>` : ""}` : '<p class="m-muted">Non renseigné.</p>';
    // registre
    const k = M.registreCopros().length ? M.controleRegistre(c) : null;
    const MAJ = { a_jour: ["ok", "à jour"], a_faire: ["info", "à faire après l'AG"], en_retard: ["retard", "en retard"] };
    const registre = !k ? "" : k.statut === "ignoree" ? '<p class="m-muted">Hors registre.</p>' : !k.r ? '<p class="m-muted">Pas encore rattachée au registre (à faire sur le PC).</p>'
      : `${ligne("Immatriculation", h(k.r.numero_immatriculation))}${ligne("Mise à jour", `${U.jjmmaaaa(k.r.date_derniere_maj)} ${pastille(...MAJ[k.maj.statut])}`)}
        ${ligne("Échéance", U.jjmmaaaa(k.maj.echeance))}${ligne("Fin de mandat", U.jjmmaaaa(k.r.date_fin_dernier_mandat))}
        ${k.alertes.length ? `<ul class="m-puces">${k.alertes.map((a) => `<li class="m-${a.niveau}">${h(a.texte)}</li>`).join("")}</ul>` : ""}`;
    // banque et impayés
    const r = M.rapprochementCopro(c), st = r ? M.statutRapproLigne(r) : "absent";
    const banque = r ? `${ligne("Compte", h(r.libelle))}${ligne("Dernier relevé", `${U.jjmmaaaa(r.date_releve) || "—"} ${pastille(st === "ok" ? "ok" : "retard", st === "ok" ? "à jour" : "en retard")}`)}
      ${ligne("Solde relevé", U.euro(r.solde_releve))}${r.ecart ? ligne("Écart", U.euro(r.ecart)) : ""}` : '<p class="m-muted">Aucun compte dans le dernier contrôle rappro.</p>';
    const ouverts = (l) => !["Régularisé", "Traité"].includes(l.statut);
    const imp = S.db.impayes.filter((i) => i.copro === c.numero && ouverts(i)), inc = (S.db.incidents_bq || []).filter((i) => i.copro === c.numero && ouverts(i));
    const impayes = imp.length + inc.length ? `<ul class="m-liste compacte">${[...imp.map((i) => ({ d: i.date_impaye, t: i.debiteur || "N/A", m: i.montant, s: i.statut })),
      ...inc.map((i) => ({ d: i.date, t: `${i.type || "Incident"} · ${i.contrepartie || "N/A"}`, m: i.montant, s: i.statut }))]
      .map((x) => `<li><span class="m-date">${U.jjmmaaaa(x.d).slice(0, 5)}</span><span class="m-txt"><b>${h(x.t)}</b><small>${h(x.s)}</small></span><b>${U.euro(x.m)}</b></li>`).join("")}</ul>` : "";
    // copropriétaires
    const contacts = S.db.contacts.filter((x) => x.copro === c.numero);
    const copros = contacts.length ? `<input type="search" class="m-cherche petit" id="m-cherche-cp" placeholder="Chercher un copropriétaire…">
      <ul class="m-liste compacte" id="m-cp">${contacts.map((x) => `<li data-texte="${h(U.normaliser(`${x.nom} ${x.code}`))}"><span class="m-txt"><b>${h(x.nom)}</b><small>${tel(h(x.coordonnees))}</small></span></li>`).join("")}</ul>` : "";
    return `<a class="m-retour" href="#/copros">← Copros</a>
      <h1 class="m-h1"><span class="m-num">${h(c.numero)}</span> ${h(c.nom)}</h1>
      <p class="m-sous">${h([c.type, c.comptable && `comptable ${c.comptable}`, c.gestionnaire && `gestionnaire ${c.gestionnaire}`].filter(Boolean).join(" · "))}
        ${c.actif ? "" : pastille("neutre", c.perdue ? "perdue" : "inactive")}</p>
      ${adresse ? `<a class="m-adresse" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresse)}" target="_blank" rel="noopener">📍 ${h(adresse)}</a>` : ""}
      ${c.notes ? `<p class="m-note">${h(c.notes).replace(/\n/g, "<br>")}</p>` : ""}
      ${section("Informations", `${ligne("Exercice", h(c.exercice))}${ligne("Assistante", h(c.assistante))}${ligne("Lots", c.quantite ? `${U.nombre(c.quantite, 0)} ${c.lots_surface === "SURFACE" ? "m²" : "lots"}` : "")}
        ${ligne("Honoraires", c.honos_ttc ? `${U.euro(c.honos_ttc)} TTC` : "")}${ligne("", ht !== null && c.honos_ttc ? `${U.euro(ht)} HT${un !== null ? ` · ${U.nombre(un)} € HT / ${c.lots_surface === "SURFACE" ? "m²" : "lot"}` : ""}` : "")}
        ${c.decret_tertiaire ? ligne("Décret tertiaire", "soumise") : ""}`, true)}
      ${section(`Synthèse ${h(e.exercice.libelle)}`, synthese, e.todos_ouvertes.length > 0, e.todos_ouvertes.length ? ` <span class="m-n">${e.todos_ouvertes.length}</span>` : "")}
      ${section("Mandat de syndic", mandat, ctl.a_renouveler || ctl.expire)}
      ${section("Registre des copropriétés", registre, k && k.statut === "alerte", k && k.statut === "alerte" ? ' <span class="m-n alerte">!</span>' : "")}
      ${section("Banque", banque, st !== "ok")}
      ${section("Impayés CIC", impayes, false, imp.length + inc.length ? ` <span class="m-n alerte">${imp.length + inc.length}</span>` : "")}
      ${section(`Copropriétaires (${contacts.length})`, copros)}`;
  };
  const brancherCopro = () => {
    const champ = $("#m-cherche-cp");
    if (champ) champ.addEventListener("input", () => { const q = U.normaliser(champ.value); $$("#m-cp li").forEach((li) => { li.hidden = !!q && !li.dataset.texte.includes(q); }); });
  };

  // ------------------------------------------------------------------ tâches ouvertes
  const vueTaches = () => {
    const suivi = M.suiviSyntheses(portefeuille()).filter((l) => l.todos_ouvertes.length);
    return `<h1 class="m-h1">Tâches ouvertes</h1>${suivi.length ? suivi.map((l) => `<div class="m-carte"><a href="${lienCopro(l.copro)}"><b>${h(l.copro.numero)} ${h(l.copro.nom)}</b></a>
      <small class="m-muted"> · synthèse ${h(l.exercice.libelle)}</small><ul class="m-puces">${l.todos_ouvertes.map((t) => `<li>☐ ${h(t.texte)}</li>`).join("")}</ul></div>`).join("")
      : '<p class="m-muted">Aucune tâche ouverte.</p>'}`;
  };

  // ------------------------------------------------------------------ agenda
  const vueAgenda = () => {
    const auj = U.aujourdhui(), ev = M.calendrier(auj.slice(0, 7), 4, portefeuille()).filter((e) => e.date >= auj).sort((a, b) => a.date.localeCompare(b.date));
    const mois = [...new Set(ev.map((e) => e.mois))];
    const nomMois = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return `<h1 class="m-h1">Agenda</h1>${mois.map((m) => `<h2 class="m-h2">${h(nomMois(m))}</h2><ul class="m-liste">${ev.filter((e) => e.mois === m).map(evenement).join("")}</ul>`).join("") || '<p class="m-muted">Aucune échéance.</p>'}`;
  };

  // ------------------------------------------------------------------ veille juridique (collecte publique du jour)
  let veille = null;
  const vueVeille = () => {
    const d = veille || globalThis.K_VEILLE;
    if (!d) { chargerVeille(); return '<h1 class="m-h1">Veille juridique</h1><p class="m-muted">Chargement de la collecte du jour…</p>'; }
    const lu = memo.get("veille.lu") || {};
    const articles = (d.articles || []).map((a) => ({ ...a, ...K.V.classer(a) })).filter((a) => !K.V.sourceExclue(a) && !K.V.grandPublic(a) && a.domaine)
      .sort((a, b) => (b.date || b.trouve_le || "").localeCompare(a.date || a.trouve_le || "")).slice(0, 60);
    const lien = (a) => [a.url, a.lien].find((x) => /^https?:\/\//i.test(String(x || ""))) || "#";
    return `<h1 class="m-h1">Veille juridique</h1><p class="m-sous">Collecte du ${U.jjmmaaaa((d.maj_le || "").slice(0, 10))} · ${articles.length} articles récents</p>
      <ul class="m-liste">${articles.map((a) => `<li class="${lu[a.id] ? "lu" : ""}"><a href="${h(lien(a))}" target="_blank" rel="noopener" data-veille="${h(a.id)}">
        <span class="m-txt"><b>${h(a.titre)}</b><small>${h(a.source || "")} · ${U.jjmmaaaa(a.date || a.trouve_le)}${a.domaine === "syndic" ? " · copro" : ""}</small></span>
        ${a.prioritaire ? pastille("retard", "prioritaire") : ""}</a></li>`).join("")}</ul>`;
  };
  const chargerVeille = async () => {
    try {
      const t = await (await fetch(VEILLE + "?t=" + Date.now(), { cache: "no-store" })).text();
      veille = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
      if (location.hash.startsWith("#/veille")) afficher();
    } catch (e) { veille = globalThis.K_VEILLE || { articles: [] }; }
  };

  // ------------------------------------------------------------------ base : chargement depuis OneDrive, effacement
  const vueBase = () => {
    const b = base();
    return `<h1 class="m-h1">Base</h1>
      ${b ? `<div class="m-carte">${ligne("Fichier", h(b.fichier))}${ligne("Sauvegarde du", h(b.fichier_du))}${ligne("Chargée le", h(b.charge_le))}${ligne("Copros", Object.keys(S.db.copros).length)}</div>` : ""}
      <label class="m-bouton primaire">${b ? "Recharger depuis OneDrive" : "Charger la base depuis OneDrive"}<input type="file" id="m-fichier" hidden></label>
      <p class="m-aide">Dans la fenêtre qui s'ouvre, choisissez <b>OneDrive</b> puis <b>BASE DE DONNÉES › K-BDD - sauvegarde.json</b>.
        Sur iPhone : « Parcourir » › OneDrive. Sur Android : menu ☰ › OneDrive.</p>
      <p class="m-aide">Consultation seule : rien n'est modifié ni envoyé. La base reste dans ce téléphone jusqu'à son effacement.</p>
      ${b ? '<button class="m-bouton danger" id="m-effacer">Effacer la base de ce téléphone</button>' : ""}`;
  };
  const brancherBase = () => {
    $("#m-fichier").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const texte = await f.text(), d = JSON.parse(texte);
        S.restaurer(texte);
        memo.set("base", { fichier: f.name, fichier_du: new Date(f.lastModified).toLocaleString("fr-FR"), base_du: d.modifie_le || "", charge_le: new Date().toLocaleString("fr-FR") });
        message(`Base chargée : ${Object.keys(S.db.copros).length} copros.`);
        location.hash = "#/";
      } catch (err) { message(`Fichier illisible : ${err.message}`, true); }
    });
    const b = $("#m-effacer");
    if (b) b.addEventListener("click", async () => {
      if (!confirm("Effacer la base K-BDD de ce téléphone ?")) return;
      S.db = S.baseVide(); S.sauver(true); memo.set("base", null);
      message("Base effacée de ce téléphone."); afficher();
    });
  };

  // ------------------------------------------------------------------ relevés des sous-compteurs (saisis ici, envoyés par fichier dans OneDrive)
  /* Brouillons gardés dans ce téléphone (IndexedDB : les photos dépassent la place de localStorage) jusqu'à l'envoi.
     Clé : « copro|id du sous-compteur ». */
  const idbReleves = () => new Promise((ok, ko) => { const r = indexedDB.open("kbdd-releves", 1); r.onupgradeneeded = () => r.result.createObjectStore("releves"); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const lireBrouillons = async () => { const d = await idbReleves(); return new Promise((ok) => { const t = d.transaction("releves").objectStore("releves").get("tous"); t.onsuccess = () => ok(t.result || {}); t.onerror = () => ok({}); }); };
  const ecrireBrouillons = async (v) => { const d = await idbReleves(); return new Promise((ok, ko) => { const t = d.transaction("releves", "readwrite"); t.objectStore("releves").put(v, "tous"); t.oncomplete = ok; t.onerror = () => ko(t.error); }); };
  let brouillons = {};
  const coprosAvecSc = () => S.copros().filter((c) => c.actif && (c.sous_compteurs || []).length);
  const nombre = (v) => { const n = U.nombreFr(v); return n === null ? null : n; };
  /** Conso de l'an dernier (deux derniers relevés) pour repérer une conso anormale. */
  const consoPrecedente = (x) => {
    const fin = (e) => (String(e).match(/\d{4}/g) || [""]).pop();
    const ex = Object.keys(x.releves || {}).sort((a, b) => fin(b).localeCompare(fin(a)));
    if (ex.length < 2) return null;
    const a = x.releves[ex[0]], b = x.releves[ex[1]];
    return a.ancien_final !== undefined ? a.ancien_final - b.index + a.index : a.index - b.index;
  };
  const alertesReleve = (x, b) => {
    const d = M.dernierReleve(x), i = nombre(b.index), af = b.remplace ? nombre(b.ancien_final) : null, res = [];
    if (b.index !== "" && b.index !== undefined && i === null) res.push("index invalide");
    if (d && i !== null) {
      const conso = af !== null ? af - d.index + i : i - d.index, an = consoPrecedente(x);
      if (conso < 0) res.push(`index inférieur au dernier relevé (${U.nombre(d.index, 0)}) : compteur remplacé ?`);
      else if (an && conso > 2 * an) res.push(`conso ${U.nombre(conso, 0)} kWh : plus du double de l'an dernier (${U.nombre(an, 0)})`);
    }
    return res;
  };
  /** Conso du relevé saisi (depuis le dernier relevé connu), ou null. */
  const consoSaisie = (x, b) => {
    const d = M.dernierReleve(x), i = nombre(b.index), af = b.remplace ? nombre(b.ancien_final) : null;
    return d && i !== null ? (af !== null ? af - d.index + i : i - d.index) : null;
  };
  const infoConso = (x, b) => { const k = consoSaisie(x, b); return k === null || k < 0 ? "" : `+ ${U.nombre(k, 0)} kWh`; };
  const saisi = (b) => b.index !== "" && b.index !== undefined && !b.envoye_le;
  /** Clôture à relever d'une copro (la plus proche d'aujourd'hui, comme à l'intégration sur le PC) et sous-compteurs sans relevé pour elle. */
  const aRelever = (c) => {
    const { exo } = M.exercicePourReleve(c, U.aujourdhui());
    return { exo, manquants: c.sous_compteurs.filter((x) => !(x.releves || {})[exo.libelle]) };
  };
  const vueReleves = () => {
    const toutes = coprosAvecSc(), dansPf = toutes.filter((c) => M.dansPortefeuille(c, portefeuille()));
    const candidates = (dansPf.length ? dansPf : toutes).map((c) => ({ c, ...aRelever(c) }))
      .sort((a, b) => (b.manquants.length > 0) - (a.manquants.length > 0) || a.exo.fin.localeCompare(b.exo.fin) || a.c.numero.localeCompare(b.c.numero));
    const choix = memo.get("releves.copro"), tous = memo.get("releves.tous") === true;
    const sel = candidates.find((k) => k.c.numero === choix) || candidates.find((k) => k.manquants.length) || candidates[0];
    const liste = sel ? [sel.c] : [], prets = Object.values(brouillons).filter(saisi), envoyes = Object.values(brouillons).filter((b) => b.envoye_le);
    const encours = (c, x) => { const b = brouillons[`${c.numero}|${x.id}`]; return b && (saisi(b) || b.envoye_le); };
    const montrer = sel ? sel.c.sous_compteurs.filter((x) => tous || sel.manquants.includes(x) || encours(sel.c, x)) : [];
    const total = sel ? sel.manquants.length : 0, faits = sel ? sel.manquants.filter((x) => encours(sel.c, x)).length : 0;
    const option = (k) => `<option value="${h(k.c.numero)}" ${k === sel ? "selected" : ""}>${h(k.c.numero)} ${h(k.c.nom)} · ${k.manquants.length ? `${k.manquants.length} à relever` : "à jour"}</option>`;
    const carte = (c, x) => {
      const cle = `${c.numero}|${x.id}`, b = brouillons[cle] || {}, d = M.dernierReleve(x), al = alertesReleve(x, b), date = b.date || U.aujourdhui();
      const deja = sel && !sel.manquants.includes(x);
      return `<div class="m-releve ${b.envoye_le ? "envoye" : saisi(b) ? "fait" : ""} ${deja ? "deja" : ""}" data-releve="${h(cle)}">
        ${deja ? `<div class="mr-deja">déjà relevé pour cette clôture</div>` : ""}
        <div class="mr-tete"><div class="mr-nom"><b>${h(x.nom)}</b>${x.emplacement ? `<small>${h(x.emplacement)}</small>` : ""}</div>
          <div class="mr-prec">${d ? `<small>dernier</small><b>${U.nombre(d.index, 0)}</b><small>${U.jjmmaaaa(d.date) || h(d.exercice)}</small>` : "<small>aucun relevé</small>"}</div></div>
        <div class="mr-saisie"><input type="text" inputmode="decimal" data-r="index" value="${h(b.index ?? "")}" placeholder="Nouvel index" aria-label="Nouvel index">
          <label class="mr-photo" title="Photo du compteur">${b.photo ? `<img src="${b.photo}" alt="Photo du compteur">` : "📷"}<input type="file" accept="image/*" capture="environment" data-r="photo" hidden></label></div>
        <div class="mr-infos"><span class="mr-conso">${infoConso(x, b)}</span>
          <label class="mr-date">le <span>${U.jjmmaaaa(date)}</span> ✎<input type="date" data-r="date" value="${h(date)}" aria-label="Date du relevé"></label>
          <label class="mr-lien"><input type="checkbox" data-r="remplace" ${b.remplace ? "checked" : ""}>${b.remplace ? "remplacé ✓" : "remplacé ?"}</label></div>
        ${b.remplace ? `<input type="text" inputmode="decimal" class="mr-af" data-r="ancien_final" value="${h(b.ancien_final ?? "")}" placeholder="Index final de l'ancien compteur">` : ""}
        <ul class="m-puces">${al.map((a) => `<li class="m-alerte">⚠ ${h(a)}</li>`).join("")}</ul>
        ${b.envoye_le ? `<div class="mr-envoye">envoyé le ${h(b.envoye_le)}</div>` : ""}</div>`;
    };
    if (!sel) return '<h1 class="m-h1">Relevés</h1><p class="m-muted">Aucun sous-compteur dans la base chargée.</p>';
    const cachés = sel.c.sous_compteurs.length - montrer.length;
    return `<div class="mr-entete"><h1 class="m-h1">Relevés</h1><span class="mr-compte" id="mr-compte">${faits} / ${total} saisi${faits > 1 ? "s" : ""}</span></div>
      <label class="m-pf"><select id="mr-copro" aria-label="Copro">${candidates.map(option).join("")}</select></label>
      <p class="mr-cloture">Clôture du <b>${U.jjmmaaaa(sel.exo.fin)}</b> (exercice ${h(sel.exo.libelle)})</p>
      ${liste.map((c) => montrer.map((x) => carte(c, x)).join("")).join("")}
      ${!montrer.length ? `<p class="m-vide-ok">✓ Tous les sous-compteurs sont relevés pour cette clôture.</p>` : ""}
      ${cachés || tous ? `<button class="m-bouton" id="mr-tous">${tous ? "Masquer les déjà relevés" : `Voir aussi les déjà relevés (${cachés})`}</button>` : ""}
      ${prets.some((b) => b.copro !== sel.c.numero) ? `<p class="m-aide">D'autres copros ont aussi des relevés saisis : ils partiront avec le même envoi.</p>` : ""}
      <p class="m-aide">Gardés sur ce téléphone, même sans réseau. « Envoyer » crée un fichier à ranger dans OneDrive › BASE DE DONNÉES › RESSOURCES › RELEVÉS ; le PC les intègre après validation.</p>
      ${envoyes.length ? `<button class="m-bouton" id="m-vider">Effacer les ${envoyes.length} relevé${envoyes.length > 1 ? "s" : ""} déjà envoyé${envoyes.length > 1 ? "s" : ""}</button>` : ""}
      <button class="mr-envoyer" id="m-envoyer" ${prets.length ? "" : "hidden"}>Envoyer ${prets.length} relevé${prets.length > 1 ? "s" : ""}</button>`;
  };
  /** Photo réduite (1280 px, JPEG) : environ 200 Ko. */
  const reduirePhoto = (fichier) => new Promise((ok, ko) => {
    const img = new Image(), url = URL.createObjectURL(fichier);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      ok(cv.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => ko(new Error("Photo illisible."));
    img.src = url;
  });
  const brancherReleves = () => {
    $$("[data-releve]").forEach((carte) => {
      const cle = carte.dataset.releve, [copro, id] = cle.split("|");
      const maj = async (champs, reafficher) => {
        const x = (S.copro(copro).sous_compteurs || []).find((y) => String(y.id) === id);
        brouillons[cle] = { ...(brouillons[cle] || { date: U.aujourdhui() }), copro, sous_compteur: x.id, nom: x.nom, ...champs, envoye_le: "" };
        await ecrireBrouillons(brouillons);
        if (reafficher) return afficher();
        // carte mise à jour sans réafficher (le clavier reste ouvert) : conso, alertes, date, état
        const b = brouillons[cle], al = alertesReleve(x, b);
        $(".mr-conso", carte).textContent = infoConso(x, b);
        $(".m-puces", carte).innerHTML = al.map((a) => `<li class="m-alerte">⚠ ${h(a)}</li>`).join("");
        $(".mr-date span", carte).textContent = U.jjmmaaaa(b.date || U.aujourdhui());
        carte.classList.toggle("fait", saisi(b));
        majBoutonEnvoi();
      };
      $$("[data-r]", carte).forEach((ch) => ch.addEventListener("change", async () => {
        const k = ch.dataset.r;
        if (k === "photo") { if (!ch.files[0]) return; try { await maj({ photo: await reduirePhoto(ch.files[0]) }, true); } catch (e) { message(e.message, true); } return; }
        if (k === "remplace") return maj({ remplace: ch.checked }, true);
        await maj({ [k]: ch.value.trim() }, false);
      }));
    });
    const copro = $("#mr-copro");
    if (copro) copro.addEventListener("change", () => { memo.set("releves.copro", copro.value); afficher(); });
    const tous = $("#mr-tous");
    if (tous) tous.addEventListener("click", () => { memo.set("releves.tous", memo.get("releves.tous") !== true); afficher(); });
    const envoi = $("#m-envoyer");
    if (envoi) envoi.addEventListener("click", envoyerReleves);
    const vider = $("#m-vider");
    if (vider) vider.addEventListener("click", async () => {
      if (!confirm("Effacer de ce téléphone les relevés déjà envoyés ?")) return;
      for (const [k, b] of Object.entries(brouillons)) if (b.envoye_le) delete brouillons[k];
      await ecrireBrouillons(brouillons); afficher();
    });
  };
  const majBoutonEnvoi = () => {
    const n = Object.values(brouillons).filter(saisi).length, bt = $("#m-envoyer"), cpt = $("#mr-compte");
    if (bt) { bt.hidden = !n; bt.textContent = `Envoyer ${n} relevé${n > 1 ? "s" : ""}`; }
    if (cpt) { const f = $$(".m-releve.fait, .m-releve.envoye").filter((c) => !c.classList.contains("deja")).length; cpt.textContent = cpt.textContent.replace(/^\d+/, f).replace(/saisis?$/, f > 1 ? "saisis" : "saisi"); }
  };
  /** Fichier de relevés : partagé (iPhone : « Enregistrer dans Fichiers » › OneDrive › BASE DE DONNÉES › RESSOURCES › RELEVÉS), sinon téléchargé. */
  const envoyerReleves = async () => {
    const prets = Object.entries(brouillons).filter(([, b]) => b.index !== "" && b.index !== undefined && !b.envoye_le);
    if (!prets.length) return;
    const maintenant = new Date(), horo = maintenant.toISOString().slice(0, 16).replace("T", " ").replace(":", "h");
    const d = { type: M.TYPE_FICHIER_RELEVES, version: 1, cree_le: maintenant.toISOString(), releves: prets.map(([, b]) => ({
      copro: b.copro, sous_compteur: b.sous_compteur, nom: b.nom, date: b.date || U.aujourdhui(), index: b.index,
      ...(b.remplace && b.ancien_final ? { ancien_final: b.ancien_final } : {}), ...(b.photo ? { photo: b.photo } : {}) })) };
    const nom = `Relevés sous-compteurs ${horo}.json`, fichier = new File([JSON.stringify(d)], nom, { type: "application/json" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [fichier] })) await navigator.share({ files: [fichier], title: nom });
      else { const a = document.createElement("a"); a.href = URL.createObjectURL(fichier); a.download = nom; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    } catch (e) { if (e.name === "AbortError") return message("Envoi annulé : les relevés restent sur ce téléphone."); return message(`Envoi impossible : ${e.message}`, true); }
    const le = maintenant.toLocaleString("fr-FR").slice(0, 16);
    for (const [k] of prets) brouillons[k].envoye_le = le;
    await ecrireBrouillons(brouillons);
    message(`${prets.length} relevé(s) envoyé(s). Rangez le fichier dans OneDrive › BASE DE DONNÉES › RESSOURCES › RELEVÉS.`);
    afficher();
  };

  // ------------------------------------------------------------------ routeur
  /* icônes au trait (24 × 24, couleur du texte) */
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONES = {
    accueil: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>'),
    copros: svg('<rect x="4" y="3" width="11" height="18" rx="1.5"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M8 7h3M8 11h3M8 15h3M3 21h18"/>'),
    agenda: svg('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2"/>'),
    releves: svg('<path d="M4.5 18a9 9 0 1 1 15 0"/><path d="M12 13.5 15.5 9"/><circle cx="12" cy="14" r="1.6"/><path d="M8 21h8"/>'),
    base: svg('<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1 .5 7.97"/><path d="M12 11v9M9 17l3 3 3-3"/>'),
  };
  const ONGLETS = [["", "Accueil", ICONES.accueil], ["copros", "Copros", ICONES.copros], ["agenda", "Agenda", ICONES.agenda], ["releves", "Relevés", ICONES.releves], ["base", "Base", ICONES.base]];
  const route = () => {
    const [chemin, q] = (location.hash.slice(2) || "").split("?");
    const [page, arg] = chemin.split("/");
    return { page: page || "", arg: decodeURIComponent(arg || ""), params: Object.fromEntries(new URLSearchParams(q || "")) };
  };
  const message = (t, erreur) => {
    const m = document.createElement("div"); m.className = `m-toast ${erreur ? "erreur" : ""}`; m.textContent = t;
    document.body.appendChild(m); setTimeout(() => m.remove(), erreur ? 8000 : 3500);
  };
  const afficher = () => {
    const r = route(), page = $("#m-page"), b = base();
    $("#m-base").textContent = b && !vide() ? `base du ${(b.base_du ? new Date(b.base_du).toLocaleString("fr-FR") : b.fichier_du).slice(0, 16)}` : "";
    $("#m-onglets").innerHTML = ONGLETS.map(([k, l, i]) => `<a href="#/${k}" class="${(r.page === "copro" ? "copros" : r.page === "taches" ? "" : r.page) === k ? "actif" : ""}"><span>${i}</span>${l}</a>`).join("");
    if (vide() && !["base", "veille"].includes(r.page)) {
      page.innerHTML = `<div class="m-accueil-vide"><h1 class="m-h1">Bienvenue</h1><p>Chargez la sauvegarde OneDrive de K-BDD pour consulter vos copros sur ce téléphone.</p>
        <a class="m-bouton primaire" href="#/base">Charger la base</a></div>`;
      return;
    }
    const vues = { "": vueAccueil, copros: () => vueCopros(r.params), copro: () => vueCopro(r.arg), taches: vueTaches, agenda: vueAgenda, releves: vueReleves, veille: vueVeille, base: vueBase };
    page.innerHTML = (vues[r.page] || vueAccueil)();
    window.scrollTo(0, 0);
    if (r.page === "copros") brancherCopros();
    if (r.page === "copro") brancherCopro();
    if (r.page === "base") brancherBase();
    if (r.page === "releves") brancherReleves();
    const pf = $("#m-pf");
    if (pf) pf.addEventListener("change", () => { memo.set("portefeuille", pf.value || "*"); afficher(); });
    $$("[data-veille]").forEach((a) => a.addEventListener("click", () => { const lu = memo.get("veille.lu") || {}; lu[a.dataset.veille] = 1; memo.set("veille.lu", lu); a.closest("li").classList.add("lu"); }));
  };

  (async () => {
    await S.charger();
    try { brouillons = await lireBrouillons(); } catch (e) { brouillons = {}; }
    S.dossier = null; // jamais d'écriture dans un dossier depuis le téléphone
    window.addEventListener("hashchange", afficher);
    afficher();
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw-mobile.js").then((r) => r.update()).catch(() => {});
      // nouvelle version installée : rechargement une fois pour l'afficher tout de suite
      let recharge = false; const deja = !!navigator.serviceWorker.controller; // pas de rechargement à la toute première installation
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (deja && !recharge) { recharge = true; location.reload(); } });
    }
  })();
})(globalThis.K = globalThis.K || {});
