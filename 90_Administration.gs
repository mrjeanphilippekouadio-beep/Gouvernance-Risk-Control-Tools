/**
 * =====================================================================
 *  FICHIER  : 90_Administration       type : Script (.gs)
 *  SECTION  : MENU Administration
 *             > Contrôler l'installation des scripts -> controlerInstallation
 *             > Mettre à niveau le classeur          -> mettreANiveauClasseur
 *             > Diagnostic du classeur               -> openDiagnostic
 *             > Connexions de données (aperçu)       -> openConnexionsDonnees
 *             (Initialiser les vues et Appliquer les colonnes : 05_Synthese)
 *             (Ouvrir en Web App : 00_Menu + 16_WebApp)
 *  VERSION  : v10
 * =====================================================================
 */

// ---------------------------------------------------------------- //
// 1. Controle de l'installation
// ---------------------------------------------------------------- //

/**
 * Chaque fichier Script porte une fonction marqueur, chaque fichier HTML un
 * commentaire marqueur. Un fichier absent, mal nomme ou reste a une version
 * anterieure est ainsi designe par son nom.
 */
function marqueursScripts_() {
  return [
    ['00_Menu', typeof fichier_00_Menu_ === 'function' ? fichier_00_Menu_() : null],
    ['01_Parametres', typeof fichier_01_Parametres_ === 'function' ? fichier_01_Parametres_() : null],
    ['02_Colonnes', typeof fichier_02_Colonnes_ === 'function' ? fichier_02_Colonnes_() : null],
    ['03_Lecture', typeof fichier_03_Lecture_ === 'function' ? fichier_03_Lecture_() : null],
    ['04_Outils', typeof fichier_04_Outils_ === 'function' ? fichier_04_Outils_() : null],
    ['05_Synthese', typeof fichier_05_Synthese_ === 'function' ? fichier_05_Synthese_() : null],
    ['06_Departements', typeof fichier_06_Departements_ === 'function' ? fichier_06_Departements_() : null],
    ['07_Processus', typeof fichier_07_Processus_ === 'function' ? fichier_07_Processus_() : null],
    ['08_IAM', typeof fichier_08_IAM_ === 'function' ? fichier_08_IAM_() : null],
    ['09_JournalGlobal', typeof fichier_09_JournalGlobal_ === 'function' ? fichier_09_JournalGlobal_() : null],
    ['10_Evaluation', typeof fichier_10_Evaluation_ === 'function' ? fichier_10_Evaluation_() : null],
    ['11_Controles', typeof fichier_11_Controles_ === 'function' ? fichier_11_Controles_() : null],
    ['12_Executions', typeof fichier_12_Executions_ === 'function' ? fichier_12_Executions_() : null],
    ['13_Efficacite', typeof fichier_13_Efficacite_ === 'function' ? fichier_13_Efficacite_() : null],
    ['14_Anomalies', typeof fichier_14_Anomalies_ === 'function' ? fichier_14_Anomalies_() : null],
    ['16_WebApp', typeof fichier_16_WebApp_ === 'function' ? fichier_16_WebApp_() : null],
    ['17_FicheRisque', typeof fichier_17_FicheRisque_ === 'function' ? fichier_17_FicheRisque_() : null],
    ['20_Validation', typeof fichier_20_Validation_ === 'function' ? fichier_20_Validation_() : null],
    ['30_Cartographie', typeof fichier_30_Cartographie_ === 'function' ? fichier_30_Cartographie_() : null],
    ['90_Administration', fichier_90_Administration_()]
  ];
}

const FICHIERS_HTML = ['UI_Evaluation', 'UI_Validation', 'UI_Cartographie',
  'UI_Departements', 'UI_Controles', 'UI_Executions', 'UI_Efficacite', 'UI_Anomalies',
  'UI_Processus', 'UI_IAM', 'UI_JournalGlobal', 'UI_FicheRisque', 'UI_Accueil'];
const ANCIENS_HTML = ['UI_Form', 'UI_Form_CSS', 'UI_Form_JS', 'UI_Valid', 'UI_Valid_CSS', 'UI_Valid_JS'];

function marqueurHtml_(nom) {
  try {
    const contenu = HtmlService.createHtmlOutputFromFile(nom).getContent();
    const m = contenu.match(/MARQUEUR\s+(\S+)\s+(v\d+)/);
    return m && m[1] === nom ? m[2] : 'sans marqueur';
  } catch (e) {
    return null;
  }
}

/**
 * Anciens fichiers v7 et v8 encore presents. Ceux qui declaraient des
 * constantes bloquent tout le projet a l'enregistrement, avec un message
 * explicite ; ceux-ci ne declarent que des fonctions et passeraient
 * inapercus, d'ou ce controle.
 */
function anciensFichiersPresents_() {
  const out = [];
  if (typeof include === 'function') out.push('Menu');
  if (typeof computeAssessmentScores === 'function') out.push('Calcul');
  if (typeof validateEvaluation === 'function' || typeof rejectEvaluation === 'function') out.push('Workflow');
  if (typeof validateScore1to5_ === 'function') out.push('Validation');
  if (typeof formuleSource_ === 'function') out.push('Vue');
  if (typeof mapSource === 'function') out.push('Schema');
  if (typeof insertEvaluation === 'function' || typeof createRisk === 'function') out.push('Repository');
  ANCIENS_HTML.forEach(function (n) { if (marqueurHtml_(n) !== null) out.push(n); });
  return out;
}

/**
 * Correspondance menu -> fonction -> fichier, verifiee a l'execution.
 */
function correspondanceMenu_() {
  const e = function (f) { return typeof f === 'function'; };
  return [
    ['1 · Évaluation', 'Réévaluer un risque existant', 'openRiskAssessment', '10_Evaluation + UI_Evaluation',
      typeof openRiskAssessment === 'function'],
    ['1 · Évaluation', 'Évaluer un nouveau risque', 'openNewRiskAssessment', '10_Evaluation + UI_Evaluation',
      typeof openNewRiskAssessment === 'function'],
    ['1 · Évaluation', 'Fiche risque 360°', 'openFicheRisque', '17_FicheRisque + UI_FicheRisque',
      typeof openFicheRisque === 'function'],
    ['2 · Validation', 'Ouvrir la fiche de validation', 'openValidation', '20_Validation + UI_Validation',
      typeof openValidation === 'function'],
    ['3 · Cartographie', 'Générer l’image PNG', 'genererCartographie', '30_Cartographie + UI_Cartographie',
      typeof genererCartographie === 'function'],
    ['3 · Cartographie', 'Effacer l’image', 'effacerCartographie', '30_Cartographie',
      typeof effacerCartographie === 'function'],
    ['5 · Contrôle interne', 'Catalogue des contrôles', 'openControles', '11_Controles + UI_Controles',
      typeof openControles === 'function'],
    ['5 · Contrôle interne', 'Exécutions des contrôles', 'openExecutions', '12_Executions + UI_Executions',
      typeof openExecutions === 'function'],
    ['5 · Contrôle interne', 'Efficacité des contrôles', 'openEfficacite', '13_Efficacite + UI_Efficacite',
      typeof openEfficacite === 'function'],
    ['5 · Contrôle interne', 'Anomalies et incidents', 'openAnomalies', '14_Anomalies + UI_Anomalies',
      typeof openAnomalies === 'function'],
    ['6 · Départements', 'Ouvrir la fiche des départements', 'openDepartements', '06_Departements + UI_Departements',
      typeof openDepartements === 'function'],
    ['7 · Processus', 'Ouvrir la cartographie des processus', 'openProcessus', '07_Processus + UI_Processus',
      typeof openProcessus === 'function'],
    ['8 · Accès et permissions', 'RACI / IAM', 'openIAM', '08_IAM + UI_IAM',
      typeof openIAM === 'function'],
    ['9 · Journal global', 'Ouvrir le journal global', 'openJournalGlobal', '09_JournalGlobal + UI_JournalGlobal',
      typeof openJournalGlobal === 'function'],
    ['Administration', 'Contrôler l’installation', 'controlerInstallation', '90_Administration', e(controlerInstallation)],
    ['Administration', 'Mettre à niveau le classeur', 'mettreANiveauClasseur', '90_Administration',
      typeof mettreANiveauClasseur === 'function'],
    ['Administration', 'Initialiser les vues', 'initialiserVues', '05_Synthese',
      typeof initialiserVues === 'function'],
    ['Administration', 'Appliquer les colonnes de la synthèse', 'appliquerColonnesSynthese', '05_Synthese',
      typeof appliquerColonnesSynthese === 'function'],
    ['Administration', 'Diagnostic du classeur', 'openDiagnostic', '90_Administration',
      typeof openDiagnostic === 'function'],
    ['Administration', 'Connexions de données (aperçu)', 'openConnexionsDonnees', '90_Administration',
      typeof openConnexionsDonnees === 'function'],
    ['Administration', '🌐 Ouvrir en Web App', 'afficherUrlWebApp', '00_Menu + 16_WebApp',
      typeof afficherUrlWebApp === 'function']
  ];
}

function controlerInstallation() {
  const html = HtmlService.createHtmlOutput(rapportInstallationHtml_()).setWidth(980).setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Contrôle de l’installation, scripts ' + VERSION_SCRIPTS);
}

function rapportInstallationHtml_() {
  const ok = '<span class="ok">✔</span>', ko = '<span class="ko">✖</span>',
        at = '<span class="warn">▲</span>';
  const blocs = [];
  let anomalies = 0;

  // Scripts
  let t = '<table><tr><th></th><th>Fichier</th><th>Type</th><th>État</th></tr>';
  marqueursScripts_().forEach(function (m) {
    const bon = m[1] === VERSION_SCRIPTS;
    if (!bon) anomalies++;
    t += '<tr><td>' + (bon ? ok : ko) + '</td><td><code>' + m[0] + '</code></td><td>Script</td><td>' +
      (bon ? 'présent, ' + m[1] : (m[1] ? 'version ' + m[1] + ', recopiez la ' + VERSION_SCRIPTS
        : 'ABSENT ou mal nommé')) + '</td></tr>';
  });
  FICHIERS_HTML.forEach(function (n) {
    const v = marqueurHtml_(n);
    const bon = v === VERSION_SCRIPTS;
    if (!bon) anomalies++;
    t += '<tr><td>' + (bon ? ok : ko) + '</td><td><code>' + n + '</code></td><td>HTML</td><td>' +
      (bon ? 'présent, ' + v : (v ? v + ', recopiez la ' + VERSION_SCRIPTS : 'ABSENT ou mal nommé')) +
      '</td></tr>';
  });
  t += '</table>';
  const anciens = anciensFichiersPresents_();
  if (anciens.length) {
    anomalies++;
    t += '<p class="ko">' + ko + ' Ancien(s) fichier(s) encore présent(s), à supprimer : <b>' +
      anciens.join(', ') + '</b>. Ils redéfinissent des fonctions de la ' + VERSION_SCRIPTS + '.</p>';
  } else {
    t += '<p class="ok">' + ok + ' Aucun ancien fichier détecté.</p>';
  }
  blocs.push('<h2>1. Fichiers du projet</h2>' + t);

  // Menu
  let mt = '<table><tr><th></th><th>Section</th><th>Élément du menu</th><th>Fonction</th><th>Fichier(s)</th></tr>';
  correspondanceMenu_().forEach(function (l) {
    if (!l[4]) anomalies++;
    mt += '<tr><td>' + (l[4] ? ok : ko) + '</td><td>' + l[0] + '</td><td>' + l[1] + '</td><td><code>' +
      l[2] + '</code></td><td>' + l[3] + '</td></tr>';
  });
  blocs.push('<h2>2. Menu Risk Management</h2>' + mt + '</table>');

  // Classeur
  let c = '<table>';
  function ligne(etat, libelle, detail) {
    if (etat === ko) anomalies++;
    c += '<tr><td>' + etat + '</td><td>' + libelle + '</td><td>' + detail + '</td></tr>';
  }
  try {
    const niveau = String(getConfigParams()['VERSION_CLASSEUR'] || '');
    ligne(niveau === VERSION_CLASSEUR ? ok : at, 'Niveau du classeur',
      niveau === VERSION_CLASSEUR ? niveau : (niveau || 'non renseigné') +
      ' : lancez Administration > Mettre à niveau le classeur (elle se lance aussi seule à la ' +
      'première ouverture d’un formulaire).');
  } catch (e) { ligne(ko, 'Niveau du classeur', e.message); }

  Object.keys(SHEETS).forEach(function (k) {
    try { getSheet(SHEETS[k]); ligne(ok, 'Feuille ' + SHEETS[k], 'présente'); }
    catch (e) { ligne(ko, 'Feuille ' + SHEETS[k], 'ABSENTE'); }
  });

  try {
    const map = mapRisques();
    const manquantes = REQUISES_EVALUATIONS.filter(function (k) { return !map[k]; });
    ligne(manquantes.length ? ko : ok, 'Colonnes requises de RISQUES',
      manquantes.length ? 'manquantes : ' + manquantes.join(', ') : REQUISES_EVALUATIONS.length + ' / ' +
      REQUISES_EVALUATIONS.length + ' résolues' + (map.COMMENTAIRE_VALIDATION
        ? ', colonne Commentaire du validateur en ' + colonneLettre_(map.COMMENTAIRE_VALIDATION) : ''));
  } catch (e) { ligne(ko, 'Colonnes requises de RISQUES', e.message); }

  // v10 : colonnes requises des 5 nouvelles feuilles (Départements, Contrôles,
  // Exécutions, Efficacité, Anomalies). Une feuille absente ne bloque pas le
  // reste du rapport : elle apparaît simplement en écart ici. Les libellés
  // ci-dessous sont ceux des feuilles reelles du template (R03/R04/R06) pour
  // Controles/Executions/Efficacite ; Departements et Anomalies restent des
  // feuilles propres au projet.
  [
    ['DEPARTEMENTS', SHEETS.DEPARTEMENTS, function () { return mapDepartements(); }, REQUISES_DEPARTEMENTS],
    ['R03_MATRICE_CONTROLES', SHEETS.CONTROLES, function () { return mapControles(); }, REQUISES_CONTROLES],
    ['R04_EXECUTIONS_CONTROLES', SHEETS.EXECUTIONS, function () { return mapExecutions(); }, REQUISES_EXECUTIONS],
    ['R06_EVALUATIONS_CONTROLES', SHEETS.EFFICACITE, function () { return mapEfficacite(); }, REQUISES_EFFICACITE],
    ['ANOMALIES', SHEETS.ANOMALIES, function () { return mapAnomalies(); }, REQUISES_ANOMALIES],
    // Ajoutees lors du lot Processus / IAM / Journal global.
    ['PROCESSUS', SHEETS.PROCESSUS, function () { return mapProcessus(); }, REQUISES_PROCESSUS],
    ['IAM_PERMISSIONS', SHEETS.IAM_PERMISSIONS, function () { return mapIamPermissions(); }, REQUISES_IAM_PERMISSIONS],
    ['JOURNAL_GLOBAL', SHEETS.JOURNAL_GLOBAL, function () { return mapJournalGlobal(); }, REQUISES_JOURNAL_GLOBAL]
  ].forEach(function (spec) {
    try {
      const map = spec[2]();
      const manquantes = spec[3].filter(function (k) { return !map[k]; });
      ligne(manquantes.length ? ko : ok, 'Colonnes requises de ' + spec[0],
        manquantes.length ? 'manquantes : ' + manquantes.join(', ')
          : spec[3].length + ' / ' + spec[3].length + ' résolues');
    } catch (e) { ligne(ko, 'Colonnes requises de ' + spec[0], e.message); }
  });

  ['EVALUATION', 'VALIDATION'].forEach(function (f) {
    try {
      const champs = lireChampsFormulaire(f);
      const obl = champs.filter(function (x) { return x.obligatoire; });
      ligne(champs.length ? ok : ko, 'CONFIG, champs du formulaire ' + f,
        champs.length ? champs.length + ' champ(s) actif(s), dont ' + obl.length + ' obligatoire(s) : ' +
          obl.map(function (x) { return x.libelle; }).join(', ')
          : 'aucune ligne : lancez Mettre à niveau le classeur');
    } catch (e) { ligne(ko, 'CONFIG, champs du formulaire ' + f, e.message); }
  });

  try {
    const u = profilUtilisateur_();
    const detail = (u.email || 'adresse non lisible') + ' · ' + (!u.reconnu ? 'absent de UTILISATEURS'
      : (u.actif ? 'actif' : 'INACTIF') + ', évaluer : ' + (u.peutEvaluer ? 'oui' : 'non') +
        ', valider : ' + (u.peutValider ? 'oui' : 'non'));
    ligne(u.reconnu && u.actif ? ok : ko, 'Vous', detail);
  } catch (e) { ligne(ko, 'Vous', e.message); }

  try {
    const src = getSheet(SHEETS.SOURCE).getRange(DATA_START_ROW, 1).getFormula();
    const syn = getSheet(SHEETS.SYNTHESE).getRange(DATA_START_ROW, 1).getFormula();
    ligne(src && syn ? ok : at, 'Vues de synthèse', src && syn ? 'formules en place'
      : 'non initialisées : Administration > Initialiser les vues');
  } catch (e) { ligne(ko, 'Vues de synthèse', e.message); }

  // v10 : point d'entree de la Web App (16_WebApp.gs). doGet est une
  // fonction reservee d'Apps Script : sa seule presence dans le projet
  // suffit a activer un deploiement "Application web".
  ligne(typeof doGet === 'function' ? ok : ko, 'Point d’entrée Web App (doGet)',
    typeof doGet === 'function' ? 'présent, la Web App peut être déployée (Déployer > Nouveau déploiement > ' +
      'Application web).' : 'ABSENT : ajoutez 16_WebApp.gs pour activer le second mode d’accès.');
  blocs.push('<h2>3. Classeur</h2>' + c + '</table>');

  const verdict = anomalies
    ? '<div class="verdict ko-bg">' + anomalies + ' point(s) à corriger, détaillés ci-dessous.</div>'
    : '<div class="verdict ok-bg">Installation complète et conforme : toutes les sections du menu ' +
      'sont opérationnelles.</div>';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    ':root{color-scheme:light only}' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#1F2430;padding:6px 14px;background:#fff}' +
    'h2{font-size:13.5px;color:#1F5FA8;margin:18px 0 6px}' +
    'table{border-collapse:collapse;width:100%;margin-bottom:6px}' +
    'th,td{border:1px solid #E4E7EC;padding:5px 7px;text-align:left;vertical-align:top}' +
    'th{background:#F7F8FA;font-weight:600}td:first-child{width:22px;text-align:center}' +
    '.ok{color:#1B7F3B;font-weight:700}.ko{color:#B3261E;font-weight:700}.warn{color:#8A6100;font-weight:700}' +
    'code{background:#F2F3F5;padding:1px 5px;border-radius:3px;font-size:12px}' +
    '.verdict{padding:10px 12px;border-radius:8px;font-weight:600;margin-top:8px}' +
    '.ok-bg{background:#E7F5EC;color:#1B7F3B}.ko-bg{background:#FDECEA;color:#B3261E}' +
    '</style></head><body>' + verdict + blocs.join('') + '</body></html>';
}

// ---------------------------------------------------------------- //
// 1 bis. Connexions de données (aperçu) — stub purement informatif
// ---------------------------------------------------------------- //

/**
 * Page illustrative, sans aucune logique reelle de connexion : prepare la
 * bascule future vers PostgreSQL/Prisma. Google Sheets reste la source de
 * donnees actuelle. Aucun champ de saisie de secret, mot de passe ou
 * chaine de connexion : uniquement une liste de connecteurs "Non connecté"
 * avec un bouton "Connecter" desactive, sur le meme pattern que
 * openDiagnostic() / controlerInstallation() (HtmlService.createHtmlOutput
 * + showModalDialog, pas de fichier .html separe a cataloguer).
 */
function openConnexionsDonnees() {
  const html = HtmlService.createHtmlOutput(connexionsDonneesHtml_()).setWidth(760).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'Connexions de données (aperçu)');
}

function connexionsDonneesHtml_() {
  const connecteurs = [
    { nom: 'PostgreSQL (via Prisma)', detail: 'Cible envisagée pour la future migration hors Google Sheets.' },
    { nom: 'MySQL', detail: 'Alternative relationnelle possible, non retenue pour l’instant.' },
    { nom: 'BigQuery', detail: 'Piste pour l’analytique et le reporting de masse, à explorer plus tard.' }
  ];
  const lignes = connecteurs.map(function (c) {
    return '<div class="connecteur">' +
      '<div class="c-head"><span class="c-nom">' + c.nom + '</span>' +
      '<span class="badge">Non connecté</span></div>' +
      '<p class="c-detail">' + c.detail + '</p>' +
      '<button class="btn-connecter" disabled>Connecter</button>' +
      '</div>';
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    ':root{color-scheme:light only}' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1F2430;padding:16px;background:#fff}' +
    'h2{font-size:15px;color:#1F5FA8;margin:0 0 8px}' +
    '.note{background:#EAF1FA;color:#1F5FA8;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:12.5px}' +
    '.connecteur{border:1px solid #E4E7EC;border-radius:10px;padding:12px 14px;margin-bottom:12px;background:#FAFBFC}' +
    '.c-head{display:flex;align-items:center;justify-content:space-between}' +
    '.c-nom{font-weight:700}' +
    '.badge{background:#F2F3F5;color:#5B6877;border-radius:999px;padding:2px 10px;font-size:11.5px;font-weight:600}' +
    '.c-detail{color:#5B6877;font-size:12px;margin:6px 0 10px}' +
    '.btn-connecter{background:#E4E7EC;color:#8A8F98;border:none;border-radius:7px;padding:7px 14px;' +
    'font-size:12.5px;font-weight:600;cursor:not-allowed}' +
    '</style></head><body>' +
    '<h2>Connexions de données (aperçu)</h2>' +
    '<div class="note">Cette page est purement informative : elle prépare une future bascule vers une base ' +
    'externe (PostgreSQL via Prisma, ou équivalent). <b>Google Sheets reste aujourd’hui la source de données ' +
    'du dispositif</b> ; aucun connecteur n’est actif, aucune information de connexion (mot de passe, chaîne ' +
    'de connexion, jeton) n’est saisie ni stockée ici.</div>' +
    lignes +
    '</body></html>';
}

// ---------------------------------------------------------------- //
// 2. Mise a niveau du classeur, idempotente
// ---------------------------------------------------------------- //

const CHAMPS_DEFAUT = [
  ['EVALUATION', 'intitule', 'Intitulé du risque', 'Oui'],
  ['EVALUATION', 'categorie', 'Catégorie', 'Oui'],
  ['EVALUATION', 'processus', 'Processus', 'Oui'],
  ['EVALUATION', 'entite', 'Entité', 'Non'],
  ['EVALUATION', 'pays', 'Pays', 'Non'],
  ['EVALUATION', 'departement', 'Département / Fonction', 'Non'],
  ['EVALUATION', 'sousCategorie', 'Sous-catégorie', 'Non'],
  ['EVALUATION', 'objectif', 'Objectif concerné', 'Non'],
  ['EVALUATION', 'description', 'Description du risque', 'Non'],
  ['EVALUATION', 'causes', 'Causes principales', 'Non'],
  ['EVALUATION', 'consequences', 'Conséquences principales', 'Non'],
  ['EVALUATION', 'proprietaire', 'Propriétaire du risque', 'Non'],
  ['EVALUATION', 'controles', 'Contrôles associés', 'Non'],
  ['EVALUATION', 'kri', 'KRI associés', 'Non'],
  ['EVALUATION', 'typeEval', 'Type d’évaluation', 'Oui'],
  ['EVALUATION', 'probaInherente', 'Probabilité inhérente', 'Oui'],
  ['EVALUATION', 'impactsInherents', 'Tous les axes d’impact inhérents', 'Oui'],
  ['EVALUATION', 'mesures', 'Mesures de maîtrise principales', 'Non'],
  ['EVALUATION', 'lignesDefense', 'Les 3 lignes de défense, notées ou non évaluables', 'Oui'],
  ['EVALUATION', 'justifMaitrise', 'Justification de la maîtrise', 'Non'],
  ['EVALUATION', 'probaResiduelle', 'Probabilité résiduelle', 'Oui'],
  ['EVALUATION', 'justifProbaResiduelle', 'Justification de la probabilité résiduelle', 'Non'],
  ['EVALUATION', 'impactsResiduels', 'Tous les axes d’impact résiduels', 'Oui'],
  ['EVALUATION', 'velocite', 'Vélocité', 'Non'],
  ['EVALUATION', 'persistance', 'Persistance', 'Non'],
  ['EVALUATION', 'tendance', 'Tendance', 'Non'],
  ['EVALUATION', 'appetence', 'Seuil d’appétence', 'Non'],
  ['EVALUATION', 'decision', 'Décision de traitement', 'Oui'],
  ['EVALUATION', 'justifDecision', 'Justification de la décision', 'Non'],
  ['EVALUATION', 'actions', 'Actions associées', 'Non'],
  ['VALIDATION', 'motif', 'Motif du renvoi pour révision', 'Oui'],
  ['VALIDATION', 'commentaire', 'Commentaire du validateur', 'Non']
];

function mettreANiveauClasseur() {
  const avant = String(getConfigParams()['VERSION_CLASSEUR'] || '');
  const actions = appliquerMiseANiveau_();
  SpreadsheetApp.getUi().alert('Mise à niveau du classeur',
    (avant === VERSION_CLASSEUR ? 'Le classeur était déjà au niveau ' + VERSION_CLASSEUR +
      ' ; les réglages ont été réappliqués.\n\n' : 'Classeur mis au niveau ' + VERSION_CLASSEUR + '.\n\n') +
    '• ' + actions.join('\n• '),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Appelee a l'ouverture de chaque formulaire : ne fait rien si le classeur
 * est deja au bon niveau, ce qui ne coute qu'une lecture de CONFIG.
 */
function assurerNiveauClasseur_() {
  try {
    if (String(getConfigParams()['VERSION_CLASSEUR'] || '') === VERSION_CLASSEUR) return;
    const actions = appliquerMiseANiveau_();
    SpreadsheetApp.getActiveSpreadsheet().toast('Classeur mis au niveau ' + VERSION_CLASSEUR + ', ' +
      actions.length + ' réglage(s). Détail : Administration > Contrôler l’installation.',
      'Risk Management', 8);
  } catch (e) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Mise à niveau automatique impossible : ' + e.message,
      'Risk Management', 12);
  }
}

function appliquerMiseANiveau_() {
  const actions = [];
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  try {
    miseANiveauChampsConfig_(actions);
    miseANiveauListesConfig_(actions);
    miseANiveauReferentiels_(actions);
    miseANiveauColonneCommentaire_(actions);
    miseANiveauListesRisques_(actions);
    miseANiveauCartographie_(actions);
    ecrireParametreConfig_('VERSION_CLASSEUR', VERSION_CLASSEUR);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  oublierConfig_();
  return actions;
}

/**
 * CONFIG, bloc 4 : cree le tableau des champs obligatoires s'il manque, et
 * complete les champs connus du code qui n'y figurent pas encore. Les
 * reglages deja faits (Oui / Non) ne sont jamais modifies.
 */
function miseANiveauChampsConfig_(actions) {
  const sheet = getSheet(SHEETS.CONFIG);
  assurerTaille_(sheet, CONFIG_CHAMPS_LAST_ROW, 5);
  const entete = sheet.getRange(CONFIG_CHAMPS_HEADER_ROW, 1, 1, 5).getValues()[0];
  const present = normalizeText(entete[0]) === 'formulaire' && normalizeText(entete[1]) === 'champ';

  if (!present) {
    const zone = sheet.getRange(CONFIG_CHAMPS_TITRE_ROW - 1, 1,
      CONFIG_CHAMPS_LAST_ROW - CONFIG_CHAMPS_TITRE_ROW + 2, 5).getValues();
    const occupee = zone.some(function (r) { return r.some(function (v) { return !isBlank(v); }); });
    if (occupee) {
      throw new Error('CONFIG : les lignes ' + (CONFIG_CHAMPS_TITRE_ROW - 1) + ' à ' + CONFIG_CHAMPS_LAST_ROW +
        ' contiennent déjà autre chose que le tableau des champs obligatoires. Déplacez ce contenu, ' +
        'puis relancez Administration > Mettre à niveau le classeur.');
    }
    sheet.getRange(CONFIG_CHAMPS_TITRE_ROW - 1, 1).setValue('Une ligne par champ. Obligatoire = Oui : ' +
      'le formulaire bloque tant que le champ est vide et le serveur refuse l’enregistrement. ' +
      'Actif = Non : la ligne est ignorée.').setFontStyle('italic').setFontColor('#5A6672');
    sheet.getRange(CONFIG_CHAMPS_TITRE_ROW, 1).setValue('Champs obligatoires par formulaire')
      .setFontWeight('bold').setFontSize(12);
    sheet.getRange(CONFIG_CHAMPS_HEADER_ROW, 1, 1, 5)
      .setValues([['Formulaire', 'Champ', 'Libellé affiché', 'Obligatoire', 'Actif']])
      .setFontWeight('bold').setBackground('#E2F0D9');
    actions.push('CONFIG : tableau « Champs obligatoires par formulaire » créé ligne ' +
      CONFIG_CHAMPS_HEADER_ROW + '.');
  }

  const n = CONFIG_CHAMPS_LAST_ROW - CONFIG_CHAMPS_START_ROW + 1;
  const vals = sheet.getRange(CONFIG_CHAMPS_START_ROW, 1, n, 5).getValues();
  const presentes = {};
  let dernier = -1;
  vals.forEach(function (r, i) {
    if (isBlank(r[0]) && isBlank(r[1])) return;
    dernier = i;
    presentes[normalizeText(r[0]) + '|' + String(r[1]).trim()] = true;
  });
  const manquantes = CHAMPS_DEFAUT.filter(function (d) {
    return !presentes[normalizeText(d[0]) + '|' + d[1]];
  });
  if (manquantes.length) {
    if (dernier + 1 + manquantes.length > n) {
      throw new Error('CONFIG : plus de place dans le tableau des champs obligatoires (ligne ' +
        CONFIG_CHAMPS_LAST_ROW + ' atteinte).');
    }
    sheet.getRange(CONFIG_CHAMPS_START_ROW + dernier + 1, 1, manquantes.length, 5)
      .setValues(manquantes.map(function (d) { return [d[0], d[1], d[2], d[3], 'Oui']; }));
    actions.push('CONFIG : ' + manquantes.length + ' champ(s) ajouté(s) au paramétrage des ' +
      'champs obligatoires (' + manquantes.map(function (d) { return d[0] + ' ' + d[1]; }).join(', ') + ').');
  }
}

/**
 * CONFIG : chaque bloc recoit sa propre liste deroulante, sur toute sa
 * hauteur. Auparavant la liste Active / Archivee debordait sur les blocs 3
 * et 4, et les nouvelles lignes de ces blocs n'offraient pas Oui / Non.
 */
function miseANiveauListesConfig_(actions) {
  const sheet = getSheet(SHEETS.CONFIG);
  const ouiNon = SpreadsheetApp.newDataValidation().requireValueInList(['Oui', 'Non'], true)
    .setAllowInvalid(false).build();
  const statuts = SpreadsheetApp.newDataValidation().requireValueInList(['Active', 'Archivée'], true)
    .setAllowInvalid(false).build();

  sheet.getRange(CONFIG_VERSIONS_HEADER_ROW, 4, CONFIG_CHAMPS_LAST_ROW - CONFIG_VERSIONS_HEADER_ROW + 1, 2)
    .clearDataValidations();
  sheet.getRange(CONFIG_VERSIONS_START_ROW, 4, CONFIG_VERSIONS_LAST_ROW - CONFIG_VERSIONS_START_ROW + 1, 1)
    .setDataValidation(statuts);
  sheet.getRange(CONFIG_COLONNES_START_ROW, 4, CONFIG_COLONNES_LAST_ROW - CONFIG_COLONNES_START_ROW + 1, 1)
    .setDataValidation(ouiNon);
  sheet.getRange(CONFIG_CHAMPS_START_ROW, 4, CONFIG_CHAMPS_LAST_ROW - CONFIG_CHAMPS_START_ROW + 1, 2)
    .setDataValidation(ouiNon);
  actions.push('CONFIG : listes Oui / Non posées sur toute la hauteur des blocs 3 et 4 (lignes ' +
    CONFIG_COLONNES_START_ROW + ' à ' + CONFIG_COLONNES_LAST_ROW + ' et ' + CONFIG_CHAMPS_START_ROW +
    ' à ' + CONFIG_CHAMPS_LAST_ROW + ').');
}

/**
 * REF_REFERENTIELS : les cotations passent de texte a nombre, pour que les
 * nombres ecrits par le formulaire correspondent exactement aux listes
 * deroulantes ; la liste des statuts recoit ceux que le code ecrit.
 */
function miseANiveauReferentiels_(actions) {
  const sheet = getSheet(SHEETS.REFERENTIELS);
  const hauteur = 26;
  assurerTaille_(sheet, DATA_START_ROW + hauteur - 1, 0);

  ['COTATION', 'COTATION_CONTROLE'].forEach(function (entete) {
    const col = resolveColumn_(SHEETS.REFERENTIELS, [entete]);
    if (!col) return;
    const plage = sheet.getRange(DATA_START_ROW, col, hauteur, 1);
    let change = 0;
    const out = plage.getValues().map(function (r) {
      const v = r[0];
      if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) { change++; return [Number(v)]; }
      return [v];
    });
    if (change) {
      plage.setNumberFormat('0');
      plage.setValues(out);
      actions.push('REF_REFERENTIELS : ' + entete + ', ' + change + ' valeur(s) convertie(s) de texte en nombre.');
    }
  });

  const colS = resolveColumn_(SHEETS.REFERENTIELS, ['STATUT_EVALUATION']);
  if (colS) {
    const vals = sheet.getRange(DATA_START_ROW, colS, hauteur, 1).getValues().map(function (r) { return r[0]; });
    let dernier = -1;
    vals.forEach(function (v, i) { if (!isBlank(v)) dernier = i; });
    const presents = vals.filter(function (v) { return !isBlank(v); }).map(normalizeText);
    const manquants = [DEFAUT_STATUT_EVAL, STATUT_VALIDEE, STATUT_REJETEE, STATUT_A_REVISER, STATUT_A_COTER]
      .filter(function (s) { return presents.indexOf(normalizeText(s)) === -1; });
    if (manquants.length) {
      sheet.getRange(DATA_START_ROW + dernier + 1, colS, manquants.length, 1)
        .setValues(manquants.map(function (s) { return [s]; }));
      actions.push('REF_REFERENTIELS : statut(s) ajouté(s) à la liste : ' + manquants.join(', ') + '.');
    }
  }
}

/**
 * RISQUES : colonne dediee au commentaire du validateur, en fin de bandeau
 * VALIDATION. Ajoutee a la fin : aucune position existante ne bouge, la
 * feuille CARTOGRAPHIE et la synthese restent justes.
 */
function miseANiveauColonneCommentaire_(actions) {
  oublierEntetes_(SHEETS.RISQUES);
  if (mapRisques().COMMENTAIRE_VALIDATION) return;

  const sheet = getSheet(SHEETS.RISQUES);
  const derniere = sheet.getLastColumn();
  const cible = derniere + 1;
  assurerTaille_(sheet, DATA_LAST_ROW, cible);
  sheet.getRange(1, derniere, DATA_LAST_ROW, 1).copyTo(sheet.getRange(1, cible, DATA_LAST_ROW, 1),
    SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sheet.getRange(HEADER_ROW, cible).setValue('Commentaire du validateur');
  sheet.setColumnWidth(cible, 280);
  oublierEntetes_(SHEETS.RISQUES);
  oublierLignes_();

  // Declaree dans CONFIG, bloc 3, non visible par defaut dans la synthese
  const conf = getSheet(SHEETS.CONFIG);
  const n = CONFIG_COLONNES_LAST_ROW - CONFIG_COLONNES_START_ROW + 1;
  const vals = conf.getRange(CONFIG_COLONNES_START_ROW, 1, n, 5).getValues();
  let dernier = -1;
  vals.forEach(function (r, i) { if (!isBlank(r[0]) || !isBlank(r[1])) dernier = i; });
  if (dernier + 1 < n) {
    conf.getRange(CONFIG_COLONNES_START_ROW + dernier + 1, 1, 1, 5)
      .setValues([[cible, 'Commentaire du validateur', 'Commentaire du validateur', 'Non', '']]);
  }

  poserSource_();
  actions.push('RISQUES : colonne « Commentaire du validateur » ajoutée en ' + colonneLettre_(cible) +
    ', le commentaire ne se mêle plus à la justification de l’évaluateur.');
}

/**
 * RISQUES : les listes deroulantes restent, mais passent en mode
 * avertissement. Un ecart de format ne peut plus faire echouer un
 * enregistrement ; la liste des statuts couvre tout le referentiel.
 */
function miseANiveauListesRisques_(actions) {
  const sheet = getSheet(SHEETS.RISQUES);
  const map = mapRisques();
  const nCols = sheet.getLastColumn();
  const nRows = DATA_LAST_ROW - DATA_START_ROW + 1;
  const regles = sheet.getRange(DATA_START_ROW, 1, 1, nCols).getDataValidations()[0];
  let n = 0;
  for (let c = 1; c <= nCols; c++) {
    const r = regles[c - 1];
    if (!r || c === map.STATUT_EVAL) continue;
    sheet.getRange(DATA_START_ROW, c, nRows, 1).setDataValidation(r.copy().setAllowInvalid(true).build());
    n++;
  }
  const colS = resolveColumn_(SHEETS.REFERENTIELS, ['STATUT_EVALUATION']);
  if (map.STATUT_EVAL && colS) {
    const ref = getSheet(SHEETS.REFERENTIELS);
    sheet.getRange(DATA_START_ROW, map.STATUT_EVAL, nRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInRange(ref.getRange(DATA_START_ROW, colS, 26, 1), true)
        .setAllowInvalid(true).build());
    n++;
  }
  actions.push('RISQUES : ' + n + ' liste(s) déroulante(s) conservée(s) en mode avertissement, ' +
    'dont celle des statuts, étendue à tout le référentiel.');
}

function miseANiveauCartographie_(actions) {
  const sheet = getSheet(SHEETS.CARTOGRAPHIE);
  assurerTaille_(sheet, CARTO_LIGNE_IMAGE + 40, 14);
  const cell = sheet.getRange(CARTO_LIGNE_IMAGE - 2, 1);
  const v = String(cell.getValue() || '');
  if (v === '' || v.indexOf('Les deux images') === 0) {
    cell.setValue('L’image PNG produite par Risk Management > 3 · Cartographie se place à partir ' +
      'de la ligne ' + CARTO_LIGNE_IMAGE + '. Chaque génération remplace la précédente.');
    actions.push('CARTOGRAPHIE : consigne de la zone image mise à jour.');
  }
}

/**
 * Ecrit un parametre du bloc 1 de CONFIG, en place s'il existe, sinon sur
 * la premiere ligne libre du bloc.
 */
function ecrireParametreConfig_(cle, valeur) {
  const sheet = getSheet(SHEETS.CONFIG);
  const n = CONFIG_VERSIONS_HEADER_ROW - 2 - CONFIG_PARAMS_START_ROW + 1;
  const vals = sheet.getRange(CONFIG_PARAMS_START_ROW, 1, n, 2).getValues();
  for (let i = 0; i < n; i++) {
    if (normalizeText(vals[i][0]) === normalizeText(cle)) {
      sheet.getRange(CONFIG_PARAMS_START_ROW + i, 2).setValue(valeur);
      return;
    }
    if (isBlank(vals[i][0])) {
      sheet.getRange(CONFIG_PARAMS_START_ROW + i, 1, 1, 2).setValues([[cle, valeur]]);
      return;
    }
  }
  throw new Error('CONFIG : plus de place dans le bloc des paramètres pour ' + cle + '.');
}

// ---------------------------------------------------------------- //
// 3. Diagnostic du classeur
// ---------------------------------------------------------------- //

function openDiagnostic() {
  const html = HtmlService.createHtmlOutput(buildDiagnosticHtml_()).setWidth(1000).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, 'Diagnostic du classeur');
}

function buildDiagnosticHtml_() {
  const blocs = [];
  blocs.push(diagnostiquerFeuille_(SHEETS.RISQUES, HEADERS_EVALUATIONS, REQUISES_EVALUATIONS));
  blocs.push(diagnostiquerChamps_());
  blocs.push(diagnostiquerColonnesSynthese_());
  blocs.push(diagnostiquerFeuille_(SHEETS.UTILISATEURS, HEADERS_UTILISATEURS, ['EMAIL', 'PEUT_EVALUER', 'ACTIF']));
  blocs.push(diagnostiquerFeuille_(SHEETS.APPETENCE, HEADERS_APPETENCE, ['SOUS_CATEGORIE', 'SCORE_PLAFOND', 'ACTIF']));
  blocs.push(diagnostiquerFeuille_(SHEETS.DEPARTEMENTS, HEADERS_DEPARTEMENTS, REQUISES_DEPARTEMENTS));
  blocs.push(diagnostiquerFeuille_(SHEETS.CONTROLES, HEADERS_CONTROLES, REQUISES_CONTROLES));
  blocs.push(diagnostiquerFeuille_(SHEETS.EXECUTIONS, HEADERS_EXECUTIONS, REQUISES_EXECUTIONS));
  blocs.push(diagnostiquerFeuille_(SHEETS.EFFICACITE, HEADERS_EFFICACITE, REQUISES_EFFICACITE));
  blocs.push(diagnostiquerFeuille_(SHEETS.ANOMALIES, HEADERS_ANOMALIES, REQUISES_ANOMALIES));
  blocs.push(diagnostiquerFeuille_(SHEETS.PROCESSUS, HEADERS_PROCESSUS, REQUISES_PROCESSUS));
  blocs.push(diagnostiquerFeuille_(SHEETS.IAM_PERMISSIONS, HEADERS_IAM_PERMISSIONS, REQUISES_IAM_PERMISSIONS));
  blocs.push(diagnostiquerFeuille_(SHEETS.JOURNAL_GLOBAL, HEADERS_JOURNAL_GLOBAL, REQUISES_JOURNAL_GLOBAL));
  blocs.push(diagnostiquerEchelles_());

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    ':root{color-scheme:light only}' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#1F2430;padding:14px;background:#fff}' +
    'h2{font-size:13px;color:#1F5FA8;margin:18px 0 6px;}' +
    'table{border-collapse:collapse;width:100%;margin-bottom:8px;}' +
    'th,td{border:1px solid #E4E7EC;padding:4px 6px;text-align:left;}' +
    'th{background:#F7F8FA;font-weight:600;}' +
    '.ok{color:#1F7A3D;} .ko{color:#B3261E;font-weight:600;} .warn{color:#8A6100;}' +
    'code{background:#F2F3F5;padding:1px 4px;border-radius:3px;}' +
    '</style></head><body>' +
    '<p>Correspondance entre les clés attendues par le code et les en-têtes réellement présents ' +
    'en ligne <code>' + HEADER_ROW + '</code> du classeur.</p>' +
    blocs.join('') +
    '</body></html>';
}

function diagnostiquerFeuille_(nomFeuille, dictionnaire, requises) {
  let html = '<h2>' + nomFeuille + '</h2>';
  let headers;
  try {
    headers = readHeaders_(nomFeuille);
  } catch (e) {
    return html + '<p class="ko">' + e.message + '</p>';
  }

  const map = colMap_(nomFeuille, dictionnaire);
  const manquantesRequises = [];
  const manquantesOptionnelles = [];

  html += '<table><tr><th>Clé du code</th><th>Colonne</th><th>En-tête trouvé</th></tr>';
  Object.keys(dictionnaire).forEach(function (cle) {
    const c = map[cle];
    const requise = requises.indexOf(cle) !== -1;
    let libelle = '';
    for (let i = 0; i < headers.length; i++) if (headers[i].col === c) libelle = headers[i].raw;
    if (!c) {
      if (requise) manquantesRequises.push(cle); else manquantesOptionnelles.push(cle);
    }
    html += '<tr><td>' + cle + '</td>' +
      '<td class="' + (c ? 'ok' : (requise ? 'ko' : 'warn')) + '">' +
      (c ? colonneLettre_(c) + ' (' + c + ')' : (requise ? 'MANQUANTE' : 'absente')) + '</td>' +
      '<td>' + (libelle === '' ? '' : String(libelle)) + '</td></tr>';
  });
  html += '</table>';

  if (manquantesRequises.length) {
    html += '<p class="ko">Colonnes requises absentes : ' + manquantesRequises.join(', ') +
      '. Renommez l’en-tête dans le classeur, ou ajoutez le libellé utilisé dans le dictionnaire de 02_Colonnes.</p>';
  } else {
    html += '<p class="ok">Toutes les colonnes requises sont résolues.</p>';
  }
  if (manquantesOptionnelles.length) {
    html += '<p class="warn">Colonnes optionnelles absentes, elles ne seront pas alimentées : ' +
      manquantesOptionnelles.join(', ') + '.</p>';
  }
  return html;
}

function diagnostiquerChamps_() {
  let html = '<h2>CONFIG, champs obligatoires par formulaire</h2>';
  try {
    ['EVALUATION', 'VALIDATION'].forEach(function (f) {
      const champs = lireChampsFormulaire(f);
      html += '<p><b>' + f + '</b> : ' + champs.length + ' champ(s) actif(s).</p>' +
        '<table><tr><th>Champ</th><th>Libellé affiché</th><th>Obligatoire</th></tr>' +
        champs.map(function (c) {
          return '<tr><td><code>' + c.champ + '</code></td><td>' + c.libelle + '</td><td class="' +
            (c.obligatoire ? 'ko">Oui' : 'ok">Non') + '</td></tr>';
        }).join('') + '</table>';
    });
  } catch (e) {
    html += '<p class="ko">' + e.message + '</p>';
  }
  return html;
}

function diagnostiquerEchelles_() {
  let html = '<h2>' + SHEETS.ECHELLES + '</h2>';
  try {
    const ref = getReferentiels();
    html += '<table><tr><th>Bloc</th><th>Éléments</th></tr>' +
      '<tr><td>Probabilité</td><td>' + ref.probabilite.length + ' niveau(x)</td></tr>' +
      '<tr><td>Axes d’impact</td><td>' + ref.impact.axes.length + ' axe(s) : ' + ref.impact.axes.join(', ') + '</td></tr>' +
      '<tr><td>Niveaux d’impact</td><td>' + ref.impact.niveaux.length + '</td></tr>' +
      '<tr><td>Vélocité</td><td>' + ref.velocite.length + ' niveau(x)</td></tr>' +
      '<tr><td>Persistance</td><td>' + ref.persistance.length + ' niveau(x)</td></tr>' +
      '<tr><td>Maîtrise</td><td>' + ref.maitrise.niveaux.length + ' niveau(x)</td></tr>' +
      '</table>';

    const inh = colonnesImpact_(SHEETS.RISQUES, ref.impact.axes, 'inh');
    const res = colonnesImpact_(SHEETS.RISQUES, ref.impact.axes, 'res');
    html += '<table><tr><th>Axe</th><th>Colonne inhérente</th><th>Colonne résiduelle</th></tr>';
    for (let i = 0; i < ref.impact.axes.length; i++) {
      html += '<tr><td>' + ref.impact.axes[i] + '</td><td class="ok">' + colonneLettre_(inh[i]) +
        '</td><td class="ok">' + colonneLettre_(res[i]) + '</td></tr>';
    }
    html += '</table><p class="ok">Les axes d’impact sont appariés aux colonnes du classeur.</p>';
  } catch (e) {
    html += '<p class="ko">' + e.message + '</p>';
  }
  return html;
}

function diagnostiquerColonnesSynthese_() {
  let html = '<h2>CONFIG, colonnes de la synthèse</h2>';
  try {
    const cols = lireColonnesSynthese();
    const visibles = cols.filter(function (c) { return c.visible; });
    html += '<p>' + cols.length + ' colonne(s) déclarée(s), <strong>' + visibles.length +
      '</strong> visible(s), dans cet ordre :</p><table><tr><th>Ordre</th><th>Rang</th>' +
      '<th>Colonne source</th><th>Libellé affiché</th></tr>';
    visibles.forEach(function (c) {
      html += '<tr><td>' + c.ordre + '</td><td class="ok">' + colonneLettre_(c.rang) +
        ' (' + c.rang + ')</td><td>' + c.colonne + '</td><td>' + c.libelle + '</td></tr>';
    });
    html += '</table>';
    if (!visibles.length) {
      html += '<p class="ko">Aucune colonne visible : la synthèse resterait vide. ' +
        'Passez au moins une ligne à Oui dans CONFIG.</p>';
    }
  } catch (e) {
    html += '<p class="ko">' + e.message + '</p>';
  }
  return html;
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_90_Administration_() { return 'v10'; }
