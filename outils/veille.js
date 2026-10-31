/* Collecte de la veille juridique : lit les sources (js/veille.js), classe, fusionne avec l'historique
   et écrit veille/veille-donnees.js (chargé par la page « Veille juridique », y compris ouverte depuis le disque).

   Usage : node outils/veille.js            (Node 18+ ; lancé chaque jour par .github/workflows/veille.yml)
           node outils/veille.js --essai    (n'écrit rien, affiche le bilan) */
const fs = require("fs");
const path = require("path");
require(path.join(__dirname, "../js/veille.js"));
const V = globalThis.K.V;

const FICHIER = path.join(__dirname, "../veille/veille-donnees.js");
const PREFIXE = "globalThis.K_VEILLE = ";

/** Relit le fichier de données (objet JSON précédé de PREFIXE). */
function lire() {
  if (!fs.existsSync(FICHIER)) return { articles: [] };
  const t = fs.readFileSync(FICHIER, "utf8").trim();
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
}

async function lireSource(s) {
  const r = await fetch(s.url, { headers: { "User-Agent": s.format ? UA_NAV : "Mozilla/5.0 (K-BDD veille juridique)", Accept: s.format ? "text/html,application/xhtml+xml" : "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(25000), redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return s.format === "fnaim" ? V.lireFnaim(await r.text()) : V.lireFlux(await r.text());
}

// ------------------------------------------------------------------ illustration des articles
const UA_NAV = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const UA_APERCU = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

/** Lien Google Actualités -> adresse de l'article chez le média (null si impossible). */
async function resoudreGoogle(id) {
  const page = await (await fetch(`https://news.google.com/rss/articles/${id}`, { headers: { "User-Agent": UA_NAV }, signal: AbortSignal.timeout(15000) })).text();
  const sg = (page.match(/data-n-a-sg="([^"]+)"/) || [])[1], ts = (page.match(/data-n-a-ts="([^"]+)"/) || [])[1];
  if (!sg || !ts) return null;
  const req = [[["Fbv4je", JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
    "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]), null, "generic"]]];
  const r = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", { method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": UA_NAV }, body: "f.req=" + encodeURIComponent(JSON.stringify(req)) });
  const m = (await r.text()).match(/garturlres\\",\\"(https?:[^"\\]+)/);
  return m ? m[1] : null;
}

/** Image d'aperçu de l'article (beaucoup de médias refusent les robots : l'application affiche alors le logo du média). */
async function imageArticle(url) {
  for (const ua of [UA_NAV, UA_APERCU]) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!r.ok) continue;
      const img = V.imagePage(await r.text(), r.url || url);
      if (img) return img;
    } catch (e) { /* suivant */ }
  }
  return null;
}

/** Complète les articles récents : lien d'origine (url) et image. Une seule tentative par article (champ illustre_le). */
async function illustrer(articles, aujourdhui, { max = 250, depuis = 45 } = {}) {
  const limite = new Date(Date.parse(aujourdhui) - depuis * 86400000).toISOString().slice(0, 10);
  const file = articles.filter((a) => !a.illustre_le && !a.manuel && (a.date || a.trouve_le || "") >= limite).slice(0, max);
  let n = 0;
  const traiter = async (a) => {
    try {
      const id = V.idGoogle(a.lien);
      const url = id ? await resoudreGoogle(id) : a.lien;
      if (url) a.url = url;
      const img = url ? await imageArticle(url) : null;
      if (img) { a.image = img; n++; }
    } catch (e) { /* article laissé sans illustration */ }
    a.illustre_le = aujourdhui;
  };
  for (let i = 0; i < file.length; i += 4) {
    await Promise.all(file.slice(i, i + 4).map(traiter));
    await new Promise((ok) => setTimeout(ok, 300));
  }
  return { tentes: file.length, images: n };
}

async function main() {
  const essai = process.argv.includes("--essai");
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const donnees = lire();
  const lus = [];
  const etats = [];
  for (const s of V.sources()) {
    try {
      const articles = V.preparer(await lireSource(s), s, aujourdhui);
      lus.push(...articles);
      etats.push({ id: s.id, nom: s.nom, ok: true, n: articles.length });
    } catch (e) {
      etats.push({ id: s.id, nom: s.nom, ok: false, erreur: String(e.message || e).slice(0, 120) });
    }
    await new Promise((ok) => setTimeout(ok, 400)); // politesse envers les serveurs
  }
  const avant = new Set((donnees.articles || []).map((a) => a.id));
  const articles = V.fusionner(donnees.articles || [], lus, { aujourdhui });
  const nouveaux = articles.filter((a) => !avant.has(a.id)).length;
  const ill = process.argv.includes("--sans-images") ? null : await illustrer(articles, aujourdhui);
  if (ill) console.log(`Illustrations : ${ill.images} image(s) trouvée(s) sur ${ill.tentes} article(s) examiné(s).`);
  const echecs = etats.filter((e) => !e.ok);
  console.log(`${etats.length - echecs.length}/${etats.length} source(s) lue(s), ${lus.length} article(s) pertinents, ${nouveaux} nouveau(x), ${articles.length} conservé(s).`);
  echecs.forEach((e) => console.log(`  échec : ${e.nom} (${e.erreur})`));
  if (essai) return;
  if (echecs.length === etats.length) { console.error("Aucune source lisible : fichier inchangé."); process.exitCode = 1; return; }
  const sortie = { maj_le: new Date().toISOString(), sources: etats, articles };
  fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
  fs.writeFileSync(FICHIER, `/* Généré par outils/veille.js : ne pas modifier à la main. */\n${PREFIXE}${JSON.stringify(sortie, null, 0).replace(/},{"id"/g, '},\n{"id"')};\n`);
}

if (require.main === module) main();
module.exports = { lire, PREFIXE, illustrer };
