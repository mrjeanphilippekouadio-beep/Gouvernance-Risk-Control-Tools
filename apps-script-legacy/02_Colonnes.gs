/**
 * =====================================================================
 *  FICHIER  : 02_Colonnes             type : Script (.gs)
 *  SECTION  : SOCLE COMMUN, indispensable quel que soit le menu utilise
 *  VERSION  : v10
 * =====================================================================
 *
 * Liaison entre le code et le classeur par NOM d'en-tete, jamais par
 * position. Une colonne inseree, deplacee ou renommee n'entraine plus
 * d'ecriture silencieuse dans la mauvaise cellule.
 *
 * Chaque cle logique porte une liste de libelles acceptes. La resolution se
 * fait en deux passes, egalite stricte puis inclusion, sur des libelles
 * normalises (minuscules, sans accents, sans ponctuation).
 *
 * Si un libelle du classeur n'est pas reconnu, ajoutez-le dans la liste
 * correspondante ci-dessous : c'est le seul endroit a modifier.
 *
 * Regle de securite pour chaque dictionnaire : le PREMIER alias de chaque
 * cle doit etre la forme normalisee exacte de l'en-tete reel de la feuille
 * visee. Se fier uniquement a la passe 2 (inclusion) pour un en-tete a
 * plusieurs mots est fragile et peut se resoudre sur la mauvaise colonne
 * sans avertissement (cf. HEADERS_CONTROLES.VALIDEUR ci-dessous).
 */

// ---------------------------------------------------------------- //
// 1. Dictionnaires de libelles acceptes
// ---------------------------------------------------------------- //

const HEADERS_EVALUATIONS = {
  // Identification
  ID_EVAL: ['id evaluation', 'id eval', 'identifiant evaluation', 'ref evaluation'],
  ID_RISQUE: ['id risque', 'identifiant risque', 'id du risque', 'ref risque'],
  DATE_EVAL: ['date evaluation', 'date d evaluation', 'date eval', 'date de l evaluation'],
  TYPE_EVAL: ['type evaluation', 'type eval', 'type d evaluation'],
  EVALUATEUR: ['evaluateur', 'evalue par', 'auteur evaluation'],

  // Attributs descriptifs du risque
  ENTITE: ['entite', 'entite juridique', 'societe'],
  PAYS: ['pays'],
  DEPARTEMENT: ['departement', 'direction', 'service'],
  PROCESSUS: ['processus', 'process'],
  CATEGORIE: ['categorie', 'categorie de risque', 'famille de risque'],
  SOUS_CATEGORIE: ['sous categorie', 'sous categorie de risque'],
  OBJECTIF: ['objectif', 'objectif impacte'],
  INTITULE: ['intitule', 'intitule du risque', 'libelle', 'libelle du risque', 'nom du risque'],
  DESCRIPTION: ['description', 'description scenario', 'scenario', 'description du risque'],
  CAUSES: ['causes', 'cause', 'facteurs declencheurs'],
  CONSEQUENCES: ['consequences', 'consequence', 'effets'],
  PROPRIETAIRE: ['proprietaire', 'proprietaire du risque', 'risk owner', 'porteur du risque'],
  CONTROLES_ASSOCIES: ['controles associes', 'controles', 'controles lies'],
  KRI_ASSOCIES: ['kri associes', 'kri', 'indicateurs associes'],

  // Cotation inherente
  PROBA_INH: ['probabilite inherente', 'proba inh', 'probabilite inherent'],
  IMPACT_RETENU_INH: ['impact retenu inherent', 'impact retenu inh', 'impact inherent retenu'],
  SCORE_INH: ['score inherent', 'score inh'],
  NIVEAU_INH: ['niveau inherent', 'niveau inh', 'criticite inherente'],

  // Maitrise
  MESURES_GLOBALES: ['mesures de maitrise principales', 'mesures globales', 'mesures de maitrise'],
  L1_MESURES: ['l1 mesures', 'l1 mesures de maitrise', 'mesures l1', 'description l1'],
  L1_NOTE: ['maitrise l1', 'l1 note', 'note l1', 'l1'],
  L2_MESURES: ['l2 mesures', 'l2 mesures de maitrise', 'mesures l2', 'description l2'],
  L2_NOTE: ['maitrise l2', 'l2 note', 'note l2', 'l2'],
  L3_MESURES: ['l3 mesures', 'l3 mesures de maitrise', 'mesures l3', 'description l3'],
  L3_NOTE: ['maitrise l3', 'l3 note', 'note l3', 'l3'],
  MAITRISE_GLOBALE: ['maitrise globale', 'niveau de maitrise', 'niveau maitrise'],
  JUSTIF_MAITRISE: ['justification maitrise', 'justif maitrise', 'justification de la maitrise'],

  // Cotation residuelle
  PROBA_RES: ['probabilite residuelle', 'proba res', 'probabilite residuel'],
  JUSTIF_PROBA_RES: ['justification probabilite residuelle', 'justif probabilite residuelle'],
  IMPACT_RETENU_RES: ['impact retenu residuel', 'impact retenu res', 'impact residuel retenu'],
  SCORE_RES: ['score residuel', 'score res'],
  NIVEAU_RES: ['niveau residuel', 'niveau res', 'criticite residuelle'],

  // Dynamique
  VELOCITY: ['velocity', 'velocite', 'vitesse de survenance'],
  PERSISTENCE: ['persistence', 'persistance'],
  TENDANCE: ['tendance', 'evolution'],

  // Appetence et decision
  APPETENCE_SEUIL: ['appetence applicable', 'appetence seuil', 'seuil appetence', 'score plafond'],
  POSITION_APPETENCE: ['position appetence', 'position vs appetence', 'positionnement appetence'],
  DECISION: ['decision', 'traitement', 'decision traitement', 'reponse au risque'],
  ACTIONS_ASSOCIEES: ['actions associees', 'action associee', 'plan d actions'],
  JUSTIF_DECISION: ['justification decision', 'justif decision', 'justification de la decision'],

  // Cloture
  VALIDATEUR: ['validateur', 'valide par'],
  DATE_VALIDATION: ['date validation', 'date de validation'],
  STATUT_EVAL: ['statut evaluation', 'statut eval', 'statut'],
  VERSION_METHODO: ['version methodo', 'version methodologie', 'version methodologique'],
  // Colonne ajoutee par la mise a niveau v9. Absente, le commentaire du
  // validateur est ajoute a la justification de la decision, comme avant.
  COMMENTAIRE_VALIDATION: ['commentaire du validateur', 'commentaire validateur', 'commentaire de validation']
};

// Colonnes sans lesquelles l'application ne peut pas fonctionner
const REQUISES_EVALUATIONS = [
  'ID_EVAL', 'ID_RISQUE', 'DATE_EVAL', 'EVALUATEUR', 'INTITULE',
  'PROBA_INH', 'SCORE_INH', 'NIVEAU_INH',
  'PROBA_RES', 'SCORE_RES', 'NIVEAU_RES',
  'DECISION', 'STATUT_EVAL'
];

const HEADERS_UTILISATEURS = {
  EMAIL: ['email', 'adresse email', 'mail'],
  NOM: ['nom', 'nom complet'],
  FONCTION: ['fonction', 'poste', 'role'],
  PEUT_EVALUER: ['peut evaluer', 'evaluation', 'droit evaluation'],
  PEUT_VALIDER: ['peut valider', 'validation', 'droit validation'],
  ACTIF: ['actif', 'active']
};

const HEADERS_APPETENCE = {
  CATEGORIE: ['categorie', 'categorie de risque'],
  SOUS_CATEGORIE: ['sous categorie', 'sous categorie de risque'],
  ENTITE: ['entite', 'entite juridique'],
  SCORE_PLAFOND: ['score plafond', 'plafond', 'seuil', 'seuil appetence'],
  VERSION_METHODO: ['version methodo', 'version methodologie'],
  ACTIF: ['actif', 'active']
};

// ---------------------------------------------------------------- //
// 1 bis. Dictionnaires v10 : Départements, Contrôles, Exécutions,
// Efficacité, Anomalies (section 4 à 8 de l'instruction de refonte)
//
// DEPARTEMENTS et ANOMALIES : feuilles propres au projet, sans equivalent
// dans le template GRC_DJAMO (decision du 24/09/2026 : on les garde
// separees). CONTROLES, EXECUTIONS, EFFICACITE : alignes sur les feuilles
// reelles R03_MATRICE_CONTROLES, R04_EXECUTIONS_CONTROLES et
// R06_EVALUATIONS_CONTROLES du template (verifie par inspection directe du
// fichier .xlsx, ligne d'en-tete 4).
// ---------------------------------------------------------------- //

const HEADERS_DEPARTEMENTS = {
  ID_DEPARTEMENT: ['id departement', 'id du departement', 'identifiant departement', 'ref departement'],
  NOM_DEPARTEMENT: ['nom departement', 'nom du departement', 'departement', 'libelle departement'],
  ENTITE: ['entite', 'entite juridique', 'societe'],
  MANAGER: ['manager', 'superieur hierarchique', 'responsable departement'],
  PILOTE_RISQUE: ['pilote de risque', 'pilote risque', 'risk champion'],
  PILOTE_DESIGNE_PAR: ['pilote designe par', 'designe par', 'designation pilote par'],
  DATE_DESIGNATION: ['date designation', 'date de designation'],
  PROCESSUS_RATTACHES: ['processus rattaches', 'processus associes', 'processus lies'],
  ACTIF: ['actif', 'active']
};
const REQUISES_DEPARTEMENTS = ['ID_DEPARTEMENT', 'NOM_DEPARTEMENT', 'MANAGER'];

// R03_MATRICE_CONTROLES, en-tetes reels (ligne 4) :
// ID Contrôle | Entité | Pays | Département / Fonction | Processus | Objectif du contrôle |
// Intitulé du contrôle | Description / procédure | Risques couverts | Type de contrôle | Nature |
// Fréquence | Rôle exécuteur | Rôle valideur | Checklist / étapes obligatoires | Preuve attendue |
// Critères de conformité | Délai d'exécution | Règles notification / escalade |
// Adéquation du contrôle | Qualité d'exécution | Efficacité opérationnelle | Efficacité globale |
// Dernière évaluation | Dernière exécution | Taux d'exécution | Taux de conformité |
// Actions associées | Statut | Version | Date création | Date modification | Validé par
const HEADERS_CONTROLES = {
  ID_CONTROLE: ['id controle', 'id du controle', 'identifiant controle', 'ref controle'],
  LIBELLE_CONTROLE: ['intitule du controle', 'libelle controle', 'libelle du controle', 'nom du controle', 'intitule controle'],
  OBJECTIF_CONTROLE: ['objectif du controle', 'objectif controle'],
  RISQUES_COUVERTS: ['risques couverts', 'risques associes', 'risques lies'],
  PROCESSUS: ['processus', 'process'],
  DEPARTEMENT: ['departement fonction', 'departement', 'direction', 'service'],
  DESCRIPTION_PROCEDURE: ['description procedure', 'procedure', 'description de la procedure', 'mode operatoire'],
  TYPE_CONTROLE: ['type de controle', 'type controle'],
  NATURE_CONTROLE: ['nature', 'nature controle', 'nature du controle'],
  // Pas encore de colonne "Ligne de défense" dans le classeur reel : des que l'utilisateur
  // l'aura ajoutee a R03_MATRICE_CONTROLES (ex: nommee exactement "Ligne de défense"), ce
  // champ se resoudra automatiquement grace au premier alias ci-dessous, sans autre
  // changement de code.
  NIVEAU_LIGNE_DEFENSE: ['ligne de defense', 'niveau ligne de defense', 'ligne defense'],
  FREQUENCE: ['frequence', 'frequence du controle'],
  EXECUTEUR: ['role executeur', 'executeur', 'execute par'],
  // 'valide par' volontairement absent ici : R03 porte aussi une colonne distincte
  // "Validé par" (voir VALIDE_PAR plus bas), qui serait resolue par erreur en premier.
  VALIDEUR: ['role valideur'],
  PREUVES_ATTENDUES: ['preuve attendue', 'preuves attendues', 'preuves', 'elements de preuve'],
  CRITERES_CONFORMITE: ['criteres de conformite', 'criteres conformite'],
  STATUT_CONTROLE: ['statut controle', 'statut du controle', 'statut'],
  DATE_CREATION: ['date creation', 'date de creation'],
  DATE_MAJ: ['date modification', 'date maj', 'date de mise a jour', 'derniere mise a jour'],
  // Colonnes de vue de R03 (section "GRC" du template) : calculees ou historisees par le
  // futur outil, ou par une synchronisation a batir plus tard a partir de R04/R06, sur le
  // modele de SYNTHESE_RISQUES pour R01/R02. Non utilisees par 11_Controles.gs aujourd'hui.
  EFFICACITE_OPERATIONNELLE_VUE: ['efficacite operationnelle'],
  EFFICACITE_GLOBALE: ['efficacite globale'],
  DERNIERE_EVALUATION: ['derniere evaluation'],
  DERNIERE_EXECUTION: ['derniere execution'],
  TAUX_EXECUTION: ['taux d execution'],
  TAUX_CONFORMITE: ['taux de conformite'],
  ACTIONS_ASSOCIEES: ['actions associees'],
  VERSION_CONTROLE: ['version'],
  VALIDE_PAR: ['valide par']
};
const REQUISES_CONTROLES = ['ID_CONTROLE', 'LIBELLE_CONTROLE', 'RISQUES_COUVERTS',
  'TYPE_CONTROLE', 'FREQUENCE', 'EXECUTEUR', 'CRITERES_CONFORMITE', 'STATUT_CONTROLE'];

// R04_EXECUTIONS_CONTROLES, en-tetes reels (ligne 4) :
// ID Exécution | ID Contrôle | Date prévue | Date de réalisation | Exécuteur | Résultat |
// Anomalie détectée | Description anomalie | Preuve | Justification N/A / non réalisé |
// Validateur | Date validation | Statut | Date limite | Retard (jours) | Version contrôle |
// Commentaire | Corrective execution liée
const HEADERS_EXECUTIONS = {
  ID_EXECUTION: ['id execution', 'id de l execution', 'identifiant execution', 'ref execution'],
  ID_CONTROLE: ['id controle', 'id du controle', 'controle execute'],
  DATE_PREVUE: ['date prevue', 'date d execution prevue'],
  DATE_REALISATION: ['date de realisation', 'date realisation', 'date reelle'],
  EXECUTEUR: ['executeur', 'execute par'],
  RESULTAT: ['resultat', 'resultat execution'],
  // Le template separe le constat ("Anomalie détectée") de sa description ("Description
  // anomalie") : le champ libre de 12_Executions.gs correspond a cette seconde colonne.
  ANOMALIES_CONSTATEES: ['description anomalie', 'anomalies constatees', 'anomalies', 'ecarts constates'],
  PREUVES: ['preuve', 'preuves', 'preuves attachees', 'elements de preuve'],
  NON_REALISE_JUSTIF: ['justification n a non realise', 'justification non realise', 'motif non realise', 'justification non applicable'],
  STATUT_EXECUTION: ['statut execution', 'statut de l execution', 'statut'],
  VALIDATEUR: ['validateur', 'valide par'],
  DATE_VALIDATION: ['date validation', 'date de validation']
};
const REQUISES_EXECUTIONS = ['ID_EXECUTION', 'ID_CONTROLE', 'STATUT_EXECUTION'];

// R06_EVALUATIONS_CONTROLES, en-tetes reels (ligne 4) :
// ID Évaluation | ID Contrôle | Date | Type d'évaluation | Évaluateur | Adéquation |
// Qualité d'exécution | Efficacité opérationnelle | Résultat | Justification |
// Limitations / dépendances | Mesures compensatoires | Validateur | Date validation |
// Statut | Version contrôle
const HEADERS_EFFICACITE = {
  ID_EFFICACITE: ['id evaluation', 'id efficacite', 'id evaluation efficacite', 'identifiant efficacite'],
  ID_CONTROLE: ['id controle', 'id du controle', 'controle evalue'],
  // Colonne reelle nommee simplement "Date" (pas "Date evaluation") : alias exact en tete.
  DATE_EVAL: ['date', 'date evaluation', 'date eval', 'date de l evaluation'],
  TYPE_EVAL: ['type d evaluation', 'type evaluation', 'type eval'],
  EVALUATEUR: ['evaluateur', 'evalue par'],
  ADEQUATION_CONCEPTION: ['adequation', 'adequation conception', 'adequation de la conception'],
  QUALITE_EXECUTION: ['qualite d execution', 'qualite execution', 'qualite de l execution'],
  EFFICACITE_OPERATIONNELLE: ['efficacite operationnelle', 'efficacite du controle'],
  // Verdict de synthese porte par R06 ("Résultat") : distinct de EFFICACITE_OPERATIONNELLE,
  // qui est l'appreciation detaillee juste avant.
  RESULTAT: ['resultat'],
  LIMITATIONS: ['limitations dependances', 'limitations', 'limites', 'dependances'],
  MESURES_COMPENSATOIRES: ['mesures compensatoires'],
  // Aucune colonne "Conclusion" dans R06 : champ conserve pour compatibilite, sans effet.
  // Le verdict de synthese est desormais porte par RESULTAT ci-dessus.
  CONCLUSION: ['conclusion'],
  JUSTIFICATION: ['justification', 'justification de l evaluation'],
  // Circuit de validation R06 (maker-checker), aligne sur validerExecution() en 12_Executions.gs.
  VALIDATEUR: ['validateur'],
  DATE_VALIDATION: ['date validation', 'date de validation'],
  VERSION_CONTROLE: ['version controle'],
  STATUT_EVAL: ['statut evaluation', 'statut eval', 'statut']
};
const REQUISES_EFFICACITE = ['ID_EFFICACITE', 'ID_CONTROLE', 'EFFICACITE_OPERATIONNELLE', 'JUSTIFICATION'];

const HEADERS_ANOMALIES = {
  ID_ANOMALIE: ['id anomalie', 'id de l anomalie', 'identifiant anomalie', 'ref anomalie'],
  ID_CONTROLE: ['id controle', 'id du controle', 'controle concerne'],
  ID_EXECUTION: ['id execution', 'id de l execution'],
  ID_RISQUE: ['id risque', 'id du risque'],
  DATE_CONSTAT: ['date constat', 'date de constat', 'date detection'],
  DESCRIPTION: ['description', 'description anomalie'],
  GRAVITE: ['gravite', 'niveau de gravite'],
  ORIGINE: ['origine', 'origine de l anomalie', 'source'],
  DETECTE_PAR: ['detecte par', 'declare par'],
  STATUT_ANOMALIE: ['statut anomalie', 'statut de l anomalie', 'statut'],
  ACTIONS_ASSOCIEES: ['actions associees', 'actions liees', 'plan d actions'],
  DATE_CLOTURE: ['date cloture', 'date de cloture'],
  COMMENTAIRE_CLOTURE: ['commentaire cloture', 'commentaire de cloture']
};
const REQUISES_ANOMALIES = ['ID_ANOMALIE', 'DESCRIPTION', 'GRAVITE', 'STATUT_ANOMALIE'];

// ---------------------------------------------------------------- //
// 1 ter. Dictionnaires du lot Processus / IAM / Journal global
// (24/09/2026). Trois feuilles propres au projet, sans equivalent dans le
// template GRC_DJAMO, sur le meme principe que DEPARTEMENTS et ANOMALIES.
// ---------------------------------------------------------------- //

// PROCESSUS : hierarchie a 3 niveaux (Processus > Sous-processus > Activité),
// auto-referencee via ID_PROCESSUS_PARENT. Mise a jour en place, comme
// DEPARTEMENTS (pas d'historisation : un processus, une ligne).
const HEADERS_PROCESSUS = {
  ID_PROCESSUS: ['id processus', 'id du processus', 'identifiant processus', 'ref processus'],
  ID_PROCESSUS_PARENT: ['id processus parent', 'processus parent', 'id parent', 'id du processus parent'],
  NIVEAU: ['niveau'],
  NOM_PROCESSUS: ['nom processus', 'nom du processus', 'intitule processus', 'libelle processus'],
  DESCRIPTION: ['description'],
  // Rattachement de documents lies : champ texte/liste, cf. section 4 du lot (matrice de
  // rôles par document non traitee dans ce lot, documentee comme limitation).
  TYPE_DOCUMENT: ['type de document', 'type document'],
  REFERENCE_DOCUMENT: ['document lie', 'documents lies', 'reference document', 'document de reference'],
  PROPRIETAIRE: ['proprietaire', 'proprietaire du processus', 'responsable processus'],
  ACTIF: ['actif', 'active']
};
const REQUISES_PROCESSUS = ['ID_PROCESSUS', 'NIVEAU', 'NOM_PROCESSUS'];

// IAM_PERMISSIONS : RACI a la granularite "grand objet metier", en couche
// au-dessus des 4 niveaux hierarchiques (Analyste/Lead/Direction/Comité).
// Une permission cible soit un niveau, soit un utilisateur (derogation).
const HEADERS_IAM_PERMISSIONS = {
  ID_PERMISSION: ['id permission', 'id de la permission', 'identifiant permission', 'ref permission'],
  TYPE_CIBLE: ['type cible', 'type de cible'],
  CIBLE: ['cible'],
  RESSOURCE: ['ressource'],
  LECTURE: ['lecture'],
  ECRITURE: ['ecriture'],
  VALIDATION: ['validation'],
  ADMIN: ['admin']
};
const REQUISES_IAM_PERMISSIONS = ['ID_PERMISSION', 'TYPE_CIBLE', 'CIBLE', 'RESSOURCE'];

// Niveaux hierarchiques et grandes ressources metier, en dur : ce sont des
// enumerations fermees, pas des donnees du classeur, sur le meme principe
// que les statuts d'anomalie de 01_Parametres.
const NIVEAUX_HIERARCHIQUES_IAM = ['Analyste', 'Lead', 'Direction', 'Comité'];
const RESSOURCES_IAM = ['Risques', 'Contrôles', 'Évaluations', 'Appétence', 'Utilisateurs',
  'Échelles', 'Actions', 'Anomalies', 'Départements'];

// JOURNAL_GLOBAL : append-only, comme EXECUTIONS_CONTROLES. Volontairement
// non raccordee aux autres modules dans ce lot (voir 09_JournalGlobal.gs).
const HEADERS_JOURNAL_GLOBAL = {
  ID_ENTREE: ['id entree', 'id de l entree', 'identifiant entree', 'ref entree'],
  DATE: ['date'],
  UTILISATEUR: ['utilisateur'],
  OBJET: ['objet'],
  ACTION: ['action'],
  DETAIL: ['detail']
};
const REQUISES_JOURNAL_GLOBAL = ['ID_ENTREE', 'DATE', 'OBJET', 'ACTION'];

// ---------------------------------------------------------------- //
// 2. Moteur de resolution
// ---------------------------------------------------------------- //

// Caches valables le temps d'une execution : Apps Script repart d'un etat
// vierge a chaque appel, un en-tete modifie est donc relu au suivant.
const CACHE_ENTETES_ = {};
const CACHE_MAPS_ = {};

function oublierEntetes_(sheetName) {
  delete CACHE_ENTETES_[sheetName];
  delete CACHE_MAPS_[sheetName];
}

function normalizeHeader_(s) {
  if (s === null || s === undefined) return '';
  return String(s).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function readHeaders_(sheetName) {
  if (CACHE_ENTETES_[sheetName]) return CACHE_ENTETES_[sheetName];
  const sheet = getSheet(sheetName);
  const lastCol = Math.max(1, sheet.getLastColumn());
  const raw = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const list = [];
  for (let i = 0; i < raw.length; i++) {
    const norm = normalizeHeader_(raw[i]);
    if (norm !== '') list.push({ col: i + 1, raw: raw[i], norm: norm });
  }
  if (list.length === 0) {
    throw new Error('Aucun en-tête lisible en ligne ' + HEADER_ROW + ' de la feuille "' +
      sheetName + '". Vérifiez la constante HEADER_ROW dans 01_Parametres.');
  }
  CACHE_ENTETES_[sheetName] = list;
  return list;
}

function resolveColumn_(sheetName, aliases) {
  const headers = readHeaders_(sheetName);
  let i, a, cible;

  // Passe 1 : egalite stricte
  for (a = 0; a < aliases.length; a++) {
    cible = normalizeHeader_(aliases[a]);
    for (i = 0; i < headers.length; i++) {
      if (headers[i].norm === cible) return headers[i].col;
    }
  }
  // Passe 2 : inclusion, avec garde de longueur pour eviter les faux positifs.
  // L'inclusion inverse (le libelle cherche contient l'en-tete) n'est admise
  // que pour un en-tete de plusieurs mots : sans cette garde, la cle
  // "commentaire du validateur" se resoudrait sur la colonne "Validateur"
  // et le commentaire ecraserait l'adresse du validateur.
  for (a = 0; a < aliases.length; a++) {
    cible = normalizeHeader_(aliases[a]);
    if (cible.length < 4) continue;
    for (i = 0; i < headers.length; i++) {
      if (headers[i].norm.indexOf(cible) !== -1) return headers[i].col;
      if (headers[i].norm.length >= 4 && headers[i].norm.indexOf(' ') !== -1 &&
          cible.indexOf(headers[i].norm) !== -1) return headers[i].col;
    }
  }
  return 0;
}

function colMap_(sheetName, dictionnaire) {
  if (CACHE_MAPS_[sheetName]) return CACHE_MAPS_[sheetName];
  const out = {};
  Object.keys(dictionnaire).forEach(function (cle) {
    out[cle] = resolveColumn_(sheetName, dictionnaire[cle]);
  });
  CACHE_MAPS_[sheetName] = out;
  return out;
}

function mapRisques() { return colMap_(SHEETS.RISQUES, HEADERS_EVALUATIONS); }
function mapUtilisateurs() { return colMap_(SHEETS.UTILISATEURS, HEADERS_UTILISATEURS); }
function mapAppetence() { return colMap_(SHEETS.APPETENCE, HEADERS_APPETENCE); }

// Ajoutes en v10
function mapDepartements() { return colMap_(SHEETS.DEPARTEMENTS, HEADERS_DEPARTEMENTS); }
function mapControles() { return colMap_(SHEETS.CONTROLES, HEADERS_CONTROLES); }
function mapExecutions() { return colMap_(SHEETS.EXECUTIONS, HEADERS_EXECUTIONS); }
function mapEfficacite() { return colMap_(SHEETS.EFFICACITE, HEADERS_EFFICACITE); }
function mapAnomalies() { return colMap_(SHEETS.ANOMALIES, HEADERS_ANOMALIES); }

// Ajoutes lors du lot Processus / IAM / Journal global
function mapProcessus() { return colMap_(SHEETS.PROCESSUS, HEADERS_PROCESSUS); }
function mapIamPermissions() { return colMap_(SHEETS.IAM_PERMISSIONS, HEADERS_IAM_PERMISSIONS); }
function mapJournalGlobal() { return colMap_(SHEETS.JOURNAL_GLOBAL, HEADERS_JOURNAL_GLOBAL); }

/**
 * Lecture d'une valeur de ligne par cle logique. Renvoie '' si la colonne
 * n'existe pas dans le classeur, plutot que de lire une colonne voisine.
 */
function lire_(row, map, cle) {
  const c = map[cle];
  return c ? row[c - 1] : '';
}

/**
 * Ecriture. Leve une erreur explicite si la colonne est absente.
 */
function exigerColonne_(map, cle, nomFeuille) {
  const c = map[cle];
  if (!c) {
    throw new Error('Colonne "' + cle + '" introuvable dans la feuille "' + nomFeuille +
      '". Lancez Risk Management > Administration > Diagnostic du classeur pour voir ' +
      'les en-têtes détectés.');
  }
  return c;
}

// ---------------------------------------------------------------- //
// 3. Colonnes d'impact, resolues a partir des axes du referentiel
// ---------------------------------------------------------------- //

function aMarqueur_(normHeader, marqueurs) {
  const tokens = normHeader.split(' ');
  for (let t = 0; t < tokens.length; t++) {
    for (let m = 0; m < marqueurs.length; m++) {
      if (tokens[t] === marqueurs[m]) return true;
      if (marqueurs[m].length >= 3 && tokens[t].indexOf(marqueurs[m]) === 0) return true;
    }
  }
  return false;
}

function estColonneImpact_(normHeader) {
  const tokens = normHeader.split(' ');
  if (tokens.indexOf('retenu') !== -1) return false;
  return tokens[0] === 'impact' || tokens[0] === 'imp';
}

/**
 * Colonnes d'impact d'une phase, dans l'ordre du classeur. phase vaut
 * 'inh' ou 'res'. Si le nombre de colonnes detectees correspond au nombre
 * d'axes du referentiel, l'association se fait par ordre ; sinon par nom,
 * avec un message qui designe precisement l'axe manquant.
 */
function colonnesImpact_(sheetName, axes, phase) {
  const headers = readHeaders_(sheetName);
  const marqueurs = phase === 'inh' ? ['inherent', 'inh'] : ['residuel', 'residuelle', 'res'];
  const candidats = [];

  for (let i = 0; i < headers.length; i++) {
    if (!estColonneImpact_(headers[i].norm)) continue;
    if (!aMarqueur_(headers[i].norm, marqueurs)) continue;
    candidats.push(headers[i]);
  }

  if (candidats.length === axes.length) {
    return candidats.map(function (h) { return h.col; });
  }

  const out = [];
  for (let a = 0; a < axes.length; a++) {
    const token = normalizeHeader_(axes[a]).split(' ')[0];
    let trouve = 0;
    for (let c = 0; c < candidats.length; c++) {
      const tokens = candidats[c].norm.split(' ');
      for (let t = 0; t < tokens.length; t++) {
        if (tokens[t].length < 2 || token.length < 2) continue;
        if (tokens[t].indexOf(token) === 0 || token.indexOf(tokens[t]) === 0) { trouve = candidats[c].col; break; }
      }
      if (trouve) break;
    }
    if (!trouve) {
      throw new Error('Colonne d’impact "' + axes[a] + '" (' +
        (phase === 'inh' ? 'inhérent' : 'résiduel') + ') introuvable dans "' + sheetName +
        '". ' + candidats.length + ' colonne(s) d’impact détectée(s) pour ' + axes.length +
        ' axe(s) déclaré(s) dans ' + SHEETS.ECHELLES + '. Lancez le diagnostic du classeur.');
    }
    out.push(trouve);
  }
  return out;
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_02_Colonnes_() { return 'v10'; }
