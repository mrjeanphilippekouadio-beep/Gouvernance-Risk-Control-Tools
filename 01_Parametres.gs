/**
 * =====================================================================
 *  FICHIER  : 01_Parametres           type : Script (.gs)
 *  SECTION  : SOCLE COMMUN, indispensable quel que soit le menu utilise
 *  VERSION  : v10
 * =====================================================================
 *
 * Parametres techniques uniquement. Aucune position de colonne ici : les
 * colonnes sont resolues par leur libelle (fichier 02_Colonnes), ce qui
 * permet aux gouttieres qui separent les regroupements de la feuille
 * RISQUES de decaler les positions sans rien casser.
 */

const HEADER_ROW = 4;
const DATA_START_ROW = 5;
const DATA_LAST_ROW = 1004;

const SHEETS = {
  RISQUES: 'RISQUES',                  // base historisee, une ligne par evaluation
  SYNTHESE: 'SYNTHESE_RISQUES',        // vue, une ligne par risque, colonnes pilotees par CONFIG
  SOURCE: '_SOURCE_SYNTHESE',          // feuille technique masquee
  CARTOGRAPHIE: 'CARTOGRAPHIE',
  REFERENTIELS: 'REF_REFERENTIELS',
  ECHELLES: 'ECHELLES_COTATION',
  CONFIG: 'CONFIG',
  UTILISATEURS: 'UTILISATEURS',
  APPETENCE: 'APPETENCE',
  // Ajoutes en v10 : contrôle interne (5 · Contrôle interne) et départements (6 · Départements).
  // DEPARTEMENTS et ANOMALIES n'existent pas dans le template GRC_DJAMO : ce sont des feuilles
  // separees, gardees telles quelles (decision explicite du 24/09/2026), a ajouter officiellement
  // au classeur. CONTROLES, EXECUTIONS et EFFICACITE, en revanche, correspondent a des objets deja
  // presents dans le template sous les noms R03/R04/R06 : les valeurs ci-dessous sont alignees sur
  // ces feuilles reelles, et non sur des noms inventes.
  DEPARTEMENTS: 'DEPARTEMENTS',
  CONTROLES: 'R03_MATRICE_CONTROLES',
  EXECUTIONS: 'R04_EXECUTIONS_CONTROLES',
  EFFICACITE: 'R06_EVALUATIONS_CONTROLES',
  ANOMALIES: 'ANOMALIES',
  // Ajoutes lors du lot Processus / IAM / Journal global (24/09/2026). Feuilles propres au
  // projet, sans equivalent dans le template GRC_DJAMO, sur le meme principe que DEPARTEMENTS
  // et ANOMALIES : mises a jour en place pour PROCESSUS et IAM_PERMISSIONS, append-only pour
  // JOURNAL_GLOBAL (comme EXECUTIONS_CONTROLES).
  PROCESSUS: 'PROCESSUS',
  IAM_PERMISSIONS: 'IAM_PERMISSIONS',
  JOURNAL_GLOBAL: 'JOURNAL_GLOBAL'
};

const PREFIX_ID_RISQUE = 'RSK-DF';
const PREFIX_ID_EVAL = 'EVL-DF';
// Ajoutes en v10
const PREFIX_ID_DEPARTEMENT = 'DEP-DF';
const PREFIX_ID_CONTROLE = 'CTL-DF';
const PREFIX_ID_EXECUTION = 'EXE-DF';
const PREFIX_ID_EFFICACITE = 'EFF-DF';
const PREFIX_ID_ANOMALIE = 'ANO-DF';
// Ajoutes lors du lot Processus / IAM / Journal global
const PREFIX_ID_PROCESSUS = 'PRO-DF';
const PREFIX_ID_PERMISSION = 'IAM-DF';
const PREFIX_ID_JOURNAL = 'JRN-DF';

// CONFIG, bloc 1 : parametres cle / valeur, lus jusqu'a la premiere ligne vide
const CONFIG_PARAMS_START_ROW = 5;
// CONFIG, bloc 2 : versions de methodologie
const CONFIG_VERSIONS_HEADER_ROW = 15;
const CONFIG_VERSIONS_START_ROW = 16;
const CONFIG_VERSIONS_LAST_ROW = 27;
// CONFIG, bloc 3 : colonnes de la synthese (Rang | Colonne | Libelle affiche | Visible | Ordre)
const CONFIG_COLONNES_HEADER_ROW = 30;
const CONFIG_COLONNES_START_ROW = 31;
const CONFIG_COLONNES_LAST_ROW = 120;
// CONFIG, bloc 4 : champs obligatoires (Formulaire | Champ | Libelle affiche | Obligatoire | Actif)
const CONFIG_CHAMPS_TITRE_ROW = 124;
const CONFIG_CHAMPS_HEADER_ROW = 125;
const CONFIG_CHAMPS_START_ROW = 126;
const CONFIG_CHAMPS_LAST_ROW = 220;

const DEFAUT_SEUILS_NIVEAU = '1-4:Faible;5-9:Modéré;10-14:Élevé;15-19:Majeur;20-25:Critique';
const DEFAUT_SEUILS_MAITRISE = '>=2.5:Satisfaisant;>=1.75:Partiellement satisfaisant;<1.75:Insuffisant';
const DEFAUT_VERSION_METHODO = 'V1.0';

// Statuts d'evaluation. Le libelle reellement ecrit est celui de la colonne
// STATUT_EVALUATION de REF_REFERENTIELS (accents compris), pour rester dans
// la liste deroulante de la feuille RISQUES. Ces valeurs ne servent que de repli.
const DEFAUT_STATUT_EVAL = 'À VALIDER';
const STATUT_VALIDEE = 'Validée';
const STATUT_A_REVISER = 'À réviser';
const STATUT_REJETEE = 'Rejetée';
const STATUT_A_COTER = 'À coter';

// Cycle de vie des anomalies (ANOMALIES, v10). Repris tel quel par
// 14_Anomalies.gs (TRANSITIONS_ANOMALIE_) : ne pas modifier les libellés
// sans mettre à jour ce fichier en même temps.
const STATUT_ANOMALIE_NOUVELLE = 'Nouvelle';
const STATUT_ANOMALIE_EN_ANALYSE = 'En analyse';
const STATUT_ANOMALIE_ACTION_ENGAGEE = 'Action engagée';
const STATUT_ANOMALIE_CLOTUREE = 'Clôturée';

// Niveau de classeur attendu par ces scripts, inscrit dans CONFIG par la mise a niveau
const VERSION_CLASSEUR = 'v9';

// Duree de vie du jeton anti-double-enregistrement, en secondes
const DUREE_JETON_SECONDES = 180;

/**
 * Separateur d'arguments des formules, dependant de la locale du classeur.
 * Virgule en locale anglophone, point-virgule ailleurs.
 */
function separateurFormule_() {
  const locale = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetLocale() || 'fr_FR';
  return locale.indexOf('en') === 0 ? ',' : ';';
}

/**
 * Nom de feuille utilisable dans une formule. Toujours entre apostrophes :
 * c'est valide pour tous les noms, y compris ceux qui commencent par un
 * tiret bas comme _SOURCE_SYNTHESE.
 */
function refFeuille_(nom) {
  return "'" + String(nom).replace(/'/g, "''") + "'";
}

function colonneLettre_(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    const aliases = {
      'RISQUES': ['R02_EVALUATIONS_RISQUES', 'Evaluations', 'EVALUATIONS'],
      'SYNTHESE_RISQUES': ['R01_REGISTRE_RISQUES', 'Risques', 'Synthese'],
      'REF_REFERENTIELS': ['Referentiels', 'REFERENTIELS'],
      'ECHELLES_COTATION': ['Echelles', 'ECHELLES'],
      'UTILISATEURS': ['Utilisateurs'],
      'APPETENCE': ['Appetence'],
      'CONFIG': ['Config']
    };
    const list = aliases[name] || [];
    for (let i = 0; i < list.length; i++) {
      sheet = ss.getSheetByName(list[i]);
      if (sheet) break;
    }
  }
  if (!sheet) {
    throw new Error('Feuille introuvable : "' + name + '". Lancez Risk Management > ' +
      'Administration > Diagnostic du classeur.');
  }
  return sheet;
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_01_Parametres_() { return 'v10'; }
