# Outil GRC Djamo — Google Apps Script (v10)

Dispositif de gestion des risques et de contrôle interne pour Djamo,
construit comme projet Google Apps Script **container-bound** (rattaché à
un classeur Google Sheets). Accessible de deux façons simultanées :

1. **Menu Google Sheets** « Risk Management », via les boîtes de dialogue
   modales classiques (`ouvrirDialogue_()`).
2. **Application web** (nouveau en v10) : mêmes écrans, ouverts dans un
   navigateur via une URL `https://script.google.com/macros/s/.../exec`.

Les deux modes partagent exactement le même code métier (fichiers `.gs`),
donc aucune divergence de logique entre Sheets et le Web App.

## Installation

1. Créez (ou ouvrez) un classeur Google Sheets basé sur le template
   `GRC_DJAMO_Template_v2` (feuilles `RISQUES`, `R02_EVALUATIONS_RISQUES`,
   `R03_MATRICE_CONTROLES`, `R04_EXECUTIONS_CONTROLES`,
   `R06_EVALUATIONS_CONTROLES`, `REF_REFERENTIELS`, `ECHELLES_COTATION`,
   `CONFIG`, `UTILISATEURS`, `APPETENCE`, `CARTOGRAPHIE`, etc.).
2. Extensions > Apps Script, puis copiez chaque fichier de ce dépôt dans
   l'éditeur, **en respectant le nom exact** (sans l'extension `.gs`/`.html`
   dans le nom du fichier côté éditeur — Apps Script l'ajoute lui-même).
3. Collez le contenu de `appsscript.json` dans le fichier de manifeste
   (icône ⚙️ « Afficher le fichier manifeste appsscript.json » dans les
   paramètres du projet Apps Script).
4. Rechargez le classeur. Le menu **Risk Management** apparaît.
5. Lancez **Risk Management > Administration > Contrôler l'installation**
   pour vérifier que tous les fichiers sont présents et à la bonne version
   (`v10`), puis **Administration > Mettre à niveau le classeur** pour
   initialiser `CONFIG`, les listes déroulantes et les colonnes techniques.
6. Lancez **Administration > Initialiser les vues** pour poser les formules
   de synthèse (`_SOURCE_SYNTHESE`, `SYNTHESE_RISQUES`).

## Déployer la Web App

Dans l'éditeur Apps Script : **Déployer > Nouveau déploiement >
Application web**.

- **Exécuter en tant que** : Utilisateur qui y accède (`USER_ACCESSING`)
- **Qui a accès** : Tout le monde dans Djamo (domaine) — déjà pré-rempli
  dans `appsscript.json` (`webapp.access = "DOMAIN"`)

Une fois déployée, l'URL est accessible depuis le menu **Risk Management >
Administration > 🌐 Ouvrir en Web App**, qui l'affiche directement dans
Sheets. Chaque redéploiement Apps Script conserve la même URL tant que
vous choisissez « Gérer les déploiements > Modifier » plutôt que d'en
créer un nouveau.

## Structure des fichiers

Convention de nommage : les fichiers Script commencent par deux chiffres
(ordre de dépendance logique, pas d'ordre d'exécution — Apps Script charge
tout le projet globalement), les fichiers HTML commencent par `UI_`.

| Fichier | Rôle |
|---|---|
| `00_Menu.gs` | Construit le menu Sheets, ouvre les dialogues, lien Web App |
| `01_Parametres.gs` | Constantes techniques : feuilles, lignes, préfixes d'ID |
| `02_Colonnes.gs` | Résolution des colonnes par nom d'en-tête (jamais par position) |
| `03_Lecture.gs` | Lecture des référentiels, CONFIG, utilisateurs, état des risques |
| `04_Outils.gs` | Fonctions génériques, calculs de cotation, séparation des tâches |
| `05_Synthese.gs` | Formules matricielles de synthèse (`SYNTHESE_RISQUES`) |
| `06_Departements.gs` + `UI_Departements.html` | Fiche des départements et pilotes de risque |
| `07_Processus.gs` + `UI_Processus.html` | Cartographie des processus (hiérarchie 3 niveaux) |
| `08_IAM.gs` + `UI_IAM.html` | Permissions RACI / IAM |
| `09_JournalGlobal.gs` + `UI_JournalGlobal.html` | Journal global (saisie manuelle) |
| `10_Evaluation.gs` + `UI_Evaluation.html` | Formulaire d'évaluation des risques |
| `11_Controles.gs` + `UI_Controles.html` | Catalogue des contrôles (R03) |
| `12_Executions.gs` + `UI_Executions.html` | Exécutions des contrôles (R04) |
| `13_Efficacite.gs` + `UI_Efficacite.html` | Évaluations d'efficacité des contrôles (R06) |
| `14_Anomalies.gs` + `UI_Anomalies.html` | Anomalies et incidents |
| `15_SynchroControles.gs` | Synchronise les colonnes de vue de R03 après exécution/efficacité |
| `16_WebApp.gs` + `UI_Accueil.html` | Point d'entrée `doGet()` et page d'accueil de la Web App |
| `17_FicheRisque.gs` + `UI_FicheRisque.html` | Fiche risque 360° (lecture seule, agrège tout) |
| `20_Validation.gs` + `UI_Validation.html` | Validation maker-checker des évaluations |
| `30_Cartographie.gs` + `UI_Cartographie.html` | Génération de la cartographie image PNG |
| `40_Visualisation.gs` + `UI_Visualisation.html` | Graphiques de progression (Chart.js) |
| `90_Administration.gs` | Contrôle d'installation, mise à niveau, diagnostic |
| `appsscript.json` | Manifeste : fuseau horaire, scopes OAuth, config Web App |

## Contrôle qualité intégré

Chaque fichier `.gs` porte une fonction marqueur
(`function fichier_XX_Nom_() { return 'v10'; }`) et chaque fichier HTML un
commentaire `<!-- MARQUEUR <nom> v10 -->`. **Risk Management > Administration
> Contrôler l'installation** les vérifie tous en un clic et signale tout
fichier manquant, mal nommé ou resté à une version antérieure.

## Points de vigilance connus (non bloquants)

- Le commentaire `<!-- MARQUEUR ... -->` de chaque page HTML doit se
  trouver **à l'intérieur** de la balise `<html>...</html>` (dans
  `<head>`), jamais avant `<!DOCTYPE html>` ni avant `<html>` : Apps
  Script élague silencieusement tout commentaire placé hors du document
  au moment de l'enregistrement du fichier, ce qui fait échouer
  `Contrôler l'installation` (« sans marqueur ») même quand le contenu
  collé est correct. Corrigé dans cette version (24/09/2026) — tous les
  marqueurs sont désormais dans `<head>`.
- `UI_Evaluation.html` et `UI_Validation.html` portent encore un marqueur
  `v9` (fonctionnels, mais pas encore recopiés au même rythme que les
  modules plus récents).
- La synchronisation des colonnes de vue de `R03_MATRICE_CONTROLES`
  (`15_SynchroControles.gs`) s'exécute en `try/catch` après chaque
  exécution ou évaluation d'efficacité : une erreur de synchro ne bloque
  jamais l'enregistrement primaire, mais peut laisser la vue de contrôle
  momentanément désynchronisée si elle échoue silencieusement.
- `09_JournalGlobal.gs` n'est volontairement pas encore raccordé en
  écriture automatique aux autres modules (saisie manuelle uniquement) :
  c'est une limitation documentée, pas un bug.

## Versioning Git

Ce dossier est prêt à être initialisé comme dépôt (`git init`, `git add .`,
premier commit). Le fichier `.clasp.json` n'est pas inclus (spécifique à
chaque installation `clasp` locale) : si vous utilisez
[`clasp`](https://github.com/google/clasp) pour synchroniser avec Apps
Script en ligne de commande, générez-le avec `clasp clone <scriptId>` ou
`clasp create`, puis faites-le pointer vers ce dossier.
