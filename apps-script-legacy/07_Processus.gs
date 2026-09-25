/**
 * =====================================================================
 *  FICHIER  : 07_Processus              type : Script (.gs)
 *  SECTION  : MENU 6 · Départements et référentiels
 *             > Cartographie des processus -> openProcessus
 *  VA AVEC  : UI_Processus (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * Catalogue des processus (PROCESSUS) : un processus, une ligne, mise a
 * jour en place, comme DEPARTEMENTS. Hierarchie a 3 niveaux au maximum
 * (Processus > Sous-processus > Activité), auto-referencee via
 * ID_PROCESSUS_PARENT sur la meme feuille.
 *
 * Rattachement de documents lies (charte, politique, manuel de procedures,
 * procedure, mode operatoire) : un champ texte/liste par processus
 * (TYPE_DOCUMENT + REFERENCE_DOCUMENT). Pas de matrice de roles par
 * document dans ce lot : limitation documentee dans le rapport de livraison.
 */

const NIVEAUX_PROCESSUS = ['Processus', 'Sous-processus', 'Activité'];
const TYPES_DOCUMENT_PROCESSUS = ['Charte', 'Politique', 'Manuel de procédures', 'Procédure', 'Mode opératoire'];

function rangNiveauProcessus_(niveau) {
  const i = NIVEAUX_PROCESSUS.indexOf(niveau);
  return i === -1 ? 0 : i + 1;
}

function openProcessus() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_Processus', 'Processus', 1180, 800);
}

// ---------------------------------------------------------------- //
// Lecture
// ---------------------------------------------------------------- //

function getProcessus() {
  const sheet = getSheet(SHEETS.PROCESSUS);
  const map = mapProcessus();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = lire_(row, map, 'ID_PROCESSUS');
    if (isBlank(id)) continue;
    out.push({
      id: String(id),
      idParent: String(lire_(row, map, 'ID_PROCESSUS_PARENT') || ''),
      niveau: String(lire_(row, map, 'NIVEAU') || ''),
      nom: String(lire_(row, map, 'NOM_PROCESSUS') || ''),
      description: String(lire_(row, map, 'DESCRIPTION') || ''),
      typeDocument: String(lire_(row, map, 'TYPE_DOCUMENT') || ''),
      referenceDocument: String(lire_(row, map, 'REFERENCE_DOCUMENT') || ''),
      proprietaire: String(lire_(row, map, 'PROPRIETAIRE') || ''),
      actif: estOui_(lire_(row, map, 'ACTIF'))
    });
  }
  return out;
}

function getProcessusItem_(id) {
  const liste = getProcessus();
  for (let i = 0; i < liste.length; i++) if (liste[i].id === id) return liste[i];
  return null;
}

/**
 * Interactions simples entre processus, pour un diagramme minimal cote
 * client : chaque processus racine avec ses enfants directs, sur 3 niveaux
 * au plus. Une liste suffit (pas de librairie de diagramme dans ce lot).
 */
function getInteractionsProcessus_() {
  const tous = getProcessus();
  const parId = {};
  tous.forEach(function (p) { parId[p.id] = p; });
  const racines = tous.filter(function (p) { return isBlank(p.idParent); });
  return racines.map(function (racine) {
    const enfants = tous.filter(function (p) { return p.idParent === racine.id; });
    return {
      id: racine.id,
      nom: racine.nom,
      enfants: enfants.map(function (e) {
        const petitsEnfants = tous.filter(function (p) { return p.idParent === e.id; });
        return { id: e.id, nom: e.nom, enfants: petitsEnfants.map(function (pe) {
          return { id: pe.id, nom: pe.nom };
        }) };
      })
    };
  });
}

function getProcessusData() {
  return pourClient_({
    version: VERSION_SCRIPTS,
    user: profilUtilisateur_(),
    processus: getProcessus(),
    interactions: getInteractionsProcessus_(),
    niveaux: NIVEAUX_PROCESSUS,
    typesDocument: TYPES_DOCUMENT_PROCESSUS,
    utilisateurs: listerUtilisateurs_()
  });
}

// ---------------------------------------------------------------- //
// Ecriture : creation ou mise a jour en place
// ---------------------------------------------------------------- //

function ecrireLigneProcessus_(row, map, data) {
  const sheet = getSheet(SHEETS.PROCESSUS);
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

  ecrire('ID_PROCESSUS_PARENT', data.idParent || '');
  ecrire('NIVEAU', data.niveau || '');
  ecrire('NOM_PROCESSUS', data.nom || '');
  ecrire('DESCRIPTION', data.description || '');
  ecrire('TYPE_DOCUMENT', data.typeDocument || '');
  ecrire('REFERENCE_DOCUMENT', data.referenceDocument || '');
  ecrire('PROPRIETAIRE', data.proprietaire || '');
  ecrire('ACTIF', data.actif === false ? 'Non' : 'Oui');

  let debut = 0;
  while (debut < nCols) {
    if (formules[debut] && String(formules[debut]).charAt(0) === '=') { debut++; continue; }
    let fin = debut;
    while (fin + 1 < nCols && !(formules[fin + 1] && String(formules[fin + 1]).charAt(0) === '=')) fin++;
    sheet.getRange(row, debut + 1, 1, fin - debut + 1).setValues([values.slice(debut, fin + 1)]);
    debut = fin + 1;
  }
}

/**
 * La hierarchie est bornee a 3 niveaux : un Sous-processus doit avoir un
 * parent de niveau Processus, une Activité un parent de niveau
 * Sous-processus. Un Processus (niveau racine) ne porte pas de parent.
 */
function validerHierarchieProcessus_(data) {
  if (isBlank(data.nom)) throw new Error('Le nom du processus est obligatoire.');
  if (NIVEAUX_PROCESSUS.indexOf(data.niveau) === -1) {
    throw new Error('Le niveau doit être l’un des suivants : ' + NIVEAUX_PROCESSUS.join(', ') + '.');
  }
  const rang = rangNiveauProcessus_(data.niveau);

  if (rang === 1) {
    if (!isBlank(data.idParent)) {
      throw new Error('Un élément de niveau "Processus" est un niveau racine : il ne peut pas avoir de parent.');
    }
    return;
  }

  if (isBlank(data.idParent)) {
    throw new Error('Un élément de niveau "' + data.niveau + '" doit être rattaché à un parent.');
  }
  if (data.idParent === data.id) {
    throw new Error('Un processus ne peut pas être son propre parent.');
  }
  const parent = getProcessusItem_(data.idParent);
  if (!parent) throw new Error('Processus parent introuvable : ' + data.idParent);
  if (rangNiveauProcessus_(parent.niveau) !== rang - 1) {
    throw new Error('Le parent d’un élément "' + data.niveau + '" doit être de niveau "' +
      NIVEAUX_PROCESSUS[rang - 2] + '" (parent actuel : "' + parent.niveau + '"). ' +
      'La hiérarchie est limitée à 3 niveaux : Processus > Sous-processus > Activité.');
  }
}

function saveProcessus(data) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  try {
    validerHierarchieProcessus_(data);
    const sheet = getSheet(SHEETS.PROCESSUS);
    const map = mapProcessus();
    const colId = exigerColonne_(map, 'ID_PROCESSUS', SHEETS.PROCESSUS);

    let row, id;
    if (!isBlank(data.id)) {
      row = findRowById(sheet, colId, data.id);
      if (row === -1) throw new Error('Processus introuvable : ' + data.id);
      id = data.id;
    } else {
      row = findFirstEmptyRow(sheet, colId);
      id = generateId(PREFIX_ID_PROCESSUS, sheet, colId);
      sheet.getRange(row, colId).setValue(id);
    }

    ecrireLigneProcessus_(row, map, data);
    return pourClient_({ id: id, processus: getProcessus(), interactions: getInteractionsProcessus_() });
  } finally {
    lock.releaseLock();
  }
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_07_Processus_() { return 'v10'; }
