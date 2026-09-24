/**
 * =====================================================================
 *  FICHIER  : 20_Validation           type : Script (.gs)
 *  SECTION  : MENU 2 · Validation des évaluations
 *             > Ouvrir la fiche de validation  -> openValidation
 *  VA AVEC  : UI_Validation (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * File des evaluations en attente, validation et renvoi pour revision.
 * La decision est portee par la ligne de l'evaluation : statut, validateur,
 * date de validation et commentaire. Rien n'est efface.
 */

function openValidation() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_Validation', 'Validation des évaluations', 1180, 800);
}

// ---------------------------------------------------------------- //
// Donnees appelees par la fiche
// ---------------------------------------------------------------- //

/**
 * Tout ce dont la fiche a besoin, en un seul appel : la file d'attente, les
 * echelles pour afficher les definitions, les droits du validateur.
 */
function getValidationData() {
  return pourClient_({
    version: VERSION_SCRIPTS,
    user: profilUtilisateur_(),
    champs: lireChampsFormulaire('VALIDATION'),
    seuils: seuilsNiveau_(),
    references: getReferentiels(),
    config: getConfigParams(),
    file: getFileValidation()
  });
}

/**
 * Rafraichissement de la seule file, apres un conflit.
 */
function getFileValidationSeule() {
  return pourClient_(getFileValidation());
}

function validerEvaluation(idEval, commentaire) {
  const email = getCurrentUser();
  const user = validateUser(email);
  if (!user.peutValider) throw new Error(email + " n'a pas les droits de validation.");
  if (champObligatoire_('VALIDATION', 'commentaire') && isBlank(commentaire)) {
    throw new Error('Le commentaire du validateur est obligatoire pour valider (paramétrage CONFIG).');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  try {
    const res = ecrireDecisionValidation_(idEval, STATUT_VALIDEE, email, commentaire);
    rafraichirSynthese();
    return pourClient_(res);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Renvoi au proprietaire pour recotation. L'evaluation reste dans la base,
 * elle change seulement de statut.
 */
function renvoyerPourRevision(idEval, motif) {
  const email = getCurrentUser();
  const user = validateUser(email);
  if (!user.peutValider) throw new Error(email + " n'a pas les droits de validation.");
  if (champObligatoire_('VALIDATION', 'motif') && isBlank(motif)) {
    throw new Error('Le motif du renvoi est obligatoire. Il part au propriétaire du risque, ' +
      'il doit lui dire quoi revoir.');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé, réessayez dans quelques secondes.');
  }
  try {
    const res = ecrireDecisionValidation_(idEval, STATUT_A_REVISER, email, motif);
    rafraichirSynthese();
    return pourClient_(res);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- //
// File d'attente
// ---------------------------------------------------------------- //

function estEnAttente_(statut) {
  const n = normalizeText(statut);
  const initial = normalizeText(getConfigParams()['STATUT_INITIAL_EVALUATION'] || DEFAUT_STATUT_EVAL);
  return n === '' || n === initial || n === normalizeText(DEFAUT_STATUT_EVAL);
}

/**
 * Evaluations en attente, de la plus ancienne a la plus recente, avec tout
 * le detail necessaire a la fiche du validateur.
 */
function getFileValidation() {
  const map = mapRisques();
  const values = lireToutesLesLignes_();
  if (!values.length) return [];

  const axes = getReferentiels().impact.axes;
  const colsInh = colonnesImpact_(SHEETS.RISQUES, axes, 'inh');
  const colsRes = colonnesImpact_(SHEETS.RISQUES, axes, 'res');

  const compte = {};
  for (let i = 0; i < values.length; i++) {
    const id = lire_(values[i], map, 'ID_RISQUE');
    if (!isBlank(id) && ligneCotee_(values[i], map)) compte[id] = (compte[id] || 0) + 1;
  }

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (isBlank(lire_(row, map, 'ID_EVAL'))) continue;
    if (!estEnAttente_(lire_(row, map, 'STATUT_EVAL'))) continue;
    if (!ligneCotee_(row, map)) continue;   // une ligne sans cotation n'a rien a valider

    const fiche = {};
    CHAMPS_FICHE.forEach(function (cle) { fiche[CLES_FICHE[cle]] = lire_(row, map, cle) || ''; });

    out.push({
      ligne: DATA_START_ROW + i,
      idEval: lire_(row, map, 'ID_EVAL'),
      idRisque: lire_(row, map, 'ID_RISQUE'),
      date: lire_(row, map, 'DATE_EVAL'),
      type: lire_(row, map, 'TYPE_EVAL'),
      evaluateur: lire_(row, map, 'EVALUATEUR'),
      nbEvaluations: compte[lire_(row, map, 'ID_RISQUE')] || 1,
      fiche: fiche,
      inherent: {
        p: lire_(row, map, 'PROBA_INH'),
        impacts: colsInh.map(function (c) { return row[c - 1]; }),
        retenu: lire_(row, map, 'IMPACT_RETENU_INH'),
        score: lire_(row, map, 'SCORE_INH'),
        niveau: lire_(row, map, 'NIVEAU_INH')
      },
      residual: {
        p: lire_(row, map, 'PROBA_RES'),
        impacts: colsRes.map(function (c) { return row[c - 1]; }),
        retenu: lire_(row, map, 'IMPACT_RETENU_RES'),
        score: lire_(row, map, 'SCORE_RES'),
        niveau: lire_(row, map, 'NIVEAU_RES'),
        justif: lire_(row, map, 'JUSTIF_PROBA_RES')
      },
      mastery: {
        mes: lire_(row, map, 'MESURES_GLOBALES'),
        justif: lire_(row, map, 'JUSTIF_MAITRISE'),
        globale: lire_(row, map, 'MAITRISE_GLOBALE'),
        l1: { n: lire_(row, map, 'L1_NOTE'), txt: lire_(row, map, 'L1_MESURES') },
        l2: { n: lire_(row, map, 'L2_NOTE'), txt: lire_(row, map, 'L2_MESURES') },
        l3: { n: lire_(row, map, 'L3_NOTE'), txt: lire_(row, map, 'L3_MESURES') }
      },
      dyn: {
        velo: lire_(row, map, 'VELOCITY'),
        pers: lire_(row, map, 'PERSISTENCE'),
        tend: lire_(row, map, 'TENDANCE')
      },
      appetence: lire_(row, map, 'APPETENCE_SEUIL'),
      position: lire_(row, map, 'POSITION_APPETENCE'),
      decision: lire_(row, map, 'DECISION'),
      justifDecision: lire_(row, map, 'JUSTIF_DECISION'),
      actions: lire_(row, map, 'ACTIONS_ASSOCIEES')
    });
  }
  return out;
}

/**
 * Ecrit une decision sur la ligne de l'evaluation. statutParDefaut vaut
 * STATUT_VALIDEE ou STATUT_A_REVISER ; le libelle exact vient de la liste
 * de REF_REFERENTIELS.
 */
function ecrireDecisionValidation_(idEval, statutParDefaut, validateur, commentaire) {
  const sheet = getSheet(SHEETS.RISQUES);
  const map = mapRisques();
  const colStatut = exigerColonne_(map, 'STATUT_EVAL', SHEETS.RISQUES);
  const row = findRowById(sheet, exigerColonne_(map, 'ID_EVAL', SHEETS.RISQUES), idEval);
  if (row === -1) throw new Error('Évaluation introuvable : ' + idEval);

  const statutActuel = sheet.getRange(row, colStatut).getValue();
  if (!estEnAttente_(statutActuel)) {
    throw new Error("L'évaluation " + idEval + ' a déjà été traitée (statut : ' +
      statutActuel + '). La file a été rafraîchie.');
  }

  const evaluateur = sheet.getRange(row, exigerColonne_(map, 'EVALUATEUR', SHEETS.RISQUES)).getValue();
  validateMakerChecker(evaluateur, validateur);

  const statut = libelleStatut_(statutParDefaut);
  try {
    sheet.getRange(row, colStatut).setValue(statut);
  } catch (e) {
    throw messageValidationDonnees_(e, 'La décision n’a pas été enregistrée');
  }
  if (map.VALIDATEUR) sheet.getRange(row, map.VALIDATEUR).setValue(validateur);
  if (map.DATE_VALIDATION) sheet.getRange(row, map.DATE_VALIDATION).setValue(getCurrentTimestamp());

  if (!isBlank(commentaire)) {
    if (map.COMMENTAIRE_VALIDATION) {
      sheet.getRange(row, map.COMMENTAIRE_VALIDATION).setValue(commentaire);
    } else if (map.JUSTIF_DECISION) {
      // Classeur non mis a niveau : le commentaire rejoint la justification.
      const cell = sheet.getRange(row, map.JUSTIF_DECISION);
      const prefixe = normalizeText(statut) === normalizeText(STATUT_A_REVISER)
        ? '[Renvoi pour révision] ' : '[Validation] ';
      cell.setValue((cell.getValue() || '') + '\n' + prefixe + commentaire);
    }
  }
  oublierLignes_();
  return { idEval: idEval, statut: statut, ligne: row };
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_20_Validation_() { return 'v10'; }
