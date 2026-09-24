/**
 * =====================================================================
 *  FICHIER  : 14_Anomalies             type : Script (.gs)
 *  SECTION  : MENU 5 · Contrôle interne
 *             > Anomalies et incidents -> openAnomalies
 *  VA AVEC  : UI_Anomalies (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * ANOMALIES : une anomalie ou un incident constate lors de l'execution
 * d'un controle (ou signale independamment). Contrairement a
 * EXECUTIONS_CONTROLES, ce n'est pas une feuille append-only : une
 * anomalie a un cycle de vie (Nouvelle -> En analyse -> Action engagée ->
 * Clôturée), porte par la meme ligne, comme un ticket. Le detail des
 * changements de statut peut etre retrouve dans le journal global (a venir).
 */

function openAnomalies() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_Anomalies', 'Anomalies et incidents', 1180, 800);
}

// ---------------------------------------------------------------- //
// Lecture
// ---------------------------------------------------------------- //

function getAnomalies() {
  const sheet = getSheet(SHEETS.ANOMALIES);
  const map = mapAnomalies();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = lire_(row, map, 'ID_ANOMALIE');
    if (isBlank(id)) continue;
    out.push({
      id: String(id),
      idControle: String(lire_(row, map, 'ID_CONTROLE') || ''),
      idExecution: String(lire_(row, map, 'ID_EXECUTION') || ''),
      idRisque: String(lire_(row, map, 'ID_RISQUE') || ''),
      dateConstat: lire_(row, map, 'DATE_CONSTAT') || '',
      description: String(lire_(row, map, 'DESCRIPTION') || ''),
      gravite: String(lire_(row, map, 'GRAVITE') || ''),
      origine: String(lire_(row, map, 'ORIGINE') || ''),
      detectePar: String(lire_(row, map, 'DETECTE_PAR') || ''),
      statut: String(lire_(row, map, 'STATUT_ANOMALIE') || ''),
      actionsAssociees: String(lire_(row, map, 'ACTIONS_ASSOCIEES') || ''),
      dateCloture: lire_(row, map, 'DATE_CLOTURE') || '',
      commentaireCloture: String(lire_(row, map, 'COMMENTAIRE_CLOTURE') || '')
    });
  }
  return out;
}

function getAnomaliesData() {
  return pourClient_({
    version: VERSION_SCRIPTS,
    user: profilUtilisateur_(),
    anomalies: getAnomalies(),
    controles: getControles(),
    executions: getExecutions(),
    risques: getRisks(),
    statuts: [STATUT_ANOMALIE_NOUVELLE, STATUT_ANOMALIE_EN_ANALYSE,
      STATUT_ANOMALIE_ACTION_ENGAGEE, STATUT_ANOMALIE_CLOTUREE]
  });
}

// ---------------------------------------------------------------- //
// Declaration d'une anomalie
// ---------------------------------------------------------------- //

function declarerAnomalie(data) {
  const cache = CacheService.getUserCache();
  const jeton = data && data.requestId ? String(data.requestId) : '';
  if (jeton && cache.get(jeton)) {
    throw new Error("Cette anomalie a déjà été envoyée. Aucune ligne n'a été ajoutée.");
  }

  if (isBlank(data.description)) throw new Error("La description de l'anomalie est obligatoire.");
  if (isBlank(data.gravite)) throw new Error('La gravité est obligatoire.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  try {
    const sheet = getSheet(SHEETS.ANOMALIES);
    const map = mapAnomalies();
    const colId = exigerColonne_(map, 'ID_ANOMALIE', SHEETS.ANOMALIES);
    const row = findFirstEmptyRow(sheet, colId);
    const id = generateId(PREFIX_ID_ANOMALIE, sheet, colId);

    const nCols = Math.max(sheet.getLastColumn(), 1);
    const plage = sheet.getRange(row, 1, 1, nCols);
    const values = plage.getValues()[0];
    const formules = plage.getFormulas()[0];
    function ecrire(cle, valeur) {
      const c = map[cle];
      if (!c) return;
      if (formules[c - 1] && String(formules[c - 1]).charAt(0) === '=') return;
      values[c - 1] = (valeur === null || valeur === undefined) ? '' : valeur;
    }

    ecrire('ID_ANOMALIE', id);
    ecrire('ID_CONTROLE', data.idControle || '');
    ecrire('ID_EXECUTION', data.idExecution || '');
    ecrire('ID_RISQUE', data.idRisque || '');
    ecrire('DATE_CONSTAT', getCurrentTimestamp());
    ecrire('DESCRIPTION', data.description);
    ecrire('GRAVITE', data.gravite);
    ecrire('ORIGINE', data.origine || '');
    ecrire('DETECTE_PAR', getCurrentUser());
    ecrire('STATUT_ANOMALIE', STATUT_ANOMALIE_NOUVELLE);
    ecrire('ACTIONS_ASSOCIEES', data.actionsAssociees || '');
    ecrire('DATE_CLOTURE', '');
    ecrire('COMMENTAIRE_CLOTURE', '');

    let debut = 0;
    while (debut < nCols) {
      if (formules[debut] && String(formules[debut]).charAt(0) === '=') { debut++; continue; }
      let fin = debut;
      while (fin + 1 < nCols && !(formules[fin + 1] && String(formules[fin + 1]).charAt(0) === '=')) fin++;
      sheet.getRange(row, debut + 1, 1, fin - debut + 1).setValues([values.slice(debut, fin + 1)]);
      debut = fin + 1;
    }
    if (jeton) cache.put(jeton, '1', DUREE_JETON_SECONDES);

    return pourClient_({ id: id, anomalies: getAnomalies() });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- //
// Cycle de vie : changement de statut
// ---------------------------------------------------------------- //

const TRANSITIONS_ANOMALIE_ = {};
TRANSITIONS_ANOMALIE_[STATUT_ANOMALIE_NOUVELLE] = [STATUT_ANOMALIE_EN_ANALYSE, STATUT_ANOMALIE_ACTION_ENGAGEE];
TRANSITIONS_ANOMALIE_[STATUT_ANOMALIE_EN_ANALYSE] = [STATUT_ANOMALIE_ACTION_ENGAGEE, STATUT_ANOMALIE_CLOTUREE];
TRANSITIONS_ANOMALIE_[STATUT_ANOMALIE_ACTION_ENGAGEE] = [STATUT_ANOMALIE_CLOTUREE];
TRANSITIONS_ANOMALIE_[STATUT_ANOMALIE_CLOTUREE] = [];

/**
 * Changement de statut d'une anomalie. La clôture exige un commentaire :
 * on ne referme pas un constat sans dire ce qui a ete fait.
 */
function mettreAJourStatutAnomalie(idAnomalie, nouveauStatut, commentaire) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  try {
    const sheet = getSheet(SHEETS.ANOMALIES);
    const map = mapAnomalies();
    const row = findRowById(sheet, exigerColonne_(map, 'ID_ANOMALIE', SHEETS.ANOMALIES), idAnomalie);
    if (row === -1) throw new Error('Anomalie introuvable : ' + idAnomalie);

    const statutActuel = map.STATUT_ANOMALIE ? sheet.getRange(row, map.STATUT_ANOMALIE).getValue() : '';
    const autorises = TRANSITIONS_ANOMALIE_[statutActuel] || [];
    if (autorises.indexOf(nouveauStatut) === -1 && normalizeText(statutActuel) !== normalizeText(nouveauStatut)) {
      throw new Error('Transition refusée : une anomalie "' + statutActuel + '" ne peut pas passer directement à "' +
        nouveauStatut + '".');
    }
    if (normalizeText(nouveauStatut) === normalizeText(STATUT_ANOMALIE_CLOTUREE) && isBlank(commentaire)) {
      throw new Error('La clôture d’une anomalie exige un commentaire décrivant ce qui a été fait.');
    }

    if (map.STATUT_ANOMALIE) sheet.getRange(row, map.STATUT_ANOMALIE).setValue(nouveauStatut);
    if (normalizeText(nouveauStatut) === normalizeText(STATUT_ANOMALIE_CLOTUREE)) {
      if (map.DATE_CLOTURE) sheet.getRange(row, map.DATE_CLOTURE).setValue(getCurrentTimestamp());
      if (map.COMMENTAIRE_CLOTURE) sheet.getRange(row, map.COMMENTAIRE_CLOTURE).setValue(commentaire);
    } else if (!isBlank(commentaire) && map.ACTIONS_ASSOCIEES) {
      const cell = sheet.getRange(row, map.ACTIONS_ASSOCIEES);
      cell.setValue((cell.getValue() || '') + '\n[' + nouveauStatut + '] ' + commentaire);
    }

    return pourClient_({ id: idAnomalie, statut: nouveauStatut, anomalies: getAnomalies() });
  } finally {
    lock.releaseLock();
  }
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_14_Anomalies_() { return 'v10'; }
