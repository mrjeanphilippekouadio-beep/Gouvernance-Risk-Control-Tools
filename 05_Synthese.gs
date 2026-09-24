/**
 * =====================================================================
 *  FICHIER  : 05_Synthese             type : Script (.gs)
 *  SECTION  : SOCLE COMMUN (appele apres chaque enregistrement)
 *             + menu Administration > Initialiser les vues
 *             + menu Administration > Appliquer les colonnes de la synthese
 *  VERSION  : v10
 * =====================================================================
 *
 * Pose les formules matricielles qui font vivre la synthese. Deux etages,
 * parce que Google Sheets n'enchaine pas deux formules matricielles sans
 * support intermediaire :
 *   _SOURCE_SYNTHESE  extrait la derniere evaluation de chaque risque,
 *                     toutes colonnes, dans l'ordre de RISQUES ;
 *   SYNTHESE_RISQUES  n'en garde que les colonnes declarees visibles dans
 *                     CONFIG (bloc 3), dans l'ordre demande.
 *
 * Les donnees restent calculees par formule, donc instantanees. Seule la
 * LISTE des colonnes est figee au moment de la pose : un changement dans
 * CONFIG demande un passage par le menu Administration.
 */

/**
 * SORT par date d'evaluation decroissante, puis SORTN garde la premiere
 * ligne de chaque identifiant de risque. Les positions de la date et de
 * l'identifiant sont lues dans les en-tetes, pas supposees.
 */
function formuleSourceSynthese_() {
  const sep = separateurFormule_();
  const feuille = getSheet(SHEETS.RISQUES);
  const map = mapRisques();
  const nom = refFeuille_(feuille.getName());
  const derniere = colonneLettre_(Math.max(feuille.getLastColumn(), 1));
  const colDate = exigerColonne_(map, 'DATE_EVAL', SHEETS.RISQUES);
  const colId = exigerColonne_(map, 'ID_RISQUE', SHEETS.RISQUES);
  const lettreId = colonneLettre_(colId);
  // Registre vide : cellule vide plutot qu'une erreur. Aucun IFERROR autour :
  // une formule qui ne peut pas se developper doit se voir.
  return '=IF(COUNTA(' + nom + '!' + lettreId + DATA_START_ROW + ':' + lettreId + ') = 0' + sep + ' ""' + sep +
    ' SORTN(SORT(FILTER(' + nom + '!A' + DATA_START_ROW + ':' + derniere + sep +
    ' ' + nom + '!' + lettreId + DATA_START_ROW + ':' + lettreId + ' <> "")' + sep + ' ' + colDate +
    sep + ' FALSE)' + sep + ' 9999' + sep + ' 2' + sep + ' ' + colId + sep + ' TRUE))';
}

/**
 * Pose la formule source. La feuille technique recoit aussi les en-tetes
 * de RISQUES, et autant de colonnes que RISQUES : une formule matricielle
 * a l'etroit refuse de se developper.
 */
function poserSource_() {
  const risques = getSheet(SHEETS.RISQUES);
  const src = getSheet(SHEETS.SOURCE);
  const nCols = Math.max(risques.getLastColumn(), 1);
  assurerTaille_(src, DATA_LAST_ROW, nCols);
  const entetes = risques.getRange(HEADER_ROW, 1, 1, nCols).getValues();
  src.getRange(HEADER_ROW, 1, 1, nCols).setValues(entetes);
  // Zone de sortie videe en entier : une seule valeur residuelle suffit a
  // empecher la formule matricielle de se developper.
  src.getRange(DATA_START_ROW, 1, DATA_LAST_ROW - DATA_START_ROW + 1, src.getMaxColumns()).clearContent();
  src.getRange(DATA_START_ROW, 1).setFormula(formuleSourceSynthese_());
}

function formuleDonneesSynthese_(colonnes) {
  const sep = separateurFormule_();
  const source = refFeuille_(getSheet(SHEETS.SOURCE).getName());
  const derniere = colonneLettre_(Math.max(getSheet(SHEETS.RISQUES).getLastColumn(), 1));
  const rangs = colonnes.map(function (c) { return c.rang; }).join(sep + ' ');
  return '=CHOOSECOLS(' + source + '!A' + DATA_START_ROW + ':' + derniere +
    DATA_LAST_ROW + sep + ' ' + rangs + ')';
}

/**
 * Reconstruit entierement la synthese : formules, formats, gel des volets.
 * A lancer apres toute modification du bloc 3 de CONFIG.
 */
function appliquerColonnesSynthese() {
  const nSource = Math.max(getSheet(SHEETS.RISQUES).getLastColumn(), 1);
  const toutes = lireColonnesSynthese().filter(function (c) { return c.visible; });
  const colonnes = toutes.filter(function (c) { return c.rang >= 1 && c.rang <= nSource; });
  if (!colonnes.length) {
    throw new Error('Aucune colonne visible dans CONFIG (bloc 3). Passez au moins une ligne ' +
      'à Oui, sinon la synthèse resterait vide.');
  }

  poserSource_();

  const syn = getSheet(SHEETS.SYNTHESE);
  assurerTaille_(syn, DATA_LAST_ROW, colonnes.length);
  const maxCol = syn.getMaxColumns();

  // La ligne d'en-tetes est ecrite en VALEURS, pas en litteral matriciel :
  // le separateur de colonnes d'un litteral {..} depend de la locale, et un
  // litteral mal separe produit une colonne qui refuse de se developper.
  syn.getRange(HEADER_ROW, 1, 1, maxCol).clearContent();
  syn.getRange(DATA_START_ROW, 1, DATA_LAST_ROW - DATA_START_ROW + 1, maxCol).clearContent();

  syn.getRange(HEADER_ROW, 1, 1, colonnes.length)
    .setValues([colonnes.map(function (c) { return c.libelle; })]);
  syn.getRange(DATA_START_ROW, 1).setFormula(formuleDonneesSynthese_(colonnes));

  syn.getRange(HEADER_ROW, 1, 1, colonnes.length)
    .setFontWeight('bold').setWrap(true)
    .setBackground('#E2F0D9').setHorizontalAlignment('center');

  // CHOOSECOLS renvoie des numeros de serie pour les dates : on leur rend
  // un format de date lisible.
  colonnes.forEach(function (c, i) {
    if (normalizeHeader_(c.colonne).indexOf('date') === 0) {
      syn.getRange(DATA_START_ROW, i + 1, DATA_LAST_ROW - DATA_START_ROW + 1, 1)
        .setNumberFormat('dd/MM/yyyy');
    }
  });
  syn.setFrozenRows(HEADER_ROW);
  syn.setFrozenColumns(Math.min(2, colonnes.length));

  const ecartees = toutes.length - colonnes.length;
  SpreadsheetApp.getActiveSpreadsheet().toast(colonnes.length + ' colonne(s) appliquée(s) à la ' +
    'synthèse' + (ecartees ? ', ' + ecartees + ' ignorée(s) car hors de RISQUES' : '') + '.',
    'Synthèse', 5);
  return colonnes.length;
}

/**
 * Rafraichissement leger, appele apres chaque enregistrement : la source
 * est reposee si elle a ete effacee, sinon rien a faire, les formules
 * matricielles se recalculent seules.
 */
function rafraichirSynthese() {
  try {
    const src = getSheet(SHEETS.SOURCE);
    const f = src.getRange(DATA_START_ROW, 1).getFormula();
    if (!f || f.trim() === '') poserSource_();

    const syn = getSheet(SHEETS.SYNTHESE);
    const fs = syn.getRange(DATA_START_ROW, 1).getFormula();
    const entete = syn.getRange(HEADER_ROW, 1).getValue();
    if (!fs || fs.trim() === '' || isBlank(entete)) appliquerColonnesSynthese();

    SpreadsheetApp.flush();
  } catch (e) {
    Logger.log('Rafraîchissement de la synthèse impossible : ' + e.message);
  }
}

/**
 * Initialisation complete, a lancer une fois apres l'installation.
 */
function initialiserVues() {
  poserSource_();
  appliquerColonnesSynthese();
  SpreadsheetApp.getUi().alert(
    'Vues initialisées',
    'La feuille technique ' + SHEETS.SOURCE + ' et la synthèse sont en place.\n\n' +
    'Si la synthèse affiche une erreur de fonction inconnue, votre classeur ne dispose ' +
    'pas de CHOOSECOLS : prévenez l’administrateur, une variante par QUERY existe.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_05_Synthese_() { return 'v10'; }
