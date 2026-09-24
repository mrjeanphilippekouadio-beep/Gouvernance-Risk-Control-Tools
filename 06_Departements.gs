/**
 * =====================================================================
 *  FICHIER  : 06_Departements          type : Script (.gs)
 *  SECTION  : MENU 6 · Départements
 *             > Ouvrir la fiche des départements -> openDepartements
 *  VA AVEC  : UI_Departements (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * Catalogue des departements (DEPARTEMENTS) : un departement, une ligne,
 * mise a jour en place (contrairement a RISQUES/EXECUTIONS/EFFICACITE qui
 * sont historisees). Chaque departement porte un pilote de risque. Regle :
 * le pilote est designe par le superieur hierarchique (le manager) ; a
 * defaut de designation explicite, le manager est lui-meme le pilote par
 * defaut (designerPiloteRisque_ applique cette regle a l'ecriture, pas a
 * l'affichage, pour que la feuille reste la source de verite).
 */

function openDepartements() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_Departements', 'Départements', 1180, 780);
}

// ---------------------------------------------------------------- //
// Lecture
// ---------------------------------------------------------------- //

function getDepartements() {
  const sheet = getSheet(SHEETS.DEPARTEMENTS);
  const map = mapDepartements();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = lire_(row, map, 'ID_DEPARTEMENT');
    if (isBlank(id)) continue;
    out.push({
      id: String(id),
      nom: String(lire_(row, map, 'NOM_DEPARTEMENT') || ''),
      entite: String(lire_(row, map, 'ENTITE') || ''),
      manager: String(lire_(row, map, 'MANAGER') || ''),
      piloteRisque: String(lire_(row, map, 'PILOTE_RISQUE') || ''),
      piloteDesignePar: String(lire_(row, map, 'PILOTE_DESIGNE_PAR') || ''),
      dateDesignation: lire_(row, map, 'DATE_DESIGNATION') || '',
      processusRattaches: String(lire_(row, map, 'PROCESSUS_RATTACHES') || ''),
      actif: estOui_(lire_(row, map, 'ACTIF'))
    });
  }
  return out;
}

function getDepartementsData() {
  return pourClient_({
    version: VERSION_SCRIPTS,
    user: profilUtilisateur_(),
    departements: getDepartements(),
    utilisateurs: listerUtilisateurs_(),
    processus: getReferentielColumn('PROCESSUS')
  });
}

// ---------------------------------------------------------------- //
// Ecriture : creation ou mise a jour en place
// ---------------------------------------------------------------- //

function ecrireLigneDepartement_(row, map, data) {
  const sheet = getSheet(SHEETS.DEPARTEMENTS);
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

  ecrire('NOM_DEPARTEMENT', data.nom || '');
  ecrire('ENTITE', data.entite || '');
  ecrire('MANAGER', data.manager || '');

  // Regle de designation du pilote : explicite si fourni, sinon le manager.
  const piloteExplicite = !isBlank(data.piloteRisque);
  const pilote = piloteExplicite ? data.piloteRisque : data.manager;
  ecrire('PILOTE_RISQUE', pilote || '');
  ecrire('PILOTE_DESIGNE_PAR', piloteExplicite ? (data.designePar || data.manager || '') :
    'Pilote par défaut (manager, aucune désignation explicite)');
  ecrire('DATE_DESIGNATION', getCurrentTimestamp());
  ecrire('PROCESSUS_RATTACHES', Array.isArray(data.processusRattaches) ?
    data.processusRattaches.join(', ') : (data.processusRattaches || ''));
  ecrire('ACTIF', data.actif === false ? 'Non' : 'Oui');

  let debut = 0;
  while (debut < nCols) {
    if (formules[debut] && String(formules[debut]).charAt(0) === '=') { debut++; continue; }
    let fin = debut;
    while (fin + 1 < nCols && !(formules[fin + 1] && String(formules[fin + 1]).charAt(0) === '=')) fin++;
    sheet.getRange(row, debut + 1, 1, fin - debut + 1).setValues([values.slice(debut, fin + 1)]);
    debut = fin + 1;
  }
  return pilote;
}

/**
 * Cree ou met a jour un departement. data.id vide ou absent -> creation.
 * Un departement sans pilote explicite recoit son manager comme pilote par
 * defaut, applique a chaque enregistrement pour rester coherent si le
 * manager change.
 */
function saveDepartement(data) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  try {
    if (isBlank(data.nom)) throw new Error('Le nom du département est obligatoire.');
    if (isBlank(data.manager)) throw new Error('Le manager (supérieur hiérarchique) est obligatoire.');

    const sheet = getSheet(SHEETS.DEPARTEMENTS);
    const map = mapDepartements();
    const colId = exigerColonne_(map, 'ID_DEPARTEMENT', SHEETS.DEPARTEMENTS);

    let row, id;
    if (!isBlank(data.id)) {
      row = findRowById(sheet, colId, data.id);
      if (row === -1) throw new Error('Département introuvable : ' + data.id);
      id = data.id;
    } else {
      row = findFirstEmptyRow(sheet, colId);
      id = generateId(PREFIX_ID_DEPARTEMENT, sheet, colId);
      sheet.getRange(row, colId).setValue(id);
    }

    const pilote = ecrireLigneDepartement_(row, map, data);
    return pourClient_({ id: id, piloteRisque: pilote, departements: getDepartements() });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Designation explicite du pilote par le superieur hierarchique, sans
 * toucher au reste de la fiche.
 */
function designerPiloteRisque(idDepartement, pilote, designePar) {
  if (isBlank(pilote)) throw new Error('Le pilote de risque est obligatoire.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  try {
    const sheet = getSheet(SHEETS.DEPARTEMENTS);
    const map = mapDepartements();
    const row = findRowById(sheet, exigerColonne_(map, 'ID_DEPARTEMENT', SHEETS.DEPARTEMENTS), idDepartement);
    if (row === -1) throw new Error('Département introuvable : ' + idDepartement);

    if (map.PILOTE_RISQUE) sheet.getRange(row, map.PILOTE_RISQUE).setValue(pilote);
    if (map.PILOTE_DESIGNE_PAR) sheet.getRange(row, map.PILOTE_DESIGNE_PAR).setValue(designePar || getCurrentUser());
    if (map.DATE_DESIGNATION) sheet.getRange(row, map.DATE_DESIGNATION).setValue(getCurrentTimestamp());

    return pourClient_({ id: idDepartement, piloteRisque: pilote, departements: getDepartements() });
  } finally {
    lock.releaseLock();
  }
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_06_Departements_() { return 'v10'; }
