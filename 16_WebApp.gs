/**
 * =====================================================================
 *  FICHIER  : 16_WebApp               type : Script (.gs)
 *  SECTION  : Web App (second mode d'acces, hors menu Sheets)
 *  VA AVEC  : UI_Accueil (HTML) + les pages UI_*.html existantes
 *  VERSION  : v10
 * =====================================================================
 *
 * Ajoute un point d'entree Web App (doGet) qui sert les memes pages HTML
 * que le menu Risk Management (ouvrirDialogue_() dans 00_Menu.gs), sans
 * passer par SpreadsheetApp.getUi(). Les deux modes cohabitent : ce fichier
 * ne modifie rien du menu existant.
 *
 * Securite : le nom de fichier HTML servi n'est JAMAIS construit a partir
 * du parametre d'URL brut (e.parameter.page). Seule une cle presente dans
 * le manifeste PAGES_WEBAPP_ ci-dessous peut aboutir a un fichier reel ;
 * toute cle absente retombe sur la page d'accueil UI_Accueil.
 */

// ---------------------------------------------------------------- //
// 1. Manifeste des pages accessibles depuis la Web App (liste blanche)
// ---------------------------------------------------------------- //

/**
 * Cle de route courte -> { fichier, libelle }. Reprend les modules deja
 * exposes par correspondanceMenu_() (90_Administration.gs), sans en
 * modifier les noms de fonctions ou de fichiers.
 */
const PAGES_WEBAPP_ = {
  evaluation:   { fichier: 'UI_Evaluation',     libelle: 'Évaluation des risques' },
  validation:   { fichier: 'UI_Validation',     libelle: 'Validation' },
  cartographie: { fichier: 'UI_Cartographie',   libelle: 'Cartographie' },
  visualisation:{ fichier: 'UI_Visualisation',  libelle: 'Visualisation' },
  controles:    { fichier: 'UI_Controles',      libelle: 'Catalogue des contrôles' },
  executions:   { fichier: 'UI_Executions',     libelle: 'Exécutions des contrôles' },
  efficacite:   { fichier: 'UI_Efficacite',     libelle: 'Efficacité des contrôles' },
  anomalies:    { fichier: 'UI_Anomalies',      libelle: 'Anomalies et incidents' },
  departements: { fichier: 'UI_Departements',   libelle: 'Départements' },
  processus:    { fichier: 'UI_Processus',      libelle: 'Processus' },
  iam:          { fichier: 'UI_IAM',            libelle: 'RACI / IAM' },
  journal:      { fichier: 'UI_JournalGlobal',  libelle: 'Journal global' },
  ficheRisque:  { fichier: 'UI_FicheRisque',    libelle: 'Fiche risque 360°' }
};

const PAGE_ACCUEIL_WEBAPP_ = 'UI_Accueil';
const LIBELLE_ACCUEIL_WEBAPP_ = 'Risk Management';

// ---------------------------------------------------------------- //
// 2. Point d'entree Web App
// ---------------------------------------------------------------- //

/**
 * Sert une page HTML de la Web App. e.parameter.page est toujours resolu
 * via PAGES_WEBAPP_ (liste blanche) : jamais utilise directement comme nom
 * de fichier. Absence de parametre, ou cle inconnue -> page d'accueil.
 */
function doGet(e) {
  const cle = e && e.parameter ? String(e.parameter.page || '') : '';
  const entree = Object.prototype.hasOwnProperty.call(PAGES_WEBAPP_, cle) ? PAGES_WEBAPP_[cle] : null;

  const fichier = entree ? entree.fichier : PAGE_ACCUEIL_WEBAPP_;
  const libelle = entree ? entree.libelle : LIBELLE_ACCUEIL_WEBAPP_;

  return HtmlService.createHtmlOutputFromFile(fichier)
    .setTitle(libelle)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------------------------------------------------------------- //
// 3. Utilitaire de generation de lien interne
// ---------------------------------------------------------------- //

/**
 * URL de la Web App pointant vers une page du manifeste, ex. :
 * urlPageWebApp_('evaluation') -> https://script.google.com/.../exec?page=evaluation
 * Reutilisable par d'autres fichiers (ex. pour generer des liens internes
 * depuis UI_Accueil.html ou une autre page).
 */
function urlPageWebApp_(cle) {
  return ScriptApp.getService().getUrl() + '?page=' + cle;
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_16_WebApp_() { return 'v10'; }
