/**
 * =====================================================================
 *  FICHIER  : 12_Executions            type : Script (.gs)
 *  SECTION  : MENU 5 · Contrôle interne
 *             > Exécutions des contrôles -> openExecutions
 *  VA AVEC  : UI_Executions (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * EXECUTIONS_CONTROLES est historisee, comme RISQUES : chaque occurrence
 * d'execution d'un controle est une nouvelle ligne, jamais une mise a jour
 * de la definition du controle (section 5 de l'instruction). Seule la
 * validation d'une execution deja enregistree touche sa ligne, exactement
 * comme la validation d'une evaluation dans 20_Validation.
 */

function openExecutions() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_Executions', 'Exécutions des contrôles', 1180, 800);
}

// ---------------------------------------------------------------- //
// Lecture
// ---------------------------------------------------------------- //

function getExecutions() {
  const sheet = getSheet(SHEETS.EXECUTIONS);
  const map = mapExecutions();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = lire_(row, map, 'ID_EXECUTION');
    if (isBlank(id)) continue;
    out.push({
      id: String(id),
      idControle: String(lire_(row, map, 'ID_CONTROLE') || ''),
      datePrevue: lire_(row, map, 'DATE_PREVUE') || '',
      dateRealisation: lire_(row, map, 'DATE_REALISATION') || '',
      executeur: String(lire_(row, map, 'EXECUTEUR') || ''),
      resultat: String(lire_(row, map, 'RESULTAT') || ''),
      anomaliesConstatees: String(lire_(row, map, 'ANOMALIES_CONSTATEES') || ''),
      preuves: String(lire_(row, map, 'PREUVES') || ''),
      nonRealiseJustif: String(lire_(row, map, 'NON_REALISE_JUSTIF') || ''),
      statut: String(lire_(row, map, 'STATUT_EXECUTION') || ''),
      validateur: String(lire_(row, map, 'VALIDATEUR') || ''),
      dateValidation: lire_(row, map, 'DATE_VALIDATION') || ''
    });
  }
  return out;
}

function getExecutionsData() {
  return pourClient_({
    version: VERSION_SCRIPTS,
    user: profilUtilisateur_(),
    executions: getExecutions(),
    controles: getControles(),
    utilisateurs: listerUtilisateurs_()
  });
}

// ---------------------------------------------------------------- //
// Enregistrement d'une occurrence d'execution (append-only)
// ---------------------------------------------------------------- //

function enregistrerExecution(data) {
  const cache = CacheService.getUserCache();
  const jeton = data && data.requestId ? String(data.requestId) : '';
  if (jeton && cache.get(jeton)) {
    throw new Error("Cette exécution a déjà été envoyée. Aucune ligne n'a été ajoutée.");
  }

  if (isBlank(data.idControle)) throw new Error('Le contrôle exécuté est obligatoire.');
  if (getControle(data.idControle) === null) {
    throw new Error('Le contrôle ' + data.idControle + " n'existe pas dans le catalogue.");
  }
  if (isBlank(data.statut)) throw new Error('Le statut de l’exécution (réalisé, non réalisé, N/A) est obligatoire.');
  if (normalizeText(data.statut) !== 'realise' && normalizeText(data.statut) !== 'réalisé' &&
    isBlank(data.nonRealiseJustif)) {
    throw new Error("Une exécution non réalisée ou non applicable doit être justifiée (section 5 : " +
      "justification obligatoire quand un contrôle n'a pas été réalisé).");
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  let resultat;
  try {
    const sheet = getSheet(SHEETS.EXECUTIONS);
    const map = mapExecutions();
    const colId = exigerColonne_(map, 'ID_EXECUTION', SHEETS.EXECUTIONS);
    const row = findFirstEmptyRow(sheet, colId);
    const id = generateId(PREFIX_ID_EXECUTION, sheet, colId);

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

    ecrire('ID_EXECUTION', id);
    ecrire('ID_CONTROLE', data.idControle);
    ecrire('DATE_PREVUE', data.datePrevue ? new Date(data.datePrevue) : '');
    ecrire('DATE_REALISATION', data.dateRealisation ? new Date(data.dateRealisation) : (getCurrentTimestamp()));
    ecrire('EXECUTEUR', data.executeur || getCurrentUser());
    ecrire('RESULTAT', data.resultat || '');
    ecrire('ANOMALIES_CONSTATEES', data.anomaliesConstatees || '');
    ecrire('PREUVES', data.preuves || '');
    ecrire('NON_REALISE_JUSTIF', data.nonRealiseJustif || '');
    ecrire('STATUT_EXECUTION', data.statut);
    ecrire('VALIDATEUR', '');
    ecrire('DATE_VALIDATION', '');

    let debut = 0;
    while (debut < nCols) {
      if (formules[debut] && String(formules[debut]).charAt(0) === '=') { debut++; continue; }
      let fin = debut;
      while (fin + 1 < nCols && !(formules[fin + 1] && String(formules[fin + 1]).charAt(0) === '=')) fin++;
      sheet.getRange(row, debut + 1, 1, fin - debut + 1).setValues([values.slice(debut, fin + 1)]);
      debut = fin + 1;
    }
    if (jeton) cache.put(jeton, '1', DUREE_JETON_SECONDES);

    resultat = pourClient_({ id: id, executions: getExecutions() });
  } finally {
    lock.releaseLock();
  }
  try {
    synchroniserVueControles_(data.idControle);
  } catch (e) {
    // La synchro de la vue R03 ne doit jamais faire échouer l'enregistrement principal.
  }
  return resultat;
}

/**
 * Validation d'une execution deja enregistree. Ne cree rien : ecrit
 * seulement le validateur et la date, comme ecrireDecisionValidation_ dans
 * 20_Validation pour les evaluations.
 */
function validerExecution(idExecution, commentaire) {
  const email = getCurrentUser();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  let resultat;
  let idControleConcerne;
  try {
    const sheet = getSheet(SHEETS.EXECUTIONS);
    const map = mapExecutions();
    const row = findRowById(sheet, exigerColonne_(map, 'ID_EXECUTION', SHEETS.EXECUTIONS), idExecution);
    if (row === -1) throw new Error('Exécution introuvable : ' + idExecution);

    idControleConcerne = map.ID_CONTROLE ? sheet.getRange(row, map.ID_CONTROLE).getValue() : '';

    const executeur = map.EXECUTEUR ? sheet.getRange(row, map.EXECUTEUR).getValue() : '';
    validateMakerChecker(executeur, email);

    if (map.VALIDATEUR) sheet.getRange(row, map.VALIDATEUR).setValue(email);
    if (map.DATE_VALIDATION) sheet.getRange(row, map.DATE_VALIDATION).setValue(getCurrentTimestamp());
    if (!isBlank(commentaire) && map.RESULTAT) {
      const cell = sheet.getRange(row, map.RESULTAT);
      cell.setValue((cell.getValue() || '') + '\n[Validation] ' + commentaire);
    }

    resultat = pourClient_({ id: idExecution, executions: getExecutions() });
  } finally {
    lock.releaseLock();
  }
  try {
    synchroniserVueControles_(idControleConcerne);
  } catch (e) {
    // La synchro de la vue R03 ne doit jamais faire échouer l'enregistrement principal.
  }
  return resultat;
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_12_Executions_() { return 'v10'; }
