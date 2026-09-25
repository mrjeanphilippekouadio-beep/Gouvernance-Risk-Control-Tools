/**
 * =====================================================================
 *  FICHIER  : 03_Lecture              type : Script (.gs)
 *  SECTION  : SOCLE COMMUN, indispensable quel que soit le menu utilise
 *  VERSION  : v10
 * =====================================================================
 *
 * Lecture du classeur : echelles, CONFIG, referentiels, utilisateurs,
 * appetence, etat courant des risques. Aucune ecriture ici.
 *
 * Aucune lecture ne passe par SYNTHESE_RISQUES, dont les colonnes sont
 * configurables et peuvent etre masquees : tout part de RISQUES.
 */

// ---------------------------------------------------------------- //
// Echelles de cotation (ECHELLES_COTATION)
// ---------------------------------------------------------------- //

function findSectionRow_(values, startsWith) {
  const cible = normalizeHeader_(startsWith);
  for (let i = 0; i < values.length; i++) {
    const cell = values[i][0];
    if (typeof cell !== 'string') continue;
    if (normalizeHeader_(cell).indexOf(cible) === 0) return i;
  }
  throw new Error('Section "' + startsWith + '" introuvable dans ' + SHEETS.ECHELLES + '.');
}

function readMatrixBlock_(values, sectionMarker, nCols) {
  const headerRowIdx = findSectionRow_(values, sectionMarker) + 1;
  const headers = [];
  for (let c = 0; c < nCols; c++) headers.push(values[headerRowIdx][c] || '');
  const rows = [];
  let r = headerRowIdx + 1;
  while (r < values.length && !isBlank(values[r][0])) {
    const row = [];
    for (let c = 0; c < nCols; c++) row.push(values[r][c]);
    rows.push(row);
    r++;
  }
  return { headers: headers, rows: rows };
}

function niveauEntier_(v) {
  const n = parseInt(String(v), 10);
  return isNaN(n) ? v : n;
}

let CACHE_REFERENTIELS_ = null;

function getReferentiels() {
  if (CACHE_REFERENTIELS_) return CACHE_REFERENTIELS_;
  const sheet = getSheet(SHEETS.ECHELLES);
  const lastCol = Math.max(sheet.getLastColumn(), 8);
  const values = sheet.getRange(1, 1, sheet.getLastRow(), lastCol).getValues();

  const proba = readMatrixBlock_(values, '1. PROBABILITE', 3);
  const probabilite = proba.rows.map(function (row) {
    return { niveau: niveauEntier_(row[0]), libelle: row[1], definition: row[2] };
  });

  const imp = readMatrixBlock_(values, '2. IMPACT', lastCol);
  const axes = [];
  for (let c = 1; c < imp.headers.length; c++) {
    if (isBlank(imp.headers[c])) break;
    axes.push(imp.headers[c]);
  }
  const impact = imp.rows.map(function (row) {
    const parAxe = {};
    for (let i = 0; i < axes.length; i++) parAxe[axes[i]] = row[i + 1];
    return { niveau: niveauEntier_(row[0]), libelle: row[0], parAxe: parAxe };
  });

  const velo = readMatrixBlock_(values, '3. VELOCITE', 3);
  const velocite = velo.rows.map(function (row) {
    return { niveau: niveauEntier_(row[0]), libelle: row[1], definition: row[2] };
  });

  const mait = readMatrixBlock_(values, '4. MAITRISE', 4);
  const dimensions = mait.headers.slice(1).filter(function (h) { return !isBlank(h); });
  const maitrise = mait.rows.map(function (row) {
    const parDimension = {};
    for (let i = 0; i < dimensions.length; i++) parDimension[dimensions[i]] = row[i + 1];
    return { niveau: niveauEntier_(row[0]), libelle: row[0], parDimension: parDimension };
  });

  let regles = [];
  try {
    regles = readMatrixBlock_(values, '5. REGLES', 3).rows.map(function (row) {
      return { regle: row[0], reponse: row[1], commentaire: row[2] };
    });
  } catch (e) { regles = []; }

  // Bloc 6. Absent, le formulaire retombe sur une saisie libre.
  let persistance = [];
  try {
    persistance = readMatrixBlock_(values, '6. PERSISTANCE', 3).rows.map(function (row) {
      return { niveau: niveauEntier_(row[0]), libelle: row[1], definition: row[2] };
    });
  } catch (e) { persistance = []; }

  CACHE_REFERENTIELS_ = {
    probabilite: probabilite,
    impact: { axes: axes, niveaux: impact },
    velocite: velocite,
    persistance: persistance,
    maitrise: { dimensions: dimensions, niveaux: maitrise },
    regles: regles
  };
  return CACHE_REFERENTIELS_;
}

// ---------------------------------------------------------------- //
// CONFIG
// ---------------------------------------------------------------- //

let CACHE_CONFIG_ = null;

function oublierConfig_() { CACHE_CONFIG_ = null; }

/**
 * Bloc 1 de CONFIG : parametres cle / valeur, lus jusqu'a la premiere
 * cle vide. Lu une fois par execution.
 */
function getConfigParams() {
  if (CACHE_CONFIG_) return CACHE_CONFIG_;
  const sheet = getSheet(SHEETS.CONFIG);
  const nRows = Math.max(0, Math.min(sheet.getLastRow(), CONFIG_VERSIONS_HEADER_ROW - 2) -
    CONFIG_PARAMS_START_ROW + 1);
  const params = {};
  if (nRows > 0) {
    const values = sheet.getRange(CONFIG_PARAMS_START_ROW, 1, nRows, 2).getValues();
    for (let i = 0; i < values.length; i++) {
      if (isBlank(values[i][0])) break;
      params[String(values[i][0]).trim()] = values[i][1];
    }
  }
  CACHE_CONFIG_ = params;
  return params;
}

function getActiveMethodologyVersion() {
  const sheet = getSheet(SHEETS.CONFIG);
  const derniere = Math.min(sheet.getLastRow(), CONFIG_VERSIONS_LAST_ROW);
  const nRows = Math.max(0, derniere - CONFIG_VERSIONS_START_ROW + 1);
  if (nRows <= 0) return DEFAUT_VERSION_METHODO;
  const values = sheet.getRange(CONFIG_VERSIONS_START_ROW, 1, nRows, 4).getValues();
  for (let i = 0; i < values.length; i++) {
    if (isBlank(values[i][0])) break;
    if (normalizeText(values[i][3]) === 'active') return String(values[i][0]);
  }
  return DEFAUT_VERSION_METHODO;
}

/**
 * Bloc 3 de CONFIG : colonnes de la synthese, triees par ordre d'affichage.
 */
function lireColonnesSynthese() {
  const sheet = getSheet(SHEETS.CONFIG);
  const derniere = Math.min(sheet.getLastRow(), CONFIG_COLONNES_LAST_ROW);
  const nRows = Math.max(0, derniere - CONFIG_COLONNES_START_ROW + 1);
  if (nRows <= 0) return [];
  const values = sheet.getRange(CONFIG_COLONNES_START_ROW, 1, nRows, 5).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const rang = parseInt(values[i][0], 10);
    if (isNaN(rang)) continue;
    out.push({
      rang: rang,
      colonne: values[i][1],
      libelle: isBlank(values[i][2]) ? values[i][1] : values[i][2],
      visible: normalizeText(values[i][3]) === 'oui',
      ordre: parseInt(values[i][4], 10) || 9999
    });
  }
  out.sort(function (a, b) { return a.ordre - b.ordre; });
  return out;
}

/**
 * Bloc 4 de CONFIG : definition des champs d'un formulaire.
 * Le code ne connait aucun champ obligatoire en dur : c'est le classeur qui
 * decide. Une ligne dont la colonne Actif vaut Non est ignoree, comme si
 * elle n'existait pas.
 */
function lireChampsFormulaire(formulaire) {
  const sheet = getSheet(SHEETS.CONFIG);
  const derniere = Math.min(sheet.getLastRow(), CONFIG_CHAMPS_LAST_ROW);
  const nRows = Math.max(0, derniere - CONFIG_CHAMPS_START_ROW + 1);
  if (nRows <= 0) return [];
  const values = sheet.getRange(CONFIG_CHAMPS_START_ROW, 1, nRows, 5).getValues();

  const cible = normalizeText(formulaire);
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (isBlank(values[i][1])) continue;
    if (normalizeText(values[i][0]) !== cible) continue;
    if (normalizeText(values[i][4]) !== 'oui') continue;
    out.push({
      champ: String(values[i][1]).trim(),
      libelle: isBlank(values[i][2]) ? String(values[i][1]) : String(values[i][2]),
      obligatoire: normalizeText(values[i][3]) === 'oui'
    });
  }
  return out;
}

function champObligatoire_(formulaire, champ) {
  return lireChampsFormulaire(formulaire).some(function (c) {
    return c.champ === champ && c.obligatoire;
  });
}

// ---------------------------------------------------------------- //
// REF_REFERENTIELS
// ---------------------------------------------------------------- //

/**
 * Valeurs d'une colonne de REF_REFERENTIELS, reperee par son en-tete.
 */
function getReferentielColumn(nomEntete) {
  const sheet = getSheet(SHEETS.REFERENTIELS);
  const col = resolveColumn_(SHEETS.REFERENTIELS, [nomEntete]);
  if (!col) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  const values = sheet.getRange(DATA_START_ROW, col, lastRow - DATA_START_ROW + 1, 1).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (isBlank(values[i][0])) break;
    out.push(values[i][0]);
  }
  return out;
}

/**
 * Libelle exact d'un statut, tel qu'il figure dans la liste deroulante.
 * 'validee' renvoie 'Validée' si c'est ainsi que REF_REFERENTIELS l'ecrit.
 */
function libelleStatut_(parDefaut) {
  const cible = normalizeText(parDefaut);
  const liste = getReferentielColumn('STATUT_EVALUATION');
  for (let i = 0; i < liste.length; i++) {
    if (normalizeText(liste[i]) === cible) return String(liste[i]);
  }
  return parDefaut;
}

// ---------------------------------------------------------------- //
// Utilisateurs et appetence
// ---------------------------------------------------------------- //

function estOui_(v) {
  const n = normalizeText(v);
  return n === 'oui' || n === 'yes' || n === 'true' || v === true;
}

function findUserByEmail(email) {
  if (isBlank(email)) return null;
  const sheet = getSheet(SHEETS.UTILISATEURS);
  const map = mapUtilisateurs();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return null;
  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (normalizeText(lire_(row, map, 'EMAIL')) !== normalizeText(email)) continue;
    return {
      email: String(lire_(row, map, 'EMAIL')),
      nom: String(lire_(row, map, 'NOM') || ''),
      fonction: String(lire_(row, map, 'FONCTION') || ''),
      peutEvaluer: estOui_(lire_(row, map, 'PEUT_EVALUER')),
      peutValider: estOui_(lire_(row, map, 'PEUT_VALIDER')),
      actif: estOui_(lire_(row, map, 'ACTIF'))
    };
  }
  return null;
}

function resolveAppetence(sousCategorie, entite) {
  const sheet = getSheet(SHEETS.APPETENCE);
  const map = mapAppetence();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return null;
  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();

  let generique = null;
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (!estOui_(lire_(row, map, 'ACTIF'))) continue;
    if (normalizeText(lire_(row, map, 'SOUS_CATEGORIE')) !== normalizeText(sousCategorie)) continue;
    const plafond = lire_(row, map, 'SCORE_PLAFOND');
    if (isBlank(plafond)) continue;
    const entiteLigne = lire_(row, map, 'ENTITE');
    if (!isBlank(entiteLigne) && normalizeText(entiteLigne) === normalizeText(entite)) {
      return { scorePlafond: plafond, source: 'entite' };
    }
    if (isBlank(entiteLigne) && !generique) {
      generique = { scorePlafond: plafond, source: 'generique' };
    }
  }
  return generique;
}

// ---------------------------------------------------------------- //
// Risques : etat courant, deduit de la derniere ligne de chaque risque
// ---------------------------------------------------------------- //

const CHAMPS_FICHE = ['ENTITE', 'PAYS', 'DEPARTEMENT', 'PROCESSUS', 'CATEGORIE', 'SOUS_CATEGORIE',
  'OBJECTIF', 'INTITULE', 'DESCRIPTION', 'CAUSES', 'CONSEQUENCES', 'PROPRIETAIRE',
  'CONTROLES_ASSOCIES', 'KRI_ASSOCIES'];

const CLES_FICHE = { ENTITE: 'entite', PAYS: 'pays', DEPARTEMENT: 'departement',
  PROCESSUS: 'processus', CATEGORIE: 'categorie', SOUS_CATEGORIE: 'sousCategorie',
  OBJECTIF: 'objectif', INTITULE: 'intitule', DESCRIPTION: 'description', CAUSES: 'causes',
  CONSEQUENCES: 'consequences', PROPRIETAIRE: 'proprietaire',
  CONTROLES_ASSOCIES: 'controles', KRI_ASSOCIES: 'kri' };

// Lecture de RISQUES gardee le temps d'une execution : un enregistrement la
// relisait trois ou quatre fois. Toute ecriture dans RISQUES l'invalide.
let CACHE_LIGNES_ = null;

function oublierLignes_() { CACHE_LIGNES_ = null; }

function lireToutesLesLignes_() {
  if (CACHE_LIGNES_) return CACHE_LIGNES_;
  const sheet = getSheet(SHEETS.RISQUES);
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  CACHE_LIGNES_ = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();
  return CACHE_LIGNES_;
}

function lireLigneRisque_(row, map) {
  const o = { id: String(lire_(row, map, 'ID_RISQUE')) };
  CHAMPS_FICHE.forEach(function (cle) {
    const v = lire_(row, map, cle);
    o[CLES_FICHE[cle]] = isBlank(v) ? '' : String(v);
  });
  o.scoreInherent = lire_(row, map, 'SCORE_INH');
  o.niveauInherent = lire_(row, map, 'NIVEAU_INH') || '';
  o.scoreResiduel = lire_(row, map, 'SCORE_RES');
  o.niveauResiduel = lire_(row, map, 'NIVEAU_RES') || '';
  o.statut = lire_(row, map, 'STATUT_EVAL') || '';
  o.dateDerniereEval = lire_(row, map, 'DATE_EVAL') || '';
  return o;
}

/**
 * Une evaluation est cotee si au moins une probabilite ou un score y figure.
 * Les lignes migrees au statut "À coter" ne le sont pas.
 */
function ligneCotee_(row, map) {
  return ['PROBA_INH', 'SCORE_INH', 'PROBA_RES', 'SCORE_RES'].some(function (k) {
    return !isBlank(lire_(row, map, k));
  });
}

/**
 * Etat courant de chaque risque, deduit de sa derniere ligne, avec le
 * nombre d'evaluations cotees. Lit uniquement la base historisee.
 */
function getRisks() {
  const map = mapRisques();
  const values = lireToutesLesLignes_();
  const parId = {};
  const compte = {};
  const ordre = [];
  for (let i = 0; i < values.length; i++) {
    const riskId = lire_(values[i], map, 'ID_RISQUE');
    if (isBlank(riskId)) continue;
    if (!parId[riskId]) { ordre.push(riskId); compte[riskId] = 0; }
    if (ligneCotee_(values[i], map)) compte[riskId]++;
    parId[riskId] = lireLigneRisque_(values[i], map); // la derniere ligne lue prime
  }
  return ordre.map(function (k) {
    parId[k].nbEvaluations = compte[k];
    return parId[k];
  });
}

function getRisk(riskId) {
  const risks = getRisks();
  for (let i = 0; i < risks.length; i++) if (risks[i].id === riskId) return risks[i];
  return null;
}

/**
 * Derniere evaluation d'un risque, toutes colonnes, et nombre d'evaluations.
 */
function getLatestEvaluation(riskId) {
  const map = mapRisques();
  const values = lireToutesLesLignes_();

  let best = null, bestRow = -1, nb = 0;
  for (let i = 0; i < values.length; i++) {
    if (lire_(values[i], map, 'ID_RISQUE') !== riskId) continue;
    if (ligneCotee_(values[i], map)) nb++;
    best = values[i];
    bestRow = DATA_START_ROW + i;
  }
  if (best === null) return null;

  const out = { row: bestRow, nbEvaluations: nb, ligne: best, cotee: ligneCotee_(best, map) };
  Object.keys(map).forEach(function (cle) { out[cle] = lire_(best, map, cle); });
  return out;
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_03_Lecture_() { return 'v10'; }
