/**
 * =====================================================================
 *  FICHIER  : 15_SynchroControles      type : Script (.gs)
 *  SECTION  : SOCLE COMMUN (appele apres chaque enregistrement d'execution
 *             ou d'evaluation d'efficacite)
 *  VERSION  : v10
 * =====================================================================
 *
 * Recalcule et ecrit, pour un controle donne, les colonnes de VUE de
 * R03_MATRICE_CONTROLES ("Efficacité opérationnelle", "Efficacité globale",
 * "Dernière évaluation", "Dernière exécution", "Taux d'exécution",
 * "Taux de conformité"). Ces colonnes ne sont jamais saisies a la main :
 * elles sont deduites de l'historique de R04_EXECUTIONS_CONTROLES et de
 * R06_EVALUATIONS_CONTROLES, sur le meme principe que SYNTHESE_RISQUES pour
 * RISQUES (05_Synthese.gs), a une difference pres : la synthese des risques
 * est posee par des formules de feuille (CHOOSECOLS, SORT, SORTN), alors
 * qu'ici le calcul est fait cote script et ecrit en valeur dans R03, parce
 * que les regles de calcul (taux, dernier en date, heuristique texte libre)
 * sont plus simples a exprimer et a faire evoluer en JavaScript qu'en
 * formule matricielle.
 *
 * IMPORTANT - ce fichier ne fait QUE la synchronisation de la vue. Il ne
 * cree, ne modifie et ne supprime aucune ligne de R04 ou R06 : il les lit
 * seulement.
 *
 * Regles de calcul v1 (heuristiques simples, deliberement documentees
 * ligne par ligne ci-dessous : elles sont un point de depart, a challenger
 * et ajuster une fois le dispositif reel observe) :
 *
 *   - EFFICACITE_OPERATIONNELLE_VUE = la valeur "Efficacité opérationnelle"
 *     de la DERNIERE evaluation d'efficacite du controle (par ordre
 *     d'ajout dans R06, donc la derniere ligne trouvee) ; vide si aucune
 *     evaluation n'existe encore pour ce controle.
 *
 *   - EFFICACITE_GLOBALE = la MEME valeur que EFFICACITE_OPERATIONNELLE_VUE
 *     pour cette v1. Simplification assumee : une vraie "efficacite
 *     globale" devrait ponderer l'efficacite operationnelle avec
 *     l'adequation de la conception (ADEQUATION_CONCEPTION, deja
 *     disponible dans R06 mais pas encore combinee). A affiner plus tard.
 *
 *   - DERNIERE_EVALUATION = la date (colonne DATE_EVAL de R06) de cette
 *     meme derniere evaluation ; vide si aucune evaluation.
 *
 *   - DERNIERE_EXECUTION = la date de realisation (DATE_REALISATION) de la
 *     derniere execution du controle, ou a defaut sa date prevue
 *     (DATE_PREVUE) si la realisation n'est pas renseignee ; vide si
 *     aucune execution n'existe encore.
 *
 *   - TAUX_EXECUTION = pourcentage entier d'executions dont le statut
 *     normalise (normalizeText) vaut "realise" ou "réalisé", rapporte au
 *     nombre total d'executions enregistrees pour ce controle. La cellule
 *     est laissee VIDE (jamais 0) si aucune execution n'existe : un
 *     controle qui n'a pas encore ete execute n'a pas un taux de 0%, il
 *     n'a simplement pas encore de taux.
 *
 *   - TAUX_CONFORMITE = pourcentage entier d'executions jugees "conformes"
 *     au sens d'une heuristique de texte libre : une execution est comptee
 *     conforme si son champ ANOMALIES_CONSTATEES est vide ET si son champ
 *     RESULTAT ne contient pas, une fois normalise (normalizeText), les
 *     mots "non conforme", "anomalie" ou "ecart". C'est une heuristique sur
 *     texte libre, fragile par construction (elle depend de la facon dont
 *     l'executeur redige le resultat) : elle est un point de depart en
 *     attendant un champ structure (ex: un statut de conformite dedie dans
 *     R04) qui rendrait ce calcul fiable. Vide si aucune execution.
 *
 * Ces colonnes restent soumises au meme garde-fou anti-formule que
 * ecrireLigneControle_() dans 11_Controles.gs : si l'utilisateur a pose une
 * formule dans une de ces cellules (colonne calculee autrement, formule de
 * secours...), cette synchro ne l'ecrase jamais.
 *
 * VERSION_CONTROLE et VALIDE_PAR ne sont jamais touchees ici : elles sont
 * hors perimetre (gerees ailleurs).
 */

/**
 * Derniere execution d'un controle par ordre d'ajout (la derniere ligne
 * du tableau filtre), sur le meme principe que getDerniereEfficacite()
 * dans 13_Efficacite.gs.
 */
function derniereExecutionControle_(executionsControle) {
  return executionsControle.length ? executionsControle[executionsControle.length - 1] : null;
}

/**
 * Heuristique de conformite d'une execution. Voir la documentation en tete
 * de fichier : a remplacer par un champ structure des que possible.
 */
function executionEstConforme_(execution) {
  if (!isBlank(execution.anomaliesConstatees)) return false;
  const resultat = normalizeText(execution.resultat);
  if (resultat.indexOf('non conforme') !== -1) return false;
  if (resultat.indexOf('anomalie') !== -1) return false;
  if (resultat.indexOf('ecart') !== -1) return false;
  return true;
}

/**
 * Calcule les 6 valeurs de vue pour un controle donne, a partir de son
 * historique d'executions et d'evaluations d'efficacite. Fonction pure,
 * sans acces feuille, pour rester facilement testable/ajustable.
 */
function calculerVueControle_(idControle, executions, evaluationsEfficacite) {
  const executionsControle = executions.filter(function (e) { return e.idControle === idControle; });
  const evalsControle = evaluationsEfficacite.filter(function (e) { return e.idControle === idControle; });

  const derniereEval = evalsControle.length ? evalsControle[evalsControle.length - 1] : null;
  const derniereExec = derniereExecutionControle_(executionsControle);

  const efficaciteOperationnelle = derniereEval ? derniereEval.efficaciteOperationnelle : '';
  const efficaciteGlobale = efficaciteOperationnelle; // v1 : simplification, voir en-tete de fichier

  const derniereEvaluationDate = derniereEval ? derniereEval.dateEval : '';
  const derniereExecutionDate = derniereExec ?
    (!isBlank(derniereExec.dateRealisation) ? derniereExec.dateRealisation : derniereExec.datePrevue) : '';

  let tauxExecution = '';
  if (executionsControle.length > 0) {
    const nRealisees = executionsControle.filter(function (e) {
      const s = normalizeText(e.statut);
      return s === 'realise' || s === 'réalisé';
    }).length;
    tauxExecution = Math.round((nRealisees / executionsControle.length) * 100);
  }

  let tauxConformite = '';
  if (executionsControle.length > 0) {
    const nConformes = executionsControle.filter(executionEstConforme_).length;
    tauxConformite = Math.round((nConformes / executionsControle.length) * 100);
  }

  return {
    efficaciteOperationnelle: efficaciteOperationnelle,
    efficaciteGlobale: efficaciteGlobale,
    derniereEvaluation: derniereEvaluationDate,
    derniereExecution: derniereExecutionDate,
    tauxExecution: tauxExecution,
    tauxConformite: tauxConformite
  };
}

/**
 * Recalcule et ecrit les colonnes de vue de R03_MATRICE_CONTROLES pour UN
 * controle. Ne fait rien silencieusement si le controle est introuvable
 * dans R03 (le controle a pu etre supprime entre-temps) : c'est appele en
 * best-effort apres coup, jamais dans le chemin critique d'ecriture.
 */
function synchroniserVueControles_(idControle) {
  if (isBlank(idControle)) return;

  const sheet = getSheet(SHEETS.CONTROLES);
  const map = mapControles();
  const colId = map.ID_CONTROLE;
  if (!colId) return;

  const row = findRowById(sheet, colId, idControle);
  if (row === -1) return;

  const vue = calculerVueControle_(idControle, getExecutions(), getEvaluationsEfficacite());

  const nCols = Math.max(sheet.getLastColumn(), 1);
  const plage = sheet.getRange(row, 1, 1, nCols);
  const values = plage.getValues()[0];
  const formules = plage.getFormulas()[0];

  function ecrire(cle, valeur) {
    const c = map[cle];
    if (!c) return;
    // Garde-fou anti-formule, identique a ecrireLigneControle_() dans
    // 11_Controles.gs : une cellule qui porte deja une formule n'est
    // jamais ecrasee par cette synchro.
    if (formules[c - 1] && String(formules[c - 1]).charAt(0) === '=') return;
    values[c - 1] = (valeur === null || valeur === undefined || valeur === '') ? '' : valeur;
  }

  ecrire('EFFICACITE_OPERATIONNELLE_VUE', vue.efficaciteOperationnelle);
  ecrire('EFFICACITE_GLOBALE', vue.efficaciteGlobale);
  ecrire('DERNIERE_EVALUATION', vue.derniereEvaluation ? new Date(vue.derniereEvaluation) : '');
  ecrire('DERNIERE_EXECUTION', vue.derniereExecution ? new Date(vue.derniereExecution) : '');
  ecrire('TAUX_EXECUTION', vue.tauxExecution);
  ecrire('TAUX_CONFORMITE', vue.tauxConformite);
  // VERSION_CONTROLE et VALIDE_PAR : volontairement jamais touchees ici.

  // Ecriture par blocs contigus non-formule, comme ecrireLigneControle_()
  // dans 11_Controles.gs, pour ne jamais reecrire une plage qui contient
  // une cellule a formule.
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
 * Recalcul complet, controle par controle. Utile pour un rattrapage manuel
 * (ex: apres une reprise de donnees historiques dans R04/R06, ou avant la
 * mise en place effective de cette synchro). Volontairement NON exposee
 * dans un menu ni dans 90_Administration.gs a ce stade : a brancher plus
 * tard, hors perimetre de ce lot.
 */
function synchroniserToutesLesVues_() {
  const controles = getControles();
  let n = 0;
  controles.forEach(function (c) {
    synchroniserVueControles_(c.id);
    n++;
  });
  return n;
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_15_SynchroControles_() { return 'v10'; }
