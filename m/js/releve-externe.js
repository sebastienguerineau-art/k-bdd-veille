/* Relevé de sous-compteurs confié à une autre personne (lien envoyé depuis K-BDD) : page autonome, sans base ni compte.
   La liste des compteurs est dans le lien (après « # », jamais envoyée au serveur) ; les saisies restent dans ce téléphone
   jusqu'à l'envoi d'un fichier de relevés au format K-BDD, à ranger dans OneDrive › BASE DE DONNÉES › RESSOURCES › RELEVÉS. */
(async function () {
  "use strict";
  const TYPE_FICHIER = "kbdd-releves-sous-compteurs";
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const nombre = (v) => { const t = String(v ?? "").replace(/\s/g, "").replace(",", "."); return t === "" || !/^-?\d+(\.\d+)?$/.test(t) ? null : Number(t); };
  const fr = (n) => (n === null || n === undefined ? "" : Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
  const jjmmaaaa = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
  const aujourdhui = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const UNITE = { elec: "kWh", eau: "m³" }, ICONE = { elec: "⚡", eau: "💧" };

  const page = $("#m-page");
  /** Lien court (« z… » : tableau compact compressé) ou premier format (JSON en base64url). */
  const decoder = async (t) => {
    const octets = (x) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    if (t[0] !== "z") return JSON.parse(decodeURIComponent(escape(atob(t.replace(/-/g, "+").replace(/_/g, "/")))));
    const brut = await new Response(new Blob([octets(t.slice(1))]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    const [, copro, nom, exercice, cloture, retour, ...sc] = JSON.parse(brut), long = (x) => (/^\d{8}$/.test(x || "") ? `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6)}` : "");
    return { copro, nom, exercice, cloture: long(cloture), retour, cree_le: "", sc: sc.map(([id, n, e, ty, idx, dt, an, fait]) => ({ id, nom: n, emplacement: e, type: ty === "e" ? "eau" : "elec",
      dernier: idx === null || idx === undefined ? null : { index: idx, date: long(dt), exercice: "" }, an, fait: !!fait })) };
  };
  let d;
  try { d = await decoder(location.hash.slice(1).replace(/^d=/, "")); } catch (e) { d = null; }
  if (!d || !Array.isArray(d.sc)) {
    page.innerHTML = '<h1 class="m-h1">Lien incomplet</h1><p class="m-muted">Ce lien de relevé est incomplet ou abîmé. Demandez à la personne qui vous l\'a envoyé de le renvoyer.</p>';
    return;
  }

  // brouillon gardé dans ce téléphone (photos comprises) tant que le fichier n'est pas envoyé
  const cle = `kbdd-releve-externe|${d.copro}|${d.exercice}|${d.cree_le}`;
  const idb = () => new Promise((ok, ko) => { const r = indexedDB.open("kbdd-releve-externe", 1); r.onupgradeneeded = () => r.result.createObjectStore("b"); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const lire = async () => { try { const db = await idb(); return await new Promise((ok) => { const t = db.transaction("b").objectStore("b").get(cle); t.onsuccess = () => ok(t.result || {}); t.onerror = () => ok({}); }); } catch (e) { return {}; } };
  const ecrire = async (v) => { try { const db = await idb(); db.transaction("b", "readwrite").objectStore("b").put(v, cle); } catch (e) { /* stockage indisponible : saisie gardée jusqu'à la fermeture */ } };
  let b = {};

  const conso = (x, r) => {
    const i = nombre(r.index), af = r.remplace ? nombre(r.ancien_final) : null;
    return x.dernier && i !== null ? (af !== null ? af - x.dernier.index + i : i - x.dernier.index) : null;
  };
  const alertes = (x, r) => {
    const res = [], i = nombre(r.index), k = conso(x, r);
    if (r.index && i === null) res.push("index invalide");
    if (k !== null && k < 0) res.push(`index inférieur au dernier relevé (${fr(x.dernier.index)}) : compteur remplacé ?`);
    else if (k !== null && x.an && k > 2 * x.an) res.push(`conso ${fr(k)} ${UNITE[x.type] || ""} : plus du double de l'an dernier (${fr(x.an)})`);
    return res;
  };
  const saisi = (r) => r && r.index !== undefined && r.index !== "";
  const reduirePhoto = (fichier) => new Promise((ok, ko) => {
    const img = new Image(), url = URL.createObjectURL(fichier);
    img.onload = () => { const k = Math.min(1, 1280 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); ok(cv.toDataURL("image/jpeg", 0.72)); };
    img.onerror = () => ko(new Error("Photo illisible."));
    img.src = url;
  });
  const message = (t, erreur) => { const m = document.createElement("div"); m.className = `m-toast ${erreur ? "erreur" : ""}`; m.textContent = t; document.body.appendChild(m); setTimeout(() => m.remove(), erreur ? 8000 : 4000); };

  const carte = (x) => {
    const r = b[x.id] || {}, date = r.date || aujourdhui(), k = conso(x, r), al = alertes(x, r);
    return `<div class="m-releve ${saisi(r) ? "fait" : ""}" data-id="${h(x.id)}">
      <div class="mr-tete"><div class="mr-nom"><b><span class="mr-type">${ICONE[x.type] || ""}</span> ${h(x.nom)}</b>${x.emplacement ? `<small>${h(x.emplacement)}</small>` : ""}</div>
        <div class="mr-prec">${x.dernier ? `<small>dernier</small><b>${fr(x.dernier.index)}</b><small>${jjmmaaaa(x.dernier.date) || h(x.dernier.exercice)}</small>` : "<small>aucun relevé</small>"}</div></div>
      ${x.fait ? '<div class="mr-deja">déjà relevé pour cette clôture</div>' : ""}
      <div class="mr-saisie"><input type="text" inputmode="decimal" data-r="index" value="${h(r.index ?? "")}" placeholder="Nouvel index" aria-label="Nouvel index">
        <label class="mr-photo" title="Photo du compteur">${r.photo ? `<img src="${r.photo}" alt="Photo du compteur">` : "📷"}<input type="file" accept="image/*" capture="environment" data-r="photo" hidden></label></div>
      <div class="mr-infos"><span class="mr-conso">${k !== null && k >= 0 ? `+ ${fr(k)} ${UNITE[x.type] || ""}` : ""}</span>
        <label class="mr-date">le <span>${jjmmaaaa(date)}</span> ✎<input type="date" data-r="date" value="${h(date)}" aria-label="Date du relevé"></label>
        <label class="mr-lien"><input type="checkbox" data-r="remplace" ${r.remplace ? "checked" : ""}>${r.remplace ? "remplacé ✓" : "remplacé ?"}</label></div>
      ${r.remplace ? `<input type="text" inputmode="decimal" class="mr-af" data-r="ancien_final" value="${h(r.ancien_final ?? "")}" placeholder="Index final de l'ancien compteur">` : ""}
      <ul class="m-puces">${al.map((a) => `<li class="m-alerte">⚠ ${h(a)}</li>`).join("")}</ul></div>`;
  };
  const prets = () => d.sc.filter((x) => saisi(b[x.id]));
  const afficher = () => {
    const n = prets().length;
    page.innerHTML = `<div class="mr-entete"><h1 class="m-h1">${h(d.copro)} ${h(d.nom)}</h1><span class="mr-compte">${n} / ${d.sc.length}</span></div>
      ${d.adresse ? `<p class="mr-cloture">${h(d.adresse)}</p>` : ""}
      <p class="mr-cloture">Relevés de la clôture du <b>${jjmmaaaa(d.cloture)}</b>. Pour chaque compteur : l'index affiché et une photo du cadran.</p>
      ${d.sc.map(carte).join("")}
      <label class="m-pf re-nom">Vos nom et prénom <input type="text" id="re-par" value="${h(b._par || "")}" placeholder="pour savoir qui a relevé" class="m-cherche"></label>
      <p class="m-aide">Vos saisies restent sur ce téléphone jusqu'à l'envoi. « Envoyer » prépare un fichier à transmettre${d.retour ? ` à <b>${h(d.retour)}</b>` : " à la personne qui vous a envoyé le lien"} (mail, WhatsApp…).</p>
      <button class="mr-envoyer" id="re-envoyer" ${n ? "" : "hidden"}>Envoyer ${n} relevé${n > 1 ? "s" : ""}</button>`;
    brancher();
  };
  const brancher = () => {
    $$("[data-id]").forEach((el) => {
      const id = el.dataset.id;
      $$("[data-r]", el).forEach((ch) => ch.addEventListener("change", async () => {
        const k = ch.dataset.r, r = b[id] = b[id] || {};
        if (k === "photo") { if (!ch.files[0]) return; try { r.photo = await reduirePhoto(ch.files[0]); } catch (e) { return message(e.message, true); } }
        else if (k === "remplace") r.remplace = ch.checked;
        else r[k] = ch.value.trim();
        await ecrire(b); afficher();
      }));
    });
    $("#re-par").addEventListener("change", (e) => { b._par = e.target.value.trim(); ecrire(b); });
    const env = $("#re-envoyer");
    if (env) env.addEventListener("click", envoyer);
  };
  const envoyer = async () => {
    const l = prets();
    if (!l.length) return;
    const maintenant = new Date(), horo = maintenant.toISOString().slice(0, 16).replace("T", " ").replace(":", "h");
    const fichier = { type: TYPE_FICHIER, version: 1, cree_le: maintenant.toISOString(), releve_par: b._par || "", externe: true,
      releves: l.map((x) => { const r = b[x.id]; return { copro: d.copro, sous_compteur: x.id, nom: x.nom, date: r.date || aujourdhui(), index: r.index,
        ...(r.remplace && r.ancien_final ? { ancien_final: r.ancien_final } : {}), ...(r.photo ? { photo: r.photo } : {}) }; }) };
    const nom = `Relevés sous-compteurs ${d.copro} ${horo}.json`, f = new File([JSON.stringify(fichier)], nom, { type: "application/json" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: nom, text: `Relevés des sous-compteurs ${d.copro} ${d.nom}` });
      else {
        const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = nom; a.click();
        if (d.retour) setTimeout(() => { location.href = `mailto:${encodeURIComponent(d.retour)}?subject=${encodeURIComponent(`Relevés sous-compteurs ${d.copro} ${d.nom}`)}&body=${encodeURIComponent(`Bonjour,\n\nVeuillez trouver en pièce jointe le fichier « ${nom} » (dans vos téléchargements).\n`)}`; }, 600);
      }
      message(`${l.length} relevé(s) envoyé(s). Merci !`);
    } catch (e) { if (e.name !== "AbortError") message(`Envoi impossible : ${e.message}`, true); }
  };
  lire().then((v) => { b = v || {}; afficher(); });
})();
