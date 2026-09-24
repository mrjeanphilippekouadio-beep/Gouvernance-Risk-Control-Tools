/**
 * =====================================================================
 *  FICHIER  : 00_Menu                 type : Script (.gs)
 *  SECTION  : SOCLE COMMUN, indispensable quel que soit le menu utilise
 *  VERSION  : v10
 * =====================================================================
 *
 * Construit le menu Risk Management. Chaque element appelle une fonction
 * definie dans le fichier de SA section, jamais ailleurs :
 *
 *   1 · Evaluation des risques      -> 10_Evaluation   + UI_Evaluation
 *                                      + 17_FicheRisque + UI_FicheRisque
 *   2 · Validation des evaluations  -> 20_Validation   + UI_Validation
 *   3 · Cartographie (image PNG)    -> 30_Cartographie + UI_Cartographie
 *   5 · Controle interne            -> 11_Controles + 12_Executions
 *                                      + 13_Efficacite + 14_Anomalies
 *   6 · Departements                -> 06_Departements + UI_Departements
 *   7 · Processus                   -> 07_Processus    + UI_Processus
 *   8 · Acces et permissions        -> 08_IAM          + UI_IAM
 *   9 · Journal global              -> 09_JournalGlobal + UI_JournalGlobal
 *   Administration                  -> 05_Synthese + 90_Administration
 *                                      + 16_WebApp (lien de la Web App)
 *
 * Les fichiers 00 a 05 forment le socle : toutes les sections en ont
 * besoin, ils ne sont rattaches a aucun element de menu en particulier.
 *
 * REGLE DE NOMMAGE : les fichiers HTML commencent par UI_, les fichiers
 * Script par deux chiffres. Apps Script identifie un fichier par son nom
 * seul, extension ignoree : cette regle rend toute collision impossible.
 */

const VERSION_SCRIPTS = 'v10';

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  const evaluation = ui.createMenu('1 · Évaluation des risques')
    .addItem('Réévaluer un risque existant', 'openRiskAssessment')
    .addItem('Évaluer un nouveau risque', 'openNewRiskAssessment')
    .addSeparator()
    .addItem('Fiche risque 360°', 'openFicheRisque');

  const validation = ui.createMenu('2 · Validation des évaluations')
    .addItem('Ouvrir la fiche de validation', 'openValidation');

  const cartographie = ui.createMenu('3 · Cartographie')
    .addItem('Générer l’image PNG (inhérent vs résiduel)', 'genererCartographie')
    .addItem('Effacer l’image de la feuille CARTOGRAPHIE', 'effacerCartographie');

  const controleInterne = ui.createMenu('5 · Contrôle interne')
    .addItem('Catalogue des contrôles', 'openControles')
    .addItem('Exécutions des contrôles', 'openExecutions')
    .addItem('Efficacité des contrôles', 'openEfficacite')
    .addItem('Anomalies et incidents', 'openAnomalies');

  const departements = ui.createMenu('6 · Départements')
    .addItem('Ouvrir la fiche des départements', 'openDepartements');

  const processus = ui.createMenu('7 · Processus')
    .addItem('Ouvrir la cartographie des processus', 'openProcessus');

  const acces = ui.createMenu('8 · Accès et permissions')
    .addItem('RACI / IAM', 'openIAM');

  const journal = ui.createMenu('9 · Journal global')
    .addItem('Ouvrir le journal global', 'openJournalGlobal');

  const administration = ui.createMenu('Administration')
    .addItem('Contrôler l’installation des scripts', 'controlerInstallation')
    .addItem('Mettre à niveau le classeur', 'mettreANiveauClasseur')
    .addSeparator()
    .addItem('Initialiser les vues', 'initialiserVues')
    .addItem('Appliquer les colonnes de la synthèse', 'appliquerColonnesSynthese')
    .addItem('Diagnostic du classeur', 'openDiagnostic')
    .addItem('Connexions de données (aperçu)', 'openConnexionsDonnees')
    .addSeparator()
    .addItem('🌐 Ouvrir en Web App', 'afficherUrlWebApp');

  ui.createMenu('Risk Management')
    .addSubMenu(evaluation)
    .addSubMenu(validation)
    .addSubMenu(cartographie)
    .addSeparator()
    .addSubMenu(controleInterne)
    .addSubMenu(departements)
    .addSubMenu(processus)
    .addSubMenu(acces)
    .addSubMenu(journal)
    .addSeparator()
    .addSubMenu(administration)
    .addToUi();
}

/**
 * Ouvre une boite de dialogue modale a partir d'un fichier UI_.
 * Une boite modale et non un panneau lateral : Google fige la largeur
 * d'un panneau lateral a 300 px, trop etroit pour ces formulaires.
 */
function ouvrirDialogue_(fichier, titre, largeur, hauteur, variables) {
  const modele = HtmlService.createTemplateFromFile(fichier);
  const v = variables || {};
  Object.keys(v).forEach(function (k) { modele[k] = v[k]; });
  const html = modele.evaluate().setWidth(largeur).setHeight(hauteur);
  SpreadsheetApp.getUi().showModalDialog(html, titre);
}

/**
 * Administration > 🌐 Ouvrir en Web App. Affiche l'URL de deploiement Web
 * App (doGet dans 16_WebApp.gs), sans quitter Sheets. Reutilise
 * urlPageWebApp_() de 16_WebApp.gs, qui pointe vers la page d'accueil
 * (UI_Accueil) ; se replie sur ScriptApp.getService().getUrl() si ce
 * fichier n'est pas encore installe, pour que le menu ne casse jamais.
 */
function afficherUrlWebApp() {
  const ui = SpreadsheetApp.getUi();
  let url;
  try {
    url = typeof urlPageWebApp_ === 'function' ? urlPageWebApp_('accueil') : ScriptApp.getService().getUrl();
  } catch (e) {
    ui.alert('Ouvrir en Web App', 'Impossible de déterminer l’URL de la Web App : ' + e.message +
      '\n\nLe classeur doit être déployé en tant qu’application web ' +
      '(Déployer > Nouveau déploiement > Application web) pour obtenir une URL.', ui.ButtonSet.OK);
    return;
  }
  if (!url) {
    ui.alert('Ouvrir en Web App', 'Aucune URL disponible : le classeur n’est pas encore déployé en tant ' +
      'qu’application web. Utilisez Déployer > Nouveau déploiement > Application web dans l’éditeur Apps Script.',
      ui.ButtonSet.OK);
    return;
  }
  ui.alert('Ouvrir en Web App', 'URL de la Web App :\n\n' + url, ui.ButtonSet.OK);
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_00_Menu_() { return 'v10'; }
