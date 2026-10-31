/* Veille juridique immobilier / syndic : sources, lecture des flux RSS / Atom, classement et fusion des articles.
   Utilisé par la page « Veille juridique » (navigateur) et par la collecte automatique (outils/veille.js, Node). */
(function (K) {
  "use strict";
  const V = {};

  const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  V.norm = norm;

  // ------------------------------------------------------------------ classement
  V.NATURES = { legislation: "Législation / réglementation", jurisprudence: "Jurisprudence", actualite: "Actualité" };
  V.PORTEES = { national: "National", local: "Local (Rennes / 35)" };
  V.DOMAINES = { syndic: "Syndic / copropriété", immobilier: "Immobilier général" };

  // motifs testés sur le texte sans accents, en minuscules
  const MOTIFS = {
    jurisprudence: /cour de cassation|cass\.? ?(3e )?civ|(3e|troisieme) chambre civile|conseil d'etat|cour d'appel|tribunal judiciaire|tribunal administratif|jurisprudence|\barret (du|n)|a juge que|censure l'arret|qpc|conseil constitutionnel|\bca [a-z]+,/,
    legislation: /\bloi\b|projet de loi|proposition de loi|\bdecret\b|\barrete (du|ministeriel|prefectoral)|ordonnance n|journal officiel|\bjorf\b|\bjo du\b|legifrance|amendement|\bsenat\b|assemblee nationale|reglementation|entre(ra)? en vigueur|nouvelle obligation|obligatoire (a|au|des) |circulaire|reponse ministerielle|\bobligations?\b|interdi(t|ction)|instaure|deliberation|conseil municipal/,
    local: /\brennes\b|rennes metropole|ille-et-vilaine|ille et vilaine|\b35 ?000\b|\bcesson|saint-jacques-de-la-lande|bruz\b|chantepie|betton|pace\b|thorigne|vezin|saint-gregoire|\bbretagne\b|saint-malo|vitre\b|fougeres|redon\b/,
    syndic: /copropri|\bsyndics?\b|syndicat des coproprietaires|conseil syndical|tantiemes|fonds de travaux|plan pluriannuel de travaux|\bpppt\b|carnet d'entretien|reglement de copropriete|parties communes|\basl\b|\baful\b|association syndicale|residence collective|immeubles? collectifs?|gestionnaire d'immeuble|administrateur de biens/,
    immobilier: /immobili|logement|habitat|\bbail\b|baux|locati|locataire|loyer|bailleur|proprietaire|\bdpe\b|performance energetique|renovation energetique|maprimerenov|urbanisme|permis de construire|\bplui?\b|notaire|transaction|agent immobilier|loi hoguet|construction|promoteur|foncier|fonciere|hlm|anah|\bcaf\b|apl\b|expulsion|trackdechets|dechets|amiante|diagnostic/,
  };

  /** Thèmes suivis : motif de reconnaissance, requête de recherche (collecte), domaine imposé, priorité. */
  V.THEMES = [
    { id: "permis_louer", libelle: "Permis de louer", prioritaire: true, domaine: "immobilier",
      motif: /permis de louer|autorisation prealable de mise en location|declaration de mise en location/,
      requetes: ['"permis de louer" Rennes', '"permis de louer" OR "autorisation préalable de mise en location"'] },
    { id: "trackdechets", libelle: "Trackdéchets / déchets dangereux", prioritaire: true, domaine: "syndic",
      motif: /trackdechets|bordereau de suivi des dechets|\bbsd(a|d)?\b|dechets dangereux|desamiantage|dechets amiantes/,
      requetes: ["Trackdéchets", "Trackdéchets syndic OR copropriété OR amiante"] },
    { id: "pppt", libelle: "PPPT / fonds de travaux / DTG", domaine: "syndic",
      motif: /plan pluriannuel de travaux|\bpppt\b|projet de plan pluriannuel|fonds de travaux|diagnostic technique global|\bdtg\b/,
      requetes: ['"plan pluriannuel de travaux" copropriété', '"fonds de travaux" copropriété'] },
    { id: "dpe", libelle: "DPE / loi Climat / passoires", domaine: "immobilier",
      motif: /\bdpe\b|diagnostic de performance energetique|passoires? (thermiques?|energetiques?)|loi climat|decence energetique|audit energetique|gel des loyers/,
      requetes: ["DPE copropriété OR \"DPE collectif\"", "passoires thermiques location interdiction"] },
    { id: "contrat_syndic", libelle: "Contrat et honoraires de syndic", domaine: "syndic",
      motif: /contrat (type )?de syndic|honoraires (du|de) syndic|mise en concurrence du syndic|changement de syndic|carte professionnelle|loi hoguet/,
      requetes: ['"contrat de syndic" OR "honoraires de syndic"'] },
    { id: "ag", libelle: "Assemblées générales / majorités", domaine: "syndic",
      motif: /assemblee generale|vote par correspondance|visioconference|majorite de l'article (24|25|26)|article (24|25|26) de la loi|convocation.{0,20}ag\b|proces-verbal/,
      requetes: ['"assemblée générale" copropriété décret OR loi OR arrêt'] },
    { id: "impayes", libelle: "Impayés de charges / recouvrement", domaine: "syndic",
      motif: /impayes de charges|charges impayees|recouvrement des charges|privilege (special )?du syndicat|saisie immobiliere|article 19-2/,
      requetes: ['"charges de copropriété" impayés syndic OR "syndicat des copropriétaires"'] },
    { id: "registre", libelle: "Registre / extranet / dématérialisation", domaine: "syndic",
      motif: /registre (national )?(d'immatriculation )?des coproprietes|immatriculation des coproprietes|extranet|espace en ligne securise|notification electronique|lettre recommandee electronique/,
      requetes: ['"registre national des copropriétés" OR "immatriculation des copropriétés"'] },
    { id: "irve", libelle: "Bornes de recharge (IRVE)", domaine: "syndic",
      motif: /bornes? de recharge|\birve\b|droit a la prise|recharge des vehicules electriques/,
      requetes: ['"bornes de recharge" copropriété'] },
    { id: "decret_tertiaire", libelle: "Décret tertiaire / OPERAT", domaine: "syndic",
      motif: /decret tertiaire|\boperat\b|eco-energie tertiaire|dispositif eco energie/,
      requetes: ['"décret tertiaire" OR OPERAT'] },
    { id: "habitat_degrade", libelle: "Habitat dégradé / copros en difficulté", domaine: "immobilier",
      motif: /habitat (degrade|indigne)|coproprietes? (degradees?|en difficulte)|marchands? de sommeil|mise en securite|insalubrite|\bperil\b|administrateur provisoire/,
      requetes: ['"habitat dégradé" copropriété OR "copropriétés dégradées"', '"habitat indigne" Rennes'] },
    { id: "bail_loyers", libelle: "Baux / loyers / IRL", domaine: "immobilier",
      motif: /encadrement des loyers|indice de reference des loyers|\birl\b|bail d'habitation|bail mobilite|conge pour vente|decence du logement|depot de garantie|charges recuperables|meuble de tourisme|airbnb|location saisonniere/,
      requetes: ['"encadrement des loyers" OR "indice de référence des loyers"', '"meublés de tourisme" loi OR Rennes'] },
    { id: "securite", libelle: "Ascenseurs / sécurité / diagnostics", domaine: "syndic",
      motif: /ascenseurs?|detecteurs? de fumee|securite incendie|colonnes? (seches|montantes)|amiante|plomb|\bgaz\b.{0,30}immeuble|diagnostic(s)? (amiante|plomb|technique)/,
      requetes: ["ascenseur copropriété obligation"] },
    { id: "fiscalite", libelle: "Fiscalité immobilière", domaine: "immobilier",
      motif: /taxe fonciere|\btfpb\b|taxe d'habitation|plus-values? immobilieres?|\blmnp\b|\bpinel\b|denormandie|valeurs locatives|droits de mutation/,
      requetes: ['"taxe foncière" copropriété OR "valeurs locatives" réforme OR "loi de finances" immobilier'] },
    { id: "urbanisme", libelle: "Urbanisme / PLUi", domaine: "immobilier",
      motif: /\bplui?\b|permis de construire|artificialisation|\bzan\b|declaration prealable de travaux|ravalement/,
      requetes: ["PLUi Rennes Métropole"] },
  ];
  V.THEME = Object.fromEntries(V.THEMES.map((t) => [t.id, t]));

  /** Mots-clés ajoutés par le cabinet (page Veille) : [{libelle, mots: "a, b"}] -> thèmes supplémentaires. */
  V.themesPerso = (liste) => (liste || []).filter((t) => t && t.libelle && t.mots).map((t, i) => {
    const mots = String(t.mots).split(/[,;\n]/).map((m) => norm(m)).filter(Boolean);
    return { id: "perso_" + i, libelle: t.libelle, perso: true, domaine: t.domaine || "", prioritaire: !!t.prioritaire,
      motif: mots.length ? new RegExp(mots.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")) : null };
  });

  /** Classe un article : nature, portée, domaine, thèmes, prioritaire. Le domaine est null si l'article est hors sujet. */
  V.classer = (a, themesPerso = []) => {
    const texte = norm(`${a.titre} ${a.resume || ""}`);
    const titre = norm(a.titre);
    const themes = [...V.THEMES, ...themesPerso].filter((t) => t.motif && t.motif.test(texte));
    let nature = "actualite";
    if (a.nature_source === "jurisprudence" || MOTIFS.jurisprudence.test(texte)) nature = "jurisprudence";
    else if (a.nature_source === "legislation" || MOTIFS.legislation.test(titre)) nature = "legislation";
    const portee = a.portee_source === "local" || MOTIFS.local.test(texte) ? "local" : "national";
    let domaine = null;
    if (MOTIFS.syndic.test(texte) || themes.some((t) => t.domaine === "syndic")) domaine = "syndic";
    else if (MOTIFS.immobilier.test(texte) || themes.length) domaine = "immobilier";
    const prioritaire = themes.some((t) => t.prioritaire) || (domaine === "syndic" && nature !== "actualite");
    return { nature, portee, domaine, themes: themes.map((t) => t.id), prioritaire };
  };

  // ------------------------------------------------------------------ sources
  const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:30d")}&hl=fr&gl=FR&ceid=FR:fr`;
  V.gnews = gnews;

  /** Sources lues par la collecte : recherches Google Actualités (fiables) et quelques flux officiels. */
  V.sources = () => [
    { id: "gn-copro-loi", nom: "Copropriété : lois et décrets", url: gnews('copropriété (loi OR décret OR arrêté OR "Journal officiel")') },
    { id: "gn-copro-juris", nom: "Copropriété : jurisprudence", url: gnews('copropriété ("Cour de cassation" OR "cour d\'appel" OR "3e chambre civile")'), nature: "jurisprudence" },
    { id: "gn-syndic", nom: "Syndics : actualité du métier", url: gnews('syndic copropriété') },
    { id: "gn-immo-loi", nom: "Immobilier : législation", url: gnews('immobilier OR logement (loi OR décret OR "entre en vigueur" OR "nouvelle obligation")') },
    { id: "gn-bail-juris", nom: "Baux : jurisprudence", url: gnews('(bail OR locataire OR bailleur) "Cour de cassation"'), nature: "jurisprudence" },
    { id: "gn-ce-urba", nom: "Conseil d'État : urbanisme / logement", url: gnews('"Conseil d\'État" (urbanisme OR logement OR copropriété)'), nature: "jurisprudence" },
    { id: "gn-rennes-logement", nom: "Rennes : copropriété, loyers, habitat", url: gnews('Rennes (copropriété OR syndic OR loyers OR "permis de louer" OR bailleurs OR "logement social" OR PLUi)'), portee: "local" },
    { id: "gn-rennes-metropole", nom: "Rennes Métropole : habitat, urbanisme, déchets", url: gnews('"Rennes Métropole" (habitat OR PLUi OR déchets OR urbanisme OR logement)'), portee: "local" },
    { id: "gn-35", nom: "Ille-et-Vilaine : copropriété, loyers", url: gnews('"Ille-et-Vilaine" (copropriété OR syndic OR loyers OR "permis de louer" OR bailleurs)'), portee: "local" },
    ...V.THEMES.flatMap((t) => t.requetes.map((q, i) => ({ id: `gn-${t.id}-${i + 1}`, nom: `Thème : ${t.libelle}`, url: gnews(q), theme: t.id }))),
    // organisations professionnelles et presse spécialisée (UNIS : flux RSS ; FNAIM : page presse lue directement ; SNPI et Plurience : par la presse)
    { id: "org-federations", nom: "Fédérations : FNAIM, UNIS, SNPI, Plurience", url: gnews('(FNAIM OR UNIS OR SNPI OR Plurience) (syndic OR copropriété OR "gestion locative" OR loi OR décret)'), organisme: true },
    { id: "org-unis", nom: "UNIS : actualités et notes juridiques (flux du site)", url: "https://www.unis-immo.fr/feed", organisme: true },
    { id: "org-fnaim", nom: "FNAIM : communiqués et prises de position (espace presse)", url: "https://www.fnaim.fr/3568-espace-presse.htm", format: "fnaim", organisme: true },
    { id: "org-anil", nom: "ANIL : analyses juridiques logement (anil.org)", url: gnews("site:anil.org"), organisme: true },
    { id: "org-arc", nom: "ARC : Association des responsables de copropriété", url: "https://arc-copro.fr/feed/", organisme: true },
    { id: "presse-irc", nom: "Edilaix : Informations Rapides de la Copropriété", url: "https://www.edilaix.com/feed/", organisme: true },
    { id: "presse-batiactu", nom: "Batiactu", url: "https://www.batiactu.com/accueil.rss", filtrer: true },
    { id: "org-adil", nom: "Réseau des ADIL : droit du logement", url: gnews('ADIL (loi OR décret OR "ce qui change" OR jurisprudence OR bail OR copropriété)'), organisme: true },
    { id: "org-anah", nom: "Anah : MaPrimeRénov' (Copropriété), rénovation", url: gnews("Anah (copropriété OR \"MaPrimeRénov' Copropriété\" OR MaPrimeRénov OR rénovation)"), organisme: true },
    { id: "org-notaires-35", nom: "Notaires : marché immobilier Bretagne / Rennes", url: gnews('notaires (Bretagne OR Rennes OR "Ille-et-Vilaine") immobilier'), portee: "local", organisme: true },
    // flux officiels (adresses susceptibles d'évoluer : une source en échec est signalée sur la page, sans bloquer les autres)
    { id: "sp-particuliers", nom: "Service-Public.fr (actualités)", url: "https://www.service-public.fr/abonnements/rss/actu-actualites-particuliers.rss", filtrer: true },
    { id: "sp-pro", nom: "Service-Public.fr (professionnels)", url: "https://www.service-public.fr/abonnements/rss/actu-actu-pro.rss", filtrer: true },
  ];

  // ------------------------------------------------------------------ lecture RSS / Atom (sans dépendance, Node et navigateur)
  const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", ocirc: "ô", hellip: "…", ndash: "–", mdash: "—" };
  const decoder = (s) => String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENTITES[e.toLowerCase()] ?? m;
  });
  const cdata = (s) => String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  /** Texte brut : CDATA retiré, entités décodées, balises HTML supprimées. */
  V.texte = (s) => decoder(decoder(cdata(s)).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  const balise = (bloc, noms) => {
    for (const n of noms) {
      const m = bloc.match(new RegExp(`<${n}(\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
      if (m) return m[2];
    }
    return "";
  };
  const dateIso = (s) => {
    const d = new Date(V.texte(s));
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  };

  /** Lit un flux RSS 2.0 ou Atom : [{titre, lien, date, source, resume}] */
  V.lireFlux = (xml) => {
    const blocs = String(xml).match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    return blocs.map((b) => {
      let lien = V.texte(balise(b, ["link"]));
      if (!lien) { const m = b.match(/<link\b[^>]*href="([^"]+)"/i); lien = m ? decoder(m[1]) : ""; }
      const source = V.texte(balise(b, ["source", "dc:creator"]));
      let titre = V.texte(balise(b, ["title"]));
      // Google Actualités : « Titre - Média »
      if (source && titre.endsWith(` - ${source}`)) titre = titre.slice(0, -source.length - 3).trim();
      let resume = V.texte(balise(b, ["description", "summary", "content"]));
      if (resume.startsWith(titre)) resume = resume.slice(titre.length).trim();
      if (source && resume.replace(/\s+/g, " ").trim() === source) resume = "";
      return { titre, lien, date: dateIso(balise(b, ["pubDate", "published", "updated", "dc:date"])), source, resume: resume.slice(0, 500) };
    }).filter((a) => a.titre && a.lien);
  };

  /** Page presse de la FNAIM (pas de flux RSS) : communiqués et actualités [{titre, lien, date, source, resume}]. */
  V.lireFnaim = (html) => (String(html).match(/<li class="item">[\s\S]*?<\/li>/gi) || []).map((b) => {
    const a = b.match(/<h3>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) return null;
    const d = (b.match(/class="date">[^<]*?(\d{2})\/(\d{2})\/(\d{4})/) || []);
    const lien = /^https?:/.test(a[1]) ? a[1] : `https://www.fnaim.fr${a[1].startsWith("/") ? "" : "/"}${a[1]}`;
    return { titre: V.texte(a[2]), lien, date: d[3] ? `${d[3]}-${d[2]}-${d[1]}` : "", source: "FNAIM", resume: V.texte((b.match(/class="resume">([\s\S]*?)<\/p>/i) || [])[1] || "").slice(0, 500) };
  }).filter((x) => x && x.titre && /\/(communiquepresse|actualite)\//.test(x.lien));

  // ------------------------------------------------------------------ illustration (collecte : lien d'origine et image de l'article)
  /** Identifiant d'un lien Google Actualités (« …/rss/articles/CBMi…?oc=5 »), null sinon. */
  V.idGoogle = (lien) => { const m = String(lien || "").match(/news\.google\.com\/(?:rss\/)?articles\/([^?#/]+)/); return m ? m[1] : null; };
  /** Image d'aperçu d'une page HTML (og:image / twitter:image), adresse absolue, null sinon. */
  V.imagePage = (html, url) => {
    const metas = String(html).slice(0, 400000).match(/<meta\b[^>]*>/gi) || [];
    for (const nom of ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]) {
      for (const m of metas) {
        const cle = (m.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
        const val = (m.match(/\bcontent\s*=\s*["']([^"']+)["']/i) || [])[1];
        if (cle && val && cle.toLowerCase() === nom) {
          try { const u = new URL(decoder(val).trim(), url); if (/^https?:$/.test(u.protocol) && !/logo|favicon|default|placeholder/i.test(u.pathname)) return u.href; } catch (e) { /* adresse invalide */ }
        }
      }
    }
    return null;
  };
  /** Nom de domaine d'un article (lien d'origine de préférence), pour le logo du média. */
  V.domaine = (a) => { try { const h = new URL(a.url || a.lien).hostname.replace(/^www\./, ""); return h === "news.google.com" ? "" : h; } catch (e) { return ""; } };

  // ------------------------------------------------------------------ affinage : sources exclues, conseils grand public, sujets repris
  /** Sources écartées d'office : contenus hors sujet pour un syndic (guides destinés aux particuliers, actualités étrangères traduites). */
  V.SOURCES_EXCLUES = ["Kohen Avocats", "kohenavocats.fr", "Vietnam.vn", "vietnam.vn"];
  /** Article d'une source exclue (liste par défaut + sources masquées par le cabinet) ? Comparaison sur le nom du média et le domaine. */
  V.sourceExclue = (a, perso = []) => {
    const s = norm(a.source), d = V.domaine(a);
    return [...V.SOURCES_EXCLUES, ...perso].some((x) => { const n = norm(x); return n && (s === n || d === n || (d && d.endsWith("." + n))); });
  };
  const GRAND_PUBLIC = /\bque faire\b|comment (faire|obtenir|contester|eviter|payer|calculer|beneficier|reduire|economiser|savoir)|date limite|(dernier|derniers) jours?\b|qui peut en beneficier|\b\d+ (situations|astuces|conseils|erreurs|choses|cas|questions)\b|ce qu'il faut savoir|tout savoir|ce qui change pour vous|bon plan|vos droits|\(20\d\d\)\s*$/;
  /** Conseil grand public sans enjeu pour un syndic (guides pratiques pour particuliers, taxe foncière du propriétaire…). */
  V.grandPublic = (a) => {
    const texte = norm(`${a.titre} ${a.resume || ""}`);
    if (MOTIFS.syndic.test(texte)) return false; // tout ce qui touche la copropriété reste visible
    if (GRAND_PUBLIC.test(norm(a.titre))) return true;
    const th = a.themes || [];
    return th.length === 1 && th[0] === "fiscalite" && (a.nature || "actualite") === "actualite";
  };
  const VIDES = new Set("dans pour avec sans sont leur leurs plus tout tous toutes cette ces elle elles nous vous votre vos quoi comment entre apres avant depuis encore aussi mais donc alors etre avoir fait faut peut doit selon".split(" "));
  const motsTitre = (t) => new Set(norm(String(t).replace(/\s[-–|]\s[^-–|]+$/, "")).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !VIDES.has(w)));
  /** Regroupe un même sujet repris par plusieurs médias : titres proches (mots communs ≥ seuil) publiés à moins de « jours » d'écart.
      [{article, autres: [...]}] dans l'ordre de la liste ; le premier article de chaque groupe le représente. */
  V.regrouper = (articles, { jours = 10, seuil = 0.4 } = {}) => {
    const groupes = [];
    const jour = (a) => Date.parse(a.date || a.trouve_le || "") / 864e5 || 0;
    for (const a of articles) {
      const m = motsTitre(a.titre), j = jour(a);
      const g = m.size >= 3 && groupes.find((x) => {
        if (Math.abs(x.jour - j) > jours) return false;
        let inter = 0; for (const w of m) if (x.mots.has(w)) inter++;
        return inter >= 3 && inter / (m.size + x.mots.size - inter) >= seuil;
      });
      if (g) g.autres.push(a); else groupes.push({ article: a, autres: [], mots: m, jour: j });
    }
    return groupes.map(({ article, autres }) => ({ article, autres }));
  };

  // ------------------------------------------------------------------ pertinence et sélection du jour (environ 10 articles par jour)
  /** Sources de référence : organisations professionnelles, institutions, éditeurs juridiques. */
  const REFERENCES = /unis-immo|fnaim|\bunis\b|anil\b|anil\.org|arc-copro|\barc\b|edilaix|informations rapides de la copropriete|service-public|legifrance|vie-publique|ecologie\.gouv|economie\.gouv|courdecassation|conseil-etat|dalloz|editions-legislatives|efl\.fr|lexbase|landot|actu-juridique|village-justice|anah|adil/;
  /** Presse régionale hors Bretagne : son actualité locale ne concerne pas le cabinet. */
  const REGIONALE = /ladepeche|depeche|lindependant|l'independant|midilibre|midi libre|laprovence|la provence|nicematin|nice-matin|varmatin|leprogres|le progres|ledauphine|dauphine libere|lavoixdunord|voix du nord|estrepublicain|est republicain|dna\.fr|dernieres nouvelles d'alsace|sudouest|sud ouest|lanouvellerepublique|la nouvelle republique|centrepresse|larepubliquedespyrenees|corsematin|corse-matin|lamontagne|la montagne|lyonne|courrier-picard|courrier picard|paris-normandie|ouest-eclair|charentelibre|charente libre|le berry|lejsl|bienpublic|le bien public|lunion|l'union|ardennais|ici\.fr|\bici\b|france bleu|francebleu|actu\.fr|lanouvelle/;
  const FAITS_DIVERS = /poignard|meurtr|assassin|homicide|agress|\bviole?e?\b|\bvole?s? (a|de|chez)\b|cambriol|incendi|\bbrule|explosion|\bdrame\b|tragique|\bmort(e|s)?\b|decede|\bdeces\b|cadavre|corps sans vie|\bblesse|policier|la police|forces de l'ordre|gendarm|interpell|garde a vue|reclusion|\bproces\b|tribunal correctionnel|cour d'assises|condamne a|\bprison|\bballes?\b|\barmes? (a feu|blanche)|fusillade|trafic de|drogue|rixe/;
  const PAS_FAIT_DIVERS = /obligation|reglement|norme|securite incendie|detecteur|assurance|prevention|loi\b|decret/;
  const MARCHE = /prix (de l'immobilier|des logements|au m2|du m2)|marche (immobilier|du logement|de l'ancien)|taux (de credit|immobilier|d'interet)|credit immobilier|pret immobilier|investissement locatif|investir|\bscpi\b|rendement locatif|bourse|acheter ou louer|palmares|classement des villes|ou acheter|barometre|notaires de france.*prix|meilleures villes|inabordable|ville(s)? ou (acheter|investir)/;
  const ENTREPRISES = /\bnomme(e)?\b|nouveau (directeur|president|pdg)|nouvelle (directrice|presidente)|prend la (tete|direction)|entame un nouveau mandat|chiffre d'affaires|resultats (annuels|semestriels)|rachat|acquisition|leve(e)? de fonds|\bsalon\b|inaugur|recrute|recrutement|offres? d'emploi|\bcdd\b|\bcdi\b|\(h\/f\)|start-?up|partenariat|mecenat|anniversaire/;
  const COPRO = /copropri|\bsyndics?\b|conseil(s|ler)? syndica|assemblee generale|\bag\b|tantiemes|parties communes|fonds de travaux|\bpppt\b|\bppt\b|\bdtg\b|reglement de copro|carnet d'entretien/;
  const RACOLEUR = /pourquoi (ca|cela)|ce que (vous|ca)|\bvoici\b|\b\d+ (votes|leviers|astuces|travaux|erreurs|choses|conseils|raisons|pieges|questions)\b|vous (laissez|risquez|devez|pouvez)|attention a|ne faites (pas|plus)|les meilleurs/;
  const EVENEMENT = /rencontre du club|presentation (du )?programme|webinaire|conference|\bforum\b|exposition|dates?, horaires|tarifs\b|spectacle|concert|festival|\bsalon\b/;
  const ETRANGER = /pologne|espagne|belgique|suisse|maroc|dubai|etats-unis|new york|londres|royaume-uni|allemagne|italie|portugal|canada|quebec|chine|japon|vietnam|algerie|tunisie|senegal|geneve|luxembourg|monaco/;
  /** Note de pertinence pour un syndic (Rennes) : textes officiels, jurisprudence, copropriété, thèmes suivis, sources de référence ;
      faits divers, actualité d'autres régions, marché et vie des entreprises pénalisés. */
  V.score = (a) => {
    const texte = norm(`${a.titre} ${a.resume || ""}`), titre = norm(a.titre), src = norm(`${a.source || ""} ${V.domaine(a)}`);
    const officiel = a.nature === "legislation" || a.nature === "jurisprudence";
    let n = a.domaine === "syndic" ? (COPRO.test(texte) ? 4 : 2) : 1; // « syndic » sans mot de la copropriété (bornes, IRVE…) : moins sûr
    if (officiel) n += a.domaine === "syndic" ? 4 : 3;
    if (a.prioritaire) n += 3;
    if (a.portee === "local") n += 2;
    if (REFERENCES.test(src) || (a.via || []).some((v) => /^org-|^sp-|^presse-irc/.test(v))) n += 3;
    if (/\bunis\b|unis-immo|fnaim/.test(src) || (a.via || []).some((v) => v === "org-unis" || v === "org-fnaim")) n += 3; // syndicats professionnels : en tête
    if (a.manuel) n += 10;
    if (!officiel && FAITS_DIVERS.test(titre) && !PAS_FAIT_DIVERS.test(titre)) n -= 7;
    if (!officiel && MARCHE.test(titre)) n -= 3;
    if (ENTREPRISES.test(titre)) n -= 3;
    if (ETRANGER.test(titre)) n -= 4;
    if (a.portee !== "local" && REGIONALE.test(src)) n -= 3;
    if (RACOLEUR.test(titre)) n -= 2;
    if (EVENEMENT.test(titre)) n -= 4;
    if (a.grand_public) n -= 4;
    if (/^\d{2}\.\d{2}\.\d{2} ?:/.test(a.titre || "") && /anil/.test(src)) n -= 1; // fiches pratiques datées de l'ANIL
    return n;
  };
  V.SEUIL_SELECTION = 4;       // en dessous : jamais retenu
  V.SEUIL_INCONTOURNABLE = 11; // au-dessus : toujours retenu (texte officiel copropriété, thème prioritaire officiel…)
  /** Sélection du jour : par jour de collecte, les « parJour » meilleurs sujets (un sujet repris par plusieurs médias compte une fois),
      au-dessus du seuil, plus les incontournables. Renvoie l'ensemble des id retenus (représentants et articles regroupés). parJour = 0 : tout. */
  V.selection = (articles, parJour = 10) => {
    const ids = new Set();
    const parJourCollecte = new Map();
    for (const a of articles) { const j = a.trouve_le || a.date || ""; if (!parJourCollecte.has(j)) parJourCollecte.set(j, []); parJourCollecte.get(j).push(a); }
    for (const liste of parJourCollecte.values()) {
      const notes = new Map(liste.map((a) => [a.id, a.score ?? V.score(a)]));
      const groupes = V.regrouper(liste.slice().sort((x, y) => notes.get(y.id) - notes.get(x.id)))
        .map((g) => ({ ...g, note: Math.max(notes.get(g.article.id), ...g.autres.map((x) => notes.get(x.id))) + Math.min(2, g.autres.length) }))
        .sort((x, y) => y.note - x.note);
      let pris = 0;
      for (const g of groupes) {
        const garder = !parJour || g.note >= V.SEUIL_INCONTOURNABLE || (pris < parJour && g.note >= V.SEUIL_SELECTION);
        if (!garder) continue;
        pris++;
        ids.add(g.article.id); g.autres.forEach((x) => ids.add(x.id));
      }
    }
    return ids;
  };

  // ------------------------------------------------------------------ identifiants, fusion
  const hash = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); };
  /** Même titre (à la ponctuation près) = même article, quel que soit le média ou le flux. */
  V.cle = (titre) => norm(titre).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  V.id = (titre) => hash(V.cle(titre));

  /**
   * Ajoute les articles lus (déjà classés) à la liste existante, sans doublon ; garde la plus ancienne date
   * de découverte, ajoute les médias supplémentaires, applique la durée de conservation.
   */
  V.fusionner = (existants, nouveaux, { aujourdhui, conservationJours = 400, maximum = 2500 } = {}) => {
    const parId = new Map((existants || []).map((a) => [a.id, a]));
    for (const n of nouveaux) {
      const id = n.id || V.id(n.titre);
      const a = parId.get(id);
      if (!a) { parId.set(id, { ...n, id, trouve_le: n.trouve_le || aujourdhui }); continue; }
      if (n.source && a.source !== n.source && !(a.autres_sources || []).includes(n.source)) a.autres_sources = [...(a.autres_sources || []), n.source].slice(0, 8);
      a.via = [...new Set([...(a.via || []), ...(n.via || [])])];
      if (!a.resume && n.resume) a.resume = n.resume;
      if (!a.date && n.date) a.date = n.date;
    }
    const limite = aujourdhui ? new Date(Date.parse(aujourdhui) - conservationJours * 86400000).toISOString().slice(0, 10) : "";
    return [...parId.values()]
      .filter((a) => (!limite || (a.date || a.trouve_le || "") >= limite) && !V.sourceExclue(a))
      .sort((a, b) => (b.date || b.trouve_le || "").localeCompare(a.date || a.trouve_le || ""))
      .slice(0, maximum);
  };

  /** Articles lus d'une source -> articles classés, hors sujet écartés. */
  V.preparer = (articles, source, aujourdhui) => articles.map((a) => {
    const c = V.classer({ ...a, nature_source: source.nature, portee_source: source.portee });
    if (source.theme && !c.themes.includes(source.theme)) c.themes.push(source.theme);
    if (!c.domaine && source.theme) c.domaine = V.THEME[source.theme].domaine;
    return { ...a, id: V.id(a.titre), ...c, via: [source.id], trouve_le: aujourdhui };
  }).filter((a) => a.domaine && (!a.date || !aujourdhui || (a.date <= aujourdhui && a.date >= recent(aujourdhui))) && !V.sourceExclue(a));
  /** Articles publiés depuis moins de 60 jours (une page presse ou un flux peut remonter des textes anciens). */
  const recent = (aujourdhui) => new Date(Date.parse(aujourdhui) - 60 * 864e5).toISOString().slice(0, 10);

  K.V = V;
})(globalThis.K = globalThis.K || {});
