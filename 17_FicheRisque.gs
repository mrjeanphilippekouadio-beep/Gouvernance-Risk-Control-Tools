/**
 * =====================================================================
 *  FICHIER  : 17_FicheRisque            type : Script (.gs)
 *  SECTION  : MENU 1 · Évaluation des risques (fiche 360°)
 *             > Fiche risque 360° -> openFicheRisque
 *  VA AVEC  : UI_FicheRisque (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * Page de LECTURE et d'agrégation uniquement : aucune nouvelle feuille,
 * aucune écriture. getFicheRisque(idRisque) assemble côté serveur tout ce
 * qui concerne un risque, à partir des fonctions déjà existantes :
 * getRisk()/getLatestEvaluation() (03_Lecture), l'historique complet des
 * lignes RISQUES pour ce risque, getControles() (11_Controles),
 * getExecutions() (12_Executions), getEvaluationsEfficacite() /
 * getDerniereEfficacite() (13_Efficacite), getAnomalies() (14_Anomalies),
 * getDepartements() (06_Departements), getJournalGlobal() (09_JournalGlobal).
 *
 * Un contrôle est lié si idRisque apparaît dans son RISQUES_COUVERTS ; une
 * anomalie est liée si son ID_RISQUE correspond, ou si elle référence un
 * contrôle déjà identifié comme lié à ce risque ; une exécution ou une
 * évaluation d'efficacité est liée si elle référence un de ces contrôles.
 */

function openFicheRisque() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_FicheRisque', 'Fiche risque 360°', 1200, 840);
}

/**
 * Un champ "objets liés" du classeur (Risques couverts, ID Risque...) peut
 * contenir plusieurs identifiants séparés par une virgule, un point-virgule
 * ou un retour à la ligne. Comparaison insensible à la casse et aux espaces.
 */
function idDansListe_(champ, id) {
  if (isBlank(champ) || isBlank(id)) return false;
  const cible = normalizeText(id);
  return String(champ).split(/[,;\n]+/).map(function (s) { return normalizeText(s.trim()); })
    .indexOf(cible) !== -1;
}

/**
 * Historique complet des évaluations d'un risque, de la plus ancienne à la
 * plus récente, toutes colonnes utiles à la fiche. Distinct de getRisk()
 * (03_Lecture), qui ne renvoie que l'état courant (dernière ligne).
 */
function getHistoriqueEvaluationsRisque_(idRisque) {
  const map = mapRisques();
  const values = lireToutesLesLignes_();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (lire_(values[i], map, 'ID_RISQUE') !== idRisque) continue;
    out.push({
      idEval: String(lire_(values[i], map, 'ID_EVAL') || ''),
      dateEval: lire_(values[i], map, 'DATE_EVAL') || '',
      typeEval: String(lire_(values[i], map, 'TYPE_EVAL') || ''),
      evaluateur: String(lire_(values[i], map, 'EVALUATEUR') || ''),
      probaInherente: lire_(values[i], map, 'PROBA_INH') || '',
      scoreInherent: lire_(values[i], map, 'SCORE_INH') || '',
      niveauInherent: String(lire_(values[i], map, 'NIVEAU_INH') || ''),
      maitriseGlobale: String(lire_(values[i], map, 'MAITRISE_GLOBALE') || ''),
      probaResiduelle: lire_(values[i], map, 'PROBA_RES') || '',
      scoreResiduel: lire_(values[i], map, 'SCORE_RES') || '',
      niveauResiduel: String(lire_(values[i], map, 'NIVEAU_RES') || ''),
      velocity: String(lire_(values[i], map, 'VELOCITY') || ''),
      persistence: String(lire_(values[i], map, 'PERSISTENCE') || ''),
      tendance: String(lire_(values[i], map, 'TENDANCE') || ''),
      positionAppetence: String(lire_(values[i], map, 'POSITION_APPETENCE') || ''),
      decision: String(lire_(values[i], map, 'DECISION') || ''),
      statut: String(lire_(values[i], map, 'STATUT_EVAL') || ''),
      validateur: String(lire_(values[i], map, 'VALIDATEUR') || ''),
      dateValidation: lire_(values[i], map, 'DATE_VALIDATION') || ''
    });
  }
  return out;
}

/**
 * Assemblage complet de la fiche 360° d'un risque. Chaîne de traçabilité
 * (section 9 de l'instruction de refonte) : Risque -> Évaluation ->
 * Contrôles -> Exécutions -> Évaluation des contrôles -> Actions
 * (les anomalies tenant lieu d'écarts, en l'absence de feuille Actions
 * dédiée dans le classeur actuel).
 */
function getFicheRisque(idRisque) {
  if (isBlank(idRisque)) throw new Error('L’identifiant du risque est obligatoire.');

  const risque = getRisk(idRisque);
  if (!risque) throw new Error('Risque introuvable : ' + idRisque);

  const historiqueEvaluations = getHistoriqueEvaluationsRisque_(idRisque);

  const controlesLies = getControles().filter(function (c) {
    return idDansListe_(c.risquesCouverts, idRisque);
  });
  const idsControlesLies = controlesLies.map(function (c) { return c.id; });

  const executionsLiees = getExecutions().filter(function (e) {
    return idsControlesLies.indexOf(e.idControle) !== -1;
  }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });

  const efficaciteLiee = getEvaluationsEfficacite().filter(function (ev) {
    return idsControlesLies.indexOf(ev.idControle) !== -1;
  }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });

  const derniereEfficacitePar = {};
  idsControlesLies.forEach(function (idc) { derniereEfficacitePar[idc] = getDerniereEfficacite(idc); });

  const anomaliesLiees = getAnomalies().filter(function (a) {
    return a.idRisque === idRisque || idsControlesLies.indexOf(a.idControle) !== -1;
  }).sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); });

  let departement = null;
  const departements = getDepartements();
  if (!isBlank(risque.departement)) {
    departement = departements.filter(function (d) {
      return normalizeText(d.nom) === normalizeText(risque.departement);
    })[0] || null;
  }

  // Position vs appétence : calculée à partir du score résiduel courant et
  // du plafond applicable (sous-catégorie / entité), sur le même principe
  // que 10_Evaluation. Si l'évaluation a déjà écrit une position, elle prime.
  let positionAppetence = historiqueEvaluations.length
    ? historiqueEvaluations[historiqueEvaluations.length - 1].positionAppetence : '';
  let scorePlafond = '';
  if (isBlank(positionAppetence)) {
    const appetence = resolveAppetence(risque.sousCategorie, risque.entite);
    if (appetence) {
      scorePlafond = appetence.scorePlafond;
      positionAppetence = calculateAppetitePosition(risque.scoreResiduel, appetence.scorePlafond);
    }
  }

  // Extrait du journal global : entrées dont l'objet ou le détail
  // référence ce risque ou l'un de ses contrôles liés. Le raccordement
  // automatique du journal n'existe pas encore (voir 09_JournalGlobal) :
  // cet extrait ne montre donc que ce qui a pu y être ajouté manuellement.
  let extraitJournal = [];
  try {
    const cibles = [idRisque].concat(idsControlesLies).map(normalizeText);
    extraitJournal = getJournalGlobal().filter(function (e) {
      const texte = normalizeText(e.objet + ' ' + e.detail);
      return cibles.some(function (c) { return texte.indexOf(c) !== -1; });
    }).slice(0, 20);
  } catch (e) { extraitJournal = []; }

  return pourClient_({
    version: VERSION_SCRIPTS,
    risque: risque,
    historiqueEvaluations: historiqueEvaluations,
    controlesLies: controlesLies,
    executionsLiees: executionsLiees,
    efficaciteLiee: efficaciteLiee,
    derniereEfficacitePar: derniereEfficacitePar,
    anomaliesLiees: anomaliesLiees,
    departement: departement,
    positionAppetence: positionAppetence,
    scorePlafond: scorePlafond,
    extraitJournal: extraitJournal
  });
}

/**
 * Liste légère des risques (id + intitulé), pour le sélecteur de la fiche.
 */
function getFicheRisqueListe() {
  return pourClient_({
    version: VERSION_SCRIPTS,
    user: profilUtilisateur_(),
    risques: getRisks().map(function (r) {
      return { id: r.id, intitule: r.intitule, niveauResiduel: r.niveauResiduel };
    })
  });
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_17_FicheRisque_() { return 'v10'; }
