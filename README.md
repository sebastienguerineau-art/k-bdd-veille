# Veille juridique immobilier / copropriété

Collecte quotidienne (GitHub Actions, vers 6 h 40 heure de Paris) d'articles de presse **publics** : législation, jurisprudence,
actualité des syndics et de la copropriété, Rennes / Ille-et-Vilaine, organisations professionnelles (FNAIM, UNIS, ANIL, ARC…).

Le fichier `veille/veille-donnees.js` est lu par l'application K-BDD (bouton « Mettre à jour » de la page Veille juridique,
et mise à jour automatique à l'ouverture). Ce dépôt ne contient aucune donnée privée de cabinet ni de copropriété.

- Sources, thèmes et classement : `js/veille.js`
- Collecte : `node outils/veille.js` (Node 18+)

## Registre des copropriétés

Chaque jour (GitHub Actions, vers 9 h 40 heure de Paris), `node outils/registre.js` télécharge le fichier quotidien du
[Registre national d'immatriculation des copropriétés](https://www.data.gouv.fr/fr/datasets/registre-national-dimmatriculation-des-coproprietes/)
(open data publié par l'Anah, Licence Ouverte) et n'en garde que les copropriétés gérées par l'établissement suivi
(constantes en tête du script) : `registre/registre-copros.js`, lu par K-BDD (contrôle de la mise à jour annuelle, fin de mandat, lots).
Il ne contient que des données déjà publiques du registre.
Pour suivre d'autres copropriétés (autre établissement, autre syndic…), ajoutez leur n° d'immatriculation dans
`registre/suivies.txt` (un par ligne) : l'extrait est régénéré aussitôt.

## Version mobile de consultation (`m/`)

`m/` contient la version téléphone de K-BDD, publiée par GitHub Pages (`…/k-bdd-veille/m/`). Elle est générée et anonymisée
par `outils/publier-mobile.py` du dépôt privé de l'application : aucune donnée de cabinet ni de copropriété. La base est
chargée par chaque utilisateur depuis sa propre sauvegarde OneDrive et reste dans son téléphone.
