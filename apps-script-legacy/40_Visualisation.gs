/**
 * =====================================================================
 *  FICHIER  : 40_Visualisation         type : Script (.gs)
 *  SECTION  : MENU 4 · Visualisation des risques
 *             > Ouvrir la visualisation -> ouvrirVisualisationRisques
 *  VA AVEC  : UI_Visualisation (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * Une carte par risque : score inherent et score residuel relies par une
 * fleche de part et d'autre du risque, et, en dessous, la progression de
 * toutes les evaluations retenues de ce risque en graphique anime
 * (Chart.js), inherent et residuel superposes. Un risque a une seule
 * evaluation affiche un point unique plutot qu'une courbe. Les cartes sont
 * groupees en lots parcourus par des fleches (carrousel), et un clic sur
 * une carte ouvre le detail complet du risque (description, causes,
 * consequences, controles associes, historique des evaluations).
 *
 * Rien n'est fige dans le code :
 *  - le critere qui decide si une ligne de RISQUES compte comme "remplie"
 *    est une liste de cles de colonnes, lue dans CONFIG (VISU_CRITERES_LIGNE) ;
 *  - les axes d'impact retenus pour recalculer le score de chaque
 *    evaluation sont un sous-ensemble (ou la totalite) des axes du
 *    referentiel ECHELLES_COTATION, lu dans CONFIG (VISU_AXES_IMPACT) ;
 *  - la maniere de combiner plusieurs axes retenus, maximum ou moyenne,
 *    vient aussi de CONFIG (VISU_MODE_IMPACT) ;
 *  - le nombre de cartes affichees par lot dans le carrousel vient de
 *    CONFIG (VISU_CARTES_PAR_LOT).
 * Administration > Mettre à niveau le classeur ajoute ces quatre cles a
 * CONFIG si elles manquent ; en leur absence, les valeurs par defaut
 * ci-dessous s'appliquent, la fonctionnalite marche donc sans reglage.
 */

const DEFAUT_VISU_CRITERES_LIGNE = 'PROBA_INH;SCORE_INH;PROBA_RES;SCORE_RES';
const DEFAUT_VISU_MODE_IMPACT = 'max';
const DEFAUT_VISU_CARTES_PAR_LOT = 2;
const VISU_CARTES_PAR_LOT_MIN = 1;
const VISU_CARTES_PAR_LOT_MAX = 12;

function ouvrirVisualisationRisques() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_Visualisation', 'Visualisation des risques', 1220, 840);
}

// ---------------------------------------------------------------- //
// Parametrage lu dans CONFIG, bloc 1 (cle / valeur)
// ---------------------------------------------------------------- //

/**
 * Cles du dictionnaire HEADERS_EVALUATIONS (02_Colonnes) dont au moins une
 * doit etre renseignee pour qu'une ligne de RISQUES compte comme "remplie"
 * dans la visualisation. Configurable via CONFIG > VISU_CRITERES_LIGNE,
 * cles separees par ; (ex : PROBA_INH;SCORE_INH;PROBA_RES;SCORE_RES).
 * Une cle absente du dictionnaire est ignoree plutot que de faire echouer
 * l'ouverture ; si plus aucune cle n'est valide, le critere par defaut
 * s'applique.
 */
function critereLigneVisualisation_() {
  const source = getConfigParams()['VISU_CRITERES_LIGNE'] || DEFAUT_VISU_CRITERES_LIGNE;
  const cles = String(source).split(';').map(function (s) { return s.trim(); }).filter(Boolean);
  const valides = cles.filter(function (c) { return HEADERS_EVALUATIONS.hasOwnProperty(c); });
  return valides.length ? valides : DEFAUT_VISU_CRITERES_LIGNE.split(';');
}

/**
 * Une ligne compte des qu'une seule des cles retenues est renseignee (logique
 * OU), coherente avec ligneCotee_ de 30_Cartographie dont c'est le
 * comportement par defaut.
 */
function ligneRemplieVisualisation_(row, map, cles) {
  return cles.some(function (c) { return !isBlank(lire_(row, map, c)); });
}

/**
 * Axes d'impact retenus pour la visualisation, parmi ceux du referentiel
 * ECHELLES_COTATION. Configurable via CONFIG > VISU_AXES_IMPACT, libelles
 * d'axes separes par ; et compares sans tenir compte des accents ni de la
 * casse. Cle absente ou vide : tous les axes du referentiel sont retenus.
 * Aucun des libelles indiques ne correspond a un axe connu : repli sur tous
 * les axes plutot que de renvoyer une liste vide.
 */
function axesVisualisation_(axesReferentiel) {
  const source = getConfigParams()['VISU_AXES_IMPACT'];
  if (isBlank(source)) return axesReferentiel;
  const demandes = String(source).split(';')
    .map(function (s) { return normalizeText(s.trim()); }).filter(Boolean);
  const retenus = axesReferentiel.filter(function (a) { return demandes.indexOf(normalizeText(a)) !== -1; });
  return retenus.length ? retenus : axesReferentiel;
}

/**
 * Mode de combinaison des axes d'impact retenus : 'max' (par defaut,
 * coherent avec le reste de l'application, cartographie comprise) ou
 * 'moyenne'. Configurable via CONFIG > VISU_MODE_IMPACT.
 */
function modeImpactVisualisation_() {
  const m = normalizeText(getConfigParams()['VISU_MODE_IMPACT'] || DEFAUT_VISU_MODE_IMPACT);
  return (m === 'moyenne' || m === 'moyen' || m === 'average') ? 'moyenne' : 'max';
}

/**
 * Nombre de cartes affichees par lot dans le carrousel de la visualisation.
 * Configurable via CONFIG > VISU_CARTES_PAR_LOT (nombre entier). Valeur
 * absente, non numerique ou hors bornes : repli sur la valeur par defaut
 * plutot que de bloquer l'ouverture de la fenetre.
 */
function cartesParLotVisualisation_() {
  const source = getConfigParams()['VISU_CARTES_PAR_LOT'];
  const n = parseInt(source, 10);
  if (!n || isNaN(n) || n < VISU_CARTES_PAR_LOT_MIN || n > VISU_CARTES_PAR_LOT_MAX) {
    return DEFAUT_VISU_CARTES_PAR_LOT;
  }
  return n;
}

function agregerImpact_(valeurs, mode) {
  const nums = valeurs.filter(function (v) { return v !== null; });
  if (!nums.length) return null;
  if (mode === 'moyenne') {
    const s = nums.reduce(function (a, b) { return a + b; }, 0);
    return Math.round((s / nums.length) * 10) / 10;
  }
  return Math.max.apply(null, nums);
}

// ---------------------------------------------------------------- //
// Construction des donnees, une entree par evaluation retenue
// ---------------------------------------------------------------- //

/**
 * Position d'une evaluation pour une phase ('inh' ou 'res') : probabilite,
 * impact recalcule sur les axes configures (colonnes "cols"), score et
 * niveau. L'impact retenu saisi par l'evaluateur (IMPACT_RETENU_*) n'est
 * utilise qu'en repli, si aucune des colonnes d'axe n'est exploitable —
 * par exemple un classeur ancien ou les colonnes par axe ne sont pas
 * encore alimentees.
 */
function phaseVisualisation_(row, map, cleP, cleI, cols, mode) {
  const p = nombre1a5_(lire_(row, map, cleP));
  const valeursAxes = cols.map(function (c) { return nombre1a5_(row[c - 1]); });
  let im = agregerImpact_(valeursAxes, mode);
  if (im === null) im = nombre1a5_(lire_(row, map, cleI));
  const s = (p && im) ? Math.round(p * im * 10) / 10 : null;
  return { p: p, i: im, s: s, niveau: s ? calculateRiskLevel(s) : '' };
}

/**
 * Donnees envoyees a la boite de dialogue : une carte par risque, avec la
 * liste chronologique de ses evaluations retenues (pour le graphique de
 * progression Chart.js) et sa derniere position (pour la fleche
 * inherent -> residuel). Un risque sans aucune ligne remplie au sens du
 * critere configure n'apparait pas.
 */
function getDonneesVisualisation() {
  const map = mapRisques();
  const values = lireToutesLesLignes_();
  const ref = getReferentiels();
  const axes = axesVisualisation_(ref.impact.axes);
  const mode = modeImpactVisualisation_();
  const colsInh = colonnesImpact_(SHEETS.RISQUES, axes, 'inh');
  const colsRes = colonnesImpact_(SHEETS.RISQUES, axes, 'res');
  const cles = critereLigneVisualisation_();

  const parRisque = {};
  const ordre = [];
  const tousLesId = {};
  let lignesRetenues = 0;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = lire_(row, map, 'ID_RISQUE');
    if (isBlank(id)) continue;
    tousLesId[id] = true;
    if (!ligneRemplieVisualisation_(row, map, cles)) continue;
    lignesRetenues++;

    if (!parRisque[id]) { parRisque[id] = []; ordre.push(id); }
    const d = lire_(row, map, 'DATE_EVAL');
    parRisque[id].push({
      idEval: String(lire_(row, map, 'ID_EVAL') || ''),
      date: d instanceof Date ? d.toISOString() : (isBlank(d) ? null : String(d)),
      statut: String(lire_(row, map, 'STATUT_EVAL') || ''),
      inh: phaseVisualisation_(row, map, 'PROBA_INH', 'IMPACT_RETENU_INH', colsInh, mode),
      res: phaseVisualisation_(row, map, 'PROBA_RES', 'IMPACT_RETENU_RES', colsRes, mode)
    });
  }

  const risques = ordre.map(function (id) {
    const evals = parRisque[id].slice().sort(function (a, b) {
      return (a.date ? new Date(a.date).getTime() : 0) - (b.date ? new Date(b.date).getTime() : 0);
    });
    const derniere = evals[evals.length - 1];
    const fiche = getRisk(String(id)) || {};
    return {
      id: String(id),
      court: String(id).split('-').pop(),
      intitule: fiche.intitule || '',
      entite: fiche.entite || '',
      processus: fiche.processus || '',
      categorie: fiche.categorie || '',
      sousCategorie: fiche.sousCategorie || '',
      proprietaire: fiche.proprietaire || '',
      description: fiche.description || '',
      causes: fiche.causes || '',
      consequences: fiche.consequences || '',
      controles: fiche.controles || '',
      statut: derniere.statut,
      nbEvaluations: evals.length,
      derniere: derniere,
      evaluations: evals
    };
  });

  // Les risques les plus critiques (residuel, ou inherent a defaut) en tete.
  risques.sort(function (a, b) {
    const sa = (a.derniere.res.s !== null ? a.derniere.res.s : a.derniere.inh.s) || 0;
    const sb = (b.derniere.res.s !== null ? b.derniere.res.s : b.derniere.inh.s) || 0;
    return sb - sa;
  });

  const entites = {}, categories = {}, statuts = {};
  risques.forEach(function (r) {
    if (r.entite) entites[r.entite] = true;
    if (r.categorie) categories[r.categorie] = true;
    if (r.statut) statuts[r.statut] = true;
  });

  return pourClient_({
    risques: risques,
    totalRisques: Object.keys(tousLesId).length,
    risquesRetenus: risques.length,
    totalLignes: values.filter(function (row) { return !isBlank(lire_(row, map, 'ID_RISQUE')); }).length,
    lignesRetenues: lignesRetenues,
    axes: axes,
    axesReferentiel: ref.impact.axes,
    mode: mode,
    criteres: cles,
    cartesParLot: cartesParLotVisualisation_(),
    seuils: seuilsNiveau_(),
    filtres: {
      entites: Object.keys(entites).sort(),
      categories: Object.keys(categories).sort(),
      statuts: Object.keys(statuts).sort()
    },
    echelles: {
      probabilite: ref.probabilite.map(function (p) { return { niveau: p.niveau, libelle: String(p.libelle) }; }),
      impact: ref.impact.niveaux.map(function (n) {
        return { niveau: n.niveau, libelle: String(n.libelle).split('·').pop().trim() };
      })
    },
    methodologie: getActiveMethodologyVersion()
  });
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_40_Visualisation_() { return 'v10'; }
