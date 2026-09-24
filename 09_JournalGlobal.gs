/**
 * =====================================================================
 *  FICHIER  : 09_JournalGlobal          type : Script (.gs)
 *  SECTION  : MENU Administration (traçabilité)
 *             > Journal global -> openJournalGlobal
 *  VA AVEC  : UI_JournalGlobal (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * JOURNAL_GLOBAL est append-only, comme R04_EXECUTIONS_CONTROLES : chaque
 * entree est une nouvelle ligne, jamais une mise a jour.
 *
 * IMPORTANT — limite volontaire de ce lot : journaliserGlobal_() n'est PAS
 * appelee depuis les fonctions d'ecriture des autres modules (Contrôles,
 * Exécutions, Efficacité, Départements, Anomalies, Évaluation, Validation).
 * Ce raccordement transverse est un chantier separe, pour ne pas modifier
 * des fichiers sur lesquels d'autres agents travaillent en parallele. Le
 * journal fonctionne de façon autonome : on peut y écrire manuellement
 * (ajouterEntreeJournal, depuis UI_JournalGlobal) et le lire (getJournalGlobal).
 */

function openJournalGlobal() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_JournalGlobal', 'Journal global', 1180, 800);
}

// ---------------------------------------------------------------- //
// Ecriture (append-only)
// ---------------------------------------------------------------- //

/**
 * A appeler depuis n'importe quel module pour tracer une action. Ne fait
 * rien d'autre qu'ajouter une ligne : aucune lecture prealable, pas de
 * verification d'unicite. Reprend le pattern verrou de 12_Executions /
 * 13_Efficacite.
 */
function journaliserGlobal_(objet, action, detail) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    // Le journal ne doit jamais faire echouer l'action qu'il trace : on
    // abandonne silencieusement plutot que de lever une erreur ici.
    return null;
  }
  try {
    const sheet = getSheet(SHEETS.JOURNAL_GLOBAL);
    const map = mapJournalGlobal();
    const colId = exigerColonne_(map, 'ID_ENTREE', SHEETS.JOURNAL_GLOBAL);
    const row = findFirstEmptyRow(sheet, colId);
    const id = generateId(PREFIX_ID_JOURNAL, sheet, colId);

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

    ecrire('ID_ENTREE', id);
    ecrire('DATE', getCurrentTimestamp());
    ecrire('UTILISATEUR', getCurrentUser());
    ecrire('OBJET', objet || '');
    ecrire('ACTION', action || '');
    ecrire('DETAIL', detail || '');

    let debut = 0;
    while (debut < nCols) {
      if (formules[debut] && String(formules[debut]).charAt(0) === '=') { debut++; continue; }
      let fin = debut;
      while (fin + 1 < nCols && !(formules[fin + 1] && String(formules[fin + 1]).charAt(0) === '=')) fin++;
      sheet.getRange(row, debut + 1, 1, fin - debut + 1).setValues([values.slice(debut, fin + 1)]);
      debut = fin + 1;
    }
    return id;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Point d'entree cote client, pour une entree ajoutee manuellement depuis
 * UI_JournalGlobal (l'instruction demande que le journal puisse etre
 * alimente a la main tant que le raccordement automatique n'est pas fait).
 */
function ajouterEntreeJournal(objet, action, detail) {
  if (isBlank(objet)) throw new Error("L'objet de l'entrée est obligatoire.");
  if (isBlank(action)) throw new Error("L'action de l'entrée est obligatoire.");
  const id = journaliserGlobal_(objet, action, detail || '');
  if (!id) throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  return pourClient_({ id: id, entrees: getJournalGlobal() });
}

// ---------------------------------------------------------------- //
// Lecture
// ---------------------------------------------------------------- //

/**
 * Toutes les entrees, triees de la plus recente a la plus ancienne. Le
 * filtre par objet / utilisateur / plage de dates se fait cote client,
 * comme demande : cette fonction renvoie tout.
 */
function getJournalGlobal() {
  const sheet = getSheet(SHEETS.JOURNAL_GLOBAL);
  const map = mapJournalGlobal();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = lire_(row, map, 'ID_ENTREE');
    if (isBlank(id)) continue;
    out.push({
      id: String(id),
      date: lire_(row, map, 'DATE') || '',
      utilisateur: String(lire_(row, map, 'UTILISATEUR') || ''),
      objet: String(lire_(row, map, 'OBJET') || ''),
      action: String(lire_(row, map, 'ACTION') || ''),
      detail: String(lire_(row, map, 'DETAIL') || '')
    });
  }
  out.reverse(); // le plus recent d'abord ; l'ordre d'ecriture est chronologique croissant
  return out;
}

function getJournalGlobalData() {
  return pourClient_({
    version: VERSION_SCRIPTS,
    user: profilUtilisateur_(),
    entrees: getJournalGlobal()
  });
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_09_JournalGlobal_() { return 'v10'; }
