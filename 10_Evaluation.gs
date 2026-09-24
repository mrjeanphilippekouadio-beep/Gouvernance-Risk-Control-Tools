/**
 * =====================================================================
 *  FICHIER  : 10_Evaluation           type : Script (.gs)
 *  SECTION  : MENU 1 · Évaluation des risques
 *             > Réévaluer un risque existant   -> openRiskAssessment
 *             > Évaluer un nouveau risque      -> openNewRiskAssessment
 *  VA AVEC  : UI_Evaluation (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * Ouverture du formulaire, donnees de depart, reprise de la derniere
 * evaluation, controles et enregistrement d'une nouvelle ligne dans RISQUES.
 * Toute fonction appelee par le formulaire renvoie ses donnees par
 * pourClient_ : c'est ce qui evite le formulaire vide.
 */

const REF_ENTETES = {
  ENTITE: 'ENTITE', PAYS: 'PAYS', CATEGORIE_RISQUE: 'CATEGORIE_RISQUE',
  SOUS_CATEGORIE_RISQUE: 'SOUS_CATEGORIE_RISQUE', TYPE_EVAL_RISQUE: 'TYPE_EVAL_RISQUE',
  TENDANCE: 'TENDANCE', REPONSE_RISQUE: 'REPONSE_RISQUE'
};

const TENDANCE_DEFAUT = 'Nouvelle';

// ---------------------------------------------------------------- //
// Ouverture depuis le menu
// ---------------------------------------------------------------- //

function openRiskAssessment() { ouvrirEvaluation_('existing'); }

function openNewRiskAssessment() { ouvrirEvaluation_('new'); }

function ouvrirEvaluation_(mode) {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_Evaluation', 'Évaluation des risques', 1180, 780, { modeInitial: mode });
}

// ---------------------------------------------------------------- //
// Donnees appelees par le formulaire
// ---------------------------------------------------------------- //

function getInitialData() {
  const tendances = getReferentielColumn(REF_ENTETES.TENDANCE).map(String)
    .filter(function (t) { return normalizeText(t) !== normalizeText(TENDANCE_DEFAUT); });

  return pourClient_({
    version: VERSION_SCRIPTS,
    user: profilUtilisateur_(),
    methodology: { version: getActiveMethodologyVersion() },
    tendanceDefaut: TENDANCE_DEFAUT,
    // Bloc 4 de CONFIG : le formulaire applique le meme parametrage que le
    // serveur, sinon un champ passe a Non resterait bloquant a l'ecran.
    champs: lireChampsFormulaire('EVALUATION'),
    seuils: seuilsNiveau_(),
    risks: getRisks(),
    references: getReferentiels(),
    config: getConfigParams(),
    lists: {
      entites: getReferentielColumn(REF_ENTETES.ENTITE),
      pays: getReferentielColumn(REF_ENTETES.PAYS),
      categories: getReferentielColumn(REF_ENTETES.CATEGORIE_RISQUE),
      sousCategories: getReferentielColumn(REF_ENTETES.SOUS_CATEGORIE_RISQUE),
      typesEval: getReferentielColumn(REF_ENTETES.TYPE_EVAL_RISQUE),
      tendances: tendances,
      decisions: getReferentielColumn(REF_ENTETES.REPONSE_RISQUE)
    }
  });
}

/**
 * Fiche du risque et derniere evaluation, pour le pre-remplissage.
 * derniere.cotee vaut false pour une ligne migree jamais cotee : le
 * formulaire reprend alors la fiche mais repart d'une cotation vierge.
 */
function getRiskWithLatestEvaluation(riskId) {
  const risk = getRisk(riskId);
  if (!risk) throw new Error('Risque introuvable : ' + riskId);
  const ev = getLatestEvaluation(riskId);
  const axes = getReferentiels().impact.axes;

  let derniere = null;
  if (ev) {
    const colsInh = colonnesImpact_(SHEETS.RISQUES, axes, 'inh');
    const colsRes = colonnesImpact_(SHEETS.RISQUES, axes, 'res');
    const ligne = ev.ligne;

    derniere = {
      id: ev.ID_EVAL,
      date: ev.DATE_EVAL,
      type: ev.TYPE_EVAL,
      evaluateur: ev.EVALUATEUR,
      statut: ev.STATUT_EVAL,
      cotee: ev.cotee,
      validateur: ev.VALIDATEUR,
      dateValidation: ev.DATE_VALIDATION,
      commentaireValidation: ev.COMMENTAIRE_VALIDATION,
      inherent: {
        p: ev.PROBA_INH,
        impacts: colsInh.map(function (c) { return ligne[c - 1]; }),
        score: ev.SCORE_INH, niveau: ev.NIVEAU_INH
      },
      residual: {
        p: ev.PROBA_RES,
        impacts: colsRes.map(function (c) { return ligne[c - 1]; }),
        score: ev.SCORE_RES, niveau: ev.NIVEAU_RES,
        justif: ev.JUSTIF_PROBA_RES
      },
      mastery: {
        mes: ev.MESURES_GLOBALES, justif: ev.JUSTIF_MAITRISE,
        l1: { n: ev.L1_NOTE, txt: ev.L1_MESURES },
        l2: { n: ev.L2_NOTE, txt: ev.L2_MESURES },
        l3: { n: ev.L3_NOTE, txt: ev.L3_MESURES }
      },
      dyn: { velo: ev.VELOCITY, pers: ev.PERSISTENCE, tend: ev.TENDANCE },
      appet: ev.APPETENCE_SEUIL,
      dec: ev.DECISION, decJustif: ev.JUSTIF_DECISION, actions: ev.ACTIONS_ASSOCIEES
    };
  }

  return pourClient_({ risk: risk, nbEvaluations: ev ? ev.nbEvaluations : 0, derniere: derniere });
}

function getAppetenceProposal(sousCategorie, entite) {
  if (isBlank(sousCategorie)) return null;
  const a = resolveAppetence(sousCategorie, entite);
  return pourClient_(a ? { value: Number(a.scorePlafond), source: a.source } : null);
}

// ---------------------------------------------------------------- //
// Enregistrement
// ---------------------------------------------------------------- //

/**
 * Trois protections :
 *   1. verrou de classeur, contre deux saisies simultanees ;
 *   2. jeton d'idempotence, contre le double clic et le renvoi reseau ;
 *   3. signature de contenu, contre la double saisie du meme jour.
 */
function saveAssessment(formData) {
  const cache = CacheService.getUserCache();
  const jeton = formData && formData.requestId ? String(formData.requestId) : '';
  if (jeton && cache.get(jeton)) {
    throw new Error("Cet enregistrement a déjà été envoyé. Aucune ligne n'a été ajoutée.");
  }

  // Sans effet si le classeur est deja au niveau v9 ; sinon il y est mis
  // avant la premiere ecriture, pour que les listes deroulantes acceptent les cotations.
  assurerNiveauClasseur_();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Le classeur est occupé par une autre saisie, réessayez dans quelques secondes.');
  }

  try {
    const email = getCurrentUser();
    const user = validateUser(email);
    if (!user.peutEvaluer) throw new Error(email + " n'a pas les droits d'évaluation.");

    const axes = getReferentiels().impact.axes;

    validateAssessment_({
      mode: formData.mode,
      idRisque: formData.riskId,
      fiche: formData.fiche,
      typeEval: formData.typeEval,
      inherent: formData.inherent,
      residual: formData.residual,
      mastery: formData.mastery,
      dynamics: formData.dynamics,
      appetence: formData.appetence,
      decision: formData.decision
    }, axes);

    const riskId = formData.mode === 'new' ? createRisk_() : formData.riskId;

    let appetence = null;
    if (!isBlank(formData.appetence)) {
      appetence = { value: Number(formData.appetence), source: 'saisi' };
    } else {
      const auto = resolveAppetence(formData.fiche.sousCategorie, formData.fiche.entite);
      if (auto) appetence = { value: Number(auto.scorePlafond), source: auto.source };
    }

    const payload = {
      idRisque: riskId,
      fiche: formData.fiche,
      axes: axes,
      typeEval: formData.typeEval,
      evaluateur: email,
      inherent: formData.inherent,
      mastery: formData.mastery,
      residual: formData.residual,
      dynamics: formData.dynamics,
      appetence: appetence ? appetence.value : '',
      decision: formData.decision,
      versionMethodologie: getActiveMethodologyVersion()
    };

    if (formData.mode !== 'new') {
      const doublon = doublonDuJour_(payload);
      if (doublon) {
        throw new Error('Une évaluation identique a déjà été enregistrée aujourd’hui pour ce ' +
          'risque (' + doublon + '), avec le même type et les mêmes cotations. Modifiez une valeur, ' +
          'ou revenez-y à la prochaine revue.');
      }
    }

    let evaluation;
    try {
      evaluation = insertEvaluation_(payload);
    } catch (e) {
      throw messageValidationDonnees_(e, "L'évaluation n'a pas été enregistrée");
    }
    if (jeton) cache.put(jeton, '1', DUREE_JETON_SECONDES);

    rafraichirSynthese();

    return pourClient_({
      idRisque: riskId,
      idEvaluation: evaluation.ID_EVAL,
      statut: evaluation.STATUT_EVAL,
      scoreInherent: evaluation.SCORE_INH,
      niveauInherent: evaluation.NIVEAU_INH,
      scoreResiduel: evaluation.SCORE_RES,
      niveauResiduel: evaluation.NIVEAU_RES,
      appetenceSource: appetence ? appetence.source : 'non définie',
      // Liste a jour : le formulaire revient a l'accueil avec les nouveaux scores
      risks: getRisks()
    });
  } finally {
    lock.releaseLock();
  }
}

function createRisk_() {
  const sheet = getSheet(SHEETS.RISQUES);
  const map = mapRisques();
  return generateId(PREFIX_ID_RISQUE, sheet, exigerColonne_(map, 'ID_RISQUE', SHEETS.RISQUES));
}

// ---------------------------------------------------------------- //
// Controles serveur : ils rejugent la saisie, le formulaire peut etre contourne
// ---------------------------------------------------------------- //

function controlerNote1a5_(value, label) {
  const n = Number(value);
  if (isNaN(n) || n < 1 || n > 5 || Math.floor(n) !== n) {
    throw new Error(label + ' invalide, valeur attendue entre 1 et 5.');
  }
}

/**
 * Valeur d'un champ logique, pour le controle d'obligation. Miroir exact de
 * valeurChamp() dans UI_Evaluation : les deux jugent la saisie de la meme
 * facon. Un seul endroit a completer si un champ est ajoute au formulaire.
 */
function valeurChamp_(cle, data, axes) {
  const f = data.fiche || {}, m = data.mastery || {}, d = data.dynamics || {},
        dec = data.decision || {}, inh = data.inherent || {}, res = data.residual || {};
  switch (cle) {
    case 'intitule': case 'categorie': case 'processus': case 'entite': case 'pays':
    case 'departement': case 'sousCategorie': case 'objectif': case 'description':
    case 'causes': case 'consequences': case 'proprietaire': case 'controles': case 'kri':
      return f[cle];
    case 'typeEval': return data.typeEval;
    case 'probaInherente': return inh.probability;
    case 'probaResiduelle': return res.probability;
    case 'justifProbaResiduelle': return res.justification;
    case 'impactsInherents':
      return (inh.impacts || []).filter(function (v) { return !isBlank(v); }).length === axes.length ? 'ok' : '';
    case 'impactsResiduels':
      return (res.impacts || []).filter(function (v) { return !isBlank(v); }).length === axes.length ? 'ok' : '';
    case 'mesures': return m.measures;
    case 'justifMaitrise': return m.justification;
    case 'lignesDefense':
      return ['l1', 'l2', 'l3'].every(function (k) {
        return !isBlank(m[k + 'Note']) || m[k + 'Na'] === true;
      }) ? 'ok' : '';
    case 'velocite': return d.velocity;
    case 'persistance': return d.persistence;
    case 'tendance': return d.trend;
    case 'appetence': return data.appetence;
    case 'decision': return dec.treatment;
    case 'justifDecision': return dec.justification;
    case 'actions': return dec.actions;
    default: return 'ok';   // champ inconnu du code : on ne bloque pas
  }
}

function validateChampsObligatoires_(data, axes) {
  const manquants = [];
  lireChampsFormulaire('EVALUATION').forEach(function (c) {
    if (!c.obligatoire) return;
    if (isBlank(valeurChamp_(c.champ, data, axes))) manquants.push(c.libelle);
  });
  if (manquants.length === 1) throw new Error(manquants[0] + ' : champ obligatoire.');
  if (manquants.length > 1) {
    throw new Error(manquants.length + ' champs obligatoires ne sont pas renseignés : ' +
      manquants.join(', ') + '.');
  }
}

function validateAssessment_(data, axes) {
  if (!data.fiche) throw new Error('Fiche du risque manquante.');
  data.inherent = data.inherent || {};
  data.residual = data.residual || {};

  // Les champs obligatoires sont declares dans CONFIG, bloc 4.
  validateChampsObligatoires_(data, axes);

  if (data.mode !== 'new') {
    if (isBlank(data.idRisque)) throw new Error('Identifiant du risque obligatoire.');
    if (getRisk(data.idRisque) === null) {
      throw new Error('Le risque ' + data.idRisque + " n'existe pas dans la base.");
    }
  }

  // Coherence, independante du parametrage : une cotation saisie reste dans
  // son echelle, qu'elle soit obligatoire ou non.
  if (!isBlank(data.inherent.probability)) controlerNote1a5_(data.inherent.probability, 'Probabilité inhérente');
  if (!isBlank(data.residual.probability)) controlerNote1a5_(data.residual.probability, 'Probabilité résiduelle');
  (data.inherent.impacts || []).forEach(function (v, i) {
    if (!isBlank(v)) controlerNote1a5_(v, 'Impact inhérent (' + (axes[i] || ('axe ' + (i + 1))) + ')');
  });
  (data.residual.impacts || []).forEach(function (v, i) {
    if (!isBlank(v)) controlerNote1a5_(v, 'Impact résiduel (' + (axes[i] || ('axe ' + (i + 1))) + ')');
  });
  const m = data.mastery || {};
  ['l1', 'l2', 'l3'].forEach(function (k) {
    const note = m[k + 'Note'];
    if (!isBlank(note) && (Number(note) < 1 || Number(note) > 3)) {
      throw new Error('Note de maîtrise ' + k.toUpperCase() + ' invalide, valeur attendue entre 1 et 3.');
    }
  });
}

// ---------------------------------------------------------------- //
// Doublon du jour
// ---------------------------------------------------------------- //

function signatureEvaluation_(data) {
  const m = data.mastery || {};
  const nombres = function (arr) {
    return (arr || []).map(function (v) { return isBlank(v) ? '' : Number(v); }).join('-');
  };
  const n = function (v) { return isBlank(v) ? '' : Number(v); };
  return [data.idRisque, normalizeText(data.typeEval),
    n(data.inherent.probability), nombres(data.inherent.impacts),
    n(data.residual.probability), nombres(data.residual.impacts),
    n(m.l1Note), n(m.l2Note), n(m.l3Note),
    normalizeText((data.decision || {}).treatment), n(data.appetence)].join('|');
}

function memeJour_(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function doublonDuJour_(data) {
  const map = mapRisques();
  const values = lireToutesLesLignes_();
  const axes = data.axes || [];
  const cible = signatureEvaluation_(data);
  const aujourdhui = new Date();
  const colsInh = colonnesImpact_(SHEETS.RISQUES, axes, 'inh');
  const colsRes = colonnesImpact_(SHEETS.RISQUES, axes, 'res');

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (lire_(row, map, 'ID_RISQUE') !== data.idRisque) continue;
    if (!memeJour_(lire_(row, map, 'DATE_EVAL'), aujourdhui)) continue;

    const ligne = signatureEvaluation_({
      idRisque: lire_(row, map, 'ID_RISQUE'),
      typeEval: lire_(row, map, 'TYPE_EVAL'),
      inherent: { probability: lire_(row, map, 'PROBA_INH'),
        impacts: colsInh.map(function (c) { return row[c - 1]; }) },
      residual: { probability: lire_(row, map, 'PROBA_RES'),
        impacts: colsRes.map(function (c) { return row[c - 1]; }) },
      mastery: { l1Note: lire_(row, map, 'L1_NOTE'), l2Note: lire_(row, map, 'L2_NOTE'),
        l3Note: lire_(row, map, 'L3_NOTE') },
      decision: { treatment: lire_(row, map, 'DECISION') },
      appetence: lire_(row, map, 'APPETENCE_SEUIL')
    });
    if (ligne === cible) return lire_(row, map, 'ID_EVAL');
  }
  return null;
}

// ---------------------------------------------------------------- //
// Ecriture de la ligne
// ---------------------------------------------------------------- //

function nombreOuVide_(v) {
  if (isBlank(v)) return '';
  const n = Number(v);
  return isNaN(n) ? v : n;
}

/**
 * Insertion d'une evaluation. La ligne cible est relue : les colonnes qui
 * portent une formule dans le classeur ne sont pas touchees, seules les
 * autres sont ecrites. Les cotations partent en nombres, comme les listes
 * deroulantes de REF_REFERENTIELS apres la mise a niveau.
 */
function insertEvaluation_(data) {
  const sheet = getSheet(SHEETS.RISQUES);
  const map = mapRisques();
  const axes = data.axes || [];

  const colIdEval = exigerColonne_(map, 'ID_EVAL', SHEETS.RISQUES);
  const row = findFirstEmptyRow(sheet, colIdEval);
  const idEval = generateId(PREFIX_ID_EVAL, sheet, colIdEval);
  const now = getCurrentTimestamp();

  const nCols = Math.max(sheet.getLastColumn(), 1);
  const plage = sheet.getRange(row, 1, 1, nCols);
  const values = plage.getValues()[0];
  const formules = plage.getFormulas()[0];
  function ecrireCol(c, valeur) {
    if (!c) return;
    if (formules[c - 1] && String(formules[c - 1]).charAt(0) === '=') return;
    values[c - 1] = (valeur === null || valeur === undefined) ? '' : valeur;
  }
  function ecrire(cle, valeur) { ecrireCol(map[cle], valeur); }

  ecrire('ID_EVAL', idEval);
  ecrire('ID_RISQUE', data.idRisque);
  ecrire('DATE_EVAL', now);
  ecrire('TYPE_EVAL', data.typeEval || '');
  ecrire('EVALUATEUR', data.evaluateur);

  // Fiche telle qu'editee dans le formulaire : c'est elle qui fait foi.
  const f = data.fiche || {};
  CHAMPS_FICHE.forEach(function (cle) { ecrire(cle, f[CLES_FICHE[cle]] || ''); });

  const inhImpacts = (data.inherent.impacts || []).map(nombreOuVide_);
  const resImpacts = (data.residual.impacts || []).map(nombreOuVide_);

  const colsInh = colonnesImpact_(SHEETS.RISQUES, axes, 'inh');
  ecrire('PROBA_INH', nombreOuVide_(data.inherent.probability));
  for (let i = 0; i < colsInh.length; i++) ecrireCol(colsInh[i], inhImpacts[i]);
  const impInh = calculateSelectedImpact(inhImpacts);
  const scoreInh = calculateScore(data.inherent.probability, impInh);
  ecrire('IMPACT_RETENU_INH', impInh);
  ecrire('SCORE_INH', scoreInh);
  ecrire('NIVEAU_INH', calculateRiskLevel(scoreInh));

  const m = data.mastery || {};
  ecrire('MESURES_GLOBALES', m.measures || '');
  ecrire('L1_MESURES', m.l1Mesures || '');
  ecrire('L1_NOTE', nombreOuVide_(m.l1Note));
  ecrire('L2_MESURES', m.l2Mesures || '');
  ecrire('L2_NOTE', nombreOuVide_(m.l2Note));
  ecrire('L3_MESURES', m.l3Mesures || '');
  ecrire('L3_NOTE', nombreOuVide_(m.l3Note));
  ecrire('MAITRISE_GLOBALE', calculateGlobalMastery(m.l1Note, m.l2Note, m.l3Note));
  ecrire('JUSTIF_MAITRISE', m.justification || '');

  const colsRes = colonnesImpact_(SHEETS.RISQUES, axes, 'res');
  ecrire('PROBA_RES', nombreOuVide_(data.residual.probability));
  ecrire('JUSTIF_PROBA_RES', data.residual.justification || '');
  for (let i = 0; i < colsRes.length; i++) ecrireCol(colsRes[i], resImpacts[i]);
  const impRes = calculateSelectedImpact(resImpacts);
  const scoreRes = calculateScore(data.residual.probability, impRes);
  ecrire('IMPACT_RETENU_RES', impRes);
  ecrire('SCORE_RES', scoreRes);
  ecrire('NIVEAU_RES', calculateRiskLevel(scoreRes));

  const d = data.dynamics || {};
  ecrire('VELOCITY', nombreOuVide_(d.velocity));
  ecrire('PERSISTENCE', nombreOuVide_(d.persistence));
  ecrire('TENDANCE', d.trend || '');

  const seuil = isBlank(data.appetence) ? '' : Number(data.appetence);
  ecrire('APPETENCE_SEUIL', seuil);
  ecrire('POSITION_APPETENCE', calculateAppetitePosition(scoreRes, seuil));

  const dec = data.decision || {};
  ecrire('DECISION', dec.treatment || '');
  ecrire('JUSTIF_DECISION', dec.justification || '');
  ecrire('ACTIONS_ASSOCIEES', dec.actions || '');

  const statut = libelleStatut_(getConfigParams()['STATUT_INITIAL_EVALUATION'] || DEFAUT_STATUT_EVAL);
  ecrire('VALIDATEUR', '');
  ecrire('DATE_VALIDATION', '');
  ecrire('COMMENTAIRE_VALIDATION', '');
  ecrire('STATUT_EVAL', statut);
  ecrire('VERSION_METHODO', data.versionMethodologie || DEFAUT_VERSION_METHODO);

  // Ecriture par tranches de colonnes SANS formule : les formules du classeur
  // ne sont jamais reecrites, quelle que soit la langue du classeur.
  let debut = 0;
  while (debut < nCols) {
    if (formules[debut] && String(formules[debut]).charAt(0) === '=') { debut++; continue; }
    let fin = debut;
    while (fin + 1 < nCols && !(formules[fin + 1] && String(formules[fin + 1]).charAt(0) === '=')) fin++;
    sheet.getRange(row, debut + 1, 1, fin - debut + 1).setValues([values.slice(debut, fin + 1)]);
    debut = fin + 1;
  }
  oublierLignes_();

  return {
    row: row,
    ID_EVAL: idEval,
    ID_RISQUE: data.idRisque,
    STATUT_EVAL: statut,
    SCORE_INH: scoreInh,
    NIVEAU_INH: calculateRiskLevel(scoreInh),
    SCORE_RES: scoreRes,
    NIVEAU_RES: calculateRiskLevel(scoreRes),
    MAITRISE_GLOBALE: calculateGlobalMastery(m.l1Note, m.l2Note, m.l3Note),
    POSITION_APPETENCE: calculateAppetitePosition(scoreRes, seuil)
  };
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_10_Evaluation_() { return 'v10'; }
