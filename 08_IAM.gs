/**
 * =====================================================================
 *  FICHIER  : 08_IAM                    type : Script (.gs)
 *  SECTION  : MENU Administration (accès et permissions)
 *             > RACI / IAM -> openIAM
 *  VA AVEC  : UI_IAM (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * IAM_PERMISSIONS : couche de permissions par-dessus les 4 niveaux
 * hierarchiques (Analyste/Lead/Direction/Comité), a la granularite "grand
 * objet metier" (Risques, Contrôles, Évaluations, Appétence, Utilisateurs,
 * Échelles, Actions, Anomalies, Départements). Une permission cible soit un
 * niveau hierarchique, soit un utilisateur individuel (derogation).
 *
 * Mise a jour en place, comme DEPARTEMENTS et PROCESSUS : une permission,
 * une ligne. Pas d'historisation : une nouvelle valeur remplace l'ancienne
 * pour un meme (type cible, cible, ressource).
 */

function openIAM() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_IAM', 'RACI / IAM', 1180, 800);
}

// ---------------------------------------------------------------- //
// Lecture
// ---------------------------------------------------------------- //

function getIamPermissions() {
  const sheet = getSheet(SHEETS.IAM_PERMISSIONS);
  const map = mapIamPermissions();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = lire_(row, map, 'ID_PERMISSION');
    if (isBlank(id)) continue;
    out.push({
      id: String(id),
      typeCible: String(lire_(row, map, 'TYPE_CIBLE') || ''),
      cible: String(lire_(row, map, 'CIBLE') || ''),
      ressource: String(lire_(row, map, 'RESSOURCE') || ''),
      lecture: estOui_(lire_(row, map, 'LECTURE')),
      ecriture: estOui_(lire_(row, map, 'ECRITURE')),
      validation: estOui_(lire_(row, map, 'VALIDATION')),
      admin: estOui_(lire_(row, map, 'ADMIN'))
    });
  }
  return out;
}

function getIamPermissionsData() {
  return pourClient_({
    version: VERSION_SCRIPTS,
    user: profilUtilisateur_(),
    permissions: getIamPermissions(),
    niveaux: NIVEAUX_HIERARCHIQUES_IAM,
    ressources: RESSOURCES_IAM,
    utilisateurs: listerUtilisateurs_()
  });
}

// ---------------------------------------------------------------- //
// Ecriture : creation ou mise a jour en place
// ---------------------------------------------------------------- //

function ecrireLignePermission_(row, map, data) {
  const sheet = getSheet(SHEETS.IAM_PERMISSIONS);
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

  ecrire('TYPE_CIBLE', data.typeCible || '');
  ecrire('CIBLE', data.cible || '');
  ecrire('RESSOURCE', data.ressource || '');
  ecrire('LECTURE', data.lecture ? 'Oui' : 'Non');
  ecrire('ECRITURE', data.ecriture ? 'Oui' : 'Non');
  ecrire('VALIDATION', data.validation ? 'Oui' : 'Non');
  ecrire('ADMIN', data.admin ? 'Oui' : 'Non');

  let debut = 0;
  while (debut < nCols) {
    if (formules[debut] && String(formules[debut]).charAt(0) === '=') { debut++; continue; }
    let fin = debut;
    while (fin + 1 < nCols && !(formules[fin + 1] && String(formules[fin + 1]).charAt(0) === '=')) fin++;
    sheet.getRange(row, debut + 1, 1, fin - debut + 1).setValues([values.slice(debut, fin + 1)]);
    debut = fin + 1;
  }
}

function validerPermission_(data) {
  if (data.typeCible !== 'Niveau' && data.typeCible !== 'Utilisateur') {
    throw new Error('Le type de cible doit être "Niveau" ou "Utilisateur".');
  }
  if (isBlank(data.cible)) throw new Error('La cible (niveau ou utilisateur) est obligatoire.');
  if (data.typeCible === 'Niveau' && NIVEAUX_HIERARCHIQUES_IAM.indexOf(data.cible) === -1) {
    throw new Error('Niveau inconnu : ' + data.cible + '. Niveaux valides : ' +
      NIVEAUX_HIERARCHIQUES_IAM.join(', ') + '.');
  }
  if (RESSOURCES_IAM.indexOf(data.ressource) === -1) {
    throw new Error('Ressource inconnue : ' + data.ressource + '. Ressources valides : ' +
      RESSOURCES_IAM.join(', ') + '.');
  }
}

function savePermission(data) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  try {
    validerPermission_(data);
    const sheet = getSheet(SHEETS.IAM_PERMISSIONS);
    const map = mapIamPermissions();
    const colId = exigerColonne_(map, 'ID_PERMISSION', SHEETS.IAM_PERMISSIONS);

    let row, id;
    if (!isBlank(data.id)) {
      row = findRowById(sheet, colId, data.id);
      if (row === -1) throw new Error('Permission introuvable : ' + data.id);
      id = data.id;
    } else {
      row = findFirstEmptyRow(sheet, colId);
      id = generateId(PREFIX_ID_PERMISSION, sheet, colId);
      sheet.getRange(row, colId).setValue(id);
    }

    ecrireLignePermission_(row, map, data);
    return pourClient_({ id: id, permissions: getIamPermissions() });
  } finally {
    lock.releaseLock();
  }
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_08_IAM_() { return 'v10'; }
