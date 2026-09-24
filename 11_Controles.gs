/**
 * =====================================================================
 *  FICHIER  : 11_Controles             type : Script (.gs)
 *  SECTION  : MENU 5 · Contrôle interne
 *             > Catalogue des contrôles -> openControles
 *  VA AVEC  : UI_Controles (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * Catalogue des controles (CONTROLES) : un controle, une ligne, mise a
 * jour en place. La description doit permettre a quelqu'un d'autre de
 * comprendre pourquoi le controle existe, ce qui doit etre fait, par qui,
 * a quelle frequence, et quelle preuve est attendue (section 4 de
 * l'instruction de refonte). L'execution et l'efficacite d'un controle
 * sont d'autres objets, dans EXECUTIONS_CONTROLES et
 * EVALUATIONS_EFFICACITE : cette feuille ne decrit que la definition.
 */

function openControles() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_Controles', 'Catalogue des contrôles', 1180, 800);
}

// ---------------------------------------------------------------- //
// Lecture
// ---------------------------------------------------------------- //

function getControles() {
  const sheet = getSheet(SHEETS.CONTROLES);
  const map = mapControles();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = lire_(row, map, 'ID_CONTROLE');
    if (isBlank(id)) continue;
    out.push({
      id: String(id),
      libelle: String(lire_(row, map, 'LIBELLE_CONTROLE') || ''),
      objectif: String(lire_(row, map, 'OBJECTIF_CONTROLE') || ''),
      risquesCouverts: String(lire_(row, map, 'RISQUES_COUVERTS') || ''),
      processus: String(lire_(row, map, 'PROCESSUS') || ''),
      departement: String(lire_(row, map, 'DEPARTEMENT') || ''),
      procedure: String(lire_(row, map, 'DESCRIPTION_PROCEDURE') || ''),
      type: String(lire_(row, map, 'TYPE_CONTROLE') || ''),
      nature: String(lire_(row, map, 'NATURE_CONTROLE') || ''),
      ligneDefense: String(lire_(row, map, 'NIVEAU_LIGNE_DEFENSE') || ''),
      frequence: String(lire_(row, map, 'FREQUENCE') || ''),
      executeur: String(lire_(row, map, 'EXECUTEUR') || ''),
      valideur: String(lire_(row, map, 'VALIDEUR') || ''),
      preuvesAttendues: String(lire_(row, map, 'PREUVES_ATTENDUES') || ''),
      criteresConformite: String(lire_(row, map, 'CRITERES_CONFORMITE') || ''),
      statut: String(lire_(row, map, 'STATUT_CONTROLE') || ''),
      dateCreation: lire_(row, map, 'DATE_CREATION') || '',
      dateMaj: lire_(row, map, 'DATE_MAJ') || ''
    });
  }
  return out;
}

function getControle(idControle) {
  const controles = getControles();
  for (let i = 0; i < controles.length; i++) if (controles[i].id === idControle) return controles[i];
  return null;
}

function getControlesData() {
  return pourClient_({
    version: VERSION_SCRIPTS,
    user: profilUtilisateur_(),
    controles: getControles(),
    risques: getRisks(),
    departements: getDepartements(),
    utilisateurs: listerUtilisateurs_(),
    processus: getReferentielColumn('PROCESSUS')
  });
}

// ---------------------------------------------------------------- //
// Ecriture : creation ou mise a jour en place de la definition
// ---------------------------------------------------------------- //

function ecrireLigneControle_(row, map, data, creation) {
  const sheet = getSheet(SHEETS.CONTROLES);
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

  ecrire('LIBELLE_CONTROLE', data.libelle || '');
  ecrire('OBJECTIF_CONTROLE', data.objectif || '');
  ecrire('RISQUES_COUVERTS', Array.isArray(data.risquesCouverts) ?
    data.risquesCouverts.join(', ') : (data.risquesCouverts || ''));
  ecrire('PROCESSUS', data.processus || '');
  ecrire('DEPARTEMENT', data.departement || '');
  ecrire('DESCRIPTION_PROCEDURE', data.procedure || '');
  ecrire('TYPE_CONTROLE', data.type || '');
  ecrire('NATURE_CONTROLE', data.nature || '');
  ecrire('NIVEAU_LIGNE_DEFENSE', data.ligneDefense || '');
  ecrire('FREQUENCE', data.frequence || '');
  ecrire('EXECUTEUR', data.executeur || '');
  ecrire('VALIDEUR', data.valideur || '');
  ecrire('PREUVES_ATTENDUES', data.preuvesAttendues || '');
  ecrire('CRITERES_CONFORMITE', data.criteresConformite || '');
  ecrire('STATUT_CONTROLE', data.statut || 'Actif');
  if (creation) ecrire('DATE_CREATION', getCurrentTimestamp());
  ecrire('DATE_MAJ', getCurrentTimestamp());

  let debut = 0;
  while (debut < nCols) {
    if (formules[debut] && String(formules[debut]).charAt(0) === '=') { debut++; continue; }
    let fin = debut;
    while (fin + 1 < nCols && !(formules[fin + 1] && String(formules[fin + 1]).charAt(0) === '=')) fin++;
    sheet.getRange(row, debut + 1, 1, fin - debut + 1).setValues([values.slice(debut, fin + 1)]);
    debut = fin + 1;
  }
}

function validateControle_(data) {
  if (isBlank(data.libelle)) throw new Error('Le libellé du contrôle est obligatoire.');
  if (isBlank(data.risquesCouverts) || (Array.isArray(data.risquesCouverts) && data.risquesCouverts.length === 0)) {
    throw new Error('Un contrôle doit couvrir au moins un risque : un risque doit avoir au moins un contrôle, ' +
      'la réciproque est vraie.');
  }
  if (isBlank(data.type)) throw new Error('Le type de contrôle (préventif, détectif, correctif) est obligatoire.');
  if (isBlank(data.frequence)) throw new Error('La fréquence est obligatoire.');
  if (isBlank(data.executeur)) throw new Error("L'exécuteur est obligatoire.");
  if (isBlank(data.criteresConformite)) throw new Error('Les critères de conformité sont obligatoires.');
}

function saveControle(data) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  try {
    validateControle_(data);
    const sheet = getSheet(SHEETS.CONTROLES);
    const map = mapControles();
    const colId = exigerColonne_(map, 'ID_CONTROLE', SHEETS.CONTROLES);

    let row, id, creation;
    if (!isBlank(data.id)) {
      row = findRowById(sheet, colId, data.id);
      if (row === -1) throw new Error('Contrôle introuvable : ' + data.id);
      id = data.id;
      creation = false;
    } else {
      row = findFirstEmptyRow(sheet, colId);
      id = generateId(PREFIX_ID_CONTROLE, sheet, colId);
      sheet.getRange(row, colId).setValue(id);
      creation = true;
    }

    ecrireLigneControle_(row, map, data, creation);
    return pourClient_({ id: id, controles: getControles() });
  } finally {
    lock.releaseLock();
  }
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_11_Controles_() { return 'v10'; }
