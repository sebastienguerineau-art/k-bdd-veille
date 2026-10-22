# Veille juridique immobilier / copropriété

Collecte quotidienne (GitHub Actions, vers 6 h 40 heure de Paris) d'articles de presse **publics** : législation, jurisprudence,
actualité des syndics et de la copropriété, Rennes / Ille-et-Vilaine, organisations professionnelles (FNAIM, UNIS, ANIL, ARC…).

Le fichier `veille/veille-donnees.js` est lu par l'application K-BDD (bouton « Mettre à jour » de la page Veille juridique,
et mise à jour automatique à l'ouverture). Ce dépôt ne contient aucune donnée de cabinet ni de copropriété.

- Sources, thèmes et classement : `js/veille.js`
- Collecte : `node outils/veille.js` (Node 18+)
