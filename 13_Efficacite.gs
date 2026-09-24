/**
 * =====================================================================
 *  FICHIER  : 13_Efficacite            type : Script (.gs)
 *  SECTION  : MENU 5 · Contrôle interne
 *             > Efficacité des contrôles -> openEfficacite
 *  VA AVEC  : UI_Efficacite (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * R06_EVALUATIONS_CONTROLES est historisee, comme R04_EXECUTIONS_CONTROLES
 * et RISQUES : une evaluation d'efficacite est une nouvelle ligne. Elle est
 * distincte de l'execution (section 6 de l'instruction) : l'execution dit
 * si le controle a ete fait, cette feuille dit s'il est bien concu et
 * efficace pour maitriser le risque.
 *
 * Comme R04, R06 porte un circuit de validation (Validateur / Date
 * validation) : validerEfficacite() applique la meme separation des taches
 * que validerExecution() dans 12_Executions.gs, l'evaluateur ne pouvant pas
 * valider sa propre evaluation.
 */

function openEfficacite() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_Efficacite', 'Efficacité des contrôles', 1180, 800);
}

// ---------------------------------------------------------------- //
// Lecture
// ---------------------------------------------------------------- //

function getEvaluationsEfficacite() {
  const sheet = getSheet(SHEETS.EFFICACITE);
  const map = mapEfficacite();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = lire_(row, map, 'ID_EFFICACITE');
    if (isBlank(id)) continue;
    out.push({
      id: String(id),
      idControle: String(lire_(row, map, 'ID_CONTROLE') || ''),
      dateEval: lire_(row, map, 'DATE_EVAL') || '',
      typeEval: String(lire_(row, map, 'TYPE_EVAL') || ''),
      evaluateur: String(lire_(row, map, 'EVALUATEUR') || ''),
      adequationConception: String(lire_(row, map, 'ADEQUATION_CONCEPTION') || ''),
      qualiteExecution: String(lire_(row, map, 'QUALITE_EXECUTION') || ''),
      efficaciteOperationnelle: String(lire_(row, map, 'EFFICACITE_OPERATIONNELLE') || ''),
      resultat: String(lire_(row, map, 'RESULTAT') || ''),
      limitations: String(lire_(row, map, 'LIMITATIONS') || ''),
      mesuresCompensatoires: String(lire_(row, map, 'MESURES_COMPENSATOIRES') || ''),
      conclusion: String(lire_(row, map, 'CONCLUSION') || ''),
      justification: String(lire_(row, map, 'JUSTIFICATION') || ''),
      versionControle: String(lire_(row, map, 'VERSION_CONTROLE') || ''),
      statut: String(lire_(row, map, 'STATUT_EVAL') || ''),
      validateur: String(lire_(row, map, 'VALIDATEUR') || ''),
      dateValidation: lire_(row, map, 'DATE_VALIDATION') || ''
    });
  }
  return out;
}

/**
 * Derniere evaluation d'efficacite d'un controle, pour l'afficher sur sa
 * fiche (meme principe que getLatestEvaluation pour un risque).
 */
function getDerniereEfficacite(idControle) {
  const evals = getEvaluationsEfficacite().filter(function (e) { return e.idControle === idControle; });
  return evals.length ? evals[evals.length - 1] : null;
}

function getEfficaciteData() {
  return pourClient_({
    version: VERSION_SCRIPTS,
    user: profilUtilisateur_(),
    evaluations: getEvaluationsEfficacite(),
    controles: getControles()
  });
}

// ---------------------------------------------------------------- //
// Enregistrement d'une evaluation d'efficacite (append-only)
// ---------------------------------------------------------------- //

function enregistrerEvaluationEfficacite(data) {
  const cache = CacheService.getUserCache();
  const jeton = data && data.requestId ? String(data.requestId) : '';
  if (jeton && cache.get(jeton)) {
    throw new Error("Cette évaluation a déjà été envoyée. Aucune ligne n'a été ajoutée.");
  }

  if (isBlank(data.idControle)) throw new Error('Le contrôle évalué est obligatoire.');
  if (getControle(data.idControle) === null) {
    throw new Error('Le contrôle ' + data.idControle + " n'existe pas dans le catalogue.");
  }
  if (isBlank(data.efficaciteOperationnelle)) {
    throw new Error("La conclusion sur l'efficacité opérationnelle est obligatoire : exécuté ne veut pas dire efficace.");
  }
  if (isBlank(data.justification)) throw new Error("La justification de l'évaluation est obligatoire.");

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  let resultat;
  try {
    const sheet = getSheet(SHEETS.EFFICACITE);
    const map = mapEfficacite();
    const colId = exigerColonne_(map, 'ID_EFFICACITE', SHEETS.EFFICACITE);
    const row = findFirstEmptyRow(sheet, colId);
    const id = generateId(PREFIX_ID_EFFICACITE, sheet, colId);

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

    ecrire('ID_EFFICACITE', id);
    ecrire('ID_CONTROLE', data.idControle);
    ecrire('DATE_EVAL', getCurrentTimestamp());
    ecrire('TYPE_EVAL', data.typeEval || '');
    ecrire('EVALUATEUR', getCurrentUser());
    ecrire('ADEQUATION_CONCEPTION', data.adequationConception || '');
    ecrire('QUALITE_EXECUTION', data.qualiteExecution || '');
    ecrire('EFFICACITE_OPERATIONNELLE', data.efficaciteOperationnelle);
    ecrire('RESULTAT', data.resultat || '');
    ecrire('LIMITATIONS', data.limitations || '');
    ecrire('MESURES_COMPENSATOIRES', data.mesuresCompensatoires || '');
    ecrire('CONCLUSION', data.conclusion || '');
    ecrire('JUSTIFICATION', data.justification);
    ecrire('VERSION_CONTROLE', data.versionControle || '');
    ecrire('STATUT_EVAL', data.statut || 'Réalisée');
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

    resultat = pourClient_({ id: id, evaluations: getEvaluationsEfficacite() });
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

// ---------------------------------------------------------------- //
// Validation d'une evaluation deja enregistree (circuit R06)
// ---------------------------------------------------------------- //

/**
 * Validation d'une evaluation d'efficacite deja enregistree. Ne cree rien :
 * ecrit seulement le validateur et la date, exactement comme
 * validerExecution() dans 12_Executions pour les executions, et
 * ecrireDecisionValidation_() dans 20_Validation pour les evaluations de
 * risque. L'evaluateur ne peut pas valider sa propre evaluation
 * (validateMakerChecker).
 */
function validerEfficacite(idEfficacite, commentaire) {
  const email = getCurrentUser();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  let resultat;
  let idControleConcerne;
  try {
    const sheet = getSheet(SHEETS.EFFICACITE);
    const map = mapEfficacite();
    const row = findRowById(sheet, exigerColonne_(map, 'ID_EFFICACITE', SHEETS.EFFICACITE), idEfficacite);
    if (row === -1) throw new Error('Évaluation introuvable : ' + idEfficacite);

    idControleConcerne = map.ID_CONTROLE ? sheet.getRange(row, map.ID_CONTROLE).getValue() : '';

    const evaluateur = map.EVALUATEUR ? sheet.getRange(row, map.EVALUATEUR).getValue() : '';
    validateMakerChecker(evaluateur, email);

    if (map.VALIDATEUR) sheet.getRange(row, map.VALIDATEUR).setValue(email);
    if (map.DATE_VALIDATION) sheet.getRange(row, map.DATE_VALIDATION).setValue(getCurrentTimestamp());
    if (!isBlank(commentaire) && map.JUSTIFICATION) {
      const cell = sheet.getRange(row, map.JUSTIFICATION);
      cell.setValue((cell.getValue() || '') + '\n[Validation] ' + commentaire);
    }

    resultat = pourClient_({ id: idEfficacite, evaluations: getEvaluationsEfficacite() });
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
function fichier_13_Efficacite_() { return 'v10'; }
