/**
 * =====================================================================
 *  FICHIER  : 04_Outils               type : Script (.gs)
 *  SECTION  : SOCLE COMMUN, indispensable quel que soit le menu utilise
 *  VERSION  : v10
 * =====================================================================
 *
 * Fonctions generiques, calculs de cotation, controles d'identite et
 * preparation des donnees envoyees aux formulaires.
 */

// ---------------------------------------------------------------- //
// Generiques
// ---------------------------------------------------------------- //

function getCurrentUser() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function getCurrentTimestamp() { return new Date(); }

function isBlank(value) {
  return value === null || value === undefined || value === '' ||
    (typeof value === 'string' && value.trim() === '');
}

function normalizeText(s) {
  if (isBlank(s)) return '';
  return s.toString().trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Tout ce qui part vers un formulaire passe par ici.
 *
 * google.script.run refuse les objets Date, y compris imbriques dans un
 * objet ou un tableau : la reponse entiere est alors perdue et le formulaire
 * s'ouvre vide. Or les dates d'evaluation et de validation lues dans RISQUES
 * sont des Date. Le passage par JSON les convertit en texte ISO, que les
 * formulaires savent afficher.
 */
function pourClient_(valeur) {
  if (valeur === undefined) return null;
  return JSON.parse(JSON.stringify(valeur));
}

function findFirstEmptyRow(sheet, idColIndex) {
  const values = sheet.getRange(DATA_START_ROW, idColIndex,
    DATA_LAST_ROW - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (isBlank(values[i][0])) return DATA_START_ROW + i;
  }
  throw new Error('Plus de ligne disponible dans ' + sheet.getName() +
    ' (limite ' + DATA_LAST_ROW + '). Étendez DATA_LAST_ROW dans 01_Parametres.');
}

function findRowById(sheet, idColIndex, id) {
  if (isBlank(id)) return -1;
  const values = sheet.getRange(DATA_START_ROW, idColIndex,
    DATA_LAST_ROW - DATA_START_ROW + 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === id) return DATA_START_ROW + i;
  }
  return -1;
}

function generateId(prefix, sheet, idColIndex) {
  const root = prefix + '-' + new Date().getFullYear() + '-';
  const values = sheet.getRange(DATA_START_ROW, idColIndex,
    DATA_LAST_ROW - DATA_START_ROW + 1, 1).getValues();
  let maxN = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i][0];
    if (typeof v === 'string' && v.indexOf(root) === 0) {
      const n = parseInt(v.substring(root.length), 10);
      if (!isNaN(n) && n > maxN) maxN = n;
    }
  }
  return root + ('000' + (maxN + 1)).slice(-3);
}

/**
 * Garantit qu'une feuille compte au moins ce nombre de lignes et de
 * colonnes. Google ne les ajoute pas seul : une formule matricielle ou une
 * ecriture qui depasse la grille echoue.
 */
function assurerTaille_(sheet, lignes, colonnes) {
  if (lignes && sheet.getMaxRows() < lignes) {
    sheet.insertRowsAfter(sheet.getMaxRows(), lignes - sheet.getMaxRows());
  }
  if (colonnes && sheet.getMaxColumns() < colonnes) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), colonnes - sheet.getMaxColumns());
  }
}

/**
 * Traduit le refus d'une liste deroulante en consigne actionnable.
 */
function messageValidationDonnees_(e, contexte) {
  const m = String(e && e.message ? e.message : e);
  if (/data validation|validation des donn|violates/i.test(m)) {
    return new Error(contexte + ' : une liste déroulante de la feuille ' + SHEETS.RISQUES +
      ' a refusé la valeur. Lancez Risk Management > Administration > Mettre à niveau ' +
      'le classeur, puis recommencez. Détail Google : ' + m);
  }
  return e instanceof Error ? e : new Error(m);
}

// ---------------------------------------------------------------- //
// Calculs de cotation. Les seuils viennent de CONFIG, jamais du code.
// ---------------------------------------------------------------- //

function calculateSelectedImpact(impacts) {
  const nums = (impacts || []).filter(function (v) { return !isBlank(v); }).map(Number);
  return nums.length ? Math.max.apply(null, nums) : null;
}

function calculateScore(probability, impact) {
  if (isBlank(probability) || isBlank(impact)) return null;
  return Number(probability) * Number(impact);
}

/**
 * Seuils de criticite de CONFIG, sous la forme [{min, max, label}].
 */
function seuilsNiveau_() {
  const source = getConfigParams()['SEUILS_NIVEAU'] || DEFAUT_SEUILS_NIVEAU;
  return String(source).split(';').map(function (part) {
    const bits = part.split(':');
    const range = bits[0].split('-').map(Number);
    return { min: range[0], max: range[1], label: String(bits[1] || '').trim() };
  }).filter(function (b) { return !isNaN(b.min) && !isNaN(b.max) && b.label; });
}

function calculateRiskLevel(score) {
  if (isBlank(score)) return '';
  const bands = seuilsNiveau_();
  for (let i = 0; i < bands.length; i++) {
    if (score >= bands[i].min && score <= bands[i].max) return bands[i].label;
  }
  return bands.length ? bands[bands.length - 1].label : '';
}

function calculateGlobalMastery(l1, l2, l3) {
  const values = [l1, l2, l3].filter(function (v) { return !isBlank(v); }).map(Number);
  if (values.length === 0) return '';
  const avg = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
  const rules = String(getConfigParams()['SEUILS_MAITRISE'] || DEFAUT_SEUILS_MAITRISE).split(';');
  for (let i = 0; i < rules.length; i++) {
    const m = rules[i].match(/^(>=|<)([0-9.]+):(.+)$/);
    if (!m) continue;
    const op = m[1], bound = parseFloat(m[2]), label = m[3];
    if ((op === '>=' && avg >= bound) || (op === '<' && avg < bound)) return label;
  }
  return '';
}

function calculateAppetitePosition(scoreResiduel, scorePlafond) {
  if (isBlank(scoreResiduel) || isBlank(scorePlafond)) return '';
  return Number(scoreResiduel) <= Number(scorePlafond) ? 'Dans l’appétence' : 'Hors appétence';
}

// ---------------------------------------------------------------- //
// Identite et separation des taches
// ---------------------------------------------------------------- //

function validateUser(email) {
  if (isBlank(email)) {
    throw new Error("Impossible d'identifier l'utilisateur connecté. " +
      'Vérifiez que vous utilisez votre compte Google Workspace Djamo.');
  }
  const user = findUserByEmail(email);
  if (!user) throw new Error('Utilisateur absent de la feuille ' + SHEETS.UTILISATEURS + ' : ' + email);
  if (!user.actif) throw new Error('Utilisateur inactif dans ' + SHEETS.UTILISATEURS + ' : ' + email);
  return user;
}

function validateMakerChecker(evaluateurEmail, validateurEmail) {
  if (!isBlank(evaluateurEmail) && !isBlank(validateurEmail) &&
    normalizeText(evaluateurEmail) === normalizeText(validateurEmail)) {
    throw new Error('Un évaluateur ne peut pas valider sa propre évaluation.');
  }
}

/**
 * Profil de l'utilisateur connecte, dans la forme attendue par les formulaires.
 */
function profilUtilisateur_() {
  const email = getCurrentUser();
  const user = email ? findUserByEmail(email) : null;
  return {
    email: email,
    nom: user ? user.nom : '',
    peutEvaluer: user ? user.peutEvaluer : false,
    peutValider: user ? user.peutValider : false,
    reconnu: !!user,
    actif: user ? user.actif : false
  };
}

/**
 * Liste complete des utilisateurs de UTILISATEURS (actifs et inactifs),
 * pour peupler les selects des modules v10 (exécuteur, valideur, manager,
 * pilote de risque...). Distincte de profilUtilisateur_, qui ne renvoie
 * que l'utilisateur courant.
 */
function listerUtilisateurs_() {
  const sheet = getSheet(SHEETS.UTILISATEURS);
  const map = mapUtilisateurs();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1,
    Math.max(sheet.getLastColumn(), 1)).getValues();

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const email = lire_(row, map, 'EMAIL');
    if (isBlank(email)) continue;
    out.push({
      email: String(email),
      nom: String(lire_(row, map, 'NOM') || ''),
      fonction: String(lire_(row, map, 'FONCTION') || ''),
      actif: estOui_(lire_(row, map, 'ACTIF'))
    });
  }
  return out;
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_04_Outils_() { return 'v10'; }
